import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertCommercialPaymentRefundReady,
  recordCommercialPaymentRefund,
} from './commercial-ledger.ts'
import { Sentry } from './sentry.ts'
import { audit } from './logger.ts'
import { markPaymentAttemptStatus } from './payment-ledger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { refundPaystackTransaction, type PaystackRefund } from './paystack.ts'
import { refundStripePaymentIntent, type StripeRefund } from './stripe.ts'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'
type PaymentPhase = 'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT' | 'MATERIAL_ADVANCE'
type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'PARTIAL_REFUND' | 'REFUNDED'
type ActorRole = 'OPS' | 'CUSTOMER' | 'TAILOR' | 'SYSTEM'
export type ExactRefundRestoration = {
  refundResolutionId: string
  tailorWorkAmount: number
  platformFeeAmount: number
  taxAmount: number
  fulfillmentAmount: number
  consultationAmount: number
  promotionAmount: number
  drapeonFundedAmount: number
}

export type RefundablePaymentAttemptRow = {
  id: string
  order_id: string
  phase: PaymentPhase
  provider: PaymentProvider
  currency: string
  amount: number
  status: PaymentStatus
  provider_payment_id: string | null
  provider_response?: Record<string, unknown> | null
  refunded_amount?: number | null
  partial_refund_count?: number | null
}

export type RefundedAttemptSummary = {
  id: string
  provider: PaymentProvider
  providerPaymentId: string
  phase: PaymentPhase
  amount: number
  currency: string
  remainingRefundableAmount: number
  totalRefundedAmount: number
  partial: boolean
}

export type PendingRefundSummary = {
  id: string
  provider: PaymentProvider
  providerPaymentId: string
  providerRefundId: string | null
  phase: PaymentPhase
  amount: number
  currency: string
  status: string
}

export type RefundSettledOrderPaymentsResult = {
  refundedAttempts: RefundedAttemptSummary[]
  pendingAttempts: PendingRefundSummary[]
  alreadyRefundedAttemptIds: string[]
}

export type PartialRefundOrderPaymentsResult = {
  refundedAttempts: RefundedAttemptSummary[]
  pendingAttempts: PendingRefundSummary[]
  alreadyRefundedAttemptIds: string[]
  totalRefundedAmount: number
  remainingRefundableAmount: number
}

function paystackRefundId(response: PaystackRefund) {
  return typeof response.id === 'number' ? String(response.id) : null
}

function paystackRefundIsTerminal(response: PaystackRefund) {
  return response.status?.trim().toLowerCase() === 'processed'
}

function stripeRefundIsTerminal(response: StripeRefund) {
  return response.status?.trim().toLowerCase() === 'succeeded'
}

function activeProviderRefundRequest(attempt: RefundablePaymentAttemptRow) {
  if (!attempt.provider_response || typeof attempt.provider_response !== 'object') return null
  const request = attempt.provider_response.latest_refund_request
  if (!request || typeof request !== 'object') return null
  const response = (request as Record<string, unknown>).response
  if (!response || typeof response !== 'object') return null
  const status = typeof (response as Record<string, unknown>).status === 'string'
    ? ((response as Record<string, unknown>).status as string).trim().toLowerCase()
    : ''
  if (!['pending', 'processing', 'needs-attention', 'requires_action'].includes(status)) return null
  const refundAmount = (request as Record<string, unknown>).refund_amount
  const rawId = (response as Record<string, unknown>).id ?? (response as Record<string, unknown>).refund_reference
  return {
    amount: typeof refundAmount === 'number' ? refundAmount : null,
    id: typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null,
    status: status.toUpperCase(),
  }
}

