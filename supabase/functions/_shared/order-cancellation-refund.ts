import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'

export type OrderCancellationRefundContext = {
  kind: 'ORDER_CANCELLATION'
  moneyDeskRequestId: string
  disputeId: string
}

export function readOrderCancellationRefundContext(value: unknown): OrderCancellationRefundContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const context = value as Record<string, unknown>
  return context.kind === 'ORDER_CANCELLATION'
    && typeof context.moneyDeskRequestId === 'string'
    && typeof context.disputeId === 'string'
    ? { kind: 'ORDER_CANCELLATION', moneyDeskRequestId: context.moneyDeskRequestId, disputeId: context.disputeId }
    : null
}

function resultObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function finalizeOrderCancellationRefund(
  supabase: SupabaseClient,
  input: {
    context: OrderCancellationRefundContext
    orderId: string
    providerReference?: string | null
    actorEmail?: string | null
    actorRole?: string | null
    source: string
  },
) {
  const { data, error } = await supabase.rpc('finalize_ops_order_cancellation_refund', {
    p_money_desk_request_id: input.context.moneyDeskRequestId,
    p_dispute_id: input.context.disputeId,
    p_provider_reference: input.providerReference ?? null,
    p_actor_email: input.actorEmail ?? null,
    p_actor_role: input.actorRole ?? 'SYSTEM',
  })
  if (error) throw error
  const outcome = resultObject(data)
  if (outcome.status !== 'SUCCEEDED') return { completed: false, outcome }

  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id,reference,customer_id,tailor_id')
    .eq('id', input.orderId)
    .maybeSingle()
  if (orderError) throw orderError
  if (!order?.id) throw new Error('Refunded cancellation order was not found for notification delivery.')

  const title = 'Your order cancellation refund is complete'
  const body = 'Every captured payment that had not been released has been refunded to the original payment method. Provider timing may vary.'
  for (const recipient of [
    { id: order.customer_id, audience: 'CUSTOMER' as const },
    { id: order.tailor_id, audience: 'TAILOR' as const },
  ]) {
    if (!recipient.id) continue
    const idempotencyKey = `order-cancellation-refund:${input.context.moneyDeskRequestId}:${recipient.audience}`
    await enqueuePushJob(supabase, {
      userId: recipient.id,
      notification: {
        title,
        body,
        preferenceKey: 'orderUpdates',
        data: { orderId: order.id, type: 'order_cancellation_refund_completed' },
      },
      source: input.source,
      idempotencyKey: `${idempotencyKey}:push`,
      orderId: order.id,
      priority: 20,
    })
    await enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: recipient.id,
      audience: recipient.audience,
      subject: title,
      headline: title,
      body,
      ctaLabel: 'View refunded order',
      source: input.source,
      idempotencyKey: `${idempotencyKey}:email`,
      priority: 20,
    })
  }
  return { completed: true, outcome }
}

export async function failOrderCancellationRefund(
  supabase: SupabaseClient,
  input: {
    context: OrderCancellationRefundContext
    orderId: string
    providerReference?: string | null
    failureCode: string
    failureSummary: string
    source: string
  },
) {
  const { data: attempt } = await supabase.from('money_desk_execution_attempts')
    .select('id')
    .eq('request_id', input.context.moneyDeskRequestId)
    .eq('status', 'PROCESSING')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (attempt?.id) {
    const { error } = await supabase.rpc('complete_money_desk_execution', {
      p_attempt_id: attempt.id,
      p_status: 'FAILED',
      p_provider_reference: input.providerReference ?? null,
      p_failure_code: input.failureCode,
      p_failure_summary: input.failureSummary.slice(0, 500),
    })
    if (error) throw error
  }
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'REFUND_FAILED',
    severity: 'CRITICAL',
    source: input.source,
    actorRole: 'SYSTEM',
    orderId: input.orderId,
    title: 'Approved cancellation refund failed',
    description: 'A provider did not complete one of the payments in an independently approved cancellation refund.',
    recommendedAction: 'Review the failed provider refund and the immutable Money Desk payment claims. Do not retry payments that already reached provider success.',
    dedupeKey: `order-cancellation-refund-failed:${input.context.moneyDeskRequestId}`,
    relatedEntityType: 'money_desk_request',
    relatedEntityId: input.context.moneyDeskRequestId,
    notifyOps: true,
    metadata: {
      money_desk_request_id: input.context.moneyDeskRequestId,
      dispute_id: input.context.disputeId,
      provider_reference: input.providerReference ?? null,
      failure_code: input.failureCode,
    },
  })
}
