import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { parseOrderSupportMeta, serializeOrderSupportMeta } from '../_shared/order-support.ts'
import { partiallyRefundOrderPayments, refundSettledOrderPayments } from '../_shared/payment-refunds.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { deriveConsultationCancellation } from '../../../packages/shared/src/consultations.ts'
import { notificationDestinationData } from '../../../packages/shared/src/notification-policy.ts'

const FN = 'consultation-lifecycle-action'
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
const Body = z.object({ action: z.literal('cancel'), bookingId: uuid, reason: z.string().trim().min(2).max(500), idempotencyKey: z.string().trim().min(8).max(160) })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)
  const caller = await getAuthUser(request)
  if (!caller) return json({ error: 'Sign in again before changing this consultation.' }, 401, cors)
  const parsed = parseBody(Body, await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, 400, cors)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

  const { data: booking, error: bookingError } = await supabase.from('consultation_bookings')
    .select('id,order_id,customer_id,tailor_id,status,scheduled_start_at,scheduled_end_at,fee_mode,fee_amount,fee_currency,fee_creditable,payment_status,settlement_status,commercial_correlation_id')
    .eq('id', parsed.data.bookingId).maybeSingle()
  if (bookingError) return json({ error: 'Consultation could not be loaded.' }, 500, cors)
  if (!booking) return json({ error: 'Consultation was not found.' }, 404, cors)
  const actorRole = booking.customer_id === caller.id ? 'CUSTOMER' : booking.tailor_id === caller.id ? 'TAILOR' : null
  if (!actorRole) return json({ error: 'You are not part of this consultation.' }, 403, cors)
  if (booking.status === 'CANCELLED') return json({ ok: true, existing: true, outcome: booking.settlement_status }, 200, cors)
  if (booking.status !== 'CONFIRMED') return json({ error: 'This consultation can no longer be cancelled.' }, 409, cors)

  const { data: attendance, error: attendanceError } = await supabase.rpc('refresh_consultation_attendance_evidence', { p_booking_id: booking.id })
  if (attendanceError) return json({ error: 'Call activity could not be checked. Try again before cancelling.' }, 503, cors)
  if (attendance?.derived_outcome === 'ATTENDED' || Number(attendance?.verified_overlap_seconds ?? 0) >= 300 || ['EARNED', 'RELEASE_PENDING', 'RELEASED'].includes(booking.settlement_status)) {
    return json({ error: 'Attendance is already verified, so this consultation can no longer be cancelled.', code: 'CONSULTATION_ALREADY_ATTENDED' }, 409, cors)
  }

  const decision = deriveConsultationCancellation({ actorRole, scheduledStartAt: booking.scheduled_start_at, feeAmount: booking.fee_amount ?? 0 })
  if (decision.requiresReview) return json({ error: 'The consultation time has started. Use attendance help so call activity and both accounts are reviewed before money moves.', code: 'ATTENDANCE_REVIEW_REQUIRED' }, 409, cors)

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id,reference,stage,special_note,customer_id,tailor_id')
    .eq('id', booking.order_id)
    .maybeSingle()
  if (orderError || !order) return json({ error: 'The order for this consultation could not be loaded.' }, 500, cors)
  const existingEvent = await supabase.from('consultation_commercial_events').select('id,payload').eq('booking_id', booking.id).eq('event_type', 'CANCELLATION_COMPLETED').contains('payload', { idempotencyKey: parsed.data.idempotencyKey }).maybeSingle()
  if (existingEvent.data?.id) return json({ ok: true, existing: true, outcome: decision.outcome }, 200, cors)
  await supabase.from('consultation_commercial_events').insert({ booking_id: booking.id, order_id: booking.order_id, event_type: 'CANCELLATION_REQUESTED', actor_id: caller.id, actor_role: actorRole, amount: booking.fee_amount, currency: booking.fee_currency, correlation_id: booking.commercial_correlation_id, payload: { idempotencyKey: parsed.data.idempotencyKey, reason: parsed.data.reason, decision } })

  let refundPending = false
  if (booking.fee_mode === 'PAID' && booking.payment_status === 'PAID' && decision.refundAmount > 0) {
    try {
      const result = decision.refundAmount === booking.fee_amount
        ? await refundSettledOrderPayments(supabase, { orderId: booking.order_id, reason: parsed.data.reason, actorId: caller.id, actorRole, allowedPhases: ['CONSULTATION'] })
        : await partiallyRefundOrderPayments(supabase, { orderId: booking.order_id, amount: decision.refundAmount, reason: parsed.data.reason, actorId: caller.id, actorRole, allowedPhases: ['CONSULTATION'] })
      refundPending = result.pendingAttempts.length > 0
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('error', FN, 'refund_failed', { booking_id: booking.id, order_id: booking.order_id, error: message })
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'REFUND_FAILED', severity: 'CRITICAL', source: FN, actorRole,
        orderId: booking.order_id, userId: caller.id, relatedEntityType: 'CONSULTATION_BOOKING', relatedEntityId: booking.id,
        title: 'Consultation cancellation refund failed',
        description: 'A consultation cancellation could not safely complete its provider refund.',
        recommendedAction: 'Review the original consultation payment and provider response. Do not create a duplicate refund.',
        dedupeKey: `consultation-cancellation-refund:${booking.id}`,
        metadata: { error: message, decision, idempotency_key: parsed.data.idempotencyKey },
      })
      return json({ error: 'The consultation was not cancelled because its refund could not be completed safely. Drapeon Ops has the failure record.', code: 'REFUND_FAILED' }, 409, cors)
    }
  }

  const settlementStatus = refundPending
    ? 'REFUND_PENDING'
    : decision.tailorEarnedAmount > 0 ? 'EARNED' : decision.refundAmount > 0 ? 'REFUNDED' : 'NOT_REQUIRED'
  const now = new Date().toISOString()
  const meta = parseOrderSupportMeta(order?.special_note ?? null)
  const nextMeta = { ...meta, consultation: meta.consultation ? { ...meta.consultation, status: 'DECLINED' as const, declinedAt: now, declinedBy: caller.id, declineReason: parsed.data.reason } : meta.consultation }
  const [bookingUpdate, orderUpdate] = await Promise.all([
    supabase.from('consultation_bookings').update({ status: 'CANCELLED', cancelled_at: now, cancelled_by: caller.id, cancellation_reason: parsed.data.reason, payment_status: refundPending ? booking.payment_status : decision.refundAmount === booking.fee_amount ? 'REFUNDED' : decision.refundAmount > 0 ? 'PARTIALLY_REFUNDED' : booking.payment_status, settlement_status: settlementStatus, settlement_outcome: decision.outcome, earned_amount: decision.tailorEarnedAmount, refunded_amount: decision.refundAmount, settlement_eligible_at: decision.tailorEarnedAmount > 0 && !refundPending ? now : null, settled_at: decision.tailorEarnedAmount === 0 && !refundPending ? now : null }).eq('id', booking.id).eq('status', 'CONFIRMED'),
    supabase.from('orders').update({ stage: 'PENDING_QUOTE', special_note: serializeOrderSupportMeta(nextMeta), video_call_url: null, updated_at: now }).eq('id', booking.order_id).eq('stage', 'CONSULTATION'),
  ])
  if (bookingUpdate.error || orderUpdate.error) {
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'ESCROW_STUCK', severity: 'CRITICAL', source: FN, actorRole,
      orderId: booking.order_id, userId: caller.id, relatedEntityType: 'CONSULTATION_BOOKING', relatedEntityId: booking.id,
      title: 'Consultation refund state needs reconciliation',
      description: 'The provider refund was recorded but Drapeon could not finish the matching consultation and order transition.',
      recommendedAction: 'Reconcile the provider refund, booking settlement, and order stage. Do not retry the refund.',
      dedupeKey: `consultation-cancellation-state:${booking.id}`,
      metadata: { booking_error: bookingUpdate.error?.message ?? null, order_error: orderUpdate.error?.message ?? null, decision },
    })
    return json({ error: 'The refund was recorded, but the consultation state needs Ops reconciliation. Do not retry payment actions.', code: 'STATE_RECONCILIATION_REQUIRED' }, 500, cors)
  }
  await supabase.from('consultation_commercial_events').insert({ booking_id: booking.id, order_id: booking.order_id, event_type: refundPending ? 'REFUND_PENDING' : 'CANCELLATION_COMPLETED', actor_id: caller.id, actor_role: actorRole, amount: booking.fee_amount, currency: booking.fee_currency, correlation_id: booking.commercial_correlation_id, payload: { idempotencyKey: parsed.data.idempotencyKey, reason: parsed.data.reason, outcome: decision.outcome, refundAmount: decision.refundAmount, tailorEarnedAmount: decision.tailorEarnedAmount } })

  const counterpartId = actorRole === 'CUSTOMER' ? booking.tailor_id : booking.customer_id
  const refundCopy = decision.refundAmount > 0 ? `${booking.fee_currency} ${(decision.refundAmount / 100).toFixed(2)} is ${refundPending ? 'processing back to the customer' : 'being returned to the customer'}.` : ''
  const earnedCopy = decision.tailorEarnedAmount > 0 ? `${booking.fee_currency} ${(decision.tailorEarnedAmount / 100).toFixed(2)} remains earned under the late-cancellation policy.` : ''
  const body = `The consultation was cancelled. The order stays open for a quote. ${refundCopy} ${earnedCopy}`.trim()
  await Promise.allSettled([
    enqueuePushJob(supabase, { userId: counterpartId, orderId: booking.order_id, source: FN, idempotencyKey: `${FN}:push:${booking.id}:${parsed.data.idempotencyKey}`, priority: 10, notification: { title: 'Consultation cancelled', body, preferenceKey: 'orderUpdates', data: notificationDestinationData({ kind: 'ORDER', orderId: booking.order_id }) } }),
    enqueueOrderEventEmailJob(supabase, { recipientUserId: counterpartId, audience: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER', order: order ?? { id: booking.order_id }, subject: 'Consultation cancelled', headline: 'Consultation cancelled', body, ctaLabel: 'View order', source: FN, priority: 10, idempotencyKey: `${FN}:email:${booking.id}:${parsed.data.idempotencyKey}` }),
    audit(supabase, { event: 'consultation.cancelled', actor_id: caller.id, actor_role: actorRole, order_id: booking.order_id, payload: { function: FN, booking_id: booking.id, decision, refund_pending: refundPending } }),
  ])

  if (decision.tailorEarnedAmount > 0 && !refundPending) {
    EdgeRuntime.waitUntil(supabase.functions.invoke('release-consultation-earning', { body: { bookingId: booking.id } }))
  }
  return json({ ok: true, outcome: decision.outcome, refundAmount: decision.refundAmount, tailorEarnedAmount: decision.tailorEarnedAmount, currency: booking.fee_currency, refundPending, orderStage: 'PENDING_QUOTE' }, 200, cors)
})
