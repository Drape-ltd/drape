import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { notificationDestinationData } from '../../../packages/shared/src/notification-policy.ts'

const FN = 'consultation-attendance-action'
const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('report'),
    bookingId: uuid,
    reason: z.string().trim().min(10).max(1000),
    idempotencyKey: z.string().trim().min(8).max(160),
  }),
  z.object({
    action: z.literal('respond'),
    bookingId: uuid,
    responseCode: z.enum(['AGREE_NO_CALL', 'I_ATTENDED', 'CONNECTION_ISSUE', 'OTHER']),
    response: z.string().trim().max(1000).optional(),
  }),
])

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const caller = await getAuthUser(request)
  if (!caller) return json({ error: 'Sign in again before updating attendance.' }, 401, cors)
  const parsed = parseBody(BodySchema, await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, 400, cors)

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const { data: booking, error: bookingError } = await supabase
    .from('consultation_bookings')
    .select('id, order_id, customer_id, tailor_id, scheduled_start_at')
    .eq('id', parsed.data.bookingId)
    .maybeSingle()
  if (bookingError) return json({ error: 'Attendance could not be checked right now.' }, 500, cors)
  if (!booking) return json({ error: 'Consultation booking not found.' }, 404, cors)

  const actorRole = booking.customer_id === caller.id
    ? 'CUSTOMER'
    : booking.tailor_id === caller.id ? 'TAILOR' : null
  if (!actorRole) return json({ error: 'You are not part of this consultation.' }, 403, cors)

  const rpc = parsed.data.action === 'report'
    ? await supabase.rpc('submit_consultation_attendance_report', {
        p_booking_id: parsed.data.bookingId,
        p_actor_id: caller.id,
        p_reason: parsed.data.reason,
        p_idempotency_key: parsed.data.idempotencyKey,
      })
    : await supabase.rpc('respond_to_consultation_attendance_report_v2', {
        p_booking_id: parsed.data.bookingId,
        p_actor_id: caller.id,
        p_response_code: parsed.data.responseCode,
        p_response: parsed.data.response?.trim() || null,
      })

  if (rpc.error) {
    log('warn', FN, 'attendance_action_failed', {
      actor_id: caller.id,
      booking_id: parsed.data.bookingId,
      action: parsed.data.action,
      error: rpc.error.message,
    })
    return json({ error: rpc.error.message }, 409, cors)
  }

  const counterpartId = actorRole === 'CUSTOMER' ? booking.tailor_id : booking.customer_id
  const { data: order } = await supabase
    .from('orders')
    .select('id, reference, customer_id, tailor_id')
    .eq('id', booking.order_id)
    .maybeSingle()
  const isReport = parsed.data.action === 'report'
  const resolvedToReschedule = !isReport && rpc.data?.nextAction === 'RESCHEDULE'
  const title = isReport
    ? 'Consultation attendance needs review'
    : resolvedToReschedule ? 'Choose a new consultation time' : 'Consultation attendance sent to Drapeon'
  const body = isReport
    ? 'A consultation attendance report was opened. Review the provider-backed timeline and respond within 24 hours.'
    : resolvedToReschedule
      ? 'Both of you confirmed the consultation did not happen. The fee remains protected. Propose a new time in the order.'
      : 'The accounts differ, so Drapeon Ops will review the call activity before any money moves.'

  if (!isReport && !resolvedToReschedule) {
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'ORDER_REVIEW',
      severity: 'HIGH',
      source: FN,
      actorRole,
      orderId: booking.order_id,
      userId: caller.id,
      relatedEntityType: 'CONSULTATION_BOOKING',
      relatedEntityId: booking.id,
      title: 'Consultation attendance requires a decision',
      description: 'The customer and tailor accounts differ or describe a connection issue. Money remains frozen pending provider-backed review.',
      recommendedAction: 'Compare both accounts with the call participation timeline, then resolve to reschedule, customer refund, or verified tailor earning.',
      dedupeKey: `consultation-attendance:${booking.id}`,
      metadata: { financial_case_id: rpc.data?.caseId ?? null, response_code: parsed.data.action === 'respond' ? parsed.data.responseCode : null },
    })
  }

  await Promise.allSettled([
    enqueuePushJob(supabase, {
      userId: counterpartId,
      source: FN,
      orderId: booking.order_id,
      idempotencyKey: `${FN}:${parsed.data.action}:${parsed.data.bookingId}:${counterpartId}`,
      notification: {
        title,
        body,
        preferenceKey: 'orderUpdates',
        data: notificationDestinationData({ kind: 'ORDER', orderId: booking.order_id }),
      },
    }),
    enqueueOrderEventEmailJob(supabase, {
      order: order ?? { id: booking.order_id },
      recipientUserId: counterpartId,
      audience: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
      source: FN,
      subject: title,
      headline: title,
      body,
      idempotencyKey: `${FN}:email:${parsed.data.action}:${parsed.data.bookingId}:${counterpartId}`,
      ctaLabel: 'Review attendance',
      priority: 12,
    }),
    audit(supabase, {
      event: isReport ? 'consultation.attendance_reported' : 'consultation.attendance_responded',
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: booking.order_id,
      severity: 'warn',
      payload: { function: FN, booking_id: booking.id, result: rpc.data, response_code: parsed.data.action === 'respond' ? parsed.data.responseCode : null },
    }),
  ])

  return json({ ok: true, result: rpc.data }, 200, cors)
})
