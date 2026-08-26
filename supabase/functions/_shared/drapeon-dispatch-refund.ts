import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { partiallyRefundOrderPayments, type ExactRefundRestoration } from './payment-refunds.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { Sentry } from './sentry.ts'
import { enqueueBackgroundJob } from './jobs.ts'
import { enqueueDispatchReconciliation } from './drapeon-dispatch-reconciliation.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from './side-effect-jobs.ts'

type FulfillmentRun = {
  id: string
  order_id: string
  customer_refund_amount: number
  customer_refund_tax_amount: number
  customer_refund_status: string
  currency: string
  correlation_id: string
}

function restorationFor(run: FulfillmentRun): ExactRefundRestoration {
  return {
    refundResolutionId: `dispatch-refund:${run.id}`,
    tailorWorkAmount: 0,
    platformFeeAmount: 0,
    taxAmount: run.customer_refund_tax_amount,
    fulfillmentAmount: run.customer_refund_amount,
    consultationAmount: 0,
    promotionAmount: 0,
    drapeonFundedAmount: 0,
  }
}

async function notifyDispatchRefund(
  supabase: SupabaseClient,
  input: { orderId: string; runId: string; succeeded: boolean; amount?: number; currency?: string },
) {
  const { data: order, error } = await supabase.from('orders')
    .select('id,reference,customer_id,tailor_id,stage,currency,total_amount,garment_type,delivery_method')
    .eq('id', input.orderId)
    .maybeSingle()
  if (error) throw error
  if (!order?.id || !order.customer_id) return
  const amountLabel = input.amount != null && input.currency
    ? `${input.currency} ${(input.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'the unused delivery amount'
  const title = input.succeeded ? 'Delivery refund completed' : 'Delivery refund needs attention'
  const body = input.succeeded
    ? `${amountLabel} for order ${order.reference} has reached a confirmed refund outcome. Your order remains available in Drapeon.`
    : `${amountLabel} for order ${order.reference} is still protected. Drapeon is checking the provider outcome; do not submit another payment or refund request.`
  const source = 'drapeon-dispatch-refund'
  const terminal = input.succeeded ? 'succeeded' : 'failed'
  await Promise.all([
    enqueuePushJob(supabase, {
      userId: order.customer_id,
      orderId: order.id,
      source,
      idempotencyKey: `dispatch-refund:${input.runId}:${terminal}:customer:push`,
      priority: input.succeeded ? 40 : 10,
      notification: {
        title,
        body,
        preferenceKey: 'orderUpdates',
        interruptionLevel: input.succeeded ? 'active' : 'time-sensitive',
        data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' },
      },
    }),
    enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: 'CUSTOMER',
      subject: title,
      headline: title,
      body,
      ctaLabel: 'View delivery status',
      action: input.succeeded ? 'REFUND_COMPLETED' : 'REFUND_REVIEW',
      source,
      idempotencyKey: `dispatch-refund:${input.runId}:${terminal}:customer:email`,
      priority: input.succeeded ? 40 : 10,
    }),
    ...(!input.succeeded
      ? [enqueueSmsJob(supabase, {
          userId: order.customer_id,
          audience: 'CUSTOMER',
          event: 'DISPATCH_REFUND_REVIEW',
          body,
          source,
          orderId: order.id,
          idempotencyKey: `dispatch-refund:${input.runId}:${terminal}:customer:sms`,
          priority: 10,
        })]
      : []),
  ])
}

export async function enqueueDispatchRefundIfDue(
  supabase: SupabaseClient,
  input: { runId: string; orderId: string; actorId?: string | null; actorRole?: string },
) {
  const { data, error } = await supabase.from('order_fulfillment_runs')
    .select('id,customer_refund_amount,customer_refund_tax_amount,customer_refund_status')
    .eq('id', input.runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('The fulfillment run was not found.')
  const refundTotal = Number(data.customer_refund_amount ?? 0) + Number(data.customer_refund_tax_amount ?? 0)
  if (refundTotal <= 0 || !['QUEUED', 'FAILED'].includes(String(data.customer_refund_status))) {
    return { queued: false, refundTotal }
  }
  await enqueueBackgroundJob(supabase, {
    jobType: 'PROCESS_DISPATCH_REFUND',
    eventType: 'dispatch.refund_requested',
    aggregateType: 'order_fulfillment_run',
    aggregateId: input.runId,
    orderId: input.orderId,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? 'SYSTEM',
    idempotencyKey: `dispatch-refund:${input.runId}:${refundTotal}`,
    payload: { runId: input.runId, refundTotal },
    priority: 10,
    maxAttempts: 8,
  })
  return { queued: true, refundTotal }
}

export async function markDispatchRefundTerminal(
  supabase: SupabaseClient,
  input: { resolutionId: string | null; succeeded: boolean; providerReference?: string | null },
) {
  if (!input.resolutionId?.startsWith('dispatch-refund:')) return false
  const runId = input.resolutionId.slice('dispatch-refund:'.length)
  if (!runId) return false
  const now = new Date().toISOString()
  const { data: run, error } = await supabase.from('order_fulfillment_runs')
    .update({
      customer_refund_status: input.succeeded ? 'SUCCEEDED' : 'FAILED',
      customer_refunded_at: input.succeeded ? now : null,
      funding_status: input.succeeded ? 'READY_TO_RECONCILE' : 'EXCEPTION',
      updated_at: now,
    })
    .eq('id', runId)
    .select('id,order_id,correlation_id,customer_refund_amount,customer_refund_tax_amount,currency')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!run?.id) return false
  if (!input.succeeded) return true

  const { error: eventError } = await supabase.from('order_fulfillment_events').upsert({
    run_id: run.id,
    order_id: run.order_id,
    event_type: 'REFUND_COMPLETED',
    source: 'SYSTEM',
    actor_role: 'SYSTEM',
    idempotency_key: `dispatch-refund-completed:${run.id}`,
    customer_note: 'The unused delivery amount has been returned to the customer.',
    occurred_at: now,
    correlation_id: run.correlation_id,
    payload: { providerReference: input.providerReference ?? null },
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
  if (eventError) throw new Error(eventError.message)
  await notifyDispatchRefund(supabase, {
    orderId: run.order_id,
    runId: run.id,
    succeeded: true,
    amount: Number(run.customer_refund_amount ?? 0) + Number(run.customer_refund_tax_amount ?? 0),
    currency: String(run.currency),
  })
  await enqueueDispatchReconciliation(supabase, {
    runId: run.id,
    orderId: run.order_id,
    sourceId: `refund:${input.providerReference ?? 'terminal'}`,
  })
  return true
}

export async function processDispatchRefund(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase.from('order_fulfillment_runs')
    .select('id,order_id,customer_refund_amount,customer_refund_tax_amount,customer_refund_status,currency,correlation_id')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('The fulfillment run was not found.')
  const run = data as FulfillmentRun
  const amount = run.customer_refund_amount + run.customer_refund_tax_amount
  if (amount <= 0 || run.customer_refund_status === 'SUCCEEDED') {
    return { ok: true, skipped: true, reason: amount <= 0 ? 'NO_REFUND_DUE' : 'ALREADY_REFUNDED' }
  }

  await supabase.from('order_fulfillment_runs').update({
    customer_refund_status: 'PROCESSING',
    updated_at: new Date().toISOString(),
  }).eq('id', run.id)

  try {
    const result = await partiallyRefundOrderPayments(supabase, {
      orderId: run.order_id,
      amount,
      reason: 'Automatic Drapeon Dispatch reconciliation for unused customer-funded fulfillment.',
      actorRole: 'SYSTEM',
      allowedPhases: ['INITIAL_ORDER'],
      exactRestoration: restorationFor(run),
    })
    const pending = result.pendingAttempts.length > 0
    if (pending) {
      await supabase.from('order_fulfillment_runs').update({
        customer_refund_status: 'PENDING',
        funding_status: 'REFUND_PENDING',
        updated_at: new Date().toISOString(),
      }).eq('id', run.id)
    } else {
      await markDispatchRefundTerminal(supabase, {
        resolutionId: `dispatch-refund:${run.id}`,
        succeeded: true,
        providerReference: result.refundedAttempts[0]?.providerPaymentId ?? null,
      })
    }
    return { ok: true, pending, amount, currency: run.currency }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await supabase.from('order_fulfillment_runs').update({
      customer_refund_status: 'FAILED',
      funding_status: 'EXCEPTION',
      updated_at: new Date().toISOString(),
    }).eq('id', run.id)
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'REFUND_FAILED',
      severity: 'HIGH',
      source: 'drapeon-dispatch-refund',
      actorRole: 'SYSTEM',
      orderId: run.order_id,
      relatedEntityType: 'ORDER_FULFILLMENT_RUN',
      relatedEntityId: run.id,
      title: 'Delivery reconciliation refund needs attention',
      description: 'The automatic unused-delivery refund did not reach a safe provider outcome.',
      recommendedAction: 'Inspect the fulfillment run, original payment, provider attempt, and exact restoration. Retry the same job only; do not create a second refund.',
      dedupeKey: `dispatch-refund-failed:${run.id}`,
      metadata: { run_id: run.id, refund_amount: amount, currency: run.currency, correlation_id: run.correlation_id, error: message },
    })
    await Sentry.captureMessage('Automatic Drapeon Dispatch refund failed', {
      level: 'error',
      tags: { component: 'drapeon-dispatch', operation: 'automatic-refund' },
      extra: { order_id: run.order_id, run_id: run.id, correlation_id: run.correlation_id, refund_amount: amount, error: message },
    })
    await notifyDispatchRefund(supabase, {
      orderId: run.order_id,
      runId: run.id,
      succeeded: false,
      amount,
      currency: run.currency,
    })
    throw cause
  }
}