async function recordPendingRefundRequest(
  supabase: SupabaseClient,
  input: {
    attempt: RefundablePaymentAttemptRow
    refundAmount: number
    providerResponse: RefundProviderResponse
    actorRole: ActorRole
    actorId?: string | null
    reason?: string | null
    exactRestoration?: ExactRefundRestoration
  },
) {
  const existing = input.attempt.provider_response && typeof input.attempt.provider_response === 'object'
    ? input.attempt.provider_response
    : {}
  const request = {
    requested_at: new Date().toISOString(),
    refund_amount: input.refundAmount,
    currency: input.attempt.currency,
    actor_role: input.actorRole,
    actor_id: input.actorId ?? null,
    reason: input.reason ?? null,
    refund_resolution_id: input.exactRestoration?.refundResolutionId ?? null,
    exact_restoration: input.exactRestoration ?? null,
    response: input.providerResponse,
  }
  const pendingRefunds = Array.isArray(existing.pending_refunds) ? existing.pending_refunds : []
  const providerResponse = {
    ...existing,
    latest_refund_request: request,
    pending_refunds: [...pendingRefunds, request],
  }
  const { error } = await supabase.from('order_payments').update({ provider_response: providerResponse }).eq('id', input.attempt.id)
  if (error) throw new Error(error.message)
  input.attempt.provider_response = providerResponse
}

type RefundProviderResponse = StripeRefund | PaystackRefund

type RefundDependencies = {
  refundStripePaymentIntent: typeof refundStripePaymentIntent
  refundPaystackTransaction: typeof refundPaystackTransaction
  markPaymentAttemptStatus: typeof markPaymentAttemptStatus
  recordCommercialPaymentRefund: typeof recordCommercialPaymentRefund
  assertCommercialPaymentRefundReady?: typeof assertCommercialPaymentRefundReady
}

const DEFAULT_DEPS: RefundDependencies = {
  refundStripePaymentIntent,
  refundPaystackTransaction,
  markPaymentAttemptStatus,
  recordCommercialPaymentRefund,
  assertCommercialPaymentRefundReady,
}

export class RefundLedgerReconciliationError extends Error {
  readonly paymentId: string
  readonly providerRefundCompleted = true

  constructor(paymentId: string, causeMessage: string) {
    super('The provider refund completed, but ledger reconciliation is still pending. Do not retry the provider refund.')
    this.name = 'RefundLedgerReconciliationError'
    this.paymentId = paymentId
    this.cause = new Error(causeMessage)
  }
}

async function assertRefundAttemptReady(
  supabase: SupabaseClient,
  input: {
    attempt: RefundablePaymentAttemptRow
    refundAmount: number
    reason?: string | null
    actorRole: ActorRole
    actorId?: string | null
    exactRestoration?: ExactRefundRestoration
  },
  deps: RefundDependencies,
) {
  if (!deps.assertCommercialPaymentRefundReady) return
  const beforeRefunded = currentRefundedAmount(input.attempt)
  await deps.assertCommercialPaymentRefundReady(supabase, {
    paymentId: input.attempt.id,
    orderId: input.attempt.order_id,
    refundAmount: input.refundAmount,
    idempotencyKey: `payment-refund:${input.attempt.id}:${beforeRefunded}:${input.refundAmount}`,
    metadata: {
      actor_role: input.actorRole,
      actor_id: input.actorId ?? null,
      reason: input.reason ?? null,
    },
    exactRestoration: input.exactRestoration,
  })
}

function currentRefundedAmount(attempt: RefundablePaymentAttemptRow) {
  if (attempt.status === 'REFUNDED') return attempt.amount
  const value = typeof attempt.refunded_amount === 'number' ? attempt.refunded_amount : 0
  return Math.max(Math.min(value, attempt.amount), 0)
}

function remainingRefundableAmount(attempt: RefundablePaymentAttemptRow) {
  return Math.max(attempt.amount - currentRefundedAmount(attempt), 0)
}

function appendRefundProviderResponse(input: {
  attempt: RefundablePaymentAttemptRow
  refundAmount: number
  providerResponse: RefundProviderResponse
  actorRole: ActorRole
  actorId?: string | null
  reason?: string | null
}) {
  const existingResponse =
    input.attempt.provider_response && typeof input.attempt.provider_response === 'object'
      ? input.attempt.provider_response
      : {}
  const existingPartialRefunds = Array.isArray((existingResponse as Record<string, unknown>).partial_refunds)
    ? ((existingResponse as Record<string, unknown>).partial_refunds as unknown[])
    : []
  const now = new Date().toISOString()
  const refundEntry = {
    refunded_at: now,
    refund_amount: input.refundAmount,
    currency: input.attempt.currency,
    actor_role: input.actorRole,
    actor_id: input.actorId ?? null,
    reason: input.reason ?? null,
    response: input.providerResponse as Record<string, unknown>,
  }

  return {
    ...existingResponse,
    latest_refund: refundEntry,
    partial_refunds: [...existingPartialRefunds, refundEntry],
  }
}

