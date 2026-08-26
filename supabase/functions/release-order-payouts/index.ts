import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import {
  type PayoutBlockedReason,
  type PayoutCandidateOrder,
  type SuccessfulOrderPayment,
  type TailorPayoutProfile,
} from '../_shared/payout-release.ts'
import { createPaystackTransfer, finalizePaystackTransfer } from '../_shared/paystack.ts'
import { createStripeTransfer } from '../_shared/stripe.ts'
import { logPreflightFailure, runPreflight } from '../_shared/preflight.ts'
import { getProviderCircuit, recordProviderHealth } from '../_shared/provider-health.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  PAYOUT_BLOCKED_REASONS,
  payoutBlockRecovery,
  payoutBlockReasonMessage,
} from '../../../packages/shared/src/payout-gating.ts'
import { payoutWindowClosesAt } from '../../../packages/shared/src/payout-timing.ts'
import { recordCommercialPayoutRelease } from '../_shared/commercial-ledger.ts'
import { buildPayoutFailedSms } from '../../../packages/shared/src/sms-copy.ts'
import { Sentry } from '../_shared/sentry.ts'
import { enqueueFabricReleaseOutcomeSideEffects } from '../_shared/fabric-release.ts'

const FN = 'release-order-payouts'

const BodySchema = z.object({
  action: z.enum(['RELEASE', 'FINALIZE_PAYSTACK_OTP', 'RECONCILE_PAYOUT_LEDGER']).optional(),
  orderId: uuid.optional(),
  recoveryRequestId: uuid.optional(),
  payoutId: uuid.optional(),
  otp: z.string().trim().min(4).max(12).optional(),
})

type PayoutRowStatus = 'PROCESSING' | 'PAID' | 'FAILED' | 'BLOCKED'

type ExistingPayoutRow = {
  id: string
  status: string
  blocked_reason: string | null
  provider_response: Record<string, unknown> | null
}

type PayoutRecoveryContext = {
  kind: 'DESTINATION' | 'RESIDUAL_SETTLEMENT'
  id: string
  order_id: string
  failed_payout_id: string | null
  provider: string | null
  money_desk_request_id: string
  source_payment_id?: string
  refund_resolution_id?: string
  amount?: number
  currency?: string
  fulfilment_liability?: number
}

async function notifyTailorPayoutFailure(
  supabase: SupabaseClient,
  order: PayoutCandidateOrder,
  error: string,
) {
  if (!order.tailor_id) return

  const userId = order.tailor_id.toString()
  const reference = order.reference ?? order.id.slice(0, 8)
  const body = 'A payout release for this order did not complete. Open Earnings for the recovery step; do not submit a duplicate payout.'
  await Promise.all([
    enqueuePushJob(supabase, {
      userId,
      source: FN,
      orderId: order.id,
      idempotencyKey: `payout-failure:${order.id}:push`,
      priority: 5,
      notification: {
        title: 'Payout needs attention',
        body,
        preferenceKey: 'paymentReleased',
        data: { orderId: order.id, url: '/earnings', reason: error.slice(0, 120) },
      },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_FAILED', aggregateType: 'ORDER', aggregateId: order.id, orderId: order.id,
      actorId: userId, actorRole: 'TAILOR', idempotencyKey: `payout-failure:${order.id}:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 5,
      payload: { userId, subject: `Payout needs attention for order ${reference}`, headline: 'Payout needs attention', eyebrow: 'Payout update', body, ctaLabel: 'Review earnings', webPath: '/account/earnings', appUrl: 'drape://earnings', details: [{ label: 'Order', value: reference }, { label: 'Next step', value: 'Open Earnings and follow the displayed recovery action' }] },
    }),
    enqueueSmsJob(supabase, {
      userId, audience: 'TAILOR', event: 'PAYOUT_FAILED',
      body: buildPayoutFailedSms({ provider: 'The payout provider', reference }),
      source: FN, orderId: order.id, idempotencyKey: `payout-failure:${order.id}:sms`, priority: 5,
    }),
  ])
}

async function notifyTailorPayoutReleased(
  supabase: SupabaseClient,
  order: PayoutCandidateOrder,
  input: { provider: 'PAYSTACK' | 'STRIPE'; payoutId: string; amount: number; currency: string },
) {
  if (!order.tailor_id) return
  const userId = order.tailor_id.toString()
  const reference = order.reference ?? order.id.slice(0, 8)
  const stripe = input.provider === 'STRIPE'
  const title = stripe ? 'Earnings released to Stripe' : 'Payout sent to your bank'
  const body = stripe
    ? 'Your earnings are in your Stripe balance. Drapeon will update Earnings again when Stripe reports the bank payout outcome.'
    : 'The payout provider confirmed this payout was sent to your verified bank destination.'
  await Promise.all([
    enqueuePushJob(supabase, {
      userId, source: FN, orderId: order.id, idempotencyKey: `payout-released:${input.payoutId}:push`, priority: 20,
      notification: { title, body, preferenceKey: 'paymentReleased', data: { orderId: order.id, payoutId: input.payoutId, url: '/earnings' } },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_RELEASED', aggregateType: 'ORDER', aggregateId: order.id, orderId: order.id,
      actorId: userId, actorRole: 'TAILOR', idempotencyKey: `payout-released:${input.payoutId}:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 20,
      payload: { userId, subject: `${title} · order ${reference}`, headline: title, eyebrow: 'Payout update', body, ctaLabel: 'View earnings', webPath: '/account/earnings', appUrl: 'drape://earnings', details: [{ label: 'Order', value: reference }, { label: 'Amount', value: `${input.currency} ${(input.amount / 100).toFixed(2)}` }, { label: 'Status', value: stripe ? 'In Stripe balance; bank confirmation pending' : 'Paid to bank' }] },
    }),
  ])
}

async function notifyTailorPayoutBlocked(supabase: SupabaseClient, order: PayoutCandidateOrder, reason: PayoutBlockedReason) {
  if (!order.tailor_id) return
  const recovery = payoutBlockRecovery(reason)
  const reference = order.reference ?? order.id.slice(0, 8)
  const opensOrder = recovery.destination === 'ORDER' || (recovery.destination === 'OPS_REVIEW' && Boolean(order.id))
  const opensPayoutSetup = recovery.destination === 'PAYOUT_SETUP'
  const webPath = opensOrder ? `/account/orders/${order.id}` : opensPayoutSetup ? '/account/payout' : '/account/earnings'
  const appUrl = opensOrder ? `drape://orders/${order.id}` : opensPayoutSetup ? 'drape://payout-setup' : 'drape://earnings'
  await Promise.all([
    enqueuePushJob(supabase, {
      userId: order.tailor_id.toString(), source: FN, orderId: order.id,
      idempotencyKey: `payout-blocked:${order.id}:${reason}:tailor:push`, priority: 25,
      notification: { title: recovery.headline, body: recovery.nextStep, preferenceKey: 'paymentReleased', data: { orderId: order.id, url: webPath, reason } },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_BLOCKED', aggregateType: 'ORDER', aggregateId: order.id, orderId: order.id,
      actorId: order.tailor_id.toString(), actorRole: 'TAILOR',
      idempotencyKey: `payout-blocked:${order.id}:${reason}:tailor:email`, jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 25,
      payload: { userId: order.tailor_id.toString(), subject: `${recovery.headline} · order ${reference}`, eyebrow: 'Payout status', headline: recovery.headline, body: recovery.nextStep, ctaLabel: recovery.ctaLabel, webPath, appUrl, details: [{ label: 'Order', value: reference }, { label: 'What happened', value: recovery.reason }, { label: 'Next step', value: recovery.nextStep }] },
    }),
  ])
}

function blockedPayoutIssueSeverity(reason: PayoutBlockedReason) {
  if (
    reason === PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT
    || reason === PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_UNVERIFIED
    || reason === PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_MISSING
    || reason === PAYOUT_BLOCKED_REASONS.PAYOUT_PROVIDER_UNAVAILABLE
  ) {
    return 'CRITICAL' as const
  }

  return 'HIGH' as const
}

