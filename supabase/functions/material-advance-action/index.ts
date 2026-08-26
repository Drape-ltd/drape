/**
 * material-advance-action
 *
 * Launch-safe material advances:
 * - never release the main order escrow early
 * - tailor requests a specific order expense
 * - customer approves and pays that exact expense
 * - ops releases only the approved material amount
 * - tailor uploads receipt/proof against the advance
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { initializePaystackTransaction, verifyPaystackTransaction, createPaystackTransfer } from '../_shared/paystack.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent, createStripeTransfer } from '../_shared/stripe.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { getProviderCircuit, recordProviderHealth } from '../_shared/provider-health.ts'
import { markPaymentAttemptStatus, upsertPreparedPaymentAttempt } from '../_shared/payment-ledger.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency, type AccountCurrencyCode } from '../../../packages/shared/src/currency-config.ts'
import {
  isMaterialAdvanceDeclineReason,
  materialFundingDestinationData,
  materialAdvanceDeclineReasonLabel,
  type MaterialFundingEvent,
} from '../../../packages/shared/src/material-advances.ts'
import { Sentry } from '../_shared/sentry.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'material-advance-action'
const MAX_MONEY_MINOR_UNITS = 999_999_999
const ACTIVE_ORDER_STAGES = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
]

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request-advance'),
    orderId: uuid,
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(1000),
    amount: z.number().int().positive().max(MAX_MONEY_MINOR_UNITS),
    currency: z.string().trim().min(2).max(5),
    estimatePhotoUrl: z.string().trim().url().optional(),
    estimateStorageBucket: z.string().trim().min(2).max(100),
    estimateStoragePath: z.string().trim().min(3).max(500),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
  }),
  z.object({
    action: z.literal('respond-advance'),
    advanceId: uuid,
    decision: z.enum(['APPROVE', 'DECLINE']),
    declineReason: z.string().trim().max(50).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('prepare-payment'),
    advanceId: uuid,
  }),
  z.object({
    action: z.literal('confirm-payment'),
    advanceId: uuid,
    paymentIntentId: z.string().trim().min(1).optional(),
  }),
  z.object({
    action: z.literal('upload-receipt'),
    advanceId: uuid,
    receiptUrl: z.string().trim().url().optional(),
    receiptStorageBucket: z.string().trim().min(2).max(100),
    receiptStoragePath: z.string().trim().min(3).max(500),
    acquiredStorageBucket: z.string().trim().min(2).max(100).optional(),
    acquiredStoragePath: z.string().trim().min(3).max(500).optional(),
    actualSpentAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('release-advance'),
    advanceId: uuid,
    moneyDeskRequestId: uuid,
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('finalize-unused-refund'),
    advanceId: uuid,
    moneyDeskRequestId: uuid,
    actorRef: z.string().trim().min(3).max(320),
  }),
  z.object({
    action: z.literal('resolve-overage'),
    advanceId: uuid,
    actorRef: z.string().trim().min(3).max(320),
    note: z.string().trim().min(10).max(500),
  }),
  z.object({
    action: z.literal('record-release-rejection'),
    advanceId: uuid,
    moneyDeskRequestId: uuid,
    actorRef: z.string().trim().min(3).max(320),
    note: z.string().trim().max(500).optional(),
  }),
])

type PaymentProvider = 'STRIPE' | 'PAYSTACK'
type MaterialAdvanceStatus =
  | 'REQUESTED'
  | 'DECLINED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PAID'
  | 'OPS_REVIEW'
  | 'RELEASED'
  | 'BLOCKED'
  | 'CANCELLED'

type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  currency?: string | null
  quoted_currency?: string | null
  quoted_amount?: number | null
  total_amount?: number | null
  escrow_released?: boolean | null
  fabric_funding_policy_version?: string | null
  fabric_source?: string | null
}

type MaterialAdvanceRow = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  requested_by: string
  title: string
  description: string
  amount: number
  currency: string
  status: MaterialAdvanceStatus
  release_status: 'NOT_REQUESTED' | 'OPS_REVIEW' | 'RELEASED' | 'BLOCKED'
  estimate_photo_url?: string | null
  receipt_url?: string | null
  payment_provider?: PaymentProvider | null
  provider_payment_id?: string | null
  provider_checkout_url?: string | null
  payment_id?: string | null
  paid_at?: string | null
  released_at?: string | null
  actual_spent_amount?: number | null
  reconciliation_status?: string | null
  reconciliation_delta?: number | null
  reconciled_at?: string | null
  reconciliation_case_id?: string | null
  acquired_storage_bucket?: string | null
  acquired_storage_path?: string | null
  reconciliation_outcome?: 'EXACT' | 'UNUSED_VALUE' | 'OVERAGE' | null
  customer_refund_amount?: number | null
  unapproved_overage_amount?: number | null
  reconciliation_resolution?: string | null
  funding_source?: 'LEGACY_SEPARATE_PAYMENT' | 'FUNDED_FABRIC_ALLOWANCE'
  fabric_allocation_id?: string | null
  fabric_approval_evidence_id?: string | null
  money_desk_request_id?: string | null
  payout_id?: string | null
  provider_release_status?: string | null
  correlation_id?: string | null
  ops_issue_id?: string | null
}

type TailorProfileRow = {
  id: string
  user_id: string
  payout_currency?: string | null
  payout_provider?: PaymentProvider | null
  payout_account_verified?: boolean | null
  payout_reverification_required?: boolean | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return jsonResponse({ error: code, message, ...(extra ?? {}) }, status, cors)
}

function serviceRoleRequest(req: Request) {
  const authorization = req.headers.get('authorization') ?? ''
  return authorization === `Bearer ${getServiceRoleKey()}`
}

function normalizedCurrency(value: string | null | undefined): AccountCurrencyCode | null {
  return normalizeAccountCurrency(value)
}

function providerForCurrency(currency: AccountCurrencyCode): PaymentProvider {
  return resolvePaymentProviderForCurrency(currency)
}

function buildPaymentReference(advanceId: string) {
  return `DRAPE-MATERIAL-${advanceId}`
}

function paymentDescription(order: OrderRow, advance: MaterialAdvanceRow) {
  return `Drapeon material advance #${order.reference ?? order.id} - ${advance.title}`
}

function releaseReference(advanceId: string) {
  return `DRAPE-MATERIAL-RELEASE-${advanceId}`
}

async function fetchOrder(supabase: any, orderId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, customer_id, tailor_id, currency, quoted_currency, quoted_amount, total_amount, escrow_released, fabric_funding_policy_version, fabric_source')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  return (data as OrderRow | null) ?? null
}

async function fetchAdvance(supabase: any, advanceId: string) {
  const { data, error } = await supabase
    .from('order_material_advances')
    .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at, actual_spent_amount, reconciliation_status, reconciliation_delta, reconciled_at, reconciliation_case_id, acquired_storage_bucket, acquired_storage_path, reconciliation_outcome, customer_refund_amount, unapproved_overage_amount, reconciliation_resolution, funding_source, fabric_allocation_id, fabric_approval_evidence_id, money_desk_request_id, payout_id, provider_release_status, correlation_id, ops_issue_id')
    .eq('id', advanceId)
    .maybeSingle()
  if (error) throw error
  return (data as MaterialAdvanceRow | null) ?? null
}

async function fetchSettledInitialPayment(supabase: any, orderId: string) {
  const { data, error } = await supabase
    .from('order_payments')
    .select('id, amount, currency, status')
    .eq('order_id', orderId)
    .eq('phase', 'INITIAL_ORDER')
    .in('status', ['SUCCEEDED', 'PARTIAL_REFUND'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; amount: number; currency: string; status: string } | null
}

async function hasOpenDispute(supabase: any, orderId: string) {
  const { data, error } = await supabase
    .from('disputes')
    .select('id')
    .eq('order_id', orderId)
    .in('status', ['OPEN', 'UNDER_REVIEW'])
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return !!data?.id
}

async function hasUnreconciledReleasedAdvance(supabase: any, orderId: string) {
  const { data, error } = await supabase
    .from('order_material_advances')
    .select('id, reconciliation_status, reconciled_at')
    .eq('order_id', orderId)
    .eq('release_status', 'RELEASED')
    .or('reconciled_at.is.null,reconciliation_status.in.(OPS_REVIEW,UNUSED_VALUE,OVERAGE)')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return !!data?.id
}

async function fetchPaymentAttempt(supabase: any, paymentId: string | null | undefined) {
  if (!paymentId) return null
  const { data, error } = await supabase
    .from('order_payments')
    .select('id, status, provider, currency, amount, provider_payment_id, provider_checkout_url, idempotency_key')
    .eq('id', paymentId)
    .maybeSingle()
  if (error) throw error
  return data as {
    id: string
    status: string
    provider: PaymentProvider
    currency: string
    amount: number
    provider_payment_id: string | null
    provider_checkout_url: string | null
    idempotency_key: string
  } | null
}

async function fetchTailorProfile(supabase: any, tailorUserId: string) {
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select('id, user_id, payout_currency, payout_provider, payout_account_verified, payout_reverification_required, paystack_recipient_code, stripe_connect_account_id')
    .eq('user_id', tailorUserId)
    .maybeSingle()
  if (error) throw error
  return (data as TailorProfileRow | null) ?? null
}

async function createMaterialAdvanceOpsIssue(
  supabase: any,
  input: {
    order: OrderRow
    advance: MaterialAdvanceRow
    severity: 'MEDIUM' | 'HIGH' | 'CRITICAL'
    title: string
    description: string
    recommendedAction: string
    reason: string
  },
) {
  let fundingDetails: Record<string, unknown> = {}
  if (input.advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' && input.advance.fabric_allocation_id) {
    const { data: allocation } = await supabase.from('order_fabric_funding_allocations')
      .select('id,funded_amount,released_amount,refunded_amount,currency,status,policy_version,pricing_version')
      .eq('id', input.advance.fabric_allocation_id).maybeSingle()
    if (allocation?.id) {
      fundingDetails = {
        funding_source: input.advance.funding_source,
        fabric_allocation_id: allocation.id,
        fabric_approval_evidence_id: input.advance.fabric_approval_evidence_id ?? null,
        funded_amount: allocation.funded_amount,
        released_amount: allocation.released_amount,
        refunded_amount: allocation.refunded_amount,
        remaining_amount: Math.max(allocation.funded_amount - allocation.released_amount - allocation.refunded_amount, 0),
        allocation_status: allocation.status,
        policy_version: allocation.policy_version,
        pricing_version: allocation.pricing_version,
        correlation_id: input.advance.correlation_id ?? null,
      }
    }
  }
  const issue = await createOrRefreshOpsIssue(supabase, {
    issueType: input.reason === 'release_failed' ? 'PAYOUT_FAILED' : 'ORDER_REVIEW',
    severity: input.severity,
    source: FN,
    actorRole: 'SYSTEM',
    orderId: input.order.id,
    userId: input.advance.tailor_id,
    provider: input.advance.payment_provider ?? null,
    title: input.title,
    description: input.description,
    recommendedAction: input.recommendedAction,
    dedupeKey: `material-advance:${input.reason}:${input.advance.id}`,
    relatedEntityType: 'order_material_advance',
    relatedEntityId: input.advance.id,
    metadata: {
      advance_id: input.advance.id,
      amount: input.advance.amount,
      currency: input.advance.currency,
      status: input.advance.status,
      release_status: input.advance.release_status,
      reconciliation_outcome: input.advance.reconciliation_outcome ?? null,
      reconciliation_delta: input.advance.reconciliation_delta ?? null,
      customer_refund_amount: input.advance.customer_refund_amount ?? 0,
      unapproved_overage_amount: input.advance.unapproved_overage_amount ?? 0,
      ...fundingDetails,
    },
  })

  if (issue?.id) {
    await supabase
      .from('order_material_advances')
      .update({ ops_issue_id: issue.id })
      .eq('id', input.advance.id)
  }

  return issue
}

async function notifyCustomer(
  supabase: any,
  order: OrderRow,
  subject: string,
  body: string,
  idempotencyKey: string,
  context?: { advanceId?: string; action?: MaterialFundingEvent },
) {
  const pushQueued = await enqueuePushJob(supabase, {
    userId: order.customer_id,
    notification: {
      title: subject,
      body,
      preferenceKey: 'orderUpdates',
      data: context?.advanceId && context.action
        ? materialFundingDestinationData(order.id, context.advanceId, context.action)
        : { destination: 'ORDER', orderId: order.id },
    },
    source: FN,
    idempotencyKey,
    orderId: order.id,
    priority: 20,
  })
  const emailQueued = await enqueueOrderEventEmailJob(supabase, {
    order,
    recipientUserId: order.customer_id,
    audience: 'CUSTOMER',
    subject,
    headline: subject,
    body,
    materialAdvanceId: context?.advanceId ?? null,
    action: context?.action ?? null,
    source: FN,
    idempotencyKey,
    priority: 25,
  })
  return { pushQueued, emailQueued }
}

async function notifyTailor(
  supabase: any,
  order: OrderRow,
  subject: string,
  body: string,
  idempotencyKey: string,
  context?: { advanceId?: string; action?: MaterialFundingEvent },
) {
  const pushQueued = await enqueuePushJob(supabase, {
    userId: order.tailor_id,
    notification: {
      title: subject,
      body,
      preferenceKey: 'orderUpdates',
      data: context?.advanceId && context.action
        ? materialFundingDestinationData(order.id, context.advanceId, context.action)
        : { destination: 'ORDER', orderId: order.id },
    },
    source: FN,
    idempotencyKey,
    orderId: order.id,
    priority: 20,
  })
  const emailQueued = await enqueueOrderEventEmailJob(supabase, {
    order,
    recipientUserId: order.tailor_id,
    audience: 'TAILOR',
    subject,
    headline: subject,
    body,
    ctaLabel: 'Open material request',
    materialAdvanceId: context?.advanceId ?? null,
    action: context?.action ?? null,
    source: FN,
    idempotencyKey,
    priority: 25,
  })
  return { pushQueued, emailQueued }
}

async function markAdvancePaid(
  supabase: any,
  order: OrderRow,
  advance: MaterialAdvanceRow,
  provider: PaymentProvider,
  providerPaymentId: string,
  providerResponse: Record<string, unknown>,
) {
  await markPaymentAttemptStatus(supabase, {
    provider,
    providerPaymentId,
    status: 'SUCCEEDED',
    providerResponse,
  })

  const { data: updated, error } = await supabase
    .from('order_material_advances')
    .update({
      status: 'OPS_REVIEW',
      release_status: 'OPS_REVIEW',
      payment_provider: provider,
      provider_payment_id: providerPaymentId,
      provider_checkout_url: null,
      paid_at: new Date().toISOString(),
      release_requested_at: new Date().toISOString(),
    })
    .eq('id', advance.id)
    .in('status', ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW'])
    .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at')
    .maybeSingle()

  if (error) throw error

  const nextAdvance = (updated as MaterialAdvanceRow | null) ?? advance

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: order.stage,
    note: `Material advance paid for ${advance.title}. Drapeon ops will review release before any funds move to the tailor.`,
  })

  await createMaterialAdvanceOpsIssue(supabase, {
    order,
    advance: nextAdvance,
    severity: 'HIGH',
    title: 'Material advance paid',
    description: `Customer paid ${advance.currency} ${(advance.amount / 100).toFixed(2)} for ${advance.title}. Ops must review before releasing this material amount to the tailor.`,
    recommendedAction: 'Confirm the expense is valid for the order, release only this material amount if appropriate, and require receipt proof after purchase.',
    reason: 'paid_release_review',
  })

  await audit(supabase, {
    event: 'material_advance.payment_confirmed',
    actor_role: 'SYSTEM',
    order_id: order.id,
    payload: {
      function: FN,
      advance_id: advance.id,
      provider,
      provider_payment_id: providerPaymentId,
      amount: advance.amount,
      currency: advance.currency,
    },
  })

  await notifyTailor(
    supabase,
    order,
    'Material advance paid',
    'The customer paid the approved material amount. Drapeon ops will review release before funds move.',
    `material-advance-paid:${advance.id}`,
  )

  return nextAdvance
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let activeAction = 'unknown'
  let activeOrderId: string | null = null
  let activeAdvanceId: string | null = null
  let activeCorrelationId: string | null = null
  let activeSupabase: any = null
  let activeOrder: OrderRow | null = null
  let activeAdvance: MaterialAdvanceRow | null = null
  let activeActorRole: 'CUSTOMER' | 'TAILOR' | 'OPS' | 'SYSTEM' = 'SYSTEM'
  try {
    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
    activeSupabase = supabase
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return jsonError(cors, 400, 'VALIDATION_FAILED', 'Check the material advance details and try again.', {
        details: parsed.error,
      })
    }
    activeAction = parsed.data.action

    const isOpsRelease = ['release-advance', 'finalize-unused-refund', 'resolve-overage', 'record-release-rejection'].includes(parsed.data.action)
    const isServiceRole = serviceRoleRequest(req)
    const caller = isServiceRole ? null : await getAuthUser(req)
    activeActorRole = isServiceRole ? 'OPS' : 'SYSTEM'

    if (!caller && !isServiceRole) {
      return jsonError(cors, 401, 'AUTH_REQUIRED', 'Please sign in again before continuing.')
    }

    const rateKey = caller?.id ?? req.headers.get('x-forwarded-for') ?? 'service'
    const allowed = isServiceRole
      ? true
      : await checkRateLimit(supabase, `${FN}:${parsed.data.action}:${rateKey}`, 3600, isOpsRelease ? 60 : 20)
    if (!allowed) return rateLimitExceededResponse(cors)

    if (parsed.data.action === 'request-advance') {
      if (parsed.data.estimateStorageBucket !== 'commercial-evidence') {
        return jsonError(cors, 409, 'PRIVATE_ESTIMATE_REQUIRED', 'Supplier proof must use Drapeon private evidence storage.')
      }
      const order = await fetchOrder(supabase, parsed.data.orderId)
      if (!order?.id) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')
      activeOrderId = order.id
      activeActorRole = 'TAILOR'

      const currency = normalizedCurrency(parsed.data.currency)
      const orderCurrency = normalizedCurrency(order.currency ?? order.quoted_currency)
      const settledPayment = await fetchSettledInitialPayment(supabase, order.id)
      const openDispute = await hasOpenDispute(supabase, order.id)
      const unreconciledAdvance = await hasUnreconciledReleasedAdvance(supabase, order.id)
      const maxAdvance = Math.max(Math.floor((settledPayment?.amount ?? order.total_amount ?? order.quoted_amount ?? 0) * 0.5), 0)
      const fundedFabricClaim = order.fabric_funding_policy_version === 'fabric-funding-2026-08-01-v1'

      const preflight = runPreflight([
        {
          name: 'tailor_owns_order',
          condition: order.tailor_id === caller?.id,
          errorCode: 'ORDER_FORBIDDEN',
          message: 'Only the assigned tailor can request a material advance.',
          field: 'tailor_id',
          severity: 'BLOCKING',
          actual: { tailorId: order.tailor_id, callerId: caller?.id ?? null },
        },
        {
          name: 'custom_order_only',
          condition: (order.order_kind ?? 'CUSTOM') === 'CUSTOM',
          errorCode: 'MATERIAL_ADVANCE_CUSTOM_ONLY',
          message: 'Material advances are only available for custom orders.',
          field: 'order_kind',
          severity: 'BLOCKING',
          actual: { orderKind: order.order_kind ?? null },
        },
        {
          name: 'order_active',
          condition: ACTIVE_ORDER_STAGES.includes(order.stage),
          errorCode: 'ORDER_NOT_ACTIVE',
          message: 'Material advances can only be requested while an order is active.',
          field: 'stage',
          severity: 'BLOCKING',
          actual: { stage: order.stage },
        },
        {
          name: 'initial_payment_settled',
          condition: !!settledPayment?.id,
          errorCode: 'ORDER_NOT_PAID',
          message: 'The main order must be paid before requesting a material advance.',
          field: 'order_payments',
          severity: 'BLOCKING',
          actual: { settledPaymentId: settledPayment?.id ?? null },
        },
        {
          name: 'no_open_dispute',
          condition: !openDispute,
          errorCode: 'ORDER_IN_DISPUTE',
          message: 'Material advances are blocked while an order has an open dispute.',
          field: 'disputes',
          severity: 'BLOCKING',
          actual: { openDispute },
        },
        {
          name: 'previous_advances_reconciled',
          condition: !unreconciledAdvance,
          errorCode: 'MATERIAL_ADVANCE_RECONCILIATION_REQUIRED',
          message: 'Reconcile the released material advance and resolve any unused value or overage before requesting another one.',
          field: 'order_material_advances',
          severity: 'BLOCKING',
          actual: { unreconciledAdvance },
        },
        {
          name: 'escrow_not_released',
          condition: order.escrow_released !== true,
          errorCode: 'ESCROW_ALREADY_RELEASED',
          message: 'This order is already closed out, so a material advance cannot be requested.',
          field: 'escrow_released',
          severity: 'BLOCKING',
          actual: { escrowReleased: order.escrow_released ?? false },
        },
        {
          name: 'currency_matches_order',
          condition: !!currency && !!orderCurrency && currency === orderCurrency,
          errorCode: 'CURRENCY_MISMATCH',
          message: 'The material advance must use the same currency as the order.',
          field: 'currency',
          severity: 'BLOCKING',
          actual: { requestedCurrency: parsed.data.currency, orderCurrency: order.currency ?? order.quoted_currency ?? null },
        },
        {
          name: 'amount_within_launch_guardrail',
          condition: fundedFabricClaim || (maxAdvance > 0 && parsed.data.amount <= maxAdvance),
          errorCode: 'MATERIAL_ADVANCE_TOO_LARGE',
          message: 'This material request is too large for automatic customer approval. Contact Drapeon support for ops review.',
          field: 'amount',
          severity: 'BLOCKING',
          actual: { requestedAmount: parsed.data.amount, maxAdvance },
        },
      ])

      if (!preflight.passed) {
        await logPreflightFailure(supabase, preflight, {
          operation: 'material_advance_request',
          entityType: 'order',
          entityId: order.id,
          orderId: order.id,
          actorId: caller?.id,
          actorRole: 'TAILOR',
          source: FN,
        })
        return preflightFailureResponse(preflight, cors, 409)
      }

      if (fundedFabricClaim) {
        const { data: allocation, error: allocationError } = await supabase
          .from('order_fabric_funding_allocations')
          .select('funded_amount,released_amount,refunded_amount,currency')
          .eq('order_id', order.id)
          .maybeSingle()
        if (allocationError) throw allocationError
        if (!allocation) return jsonError(cors, 409, 'FABRIC_FUNDING_ALLOCATION_NOT_FOUND', 'The protected fabric allowance is not ready yet.')
        const remainingAmount = Math.max(allocation.funded_amount - allocation.released_amount - allocation.refunded_amount, 0)
        if (parsed.data.amount > remainingAmount) {
          return jsonError(cors, 409, 'FABRIC_RELEASE_ADJUSTMENT_REQUIRED', 'This supplier cost is above the protected allowance. Send the prefilled fabric funding change for customer approval.', {
            requestedReleaseAmount: parsed.data.amount,
            remainingAllowanceAmount: remainingAmount,
            shortfallAmount: parsed.data.amount - remainingAmount,
            currency: allocation.currency,
          })
        }
      }

      const blockedDescription = await rejectIfBlockedContact({
        supabase,
        fn: FN,
        cors,
        actorId: caller!.id,
        actorRole: 'TAILOR',
        surface: 'material_advance.description',
        text: parsed.data.description,
        message: "Contact details can't be included in a material advance request.",
        orderId: order.id,
        extra: { action: parsed.data.action },
      })
      if (blockedDescription) return blockedDescription

      const claimWrite = fundedFabricClaim
        ? await supabase.rpc('create_funded_fabric_release_claim', {
            p_order_id: order.id,
            p_tailor_id: caller!.id,
            p_title: parsed.data.title.trim(),
            p_description: parsed.data.description.trim(),
            p_amount: parsed.data.amount,
            p_currency: currency,
            p_estimate_storage_bucket: parsed.data.estimateStorageBucket,
            p_estimate_storage_path: parsed.data.estimateStoragePath,
            p_estimate_photo_url: parsed.data.estimatePhotoUrl ?? null,
            p_idempotency_key: parsed.data.idempotencyKey ?? `funded-fabric:${order.id}:${parsed.data.estimateStoragePath}:${parsed.data.amount}`,
          })
        : await supabase
            .from('order_material_advances')
            .insert({
              order_id: order.id,
              customer_id: order.customer_id,
              tailor_id: order.tailor_id,
              requested_by: caller!.id,
              title: parsed.data.title.trim(),
              description: parsed.data.description.trim(),
              amount: parsed.data.amount,
              currency,
              estimate_photo_url: parsed.data.estimatePhotoUrl ?? null,
              estimate_storage_bucket: parsed.data.estimateStorageBucket ?? null,
              estimate_storage_path: parsed.data.estimateStoragePath ?? null,
            })
            .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at, actual_spent_amount, reconciliation_status, reconciliation_delta, reconciled_at, reconciliation_case_id, funding_source, fabric_allocation_id, fabric_approval_evidence_id, money_desk_request_id, payout_id, provider_release_status, correlation_id')
            .maybeSingle()
      const { data: advance, error } = claimWrite

      if (error) {
        if (error.code === '23505') {
          return jsonError(cors, 409, 'MATERIAL_ADVANCE_ALREADY_OPEN', 'There is already an active material advance on this order.')
        }
        throw error
      }

      const row = advance as MaterialAdvanceRow
      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: `Tailor requested a material advance for ${row.title}. Customer approval is required before any money moves.`,
      })

      await notifyCustomer(
        supabase,
        order,
        fundedFabricClaim ? 'Fabric release approval requested' : 'Material approval requested',
        fundedFabricClaim
          ? `Your tailor requested ${row.currency} ${(row.amount / 100).toFixed(2)} from the fabric allowance you already funded. Review the supplier proof; approving this does not charge you again.`
          : `Your tailor requested a material advance for ${row.title}. Review the cost before paying; the main order funds stay protected.`,
        `material-advance-requested:${row.id}`,
        { advanceId: row.id, action: 'RELEASE_REQUESTED' },
      )

      await audit(supabase, {
        event: 'material_advance.requested',
        actor_id: caller!.id,
        actor_role: 'TAILOR',
        order_id: order.id,
        severity: 'warn',
        payload: { function: FN, advance_id: row.id, amount: row.amount, currency: row.currency, funding_source: row.funding_source ?? 'LEGACY_SEPARATE_PAYMENT' },
      })

      return jsonResponse({ ok: true, advance: row }, 200, cors)
    }

    const advance = 'advanceId' in parsed.data ? await fetchAdvance(supabase, parsed.data.advanceId) : null
    if (!advance?.id) return jsonError(cors, 404, 'MATERIAL_ADVANCE_NOT_FOUND', 'This material advance could not be found.')

    const order = await fetchOrder(supabase, advance.order_id)
    if (!order?.id) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')
    activeOrderId = order.id
    activeAdvanceId = advance.id
    activeCorrelationId = advance.correlation_id ?? null
    activeOrder = order
    activeAdvance = advance
    if (!isServiceRole && caller?.id) {
      activeActorRole = caller.id === advance.customer_id ? 'CUSTOMER' : caller.id === advance.tailor_id ? 'TAILOR' : 'SYSTEM'
    }

    if (parsed.data.action === 'finalize-unused-refund') {
      if (!isServiceRole) return jsonError(cors, 403, 'OPS_ONLY', 'Only Drapeon ops can finalize a material refund.')
      const { data: finalized, error } = await supabase.rpc('finalize_material_unused_value_refund', {
        p_advance_id: advance.id,
        p_money_desk_request_id: parsed.data.moneyDeskRequestId,
        p_actor_email: parsed.data.actorRef,
      })
      if (error) throw error
      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: 'Drapeon completed the customer refund for unused approved fabric value. The settlement recovery and provider outcome are recorded.',
      })
      await Promise.all([
        notifyCustomer(supabase, order, 'Unused fabric value refunded', 'The unused approved fabric amount was sent back through your original payment method. Provider timing may vary.', `material-unused-refund:customer:${advance.id}`, { advanceId: advance.id, action: 'CUSTOMER_REFUND_COMPLETED' }),
        notifyTailor(supabase, order, 'Fabric reconciliation completed', 'Drapeon refunded the unused approved fabric value to the customer and recorded the matching settlement deduction.', `material-unused-refund:tailor:${advance.id}`, { advanceId: advance.id, action: 'CUSTOMER_REFUND_COMPLETED' }),
      ])
      await resolveOpsIssueByDedupeKey(supabase, `material-advance:reconciliation_review:${advance.id}`, { resolution: 'CUSTOMER_REFUNDED', moneyDeskRequestId: parsed.data.moneyDeskRequestId })
      await audit(supabase, {
        event: 'material_advance.unused_value_refund_finalized',
        actor_role: 'OPS',
        order_id: order.id,
        payload: { function: FN, advance_id: advance.id, money_desk_request_id: parsed.data.moneyDeskRequestId, correlation_id: advance.correlation_id, policy_version: order.fabric_funding_policy_version, provider: advance.payment_provider },
      })
      return jsonResponse({ ok: true, advance: finalized }, 200, cors)
    }

    if (parsed.data.action === 'resolve-overage') {
      if (!isServiceRole) return jsonError(cors, 403, 'OPS_ONLY', 'Only Drapeon ops can resolve a material overage.')
      const { data: resolved, error } = await supabase.rpc('resolve_material_overage_as_tailor_absorbed', {
        p_advance_id: advance.id,
        p_actor_email: parsed.data.actorRef,
        p_note: parsed.data.note,
      })
      if (error) throw error
      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: 'Drapeon resolved the supplier overage without charging the customer. The amount above approval remains the tailor’s responsibility.',
      })
      await Promise.all([
        notifyCustomer(supabase, order, 'Fabric overage resolved', 'The supplier overage is resolved. You were not charged for the amount above your approval.', `material-overage-resolved:customer:${advance.id}`, { advanceId: advance.id, action: 'OVERAGE_RESOLVED' }),
        notifyTailor(supabase, order, 'Fabric overage resolved', 'The amount above customer approval is your responsibility and will not be included in customer charges or earnings.', `material-overage-resolved:tailor:${advance.id}`, { advanceId: advance.id, action: 'OVERAGE_RESOLVED' }),
      ])
      await resolveOpsIssueByDedupeKey(supabase, `material-advance:reconciliation_review:${advance.id}`, { resolution: 'TAILOR_ABSORBS' })
      await audit(supabase, {
        event: 'material_advance.overage_resolved',
        actor_role: 'OPS',
        order_id: order.id,
        payload: { function: FN, advance_id: advance.id, correlation_id: advance.correlation_id, policy_version: order.fabric_funding_policy_version, provider: advance.payment_provider, note_recorded: true },
      })
      return jsonResponse({ ok: true, advance: resolved }, 200, cors)
    }

    if (parsed.data.action === 'record-release-rejection') {
      if (!isServiceRole) return jsonError(cors, 403, 'OPS_ONLY', 'Only Drapeon ops can record a release rejection.')
      if (advance.money_desk_request_id !== parsed.data.moneyDeskRequestId) {
        return jsonError(cors, 409, 'MONEY_DESK_REQUEST_MISMATCH', 'This rejection does not match the linked Money Desk review.')
      }
      const { data: moneyRequest, error: moneyRequestError } = await supabase.from('money_desk_requests')
        .select('id,status,action_type,target_id').eq('id', parsed.data.moneyDeskRequestId).maybeSingle()
      if (moneyRequestError) throw moneyRequestError
      if (!moneyRequest?.id || moneyRequest.status !== 'REJECTED' || moneyRequest.action_type !== 'MATERIAL_ADVANCE_RELEASE' || moneyRequest.target_id !== advance.id) {
        return jsonError(cors, 409, 'MONEY_DESK_REJECTION_REQUIRED', 'The linked Money Desk request has not reached a recorded rejection.')
      }
      const { data: updated, error } = await supabase.from('order_material_advances').update({
        status: 'BLOCKED',
        release_status: 'BLOCKED',
        release_blocked_reason: parsed.data.note?.trim() || 'MONEY_DESK_REJECTED',
        blocked_at: new Date().toISOString(),
      }).eq('id', advance.id).in('status', ['OPS_REVIEW', 'BLOCKED']).select('id,status,release_status').maybeSingle()
      if (error) throw error
      await supabase.from('order_stage_updates').insert({ order_id: order.id, stage: order.stage, note: 'Drapeon did not approve this fabric release. No provider transfer was made; the protected balance remains on the order.' })
      await Promise.all([
        notifyCustomer(supabase, order, 'Fabric release was not approved', 'Drapeon did not release this supplier amount. No extra charge or transfer was made, and the protected balance remains on your order.', `material-release-rejected:customer:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_FAILED' }),
        notifyTailor(supabase, order, 'Fabric release was not approved', 'Drapeon did not release this supplier amount. Review the order and submit corrected proof or a new supported request before purchasing.', `material-release-rejected:tailor:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_FAILED' }),
      ])
      await resolveOpsIssueByDedupeKey(supabase, `material-advance:funded_release_review:${advance.id}`, { resolution: 'MONEY_DESK_REJECTED', moneyDeskRequestId: parsed.data.moneyDeskRequestId })
      await audit(supabase, { event: 'material_advance.release_rejected', actor_role: 'OPS', order_id: order.id, severity: 'warn', payload: { function: FN, advance_id: advance.id, money_desk_request_id: parsed.data.moneyDeskRequestId, correlation_id: advance.correlation_id, actor_ref: parsed.data.actorRef, note_recorded: Boolean(parsed.data.note?.trim()) } })
      return jsonResponse({ ok: true, advance: updated }, 200, cors)
    }

    if (parsed.data.action === 'respond-advance') {
      const preflight = runPreflight([
        {
          name: 'customer_owns_order',
          condition: advance.customer_id === caller?.id,
          errorCode: 'ORDER_FORBIDDEN',
          message: 'Only the customer can approve or decline this material request.',
          field: 'customer_id',
          severity: 'BLOCKING',
          actual: { customerId: advance.customer_id, callerId: caller?.id ?? null },
        },
        {
          name: 'advance_waiting_customer',
          condition: advance.status === 'REQUESTED',
          errorCode: 'MATERIAL_ADVANCE_NOT_OPEN',
          message: 'This material request is no longer waiting for a customer response.',
          field: 'status',
          severity: 'BLOCKING',
          actual: { status: advance.status },
        },
      ])

      if (!preflight.passed) {
        await logPreflightFailure(supabase, preflight, {
          operation: 'material_advance_response',
          entityType: 'order_material_advance',
          entityId: advance.id,
          orderId: order.id,
          actorId: caller?.id,
          actorRole: 'CUSTOMER',
          source: FN,
        })
        return preflightFailureResponse(preflight, cors, 409)
      }

      const note = parsed.data.note?.trim() ?? ''
      if (note) {
        const blockedNote = await rejectIfBlockedContact({
          supabase,
          fn: FN,
          cors,
          actorId: caller!.id,
          actorRole: 'CUSTOMER',
          surface: 'material_advance.response_note',
          text: note,
          message: "Contact details can't be included in a material advance response.",
          orderId: order.id,
          extra: { action: parsed.data.action, decision: parsed.data.decision },
        })
        if (blockedNote) return blockedNote
      }

      const approved = parsed.data.decision === 'APPROVE'
      const declineReason = approved
        ? null
        : isMaterialAdvanceDeclineReason(parsed.data.declineReason)
          ? parsed.data.declineReason
          : 'NOT_SPECIFIED'
      if (!approved && declineReason === 'OTHER' && note.length < 5) {
        return jsonError(cors, 400, 'DECLINE_NOTE_REQUIRED', 'Add a short note explaining why you are declining this material request.')
      }
      const declineReasonLabel = materialAdvanceDeclineReasonLabel(declineReason)
      const fundedFabricClaim = advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE'
      const nextStatus = approved ? (fundedFabricClaim ? 'OPS_REVIEW' : 'PAYMENT_PENDING') : 'DECLINED'
      const responseWrite = approved && fundedFabricClaim
        ? await supabase.rpc('approve_funded_fabric_release_claim', {
            p_advance_id: advance.id,
            p_customer_id: caller!.id,
            p_note: note || null,
          })
        : await supabase
            .from('order_material_advances')
            .update({
              status: nextStatus,
              customer_response_note: note || null,
              customer_response_reason: declineReason,
              customer_approved_at: approved ? new Date().toISOString() : null,
              customer_declined_at: approved ? null : new Date().toISOString(),
            })
            .eq('id', advance.id)
            .eq('status', 'REQUESTED')
            .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, customer_response_reason, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at, funding_source, fabric_allocation_id, fabric_approval_evidence_id, money_desk_request_id, payout_id, provider_release_status, correlation_id')
            .maybeSingle()
      const { data: updated, error } = responseWrite

      if (error) throw error
      if (!updated?.id) return jsonError(cors, 409, 'MATERIAL_ADVANCE_NOT_OPEN', 'This material request is no longer open.')

      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: approved
          ? fundedFabricClaim
            ? `Customer approved ${advance.currency} ${(advance.amount / 100).toFixed(2)} from the protected fabric allowance for ${advance.title}. Drapeon Money Desk review is required before provider release.`
            : `Customer approved the material advance for ${advance.title}. Payment is now required before ops can release it.`
          : `Customer declined the material advance for ${advance.title}.${declineReasonLabel ? ` Reason: ${declineReasonLabel}.` : ''}${note ? ` ${note}` : ''}`,
      })

      const notificationJobs = await notifyTailor(
        supabase,
        order,
        approved ? 'Material advance approved' : 'Material advance declined',
        approved
          ? fundedFabricClaim
            ? 'The customer approved this exact fabric release from the funded allowance. Drapeon Money Desk review is next; no second customer payment is required.'
            : 'The customer approved the material advance. It still needs payment and ops release before funds move.'
          : `The customer declined the material advance${declineReasonLabel ? `: ${declineReasonLabel.toLowerCase()}` : ''}. Keep the next step inside Drapeon.`,
        `material-advance-response:${advance.id}:${parsed.data.decision}`,
        {
          advanceId: advance.id,
          action: approved ? 'CUSTOMER_APPROVED' : 'CUSTOMER_DECLINED',
        },
      )

      await audit(supabase, {
        event: 'material_advance.customer_responded',
        actor_id: caller!.id,
        actor_role: 'CUSTOMER',
        order_id: order.id,
        severity: approved ? 'warn' : 'info',
        payload: {
          function: FN,
          advance_id: advance.id,
          decision: parsed.data.decision,
          decline_reason: declineReason,
          has_note: note.length > 0,
          funding_source: advance.funding_source ?? 'LEGACY_SEPARATE_PAYMENT',
        },
      })

      if (approved && fundedFabricClaim) {
        await createMaterialAdvanceOpsIssue(supabase, {
          order,
          advance: updated as MaterialAdvanceRow,
          severity: 'HIGH',
          title: 'Funded fabric release awaiting Money Desk',
          description: `Customer approved ${advance.currency} ${(advance.amount / 100).toFixed(2)} against the captured fabric allowance for ${advance.title}.`,
          recommendedAction: 'Review the accepted allocation, private supplier estimate, exact approved fabric evidence, remaining balance, duplicate risk, and payout readiness. Prepare a JIT Money Desk release; do not charge the customer again.',
          reason: 'funded_release_review',
        })
      }

      return jsonResponse({
        ok: true,
        advance: updated as MaterialAdvanceRow,
        notificationJobs,
      }, 200, cors)
    }

    if (parsed.data.action === 'prepare-payment') {
      if (advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE') {
        return jsonError(cors, 409, 'FABRIC_ALLOWANCE_ALREADY_FUNDED', 'This release uses the protected fabric allowance already paid at checkout. No second payment is allowed.')
      }
      const currency = normalizedCurrency(advance.currency)
      if (!currency) return jsonError(cors, 409, 'CURRENCY_UNSUPPORTED', 'This material advance currency is not supported.')
      const provider = providerForCurrency(currency)
      const existingAttempt = await fetchPaymentAttempt(supabase, advance.payment_id)

      const preflight = runPreflight([
        {
          name: 'customer_owns_order',
          condition: advance.customer_id === caller?.id,
          errorCode: 'ORDER_FORBIDDEN',
          message: 'Only the customer can pay this material advance.',
          field: 'customer_id',
          severity: 'BLOCKING',
          actual: { customerId: advance.customer_id, callerId: caller?.id ?? null },
        },
        {
          name: 'advance_approved',
          condition: ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(advance.status),
          errorCode: 'MATERIAL_ADVANCE_NOT_PAYABLE',
          message: 'This material advance is not ready for payment.',
          field: 'status',
          severity: 'BLOCKING',
          actual: { status: advance.status },
        },
        {
          name: 'payment_not_already_succeeded',
          condition: existingAttempt?.status !== 'SUCCEEDED' && advance.status !== 'PAID' && advance.status !== 'OPS_REVIEW' && advance.status !== 'RELEASED',
          errorCode: 'MATERIAL_ADVANCE_ALREADY_PAID',
          message: 'This material advance has already been paid.',
          field: 'payment_id',
          severity: 'BLOCKING',
          actual: { status: advance.status, paymentStatus: existingAttempt?.status ?? null },
        },
      ])

      if (!preflight.passed) {
        await logPreflightFailure(supabase, preflight, {
          operation: 'material_advance_payment_prepare',
          entityType: 'order_material_advance',
          entityId: advance.id,
          orderId: order.id,
          actorId: caller?.id,
          actorRole: 'CUSTOMER',
          source: FN,
        })
        return preflightFailureResponse(preflight, cors, 409)
      }

      const circuit = await getProviderCircuit(supabase, provider, 'PAYMENT')
      if (circuit.open) {
        return jsonError(cors, 503, 'PAYMENT_PROVIDER_DEGRADED', 'We could not start material payment right now. Try again in a few minutes.', {
          provider,
          retryAt: circuit.circuitOpenUntil,
        })
      }

      let providerPaymentId = advance.provider_payment_id ?? existingAttempt?.provider_payment_id ?? null
      let checkoutUrl = advance.provider_checkout_url ?? existingAttempt?.provider_checkout_url ?? null
      let clientSecret: string | null = null
      let idempotencyKey = existingAttempt?.idempotency_key ?? buildPaymentReference(advance.id)
      let existing = false

      if (provider === 'PAYSTACK') {
        if (!caller?.email?.trim()) {
          return jsonError(cors, 409, 'PAYSTACK_EMAIL_REQUIRED', 'A verified email is required before Paystack checkout can start.')
        }
        if (providerPaymentId && checkoutUrl) {
          existing = true
        } else {
          if (advance.status === 'PAYMENT_FAILED') idempotencyKey = `${buildPaymentReference(advance.id)}-R${Date.now()}`
          try {
            const transaction = await initializePaystackTransaction({
              amount: advance.amount,
              currency,
              email: caller.email,
              reference: idempotencyKey,
              callbackUrl: getPaystackCallbackUrl(),
              metadata: {
                order_id: order.id,
                material_advance_id: advance.id,
                payment_phase: 'MATERIAL_ADVANCE',
                reference: order.reference ?? order.id,
                idempotency_key: idempotencyKey,
              },
            })
            providerPaymentId = transaction.reference
            checkoutUrl = transaction.authorization_url ?? null
          } catch (error) {
            await recordProviderHealth(supabase, {
              provider,
              operation: 'PAYMENT',
              succeeded: false,
              error: error instanceof Error ? error.message : String(error),
              metadata: { function: FN, action: parsed.data.action, advance_id: advance.id, order_id: order.id },
            })
            return jsonError(cors, 502, 'PAYMENT_PROVIDER_FAILED', 'We could not start Paystack checkout for this material advance.')
          }
        }
      } else {
        if (providerPaymentId) {
          try {
            const paymentIntent = await retrieveStripePaymentIntent(providerPaymentId)
            clientSecret = paymentIntent.client_secret
            existing = paymentIntent.status !== 'canceled'
          } catch {
            providerPaymentId = null
          }
        }
        if (!providerPaymentId || !existing) {
          if (advance.status === 'PAYMENT_FAILED') idempotencyKey = `${buildPaymentReference(advance.id)}-R${Date.now()}`
          try {
            const paymentIntent = await createStripePaymentIntent({
              amount: advance.amount,
              currency,
              description: paymentDescription(order, advance),
              idempotencyKey,
              metadata: {
                order_id: order.id,
                material_advance_id: advance.id,
                payment_phase: 'MATERIAL_ADVANCE',
                reference: order.reference ?? order.id,
                idempotency_key: idempotencyKey,
              },
            })
            providerPaymentId = paymentIntent.id
            clientSecret = paymentIntent.client_secret
            checkoutUrl = null
          } catch (error) {
            await recordProviderHealth(supabase, {
              provider,
              operation: 'PAYMENT',
              succeeded: false,
              error: error instanceof Error ? error.message : String(error),
              metadata: { function: FN, action: parsed.data.action, advance_id: advance.id, order_id: order.id },
            })
            return jsonError(cors, 502, 'PAYMENT_PROVIDER_FAILED', 'We could not start Stripe checkout for this material advance.')
          }
        }
      }

      if (!providerPaymentId || (provider === 'PAYSTACK' && !checkoutUrl) || (provider === 'STRIPE' && !clientSecret)) {
        return jsonError(cors, 502, 'PAYMENT_SESSION_INCOMPLETE', 'Payment checkout could not open cleanly. Try again in a moment.')
      }

      const paymentAttempt = await upsertPreparedPaymentAttempt(supabase, {
        orderId: order.id,
        phase: 'MATERIAL_ADVANCE',
        provider,
        currency,
        amount: advance.amount,
        idempotencyKey,
        providerPaymentId,
        providerCheckoutUrl: checkoutUrl,
        status: 'PENDING',
        providerResponse: {
          order_id: order.id,
          material_advance_id: advance.id,
          payment_phase: 'MATERIAL_ADVANCE',
          existing,
        },
      })

      await supabase
        .from('order_material_advances')
        .update({
          status: 'PAYMENT_PENDING',
          payment_provider: provider,
          provider_payment_id: providerPaymentId,
          provider_checkout_url: checkoutUrl,
          payment_id: paymentAttempt.id,
        })
        .eq('id', advance.id)

      await audit(supabase, {
        event: 'material_advance.payment_prepared',
        actor_id: caller!.id,
        actor_role: 'CUSTOMER',
        order_id: order.id,
        payload: { function: FN, advance_id: advance.id, provider, provider_payment_id: providerPaymentId, existing },
      })

      return jsonResponse({
        ok: true,
        provider,
        orderId: order.id,
        advanceId: advance.id,
        paymentIntentId: providerPaymentId,
        authorizationUrl: checkoutUrl,
        clientSecret,
        amount: advance.amount,
        currency,
        existing,
      }, 200, cors)
    }

    if (parsed.data.action === 'confirm-payment') {
      if (advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE') {
        return jsonError(cors, 409, 'FABRIC_ALLOWANCE_ALREADY_FUNDED', 'This release does not have a separate customer payment to confirm.')
      }
      const currency = normalizedCurrency(advance.currency)
      if (!currency) return jsonError(cors, 409, 'CURRENCY_UNSUPPORTED', 'This material advance currency is not supported.')
      const provider = advance.payment_provider ?? providerForCurrency(currency)
      const providerPaymentId = parsed.data.paymentIntentId ?? advance.provider_payment_id

      const preflight = runPreflight([
        {
          name: 'customer_owns_order',
          condition: advance.customer_id === caller?.id,
          errorCode: 'ORDER_FORBIDDEN',
          message: 'Only the customer can confirm this material payment.',
          field: 'customer_id',
          severity: 'BLOCKING',
          actual: { customerId: advance.customer_id, callerId: caller?.id ?? null },
        },
        {
          name: 'payment_prepared',
          condition: !!providerPaymentId,
          errorCode: 'PAYMENT_NOT_PREPARED',
          message: 'Payment has not been prepared for this material advance yet.',
          field: 'provider_payment_id',
          severity: 'BLOCKING',
          actual: { providerPaymentId: providerPaymentId ?? null },
        },
        {
          name: 'advance_payable',
          condition: ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(advance.status),
          errorCode: 'MATERIAL_ADVANCE_NOT_PAYABLE',
          message: 'This material advance is not awaiting payment confirmation.',
          field: 'status',
          severity: 'BLOCKING',
          actual: { status: advance.status },
        },
      ])

      if (!preflight.passed) {
        await logPreflightFailure(supabase, preflight, {
          operation: 'material_advance_payment_confirm',
          entityType: 'order_material_advance',
          entityId: advance.id,
          orderId: order.id,
          actorId: caller?.id,
          actorRole: 'CUSTOMER',
          source: FN,
        })
        return preflightFailureResponse(preflight, cors, 409)
      }

      if (provider === 'PAYSTACK') {
        const transaction = await verifyPaystackTransaction(providerPaymentId!)
        if (transaction.status !== 'success') {
          await markPaymentAttemptStatus(supabase, {
            provider,
            providerPaymentId: providerPaymentId!,
            status: transaction.status === 'failed' ? 'FAILED' : 'CANCELED',
            providerResponse: transaction as unknown as Record<string, unknown>,
          }).catch(() => null)
          await supabase.from('order_material_advances').update({ status: 'PAYMENT_FAILED' }).eq('id', advance.id)
          return jsonError(cors, 409, 'PAYMENT_NOT_COMPLETE', 'The material advance payment is not complete yet.', {
            paymentStatus: transaction.status,
          })
        }
        const nextAdvance = await markAdvancePaid(supabase, order, advance, provider, transaction.reference, transaction as unknown as Record<string, unknown>)
        return jsonResponse({ ok: true, confirmed: true, advance: nextAdvance }, 200, cors)
      }

      const paymentIntent = await retrieveStripePaymentIntent(providerPaymentId!)
      if (paymentIntent.status !== 'succeeded') {
        const failureStatus = paymentIntent.status === 'canceled' ? 'CANCELED' : 'FAILED'
        await markPaymentAttemptStatus(supabase, {
          provider,
          providerPaymentId: paymentIntent.id,
          status: failureStatus,
          providerResponse: paymentIntent as unknown as Record<string, unknown>,
        }).catch(() => null)
        await supabase.from('order_material_advances').update({ status: 'PAYMENT_FAILED' }).eq('id', advance.id)
        return jsonError(cors, 409, 'PAYMENT_NOT_COMPLETE', 'The material advance payment is not complete yet.', {
          paymentStatus: paymentIntent.status,
        })
      }
      const nextAdvance = await markAdvancePaid(supabase, order, advance, provider, paymentIntent.id, paymentIntent as unknown as Record<string, unknown>)
      return jsonResponse({ ok: true, confirmed: true, advance: nextAdvance }, 200, cors)
    }

    if (parsed.data.action === 'upload-receipt') {
      if (parsed.data.receiptStorageBucket !== 'commercial-evidence') {
        return jsonError(cors, 409, 'PRIVATE_RECEIPT_REQUIRED', 'Final receipts must use Drapeon private evidence storage.')
      }
      if (advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' && (
        parsed.data.acquiredStorageBucket !== 'commercial-evidence' || !parsed.data.acquiredStoragePath
      )) {
        return jsonError(cors, 409, 'ACQUIRED_FABRIC_PROOF_REQUIRED', 'Add a separate photo of the acquired fabric alongside the final supplier receipt.')
      }
      const preflight = runPreflight([
        {
          name: 'tailor_owns_order',
          condition: advance.tailor_id === caller?.id,
          errorCode: 'ORDER_FORBIDDEN',
          message: 'Only the assigned tailor can upload the material receipt.',
          field: 'tailor_id',
          severity: 'BLOCKING',
          actual: { tailorId: advance.tailor_id, callerId: caller?.id ?? null },
        },
        {
          name: 'advance_paid_or_released',
          condition: advance.status === 'RELEASED' && advance.release_status === 'RELEASED',
          errorCode: 'MATERIAL_ADVANCE_RECEIPT_NOT_READY',
          message: 'Final receipt and actual spend can be reconciled after Drapeon releases the approved advance.',
          field: 'status',
          severity: 'BLOCKING',
          actual: { status: advance.status },
        },
      ])
      if (!preflight.passed) {
        await logPreflightFailure(supabase, preflight, {
          operation: 'material_advance_receipt_upload',
          entityType: 'order_material_advance',
          entityId: advance.id,
          orderId: order.id,
          actorId: caller?.id,
          actorRole: 'TAILOR',
          source: FN,
        })
        return preflightFailureResponse(preflight, cors, 409)
      }

      const note = parsed.data.note?.trim() ?? ''
      if (note) {
        const blockedNote = await rejectIfBlockedContact({
          supabase,
          fn: FN,
          cors,
          actorId: caller!.id,
          actorRole: 'TAILOR',
          surface: 'material_advance.receipt_note',
          text: note,
          message: "Contact details can't be included in a material receipt note.",
          orderId: order.id,
          extra: { action: parsed.data.action },
        })
        if (blockedNote) return blockedNote
      }

      const correlationId = crypto.randomUUID()
      const { data: reconciliation, error } = await supabase.rpc('reconcile_material_advance_v2', {
        p_advance_id: advance.id,
        p_tailor_id: caller!.id,
        p_actual_spent_amount: parsed.data.actualSpentAmount,
        p_receipt_storage_bucket: parsed.data.receiptStorageBucket,
        p_receipt_storage_path: parsed.data.receiptStoragePath,
        p_acquired_storage_bucket: parsed.data.acquiredStorageBucket ?? null,
        p_acquired_storage_path: parsed.data.acquiredStoragePath ?? null,
        p_receipt_url: parsed.data.receiptUrl ?? null,
        p_note: note || null,
        p_correlation_id: correlationId,
      })
      if (error) throw error
      const updated = await fetchAdvance(supabase, advance.id)

      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: reconciliation.outcome === 'EXACT'
          ? `Tailor reconciled the material purchase for ${advance.title} exactly to the approved amount.`
          : `Tailor submitted final material spend for ${advance.title}. Drapeon ops is reviewing the ${reconciliation.outcome === 'UNUSED_VALUE' ? 'unused value' : 'overage'}.`,
      })

      await notifyCustomer(
        supabase,
        order,
        'Material receipt uploaded',
        reconciliation.outcome === 'EXACT'
          ? 'Your tailor uploaded the final receipt and the purchase matches the exact amount you approved.'
          : 'Your tailor uploaded the final receipt. Drapeon is reviewing the difference before this material advance closes.',
        `material-advance-receipt:customer:${advance.id}:${reconciliation.outcome}`,
        { advanceId: advance.id, action: reconciliation.outcome === 'EXACT' ? 'RECONCILED_EXACT' : reconciliation.outcome === 'UNUSED_VALUE' ? 'RECONCILIATION_UNUSED_VALUE' : 'RECONCILIATION_OVERAGE' },
      )

      await notifyTailor(
        supabase,
        order,
        reconciliation.outcome === 'EXACT' ? 'Fabric purchase reconciled' : 'Fabric receipt under review',
        reconciliation.outcome === 'EXACT'
          ? 'Your final receipt matches the released amount. This fabric reconciliation is complete.'
          : reconciliation.outcome === 'UNUSED_VALUE'
            ? 'Your receipt shows unused approved value. Drapeon Money Desk must complete the customer refund before this closes.'
            : 'Your receipt is above the approved amount. The customer is not charged unless a separate change is approved and paid.',
        `material-advance-receipt:tailor:${advance.id}:${reconciliation.outcome}`,
        { advanceId: advance.id, action: reconciliation.outcome === 'EXACT' ? 'RECONCILED_EXACT' : reconciliation.outcome === 'UNUSED_VALUE' ? 'RECONCILIATION_UNUSED_VALUE' : 'RECONCILIATION_OVERAGE' },
      )

      await audit(supabase, {
        event: 'material_advance.receipt_reconciled',
        actor_id: caller!.id,
        actor_role: 'TAILOR',
        order_id: order.id,
        severity: reconciliation.outcome === 'EXACT' ? 'info' : 'warn',
        payload: { function: FN, advance_id: advance.id, outcome: reconciliation.outcome, delta_amount: reconciliation.deltaAmount, correlation_id: correlationId, policy_version: order.fabric_funding_policy_version, provider: advance.payment_provider, receipt_bucket: parsed.data.receiptStorageBucket, acquired_bucket: parsed.data.acquiredStorageBucket ?? null },
      })

      await resolveOpsIssueByDedupeKey(supabase, `material-advance:receipt_overdue:${advance.id}`, { receiptSubmitted: true, reconciliationOutcome: reconciliation.outcome })

      if (reconciliation.outcome !== 'EXACT') {
        await createMaterialAdvanceOpsIssue(supabase, {
          order,
          advance: updated as MaterialAdvanceRow,
          severity: 'HIGH',
          title: reconciliation.outcome === 'UNUSED_VALUE' ? 'Material advance has unused value' : 'Material receipt exceeds approved amount',
          description: `The final material receipt differs from the approved advance by ${Math.abs(reconciliation.deltaAmount)} ${advance.currency} minor units.`,
          recommendedAction: reconciliation.outcome === 'UNUSED_VALUE'
            ? 'Reconcile recovery and customer refund through Money Desk before closing the advance.'
            : 'Review supplier proof. The customer is not charged again unless a separate amendment is approved and paid.',
          reason: 'reconciliation_review',
        })
      }

      return jsonResponse({ ok: true, advance: updated as MaterialAdvanceRow, reconciliation }, 200, cors)
    }

    if (parsed.data.action === 'release-advance') {
      if (!isServiceRole) {
        return jsonError(cors, 403, 'OPS_ONLY', 'Only Drapeon ops can release a material advance.')
      }

      if (advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE') {
        if (!advance.money_desk_request_id || advance.money_desk_request_id !== parsed.data.moneyDeskRequestId) {
          return jsonError(cors, 409, 'MONEY_DESK_REQUEST_REQUIRED', 'This funded fabric release must use its exact approved Money Desk request.')
        }
        const { data: moneyRequest } = await supabase.from('money_desk_requests')
          .select('id,status,action_type,target_id,order_id,amount,currency')
          .eq('id', parsed.data.moneyDeskRequestId).maybeSingle()
        if (!moneyRequest?.id || moneyRequest.status !== 'EXECUTING' || moneyRequest.action_type !== 'MATERIAL_ADVANCE_RELEASE'
          || moneyRequest.target_id !== advance.id || moneyRequest.order_id !== order.id
          || moneyRequest.amount !== advance.amount || moneyRequest.currency !== advance.currency) {
          return jsonError(cors, 409, 'MONEY_DESK_REQUEST_MISMATCH', 'The approved Money Desk authority does not match this fabric release exactly.')
        }

        const profile = await fetchTailorProfile(supabase, advance.tailor_id)
        const currency = normalizedCurrency(advance.currency)
        const provider = currency ? providerForCurrency(currency) : null
        const paystackRecipient = profile?.paystack_recipient_code?.trim() || null
        const stripeAccount = profile?.stripe_connect_account_id?.trim() || null
        if (!profile?.id || profile.payout_account_verified !== true || profile.payout_reverification_required === true) {
          return jsonError(cors, 409, 'TAILOR_PAYOUT_NOT_VERIFIED', 'Tailor payout readiness must be verified before releasing funded fabric.')
        }
        if (!provider || (provider === 'PAYSTACK' ? !paystackRecipient : !stripeAccount)) {
          return jsonError(cors, 409, 'PAYOUT_DESTINATION_MISSING', 'The tailor payout destination is missing for this currency.')
        }

        let { data: payout } = await supabase.from('payouts')
          .select('id,status,provider_payout_id')
          .eq('material_advance_id', advance.id).maybeSingle()
        if (!payout?.id) {
          const inserted = await supabase.from('payouts').insert({
            tailor_profile_id: profile.id,
            order_id: order.id,
            material_advance_id: advance.id,
            amount: advance.amount,
            currency,
            provider,
            status: 'PROCESSING',
            payout_purpose: 'MATERIAL_ADVANCE',
            provider_payout_id: provider === 'PAYSTACK' ? releaseReference(advance.id) : null,
            provider_response: { function: FN, funding_source: advance.funding_source, money_desk_request_id: moneyRequest.id },
          }).select('id,status,provider_payout_id').single()
          if (inserted.error) throw inserted.error
          payout = inserted.data
        }
        if (payout.status === 'PAID' && advance.provider_release_status === 'SUCCEEDED') {
          return jsonResponse({ ok: true, existing: true, pending: false, providerReference: payout.provider_payout_id, advance }, 200, cors)
        }

        let providerReference = payout.provider_payout_id || releaseReference(advance.id)
        let providerResponse: Record<string, unknown>
        let providerReleaseConfirmed = false
        if (provider === 'PAYSTACK') {
          const transfer = await createPaystackTransfer({
            amount: advance.amount,
            recipientCode: paystackRecipient!,
            reason: `Drapeon funded fabric release ${order.reference ?? order.id}`,
            reference: releaseReference(advance.id),
            currency,
          })
          providerReference = transfer.reference ?? transfer.transfer_code ?? providerReference
          providerResponse = transfer as unknown as Record<string, unknown>
          providerReleaseConfirmed = String(transfer.status ?? '').toLowerCase() === 'success'
        } else {
          const transfer = await createStripeTransfer({
            amount: advance.amount,
            currency: currency!,
            destinationAccountId: stripeAccount!,
            idempotencyKey: releaseReference(advance.id),
            transferGroup: `order:${order.id}`,
            metadata: { order_id: order.id, material_advance_id: advance.id, payout_id: payout.id, money_desk_request_id: moneyRequest.id },
          })
          providerReference = transfer.id
          providerResponse = transfer as unknown as Record<string, unknown>
          providerReleaseConfirmed = true
        }

        await supabase.from('payouts').update({
          provider_payout_id: providerReference,
          provider_response: providerResponse,
          provider_destination_id: provider === 'STRIPE' ? stripeAccount : paystackRecipient,
          provider_transfer_status: providerReleaseConfirmed
            ? provider === 'STRIPE' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK'
            : 'PROCESSING',
          bank_settlement_status: providerReleaseConfirmed
            ? provider === 'STRIPE' ? 'PENDING' : 'PAID'
            : 'PENDING',
          status: providerReleaseConfirmed ? provider === 'STRIPE' ? 'PROCESSING' : 'PAID' : 'PROCESSING',
          completed_at: providerReleaseConfirmed && provider === 'PAYSTACK' ? new Date().toISOString() : null,
        }).eq('id', payout.id)
        await supabase.from('order_material_advances').update({
          payout_id: payout.id,
          provider_release_id: providerReference,
          provider_release_response: providerResponse,
          provider_release_status: providerReleaseConfirmed ? 'SUCCEEDED' : 'PENDING',
        }).eq('id', advance.id)

        if (!providerReleaseConfirmed) {
          await audit(supabase, { event: 'material_advance.provider_release_pending', actor_role: 'OPS', order_id: order.id, payload: { function: FN, advance_id: advance.id, payout_id: payout.id, provider, provider_reference: providerReference, money_desk_request_id: moneyRequest.id, correlation_id: advance.correlation_id } })
          return jsonResponse({ ok: true, pending: true, advanceId: advance.id, payoutId: payout.id, providerReference }, 202, cors)
        }

        const { data: released, error: releaseError } = await supabase.rpc('record_funded_fabric_provider_outcome', {
          p_advance_id: advance.id,
          p_payout_id: payout.id,
          p_provider_reference: providerReference,
          p_outcome: 'SUCCEEDED',
          p_provider_response: providerResponse,
        })
        if (releaseError) throw releaseError
        await supabase.from('order_stage_updates').insert({ order_id: order.id, stage: order.stage, note: `Drapeon released ${advance.currency} ${(advance.amount / 100).toFixed(2)} from the protected fabric allowance for ${advance.title}. Final receipt and acquired-fabric proof are still required.` })
        await audit(supabase, { event: 'material_advance.funded_release_confirmed', actor_role: 'OPS', order_id: order.id, payload: { function: FN, advance_id: advance.id, payout_id: payout.id, provider, provider_reference: providerReference, money_desk_request_id: moneyRequest.id, correlation_id: advance.correlation_id } })
        await Promise.all([
          notifyTailor(supabase, order, provider === 'STRIPE' ? 'Fabric funds released to Stripe' : 'Fabric funds paid', provider === 'STRIPE' ? 'The approved fabric amount is now in your Stripe balance. Stripe will send a separate update when its bank payout moves or arrives. Upload the final receipt and acquired-fabric proof after purchase.' : 'Drapeon released the approved amount to your verified bank destination. Upload the final receipt and acquired-fabric proof after purchase.', `funded-fabric-released:tailor:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_CONFIRMED' }),
          notifyCustomer(supabase, order, 'Fabric allowance updated', provider === 'STRIPE' ? 'The approved fabric amount was released to the tailor’s verified Stripe account. Bank arrival is tracked separately; any remaining fabric allowance stays protected.' : 'The provider confirmed the approved fabric release to the tailor’s verified bank destination. Any remaining fabric allowance stays protected.', `funded-fabric-released:customer:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_CONFIRMED' }),
        ])
        await resolveOpsIssueByDedupeKey(supabase, `material-advance:funded_release_review:${advance.id}`, { providerReference, payoutId: payout.id })
        return jsonResponse({ ok: true, pending: false, advance: released, payoutId: payout.id, providerReference }, 200, cors)
      }

      const profile = await fetchTailorProfile(supabase, advance.tailor_id)
      const currency = normalizedCurrency(advance.currency)
      const provider = currency ? providerForCurrency(currency) : null
      const paystackRecipient = profile?.paystack_recipient_code?.trim() || null
      const stripeAccount = profile?.stripe_connect_account_id?.trim() || null
      const destinationMissing =
        provider === 'PAYSTACK'
          ? !paystackRecipient
          : provider === 'STRIPE'
            ? !stripeAccount
            : true

      const preflight = runPreflight([
        {
          name: 'advance_paid',
          condition: ['PAID', 'OPS_REVIEW', 'BLOCKED'].includes(advance.status) && !!advance.paid_at,
          errorCode: 'MATERIAL_ADVANCE_NOT_PAID',
          message: 'This material advance is not paid yet.',
          field: 'paid_at',
          severity: 'BLOCKING',
          actual: { status: advance.status, paidAt: advance.paid_at ?? null },
        },
        {
          name: 'advance_not_released',
          condition: !advance.released_at && advance.release_status !== 'RELEASED',
          errorCode: 'MATERIAL_ADVANCE_ALREADY_RELEASED',
          message: 'This material advance has already been released.',
          field: 'released_at',
          severity: 'BLOCKING',
          actual: { releasedAt: advance.released_at ?? null, releaseStatus: advance.release_status },
        },
        {
          name: 'tailor_payout_verified',
          condition: !!profile?.id && profile.payout_account_verified === true && profile.payout_reverification_required !== true,
          errorCode: 'TAILOR_PAYOUT_NOT_VERIFIED',
          message: 'Tailor payout account must be verified before releasing a material advance.',
          field: 'payout_account_verified',
          severity: 'BLOCKING',
          actual: {
            profileId: profile?.id ?? null,
            payoutVerified: profile?.payout_account_verified ?? null,
            reverificationRequired: profile?.payout_reverification_required ?? null,
          },
        },
        {
          name: 'provider_destination_present',
          condition: !!provider && !destinationMissing,
          errorCode: 'PAYOUT_DESTINATION_MISSING',
          message: 'Tailor payout destination is missing for this material advance.',
          field: provider === 'PAYSTACK' ? 'paystack_recipient_code' : 'stripe_connect_account_id',
          severity: 'BLOCKING',
          actual: { provider, hasPaystackRecipient: !!paystackRecipient, hasStripeAccount: !!stripeAccount },
        },
      ])

      if (!preflight.passed) {
        await supabase
          .from('order_material_advances')
          .update({
            status: 'BLOCKED',
            release_status: 'BLOCKED',
            release_blocked_reason: preflight.failures[0]?.errorCode ?? 'PREFLIGHT_FAILED',
            blocked_at: new Date().toISOString(),
          })
          .eq('id', advance.id)
        await logPreflightFailure(supabase, preflight, {
          operation: 'material_advance_release',
          entityType: 'order_material_advance',
          entityId: advance.id,
          orderId: order.id,
          actorRole: 'OPS',
          source: FN,
        })
        await createMaterialAdvanceOpsIssue(supabase, {
          order,
          advance,
          severity: 'HIGH',
          title: 'Material advance release blocked',
          description: `Drapeon could not release the material advance for ${advance.title}.`,
          recommendedAction: 'Fix the payout destination or account verification issue, then retry release from ops.',
          reason: 'release_failed',
        })
        await Promise.all([
          notifyTailor(supabase, order, 'Material release needs attention', 'Drapeon could not complete this release. Ops is reviewing the payout setup; do not make the purchase yet.', `material-release-blocked:tailor:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_FAILED' }),
          notifyCustomer(supabase, order, 'Material release under review', 'Drapeon could not complete the approved material release. Your main order funds remain protected while Ops reviews it.', `material-release-blocked:customer:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_FAILED' }),
        ])
        return preflightFailureResponse(preflight, cors, 409)
      }

      // The authoritative preflight proves the payout profile exists. Keep a
      // narrowed primitive for the provider release and its retry ledger row.
      const verifiedTailorProfileId = profile?.id
      if (!verifiedTailorProfileId) {
        throw new Error('Verified tailor payout profile is missing after preflight.')
      }

      try {
        let providerReleaseId: string | null = null
        let providerReleaseResponse: Record<string, unknown> = {}
        const { data: existingPayout, error: existingPayoutError } = await supabase
          .from('payouts')
          .select('id')
          .eq('material_advance_id', advance.id)
          .maybeSingle()
        if (existingPayoutError) throw existingPayoutError
        let payoutId = existingPayout?.id ?? null
        if (!payoutId) {
          const { data: insertedPayout, error: insertPayoutError } = await supabase
            .from('payouts')
            .insert({
              tailor_profile_id: verifiedTailorProfileId,
              order_id: order.id,
              source_payment_id: advance.payment_id ?? null,
              material_advance_id: advance.id,
              amount: advance.amount,
              currency,
              provider,
              status: 'PROCESSING',
              provider_transfer_status: 'PROCESSING',
              bank_settlement_status: 'PENDING',
              provider_destination_id: provider === 'STRIPE' ? stripeAccount : paystackRecipient,
              provider_response: { function: FN, release_type: 'MATERIAL_ADVANCE' },
            })
            .select('id')
            .single()
          if (insertPayoutError) throw insertPayoutError
          payoutId = insertedPayout.id
        }
        if (provider === 'PAYSTACK') {
          const transfer = await createPaystackTransfer({
            amount: advance.amount,
            recipientCode: paystackRecipient!,
            reason: `Drapeon material advance ${order.reference ?? order.id}`,
            reference: releaseReference(advance.id),
            currency,
          })
          providerReleaseId = transfer.transfer_code ?? transfer.reference ?? null
          providerReleaseResponse = transfer as unknown as Record<string, unknown>
        } else {
          const transfer = await createStripeTransfer({
            amount: advance.amount,
            currency: currency!,
            destinationAccountId: stripeAccount!,
            idempotencyKey: releaseReference(advance.id),
            transferGroup: `order_${order.id}`,
            metadata: {
              order_id: order.id,
              material_advance_id: advance.id,
              payout_id: payoutId!,
              source: FN,
            },
          })
          providerReleaseId = transfer.id
          providerReleaseResponse = transfer as unknown as Record<string, unknown>
        }

        const providerReleasedAt = new Date().toISOString()
        const { error: payoutUpdateError } = await supabase
          .from('payouts')
          .update({
            provider_payout_id: providerReleaseId,
            provider_response: providerReleaseResponse,
            provider_destination_id: provider === 'STRIPE' ? stripeAccount : paystackRecipient,
            provider_transfer_status: provider === 'STRIPE' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK',
            bank_settlement_status: provider === 'STRIPE' ? 'PENDING' : 'PAID',
            status: provider === 'STRIPE' ? 'PROCESSING' : 'PAID',
            completed_at: provider === 'PAYSTACK' ? providerReleasedAt : null,
          })
          .eq('id', payoutId)
        if (payoutUpdateError) throw payoutUpdateError

        const { data: updated, error } = await supabase
          .from('order_material_advances')
          .update({
            status: 'RELEASED',
            release_status: 'RELEASED',
            provider_release_id: providerReleaseId,
            provider_release_response: providerReleaseResponse,
            release_blocked_reason: null,
            released_at: new Date().toISOString(),
          })
          .eq('id', advance.id)
          .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at')
          .maybeSingle()
        if (error) throw error

        const releaseCorrelationId = crypto.randomUUID()
        const { error: ledgerError } = await supabase.rpc('record_material_advance_release_ledger', {
          p_advance_id: advance.id,
          p_provider_reference: providerReleaseId ?? releaseReference(advance.id),
          p_actor_id: null,
          p_correlation_id: releaseCorrelationId,
        })
        if (ledgerError) throw new Error(`Provider release succeeded but ledger recording failed: ${ledgerError.message}`)

        await supabase.from('order_stage_updates').insert({
          order_id: order.id,
          stage: order.stage,
          note: `Drapeon released the approved material advance for ${advance.title}. Receipt proof is required from the tailor.`,
        })

        await audit(supabase, {
          event: 'material_advance.released',
          actor_role: 'OPS',
          order_id: order.id,
          payload: {
            function: FN,
            advance_id: advance.id,
            provider,
            provider_release_id: providerReleaseId,
            amount: advance.amount,
            currency,
            note: parsed.data.note?.trim() || null,
          },
        })

        await Promise.all([
          notifyTailor(supabase, order, provider === 'STRIPE' ? 'Material funds released to Stripe' : 'Material funds paid', provider === 'STRIPE' ? 'The approved material amount is now in your Stripe balance. Stripe will confirm bank movement separately. Upload the receipt as soon as the purchase is made.' : 'Drapeon released the approved material funds to your verified bank destination. Upload the receipt as soon as the purchase is made.', `material-advance-released:tailor:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_CONFIRMED' }),
          notifyCustomer(supabase, order, 'Material advance released', provider === 'STRIPE' ? 'Drapeon released only the material amount you approved to the tailor’s verified Stripe account. Bank arrival is tracked separately; your main order funds remain protected.' : 'Drapeon released only the material amount you approved to the tailor’s verified bank destination. Your main order funds remain protected.', `material-advance-released:customer:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_CONFIRMED' }),
        ])
        await resolveOpsIssueByDedupeKey(supabase, `material-advance:paid_release_review:${advance.id}`, { providerReleaseId })

        return jsonResponse({ ok: true, advance: updated as MaterialAdvanceRow }, 200, cors)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await Sentry.captureMessage('Material advance release failed', { tags: { function: FN, action: 'release-advance' }, extra: { advanceId: advance.id, orderId: order.id, error: message } })
        await supabase
          .from('order_material_advances')
          .update({
            status: 'BLOCKED',
            release_status: 'BLOCKED',
            release_blocked_reason: message,
            blocked_at: new Date().toISOString(),
          })
          .eq('id', advance.id)
        await createMaterialAdvanceOpsIssue(supabase, {
          order,
          advance,
          severity: 'CRITICAL',
          title: 'Material advance payout failed',
          description: `Provider release failed for material advance ${advance.title}: ${message}`,
          recommendedAction: 'Review provider transfer status and tailor payout destination before retrying. Do not retry automatically.',
          reason: 'release_failed',
        })
        await Promise.all([
          notifyTailor(supabase, order, 'Material release failed', 'The provider did not confirm this material release. Drapeon Ops is checking it; do not make the purchase yet.', `material-release-failed:tailor:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_FAILED' }),
          notifyCustomer(supabase, order, 'Material release under review', 'The provider did not confirm the approved material release. Your main order funds remain protected while Ops checks it.', `material-release-failed:customer:${advance.id}`, { advanceId: advance.id, action: 'RELEASE_FAILED' }),
        ])
        return jsonError(cors, 502, 'MATERIAL_ADVANCE_RELEASE_FAILED', 'Drapeon could not release this material advance. Ops needs to review it.', {
          detail: message,
        })
      }
    }

    return jsonError(cors, 400, 'ACTION_UNSUPPORTED', 'This material advance action is not supported.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'request.failed', { error: message })
    let adjustmentId: string | null = null
    if (activeSupabase && activeAdvanceId) {
      const { data: adjustmentLink } = await activeSupabase.from('fabric_release_adjustment_links')
        .select('adjustment_id').eq('material_advance_id', activeAdvanceId).maybeSingle()
      adjustmentId = adjustmentLink?.adjustment_id ?? null
    }
    await Sentry.captureMessage('Material advance action failed', {
      level: 'error',
      tags: { function: FN, action: activeAction, actor_role: activeActorRole, provider: activeAdvance?.payment_provider ?? 'none', policy_version: activeOrder?.fabric_funding_policy_version ?? 'legacy' },
      extra: { error: message, orderId: activeOrderId, advanceId: activeAdvanceId, adjustmentId, correlationId: activeCorrelationId },
    })
    if (activeAction === 'release-advance' && activeSupabase && activeOrder && activeAdvance) {
      await createMaterialAdvanceOpsIssue(activeSupabase, {
        order: activeOrder,
        advance: activeAdvance,
        severity: 'CRITICAL',
        title: 'Funded fabric release outcome needs verification',
        description: 'The reviewed provider release did not reach a clean terminal application outcome.',
        recommendedAction: 'Verify the provider transfer and Money Desk attempt before any retry. Record the terminal provider outcome and do not send a duplicate transfer.',
        reason: 'release_failed',
      })
      await Promise.all([
        notifyTailor(activeSupabase, activeOrder, 'Fabric release under review', 'The provider release needs Drapeon verification. Do not purchase the fabric until the order shows a confirmed release.', `funded-release-error:tailor:${activeAdvance.id}`, { advanceId: activeAdvance.id, action: 'RELEASE_FAILED' }),
        notifyCustomer(activeSupabase, activeOrder, 'Fabric release under review', 'Drapeon is verifying the provider outcome. Your protected order balance will not be moved twice.', `funded-release-error:customer:${activeAdvance.id}`, { advanceId: activeAdvance.id, action: 'RELEASE_FAILED' }),
      ])
    }
    return jsonError(getCorsHeaders(req), 500, 'MATERIAL_ADVANCE_FAILED', 'We could not update the material advance right now.', { detail: message })
  }
})