export async function finalizeRefundOnAttempt(
  supabase: SupabaseClient,
  input: {
    attempt: RefundablePaymentAttemptRow
    refundAmount: number
    providerResponse: RefundProviderResponse
    actorRole: ActorRole
    actorId?: string | null
    reason?: string | null
    exactRestoration?: ExactRefundRestoration
  },
  deps: RefundDependencies = DEFAULT_DEPS,
) {
  const beforeRefunded = currentRefundedAmount(input.attempt)
  const totalRefundedAmount = Math.min(input.attempt.amount, beforeRefunded + input.refundAmount)
  const remainingAmount = Math.max(input.attempt.amount - totalRefundedAmount, 0)
  const nextStatus: PaymentStatus = remainingAmount <= 0 ? 'REFUNDED' : 'PARTIAL_REFUND'
  const now = new Date().toISOString()
  const providerResponse = appendRefundProviderResponse({
    attempt: input.attempt,
    refundAmount: input.refundAmount,
    providerResponse: input.providerResponse,
    actorRole: input.actorRole,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
  })

  const patch: Record<string, unknown> = {
    status: nextStatus,
    refunded_amount: totalRefundedAmount,
    partial_refund_count: Math.max((input.attempt.partial_refund_count ?? 0), 0) + 1,
    last_refund_amount: input.refundAmount,
    last_refund_at: now,
    provider_response: providerResponse,
  }

  if (nextStatus === 'REFUNDED') patch.refunded_at = now

  const { error } = await supabase
    .from('order_payments')
    .update(patch)
    .eq('id', input.attempt.id)

  if (error) throw new Error(error.message)

  input.attempt.status = nextStatus
  input.attempt.refunded_amount = totalRefundedAmount
  input.attempt.partial_refund_count = patch.partial_refund_count as number
  input.attempt.provider_response = providerResponse

  try {
    const rawProviderReference = (input.providerResponse as Record<string, unknown>).id
    await deps.recordCommercialPaymentRefund(supabase, {
      paymentId: input.attempt.id,
      orderId: input.attempt.order_id,
      refundAmount: input.refundAmount,
      idempotencyKey: `payment-refund:${input.attempt.id}:${beforeRefunded}:${input.refundAmount}`,
      providerReference: typeof rawProviderReference === 'string' || typeof rawProviderReference === 'number'
        ? String(rawProviderReference)
        : null,
      metadata: {
        actor_role: input.actorRole,
        actor_id: input.actorId ?? null,
        reason: input.reason ?? null,
      },
      exactRestoration: input.exactRestoration,
    })
  } catch (ledgerError) {
    const ledgerMessage = ledgerError instanceof Error ? ledgerError.message : String(ledgerError)
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'REFUND_FAILED',
      severity: 'CRITICAL',
      source: 'commercial-ledger',
      actorId: input.actorId ?? null,
      actorRole: input.actorRole,
      orderId: input.attempt.order_id,
      provider: input.attempt.provider,
      title: 'Refund completed but ledger reconciliation failed',
      description: 'The provider refund and payment record succeeded, but Drapeon could not post the balanced refund journal.',
      recommendedAction: 'Do not retry the provider refund. Reconcile the existing provider refund against the commercial ledger and close this issue only after the journal is posted.',
      dedupeKey: `refund-ledger-missing:${input.attempt.id}:${beforeRefunded}:${input.refundAmount}`,
      metadata: {
        payment_id: input.attempt.id,
        refund_amount: input.refundAmount,
        refund_resolution_id: input.exactRestoration?.refundResolutionId ?? null,
        error: ledgerMessage,
      },
    })
    try {
      await Sentry.captureMessage('Refund completed without a commercial ledger journal', {
        level: 'error',
        tags: { component: 'commercial-ledger', provider: input.attempt.provider },
        extra: {
          order_id: input.attempt.order_id,
          payment_id: input.attempt.id,
          refund_amount: input.refundAmount,
          error: ledgerMessage,
        },
      })
    } catch {
      // Observability must never hide the reconciliation error that tells Ops not to retry the provider.
    }
    throw new RefundLedgerReconciliationError(input.attempt.id, ledgerMessage)
  }

  return {
    remainingRefundableAmount: remainingAmount,
    totalRefundedAmount,
    partial: nextStatus === 'PARTIAL_REFUND',
  }
}