async function refreshBlockedPayoutIssue(
  supabase: SupabaseClient,
  order: PayoutCandidateOrder,
  tailorProfile: TailorPayoutProfile | null,
  payment: SuccessfulOrderPayment | null,
  blockedReason: PayoutBlockedReason,
  extra?: Record<string, unknown>,
) {
  const recovery = payoutBlockRecovery(blockedReason)
  const recommendedAction = blockedReason === PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH
    ? 'Choose an ops payout resolution for this order: retry the original locked currency, convert to the current payout currency, or refund the customer if the order cannot be settled cleanly.'
    : recovery.nextStep

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_BLOCKED',
    severity: blockedPayoutIssueSeverity(blockedReason),
    source: FN,
    actorRole: 'SYSTEM',
    orderId: order.id,
    userId: order.tailor_id ?? null,
    tailorProfileId: tailorProfile?.id ?? null,
    provider: fallbackBlockedProvider(order, tailorProfile),
    stage: order.stage,
    title: 'Payout blocked',
    description: `${recovery.headline} for order ${order.reference ?? order.id}. ${recovery.reason}`,
    recommendedAction,
    dedupeKey: `payout-blocked:${order.id}:${blockedReason}`,
    metadata: {
      blocked_reason: blockedReason,
      blocked_recovery_headline: recovery.headline,
      blocked_reason_message: payoutBlockReasonMessage(blockedReason),
      blocked_recovery_next_step: recovery.nextStep,
      blocked_recovery_destination: recovery.destination,
      blocked_recovery_requires_user_action: recovery.userActionRequired,
      payout_currency: fallbackBlockedCurrency(order, tailorProfile),
      payout_provider: fallbackBlockedProvider(order, tailorProfile),
      payout_amount: fallbackBlockedAmount(order),
      source_payment_id: payment?.id ?? null,
      source_payment_provider: payment?.provider ?? null,
      ...extra,
    },
  })
}

async function refreshFailedPayoutIssue(
  supabase: SupabaseClient,
  order: PayoutCandidateOrder,
  tailorProfile: TailorPayoutProfile | null,
  error: string,
  extra?: Record<string, unknown>,
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: 'CRITICAL',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: order.id,
    userId: order.tailor_id ?? null,
    tailorProfileId: tailorProfile?.id ?? null,
    provider: fallbackBlockedProvider(order, tailorProfile),
    stage: order.stage,
    title: 'Payout release failed',
    description: `A payout release attempt for order ${order.reference ?? order.id} failed and needs manual ops review.`,
    recommendedAction: 'Review the provider response, verify the payout destination, and retry only after the failure cause is clear.',
    dedupeKey: `payout-failed:${order.id}`,
    metadata: {
      error,
      payout_currency: fallbackBlockedCurrency(order, tailorProfile),
      payout_provider: fallbackBlockedProvider(order, tailorProfile),
      ...extra,
    },
  })
}

async function refreshPayoutLedgerIssue(
  supabase: SupabaseClient,
  order: PayoutCandidateOrder,
  tailorProfile: TailorPayoutProfile | null,
  payoutId: string,
  error: string,
  providerReference?: string | null,
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: 'CRITICAL',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: order.id,
    userId: order.tailor_id ?? null,
    tailorProfileId: tailorProfile?.id ?? null,
    provider: fallbackBlockedProvider(order, tailorProfile),
    stage: order.stage,
    title: 'Payout sent; accounting reconciliation required',
    description: `The provider completed the payout for order ${order.reference ?? order.id}, but Drapeon has not yet posted its balanced payout journal.`,
    recommendedAction: 'Do not send another payout. Reconcile the existing paid payout from its preserved provider reference, then confirm the balanced ledger transaction.',
    dedupeKey: `payout-ledger-reconciliation:${payoutId}`,
    metadata: {
      error,
      payout_id: payoutId,
      provider_reference: providerReference ?? null,
      provider_release_completed: true,
      ledger_reconciliation_required: true,
      payout_currency: fallbackBlockedCurrency(order, tailorProfile),
      payout_provider: fallbackBlockedProvider(order, tailorProfile),
    },
  })
}

async function recordPayoutProviderEvent(
  supabase: SupabaseClient,
  input: {
    provider: string
    succeeded: boolean
    orderId: string
    payoutId?: string | null
    currency?: string | null
    amount?: number | null
    error?: string | null
  },
) {
  await recordProviderHealth(supabase, {
    provider: input.provider,
    operation: 'PAYOUT',
    succeeded: input.succeeded,
    error: input.error ?? null,
    openAfterFailures: 2,
    openSeconds: 600,
    metadata: {
      order_id: input.orderId,
      payout_id: input.payoutId ?? null,
      currency: input.currency ?? null,
      amount: input.amount ?? null,
      function: FN,
    },
  })
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const candidate = [
      record.message,
      record.error,
      record.error_description,
      record.details,
      record.hint,
      record.code,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)

    if (candidate) return candidate

    try {
      return JSON.stringify(error).slice(0, 1000)
    } catch {
      return '[unserializable error object]'
    }
  }

  return String(error)
}

function existingPayoutFailureMessage(payout: ExistingPayoutRow) {
  const response = payout.provider_response
  const providerError = response && typeof response.error === 'string' ? response.error.trim() : ''
  if (providerError.length > 0) return providerError

  const providerMessage = response && typeof response.message === 'string' ? response.message.trim() : ''
  if (providerMessage.length > 0) return providerMessage

  return `Existing payout is already in ${payout.status} state.`
}

function fallbackBlockedCurrency(order: PayoutCandidateOrder, tailorProfile: TailorPayoutProfile | null) {
  const value =
    order.ops_payout_override_currency
    ?? order.source_currency
    ?? order.currency
    ?? order.tailor_payout_currency_locked
    ?? tailorProfile?.payout_currency
    ?? 'USD'
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : 'USD'
}

function fallbackBlockedProvider(order: PayoutCandidateOrder, tailorProfile: TailorPayoutProfile | null) {
  return resolvePaymentProviderForCurrency(fallbackBlockedCurrency(order, tailorProfile) as any)
}

function fallbackBlockedAmount(order: PayoutCandidateOrder) {
  if (typeof order.ops_payout_override_amount === 'number' && order.ops_payout_override_amount > 0) {
    return order.ops_payout_override_amount
  }
  if (typeof order.source_amount === 'number' && order.source_amount > 0) return order.source_amount
  if (typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0) return order.subtotal_amount
  return 0
}

function normalizedCurrency(value: string | null | undefined) {
  return normalizeAccountCurrency(value)
}

function lockedPayoutCurrency(order: PayoutCandidateOrder) {
  return normalizedCurrency(order.source_currency ?? order.currency)
}

function lockedPayoutProvider(order: PayoutCandidateOrder) {
  const currency = lockedPayoutCurrency(order)
  return currency ? resolvePaymentProviderForCurrency(currency) : null
}

function lockedPayoutAmount(order: PayoutCandidateOrder) {
  if (typeof order.source_amount === 'number' && order.source_amount > 0) return order.source_amount
  if (typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0) return order.subtotal_amount
  return 0
}

function resolvedPaystackRecipientCode(order: PayoutCandidateOrder, tailorProfile: TailorPayoutProfile | null) {
  const locked = order.tailor_paystack_recipient_code_locked?.trim()
  if (locked) return locked
  return tailorProfile?.paystack_recipient_code?.trim() || null
}

function resolvedStripeAccountId(order: PayoutCandidateOrder, tailorProfile: TailorPayoutProfile | null) {
  const locked = order.tailor_stripe_connect_account_id_locked?.trim()
  if (locked) return locked
  return tailorProfile?.stripe_connect_account_id?.trim() || null
}

function resolveEffectivePayoutMoney(order: PayoutCandidateOrder) {
  const resolutionMode = typeof order.ops_payout_resolution_mode === 'string'
    ? order.ops_payout_resolution_mode.trim().toUpperCase()
    : ''

  if (resolutionMode === 'CONVERT_TO_CURRENT') {
    const currency = normalizedCurrency(order.ops_payout_override_currency)
    const amount = typeof order.ops_payout_override_amount === 'number' ? order.ops_payout_override_amount : 0

    if (!currency) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
    if (amount <= 0) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID } as const

    return {
      amount,
      currency,
      provider: resolvePaymentProviderForCurrency(currency),
    } as const
  }

  if (resolutionMode === 'ORIGINAL_CURRENCY') {
    const currency = normalizedCurrency(order.ops_payout_override_currency ?? order.source_currency ?? order.currency)
    const amount =
      typeof order.ops_payout_override_amount === 'number' && order.ops_payout_override_amount > 0
        ? order.ops_payout_override_amount
        : lockedPayoutAmount(order)

    if (!currency) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
    if (amount <= 0) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID } as const

    return {
      amount,
      currency,
      provider: resolvePaymentProviderForCurrency(currency),
    } as const
  }

  const currency = lockedPayoutCurrency(order)
  const amount = lockedPayoutAmount(order)
  const provider = lockedPayoutProvider(order)
  const lockedCurrency = normalizedCurrency(order.tailor_payout_currency_locked)
  const lockedProvider = order.tailor_payout_provider_locked ?? null

  if (lockedCurrency && currency && lockedCurrency !== currency) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH } as const
  }

  if (lockedProvider && provider && lockedProvider !== provider) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH } as const
  }

  if (!currency || !provider) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
  }

  if (amount <= 0) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID } as const
  }

  return {
    amount,
    currency,
    provider,
  } as const
}

