import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { audit, log } from '../_shared/logger.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { Sentry } from '../_shared/sentry.ts'
import { retrieveStripePayout, type StripePayout } from '../_shared/stripe.ts'

const FN = 'monitor-settlements'
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type PendingStripeSettlement = {
  id: string
  order_id: string | null
  tailor_profile_id: string
  amount: number
  currency: string
  status: string
  provider_destination_id: string | null
  provider_bank_payout_id: string | null
  bank_settlement_status: string
  bank_settlement_expected_at: string | null
  initiated_at: string | null
}

function bankStatus(payout: StripePayout) {
  switch (payout.status?.toLowerCase()) {
    case 'paid': return 'PAID'
    case 'failed': return 'FAILED'
    case 'canceled': return 'CANCELED'
    case 'in_transit': return 'IN_TRANSIT'
    default: return 'PENDING'
  }
}

async function reconcileStaleStripeSettlement(
  supabase: SupabaseClient,
  payout: PendingStripeSettlement,
) {
  const issueKey = `stripe-bank-settlement-stale:${payout.id}`
  const startedAt = payout.bank_settlement_expected_at ?? payout.initiated_at
  const waitingHours = startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 3_600_000))
    : 0
  if (waitingHours < 24) return { stale: false, reconciled: false }

  let providerPayout: StripePayout | null = null
  if (payout.provider_destination_id && payout.provider_bank_payout_id) {
    try {
      providerPayout = await retrieveStripePayout({
        accountId: payout.provider_destination_id,
        payoutId: payout.provider_bank_payout_id,
      })
    } catch (error) {
      await Sentry.captureMessage('Stripe stale-settlement reconciliation failed', {
        level: 'error',
        tags: { function: FN, provider: 'STRIPE', failure_class: 'provider_retrieval' },
        extra: {
          payout_id: payout.id,
          order_id: payout.order_id,
          provider_bank_payout_id: payout.provider_bank_payout_id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const observed = providerPayout ? bankStatus(providerPayout) : payout.bank_settlement_status
  const nowIso = new Date().toISOString()
  if (providerPayout && ['PAID', 'FAILED', 'CANCELED'].includes(observed)) {
    const terminal = observed === 'PAID' ? 'PAID' : observed === 'FAILED' ? 'FAILED' : 'CANCELED'
    const { error: updateError } = await supabase.from('payouts').update({
      status: terminal,
      bank_settlement_status: observed,
      provider_transfer_status: observed === 'PAID' ? 'PAID_TO_BANK' : 'FAILED',
      bank_settlement_expected_at: providerPayout.arrival_date
        ? new Date(providerPayout.arrival_date * 1000).toISOString()
        : payout.bank_settlement_expected_at,
      bank_settlement_completed_at: observed === 'PAID' ? nowIso : null,
      bank_settlement_failed_at: observed === 'PAID' ? null : nowIso,
      bank_settlement_failure_code: observed === 'PAID' ? null : providerPayout.failure_code ?? observed,
      completed_at: observed === 'PAID' ? nowIso : null,
      failed_at: observed === 'PAID' ? null : nowIso,
      blocked_reason: observed === 'PAID' ? null : `STRIPE_BANK_PAYOUT_${observed}`,
      processed_at: nowIso,
    }).eq('id', payout.id)
    if (updateError) throw updateError
    await supabase.from('provider_payout_events').upsert({
      provider: 'STRIPE',
      provider_event_id: `reconciliation:${payout.provider_bank_payout_id}:${observed}`,
      event_type: 'payout.retrieved',
      provider_destination_id: payout.provider_destination_id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      payout_id: payout.id,
      tailor_profile_id: payout.tailor_profile_id,
      amount: providerPayout.amount,
      currency: providerPayout.currency.toUpperCase(),
      status: observed,
      arrival_at: providerPayout.arrival_date ? new Date(providerPayout.arrival_date * 1000).toISOString() : null,
      failure_code: providerPayout.failure_code ?? null,
      failure_message: providerPayout.failure_message ?? null,
      payload: { source: FN, provider_payout_id: providerPayout.id },
      occurred_at: nowIso,
      processed_at: nowIso,
    }, { onConflict: 'provider,provider_event_id' })
    await resolveOpsIssueByDedupeKey(supabase, issueKey, {
      payout_id: payout.id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      terminal_status: observed,
      reconciliation_source: FN,
    })
    await Sentry.captureMessage('Stripe stale settlement reached a terminal provider state', {
      level: observed === 'PAID' ? 'info' : 'error',
      tags: { function: FN, provider: 'STRIPE', bank_settlement_status: observed },
      extra: { payout_id: payout.id, order_id: payout.order_id, provider_bank_payout_id: payout.provider_bank_payout_id },
    })
    return { stale: true, reconciled: true }
  }

  const existing = await supabase.from('ops_issues').select('id').eq('dedupe_key', issueKey).maybeSingle()
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: waitingHours >= 72 ? 'CRITICAL' : 'HIGH',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: payout.order_id,
    tailorProfileId: payout.tailor_profile_id,
    provider: 'STRIPE',
    relatedEntityType: 'payout',
    relatedEntityId: payout.id,
    title: 'Stripe bank settlement is overdue',
    description: `The connected-account transfer succeeded, but Stripe has not reported a terminal bank outcome after ${waitingHours} hours.`,
    recommendedAction: 'Open the exact Stripe bank payout, verify its provider status and destination health, then retry or remediate only through the reviewed payout workflow.',
    dedupeKey: issueKey,
    notifyOps: waitingHours >= 72,
    metadata: {
      payout_id: payout.id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      bank_settlement_status: observed,
      waiting_hours: waitingHours,
    },
  })
  if (!(existing.data as { id?: string } | null)?.id) {
    await Sentry.captureMessage('Stripe bank settlement became stale', {
      level: waitingHours >= 72 ? 'error' : 'warning',
      tags: { function: FN, provider: 'STRIPE', failure_class: 'stale_bank_settlement' },
      extra: { payout_id: payout.id, order_id: payout.order_id, provider_bank_payout_id: payout.provider_bank_payout_id, waiting_hours: waitingHours },
    })
  }
  const { data: profile } = await supabase.from('tailor_profiles').select('user_id').eq('id', payout.tailor_profile_id).maybeSingle()
  const tailorUserId = (profile as { user_id?: string | null } | null)?.user_id ?? null
  if (tailorUserId) {
    const body = 'Your released Stripe earnings have not reached a final bank status yet. Drapeon is checking the provider record; open Earnings for the latest status.'
    await enqueuePushJob(supabase, { userId: tailorUserId, orderId: payout.order_id, source: FN, idempotencyKey: `stripe-settlement-stale:${payout.id}:push`, priority: 8, notification: { title: 'Bank payout is taking longer', body, preferenceKey: 'paymentReleased', data: { url: '/earnings', payoutId: payout.id } } })
    await enqueueBackgroundJob(supabase, {
      eventType: 'STRIPE_SETTLEMENT_STALE', aggregateType: 'PAYOUT', aggregateId: payout.id,
      actorId: tailorUserId, actorRole: 'TAILOR', orderId: payout.order_id,
      idempotencyKey: `stripe-settlement-stale:${payout.id}:email`, jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 8,
      payload: {
        userId: tailorUserId,
        subject: 'Your bank payout is taking longer than expected',
        eyebrow: 'Payout update', headline: 'Bank payout update', body,
        ctaLabel: 'View earnings', webPath: '/account/earnings', appUrl: 'drape://earnings',
        details: [{ label: 'Provider', value: 'Stripe' }, { label: 'Status', value: 'Bank confirmation pending' }],
      },
    })
  }
  return { stale: true, reconciled: false }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: plans, error } = await supabase.from('order_settlement_plans').select('id,order_id,tailor_id,customer_id,currency,status').in('status', ['ACTIVE','FROZEN']).limit(500)
    if (error) throw error
    let eligible = 0
    for (const plan of plans ?? []) {
      const { error: refreshError } = await supabase.rpc('refresh_order_settlement', { p_order_id: plan.order_id })
      if (refreshError) { log('error', FN, 'refresh_failed', { order_id: plan.order_id, error: refreshError.message }); continue }
      const { data: tranches } = await supabase.from('order_settlement_tranches').select('id,code,amount,currency,status,eligible_at').eq('plan_id', plan.id).in('status', ['ELIGIBLE','RELEASE_REQUESTED'])
      for (const tranche of tranches ?? []) {
        eligible += 1
        const waitingHours = tranche.eligible_at ? Math.max(0, Math.floor((Date.now() - Date.parse(tranche.eligible_at)) / 3_600_000)) : 0
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT', severity: waitingHours >= 24 ? 'CRITICAL' : waitingHours >= 4 ? 'HIGH' : 'MEDIUM', source: FN, actorRole: 'SYSTEM', orderId: plan.order_id,
          userId: plan.tailor_id, title: waitingHours >= 4 ? 'Settlement release overdue' : 'Settlement tranche ready',
          description: `${tranche.code} is eligible for a reviewed release. It has waited ${waitingHours} hour${waitingHours === 1 ? '' : 's'}.`,
          recommendedAction: 'Open Money Desk, verify the evidence and open-review gate, then prepare this tranche for independent approval.',
          dedupeKey: `settlement-eligible:${tranche.id}`,
          metadata: { settlement_tranche_id: tranche.id, tranche_code: tranche.code, amount: tranche.amount, currency: tranche.currency, eligible_at: tranche.eligible_at, waiting_hours: waitingHours },
        })
        await enqueuePushJob(supabase, { userId: plan.tailor_id, orderId: plan.order_id, source: FN, idempotencyKey: `settlement-eligible:${tranche.id}`, priority: 8, notification: { title: 'Earnings milestone verified', body: 'This order has an earnings tranche ready for Drapeon release review.', preferenceKey: 'paymentReleased', data: { orderId: plan.order_id, settlementTrancheId: tranche.id } } })
        await enqueueOrderEventEmailJob(supabase, { recipientUserId: plan.tailor_id, audience: 'TAILOR', order: { id: plan.order_id }, subject: 'An earnings milestone is ready for review', headline: 'Settlement progress', body: 'Drapeon verified a handoff milestone. The eligible amount is now queued for controlled release review; remaining funds stay protected.', ctaLabel: 'View order', source: FN, priority: 8, idempotencyKey: `settlement-eligible:${tranche.id}` })
      }
    }
    const { data: stripePayouts, error: stripePayoutError } = await supabase.from('payouts')
      .select('id,order_id,tailor_profile_id,amount,currency,status,provider_destination_id,provider_bank_payout_id,bank_settlement_status,bank_settlement_expected_at,initiated_at')
      .eq('provider', 'STRIPE')
      .in('status', ['PROCESSING'])
      .in('bank_settlement_status', ['PENDING', 'IN_TRANSIT', 'UNKNOWN'])
      .limit(500)
    if (stripePayoutError) throw stripePayoutError
    let staleStripe = 0
    let reconciledStripe = 0
    for (const payout of (stripePayouts ?? []) as PendingStripeSettlement[]) {
      const result = await reconcileStaleStripeSettlement(supabase, payout)
      if (result.stale) staleStripe += 1
      if (result.reconciled) reconciledStripe += 1
    }
    await audit(supabase, { event: 'settlement.monitor_completed', actor_role: 'SYSTEM', payload: { function: FN, plans: plans?.length ?? 0, eligible, stale_stripe: staleStripe, reconciled_stripe: reconciledStripe } })
    return json({ ok: true, plans: plans?.length ?? 0, eligible, staleStripe, reconciledStripe }, 200, cors)
  } catch (error) {
    await Sentry.captureMessage(error instanceof Error ? error.message : String(error), { level: 'error', tags: { function: FN } })
    log('error', FN, 'failed', { error: error instanceof Error ? error.message : String(error) })
    return json({ ok: false, error: 'Settlement monitor failed.' }, 500, cors)
  }
})