async function loadRefundableAttempts(
  supabase: SupabaseClient,
  input: {
    orderId: string
    allowedPhases: PaymentPhase[]
  },
) {
  const { data: attemptsData, error: attemptsError } = await supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_response, refunded_amount, partial_refund_count')
    .eq('order_id', input.orderId)
    .in('phase', input.allowedPhases)
    .order('created_at', { ascending: true })

  if (attemptsError) {
    throw new Error(attemptsError.message)
  }

  return (attemptsData as RefundablePaymentAttemptRow[] | null) ?? []
}

export async function refundSettledOrderPayments(
  supabase: SupabaseClient,
  input: {
    orderId: string
    reason?: string | null
    actorRole: ActorRole
    actorId?: string | null
    allowedPhases?: PaymentPhase[]
    exactRestoration?: ExactRefundRestoration
  },
  deps: RefundDependencies = DEFAULT_DEPS,
): Promise<RefundSettledOrderPaymentsResult> {
  const allowedPhases = input.allowedPhases ?? ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT']
  const attempts = await loadRefundableAttempts(supabase, {
    orderId: input.orderId,
    allowedPhases,
  })
  const succeededAttempts = attempts.filter((attempt) => attempt.status === 'SUCCEEDED' || attempt.status === 'PARTIAL_REFUND')
  const alreadyRefundedAttemptIds = attempts
    .filter((attempt) => attempt.status === 'REFUNDED' || remainingRefundableAmount(attempt) <= 0)
    .map((attempt) => attempt.id)

  const refundedAttempts: RefundedAttemptSummary[] = []
  const pendingAttempts: PendingRefundSummary[] = []

  for (const attempt of succeededAttempts) {
    const refundAmount = remainingRefundableAmount(attempt)
    if (refundAmount <= 0) continue

    if (!attempt.provider_payment_id?.trim()) {
      await audit(supabase, {
        event: 'payment.refund_missing_provider_payment_id',
        actor_id: input.actorId ?? null,
        actor_role: input.actorRole,
        order_id: input.orderId,
        severity: 'warn',
        payload: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
        },
      })

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'REFUND_FAILED',
        severity: 'CRITICAL',
        source: 'payment-refunds',
        actorId: input.actorId ?? null,
        actorRole: input.actorRole,
        orderId: input.orderId,
        provider: attempt.provider,
        title: 'Refund could not start',
        description: `A settled ${attempt.provider.toLowerCase()} payment is missing its provider reference and cannot be refunded safely.`,
        recommendedAction: 'Inspect the payment ledger, recover the provider payment reference, and only retry the refund when the original charge can be matched confidently.',
        dedupeKey: `refund-failed:${attempt.id}:missing-provider-reference`,
        metadata: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
        },
      })

      throw new Error(
        'A settled payment is missing its provider payment reference and cannot be refunded safely.',
      )
    }

    const providerPaymentId = attempt.provider_payment_id.trim()
    try {
      const activeRefund = activeProviderRefundRequest(attempt)
      if (activeRefund) {
        if (activeRefund.amount !== refundAmount) {
          throw new Error(`A different ${attempt.provider === 'STRIPE' ? 'Stripe' : 'Paystack'} refund is already processing for this payment. Do not create a second refund.`)
        }
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: activeRefund.id,
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: activeRefund.status,
        })
        continue
      }
      await assertRefundAttemptReady(supabase, {
        attempt,
        refundAmount,
        reason: input.reason ?? null,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        exactRestoration: input.exactRestoration,
      }, deps)
      const providerResponse: RefundProviderResponse = attempt.provider === 'STRIPE'
        ? await deps.refundStripePaymentIntent({
            paymentIntentId: providerPaymentId,
            amount: refundAmount,
            idempotencyKey: `refund:${attempt.id}:${currentRefundedAmount(attempt)}:${refundAmount}`,
            reasonNote: input.reason ?? null,
            metadata: { drapeon_payment_id: attempt.id, drapeon_order_id: attempt.order_id, refund_resolution_id: input.exactRestoration?.refundResolutionId ?? null },
          })
        : await deps.refundPaystackTransaction({
            reference: providerPaymentId,
            amount: refundAmount,
            currency: attempt.currency,
            reasonNote: input.reason ?? null,
          })

      const refundTerminal = attempt.provider === 'STRIPE'
        ? stripeRefundIsTerminal(providerResponse as StripeRefund)
        : paystackRefundIsTerminal(providerResponse as PaystackRefund)
      if (!refundTerminal) {
        await recordPendingRefundRequest(supabase, {
          attempt,
          refundAmount,
          providerResponse,
          actorRole: input.actorRole,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
          exactRestoration: input.exactRestoration,
        })
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: attempt.provider === 'STRIPE' ? (providerResponse as StripeRefund).id : paystackRefundId(providerResponse as PaystackRefund),
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: providerResponse.status?.trim().toUpperCase() || 'PENDING',
        })
        continue
      }

      const recorded = await finalizeRefundOnAttempt(supabase, {
        attempt,
        refundAmount,
        providerResponse,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        exactRestoration: input.exactRestoration,
      }, deps)

      refundedAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        remainingRefundableAmount: recorded.remainingRefundableAmount,
        totalRefundedAmount: recorded.totalRefundedAmount,
        partial: recorded.partial,
      })
    } catch (error) {
      if (error instanceof RefundLedgerReconciliationError) throw error
      const message = error instanceof Error ? error.message : String(error)

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'REFUND_FAILED',
        severity: 'CRITICAL',
        source: 'payment-refunds',
        actorId: input.actorId ?? null,
        actorRole: input.actorRole,
        orderId: input.orderId,
        provider: attempt.provider,
        title: 'Refund execution failed',
        description: `A ${attempt.provider.toLowerCase()} refund attempt failed and needs manual ops review.`,
        recommendedAction: 'Check the provider response, confirm whether the charge was already reversed, and retry the refund only when the payment state is clear.',
        dedupeKey: `refund-failed:${attempt.id}`,
        metadata: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
          provider_payment_id: providerPaymentId,
          error: message,
        },
      })

      throw error
    }
  }

  await audit(supabase, {
    event: 'payment.refund_executed',
    actor_id: input.actorId ?? null,
    actor_role: input.actorRole,
    order_id: input.orderId,
    payload: {
      refunded_attempts: refundedAttempts,
      pending_attempts: pendingAttempts,
      already_refunded_attempt_ids: alreadyRefundedAttemptIds,
      reason: input.reason ?? null,
      allowed_phases: allowedPhases,
    },
  })

  return {
    refundedAttempts,
    pendingAttempts,
    alreadyRefundedAttemptIds,
  }
}

