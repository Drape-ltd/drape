/**
 * Authenticated post-acceptance amendments.
 * The accepted order remains immutable; every proposed price/deadline/scope
 * change gets a normalized claim, counterpart decision, case packet, payment
 * attempt when required, and append-only events.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../_shared/paystack.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent } from '../_shared/stripe.ts'
import { upsertPreparedPaymentAttempt, markPaymentAttemptStatus } from '../_shared/payment-ledger.ts'
import { prepareCommercialPricingReservation } from '../_shared/commercial-ledger.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { Sentry } from '../_shared/sentry.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import { COMMERCIAL_ADJUSTMENT_TYPES } from '../../../packages/shared/src/commercial-adjustment-constants.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'commercial-adjustment-action'
const MAX_MONEY = 999_999_999

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('propose-fabric-funding-change'),
    orderId: uuid,
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(1000),
    requestedReleaseAmount: z.number().int().positive().max(MAX_MONEY),
    currency: z.string().trim().min(3).max(3),
    estimateStorageBucket: z.literal('commercial-evidence'),
    estimateStoragePath: z.string().trim().min(3).max(500),
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    action: z.literal('propose'),
    orderId: uuid,
    type: z.enum(COMMERCIAL_ADJUSTMENT_TYPES),
    summary: z.string().trim().min(10).max(500),
    reason: z.string().trim().min(10).max(1000),
    responsibility: z.enum(['CUSTOMER', 'TAILOR', 'DRAPEON', 'SHARED', 'UNRESOLVED']),
    amountDelta: z.number().int().min(-MAX_MONEY).max(MAX_MONEY).default(0),
    currency: z.string().trim().min(3).max(3),
    proposedDeadline: z.string().datetime().nullable().optional(),
    evidenceIds: z.array(uuid).max(20).default([]),
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    action: z.literal('respond'),
    adjustmentId: uuid,
    decision: z.enum(['ACCEPTED', 'DECLINED', 'CANCELLED']),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('prepare-payment'), adjustmentId: uuid }),
  z.object({ action: z.literal('confirm-payment'), adjustmentId: uuid, paymentIntentId: z.string().trim().min(1).optional() }),
  z.object({ action: z.literal('complete'), adjustmentId: uuid, note: z.string().trim().min(3).max(500).optional() }),
])

type OrderRow = {
  id: string
  reference: string | null
  customer_id: string
  tailor_id: string | null
  stage: string
  deadline: string | null
  quoted_completion_date: string | null
  commercial_policy_version: string
  tax_rate_bps: number | null
  tax_region: string | null
  tax_fallback: boolean | null
}

type AdjustmentRow = {
  id: string
  reference: string
  order_id: string
  customer_id: string
  tailor_id: string | null
  financial_case_id: string | null
  adjustment_type: string
  status: string
  proposed_by: string | null
  proposed_by_role: 'CUSTOMER' | 'TAILOR' | 'OPS'
  counterparty_id: string | null
  summary: string
  reason: string
  responsibility: string
  amount_delta: number
  currency: string
  original_deadline: string | null
  proposed_deadline: string | null
  requires_payment: boolean
  payment_id: string | null
  correlation_id: string
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function fail(cors: HeadersInit, status: number, code: string, message: string) {
  return json({ error: code, message }, status, cors)
}

async function fetchOrder(supabase: any, orderId: string) {
  const { data, error } = await supabase.from('orders')
    .select('id, reference, customer_id, tailor_id, stage, deadline, quoted_completion_date, commercial_policy_version, tax_rate_bps, tax_region, tax_fallback')
    .eq('id', orderId).maybeSingle()
  if (error) throw error
  return (data as OrderRow | null) ?? null
}

async function fetchAdjustment(supabase: any, adjustmentId: string) {
  const { data, error } = await supabase.from('commercial_adjustments')
    .select('id, reference, order_id, customer_id, tailor_id, financial_case_id, adjustment_type, status, proposed_by, proposed_by_role, counterparty_id, summary, reason, responsibility, amount_delta, currency, original_deadline, proposed_deadline, requires_payment, payment_id, correlation_id')
    .eq('id', adjustmentId).maybeSingle()
  if (error) throw error
  return (data as AdjustmentRow | null) ?? null
}

function actorRole(order: OrderRow, actorId: string): 'CUSTOMER' | 'TAILOR' | null {
  if (order.customer_id === actorId) return 'CUSTOMER'
  if (order.tailor_id === actorId) return 'TAILOR'
  return null
}

function counterpart(order: OrderRow, role: 'CUSTOMER' | 'TAILOR') {
  return role === 'CUSTOMER' ? order.tailor_id : order.customer_id
}

async function notifyCounterpart(supabase: any, order: OrderRow, role: 'CUSTOMER' | 'TAILOR', input: {
  title: string
  body: string
  key: string
  type: string
}) {
  const userId = counterpart(order, role)
  if (!userId) return
  await enqueuePushJob(supabase, {
    userId,
    notification: { title: input.title, body: input.body, preferenceKey: 'orderUpdates', data: { orderId: order.id, type: input.type } },
    source: FN,
    idempotencyKey: input.key,
    orderId: order.id,
    priority: 20,
  })
  await enqueueOrderEventEmailJob(supabase, {
    order,
    recipientUserId: userId,
    audience: role === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
    subject: input.title,
    headline: input.title,
    body: input.body,
    ctaLabel: 'Review order change',
    source: FN,
    idempotencyKey: input.key,
    priority: 20,
  })
}

function paystackReference(adjustmentId: string) {
  return `DRAPE-ADJUSTMENT-${adjustmentId}`
}

async function resolveOpsIssue(supabase: any, adjustmentId: string, resolution: string) {
  const { data: issue } = await supabase.from('ops_issues').select('id, status').eq('dedupe_key', `commercial-adjustment:${adjustmentId}`).maybeSingle()
  if (!issue?.id || issue.status === 'RESOLVED') return
  await supabase.from('ops_issues').update({ status: 'RESOLVED', resolved_at: new Date().toISOString() }).eq('id', issue.id)
  await supabase.from('ops_audit_logs').insert({ issue_id: issue.id, action_taken: 'ISSUE_RESOLVED', performed_role: 'SYSTEM', reason: resolution, before_state: { status: issue.status }, after_state: { status: 'RESOLVED', resolution } })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await getAuthUser(req)
  if (!caller) return fail(cors, 401, 'AUTH_REQUIRED', 'Sign in again before changing this order.')
  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return json({ error: 'VALIDATION_FAILED', message: 'Check the change details and try again.', details: parsed.error }, 400, cors)

  const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
  try {
    const allowed = await checkRateLimit(supabase, `${FN}:${parsed.data.action}:${caller.id}`, 3600, 30)
    if (!allowed) return rateLimitExceededResponse(cors)
    if (parsed.data.action === 'propose-fabric-funding-change') {
      const order = await fetchOrder(supabase, parsed.data.orderId)
      if (!order) return fail(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')
      const role = actorRole(order, caller.id)
      if (role !== 'TAILOR') return fail(cors, 403, 'TAILOR_FABRIC_CHANGE_REQUIRED', 'Only the assigned tailor can propose this fabric funding change.')
      const currency = normalizeAccountCurrency(parsed.data.currency)
      if (!currency) return fail(cors, 409, 'CURRENCY_UNSUPPORTED', 'Use the same supported currency as this order.')
      for (const [surface, value] of [['title', parsed.data.title], ['description', parsed.data.description]] as const) {
        const blocked = await rejectIfBlockedContact({
          supabase, fn: FN, cors, actorId: caller.id, actorRole: role,
          surface: `fabric_release_adjustment.${surface}`, text: value,
          message: "Contact details can't be included in a fabric funding change.",
          orderId: order.id, extra: { action: parsed.data.action },
        })
        if (blocked) return blocked
      }
      const { data, error } = await supabase.rpc('create_fabric_release_commercial_adjustment', {
        p_order_id: order.id,
        p_tailor_id: caller.id,
        p_title: parsed.data.title,
        p_description: parsed.data.description,
        p_requested_release_amount: parsed.data.requestedReleaseAmount,
        p_currency: currency,
        p_estimate_storage_bucket: parsed.data.estimateStorageBucket,
        p_estimate_storage_path: parsed.data.estimateStoragePath,
        p_idempotency_key: parsed.data.idempotencyKey,
      })
      if (error) {
        const known = error.message.includes('FUNDED_RELEASE_DOES_NOT_REQUIRE_ADJUSTMENT')
          ? ['FUNDED_RELEASE_AVAILABLE', 'This supplier cost now fits inside the funded allowance. Send it as a fabric release instead.']
          : error.message.includes('already open')
            ? ['ADJUSTMENT_ALREADY_OPEN', 'Another order change is already awaiting a decision.']
            : ['FABRIC_ADJUSTMENT_NOT_CREATED', error.message]
        return fail(cors, 409, known[0], known[1])
      }
      await supabase.from('order_stage_updates').insert({
        order_id: order.id, stage: order.stage,
        note: 'Tailor proposed additional fabric funding. The existing allowance remains protected and no release claim exists until the customer accepts and the additional payment is confirmed.',
      })
      await notifyCounterpart(supabase, order, role, {
        title: 'Additional fabric funding needs a decision',
        body: `The supplier cost is above the remaining fabric allowance. Review the proof and exact additional amount; no funds move until you accept and pay.`,
        key: `fabric-release-adjustment:${data.adjustmentId}:proposed`,
        type: 'fabric_release_adjustment',
      })
      await audit(supabase, {
        event: 'fabric_release_adjustment.proposed', actor_id: caller.id, actor_role: role,
        order_id: order.id, severity: 'warn', payload: { adjustment_id: data.adjustmentId, ...data },
      })
      return json({ ok: true, adjustment: data }, 200, cors)
    }

    if (parsed.data.action === 'propose') {
      const amountDelta = parsed.data.amountDelta ?? 0
      const order = await fetchOrder(supabase, parsed.data.orderId)
      if (!order) return fail(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')
      const role = actorRole(order, caller.id)
      if (!role) return fail(cors, 403, 'ORDER_FORBIDDEN', 'Only the customer or assigned tailor can propose this change.')
      const currency = normalizeAccountCurrency(parsed.data.currency)
      if (!currency) return fail(cors, 409, 'CURRENCY_UNSUPPORTED', 'Use the same supported currency as this order.')
      if (parsed.data.type === 'DEADLINE_EXTENSION' && !parsed.data.proposedDeadline) {
        return fail(cors, 400, 'DEADLINE_REQUIRED', 'Choose the exact proposed deadline.')
      }
      if (parsed.data.type === 'DEADLINE_EXTENSION') {
        if (role !== 'TAILOR') {
          return fail(cors, 403, 'TAILOR_EXTENSION_REQUIRED', 'The tailor requests more time. Customers can accept or decline the exact new deadline.')
        }
        if (['DELIVERED', 'COLLECTED', 'COMPLETE', 'CANCELLED', 'DECLINED', 'EXPIRED', 'REFUNDED'].includes(order.stage)) {
          return fail(cors, 409, 'EXTENSION_NOT_AVAILABLE', 'This order is already received or closed, so its production deadline cannot be extended.')
        }
        const { data: paidOrder } = await supabase
          .from('order_payments')
          .select('id')
          .eq('order_id', order.id)
          .eq('phase', 'INITIAL_ORDER')
          .in('status', ['SUCCEEDED', 'PARTIAL_REFUND'])
          .limit(1)
          .maybeSingle()
        if (!paidOrder) {
          return fail(cors, 409, 'INITIAL_PAYMENT_REQUIRED', 'Request more time after the initial order payment is confirmed.')
        }
        const proposedAt = Date.parse(parsed.data.proposedDeadline!)
        const deadlineCandidates = [order.deadline, order.quoted_completion_date]
          .filter((value): value is string => !!value)
          .map((value) => Date.parse(value))
          .filter(Number.isFinite)
        const currentDeadlineAt = deadlineCandidates.length > 0 ? Math.max(...deadlineCandidates) : Date.now()
        if (!Number.isFinite(proposedAt) || proposedAt <= Math.max(Date.now(), currentDeadlineAt)) {
          return fail(cors, 409, 'LATER_DEADLINE_REQUIRED', 'Choose a new deadline later than the current deadline.')
        }
      }
      if (parsed.data.responsibility === 'TAILOR' && amountDelta > 0) {
        return fail(cors, 409, 'TAILOR_CORRECTION_CANNOT_CHARGE', 'A tailor-caused correction cannot add a customer charge.')
      }
      for (const [surface, text] of [['summary', parsed.data.summary], ['reason', parsed.data.reason]] as const) {
        const blocked = await rejectIfBlockedContact({
          supabase, fn: FN, cors, actorId: caller.id, actorRole: role,
          surface: `commercial_adjustment.${surface}`, text,
          message: "Contact details can't be included in an order change.",
          orderId: order.id, extra: { action: 'propose', type: parsed.data.type },
        })
        if (blocked) return blocked
      }
      const correlationId = crypto.randomUUID()
      const { data, error } = await supabase.rpc('create_commercial_adjustment', {
        p_idempotency_key: parsed.data.idempotencyKey,
        p_order_id: order.id,
        p_actor_id: caller.id,
        p_actor_role: role,
        p_adjustment_type: parsed.data.type,
        p_summary: parsed.data.summary,
        p_reason: parsed.data.reason,
        p_responsibility: parsed.data.responsibility,
        p_amount_delta: amountDelta,
        p_currency: currency,
        p_proposed_deadline: parsed.data.proposedDeadline ?? null,
        p_evidence_ids: parsed.data.evidenceIds,
        p_correlation_id: correlationId,
      })
      if (error) {
        const message = error.message.includes('already open') ? 'Another change is already awaiting a decision on this order.' : error.message
        return fail(cors, 409, 'ADJUSTMENT_NOT_CREATED', message)
      }
      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: `${role === 'CUSTOMER' ? 'Customer' : 'Tailor'} proposed a formal ${parsed.data.type.toLowerCase().replaceAll('_', ' ')}. The accepted order stays unchanged until the counterpart decides.`,
      })
      await notifyCounterpart(supabase, order, role, {
        title: 'Order change needs a decision',
        body: `${parsed.data.summary} Review the exact price and deadline impact before work continues.`,
        key: `commercial-adjustment:${data.adjustmentId}:proposed`,
        type: 'commercial_adjustment',
      })
      const opsReviewRecommended = amountDelta !== 0
        || !!parsed.data.proposedDeadline
        || ['FULFILLMENT', 'CUSTOMS', 'CORRECTION'].includes(parsed.data.type)
        || ['FINISHING', 'READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage)
      if (opsReviewRecommended) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'ORDER_REVIEW', severity: amountDelta > 0 ? 'HIGH' : 'MEDIUM', source: FN,
          actorId: caller.id, actorRole: role, orderId: order.id,
          relatedEntityType: 'commercial_adjustment', relatedEntityId: data.adjustmentId,
          stage: order.stage, title: `Order amendment ${data.reference} needs oversight`,
          description: `${parsed.data.summary} Price delta: ${amountDelta} ${currency}; responsibility: ${parsed.data.responsibility}.`,
          recommendedAction: 'Review the evidence, counterpart outcome, deadline impact, payment allocation, and any fulfillment or refund consequence.',
          dedupeKey: `commercial-adjustment:${data.adjustmentId}`,
          metadata: { adjustment_id: data.adjustmentId, type: parsed.data.type, correlation_id: correlationId },
          notifyOps: amountDelta > 0,
        })
      }
      await audit(supabase, { event: 'commercial_adjustment.proposed', actor_id: caller.id, actor_role: role, order_id: order.id, severity: 'warn', payload: { adjustment_id: data.adjustmentId, type: parsed.data.type, correlation_id: correlationId } })
      return json({ ok: true, adjustment: data }, 200, cors)
    }

    const adjustment = await fetchAdjustment(supabase, parsed.data.adjustmentId)
    if (!adjustment) return fail(cors, 404, 'ADJUSTMENT_NOT_FOUND', 'This order change could not be found.')
    const order = await fetchOrder(supabase, adjustment.order_id)
    if (!order) return fail(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')
    const role = actorRole(order, caller.id)
    if (!role) return fail(cors, 403, 'ORDER_FORBIDDEN', 'Only the order customer or assigned tailor can use this change.')

    if (parsed.data.action === 'respond') {
      const note = parsed.data.note?.trim() ?? ''
      if (note) {
        const blocked = await rejectIfBlockedContact({ supabase, fn: FN, cors, actorId: caller.id, actorRole: role, surface: 'commercial_adjustment.response', text: note, message: "Contact details can't be included in a change response.", orderId: order.id, extra: { decision: parsed.data.decision } })
        if (blocked) return blocked
      }
      const { data, error } = await supabase.rpc('respond_commercial_adjustment', {
        p_adjustment_id: adjustment.id,
        p_actor_id: caller.id,
        p_actor_role: role,
        p_decision: parsed.data.decision,
        p_note: note || null,
      })
      if (error) return fail(cors, 409, 'ADJUSTMENT_NOT_OPEN', error.message)
      await supabase.from('order_stage_updates').insert({ order_id: order.id, stage: order.stage, note: `${role === 'CUSTOMER' ? 'Customer' : 'Tailor'} ${parsed.data.decision.toLowerCase()} the formal order change.` })
      await notifyCounterpart(supabase, order, role, {
        title: 'Order change updated',
        body: parsed.data.decision === 'ACCEPTED' && adjustment.requires_payment
          ? 'The change was accepted. The exact additional payment must complete before the added work starts.'
          : `The change was ${parsed.data.decision.toLowerCase()}. Review the order timeline for the recorded outcome.`,
        key: `commercial-adjustment:${adjustment.id}:${parsed.data.decision}`,
        type: 'commercial_adjustment_response',
      })
      if (parsed.data.decision !== 'ACCEPTED' || !adjustment.requires_payment) {
        await resolveOpsIssue(supabase, adjustment.id, `Counterpart outcome: ${parsed.data.decision}`)
      }
      await audit(supabase, { event: 'commercial_adjustment.decided', actor_id: caller.id, actor_role: role, order_id: order.id, severity: 'warn', payload: { adjustment_id: adjustment.id, decision: parsed.data.decision, correlation_id: adjustment.correlation_id } })
      return json({ ok: true, adjustment: data }, 200, cors)
    }

    if (parsed.data.action === 'prepare-payment') {
      if (role !== 'CUSTOMER' || adjustment.customer_id !== caller.id) return fail(cors, 403, 'PAYMENT_FORBIDDEN', 'Only the customer can pay an accepted order change.')
      if (adjustment.status !== 'PAYMENT_PENDING' || !adjustment.requires_payment || adjustment.amount_delta <= 0) return fail(cors, 409, 'ADJUSTMENT_NOT_PAYABLE', 'This order change is not awaiting payment.')
      const currency = normalizeAccountCurrency(adjustment.currency)
      if (!currency) return fail(cors, 409, 'CURRENCY_UNSUPPORTED', 'This order change currency is not supported.')
      if (adjustment.payment_id) {
        const { data: existingPayment, error: existingError } = await supabase.from('order_payments')
          .select('id, provider, provider_payment_id, provider_checkout_url, status, amount, currency')
          .eq('id', adjustment.payment_id).maybeSingle()
        if (existingError) throw existingError
        if (existingPayment?.status === 'SUCCEEDED') return json({ ok: true, confirmed: true, amount: existingPayment.amount, currency: existingPayment.currency }, 200, cors)
        if (existingPayment?.status === 'PENDING' && existingPayment.provider_payment_id) {
          if (existingPayment.provider === 'PAYSTACK') {
            return json({ ok: true, provider: 'PAYSTACK', adjustmentId: adjustment.id, paymentIntentId: existingPayment.provider_payment_id, authorizationUrl: existingPayment.provider_checkout_url, clientSecret: null, amount: existingPayment.amount, currency: existingPayment.currency }, 200, cors)
          }
          const intent = await retrieveStripePaymentIntent(existingPayment.provider_payment_id)
          return json({ ok: true, provider: 'STRIPE', adjustmentId: adjustment.id, paymentIntentId: intent.id, authorizationUrl: null, clientSecret: intent.client_secret ?? null, amount: existingPayment.amount, currency: existingPayment.currency }, 200, cors)
        }
      }
      const provider = resolvePaymentProviderForCurrency(currency)
      const reference = paystackReference(adjustment.id)
      const fulfillmentAllocation = ['FULFILLMENT', 'CUSTOMS'].includes(adjustment.adjustment_type)
      if (!fulfillmentAllocation && order.tax_fallback) return fail(cors, 409, 'TAX_NOT_LOCKED', 'Tax must be resolved before this additional payment can start.')
      const taxRateBps = fulfillmentAllocation ? 0 : Math.max(order.tax_rate_bps ?? 0, 0)
      const adjustmentSubtotal = Math.round(adjustment.amount_delta * 10_000 / (10_000 + taxRateBps))
      const adjustmentTaxAmount = adjustment.amount_delta - adjustmentSubtotal
      const pricingResult = await prepareCommercialPricingReservation(supabase, {
        idempotencyKey: `adjustment-pricing:${adjustment.id}`,
        orderId: order.id,
        phase: 'ADJUSTMENT',
        currency,
        amount: adjustment.amount_delta,
        correlationId: adjustment.correlation_id,
        adjustmentAllocation: fulfillmentAllocation ? 'FULFILLMENT' : 'TAILOR',
        adjustmentTaxAmount,
        adjustmentTaxJurisdiction: adjustmentTaxAmount > 0 ? order.tax_region : null,
      })
      const preparedPricing = pricingResult.skipped ? null : pricingResult
      let providerPaymentId: string
      let authorizationUrl: string | null = null
      let clientSecret: string | null = null
      let providerResponse: Record<string, unknown>
      if (provider === 'PAYSTACK') {
        if (!caller.email) return fail(cors, 409, 'EMAIL_REQUIRED', 'A verified email is required for this checkout.')
        const transaction = await initializePaystackTransaction({
          amount: adjustment.amount_delta,
          currency,
          email: caller.email,
          reference,
          callbackUrl: getPaystackCallbackUrl(),
          metadata: { order_id: order.id, adjustment_id: adjustment.id, payment_phase: 'ADJUSTMENT', correlation_id: adjustment.correlation_id },
        })
        providerPaymentId = transaction.reference
        authorizationUrl = transaction.authorization_url ?? null
        providerResponse = transaction as unknown as Record<string, unknown>
      } else {
        const intent = await createStripePaymentIntent({
          amount: adjustment.amount_delta,
          currency,
          description: `Drapeon order change ${order.reference ?? order.id}`,
          idempotencyKey: `adjustment:${adjustment.id}`,
          metadata: { order_id: order.id, adjustment_id: adjustment.id, payment_phase: 'ADJUSTMENT', correlation_id: adjustment.correlation_id },
        })
        providerPaymentId = intent.id
        clientSecret = intent.client_secret ?? null
        providerResponse = intent as unknown as Record<string, unknown>
      }
      const payment = await upsertPreparedPaymentAttempt(supabase, {
        orderId: order.id,
        phase: 'ADJUSTMENT',
        provider,
        currency,
        amount: adjustment.amount_delta,
        idempotencyKey: `adjustment-payment:${adjustment.id}`,
        providerPaymentId,
        providerCheckoutUrl: authorizationUrl,
        providerResponse,
        status: 'PENDING',
        preparedCommercialPricing: preparedPricing,
      })
      await supabase.from('commercial_adjustments').update({ payment_id: payment.id }).eq('id', adjustment.id).is('payment_id', null)
      await supabase.from('commercial_adjustment_events').insert({ adjustment_id: adjustment.id, event_type: 'PAYMENT_PREPARED', actor_id: caller.id, actor_role: 'CUSTOMER', payload: { provider, paymentId: payment.id }, correlation_id: adjustment.correlation_id })
      await audit(supabase, { event: 'commercial_adjustment.payment_prepared', actor_id: caller.id, actor_role: 'CUSTOMER', order_id: order.id, severity: 'warn', payload: { adjustment_id: adjustment.id, payment_id: payment.id, provider, correlation_id: adjustment.correlation_id } })
      return json({ ok: true, provider, adjustmentId: adjustment.id, paymentIntentId: providerPaymentId, authorizationUrl, clientSecret, amount: adjustment.amount_delta, currency }, 200, cors)
    }

    if (parsed.data.action === 'confirm-payment') {
      if (role !== 'CUSTOMER' || !adjustment.payment_id) return fail(cors, 403, 'PAYMENT_FORBIDDEN', 'This payment cannot be confirmed from this account.')
      const { data: payment, error } = await supabase.from('order_payments').select('id, provider, provider_payment_id, status').eq('id', adjustment.payment_id).maybeSingle()
      if (error || !payment?.provider_payment_id) return fail(cors, 409, 'PAYMENT_NOT_PREPARED', 'Start the order-change payment first.')
      if (parsed.data.paymentIntentId && parsed.data.paymentIntentId !== payment.provider_payment_id) return fail(cors, 409, 'STALE_PAYMENT', 'This payment attempt is no longer current.')
      let succeeded = false
      let response: Record<string, unknown>
      if (payment.provider === 'PAYSTACK') {
        const transaction = await verifyPaystackTransaction(payment.provider_payment_id)
        succeeded = transaction.status === 'success'
        response = transaction as unknown as Record<string, unknown>
      } else {
        const intent = await retrieveStripePaymentIntent(payment.provider_payment_id)
        succeeded = intent.status === 'succeeded'
        response = intent as unknown as Record<string, unknown>
      }
      if (!succeeded) return fail(cors, 409, 'PAYMENT_NOT_COMPLETE', 'This order-change payment is not complete yet.')
      await markPaymentAttemptStatus(supabase, { provider: payment.provider, providerPaymentId: payment.provider_payment_id, status: 'SUCCEEDED', providerResponse: response })
      return json({ ok: true, confirmed: true, adjustment: await fetchAdjustment(supabase, adjustment.id) }, 200, cors)
    }

    if (parsed.data.action === 'complete') {
      if (role !== 'TAILOR' || adjustment.tailor_id !== caller.id) return fail(cors, 403, 'COMPLETION_FORBIDDEN', 'Only the assigned tailor can mark accepted added work complete.')
      if (!['SCOPE', 'MATERIAL', 'RUSH_WORK', 'FIT_REVISION', 'CORRECTION', 'OTHER_REVIEWED'].includes(adjustment.adjustment_type)) return fail(cors, 409, 'COMPLETION_NOT_APPLICABLE', 'This amendment is complete when its decision or operational outcome is recorded.')
      if (!['ACCEPTED', 'PAID'].includes(adjustment.status)) return fail(cors, 409, 'ADJUSTMENT_NOT_READY', 'This change must be accepted and paid when required before completion.')
      const { data, error } = await supabase.from('commercial_adjustments').update({ status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', adjustment.id).in('status', ['ACCEPTED', 'PAID']).select('*').maybeSingle()
      if (error || !data?.id) return fail(cors, 409, 'ADJUSTMENT_STATE_CHANGED', 'This change was already updated. Refresh the order.')
      await supabase.from('commercial_adjustment_events').insert({ adjustment_id: adjustment.id, event_type: 'COMPLETED', actor_id: caller.id, actor_role: 'TAILOR', payload: { note: parsed.data.note ?? null }, correlation_id: adjustment.correlation_id })
      await notifyCounterpart(supabase, order, role, { title: 'Approved order change completed', body: 'Your tailor marked the approved added work complete. The original order and this amendment remain separately recorded.', key: `commercial-adjustment:${adjustment.id}:completed`, type: 'commercial_adjustment_completed' })
      await audit(supabase, { event: 'commercial_adjustment.completed', actor_id: caller.id, actor_role: role, order_id: order.id, severity: 'info', payload: { adjustment_id: adjustment.id, correlation_id: adjustment.correlation_id } })
      return json({ ok: true, adjustment: data }, 200, cors)
    }

    return fail(cors, 400, 'ACTION_NOT_SUPPORTED', 'This order-change action is not supported.')
  } catch (error) {
    log('error', FN, 'action.failed', { actor_id: caller.id, action: parsed.data.action, error: error instanceof Error ? error.message : String(error) })
    await Sentry.captureMessage('Commercial adjustment action failed', { tags: { function: FN, action: parsed.data.action }, extra: { actorId: caller.id, error: error instanceof Error ? error.message : String(error) } })
    return fail(cors, 500, 'ADJUSTMENT_FAILED', 'Drapeon could not safely update this order change right now.')
  }
})
