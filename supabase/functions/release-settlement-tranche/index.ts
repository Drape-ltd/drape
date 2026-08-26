import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createPaystackTransfer } from '../_shared/paystack.ts'
import { createStripeTransfer } from '../_shared/stripe.ts'
import { Sentry } from '../_shared/sentry.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'release-settlement-tranche'
const BodySchema = z.object({ trancheId: uuid })
const response = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let payoutIdForFailure: string | null = null
  let orderIdForFailure: string | null = null
  let trancheIdForFailure: string | null = null
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return response({ ok: false, error: parsed.error }, 400, cors)
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: tranche, error: trancheError } = await supabase.from('order_settlement_tranches')
      .select('id,plan_id,order_id,code,amount,currency,status,eligible_at,payout_id,correlation_id,order_settlement_plans!inner(status,frozen_reason,tailor_id,customer_id,source_payment_id,policy_version)')
      .eq('id', parsed.data.trancheId).maybeSingle()
    if (trancheError) throw trancheError
    if (!tranche) return response({ ok: false, error: 'Settlement tranche was not found.' }, 404, cors)
    orderIdForFailure = tranche.order_id
    trancheIdForFailure = tranche.id
    const plan = Array.isArray(tranche.order_settlement_plans) ? tranche.order_settlement_plans[0] : tranche.order_settlement_plans
    if (plan?.status !== 'ACTIVE' || tranche.status !== 'ELIGIBLE') return response({ ok: false, error: plan?.status === 'FROZEN' ? 'Settlement is frozen by an open review.' : 'This tranche is not eligible for release.' }, 409, cors)
    const { data: order } = await supabase.from('orders').select('reference,tailor_paystack_recipient_code_locked,tailor_stripe_connect_account_id_locked').eq('id', tranche.order_id).single()
    const { data: profile } = await supabase.from('tailor_profiles').select('id,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id').eq('user_id', plan.tailor_id).maybeSingle()
    if (!profile?.id || profile.payout_account_verified !== true || profile.payout_reverification_required === true) return response({ ok: false, error: 'Tailor payout account is not verified.' }, 409, cors)
    const provider = tranche.currency === 'NGN' ? 'PAYSTACK' : 'STRIPE'
    const recipient = order?.tailor_paystack_recipient_code_locked || profile.paystack_recipient_code
    const account = order?.tailor_stripe_connect_account_id_locked || profile.stripe_connect_account_id
    if ((provider === 'PAYSTACK' && !recipient) || (provider === 'STRIPE' && !account)) return response({ ok: false, error: 'Tailor payout destination is missing.' }, 409, cors)
    const { data: payout, error: payoutError } = await supabase.from('payouts').insert({
      tailor_profile_id: profile.id, order_id: tranche.order_id, settlement_tranche_id: tranche.id,
      amount: tranche.amount, currency: tranche.currency, provider, status: 'PROCESSING', payout_purpose: 'SETTLEMENT_TRANCHE', source_payment_id: plan.source_payment_id,
      provider_transfer_status: 'PROCESSING', bank_settlement_status: provider === 'STRIPE' ? 'PENDING' : 'NOT_APPLICABLE',
      provider_destination_id: provider === 'STRIPE' ? account : recipient,
      provider_response: { function: FN, tranche_code: tranche.code },
    }).select('id').single()
    if (payoutError) throw payoutError
    payoutIdForFailure = payout.id
    let providerReference: string
    if (provider === 'PAYSTACK') {
      const transfer = await createPaystackTransfer({ amount: tranche.amount, recipientCode: recipient!, reason: `Drapeon ${tranche.code} for ${order?.reference ?? tranche.order_id}`, reference: `DRAPE-TRANCHE-${tranche.id}`, currency: tranche.currency })
      providerReference = transfer.reference ?? transfer.transfer_code ?? `DRAPE-TRANCHE-${tranche.id}`
    } else {
      const transfer = await createStripeTransfer({ amount: tranche.amount, currency: tranche.currency, destinationAccountId: account!, idempotencyKey: `DRAPE-TRANCHE-${tranche.id}`, transferGroup: `order:${tranche.order_id}`, metadata: { order_id: tranche.order_id, tranche_id: tranche.id, payout_id: payout.id } })
      providerReference = transfer.id
    }
    const { data: ledgerId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
      p_idempotency_key: `settlement-release:${tranche.id}`, p_transaction_kind: 'ADJUSTMENT', p_purpose: 'SETTLEMENT_RELEASE', p_order_id: tranche.order_id,
      p_payment_id: plan.source_payment_id, p_policy_version: plan.policy_version, p_pricing_version: 1, p_correlation_id: tranche.correlation_id, p_provider_reference: providerReference,
      p_entries: [{ accountCode: 'TAILOR_ELIGIBLE', accountScope: tranche.order_id, direction: 'DEBIT', amount: tranche.amount, currency: tranche.currency }, { accountCode: 'TAILOR_RELEASED', accountScope: tranche.order_id, direction: 'CREDIT', amount: tranche.amount, currency: tranche.currency }],
      p_metadata: { tranche_id: tranche.id, tranche_code: tranche.code, payout_id: payout.id }, p_actor_role: 'SYSTEM', p_original_currency: tranche.currency, p_original_amount: tranche.amount, p_settlement_currency: tranche.currency, p_settlement_amount: tranche.amount,
    })
    if (ledgerError) throw ledgerError
    const now = new Date().toISOString()
    await supabase.from('payouts').update({
      status: provider === 'STRIPE' ? 'PROCESSING' : 'PAID',
      provider_payout_id: providerReference,
      provider_transfer_status: provider === 'STRIPE' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK',
      bank_settlement_status: provider === 'STRIPE' ? 'PENDING' : 'PAID',
      bank_settlement_completed_at: provider === 'STRIPE' ? null : now,
      completed_at: provider === 'STRIPE' ? null : now,
      provider_response: { function: FN, tranche_code: tranche.code, provider_reference: providerReference },
    }).eq('id', payout.id)
    await supabase.from('order_settlement_tranches').update({ status: 'RELEASED', released_at: now, payout_id: payout.id, provider_reference: providerReference, release_ledger_transaction_id: ledgerId }).eq('id', tranche.id).eq('status', 'ELIGIBLE')
    const { count } = await supabase.from('order_settlement_tranches').select('id', { count: 'exact', head: true }).eq('plan_id', tranche.plan_id).neq('status', 'RELEASED')
    if ((count ?? 1) === 0) {
      await supabase.from('order_settlement_plans').update({ status: 'SETTLED', updated_at: now }).eq('id', tranche.plan_id)
      await supabase.from('orders').update({ escrow_released: true, escrow_released_at: now }).eq('id', tranche.order_id)
    }
    await audit(supabase, { event: 'settlement.tranche_released', actor_role: 'SYSTEM', order_id: tranche.order_id, payload: { function: FN, tranche_id: tranche.id, tranche_code: tranche.code, amount: tranche.amount, currency: tranche.currency, payout_id: payout.id, provider_reference: providerReference } })
    await Promise.all([
      enqueuePushJob(supabase, { userId: plan.tailor_id, orderId: tranche.order_id, source: FN, idempotencyKey: `settlement-released:tailor:${tranche.id}`, priority: 9, notification: { title: 'Earnings released', body: provider === 'STRIPE' ? 'Drapeon released this milestone to your Stripe balance. Bank arrival will be tracked separately.' : 'Drapeon released this verified earnings milestone to your payout account.', preferenceKey: 'paymentReleased', data: { orderId: tranche.order_id, settlementTrancheId: tranche.id } } }),
      enqueuePushJob(supabase, { userId: plan.customer_id, orderId: tranche.order_id, source: FN, idempotencyKey: `settlement-released:customer:${tranche.id}`, priority: 7, notification: { title: 'Payment protection updated', body: 'A verified order milestone was released to the tailor. Remaining stages stay protected.', preferenceKey: 'paymentReleased', data: { orderId: tranche.order_id, settlementTrancheId: tranche.id } } }),
      enqueueOrderEventEmailJob(supabase, { recipientUserId: plan.tailor_id, audience: 'TAILOR', order: { id: tranche.order_id }, subject: 'Drapeon released an earnings milestone', headline: 'Earnings released', body: provider === 'STRIPE' ? 'The reviewed milestone is now in your Stripe balance. Drapeon will update Earnings when Stripe reports the bank payout outcome.' : 'The reviewed settlement tranche reached a terminal provider outcome. Open the order to see what remains protected.', ctaLabel: 'View order', source: FN, priority: 9, idempotencyKey: `settlement-released:tailor:${tranche.id}` }),
      enqueueOrderEventEmailJob(supabase, { recipientUserId: plan.customer_id, audience: 'CUSTOMER', order: { id: tranche.order_id }, subject: 'Your order payment protection was updated', headline: 'Verified milestone released', body: 'Drapeon released one verified milestone to the tailor. Any later settlement stages remain protected under the order timeline.', ctaLabel: 'View order', source: FN, priority: 7, idempotencyKey: `settlement-released:customer:${tranche.id}` }),
    ])
    return response({ ok: true, trancheId: tranche.id, payoutId: payout.id, providerReference }, 200, cors)
  } catch (error) {
    if (payoutIdForFailure) {
      const recovery = createClient(getSupabaseUrl(), getServiceRoleKey())
      await recovery.from('payouts').update({ status: 'FAILED', failed_at: new Date().toISOString(), provider_response: { function: FN, error: error instanceof Error ? error.message : String(error), terminal_outcome: 'FAILED' } }).eq('id', payoutIdForFailure)
      if (orderIdForFailure) await createOrRefreshOpsIssue(recovery, { issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId: orderIdForFailure, title: 'Settlement tranche release failed', description: 'A reviewed staged-settlement provider attempt failed and reached a recorded terminal outcome.', recommendedAction: 'Reconcile the provider reference and ledger before retrying from Money Desk.', dedupeKey: `settlement-release-failed:${trancheIdForFailure ?? payoutIdForFailure}`, metadata: { settlement_tranche_id: trancheIdForFailure, payout_id: payoutIdForFailure, error: error instanceof Error ? error.message : String(error) } })
    }
    await Sentry.captureMessage('Settlement tranche release failed', { level: 'error', tags: { function: FN, failure_class: 'tranche_release' }, extra: { tranche_id: trancheIdForFailure, payout_id: payoutIdForFailure, order_id: orderIdForFailure, error: error instanceof Error ? error.message : String(error) } })
    log('error', FN, 'failed', { error: error instanceof Error ? error.message : String(error) })
    return response({ ok: false, error: error instanceof Error ? error.message : 'Settlement release failed.' }, 500, cors)
  }
})
