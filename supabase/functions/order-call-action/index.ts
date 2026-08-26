import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { parseOrderSupportMeta, serializeOrderSupportMeta } from '../_shared/order-support.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { isoDate, parseBody, uuid, z } from '../_shared/validate.ts'
import { formatExplicitZonedDateTime, isSupportedTimeZone } from '../_shared/date-time.ts'

const FN = 'order-call-action'
const CALL_DURATION_MINUTES = 30
const MIN_LEAD_MS = 30 * 60 * 1000
const MAX_LEAD_MS = 30 * 24 * 60 * 60 * 1000
const ORDER_CALL_STAGES = [
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
] as const

const BodySchema = z.object({
  orderId: uuid,
  action: z.enum(['schedule-order-call', 'schedule-ready-made-call']),
  scheduledStartAt: isoDate,
  timezone: z.string().trim().max(80).refine(isSupportedTimeZone, 'Choose a valid timezone.').optional(),
  reason: z.enum(['SIZE_OR_FIT', 'ITEM_CONDITION', 'PICKUP_OR_DELIVERY', 'TIMELINE', 'OTHER']).default('OTHER'),
  note: z.string().trim().max(300).optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(corsHeaders: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, corsHeaders)
}

function scheduledEndAt(startAt: string) {
  return new Date(new Date(startAt).getTime() + CALL_DURATION_MINUTES * 60 * 1000).toISOString()
}

function recommendedStartAt() {
  const intervalMs = 15 * 60 * 1000
  const minimumMs = Date.now() + MIN_LEAD_MS + 60 * 1000
  return new Date(Math.ceil(minimumMs / intervalMs) * intervalMs).toISOString()
}

function validateScheduledStartAt(startAt: string) {
  const startMs = new Date(startAt).getTime()
  if (!Number.isFinite(startMs)) return 'Choose a valid call time.'
  const now = Date.now()
  if (startMs < now + MIN_LEAD_MS) return 'Choose a call time at least 30 minutes from now.'
  if (startMs > now + MAX_LEAD_MS) return 'Choose a call time within the next 30 days.'
  return null
}

function actorRoleForOrder(callerId: string, order: { customer_id?: string | null; tailor_id?: string | null }) {
  if (order.customer_id?.toString() === callerId) return 'CUSTOMER' as const
  if (order.tailor_id?.toString() === callerId) return 'TAILOR' as const
  return null
}

function counterpartIdFor(actorRole: 'CUSTOMER' | 'TAILOR', order: { customer_id?: string | null; tailor_id?: string | null }) {
  return actorRole === 'CUSTOMER'
    ? order.tailor_id?.toString() ?? null
    : order.customer_id?.toString() ?? null
}

function reasonLabel(reason: string) {
  switch (reason) {
    case 'SIZE_OR_FIT':
      return 'size or fit'
    case 'ITEM_CONDITION':
      return 'item condition'
    case 'PICKUP_OR_DELIVERY':
      return 'pickup or delivery'
    case 'TIMELINE':
      return 'timing'
    default:
      return 'order clarity'
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(corsHeaders, 401, 'UNAUTHORIZED', 'Please sign in again before scheduling a Drapeon call.')

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonError(corsHeaders, 400, 'VALIDATION_FAILED', parsed.error)

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 12)
    if (!allowed) return rateLimitExceededResponse(corsHeaders)

    const { orderId, scheduledStartAt, timezone, note } = parsed.data
    const reason = parsed.data.reason ?? 'OTHER'
    const scheduledError = validateScheduledStartAt(scheduledStartAt)
    if (scheduledError) return jsonResponse({ code: 'INVALID_CALL_TIME', error: scheduledError, recommendedStartAt: recommendedStartAt() }, 400, corsHeaders)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, reference, order_kind, stage, customer_id, tailor_id, special_note')
      .eq('id', orderId)
      .single()

    if (orderError) {
      log('error', FN, 'order.lookup_failed', { actor_id: caller.id, order_id: orderId, error: orderError.message })
      return jsonError(corsHeaders, 500, 'ORDER_LOOKUP_FAILED', 'Could not check this order right now.')
    }

    if (!order) return jsonError(corsHeaders, 404, 'ORDER_NOT_FOUND', 'That order could not be found anymore.')
    const actorRole = actorRoleForOrder(caller.id, order)
    if (!actorRole) return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only people on this order can schedule a Drapeon call.')
    if (order.stage === 'CONSULTATION') {
      return jsonError(corsHeaders, 409, 'CONSULTATION_CALL_REQUIRED', 'Use the scheduled consultation on this order. Regular order calls are unavailable until the consultation is complete.')
    }
    if (order.stage === 'PENDING_QUOTE') {
      return jsonError(corsHeaders, 409, 'QUOTE_REQUIRED_FOR_ORDER_CALL', 'Keep using Messages while the tailor reviews the brief. Regular scheduled calls unlock after the quote is sent.')
    }
    if (!ORDER_CALL_STAGES.includes(order.stage as typeof ORDER_CALL_STAGES[number])) {
      return jsonError(corsHeaders, 409, 'ORDER_CALL_NOT_READY', 'Regular scheduled calls are unavailable for this order right now. Keep the conversation in Messages.')
    }

    if (note?.trim()) {
      const contactBlock = await rejectIfBlockedContact({
        supabase,
        fn: FN,
        cors: corsHeaders as Record<string, string>,
        actorId: caller.id,
        actorRole,
        surface: 'order_call_note',
        text: note,
        message: 'Your note contains contact information not allowed outside Drapeon. Remove any phone numbers, handles, or links.',
        orderId,
      })
      if (contactBlock) return contactBlock
    }

    const supportMeta = parseOrderSupportMeta(order.special_note)
    const now = new Date().toISOString()
    const nextOrderCall = {
      ...(supportMeta.orderCall ?? {}),
      status: 'SCHEDULED' as const,
      requestedBy: actorRole,
      reason,
      note: note?.trim() || null,
      requestedAt: now,
      scheduledStartAt,
      scheduledEndAt: scheduledEndAt(scheduledStartAt),
      timezone: timezone?.trim() || null,
      reminderEnabled: true,
      reminder30SentAt: null,
      reminder10SentAt: null,
      reminder5SentAt: null,
      reminderStartSentAt: null,
      completedAt: null,
      expiredAt: null,
    }

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        special_note: serializeOrderSupportMeta({
          ...supportMeta,
          orderCall: nextOrderCall,
        }),
      })
      .eq('id', orderId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      log('error', FN, 'order.update_failed', { actor_id: caller.id, order_id: orderId, error: updateError.message })
      return jsonError(corsHeaders, 500, 'ORDER_CALL_SAVE_FAILED', 'Could not schedule this call right now.')
    }
    if (!updated?.id) {
      return jsonError(corsHeaders, 409, 'ORDER_CHANGED', 'This order changed while you were scheduling the call. Refresh and try again.')
    }

    const startCopy = formatExplicitZonedDateTime(scheduledStartAt, timezone)
    const messageBody = `Drapeon order call scheduled for ${startCopy} about ${reasonLabel(reason)}. This call is free and stays inside Drapeon; keep final decisions in this thread.${note?.trim() ? ` Note: ${note.trim()}` : ''}`

    await Promise.allSettled([
      supabase.from('messages').insert({
        order_id: orderId,
        sender_id: caller.id,
        sender_role: actorRole,
        sender_name: actorRole === 'CUSTOMER' ? 'Customer' : 'Tailor',
        type: 'TEXT',
        body: messageBody,
      }),
      supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: messageBody,
      }),
      audit(supabase, {
        event: 'order_call.scheduled',
        actor_id: caller.id,
        actor_role: actorRole,
        order_id: orderId,
        payload: { function: FN, reason, scheduled_start_at: scheduledStartAt },
      }),
    ])

    const counterpartId = counterpartIdFor(actorRole, order)
    if (counterpartId) {
      await Promise.allSettled([
        enqueuePushJob(supabase, {
          userId: counterpartId,
          source: FN,
          orderId,
          idempotencyKey: `order-call-scheduled:${orderId}:${scheduledStartAt}:${counterpartId}`,
          priority: 10,
          notification: {
            title: 'Drapeon order call scheduled',
            body: `An order call was scheduled for ${startCopy}. Open Messages for details.`,
            preferenceKey: 'messages',
            data: { orderId, target: 'messages' },
          },
        }),
        enqueueSmsJob(supabase, {
          userId: counterpartId,
          audience: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
          source: FN,
          orderId,
          event: 'order_call_scheduled',
          idempotencyKey: `order-call-scheduled:${orderId}:${scheduledStartAt}:${counterpartId}`,
          priority: 10,
          body: `Drapeon: order call scheduled for ${startCopy}. Open Messages for details.`,
        }),
        enqueueOrderEventEmailJob(supabase, {
          order,
          recipientUserId: counterpartId,
          audience: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
          subject: 'Drapeon order call scheduled',
          headline: 'Your order call is on the calendar',
          body: `${messageBody} Drapeon will remind you again 30, 10, and 5 minutes before the call and when it starts.`,
          ctaLabel: 'Open order messages',
          source: FN,
          idempotencyKey: `order-call-scheduled:${orderId}:${scheduledStartAt}:${counterpartId}:email`,
          priority: 10,
        }),
      ])
    }

    await enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: caller.id,
      audience: actorRole,
      subject: 'Drapeon order call scheduled',
      headline: 'Your order call is scheduled',
      body: `${messageBody} Drapeon will remind you again 30, 10, and 5 minutes before the call and when it starts.`,
      ctaLabel: 'Open order messages',
      source: FN,
      idempotencyKey: `order-call-scheduled:${orderId}:${scheduledStartAt}:${caller.id}:email`,
      priority: 10,
    })

    return jsonResponse({ ok: true, orderCall: nextOrderCall }, 200, corsHeaders)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(getCorsHeaders(req), 500, 'INTERNAL_ERROR', 'Could not schedule this Drapeon call right now.')
  }
})
