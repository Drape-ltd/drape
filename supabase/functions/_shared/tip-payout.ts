import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit } from './logger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'
import { formatTipAmount } from './tip-side-effects.ts'

export type ReleasableTip = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  amount: number
  currency: string
  status: string
  payment_id: string | null
  correlation_id: string
  ledger_transaction_id?: string | null
  payout_id?: string | null
  payout_provider_reference?: string | null
}

export async function completeTipPayout(
  supabase: SupabaseClient,
  input: {
    tip: ReleasableTip
    payoutId: string
    provider: 'PAYSTACK' | 'STRIPE'
    providerReference: string
    providerResponse: Record<string, unknown>
  },
) {
  const { tip } = input
  if (tip.status === 'PAID_OUT' && tip.ledger_transaction_id) {
    const now = new Date().toISOString()
    await supabase.from('payouts').update({
      status: input.provider === 'STRIPE' ? 'PROCESSING' : 'PAID',
      provider_payout_id: input.providerReference,
      provider_transfer_status: input.provider === 'STRIPE' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK',
      bank_settlement_status: input.provider === 'STRIPE' ? 'PENDING' : 'PAID',
      bank_settlement_completed_at: input.provider === 'STRIPE' ? null : now,
      completed_at: input.provider === 'STRIPE' ? null : now,
      provider_response: input.providerResponse,
    }).eq('id', input.payoutId)
    return { ledgerTransactionId: tip.ledger_transaction_id, existing: true }
  }

  const { data: ledgerId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
    p_idempotency_key: `tip-payout:${tip.id}`,
    p_transaction_kind: 'ADJUSTMENT',
    p_purpose: 'TIP_PAYOUT',
    p_order_id: tip.order_id,
    p_payment_id: tip.payment_id,
    p_policy_version: 'benefits-2026-08-01-v1',
    p_pricing_version: 1,
    p_correlation_id: tip.correlation_id,
    p_provider_reference: input.providerReference,
    p_entries: [
      { accountCode: 'TIP_LIABILITY', accountScope: tip.order_id, direction: 'DEBIT', amount: tip.amount, currency: tip.currency },
      { accountCode: 'TAILOR_RELEASED', accountScope: tip.order_id, direction: 'CREDIT', amount: tip.amount, currency: tip.currency },
    ],
    p_metadata: { tip_id: tip.id, payout_id: input.payoutId },
    p_actor_role: 'SYSTEM',
    p_original_currency: tip.currency,
    p_original_amount: tip.amount,
    p_settlement_currency: tip.currency,
    p_settlement_amount: tip.amount,
  })
  if (ledgerError) throw ledgerError

  const now = new Date().toISOString()
  await supabase.from('payouts').update({
    status: input.provider === 'STRIPE' ? 'PROCESSING' : 'PAID',
    provider_payout_id: input.providerReference,
    provider_transfer_status: input.provider === 'STRIPE' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK',
    bank_settlement_status: input.provider === 'STRIPE' ? 'PENDING' : 'PAID',
    bank_settlement_completed_at: input.provider === 'STRIPE' ? null : now,
    completed_at: input.provider === 'STRIPE' ? null : now,
    provider_response: input.providerResponse,
  }).eq('id', input.payoutId)

  const { data: updatedTip, error: tipError } = await supabase.from('order_tips').update({
    status: 'PAID_OUT',
    payout_id: input.payoutId,
    payout_provider_reference: input.providerReference,
    ledger_transaction_id: ledgerId,
    paid_out_at: now,
    failure_reason: null,
    updated_at: now,
  }).eq('id', tip.id).in('status', ['PAYOUT_PENDING', 'PROCESSING']).select('id').maybeSingle()
  if (tipError) throw tipError

  if (updatedTip?.id) {
    await supabase.from('order_tip_events').insert({
      tip_id: tip.id,
      event_type: 'TIP_PAID_OUT',
      actor_role: 'SYSTEM',
      payload: { payout_id: input.payoutId, provider: input.provider, provider_reference: input.providerReference },
      correlation_id: tip.correlation_id,
    })
    await audit(supabase, {
      event: 'tip.paid_out',
      actor_role: 'SYSTEM',
      order_id: tip.order_id,
      payload: {
        tip_id: tip.id,
        amount: tip.amount,
        currency: tip.currency,
        payout_id: input.payoutId,
        provider: input.provider,
        provider_reference: input.providerReference,
        correlation_id: tip.correlation_id,
      },
    })

    const displayedAmount = formatTipAmount(tip.amount, tip.currency)
    await Promise.all([
      enqueuePushJob(supabase, {
        userId: tip.tailor_id,
        orderId: tip.order_id,
        source: 'tip-payout',
        idempotencyKey: `tip-paid-out:tailor:${tip.id}`,
        priority: 9,
        notification: {
          title: `${displayedAmount} tip released`,
          body: input.provider === 'STRIPE'
            ? 'It is in your Stripe balance; bank arrival is tracked separately.'
            : 'Paystack confirmed it was sent to your payout account.',
          preferenceKey: 'paymentReleased',
          data: { orderId: tip.order_id, tipId: tip.id, amount: String(tip.amount), currency: tip.currency },
        },
      }),
      enqueueOrderEventEmailJob(supabase, {
        recipientUserId: tip.tailor_id,
        audience: 'TAILOR',
        order: { id: tip.order_id },
        subject: `Your ${displayedAmount} tip was released`,
        headline: `${displayedAmount} tip released`,
        body: input.provider === 'STRIPE'
          ? `${displayedAmount} is in your Stripe balance. Drapeon will update Earnings when Stripe reports the bank payout outcome.`
          : `Paystack confirmed that ${displayedAmount} was sent to your payout account.`,
        ctaLabel: 'View earnings',
        source: 'tip-payout',
        priority: 9,
        idempotencyKey: `tip-paid-out:tailor:${tip.id}`,
      }),
    ])
  }

  return { ledgerTransactionId: ledgerId, existing: !updatedTip?.id }
}

export async function holdTipPayout(
  supabase: SupabaseClient,
  input: { tip: ReleasableTip; payoutId: string | null; failure: string },
) {
  const now = new Date().toISOString()
  if (input.payoutId) {
    await supabase.from('payouts').update({
      status: 'FAILED',
      provider_transfer_status: 'FAILED',
      failed_at: now,
      provider_response: { terminal_outcome: 'FAILED', error: input.failure },
    }).eq('id', input.payoutId)
  }
  await supabase.from('order_tips').update({
    status: 'HELD',
    failure_reason: input.failure,
    updated_at: now,
  }).eq('id', input.tip.id).neq('status', 'PAID_OUT')
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: 'CRITICAL',
    source: 'tip-payout',
    actorRole: 'SYSTEM',
    orderId: input.tip.order_id,
    relatedEntityType: 'ORDER_TIP',
    relatedEntityId: input.tip.id,
    title: 'Tip payout failed',
    description: 'A customer tip payout reached a recorded provider failure.',
    recommendedAction: 'Reconcile the provider reference and tip liability before retrying. Do not submit a duplicate transfer.',
    dedupeKey: `tip-payout-failed:${input.tip.id}`,
    metadata: { payout_id: input.payoutId, error: input.failure },
  })
}
