import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { notificationDestinationData } from '../../../packages/shared/src/notification-policy.ts'

const FN = 'consultation-attendance-resolution'
const Body = z.object({
  reviewId: uuid,
  decision: z.enum(['RESCHEDULE', 'CUSTOMER_REFUND', 'TAILOR_EARNING']),
  note: z.string().trim().min(12).max(1000),
  actorEmail: z.string().trim().email(),
  moneyDeskRequestId: uuid.optional(),
})

const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const parsed = parseBody(Body, await request.json().catch(() => null))
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)
  if (parsed.data.decision !== 'RESCHEDULE' && !parsed.data.moneyDeskRequestId) {
    return json({ ok: false, error: 'Money decisions require a Money Desk request.' }, 409, cors)
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const { data, error } = await supabase.rpc('resolve_consultation_attendance_review', {
    p_review_id: parsed.data.reviewId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
    p_actor_email: parsed.data.actorEmail,
    p_money_desk_request_id: parsed.data.moneyDeskRequestId ?? null,
  })
  if (error) {
    log('warn', FN, 'resolution_failed', { review_id: parsed.data.reviewId, decision: parsed.data.decision, error: error.message })
    return json({ ok: false, error: error.message }, 409, cors)
  }

  const result = data as { bookingId?: string; orderId?: string; customerId?: string; tailorId?: string; resolutionCode?: string }
  if (!result.orderId || !result.bookingId || !result.customerId || !result.tailorId) {
    return json({ ok: false, error: 'Attendance resolution returned an incomplete participant snapshot.' }, 500, cors)
  }
  const { data: order } = await supabase.from('orders').select('id,reference,customer_id,tailor_id,stage').eq('id', result.orderId).maybeSingle()
  const copy = parsed.data.decision === 'RESCHEDULE'
    ? {
        title: 'Order ready for a quote',
        body: 'Drapeon reviewed the call activity. The paid consultation is closed, the fee remains protected, and any make-up conversation is optional and free.',
        cta: 'View order',
      }
    : parsed.data.decision === 'CUSTOMER_REFUND'
      ? {
          title: 'Consultation refund approved',
          body: 'Drapeon approved a customer refund. Independent Money Desk approval and provider processing are now tracked in the order.',
          cta: 'View refund status',
        }
      : {
          title: 'Tailor attendance verified',
          body: 'Drapeon verified the tailor’s attendance. The consultation earning is now awaiting independent Money Desk approval and payout processing.',
          cta: 'View consultation outcome',
        }

  await Promise.allSettled([
    ...([result.customerId, result.tailorId] as const).map((userId) => enqueuePushJob(supabase, {
      userId,
      source: FN,
      orderId: result.orderId!,
      idempotencyKey: `${FN}:${result.bookingId}:${parsed.data.decision}:${userId}:push`,
      notification: {
        title: copy.title,
        body: copy.body,
        preferenceKey: 'orderUpdates',
        data: notificationDestinationData({ kind: 'ORDER', orderId: result.orderId! }),
      },
    })),
    enqueueOrderEventEmailJob(supabase, {
      order: order ?? { id: result.orderId }, recipientUserId: result.customerId, audience: 'CUSTOMER', source: FN,
      subject: copy.title, headline: copy.title, body: copy.body, ctaLabel: copy.cta,
      idempotencyKey: `${FN}:${result.bookingId}:${parsed.data.decision}:customer:email`, priority: 18,
    }),
    enqueueOrderEventEmailJob(supabase, {
      order: order ?? { id: result.orderId }, recipientUserId: result.tailorId, audience: 'TAILOR', source: FN,
      subject: copy.title, headline: copy.title, body: copy.body, ctaLabel: copy.cta,
      idempotencyKey: `${FN}:${result.bookingId}:${parsed.data.decision}:tailor:email`, priority: 18,
    }),
    audit(supabase, {
      event: 'consultation.attendance_resolved', actor_role: 'OPS', order_id: result.orderId,
      severity: 'warn', payload: { function: FN, review_id: parsed.data.reviewId, booking_id: result.bookingId, decision: parsed.data.decision, resolution_code: result.resolutionCode, money_desk_request_id: parsed.data.moneyDeskRequestId ?? null, actor_email: parsed.data.actorEmail },
    }),
  ])

  return json({ ok: true, result }, 200, cors)
})
