import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { Sentry } from '../_shared/sentry.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { createStripeTransferReversal } from '../_shared/stripe.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'reverse-stripe-transfer'
const BodySchema = z.object({ moneyDeskRequestId: uuid })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let requestId: string | null = null
  let payoutId: string | null = null
  let orderId: string | null = null
  let providerReversalId: string | null = null
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)
    requestId = parsed.data.moneyDeskRequestId
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: moneyRequest, error: requestError } = await supabase.from('money_desk_requests')
      .select('id,status,action_type,target_type,target_id,order_id,amount,currency,reason,action_payload,correlation_id')
      .eq('id', requestId).maybeSingle()
    if (requestError) throw requestError
    if (!moneyRequest?.id || moneyRequest.status !== 'APPROVED' || moneyRequest.action_type !== 'POST_RELEASE_RECOVERY' || moneyRequest.target_type !== 'STRIPE_TRANSFER_REVERSAL') {
      return json({ ok: false, error: 'This transfer reversal is not backed by an approved Money Desk request.' }, 409, cors)
    }
    const actionPayload = moneyRequest.action_payload && typeof moneyRequest.action_payload === 'object' && !Array.isArray(moneyRequest.action_payload)
      ? moneyRequest.action_payload as Record<string, unknown>
      : {}
    const requestedPayoutId = typeof actionPayload.payoutId === 'string' ? actionPayload.payoutId : moneyRequest.target_id
    const reasonCode = typeof actionPayload.reasonCode === 'string' && actionPayload.reasonCode.trim()
      ? actionPayload.reasonCode.trim().toUpperCase()
      : 'REVIEWED_POST_RELEASE_RECOVERY'
    const { data: payout, error: payoutError } = await supabase.from('payouts')
      .select('id,order_id,tailor_profile_id,amount,currency,provider,status,provider_payout_id,provider_transfer_status,settlement_tranche_id,source_payment_id')
      .eq('id', requestedPayoutId).maybeSingle()
    if (payoutError) throw payoutError
    if (!payout?.id || payout.provider !== 'STRIPE' || !payout.provider_payout_id) {
      return json({ ok: false, error: 'The approved request is not linked to a reversible Stripe transfer.' }, 409, cors)
    }
    payoutId = payout.id
    orderId = payout.order_id ?? moneyRequest.order_id ?? null
    const amount = moneyRequest.amount
    if (!Number.isInteger(amount) || amount <= 0 || amount > payout.amount || moneyRequest.currency !== payout.currency) {
      return json({ ok: false, error: 'The approved reversal amount or currency no longer matches the payout snapshot.' }, 409, cors)
    }
    const { data: prior } = await supabase.from('provider_transfer_reversals')
      .select('id,status,provider_reversal_id').eq('money_desk_request_id', moneyRequest.id).maybeSingle()
    if (prior?.status === 'SUCCEEDED' && prior.provider_reversal_id) {
      return json({ ok: true, idempotent: true, providerReference: prior.provider_reversal_id }, 200, cors)
    }
    const { error: prepareError } = await supabase.from('provider_transfer_reversals').upsert({
      payout_id: payout.id,
      money_desk_request_id: moneyRequest.id,
      provider: 'STRIPE',
      provider_transfer_id: payout.provider_payout_id,
      amount,
      currency: payout.currency,
      reason_code: reasonCode,
      status: 'PROCESSING',
      correlation_id: moneyRequest.correlation_id,
      failure_code: null,
    }, { onConflict: 'money_desk_request_id' })
    if (prepareError) throw prepareError

    const reversal = await createStripeTransferReversal({
      transferId: payout.provider_payout_id,
      amount,
      idempotencyKey: `money-desk-transfer-reversal:${moneyRequest.id}`,
      metadata: {
        money_desk_request_id: moneyRequest.id,
        payout_id: payout.id,
        ...(orderId ? { order_id: orderId } : {}),
      },
    })
    providerReversalId = reversal.id

    const { data: ledgerId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
      p_idempotency_key: `stripe-transfer-reversal:${moneyRequest.id}`,
      p_transaction_kind: 'REVERSAL',
      p_purpose: 'POST_RELEASE_RECOVERY',
      p_order_id: orderId,
      p_payment_id: payout.source_payment_id,
      p_policy_version: 'commercial-money-v1',
      p_pricing_version: 1,
      p_correlation_id: moneyRequest.correlation_id,
      p_provider_reference: reversal.id,
      p_entries: [
        { accountCode: 'TAILOR_RELEASED', accountScope: orderId ?? payout.id, direction: 'DEBIT', amount, currency: payout.currency },
        { accountCode: 'TAILOR_ELIGIBLE', accountScope: orderId ?? payout.id, direction: 'CREDIT', amount, currency: payout.currency },
      ],
      p_metadata: { payout_id: payout.id, money_desk_request_id: moneyRequest.id, provider_transfer_id: payout.provider_payout_id, provider_reversal_id: reversal.id, reason_code: reasonCode },
      p_actor_role: 'OPS',
      p_original_currency: payout.currency,
      p_original_amount: amount,
      p_settlement_currency: payout.currency,
      p_settlement_amount: amount,
    })
    if (ledgerError) throw new Error(`Provider reversal succeeded but ledger reconciliation failed: ${ledgerError.message}`)

    const now = new Date().toISOString()
    const { error: reversalUpdateError } = await supabase.from('provider_transfer_reversals').update({
      status: 'SUCCEEDED',
      provider_reversal_id: reversal.id,
      provider_response: { id: reversal.id, amount: reversal.amount, currency: reversal.currency },
      completed_at: now,
    }).eq('money_desk_request_id', moneyRequest.id)
    if (reversalUpdateError) throw reversalUpdateError
    const fullReversal = amount === payout.amount
    const { error: payoutUpdateError } = await supabase.from('payouts').update({
      status: fullReversal ? 'REVERSED' : payout.status,
      provider_transfer_status: fullReversal ? 'REVERSED' : payout.provider_transfer_status,
      bank_settlement_status: fullReversal ? 'CANCELED' : 'UNKNOWN',
      bank_settlement_failed_at: fullReversal ? now : null,
      bank_settlement_failure_code: fullReversal ? 'CONTROLLED_TRANSFER_REVERSAL' : null,
      blocked_reason: 'POST_RELEASE_RECOVERY',
      failed_at: fullReversal ? now : null,
      processed_at: now,
    }).eq('id', payout.id)
    if (payoutUpdateError) throw payoutUpdateError
    if (payout.settlement_tranche_id) {
      await supabase.from('order_settlement_tranches').update({
        status: 'BLOCKED',
        blocked_reason: 'POST_RELEASE_RECOVERY',
        updated_at: now,
      }).eq('id', payout.settlement_tranche_id)
    }
    if (orderId) {
      await supabase.from('orders').update({ escrow_released: false, escrow_released_at: null }).eq('id', orderId)
    }
    const { data: order } = orderId
      ? await supabase.from('orders').select('id,reference,customer_id,tailor_id').eq('id', orderId).maybeSingle()
      : { data: null }
    if (order?.id) {
      const customerBody = 'Drapeon recovered a previously released Stripe transfer after reviewed payment activity. Any next refund or settlement action remains protected pending reconciliation.'
      const tailorBody = 'Drapeon reversed a previously released Stripe transfer after independent review. Open Earnings for the recovery status; do not submit a duplicate payout.'
      await Promise.all([
        enqueuePushJob(supabase, { userId: order.customer_id, orderId: order.id, source: FN, idempotencyKey: `stripe-transfer-recovery:${moneyRequest.id}:customer:push`, priority: 5, notification: { title: 'Payment recovery recorded', body: customerBody, preferenceKey: 'orderUpdates', data: { orderId: order.id, type: 'post_release_recovery' } } }),
        enqueuePushJob(supabase, { userId: order.tailor_id, orderId: order.id, source: FN, idempotencyKey: `stripe-transfer-recovery:${moneyRequest.id}:tailor:push`, priority: 5, notification: { title: 'Payout recovery recorded', body: tailorBody, preferenceKey: 'paymentReleased', data: { orderId: order.id, payoutId: payout.id, type: 'post_release_recovery' } } }),
        enqueueOrderEventEmailJob(supabase, { recipientUserId: order.customer_id, audience: 'CUSTOMER', order, subject: 'Drapeon recorded a payment recovery', headline: 'Payment recovery recorded', body: customerBody, ctaLabel: 'View order', source: FN, priority: 5, idempotencyKey: `stripe-transfer-recovery:${moneyRequest.id}:customer:email` }),
        enqueueOrderEventEmailJob(supabase, { recipientUserId: order.tailor_id, audience: 'TAILOR', order, subject: 'Drapeon recorded a payout recovery', headline: 'Payout recovery recorded', body: tailorBody, ctaLabel: 'View earnings', source: FN, priority: 5, idempotencyKey: `stripe-transfer-recovery:${moneyRequest.id}:tailor:email` }),
      ])
    }
    await audit(supabase, { event: 'payout.stripe_transfer_reversed', actor_role: 'OPS', order_id: orderId, severity: 'warn', payload: { function: FN, payout_id: payout.id, money_desk_request_id: moneyRequest.id, provider_transfer_id: payout.provider_payout_id, provider_reversal_id: reversal.id, amount, currency: payout.currency, ledger_transaction_id: ledgerId } })
    await Sentry.captureMessage('Controlled Stripe transfer reversal succeeded', { level: 'info', tags: { function: FN, provider: 'STRIPE' }, extra: { payout_id: payout.id, order_id: orderId, money_desk_request_id: moneyRequest.id, provider_reversal_id: reversal.id, ledger_transaction_id: ledgerId } })
    return json({ ok: true, providerReference: reversal.id, ledgerTransactionId: ledgerId }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const recovery = createClient(getSupabaseUrl(), getServiceRoleKey())
    if (requestId) {
      await recovery.from('provider_transfer_reversals').update({
        status: providerReversalId ? 'BLOCKED' : 'FAILED',
        provider_reversal_id: providerReversalId,
        failure_code: providerReversalId ? 'LEDGER_RECONCILIATION_FAILED' : 'PROVIDER_REVERSAL_FAILED',
        provider_response: { provider_reversal_id: providerReversalId, error: message.slice(0, 500) },
        completed_at: new Date().toISOString(),
      }).eq('money_desk_request_id', requestId)
    }
    await createOrRefreshOpsIssue(recovery, { issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId, provider: 'STRIPE', relatedEntityType: 'payout', relatedEntityId: payoutId, title: providerReversalId ? 'Stripe reversal completed but reconciliation failed' : 'Stripe transfer reversal failed', description: providerReversalId ? 'Stripe returned a reversal reference, but Drapeon could not complete the balanced recovery journal.' : 'The independently approved Stripe transfer reversal did not reach provider success.', recommendedAction: providerReversalId ? 'Do not retry blindly. Reconcile the exact provider reversal and post the missing balanced journal before resolving this issue.' : 'Review the exact Stripe transfer and approved Money Desk request, then retry with the same idempotency key.', dedupeKey: `stripe-transfer-reversal-failed:${requestId ?? payoutId ?? 'unknown'}`, notifyOps: true, metadata: { money_desk_request_id: requestId, payout_id: payoutId, provider_reversal_id: providerReversalId, failure_class: providerReversalId ? 'ledger_reconciliation' : 'provider_reversal' } })
    await Sentry.captureMessage('Controlled Stripe transfer reversal failed', { level: 'fatal', tags: { function: FN, provider: 'STRIPE', failure_class: providerReversalId ? 'ledger_reconciliation' : 'provider_reversal' }, extra: { money_desk_request_id: requestId, payout_id: payoutId, order_id: orderId, provider_reversal_id: providerReversalId, error: message } })
    log('error', FN, 'failed', { money_desk_request_id: requestId, payout_id: payoutId, order_id: orderId, provider_reversal_id: providerReversalId, error: message })
    return json({ ok: false, error: message }, 500, cors)
  }
})