export async function partiallyRefundOrderPayments(
  supabase: SupabaseClient,
  input: {
    orderId: string
    amount: number
    reason?: string | null
    actorRole: ActorRole
    actorId?: string | null
    allowedPhases?: PaymentPhase[]
    exactRestoration?: ExactRefundRestoration
  },
  deps: RefundDependencies = DEFAULT_DEPS,
): Promise<PartialRefundOrderPaymentsResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Partial refund amount must be greater than zero.')
  }

  const allowedPhases = input.allowedPhases ?? ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT']
  const attempts = await loadRefundableAttempts(supabase, {
    orderId: input.orderId,
    allowedPhases,
  })

  const refundableAttempts = attempts.filter((attempt) => {
    if (attempt.status !== 'SUCCEEDED' && attempt.status !== 'PARTIAL_REFUND') return false
    return remainingRefundableAmount(attempt) > 0
  })
  const alreadyRefundedAttemptIds = attempts
    .filter((attempt) => attempt.status === 'REFUNDED' || remainingRefundableAmount(attempt) <= 0)
    .map((attempt) => attempt.id)

  const totalRemainingRefundable = refundableAttempts.reduce((sum, attempt) => sum + remainingRefundableAmount(attempt), 0)
  if (input.amount > totalRemainingRefundable) {
    throw new Error('Requested refund exceeds the remaining refundable amount for this order.')
  }

  let amountLeft = input.amount
  const refundedAttempts: RefundedAttemptSummary[] = []
  const pendingAttempts: PendingRefundSummary[] = []

  for (const attempt of refundableAttempts) {
    if (amountLeft <= 0) break
    if (!attempt.provider_payment_id?.trim()) {
      throw new Error('A partially refundable payment is missing its provider payment reference and cannot be refunded safely.')
    }

    const refundable = remainingRefundableAmount(attempt)
    if (refundable <= 0) continue

    const refundAmount = Math.min(amountLeft, refundable)
    const providerPaymentId = attempt.provider_payment_id.trim()
    const activeRefund = activeProviderRefundRequest(attempt)
    if (activeRefund) {
      if (activeRefund.amount !== refundAmount) {
        throw new Error(`A different ${attempt.provider === 'STRIPE' ? 'Stripe' : 'Paystack'} refund is already processing for this payment. Do not create a second refund.`)
      }
      pendingAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        providerRefundId: activeRefund.id,
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        status: activeRefund.status,
      })
      amountLeft -= refundAmount
      continue
    }
    await assertRefundAttemptReady(supabase, {
      attempt,
      refundAmount,
      reason: input.reason ?? null,
      actorRole: input.actorRole,
      actorId: input.actorId ?? null,
      exactRestoration: input.exactRestoration,
    }, deps)
    const providerResponse: RefundProviderResponse = attempt.provider === 'STRIPE'
      ? await deps.refundStripePaymentIntent({
          paymentIntentId: providerPaymentId,
          amount: refundAmount,
          idempotencyKey: `partial-refund:${attempt.id}:${currentRefundedAmount(attempt)}:${refundAmount}`,
          reasonNote: input.reason ?? null,
          metadata: { drapeon_payment_id: attempt.id, drapeon_order_id: attempt.order_id, refund_resolution_id: input.exactRestoration?.refundResolutionId ?? null },
        })
      : await deps.refundPaystackTransaction({
          reference: providerPaymentId,
          amount: refundAmount,
          currency: attempt.currency,
          reasonNote: input.reason ?? null,
        })

    const refundTerminal = attempt.provider === 'STRIPE'
      ? stripeRefundIsTerminal(providerResponse as StripeRefund)
      : paystackRefundIsTerminal(providerResponse as PaystackRefund)
    if (!refundTerminal) {
      await recordPendingRefundRequest(supabase, {
        attempt,
        refundAmount,
        providerResponse,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        exactRestoration: input.exactRestoration,
      })
      pendingAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        providerRefundId: attempt.provider === 'STRIPE' ? (providerResponse as StripeRefund).id : paystackRefundId(providerResponse as PaystackRefund),
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        status: providerResponse.status?.trim().toUpperCase() || 'PENDING',
      })
      amountLeft -= refundAmount
      continue
    }

    const recorded = await finalizeRefundOnAttempt(supabase, {
      attempt,
      refundAmount,
      providerResponse,
      actorRole: input.actorRole,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
      exactRestoration: input.exactRestoration,
    }, deps)

    refundedAttempts.push({
      id: attempt.id,
      provider: attempt.provider,
      providerPaymentId,
      phase: attempt.phase,
      amount: refundAmount,
      currency: attempt.currency,
      remainingRefundableAmount: recorded.remainingRefundableAmount,
      totalRefundedAmount: recorded.totalRefundedAmount,
      partial: recorded.partial,
    })

    amountLeft -= refundAmount
  }

  if (amountLeft > 0) {
    throw new Error('Drapeon could not allocate the requested refund amount safely across the order payments.')
  }

  await audit(supabase, {
    event: 'payment.partial_refund_executed',
    actor_id: input.actorId ?? null,
    actor_role: input.actorRole,
    order_id: input.orderId,
    payload: {
      refunded_attempts: refundedAttempts,
      pending_attempts: pendingAttempts,
      already_refunded_attempt_ids: alreadyRefundedAttemptIds,
      requested_amount: input.amount,
      reason: input.reason ?? null,
      allowed_phases: allowedPhases,
    },
  })

  return {
    refundedAttempts,
    pendingAttempts,
    alreadyRefundedAttemptIds,
    totalRefundedAmount: refundedAttempts.reduce((sum, attempt) => sum + attempt.amount, 0),
    remainingRefundableAmount: Math.max(totalRemainingRefundable - input.amount, 0),
  }
}