function payoutReleaseReason(order: PayoutCandidateOrder, nowMs: number) {
  if (order.stage === 'IN_DISPUTE') {
    return PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE
  }

  if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
    return PAYOUT_BLOCKED_REASONS.ORDER_NOT_FINAL
  }

  if (!order.handoff_completed_at) {
    return PAYOUT_BLOCKED_REASONS.HANDOFF_NOT_COMPLETED
  }

  if (!order.customer_handoff_confirmed_at) {
    return PAYOUT_BLOCKED_REASONS.CUSTOMER_CONFIRMATION_REQUIRED
  }

  const releaseAtMs = Date.parse(payoutWindowClosesAt(order.customer_handoff_confirmed_at))
  if (!Number.isFinite(releaseAtMs) || releaseAtMs > nowMs) {
    return PAYOUT_BLOCKED_REASONS.DISPUTE_WINDOW_OPEN
  }

  return null
}

function payoutPreflightCheckName(reason: PayoutBlockedReason) {
  return reason.toLowerCase()
}

function payoutPreflightMessage(reason: PayoutBlockedReason) {
  return payoutBlockReasonMessage(reason)
}

async function fetchCandidateOrders(supabase: SupabaseClient, orderId?: string) {
  const selectFields =
    'id, reference, stage, order_kind, tailor_id, customer_id, currency, source_currency, source_amount, subtotal_amount, tailor_payout_currency_locked, tailor_payout_provider_locked, tailor_paystack_recipient_code_locked, tailor_stripe_connect_account_id_locked, ops_payout_resolution_mode, ops_payout_override_currency, ops_payout_override_provider, ops_payout_override_amount, ops_payout_override_fx_rate, ops_payout_override_fx_rate_timestamp, ops_payout_override_note, platform_fee_amount, tax_amount, shipping_amount, total_amount, escrow_released, handoff_completed_at, customer_handoff_confirmed_at, handoff_confirmation_source'

  if (orderId) {
    const { data, error } = await supabase
      .from('orders')
      .select(selectFields)
      .eq('id', orderId)
      .limit(1)

    if (error) throw error
    return (data ?? []) as PayoutCandidateOrder[]
  }

  const { data, error } = await supabase
    .from('orders')
    .select(selectFields)
    .eq('escrow_released', false)
    .in('stage', ['DELIVERED', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE'])
    .order('updated_at', { ascending: true })
    .limit(200)

  if (error) throw error
  return (data ?? []) as PayoutCandidateOrder[]
}

async function fetchTailorProfile(supabase: SupabaseClient, tailorUserId: string) {
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select('id, user_id, display_name, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type, payout_destination_hold_until, paystack_recipient_code, stripe_connect_account_id')
    .eq('user_id', tailorUserId)
    .maybeSingle()

  if (error) throw error
  return (data as TailorPayoutProfile | null) ?? null
}

async function hasPendingPayoutChangeRequest(supabase: SupabaseClient, tailorUserId: string | null | undefined) {
  if (!tailorUserId) return false
  const { count, error } = await supabase
    .from('payout_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('tailor_user_id', tailorUserId)
    .eq('status', 'PENDING')

  if (error) throw error
  return (count ?? 0) > 0
}

async function fetchSettledOrderPayment(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_response, refunded_amount')
    .eq('order_id', orderId)
    .eq('phase', 'INITIAL_ORDER')
    .in('status', ['SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED'])
    .order('confirmed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as SuccessfulOrderPayment | null) ?? null
}

function stripeSourceCharge(payment: SuccessfulOrderPayment) {
  const response = payment.provider_response
  if (!response || typeof response !== 'object') return null
  const candidates: unknown[] = [
    response.latest_charge,
    response.charge,
    (response.payment_intent && typeof response.payment_intent === 'object')
      ? (response.payment_intent as Record<string, unknown>).latest_charge
      : null,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('ch_')) return candidate
    if (candidate && typeof candidate === 'object') {
      const id = (candidate as Record<string, unknown>).id
      if (typeof id === 'string' && id.startsWith('ch_')) return id
    }
  }
  return null
}

async function hasOpenDispute(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from('disputes')
    .select('id, status')
    .eq('order_id', orderId)
    .in('status', ['OPEN', 'UNDER_REVIEW'])
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return !!data?.id
}

async function findExistingPayout(
  supabase: SupabaseClient,
  orderId: string,
  statuses: string[],
  excludedPayoutId?: string | null,
) {
  let query = supabase
    .from('payouts')
    .select('id, status, blocked_reason, provider_response')
    .eq('order_id', orderId)
    .eq('payout_purpose', 'ORDER_EARNING')
    .in('status', statuses)
    .order('processed_at', { ascending: false })
    .limit(1)

  if (excludedPayoutId) query = query.neq('id', excludedPayoutId)
  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as ExistingPayoutRow | null) ?? null
}

async function loadPayoutRecoveryContext(
  supabase: SupabaseClient,
  recoveryRequestId: string | undefined,
  orderId: string,
): Promise<PayoutRecoveryContext | null> {
  if (!recoveryRequestId) return null
  const { data: request, error: requestError } = await supabase
    .from('money_desk_requests')
    .select('id, action_type, target_type, target_id, order_id, status, amount, currency, action_payload')
    .eq('id', recoveryRequestId)
    .maybeSingle()
  if (requestError) throw requestError
  if (!request?.id || request.status !== 'EXECUTING' || request.order_id !== orderId) {
    throw new Error('The payout recovery is not backed by an executing, approved Money Desk request.')
  }

  if (request.action_type === 'PAYOUT_RELEASE' && request.target_type === 'ORDER_RESIDUAL_SETTLEMENT') {
    const { data: prepared, error: prepareError } = await supabase.rpc('prepare_order_residual_settlement_release', {
      p_money_desk_request_id: request.id,
    })
    if (prepareError || !prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
      const preparationMessage = prepareError?.message ?? 'The residual settlement could not be prepared.'
      await completeResidualSettlementMoneyDeskExecution(supabase, request.id, {
        status: 'FAILED',
        failureCode: 'RESIDUAL_SETTLEMENT_PREPARATION_FAILED',
        failureSummary: preparationMessage.slice(0, 500),
      }).catch((completionError) => {
        log('error', FN, 'residual_settlement_preparation_completion_failed', {
          order_id: orderId,
          request_id: request.id,
          error: errorMessage(completionError),
        })
      })
      throw new Error(preparationMessage)
    }
    const snapshot = prepared as Record<string, unknown>
    const amount = Number(snapshot.residualTailorEntitlement)
    const currency = typeof snapshot.currency === 'string' ? snapshot.currency : ''
    const sourcePaymentId = typeof snapshot.sourcePaymentId === 'string' ? snapshot.sourcePaymentId : ''
    if (!Number.isInteger(amount) || amount <= 0 || !currency || !sourcePaymentId) {
      throw new Error('The prepared residual settlement is invalid.')
    }
    return {
      kind: 'RESIDUAL_SETTLEMENT',
      id: request.id,
      order_id: orderId,
      failed_payout_id: null,
      provider: typeof snapshot.provider === 'string' ? snapshot.provider : null,
      money_desk_request_id: request.id,
      source_payment_id: sourcePaymentId,
      refund_resolution_id: typeof snapshot.refundResolutionId === 'string' ? snapshot.refundResolutionId : undefined,
      amount,
      currency,
      fulfilment_liability: Number(snapshot.fulfillmentLiability ?? 0),
    } satisfies PayoutRecoveryContext
  }

  if (request.action_type !== 'PAYOUT_DESTINATION_CHANGE' || request.target_type !== 'ORDER_PAYOUT_FAILURE') {
    throw new Error('The approved Money Desk request does not match a supported payout recovery.')
  }

  const { data: correction, error: correctionError } = await supabase
    .from('payout_destination_corrections')
    .select('id, order_id, failed_payout_id, provider, money_desk_request_id')
    .eq('money_desk_request_id', recoveryRequestId)
    .eq('order_id', orderId)
    .eq('failed_payout_id', request.target_id)
    .maybeSingle()
  if (correctionError) throw correctionError
  if (!correction?.id) throw new Error('The reviewed payout destination correction was not applied.')
  return { ...(correction as Omit<PayoutRecoveryContext, 'kind'>), kind: 'DESTINATION' as const }
}

async function completeResidualSettlementMoneyDeskExecution(
  supabase: SupabaseClient,
  requestId: string,
  outcome: {
    status: 'SUCCEEDED' | 'FAILED'
    providerReference?: string | null
    failureCode?: string | null
    failureSummary?: string | null
  },
) {
  const { data: attempt, error: attemptError } = await supabase
    .from('money_desk_execution_attempts')
    .select('id')
    .eq('request_id', requestId)
    .eq('status', 'PROCESSING')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (attemptError) throw attemptError
  if (!attempt?.id) {
    const { data: request, error: requestError } = await supabase
      .from('money_desk_requests')
      .select('status')
      .eq('id', requestId)
      .maybeSingle()
    if (requestError) throw requestError
    if (request?.status === outcome.status) return
    throw new Error('The residual-settlement Money Desk execution attempt is missing.')
  }

  const { error: completionError } = await supabase.rpc('complete_money_desk_execution', {
    p_attempt_id: attempt.id,
    p_status: outcome.status,
    p_provider_reference: outcome.providerReference ?? null,
    p_failure_code: outcome.failureCode ?? null,
    p_failure_summary: outcome.failureSummary ?? null,
  })
  if (completionError) throw completionError
}

async function recordBlockedPayout(
  supabase: SupabaseClient,
  order: PayoutCandidateOrder,
  tailorProfile: TailorPayoutProfile | null,
  payment: SuccessfulOrderPayment | null,
  blockedReason: PayoutBlockedReason,
  extra?: Record<string, unknown>,
) {
  const duplicate = await findExistingPayout(supabase, order.id, ['BLOCKED'])
  if (duplicate?.blocked_reason === blockedReason) {
    await refreshBlockedPayoutIssue(supabase, order, tailorProfile, payment, blockedReason, {
      duplicate_payout_id: duplicate.id,
      ...extra,
    })
    await notifyTailorPayoutBlocked(supabase, order, blockedReason)
    return { skipped: true as const, id: duplicate.id }
  }

  const payload = {
    tailor_profile_id: tailorProfile?.id,
    order_id: order.id,
    amount: fallbackBlockedAmount(order),
    currency: fallbackBlockedCurrency(order, tailorProfile),
    provider: fallbackBlockedProvider(order, tailorProfile),
    status: 'BLOCKED' satisfies PayoutRowStatus,
    payout_purpose: 'ORDER_EARNING',
    blocked_reason: blockedReason,
    source_payment_id: payment?.id ?? null,
    provider_response: {
      function: FN,
      blocked_reason: blockedReason,
      blocked_reason_message: payoutBlockReasonMessage(blockedReason),
      ...extra,
    },
  }

  if (!payload.tailor_profile_id) {
    await refreshBlockedPayoutIssue(supabase, order, tailorProfile, payment, blockedReason, {
      payout_id: null,
      missing_tailor_profile: true,
      ...extra,
    })
    await notifyTailorPayoutBlocked(supabase, order, blockedReason)
    return { skipped: true as const, id: null }
  }

  const { data, error } = await supabase
    .from('payouts')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw error
  await refreshBlockedPayoutIssue(supabase, order, tailorProfile, payment, blockedReason, {
    payout_id: (data as { id: string }).id,
    ...extra,
  })
  await notifyTailorPayoutBlocked(supabase, order, blockedReason)
  return { skipped: false as const, id: (data as { id: string }).id }
}

async function updatePayoutRow(
  supabase: SupabaseClient,
  payoutId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('payouts')
    .update(patch)
    .eq('id', payoutId)

  if (error) throw error
}

async function recordTerminalPayoutLedger(
  supabase: SupabaseClient,
  payout: {
    id: string
    order_id: string
    source_payment_id: string
    amount: number
    currency: string
    provider: 'PAYSTACK' | 'STRIPE'
    provider_payout_id?: string | null
  },
) {
  return recordCommercialPayoutRelease(supabase, {
    payoutId: payout.id,
    paymentId: payout.source_payment_id,
    orderId: payout.order_id,
    amount: payout.amount,
    currency: payout.currency,
    provider: payout.provider,
    providerReference: payout.provider_payout_id ?? null,
    metadata: { function: FN },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const limit = await rateLimit(
      supabase,
      clientIp,
      FN,
      RATE_LIMITS.payment.limit,
      RATE_LIMITS.payment.windowMs,
      { ip: clientIp, userAgent: req.headers.get('user-agent') },
    )
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

    const parsed = parseBody(BodySchema, req.method === 'POST' ? await req.json().catch(() => ({})) : {})
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    if (parsed.data.action === 'RECONCILE_PAYOUT_LEDGER') {
      if (!parsed.data.payoutId) return jsonResponse({ error: 'A payout is required.' }, 400, cors)
      const { data: payout, error: payoutError } = await supabase
        .from('payouts')
        .select('id,order_id,source_payment_id,amount,currency,provider,provider_payout_id,status,provider_transfer_status,bank_settlement_status')
        .eq('id', parsed.data.payoutId)
        .maybeSingle()
      if (payoutError) throw payoutError
      const commerciallyReleased = payout?.provider === 'PAYSTACK'
        ? payout.status === 'PAID'
        : payout?.provider === 'STRIPE'
          && payout.status === 'PROCESSING'
          && payout.provider_transfer_status === 'AVAILABLE_IN_PROVIDER_BALANCE'
      if (!payout?.id || !commerciallyReleased || !payout.order_id || !payout.source_payment_id) {
        return jsonResponse({ error: 'Only a provider-confirmed payout release can be reconciled.' }, 409, cors)
      }
      const ledger = await recordTerminalPayoutLedger(supabase, payout as Parameters<typeof recordTerminalPayoutLedger>[1])
      if (payout.provider === 'PAYSTACK') {
        await updatePayoutRow(supabase, payout.id, {
          provider_transfer_status: 'PAID_TO_BANK',
          bank_settlement_status: 'PAID',
          bank_settlement_completed_at: new Date().toISOString(),
        })
      }

      let residualSettlementRequestId: string | null = null
      if (parsed.data.recoveryRequestId) {
        const { data: request, error: requestError } = await supabase
          .from('money_desk_requests')
          .select('id,action_type,target_type,order_id,status')
          .eq('id', parsed.data.recoveryRequestId)
          .maybeSingle()
        if (requestError) throw requestError
        const validResidualRequest = request?.id
          && request.order_id === payout.order_id
          && request.action_type === 'PAYOUT_RELEASE'
          && request.target_type === 'ORDER_RESIDUAL_SETTLEMENT'
          && ['EXECUTING', 'SUCCEEDED'].includes(request.status)
        if (!validResidualRequest) {
          return jsonResponse({ error: 'The reviewed residual-settlement request does not match this payout.' }, 409, cors)
        }
        residualSettlementRequestId = request.id
        await completeResidualSettlementMoneyDeskExecution(
          supabase,
          request.id,
          {
            status: 'SUCCEEDED',
            providerReference: payout.provider_payout_id,
          },
        )
      }

      const [order] = await fetchCandidateOrders(supabase, payout.order_id)
      if (order) {
        await notifyTailorPayoutReleased(supabase, order, {
          provider: payout.provider,
          payoutId: payout.id,
          amount: payout.amount,
          currency: payout.currency,
        })
      }
      await audit(supabase, {
        event: 'payout.ledger_reconciled',
        actor_role: 'OPS',
        order_id: payout.order_id,
        payload: {
          function: FN,
          payout_id: payout.id,
          ledger_transaction_id: ledger.transactionId,
          residual_settlement_request_id: residualSettlementRequestId,
        },
      })
      return jsonResponse({
        ok: true,
        payoutId: payout.id,
        ledgerTransactionId: ledger.transactionId,
        residualSettlementRequestId,
      }, 200, cors)
    }

    if (parsed.data.action === 'FINALIZE_PAYSTACK_OTP') {
      if (!parsed.data.payoutId || !parsed.data.otp) {
        return jsonResponse({ error: 'A payout and OTP are required.' }, 400, cors)
      }

      const { data: payout, error: payoutError } = await supabase
        .from('payouts')
        .select('id,order_id,source_payment_id,fabric_candidate_id,amount,currency,status,provider,provider_payout_id,provider_response')
        .eq('id', parsed.data.payoutId)
        .maybeSingle()
      if (payoutError) throw payoutError
      if (!payout?.id || payout.provider !== 'PAYSTACK' || payout.status !== 'PROCESSING') {
        return jsonResponse({ error: 'This payout is not awaiting Paystack approval.' }, 409, cors)
      }

      const priorResponse = payout.provider_response && typeof payout.provider_response === 'object'
        ? payout.provider_response as Record<string, unknown>
        : {}
      const priorTransfer = priorResponse.transfer && typeof priorResponse.transfer === 'object'
        ? priorResponse.transfer as Record<string, unknown>
        : priorResponse
      const transferCode = typeof priorTransfer.transfer_code === 'string'
        ? priorTransfer.transfer_code.trim()
        : ''
      if (!transferCode || priorTransfer.status !== 'otp') {
        return jsonResponse({ error: 'Paystack is not waiting for an OTP on this payout.' }, 409, cors)
      }

      const transfer = await finalizePaystackTransfer({
        transferCode,
        otp: parsed.data.otp,
      })
      const terminal = transfer.status === 'success'
      const providerReference = transfer.reference ?? transfer.transfer_code ?? transferCode
      await updatePayoutRow(supabase, payout.id, {
        provider_payout_id: providerReference,
        provider_response: {
          ...priorResponse,
          transfer,
          otp_finalized_at: new Date().toISOString(),
        },
        status: 'PROCESSING',
        completed_at: null,
      })

      if (terminal && payout.fabric_candidate_id) {
        const released = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
          p_candidate_id: payout.fabric_candidate_id,
          p_payout_id: payout.id,
          p_provider: 'PAYSTACK',
          p_provider_reference: providerReference,
          p_outcome: 'SUCCEEDED',
          p_provider_response: transfer,
        })
        if (released.error) throw released.error
        await updatePayoutRow(supabase, payout.id, {
          provider_payout_id: providerReference,
          provider_response: transfer,
          provider_transfer_status: 'PAID_TO_BANK',
          bank_settlement_status: 'PAID',
          status: 'PAID',
          completed_at: new Date().toISOString(),
        })
        await resolveOpsIssueByDedupeKey(
          supabase,
          `fabric-candidate:release:${payout.fabric_candidate_id}`,
          { providerReference, resolution: 'PAYSTACK_OTP_FINALIZED' },
        )
        await enqueueFabricReleaseOutcomeSideEffects(supabase, {
          candidateId: payout.fabric_candidate_id,
          outcome: 'SUCCEEDED',
        })
        await audit(supabase, {
          event: 'fabric_candidate.release_succeeded',
          actor_role: 'OPS',
          order_id: payout.order_id,
          payload: {
            function: FN,
            payout_id: payout.id,
            fabric_candidate_id: payout.fabric_candidate_id,
            provider: 'PAYSTACK',
            provider_reference: providerReference,
            approval_method: 'OTP',
          },
        })
        return jsonResponse({
          ok: true,
          released: 1,
          blocked: 0,
          skipped: 0,
          processing: 0,
          fabricCandidateId: payout.fabric_candidate_id,
          payoutId: payout.id,
        }, 200, cors)
      }

      if (terminal && payout.order_id) {
        if (!payout.source_payment_id) throw new Error('The payout source payment is missing.')
        const residualSettlementRequestId = typeof priorResponse.residual_settlement_request_id === 'string'
          ? priorResponse.residual_settlement_request_id.trim()
          : ''
        try {
          await recordTerminalPayoutLedger(supabase, {
            id: payout.id,
            order_id: payout.order_id,
            source_payment_id: payout.source_payment_id,
            amount: payout.amount,
            currency: payout.currency,
            provider: 'PAYSTACK',
            provider_payout_id: providerReference,
          })
        } catch (ledgerError) {
          const ledgerMessage = errorMessage(ledgerError)
          const [order] = await fetchCandidateOrders(supabase, payout.order_id)
          const tailorProfile = order?.tailor_id
            ? await fetchTailorProfile(supabase, order.tailor_id).catch(() => null)
            : null
          if (order) {
            await refreshPayoutLedgerIssue(
              supabase,
              order,
              tailorProfile,
              payout.id,
              ledgerMessage,
              providerReference ? String(providerReference) : null,
            )
          }
          await audit(supabase, {
            event: 'payout.ledger_reconciliation_failed',
            actor_role: 'SYSTEM',
            order_id: payout.order_id,
            severity: 'error',
            payload: {
              function: FN,
              payout_id: payout.id,
              provider: 'PAYSTACK',
              provider_reference: providerReference ?? null,
              provider_release_completed: true,
              error: ledgerMessage,
            },
          })
          return jsonResponse({
            ok: false,
            error: 'Paystack completed this payout, but its accounting journal is pending. Do not retry the transfer.',
            payoutId: payout.id,
            providerReleaseCompleted: true,
            ledgerReconciliationRequired: true,
          }, 500, cors)
        }
        await updatePayoutRow(supabase, payout.id, {
          status: 'PAID',
          provider_transfer_status: 'PAID_TO_BANK',
          bank_settlement_status: 'PAID',
          bank_settlement_completed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        // A reviewed residual settlement is deliberately allowed after the order
        // has reached a terminal stage. Its payout and balanced journal are the
        // authoritative completion records; mutating the terminal order would
        // trip the immutability guard after the provider already paid.
        if (!residualSettlementRequestId) {
          const { error: orderUpdateError } = await supabase.from('orders').update({
            escrow_released: true,
            escrow_released_at: new Date().toISOString(),
          }).eq('id', payout.order_id)
          if (orderUpdateError) throw orderUpdateError
        }

        if (residualSettlementRequestId) {
          await completeResidualSettlementMoneyDeskExecution(
            supabase,
            residualSettlementRequestId,
            {
              status: 'SUCCEEDED',
              providerReference,
            },
          )
        }

        const [order] = await fetchCandidateOrders(supabase, payout.order_id)
        if (order) {
          await notifyTailorPayoutReleased(supabase, order, {
            provider: 'PAYSTACK',
            payoutId: payout.id,
            amount: payout.amount,
            currency: payout.currency,
          })
        }
      }

      await audit(supabase, {
        event: terminal ? 'payout.released' : 'payout.provider_processing',
        actor_role: 'OPS',
        order_id: payout.order_id,
        payload: {
          function: FN,
          payout_id: payout.id,
          provider: 'PAYSTACK',
          provider_status: transfer.status ?? null,
          approval_method: 'OTP',
        },
      })

      return jsonResponse({
        ok: true,
        released: terminal ? 1 : 0,
        blocked: 0,
        skipped: 0,
        processing: terminal ? 0 : 1,
        results: [{
          orderId: payout.order_id,
          result: terminal ? 'released' : 'processing',
          payoutId: payout.id,
          provider: 'PAYSTACK',
          providerStatus: transfer.status ?? null,
        }],
      }, 200, cors)
    }

    const candidates = await fetchCandidateOrders(supabase, parsed.data.orderId)
    const now = Date.now()

    let released = 0
    let blocked = 0
    let skipped = 0
    let processing = 0
    const results: Array<Record<string, unknown>> = []

    for (const order of candidates) {
      let payoutIdForFailure: string | null = null
      let recoveryContext: PayoutRecoveryContext | null = null
      let residualSettlement: PayoutRecoveryContext | null = null
      let providerReleaseCompleted = false
      try {
        recoveryContext = await loadPayoutRecoveryContext(supabase, parsed.data.recoveryRequestId, order.id)
        residualSettlement = recoveryContext?.kind === 'RESIDUAL_SETTLEMENT' ? recoveryContext : null
        const existingTriggered = await findExistingPayout(
          supabase,
          order.id,
          residualSettlement ? ['PROCESSING', 'PAID'] : ['PROCESSING', 'PAID', 'FAILED', 'REVERSED'],
          recoveryContext?.failed_payout_id,
        )
        if (existingTriggered?.id) {
          if (existingTriggered.status === 'FAILED' || existingTriggered.status === 'REVERSED') {
            const existingFailureMessage = existingPayoutFailureMessage(existingTriggered)
            await refreshFailedPayoutIssue(
              supabase,
              order,
              order.tailor_id ? await fetchTailorProfile(supabase, order.tailor_id) : null,
              existingFailureMessage,
              {
                payout_id: existingTriggered.id,
                payout_status: existingTriggered.status,
                existing_failure_replayed: true,
              },
            )
          }
          skipped += 1
          results.push({
            orderId: order.id,
            result: existingTriggered.status === 'FAILED' || existingTriggered.status === 'REVERSED'
              ? 'requires_ops_review'
              : 'already_triggered',
            payoutId: existingTriggered.id,
            status: existingTriggered.status,
          })
          continue
        }

        const earlyReleaseReason = residualSettlement ? null : payoutReleaseReason(order, now)
        if (earlyReleaseReason === PAYOUT_BLOCKED_REASONS.DISPUTE_WINDOW_OPEN) {
          skipped += 1
          results.push({
            orderId: order.id,
            result: 'not_due_yet',
            reason: earlyReleaseReason,
            payoutReadyAt: order.customer_handoff_confirmed_at
              ? payoutWindowClosesAt(order.customer_handoff_confirmed_at)
              : null,
          })
          continue
        }

        const tailorProfile = order.tailor_id ? await fetchTailorProfile(supabase, order.tailor_id) : null
        const settledPayment = await fetchSettledOrderPayment(supabase, order.id)
        const openDispute = await hasOpenDispute(supabase, order.id)
        const pendingPayoutChange = await hasPendingPayoutChangeRequest(supabase, order.tailor_id)
        const baseBlockedReason = earlyReleaseReason
        const settledPaymentRefunded = !residualSettlement && !!settledPayment && (
          settledPayment.status === 'PARTIAL_REFUND'
          || settledPayment.status === 'REFUNDED'
          || (typeof settledPayment.refunded_amount === 'number' && settledPayment.refunded_amount > 0)
        )
        const lockedDestinationAvailable =
          resolvedPaystackRecipientCode(order, tailorProfile) !== null
          || resolvedStripeAccountId(order, tailorProfile) !== null
        const standardPayoutMoney = resolveEffectivePayoutMoney(order)
        const residualCurrency = residualSettlement ? normalizeAccountCurrency(residualSettlement.currency) : null
        const payoutMoney = residualSettlement && residualCurrency
          ? {
              amount: residualSettlement.amount!,
              currency: residualCurrency,
              provider: resolvePaymentProviderForCurrency(residualCurrency),
            } as const
          : residualSettlement
            ? { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
          : standardPayoutMoney
        const payoutMoneyBlockedReason = 'blockedReason' in payoutMoney
          ? (payoutMoney.blockedReason as PayoutBlockedReason)
          : null
        const paystackRecipientCode = resolvedPaystackRecipientCode(order, tailorProfile)
        const stripeAccountId = resolvedStripeAccountId(order, tailorProfile)
        const providerDestinationMissing =
          !payoutMoneyBlockedReason
          && (
            (payoutMoney.provider === 'PAYSTACK' && !paystackRecipientCode)
            || (payoutMoney.provider === 'STRIPE' && !stripeAccountId)
          )
        const residualProviderMismatch = Boolean(
          residualSettlement?.provider
          && residualSettlement.provider !== payoutMoney.provider,
        )

        const preflight = runPreflight([
          {
            name: 'settled_payment_exists',
            condition: !!settledPayment && (!residualSettlement || settledPayment.id === residualSettlement.source_payment_id),
            errorCode: PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT),
            field: 'order_payments',
            severity: 'BLOCKING',
            actual: { settledPaymentId: settledPayment?.id ?? null },
          },
          {
            name: 'payment_not_refunded',
            condition: residualSettlement !== null || !settledPaymentRefunded,
            errorCode: PAYOUT_BLOCKED_REASONS.PAYMENT_ALREADY_REFUNDED,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.PAYMENT_ALREADY_REFUNDED),
            field: 'order_payments.status',
            severity: 'BLOCKING',
            actual: {
              paymentStatus: settledPayment?.status ?? null,
              refundedAmount: settledPayment?.refunded_amount ?? null,
            },
          },
          {
            name: 'no_open_dispute',
            condition: residualSettlement !== null || !openDispute,
            errorCode: PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE),
            field: 'disputes',
            severity: 'BLOCKING',
            actual: { openDispute },
          },
          {
            name: baseBlockedReason ? payoutPreflightCheckName(baseBlockedReason) : 'order_release_state_ready',
            condition: baseBlockedReason === null,
            errorCode: baseBlockedReason ?? PAYOUT_BLOCKED_REASONS.ORDER_NOT_FINAL,
            message: baseBlockedReason ? payoutPreflightMessage(baseBlockedReason) : 'Order payout release state is ready.',
            field: baseBlockedReason === PAYOUT_BLOCKED_REASONS.CUSTOMER_CONFIRMATION_REQUIRED ? 'customer_handoff_confirmed_at' : 'stage',
            severity: 'BLOCKING',
            actual: {
              stage: order.stage,
              handoff_completed_at: order.handoff_completed_at,
              customer_handoff_confirmed_at: order.customer_handoff_confirmed_at,
              handoff_confirmation_source: order.handoff_confirmation_source,
            },
          },
          {
            name: 'no_pending_payout_destination_change',
            condition: !pendingPayoutChange,
            errorCode: PAYOUT_BLOCKED_REASONS.PAYOUT_CHANGE_PENDING,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.PAYOUT_CHANGE_PENDING),
            field: 'payout_change_requests',
            severity: 'BLOCKING',
            actual: { tailor_user_id: order.tailor_id ?? null, pendingPayoutChange },
          },
          {
            name: 'tailor_payout_account_verified',
            condition: !!tailorProfile?.id && (
              lockedDestinationAvailable
              || (tailorProfile.payout_account_verified === true && tailorProfile.payout_reverification_required !== true)
            ),
            errorCode: PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_UNVERIFIED,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_UNVERIFIED),
            field: 'payout_account_verified',
            severity: 'BLOCKING',
            actual: {
              tailorProfileId: tailorProfile?.id ?? null,
              payout_account_verified: tailorProfile?.payout_account_verified ?? null,
              payout_reverification_required: tailorProfile?.payout_reverification_required ?? null,
              lockedDestinationAvailable,
            },
          },
          {
            name: payoutMoneyBlockedReason ? payoutPreflightCheckName(payoutMoneyBlockedReason) : 'payout_money_valid',
            condition: payoutMoneyBlockedReason === null,
            errorCode: payoutMoneyBlockedReason ?? PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID,
            message: payoutMoneyBlockedReason ? payoutPreflightMessage(payoutMoneyBlockedReason) : 'Payout amount and currency are valid.',
            field: payoutMoneyBlockedReason === PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID ? 'currency' : 'amount',
            severity: 'BLOCKING',
            actual: {
              order_currency: order.currency ?? null,
              source_currency: order.source_currency ?? null,
              payout_currency: tailorProfile?.payout_currency ?? null,
              locked_payout_currency: order.tailor_payout_currency_locked ?? null,
              locked_payout_provider: order.tailor_payout_provider_locked ?? null,
            },
          },
          {
            name: 'provider_destination_present',
            condition: !providerDestinationMissing,
            errorCode: PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_MISSING,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_MISSING),
            field: !payoutMoneyBlockedReason && payoutMoney.provider === 'PAYSTACK' ? 'paystack_recipient_code' : 'stripe_connect_account_id',
            severity: 'BLOCKING',
            actual: {
              provider: payoutMoneyBlockedReason ? null : payoutMoney.provider,
              hasPaystackRecipientCode: !!paystackRecipientCode,
              hasStripeAccountId: !!stripeAccountId,
            },
          },
          {
            name: 'source_payment_provider_matches_payout_rail',
            condition: !residualProviderMismatch,
            errorCode: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID,
            message: 'The source payment provider must match the reviewed residual-settlement payout rail.',
            field: 'order_payments.provider',
            severity: 'BLOCKING',
            actual: {
              sourceProvider: residualSettlement?.provider ?? null,
              payoutProvider: payoutMoneyBlockedReason ? null : payoutMoney.provider,
            },
          },
        ])

        if (!preflight.passed) {
          const firstFailure = preflight.failures[0]!
          const blockedReason = firstFailure.errorCode as PayoutBlockedReason
          await logPreflightFailure(supabase, preflight, {
            operation: 'release_order_payout',
            entityType: 'order',
            entityId: order.id,
            orderId: order.id,
            userId: order.tailor_id ?? null,
            actorRole: 'SYSTEM',
            source: FN,
            metadata: {
              order_reference: order.reference ?? null,
              payout_provider: payoutMoneyBlockedReason ? fallbackBlockedProvider(order, tailorProfile) : payoutMoney.provider,
              payout_currency: payoutMoneyBlockedReason ? fallbackBlockedCurrency(order, tailorProfile) : payoutMoney.currency,
            },
          })
          await recordBlockedPayout(
            supabase,
            order,
            tailorProfile,
            settledPayment,
            blockedReason,
            {
              stage: order.stage,
              payment_status: settledPayment?.status ?? null,
              refunded_amount: settledPayment?.refunded_amount ?? null,
              payout_destination_hold_until: tailorProfile?.payout_destination_hold_until ?? null,
              order_currency: order.currency ?? null,
              source_currency: order.source_currency ?? null,
              payout_currency: tailorProfile?.payout_currency ?? null,
              locked_payout_currency: order.tailor_payout_currency_locked ?? null,
              locked_payout_provider: order.tailor_payout_provider_locked ?? null,
              preflight_check: firstFailure.name,
              preflight_warnings: preflight.warnings.map((warning) => warning.errorCode),
            },
          )
          blocked += 1
          results.push({ orderId: order.id, result: 'blocked', reason: blockedReason, preflightCheck: firstFailure.name })
          continue
        }

        if ('blockedReason' in payoutMoney || !tailorProfile?.id || !settledPayment?.id) {
          throw new Error('Payout preflight passed with invalid payout state.')
        }

        const payoutTailorProfile = tailorProfile
        const payoutSourcePayment = settledPayment
        const providerCircuit = await getProviderCircuit(supabase, payoutMoney.provider, 'PAYOUT')
        if (providerCircuit.open) {
          const blockedReason = PAYOUT_BLOCKED_REASONS.PAYOUT_PROVIDER_UNAVAILABLE
          await recordBlockedPayout(
            supabase,
            order,
            payoutTailorProfile,
            payoutSourcePayment,
            blockedReason,
            {
              provider: payoutMoney.provider,
              payout_currency: payoutMoney.currency,
              payout_amount: payoutMoney.amount,
              circuit_status: providerCircuit.status,
              circuit_open_until: providerCircuit.circuitOpenUntil ?? null,
              circuit_message: providerCircuit.message ?? null,
            },
          )
          blocked += 1
          results.push({
            orderId: order.id,
            result: 'blocked',
            reason: blockedReason,
            provider: payoutMoney.provider,
            circuitOpenUntil: providerCircuit.circuitOpenUntil ?? null,
          })
          continue
        }

        const { data: createdPayout, error: createPayoutError } = await supabase
          .from('payouts')
          .insert({
            tailor_profile_id: payoutTailorProfile.id,
            order_id: order.id,
            amount: payoutMoney.amount,
            currency: payoutMoney.currency,
            provider: payoutMoney.provider,
            status: 'PROCESSING',
            payout_purpose: 'ORDER_EARNING',
            provider_transfer_status: 'PROCESSING',
            bank_settlement_status: payoutMoney.provider === 'STRIPE' ? 'PENDING' : 'NOT_APPLICABLE',
            provider_destination_id: payoutMoney.provider === 'STRIPE' ? stripeAccountId : paystackRecipientCode,
            source_payment_id: payoutSourcePayment.id,
            provider_response: {
              function: FN,
              order_stage: order.stage,
              source_payment_id: payoutSourcePayment.id,
              customer_handoff_confirmed_at: order.customer_handoff_confirmed_at,
              handoff_completed_at: order.handoff_completed_at,
              recovery_request_id: recoveryContext?.money_desk_request_id ?? null,
              destination_correction_id: recoveryContext?.kind === 'DESTINATION' ? recoveryContext.id : null,
              residual_settlement_request_id: residualSettlement?.money_desk_request_id ?? null,
              refund_resolution_id: residualSettlement?.refund_resolution_id ?? null,
              fulfilment_liability: residualSettlement?.fulfilment_liability ?? null,
              supersedes_payout_id: recoveryContext?.failed_payout_id ?? null,
            },
          })
          .select('id')
          .single()

        if (createPayoutError || !(createdPayout as { id?: string } | null)?.id) {
          throw new Error(createPayoutError?.message ?? 'Could not create payout row.')
        }

        const payoutId = (createdPayout as { id: string }).id
        payoutIdForFailure = payoutId
        const providerIdempotencyKey = recoveryContext
          ? `DRAPE-PAYOUT-${order.id}-RECOVERY-${recoveryContext.id.slice(0, 8)}`
          : `DRAPE-PAYOUT-${order.id}`

        let providerReleaseTerminal = false
        let providerStatus: string | null = null
        let providerReference: string | null = null
        if (payoutMoney.provider === 'PAYSTACK') {
          let transfer
          try {
            transfer = await createPaystackTransfer({
              amount: payoutMoney.amount,
              recipientCode: paystackRecipientCode!,
              reason: `Drapeon payout for order ${order.reference ?? order.id}`,
              reference: providerIdempotencyKey,
              currency: payoutMoney.currency,
            })
            await recordPayoutProviderEvent(supabase, {
              provider: payoutMoney.provider,
              succeeded: true,
              orderId: order.id,
              payoutId,
              currency: payoutMoney.currency,
              amount: payoutMoney.amount,
            })
          } catch (error) {
            const message = errorMessage(error)
            await recordPayoutProviderEvent(supabase, {
              provider: payoutMoney.provider,
              succeeded: false,
              orderId: order.id,
              payoutId,
              currency: payoutMoney.currency,
              amount: payoutMoney.amount,
              error: message,
            })
            throw error
          }

          await updatePayoutRow(supabase, payoutId, {
            provider_payout_id: transfer.reference ?? transfer.transfer_code ?? null,
            provider_response: {
              function: FN,
              transfer,
              source_payment_id: payoutSourcePayment.id,
              recovery_request_id: recoveryContext?.money_desk_request_id ?? null,
              destination_correction_id: recoveryContext?.kind === 'DESTINATION' ? recoveryContext.id : null,
              residual_settlement_request_id: residualSettlement?.money_desk_request_id ?? null,
              refund_resolution_id: residualSettlement?.refund_resolution_id ?? null,
              fulfilment_liability: residualSettlement?.fulfilment_liability ?? null,
              supersedes_payout_id: recoveryContext?.failed_payout_id ?? null,
            },
            status: 'PROCESSING',
            completed_at: null,
          })
          providerStatus = transfer.status ?? null
          providerReference = transfer.reference ?? transfer.transfer_code ?? null
          providerReleaseTerminal = transfer.status === 'success'
        } else {
          let transfer
          try {
            transfer = await createStripeTransfer({
              amount: payoutMoney.amount,
              currency: payoutMoney.currency,
              destinationAccountId: stripeAccountId!,
              sourceTransaction: stripeSourceCharge(payoutSourcePayment),
              idempotencyKey: providerIdempotencyKey,
              transferGroup: `order:${order.id}`,
              metadata: {
                order_id: order.id,
                payout_id: payoutId,
                tailor_profile_id: payoutTailorProfile.id,
                payout_currency: payoutMoney.currency,
                recovery_request_id: recoveryContext?.money_desk_request_id ?? '',
                destination_correction_id: recoveryContext?.kind === 'DESTINATION' ? recoveryContext.id : '',
                residual_settlement_request_id: residualSettlement?.money_desk_request_id ?? '',
              },
            })
            await recordPayoutProviderEvent(supabase, {
              provider: payoutMoney.provider,
              succeeded: true,
              orderId: order.id,
              payoutId,
              currency: payoutMoney.currency,
              amount: payoutMoney.amount,
            })
          } catch (error) {
            const message = errorMessage(error)
            await recordPayoutProviderEvent(supabase, {
              provider: payoutMoney.provider,
              succeeded: false,
              orderId: order.id,
              payoutId,
              currency: payoutMoney.currency,
              amount: payoutMoney.amount,
              error: message,
            })
            throw error
          }

          await updatePayoutRow(supabase, payoutId, {
            provider_payout_id: transfer.id,
            provider_transfer_status: 'AVAILABLE_IN_PROVIDER_BALANCE',
            bank_settlement_status: 'PENDING',
            provider_destination_id: stripeAccountId,
            provider_response: {
              function: FN,
              transfer,
              source_payment_id: payoutSourcePayment.id,
              recovery_request_id: recoveryContext?.money_desk_request_id ?? null,
              destination_correction_id: recoveryContext?.kind === 'DESTINATION' ? recoveryContext.id : null,
              residual_settlement_request_id: residualSettlement?.money_desk_request_id ?? null,
              refund_resolution_id: residualSettlement?.refund_resolution_id ?? null,
              fulfilment_liability: residualSettlement?.fulfilment_liability ?? null,
              supersedes_payout_id: recoveryContext?.failed_payout_id ?? null,
            },
          })
          providerStatus = 'available_in_provider_balance'
          providerReference = transfer.id
          providerReleaseTerminal = true
        }

        if (!providerReleaseTerminal) {
          processing += 1
          results.push({
            orderId: order.id,
            result: 'processing',
            reason: providerStatus === 'otp' ? 'PAYSTACK_OTP_REQUIRED' : 'PROVIDER_PROCESSING',
            payoutId,
            provider: payoutMoney.provider,
            currency: payoutMoney.currency,
            amount: payoutMoney.amount,
            providerStatus,
            recoveryRequestId: recoveryContext?.money_desk_request_id ?? null,
          })
          continue
        }

        providerReleaseCompleted = true
        await recordTerminalPayoutLedger(supabase, {
          id: payoutId,
          order_id: order.id,
          source_payment_id: payoutSourcePayment.id,
          amount: payoutMoney.amount,
          currency: payoutMoney.currency,
          provider: payoutMoney.provider,
          provider_payout_id: providerReference,
        })
        await updatePayoutRow(supabase, payoutId, payoutMoney.provider === 'STRIPE'
          ? {
              status: 'PROCESSING',
              provider_transfer_status: 'AVAILABLE_IN_PROVIDER_BALANCE',
              bank_settlement_status: 'PENDING',
              processed_at: new Date().toISOString(),
              completed_at: null,
            }
          : {
              status: 'PAID',
              provider_transfer_status: 'PAID_TO_BANK',
              bank_settlement_status: 'PAID',
              bank_settlement_completed_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            })

        // Residual settlements can execute after a reviewed terminal order
        // outcome. Do not reopen or mutate that order merely to mirror a payout;
        // the payout row and ledger journal own this financial transition.
        if (!residualSettlement) {
          const { error: orderUpdateError } = await supabase
            .from('orders')
            .update({
              escrow_released: true,
              escrow_released_at: new Date().toISOString(),
            })
            .eq('id', order.id)

          if (orderUpdateError) {
            throw new Error(orderUpdateError.message)
          }
        }

        await audit(supabase, {
          event: payoutMoney.provider === 'STRIPE' ? 'payout.released_to_provider_balance' : 'payout.paid_to_bank',
          actor_role: 'SYSTEM',
          order_id: order.id,
          payload: {
            function: FN,
            payout_id: payoutId,
            payout_currency: payoutMoney.currency,
            payout_amount: payoutMoney.amount,
            provider: payoutMoney.provider,
            source_payment_id: payoutSourcePayment.id,
            recovery_request_id: recoveryContext?.money_desk_request_id ?? null,
            destination_correction_id: recoveryContext?.kind === 'DESTINATION' ? recoveryContext.id : null,
            residual_settlement_request_id: residualSettlement?.money_desk_request_id ?? null,
            refund_resolution_id: residualSettlement?.refund_resolution_id ?? null,
            fulfilment_liability: residualSettlement?.fulfilment_liability ?? null,
            supersedes_payout_id: recoveryContext?.failed_payout_id ?? null,
          },
        })

        await notifyTailorPayoutReleased(supabase, order, {
          provider: payoutMoney.provider,
          payoutId,
          amount: payoutMoney.amount,
          currency: payoutMoney.currency,
        })

        if (residualSettlement?.money_desk_request_id) {
          await completeResidualSettlementMoneyDeskExecution(
            supabase,
            residualSettlement.money_desk_request_id,
            {
              status: 'SUCCEEDED',
              providerReference,
            },
          )
        }

        released += 1
        results.push({
          orderId: order.id,
          result: 'released',
          payoutId,
          provider: payoutMoney.provider,
          currency: payoutMoney.currency,
          amount: payoutMoney.amount,
          recoveryRequestId: recoveryContext?.money_desk_request_id ?? null,
        })
      } catch (error) {
        skipped += 1
        const message = errorMessage(error)
        log('error', FN, 'release.failed', { order_id: order.id, error: message })
        await Sentry.captureMessage(
          providerReleaseCompleted
            ? 'Payout provider succeeded but ledger reconciliation failed'
            : 'Payout release failed before provider completion',
          {
            level: providerReleaseCompleted ? 'fatal' : 'error',
            tags: {
              function: FN,
              failure_class: providerReleaseCompleted ? 'provider_ledger_divergence' : 'provider_release_failure',
            },
            extra: {
              order_id: order.id,
              payout_id: payoutIdForFailure,
              provider_release_completed: providerReleaseCompleted,
              recovery_request_id: recoveryContext?.money_desk_request_id ?? null,
              error: message,
            },
          },
        )
        if (payoutIdForFailure && !providerReleaseCompleted) {
          await updatePayoutRow(supabase, payoutIdForFailure, {
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            provider_response: {
              function: FN,
              error: message,
              failed_after_payout_row_created: true,
              recovery_request_id: recoveryContext?.money_desk_request_id ?? null,
              destination_correction_id: recoveryContext?.kind === 'DESTINATION' ? recoveryContext.id : null,
              residual_settlement_request_id: residualSettlement?.money_desk_request_id ?? null,
              refund_resolution_id: residualSettlement?.refund_resolution_id ?? null,
              fulfilment_liability: residualSettlement?.fulfilment_liability ?? null,
              supersedes_payout_id: recoveryContext?.failed_payout_id ?? null,
            },
          }).catch((updateError) => {
            log('error', FN, 'payout_status_update_failed', {
              order_id: order.id,
              payout_id: payoutIdForFailure,
              error: errorMessage(updateError),
            })
          })
        } else if (payoutIdForFailure) {
          await updatePayoutRow(supabase, payoutIdForFailure, {
            status: 'PROCESSING',
            failed_at: null,
          }).catch((updateError) => {
            log('error', FN, 'payout_ledger_pending_status_update_failed', {
              order_id: order.id,
              payout_id: payoutIdForFailure,
              error: errorMessage(updateError),
            })
          })
        }
        if (residualSettlement?.money_desk_request_id && !providerReleaseCompleted) {
          await completeResidualSettlementMoneyDeskExecution(
            supabase,
            residualSettlement.money_desk_request_id,
            {
              status: 'FAILED',
              failureCode: 'PAYOUT_PROVIDER_REJECTED',
              failureSummary: message.slice(0, 500),
            },
          ).catch((completionError) => {
            log('error', FN, 'money_desk_failure_completion_failed', {
              order_id: order.id,
              request_id: residualSettlement?.money_desk_request_id,
              error: errorMessage(completionError),
            })
          })
        }
        const tailorProfile = order.tailor_id ? await fetchTailorProfile(supabase, order.tailor_id).catch(() => null) : null
        if (providerReleaseCompleted && payoutIdForFailure) {
          await refreshPayoutLedgerIssue(supabase, order, tailorProfile, payoutIdForFailure, message)
        } else {
          await refreshFailedPayoutIssue(supabase, order, tailorProfile, message, {
            payout_id: payoutIdForFailure,
            provider_release_completed: false,
            ledger_reconciliation_required: false,
          })
        }
        if (!providerReleaseCompleted) await notifyTailorPayoutFailure(supabase, order, message)
        await audit(supabase, {
          event: providerReleaseCompleted ? 'payout.ledger_reconciliation_failed' : 'payout.release_failed',
          actor_role: 'SYSTEM',
          order_id: order.id,
          severity: 'error',
          payload: {
            function: FN,
            error: message,
          },
        })
        results.push({ orderId: order.id, result: 'error', error: message })
      }
    }

    return jsonResponse({ ok: true, released, blocked, skipped, processing, results }, 200, cors)
  } catch (error) {
    const message = errorMessage(error)
    await Sentry.captureMessage('Payout release worker failed', {
      level: 'error',
      tags: { function: FN, failure_class: 'worker_failure' },
      extra: { error: message },
    })
    log('error', FN, 'unhandled', { error: message })
    return jsonResponse({ ok: false, error: message || 'Internal server error' }, 500, cors)
  }
})
