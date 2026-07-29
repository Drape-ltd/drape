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
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { initializePaystackTransaction, verifyPaystackTransaction, createPaystackTransfer } from '../_shared/paystack.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent, createStripeTransfer } from '../_shared/stripe.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { getProviderCircuit, recordProviderHealth } from '../_shared/provider-health.ts'
import { markPaymentAttemptStatus, upsertPreparedPaymentAttempt } from '../_shared/payment-ledger.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency, type AccountCurrencyCode } from '../../../packages/shared/src/currency-config.ts'
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
  }),
  z.object({
    action: z.literal('respond-advance'),
    advanceId: uuid,
    decision: z.enum(['APPROVE', 'DECLINE']),
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
    receiptUrl: z.string().trim().url(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('release-advance'),
    advanceId: uuid,
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
    .select('id, reference, stage, order_kind, customer_id, tailor_id, currency, quoted_currency, quoted_amount, total_amount, escrow_released')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  return (data as OrderRow | null) ?? null
}

async function fetchAdvance(supabase: any, advanceId: string) {
  const { data, error } = await supabase
    .from('order_material_advances')
    .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at')
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
) {
  await enqueuePushJob(supabase, {
    userId: order.customer_id,
    notification: {
      title: subject,
      body,
      preferenceKey: 'orderUpdates',
      data: { orderId: order.id },
    },
    source: FN,
    idempotencyKey,
    orderId: order.id,
    priority: 20,
  })
  await enqueueOrderEventEmailJob(supabase, {
    order,
    recipientUserId: order.customer_id,
    audience: 'CUSTOMER',
    subject,
    headline: subject,
    body,
    source: FN,
    idempotencyKey,
    priority: 25,
  })
}

async function notifyTailor(
  supabase: any,
  order: OrderRow,
  subject: string,
  body: string,
  idempotencyKey: string,
) {
  await enqueuePushJob(supabase, {
    userId: order.tailor_id,
    notification: {
      title: subject,
      body,
      preferenceKey: 'newOrders',
      data: { orderId: order.id },
    },
    source: FN,
    idempotencyKey,
    orderId: order.id,
    priority: 20,
  })
  await enqueueOrderEventEmailJob(supabase, {
    order,
    recipientUserId: order.tailor_id,
    audience: 'TAILOR',
    subject,
    headline: subject,
    body,
    source: FN,
    idempotencyKey,
    priority: 25,
  })
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

  try {
    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return jsonError(cors, 400, 'VALIDATION_FAILED', 'Check the material advance details and try again.', {
        details: parsed.error,
      })
    }

    const isOpsRelease = parsed.data.action === 'release-advance'
    const isServiceRole = serviceRoleRequest(req)
    const caller = isServiceRole ? null : await getAuthUser(req)

    if (!caller && !isServiceRole) {
      return jsonError(cors, 401, 'AUTH_REQUIRED', 'Please sign in again before continuing.')
    }

    const rateKey = caller?.id ?? req.headers.get('x-forwarded-for') ?? 'service'
    const allowed = await checkRateLimit(supabase, `${FN}:${parsed.data.action}:${rateKey}`, 3600, isOpsRelease ? 60 : 20)
    if (!allowed) return rateLimitExceededResponse(cors)

    if (parsed.data.action === 'request-advance') {
      const order = await fetchOrder(supabase, parsed.data.orderId)
      if (!order?.id) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')

      const currency = normalizedCurrency(parsed.data.currency)
      const orderCurrency = normalizedCurrency(order.currency ?? order.quoted_currency)
      const settledPayment = await fetchSettledInitialPayment(supabase, order.id)
      const openDispute = await hasOpenDispute(supabase, order.id)
      const maxAdvance = Math.max(Math.floor((settledPayment?.amount ?? order.total_amount ?? order.quoted_amount ?? 0) * 0.5), 0)

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
          condition: maxAdvance > 0 && parsed.data.amount <= maxAdvance,
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

      const { data: advance, error } = await supabase
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
        })
        .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at')
        .maybeSingle()

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
        'Material approval requested',
        `Your tailor requested a material advance for ${row.title}. Review the cost before paying; the main order escrow stays protected.`,
        `material-advance-requested:${row.id}`,
      )

      await audit(supabase, {
        event: 'material_advance.requested',
        actor_id: caller!.id,
        actor_role: 'TAILOR',
        order_id: order.id,
        severity: 'warn',
        payload: { function: FN, advance_id: row.id, amount: row.amount, currency: row.currency },
      })

      return jsonResponse({ ok: true, advance: row }, 200, cors)
    }

    const advance = 'advanceId' in parsed.data ? await fetchAdvance(supabase, parsed.data.advanceId) : null
    if (!advance?.id) return jsonError(cors, 404, 'MATERIAL_ADVANCE_NOT_FOUND', 'This material advance could not be found.')

    const order = await fetchOrder(supabase, advance.order_id)
    if (!order?.id) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')

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
      const nextStatus = approved ? 'PAYMENT_PENDING' : 'DECLINED'
      const { data: updated, error } = await supabase
        .from('order_material_advances')
        .update({
          status: nextStatus,
          customer_response_note: note || null,
          customer_approved_at: approved ? new Date().toISOString() : null,
          customer_declined_at: approved ? null : new Date().toISOString(),
        })
        .eq('id', advance.id)
        .eq('status', 'REQUESTED')
        .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at')
        .maybeSingle()

      if (error) throw error
      if (!updated?.id) return jsonError(cors, 409, 'MATERIAL_ADVANCE_NOT_OPEN', 'This material request is no longer open.')

      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: approved
          ? `Customer approved the material advance for ${advance.title}. Payment is now required before ops can release it.`
          : `Customer declined the material advance for ${advance.title}.`,
      })

      await notifyTailor(
        supabase,
        order,
        approved ? 'Material advance approved' : 'Material advance declined',
        approved
          ? 'The customer approved the material advance. It still needs payment and ops release before funds move.'
          : 'The customer declined the material advance. Keep the next step inside Drapeon.',
        `material-advance-response:${advance.id}:${parsed.data.decision}`,
      )

      await audit(supabase, {
        event: 'material_advance.customer_responded',
        actor_id: caller!.id,
        actor_role: 'CUSTOMER',
        order_id: order.id,
        severity: approved ? 'warn' : 'info',
        payload: { function: FN, advance_id: advance.id, decision: parsed.data.decision },
      })

      return jsonResponse({ ok: true, advance: updated as MaterialAdvanceRow }, 200, cors)
    }

    if (parsed.data.action === 'prepare-payment') {
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
          condition: ['PAID', 'OPS_REVIEW', 'RELEASED', 'BLOCKED'].includes(advance.status),
          errorCode: 'MATERIAL_ADVANCE_RECEIPT_NOT_READY',
          message: 'Receipt proof can be uploaded after the material advance is paid.',
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

      const { data: updated, error } = await supabase
        .from('order_material_advances')
        .update({
          receipt_url: parsed.data.receiptUrl,
          receipt_note: note || null,
          receipt_uploaded_at: new Date().toISOString(),
        })
        .eq('id', advance.id)
        .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, payment_provider, provider_payment_id, provider_checkout_url, payment_id, paid_at, released_at')
        .maybeSingle()
      if (error) throw error

      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: `Tailor uploaded material receipt proof for ${advance.title}.`,
      })

      await notifyCustomer(
        supabase,
        order,
        'Material receipt uploaded',
        'Your tailor uploaded proof for the approved material purchase. You can review it from the order timeline.',
        `material-advance-receipt:${advance.id}`,
      )

      return jsonResponse({ ok: true, advance: updated as MaterialAdvanceRow }, 200, cors)
    }

    if (parsed.data.action === 'release-advance') {
      if (!isServiceRole) {
        return jsonError(cors, 403, 'OPS_ONLY', 'Only Drapeon ops can release a material advance.')
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
        return preflightFailureResponse(preflight, cors, 409)
      }

      try {
        let providerReleaseId: string | null = null
        let providerReleaseResponse: Record<string, unknown> = {}
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
              source: FN,
            },
          })
          providerReleaseId = transfer.id
          providerReleaseResponse = transfer as unknown as Record<string, unknown>
        }

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

        await notifyTailor(
          supabase,
          order,
          'Material advance released',
          'Drapeon released the approved material funds. Upload the receipt as soon as the purchase is made.',
          `material-advance-released:${advance.id}`,
        )

        return jsonResponse({ ok: true, advance: updated as MaterialAdvanceRow }, 200, cors)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
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
        return jsonError(cors, 502, 'MATERIAL_ADVANCE_RELEASE_FAILED', 'Drapeon could not release this material advance. Ops needs to review it.', {
          detail: message,
        })
      }
    }

    return jsonError(cors, 400, 'ACTION_UNSUPPORTED', 'This material advance action is not supported.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'request.failed', { error: message })
    return jsonError(getCorsHeaders(req), 500, 'MATERIAL_ADVANCE_FAILED', 'We could not update the material advance right now.', { detail: message })
  }
})
