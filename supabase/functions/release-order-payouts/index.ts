import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { enqueuePushJob } from '../_shared/side-effect-jobs.ts'
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
import { createPaystackTransfer } from '../_shared/paystack.ts'
import { createStripeTransfer } from '../_shared/stripe.ts'
import { logPreflightFailure, runPreflight } from '../_shared/preflight.ts'
import { getProviderCircuit, recordProviderHealth } from '../_shared/provider-health.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  PAYOUT_BLOCKED_REASONS,
  payoutBlockReasonMessage,
} from '../../../packages/shared/src/payout-gating.ts'
import { payoutWindowClosesAt } from '../../../packages/shared/src/payout-timing.ts'

const FN = 'release-order-payouts'

const BodySchema = z.object({
  orderId: uuid.optional(),
})

type PayoutRowStatus = 'PROCESSING' | 'PAID' | 'FAILED' | 'BLOCKED'

type ExistingPayoutRow = {
  id: string
  status: string
  blocked_reason: string | null
  provider_response: Record<string, unknown> | null
}

async function notifyTailorPayoutFailure(
  supabase: any,
  order: PayoutCandidateOrder,
  error: string,
) {
  if (!order.tailor_id) return

  await enqueuePushJob(supabase, {
    userId: order.tailor_id.toString(),
    source: FN,
    orderId: order.id,
    idempotencyKey: `payout-failure:${order.id}`,
    priority: 10,
    notification: {
      title: 'Payout needs review',
      body: 'A payout release for this order needs Drape ops review before it can be retried.',
      preferenceKey: 'paymentReleased',
      data: {
        orderId: order.id,
        reason: error.slice(0, 120),
      },
    },
  })
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
  supabase: any,
  order: PayoutCandidateOrder,
  tailorProfile: TailorPayoutProfile | null,
  payment: SuccessfulOrderPayment | null,
  blockedReason: PayoutBlockedReason,
  extra?: Record<string, unknown>,
) {
  const recommendedAction = blockedReason === PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH
    ? 'Choose an ops payout resolution for this order: retry the original locked currency, convert to the current payout currency, or refund the customer if the order cannot be settled cleanly.'
    : 'Verify delivery confirmation, dispute state, settled payment, and payout account readiness before retrying payout release.'

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
    description: `A payout release for order ${order.reference ?? order.id} is blocked because ${blockedReason.replace(/_/gu, ' ').toLowerCase()}.`,
    recommendedAction,
    dedupeKey: `payout-blocked:${order.id}:${blockedReason}`,
    metadata: {
      blocked_reason: blockedReason,
      blocked_reason_message: payoutBlockReasonMessage(blockedReason),
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
  supabase: any,
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

async function recordPayoutProviderEvent(
  supabase: any,
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

async function fetchCandidateOrders(supabase: any, orderId?: string) {
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

async function fetchTailorProfile(supabase: any, tailorUserId: string) {
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select('id, user_id, display_name, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type, payout_destination_hold_until, paystack_recipient_code, stripe_connect_account_id')
    .eq('user_id', tailorUserId)
    .maybeSingle()

  if (error) throw error
  return (data as TailorPayoutProfile | null) ?? null
}

async function fetchSettledOrderPayment(supabase: any, orderId: string) {
  const { data, error } = await supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, refunded_amount')
    .eq('order_id', orderId)
    .eq('phase', 'INITIAL_ORDER')
    .in('status', ['SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED'])
    .order('confirmed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as SuccessfulOrderPayment | null) ?? null
}

async function hasOpenDispute(supabase: any, orderId: string) {
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

async function findExistingPayout(supabase: any, orderId: string, statuses: string[]) {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, status, blocked_reason, provider_response')
    .eq('order_id', orderId)
    .in('status', statuses)
    .order('processed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as ExistingPayoutRow | null) ?? null
}

async function recordBlockedPayout(
  supabase: any,
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
    return { skipped: true as const, id: duplicate.id }
  }

  const payload = {
    tailor_profile_id: tailorProfile?.id,
    order_id: order.id,
    amount: fallbackBlockedAmount(order),
    currency: fallbackBlockedCurrency(order, tailorProfile),
    provider: fallbackBlockedProvider(order, tailorProfile),
    status: 'BLOCKED' satisfies PayoutRowStatus,
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
  return { skipped: false as const, id: (data as { id: string }).id }
}

async function updatePayoutRow(
  supabase: any,
  payoutId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('payouts')
    .update(patch)
    .eq('id', payoutId)

  if (error) throw error
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized

    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
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

    const candidates = await fetchCandidateOrders(supabase, parsed.data.orderId)
    const now = Date.now()

    let released = 0
    let blocked = 0
    let skipped = 0
    const results: Array<Record<string, unknown>> = []

    for (const order of candidates) {
      let payoutIdForFailure: string | null = null
      try {
        const existingTriggered = await findExistingPayout(supabase, order.id, ['PROCESSING', 'PAID', 'FAILED', 'REVERSED'])
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

        const earlyReleaseReason = payoutReleaseReason(order, now)
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
        const baseBlockedReason = earlyReleaseReason
        const settledPaymentRefunded = !!settledPayment && (
          settledPayment.status === 'PARTIAL_REFUND'
          || settledPayment.status === 'REFUNDED'
          || (typeof settledPayment.refunded_amount === 'number' && settledPayment.refunded_amount > 0)
        )
        const lockedDestinationAvailable =
          resolvedPaystackRecipientCode(order, tailorProfile) !== null
          || resolvedStripeAccountId(order, tailorProfile) !== null
        const destinationHoldMs = tailorProfile?.payout_destination_hold_until
          ? Date.parse(tailorProfile.payout_destination_hold_until)
          : Number.NaN
        const destinationOnHold = Number.isFinite(destinationHoldMs) && destinationHoldMs > Date.now()
        const payoutMoney = resolveEffectivePayoutMoney(order)
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

        const preflight = runPreflight([
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
            name: 'no_open_dispute',
            condition: !openDispute,
            errorCode: PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE),
            field: 'disputes',
            severity: 'BLOCKING',
            actual: { openDispute },
          },
          {
            name: 'settled_payment_exists',
            condition: !!settledPayment,
            errorCode: PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT),
            field: 'order_payments',
            severity: 'BLOCKING',
            actual: { settledPaymentId: settledPayment?.id ?? null },
          },
          {
            name: 'payment_not_refunded',
            condition: !settledPaymentRefunded,
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
            name: 'payout_destination_not_on_hold',
            condition: !destinationOnHold,
            errorCode: PAYOUT_BLOCKED_REASONS.PAYOUT_DESTINATION_HOLD,
            message: payoutPreflightMessage(PAYOUT_BLOCKED_REASONS.PAYOUT_DESTINATION_HOLD),
            field: 'payout_destination_hold_until',
            severity: 'BLOCKING',
            actual: { payout_destination_hold_until: tailorProfile?.payout_destination_hold_until ?? null },
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
            source_payment_id: payoutSourcePayment.id,
            provider_response: {
              function: FN,
              order_stage: order.stage,
              source_payment_id: payoutSourcePayment.id,
              customer_handoff_confirmed_at: order.customer_handoff_confirmed_at,
              handoff_completed_at: order.handoff_completed_at,
            },
          })
          .select('id')
          .single()

        if (createPayoutError || !(createdPayout as { id?: string } | null)?.id) {
          throw new Error(createPayoutError?.message ?? 'Could not create payout row.')
        }

        const payoutId = (createdPayout as { id: string }).id
        payoutIdForFailure = payoutId

        if (payoutMoney.provider === 'PAYSTACK') {
          let transfer
          try {
            transfer = await createPaystackTransfer({
              amount: payoutMoney.amount,
              recipientCode: paystackRecipientCode!,
              reason: `Drape payout for order ${order.reference ?? order.id}`,
              reference: `DRAPE-PAYOUT-${order.id}`,
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
            },
            status: transfer.status === 'success' ? 'PAID' : 'PROCESSING',
            completed_at: transfer.status === 'success' ? new Date().toISOString() : null,
          })
        } else {
          let transfer
          try {
            transfer = await createStripeTransfer({
              amount: payoutMoney.amount,
              currency: payoutMoney.currency,
              destinationAccountId: stripeAccountId!,
              idempotencyKey: `DRAPE-PAYOUT-${order.id}`,
              transferGroup: `order:${order.id}`,
              metadata: {
                order_id: order.id,
                payout_id: payoutId,
                tailor_profile_id: payoutTailorProfile.id,
                payout_currency: payoutMoney.currency,
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
            provider_response: {
              function: FN,
              transfer,
              source_payment_id: payoutSourcePayment.id,
            },
          })
        }

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

        await audit(supabase, {
          event: 'payout.released',
          actor_role: 'SYSTEM',
          order_id: order.id,
          payload: {
            function: FN,
            payout_id: payoutId,
            payout_currency: payoutMoney.currency,
            payout_amount: payoutMoney.amount,
            provider: payoutMoney.provider,
            source_payment_id: payoutSourcePayment.id,
          },
        })

        released += 1
        results.push({ orderId: order.id, result: 'released', payoutId, provider: payoutMoney.provider, currency: payoutMoney.currency, amount: payoutMoney.amount })
      } catch (error) {
        skipped += 1
        const message = errorMessage(error)
        log('error', FN, 'release.failed', { order_id: order.id, error: message })
        if (payoutIdForFailure) {
          await updatePayoutRow(supabase, payoutIdForFailure, {
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            provider_response: {
              function: FN,
              error: message,
              failed_after_payout_row_created: true,
            },
          }).catch((updateError) => {
            log('error', FN, 'payout_status_update_failed', {
              order_id: order.id,
              payout_id: payoutIdForFailure,
              error: errorMessage(updateError),
            })
          })
        }
        const tailorProfile = order.tailor_id ? await fetchTailorProfile(supabase, order.tailor_id).catch(() => null) : null
        await refreshFailedPayoutIssue(supabase, order, tailorProfile, message, {
          payout_id: payoutIdForFailure,
        })
        await notifyTailorPayoutFailure(supabase, order, message)
        await audit(supabase, {
          event: 'payout.release_failed',
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

    return jsonResponse({ ok: true, released, blocked, skipped, results }, 200, cors)
  } catch (error) {
    const message = errorMessage(error)
    log('error', FN, 'unhandled', { error: message })
    return jsonResponse({ ok: false, error: message || 'Internal server error' }, 500, cors)
  }
})
