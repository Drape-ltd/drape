import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueBackgroundJob } from './jobs.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { Sentry } from './sentry.ts'

type DispatchRun = {
  id: string
  order_id: string
  method: string
  status: string
  funding_status: string
  captured_allowance_amount: number
  customer_funded_allowance_amount: number
  drapeon_subsidy_amount: number
  actual_provider_cost_amount: number | null
  allowance_applied_amount: number
  shortfall_subtotal_amount: number
  shortfall_tax_amount: number
  shortfall_fee_amount: number
  shortfall_total_amount: number
  unused_allowance_amount: number
  customer_refund_amount: number
  customer_refund_tax_amount: number
  customer_refund_status: string
  subsidy_restored_amount: number
  provider_payment_id: string | null
  shortfall_paid_at: string | null
  customer_decision: string | null
  correlation_id: string
}

export async function enqueueDispatchReconciliation(
  supabase: SupabaseClient,
  input: { runId: string; orderId: string; sourceId: string },
) {
  return await enqueueBackgroundJob(supabase, {
    jobType: 'RECONCILE_DISPATCH_RUN',
    eventType: 'dispatch.reconciliation_requested',
    aggregateType: 'order_fulfillment_run',
    aggregateId: input.runId,
    orderId: input.orderId,
    actorRole: 'SYSTEM',
    idempotencyKey: `dispatch-reconciliation-request:${input.runId}:${input.sourceId}`,
    payload: { runId: input.runId, sourceId: input.sourceId },
    priority: 25,
    maxAttempts: 8,
  })
}

function reconciliationMismatch(run: DispatchRun) {
  if (run.method === 'LOCAL_COLLECTION' && run.customer_decision === 'SWITCH_TO_PICKUP') {
    const expectedRefund = run.customer_funded_allowance_amount
    if (run.customer_refund_amount !== expectedRefund || run.subsidy_restored_amount !== run.drapeon_subsidy_amount) {
      return 'The pickup conversion does not return the complete customer-funded allowance and Drapeon subsidy.'
    }
    return null
  }

  if (run.actual_provider_cost_amount == null) return 'The terminal delivery has no authoritative provider cost.'
  const expectedAllowanceApplied = Math.min(run.actual_provider_cost_amount, run.captured_allowance_amount)
  const expectedShortfall = Math.max(run.actual_provider_cost_amount - run.captured_allowance_amount, 0)
  const expectedUnused = Math.max(run.captured_allowance_amount - run.actual_provider_cost_amount, 0)
  if (run.allowance_applied_amount !== expectedAllowanceApplied) return 'The provider cost and applied delivery allowance do not balance.'
  if (run.shortfall_subtotal_amount !== expectedShortfall) return 'The provider cost and customer delivery shortfall do not balance.'
  if (run.shortfall_total_amount !== run.shortfall_subtotal_amount + run.shortfall_tax_amount + run.shortfall_fee_amount) {
    return 'The delivery shortfall subtotal, tax, and fee do not equal the charged total.'
  }
  if (run.unused_allowance_amount !== expectedUnused) return 'The unused delivery allowance does not match the provider cost.'
  if (run.customer_refund_amount > run.customer_funded_allowance_amount || run.subsidy_restored_amount > run.drapeon_subsidy_amount) {
    return 'The delivery refund or subsidy restoration exceeds its funded source.'
  }
  return null
}

export async function reconcileDispatchRunIfReady(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase.from('order_fulfillment_runs')
    .select('id,order_id,method,status,funding_status,captured_allowance_amount,customer_funded_allowance_amount,drapeon_subsidy_amount,actual_provider_cost_amount,allowance_applied_amount,shortfall_subtotal_amount,shortfall_tax_amount,shortfall_fee_amount,shortfall_total_amount,unused_allowance_amount,customer_refund_amount,customer_refund_tax_amount,customer_refund_status,subsidy_restored_amount,provider_payment_id,shortfall_paid_at,customer_decision,correlation_id')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('The fulfillment run was not found.')
  const run = data as DispatchRun
  if (run.status === 'RECONCILED') return { reconciled: true, existing: true }
  // Cancellation is a recovery state, not financial completion. It must first
  // become a rebooked delivery or a pickup with its refund completed.
  if (!['DELIVERED', 'PICKED_UP'].includes(run.status)) {
    return { reconciled: false, reason: 'HANDOFF_NOT_TERMINAL' }
  }
  const refundDue = run.customer_refund_amount + run.customer_refund_tax_amount > 0
  if ((refundDue && run.customer_refund_status !== 'SUCCEEDED') || (!refundDue && run.customer_refund_status !== 'NOT_REQUIRED')) {
    return { reconciled: false, reason: 'REFUND_NOT_TERMINAL' }
  }
  if (run.shortfall_total_amount > 0 && (!run.provider_payment_id || !run.shortfall_paid_at)) {
    return { reconciled: false, reason: 'SHORTFALL_NOT_TERMINAL' }
  }

  const mismatch = reconciliationMismatch(run)
  if (mismatch) {
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'FULFILLMENT_RECONCILIATION_FAILED',
      severity: 'HIGH',
      source: 'drapeon-dispatch-reconciliation',
      actorRole: 'SYSTEM',
      orderId: run.order_id,
      relatedEntityType: 'ORDER_FULFILLMENT_RUN',
      relatedEntityId: run.id,
      title: 'Drapeon Dispatch reconciliation needs attention',
      description: mismatch,
      recommendedAction: 'Compare the accepted allowance, provider quote, shortfall payment, refund, and terminal handoff evidence. Correct the conflicting record; never create a second charge or refund.',
      dedupeKey: `dispatch-reconciliation:${run.id}`,
      metadata: { run_id: run.id, correlation_id: run.correlation_id, reason: mismatch },
    })
    await Sentry.captureMessage('Drapeon Dispatch reconciliation invariant failed', {
      level: 'error',
      tags: { component: 'drapeon-dispatch', operation: 'reconciliation' },
      extra: { order_id: run.order_id, run_id: run.id, correlation_id: run.correlation_id, reason: mismatch },
    })
    throw new Error(mismatch)
  }

  const now = new Date().toISOString()
  const { data: result, error: eventError } = await supabase.rpc('record_order_fulfillment_event', {
    p_order_id: run.order_id,
    p_parcel_number: 1,
    p_event_type: 'RECONCILED',
    p_source: 'SYSTEM',
    p_actor_id: null,
    p_actor_role: 'SYSTEM',
    p_provider_event_id: null,
    p_idempotency_key: `dispatch-reconciled:${run.id}`,
    p_provider_name: null,
    p_service_level: null,
    p_provider_reference: null,
    p_tracking_number: null,
    p_tracking_url: null,
    p_contact_name: null,
    p_contact_phone: null,
    p_customer_note: 'Delivery cost, customer funding, refund, and handoff evidence are balanced.',
    p_internal_note: null,
    p_evidence_media: [],
    p_location: null,
    p_eta_at: null,
    p_eta_timezone: null,
    p_occurred_at: now,
    p_payload: {
      correlationId: run.correlation_id,
      providerCostAmount: run.actual_provider_cost_amount,
      allowanceAppliedAmount: run.allowance_applied_amount,
      shortfallTotalAmount: run.shortfall_total_amount,
      customerRefundAmount: run.customer_refund_amount,
      customerRefundTaxAmount: run.customer_refund_tax_amount,
      subsidyRestoredAmount: run.subsidy_restored_amount,
    },
  })
  if (eventError) throw new Error(eventError.message)
  return { reconciled: true, existing: false, result }
}
