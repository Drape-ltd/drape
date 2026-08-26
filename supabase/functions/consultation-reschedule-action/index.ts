import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { assertConsultationSlotAvailable, consultationScheduledEndAt } from '../_shared/consultation-bookings.ts'
import { parseOrderSupportMeta, serializeOrderSupportMeta } from '../_shared/order-support.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'consultation-reschedule-action'
const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request'),
    orderId: uuid,
    proposedStartAt: z.string().datetime({ offset: true }),
    alternativeStartAts: z.array(z.string().datetime({ offset: true })).max(2).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('counter'),
    orderId: uuid,
    requestId: uuid,
    proposedStartAt: z.string().datetime({ offset: true }),
    alternativeStartAts: z.array(z.string().datetime({ offset: true })).max(2).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('respond'),
    orderId: uuid,
    requestId: uuid,
    decision: z.enum(['ACCEPTED', 'DECLINED']),
    selectedStartAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(300).optional(),
  }),
])

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function recommendedStartAt(minLeadMinutes = 60) {
  const intervalMs = 15 * 60 * 1000
  const minimumMs = Date.now() + (minLeadMinutes + 1) * 60 * 1000
  return new Date(Math.ceil(minimumMs / intervalMs) * intervalMs).toISOString()
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return json({ code: 'UNAUTHORIZED', error: 'Sign in again to change this consultation.' }, 401, cors)
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ code: 'VALIDATION_FAILED', error: parsed.error }, 400, cors)

    const input = parsed.data
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, reference, stage, customer_id, tailor_id, order_kind, garment_type, item_title, item_size, delivery_method, quoted_amount, quoted_currency, currency, special_note')
      .eq('id', input.orderId)
      .maybeSingle()
    if (orderError || !order) return json({ code: 'ORDER_NOT_FOUND', error: 'That order could not be found.' }, 404, cors)

    const actorRole = order.customer_id === caller.id ? 'CUSTOMER' : order.tailor_id === caller.id ? 'TAILOR' : null
    if (!actorRole) return json({ code: 'FORBIDDEN', error: 'Only the customer or tailor can change this consultation.' }, 403, cors)
    if (order.stage !== 'CONSULTATION') return json({ code: 'CONSULTATION_CLOSED', error: 'This order is no longer waiting for a consultation.' }, 409, cors)

    const { data: booking, error: bookingError } = await supabase
      .from('consultation_bookings')
      .select('id, scheduled_start_at, scheduled_end_at, duration_minutes')
      .eq('order_id', order.id)
      .eq('status', 'CONFIRMED')
      .maybeSingle()
    if (bookingError || !booking) return json({ code: 'BOOKING_NOT_FOUND', error: 'The confirmed consultation time could not be found.' }, 409, cors)

    const orderEmailShape = {
      id: order.id,
      reference: order.reference,
      order_kind: order.order_kind,
      customer_id: order.customer_id,
      tailor_id: order.tailor_id,
      garment_type: order.garment_type,
      item_title: order.item_title,
      item_size: order.item_size,
      delivery_method: order.delivery_method,
      quoted_amount: order.quoted_amount,
      quoted_currency: order.quoted_currency,
      currency: order.currency,
    }

    if (input.action === 'request') {
      const proposedOptions = [input.proposedStartAt, ...(input.alternativeStartAts ?? [])]
      const uniqueOptions = [...new Set(proposedOptions)]
      if (uniqueOptions.length !== proposedOptions.length || uniqueOptions.some((value) => {
        const proposedMs = new Date(value).getTime()
        return !Number.isFinite(proposedMs) || proposedMs < Date.now() + 60 * 60 * 1000
      })) {
        return json({ code: 'CONSULTATION_TIME_TOO_SOON', error: 'That time is too soon. Use the suggested replacement or choose another time.', recommendedStartAt: recommendedStartAt() }, 400, cors)
      }
      const duration = [15, 30, 45, 60].includes(booking.duration_minutes)
        ? booking.duration_minutes as 15 | 30 | 45 | 60
        : 30
      const proposedEndAt = consultationScheduledEndAt(input.proposedStartAt, duration)
      for (const option of uniqueOptions) {
        const availability = await assertConsultationSlotAvailable(supabase, {
          orderId: order.id,
          tailorId: order.tailor_id,
          scheduledStartAt: option,
          scheduledEndAt: consultationScheduledEndAt(option, duration),
          durationMinutes: duration,
        })
        if (!availability.ok) return json({ code: availability.code, error: availability.error }, availability.status, cors)
      }

      const { data: requestRow, error: requestError } = await supabase
        .from('consultation_reschedule_requests')
        .insert({
          order_id: order.id,
          booking_id: booking.id,
          requested_by: caller.id,
          requested_by_role: actorRole,
          proposed_start_at: input.proposedStartAt,
          proposed_end_at: proposedEndAt,
          proposed_start_options: uniqueOptions,
          note: input.note?.trim() || null,
        })
        .select('id')
        .single()
      if (requestError) {
        const duplicate = requestError.code === '23505'
        return json({ code: duplicate ? 'RESCHEDULE_ALREADY_PENDING' : 'RESCHEDULE_REQUEST_FAILED', error: duplicate ? 'A reschedule request is already waiting for a response.' : 'Could not send the reschedule request.' }, duplicate ? 409 : 500, cors)
      }

      const recipientId = actorRole === 'CUSTOMER' ? order.tailor_id : order.customer_id
      const recipientAudience = actorRole === 'CUSTOMER' ? 'TAILOR' as const : 'CUSTOMER' as const
      await Promise.all([
        enqueuePushJob(supabase, {
          userId: recipientId,
          source: FN,
          orderId: order.id,
          idempotencyKey: `consultation-reschedule-request:${requestRow.id}`,
          priority: 15,
          notification: {
            title: 'New consultation time proposed',
            body: 'Review the replacement time and accept or decline it.',
            preferenceKey: 'messages',
            data: { orderId: order.id, target: 'order', destination: 'order' },
          },
        }),
        enqueueOrderEventEmailJob(supabase, {
          order: orderEmailShape,
          recipientUserId: recipientId,
          audience: recipientAudience,
          subject: 'Consultation reschedule needs your response',
          headline: 'A new consultation time was proposed',
          body: 'Review the replacement time in Drapeon. The current booking stays in place until you accept.',
          ctaLabel: 'Review time',
          source: FN,
          idempotencyKey: `consultation-reschedule-request:${requestRow.id}`,
          priority: 15,
        }),
      ])
      await audit(supabase, { event: 'consultation.reschedule_requested', actor_id: caller.id, actor_role: actorRole, order_id: order.id, payload: { request_id: requestRow.id, proposed_start_at: input.proposedStartAt } })
      return json({ ok: true, requestId: requestRow.id }, 200, cors)
    }

    const { data: requestRow, error: requestError } = await supabase
      .from('consultation_reschedule_requests')
      .select('id, requested_by, requested_by_role, proposed_start_at, proposed_end_at, proposed_start_options, status')
      .eq('id', input.requestId)
      .eq('order_id', order.id)
      .maybeSingle()
    if (requestError || !requestRow) return json({ code: 'RESCHEDULE_NOT_FOUND', error: 'That reschedule request could not be found.' }, 404, cors)
    if (requestRow.status !== 'PENDING') return json({ code: 'RESCHEDULE_ALREADY_DECIDED', error: 'This reschedule request has already been decided.' }, 409, cors)
    if (requestRow.requested_by === caller.id) return json({ code: 'INDEPENDENT_RESPONSE_REQUIRED', error: 'The other person must respond to this time.' }, 403, cors)

    if (input.action === 'counter') {
      const proposedOptions = [input.proposedStartAt, ...(input.alternativeStartAts ?? [])]
      const uniqueOptions = [...new Set(proposedOptions)]
      if (uniqueOptions.length !== proposedOptions.length || uniqueOptions.some((value) => new Date(value).getTime() < Date.now() + 60 * 60 * 1000)) {
        return json({ code: 'CONSULTATION_TIME_TOO_SOON', error: 'One or more times are too soon. Use the suggested replacement or choose other times.', recommendedStartAt: recommendedStartAt() }, 400, cors)
      }
      const duration = [15, 30, 45, 60].includes(booking.duration_minutes) ? booking.duration_minutes : 30
      for (const option of uniqueOptions) {
        const endAt = consultationScheduledEndAt(option, duration as 15 | 30 | 45 | 60)
        const availability = await assertConsultationSlotAvailable(supabase, { orderId: order.id, tailorId: order.tailor_id, scheduledStartAt: option, scheduledEndAt: endAt, durationMinutes: duration })
        if (!availability.ok) return json({ code: availability.code, error: availability.error }, availability.status, cors)
      }
      const { error: counterError } = await supabase.from('consultation_reschedule_requests').update({
        requested_by: caller.id,
        requested_by_role: actorRole,
        proposed_start_at: input.proposedStartAt,
        proposed_end_at: consultationScheduledEndAt(input.proposedStartAt, duration as 15 | 30 | 45 | 60),
        proposed_start_options: uniqueOptions,
        note: input.note?.trim() || null,
        responded_by: null,
        response_note: null,
        responded_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', requestRow.id).eq('status', 'PENDING')
      if (counterError) return json({ code: 'RESCHEDULE_COUNTER_FAILED', error: 'Could not send those times.' }, 409, cors)
      const recipientId = requestRow.requested_by
      const recipientAudience = requestRow.requested_by_role === 'CUSTOMER' ? 'CUSTOMER' as const : 'TAILOR' as const
      const counterVersion = new Date().toISOString()
      await Promise.all([
        enqueuePushJob(supabase, { userId: recipientId, source: FN, orderId: order.id, idempotencyKey: `consultation-reschedule-counter:${requestRow.id}:${counterVersion}`, priority: 15, notification: { title: 'Other consultation times suggested', body: 'Review the new options and choose a time that works.', preferenceKey: 'messages', data: { orderId: order.id, target: 'order', destination: 'order' } } }),
        enqueueOrderEventEmailJob(supabase, { order: orderEmailShape, recipientUserId: recipientId, audience: recipientAudience, subject: 'Choose a consultation time', headline: 'Other consultation times were suggested', body: 'Review the new options in Drapeon and choose the time that works.', ctaLabel: 'Choose a time', source: FN, idempotencyKey: `consultation-reschedule-counter:${requestRow.id}:${counterVersion}`, priority: 15 }),
      ])
      await audit(supabase, { event: 'consultation.reschedule_countered', actor_id: caller.id, actor_role: actorRole, order_id: order.id, payload: { request_id: requestRow.id, proposed_start_options: uniqueOptions } })
      return json({ ok: true, requestId: requestRow.id }, 200, cors)
    }

    if (input.decision === 'ACCEPTED') {
      const offeredOptions = Array.isArray(requestRow.proposed_start_options) && requestRow.proposed_start_options.length > 0
        ? requestRow.proposed_start_options
        : [requestRow.proposed_start_at]
      const selectedStartAt = input.selectedStartAt ?? offeredOptions[0]
      if (!offeredOptions.some((value: string) => new Date(value).getTime() === new Date(selectedStartAt).getTime())) {
        return json({ code: 'RESCHEDULE_OPTION_INVALID', error: 'Choose one of the offered consultation times.' }, 400, cors)
      }
      const duration = [15, 30, 45, 60].includes(booking.duration_minutes)
        ? booking.duration_minutes as 15 | 30 | 45 | 60
        : 30
      const selectedEndAt = consultationScheduledEndAt(selectedStartAt, duration)
      const availability = await assertConsultationSlotAvailable(supabase, {
        orderId: order.id,
        tailorId: order.tailor_id,
        scheduledStartAt: selectedStartAt,
        scheduledEndAt: selectedEndAt,
      })
      if (!availability.ok) return json({ code: availability.code, error: availability.error }, availability.status, cors)
      const { error: moveError } = await supabase
        .from('consultation_bookings')
        .update({
          scheduled_start_at: selectedStartAt,
          scheduled_end_at: selectedEndAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id)
        .eq('status', 'CONFIRMED')
      if (moveError) return json({ code: 'CONSULTATION_SLOT_UNAVAILABLE', error: 'That time is no longer available. Propose another time.' }, 409, cors)

      const supportMeta = parseOrderSupportMeta(order.special_note)
      await supabase.from('orders').update({
        video_call_url: null,
        special_note: supportMeta.consultation
          ? serializeOrderSupportMeta({
              ...supportMeta,
              consultation: {
                ...supportMeta.consultation,
                status: 'SCHEDULED',
                proposedStartAt: selectedStartAt,
                scheduledStartAt: selectedStartAt,
                scheduledEndAt: selectedEndAt,
                reminder30SentAt: null,
                reminder10SentAt: null,
                reminder5SentAt: null,
                reminderStartSentAt: null,
              },
            })
          : order.special_note,
      }).eq('id', order.id)
    }

    const now = new Date().toISOString()
    const { data: decidedRequest, error: decisionError } = await supabase.from('consultation_reschedule_requests').update({
      status: input.decision,
      accepted_start_at: input.decision === 'ACCEPTED' ? (input.selectedStartAt ?? requestRow.proposed_start_at) : null,
      responded_by: caller.id,
      response_note: input.note?.trim() || null,
      responded_at: now,
      updated_at: now,
    }).eq('id', requestRow.id).eq('status', 'PENDING').select('id').maybeSingle()
    if (decisionError || !decidedRequest) {
      return json({ code: 'RESCHEDULE_ALREADY_DECIDED', error: 'This reschedule request has already been decided.' }, 409, cors)
    }
    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: input.decision === 'ACCEPTED'
        ? 'Consultation rescheduled. Both parties were notified and reminders now follow the new time.'
        : 'Consultation reschedule declined. The existing consultation time remains booked.',
    })

    const recipientId = requestRow.requested_by
    const recipientAudience = requestRow.requested_by_role === 'CUSTOMER' ? 'CUSTOMER' as const : 'TAILOR' as const
    await Promise.all([
      enqueuePushJob(supabase, {
        userId: recipientId,
        source: FN,
        orderId: order.id,
        idempotencyKey: `consultation-reschedule-response:${requestRow.id}:${input.decision}`,
        priority: 15,
        notification: {
          title: input.decision === 'ACCEPTED' ? 'Consultation time confirmed' : 'Consultation time not changed',
          body: input.decision === 'ACCEPTED' ? 'The new time is booked and reminders were updated.' : 'The existing time is still booked. Coordinate another option in chat.',
          preferenceKey: 'messages',
          data: { orderId: order.id, target: 'order', destination: 'order' },
        },
      }),
      enqueueOrderEventEmailJob(supabase, {
        order: orderEmailShape,
        recipientUserId: recipientId,
        audience: recipientAudience,
        subject: input.decision === 'ACCEPTED' ? 'Consultation rescheduled' : 'Consultation time unchanged',
        headline: input.decision === 'ACCEPTED' ? 'Your new consultation time is confirmed' : 'The proposed consultation time was declined',
        body: input.decision === 'ACCEPTED' ? 'Drapeon updated the booking and all reminders to the accepted time.' : 'The current booking remains active. Use the protected order chat to coordinate another option.',
        ctaLabel: 'View consultation',
        source: FN,
        idempotencyKey: `consultation-reschedule-response:${requestRow.id}:${input.decision}`,
        priority: 15,
      }),
    ])
    await audit(supabase, { event: 'consultation.reschedule_responded', actor_id: caller.id, actor_role: actorRole, order_id: order.id, payload: { request_id: requestRow.id, decision: input.decision } })
    return json({ ok: true, status: input.decision }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return json({ code: 'INTERNAL_ERROR', error: 'Could not update this consultation time.' }, 500, getCorsHeaders(req))
  }
})
