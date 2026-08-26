import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit } from '../_shared/logger.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { prepareCommercialPricingReservation } from '../_shared/commercial-ledger.ts'
import { markPaymentAttemptStatus, upsertPreparedPaymentAttempt } from '../_shared/payment-ledger.ts'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../_shared/paystack.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { Sentry } from '../_shared/sentry.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent } from '../_shared/stripe.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'fabric-workflow-action'
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()
const MediaSchema = z.object({
  originalStoragePath: z.string().trim().min(3).max(500),
  displayStoragePath: z.string().trim().min(3).max(500).optional(),
  posterStoragePath: z.string().trim().min(3).max(500).optional(),
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    sourceWidth: z.number().positive().optional(),
    sourceHeight: z.number().positive().optional(),
    rotation: z.number().optional(),
    aspectRatio: z.literal('4:3'),
  }).optional(),
})

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get-state'), orderId: uuid }),
  z.object({ action: z.literal('submit-candidate'), orderId: uuid, componentCode: z.enum(['FABRIC','LINING','EMBROIDERY','TRIMS','NOTIONS','OTHER_AGREED_MATERIAL']), supplierCostAmount: z.number().int().positive(), currency: z.string().trim().length(3), estimateStoragePath: z.string().trim().min(3).max(500), customerMedia: z.array(MediaSchema).min(1).max(6), availabilityNote: z.string().trim().min(2).max(500), quantitySpecification: z.string().trim().min(2).max(500), deadlineImpact: z.enum(['NONE','MAY_DELAY','DELAYS_ORDER']), deadlineImpactNote: nullableText(500), idempotencyKey: z.string().trim().min(8).max(200) }),
  z.object({ action: z.literal('decide-candidate'), candidateId: uuid, decision: z.enum(['APPROVE','REQUEST_CHANGES','DECLINE']), reasonCode: nullableText(80), note: nullableText(1000) }),
  z.object({ action: z.literal('prepare-shortfall-payment'), candidateId: uuid }),
  z.object({ action: z.literal('confirm-shortfall-payment'), candidateId: uuid, paymentIntentId: z.string().trim().min(1).nullable().optional() }),
  z.object({ action: z.literal('reconcile-candidate'), candidateId: uuid, receiptStoragePath: z.string().trim().min(3).max(500), acquiredMedia: z.array(MediaSchema).min(1).max(6), actualSpendAmount: z.number().int().nonnegative() }),
  z.object({ action: z.literal('save-handoff'), orderId: uuid, mode: z.enum(['CUSTOMER_SHIPS_TO_TAILOR','CUSTOMER_DROPS_OFF_LOCALLY','TAILOR_PICKS_UP_LOCALLY','BRINGS_TO_CONSULTATION']), status: z.enum(['AWAITING_HANDOFF','SCHEDULED','IN_TRANSIT']), carrier: nullableText(120), trackingNumber: nullableText(120), trackingUrl: z.string().trim().url().nullable().optional(), scheduledAt: z.string().datetime().nullable().optional(), timezone: nullableText(80), handoffLocation: nullableText(500) }),
  z.object({ action: z.literal('confirm-handoff-receipt'), orderId: uuid, outcome: z.enum(['RECEIVED_SUITABLE','RECEIVED_WITH_ISSUE']), receivedMedia: z.array(MediaSchema).min(1).max(6), issueNote: nullableText(1000) }),
  z.object({ action: z.literal('resolve-handoff-issue'), orderId: uuid, resolution: z.enum(['CUSTOMER_PROVIDES_REPLACEMENT','TAILOR_SOURCES_REPLACEMENT','CONTINUE_WITH_CURRENT_FABRIC']), note: nullableText(1000) }),
  z.object({ action: z.literal('cutting-blockers'), orderId: uuid }),
])

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function notifyCounterpart(supabase: any, order: any, actorId: string, candidate: any, event: string) {
  const recipient = actorId === order.customer_id ? order.tailor_id : order.customer_id
  const audience = recipient === order.customer_id ? 'CUSTOMER' : 'TAILOR'
  const candidateId = candidate?.id ?? null
  const copy: Record<string, { title: string; body: string }> = {
    CANDIDATE_SUBMITTED: { title: 'Fabric ready for your decision', body: 'Review the exact fabric, supplier proof, cost, availability, and deadline impact.' },
    APPROVE: { title: 'Fabric approved', body: 'The exact approved amount is now moving through protected release.' },
    REQUEST_CHANGES: { title: 'Fabric changes requested', body: 'Open the order to review the reason and submit a replacement candidate.' },
    DECLINE: { title: 'Fabric declined', body: 'Open the order to review the reason and choose the next fabric step.' },
    RECONCILED: { title: 'Fabric purchase reconciled', body: 'The receipt and acquired-material proof match the exact approved amount.' },
    RECONCILIATION_EXCEPTION: { title: 'Fabric purchase needs review', body: 'The recorded spend differs from the approved amount. Drapeon has protected the next step while the difference is resolved.' },
    SHORTFALL_PAID: { title: 'Fabric payment confirmed', body: 'The uncovered material amount is paid. The exact approved fabric release is now queued.' },
    HANDOFF_UPDATED: { title: 'Fabric handoff updated', body: 'Open the order to see the latest handoff, tracking, or receipt state.' },
  }
  const message = copy[event] ?? copy.HANDOFF_UPDATED
  const stateKey = candidate?.updated_at ?? candidate?.status ?? candidate?.correlation_id ?? ''
  const suffix = event === 'SHORTFALL_PAID'
    ? String(candidateId ?? order.id)
    : `${candidateId ?? order.id}:${stateKey}`
  const evidenceArtifact = Array.isArray(candidate?.acquired_media) && candidate.acquired_media.length > 0
    ? candidate.acquired_media[0]
    : Array.isArray(candidate?.received_media) && candidate.received_media.length > 0
      ? candidate.received_media[0]
      : Array.isArray(candidate?.customer_media) ? candidate.customer_media[0] : null
  const evidencePath = evidenceArtifact?.mediaType === 'VIDEO'
    ? evidenceArtifact?.posterStoragePath ?? null
    : evidenceArtifact?.displayStoragePath ?? evidenceArtifact?.originalStoragePath ?? null
  await Promise.all([
    enqueuePushJob(supabase, { userId: recipient, orderId: order.id, source: FN, idempotencyKey: `${event}:push:${suffix}`, notification: { title: message.title, body: message.body, data: { destination: 'ORDER', orderId: order.id, section: 'fabric', ...(candidateId ? { candidateId } : {}) } } }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: recipient, audience, subject: message.title, headline: message.title, body: message.body, ctaLabel: 'Open fabric status', action: event, source: FN, idempotencyKey: `${event}:email:${suffix}`, evidenceImageUrl: evidencePath, evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null }),
  ])
}

async function signEvidencePath(supabase: any, path: unknown) {
  if (typeof path !== 'string' || path.length < 3 || /^https?:\/\//iu.test(path)) return null
  const { data, error } = await supabase.storage.from('commercial-evidence').createSignedUrl(path, 10 * 60)
  return error ? null : data?.signedUrl ?? null
}

async function signMediaArtifacts(supabase: any, value: unknown) {
  if (!Array.isArray(value)) return []
  return await Promise.all(value.map(async (artifact) => {
    const row = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {}
    const originalStoragePath = typeof row.originalStoragePath === 'string' ? row.originalStoragePath : null
    const displayStoragePath = typeof row.displayStoragePath === 'string' ? row.displayStoragePath : originalStoragePath
    const posterStoragePath = typeof row.posterStoragePath === 'string' ? row.posterStoragePath : null
    return {
      mediaType: row.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      crop: row.crop ?? null,
      originalUrl: await signEvidencePath(supabase, originalStoragePath),
      displayUrl: await signEvidencePath(supabase, displayStoragePath),
      posterUrl: await signEvidencePath(supabase, posterStoragePath),
    }
  }))
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors)
  const caller = await getAuthUser(req)
  if (!caller) return json({ error: 'UNAUTHORIZED' }, 401, cors)
  const parsed = parseBody(BodySchema, await req.json().catch(() => null))
  if (!parsed.ok) return json({
    error: 'INVALID_REQUEST',
    message: parsed.error,
    recoveryAction: 'CHECK_FABRIC_DETAILS',
  }, 400, cors)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const correlationId = crypto.randomUUID()
  try {
    const body = parsed.data
    const orderId = 'orderId' in body ? body.orderId : null
    let order: any = null
    if (orderId) {
      const result = await supabase.from('orders').select('id,reference,stage,customer_id,tailor_id,fabric_source,fabric_funding_policy_version').eq('id', orderId).maybeSingle()
      if (result.error) throw result.error
      order = result.data
      if (!order || ![order.customer_id, order.tailor_id].includes(caller.id)) return json({ error: 'ORDER_FORBIDDEN' }, 403, cors)
    }

    if (body.action === 'get-state') {
      const [allocationResult, candidatesResult, handoffResult, blockersResult] = await Promise.all([
        supabase.from('order_fabric_funding_allocations').select('*').eq('order_id', order.id).maybeSingle(),
        supabase.from('order_fabric_candidates').select('*').eq('order_id', order.id).order('submitted_at', { ascending: false }),
        supabase.from('order_fabric_handoffs').select('*').eq('order_id', order.id).maybeSingle(),
        supabase.rpc('get_order_fabric_cutting_blockers_v2', { p_order_id: order.id }),
      ])
      if (allocationResult.error) throw allocationResult.error
      if (candidatesResult.error) throw candidatesResult.error
      if (handoffResult.error) throw handoffResult.error
      if (blockersResult.error) throw blockersResult.error
      const isTailor = order.tailor_id === caller.id
      const candidates = await Promise.all((candidatesResult.data ?? []).map(async (candidate: any) => ({
        ...candidate,
        protected_allowance_amount: candidate.allowance_applied_amount,
        provider_release_status: candidate.provider_status,
        customer_media: undefined,
        acquired_media: undefined,
        estimate_storage_path: undefined,
        receipt_storage_path: undefined,
        provider_response: undefined,
        provider_release_response: undefined,
        supplierEstimateUrl: isTailor ? await signEvidencePath(supabase, candidate.estimate_storage_path) : null,
        receiptUrl: await signEvidencePath(supabase, candidate.receipt_storage_path),
        customerMedia: await signMediaArtifacts(supabase, candidate.customer_media),
        acquiredMedia: await signMediaArtifacts(supabase, candidate.acquired_media),
      })))
      const handoff = handoffResult.data ? {
        ...handoffResult.data,
        resolution_outcome: handoffResult.data.issue_outcome,
        receivedMedia: await signMediaArtifacts(supabase, handoffResult.data.received_media),
        received_media: undefined,
      } : null
      return json({
        ok: true,
        role: isTailor ? 'TAILOR' : 'CUSTOMER',
        order: {
          id: order.id,
          reference: order.reference,
          stage: order.stage,
          fabricSource: order.fabric_source,
          policyVersion: order.fabric_funding_policy_version,
        },
        allocation: allocationResult.data,
        candidates,
        handoff,
        cuttingBlockers: (blockersResult.data ?? []).map((blocker: Record<string, unknown>) => ({
          ...blocker,
          recovery_action: blocker.recoveryAction ?? blocker.recovery_action,
        })),
      }, 200, cors)
    }

    if (body.action === 'submit-candidate') {
      if (order.tailor_id !== caller.id) return json({ error: 'TAILOR_ONLY' }, 403, cors)
      const result = await supabase.rpc('submit_fabric_candidate_v2', { p_order_id: order.id, p_tailor_id: caller.id, p_component_code: body.componentCode, p_supplier_cost_amount: body.supplierCostAmount, p_currency: body.currency.toUpperCase(), p_estimate_storage_path: body.estimateStoragePath, p_customer_media: body.customerMedia, p_availability_note: body.availabilityNote, p_quantity_specification: body.quantitySpecification, p_deadline_impact: body.deadlineImpact, p_deadline_impact_note: body.deadlineImpactNote ?? null, p_correlation_id: correlationId, p_idempotency_key: body.idempotencyKey })
      if (result.error) throw result.error
      await notifyCounterpart(supabase, order, caller.id, result.data, 'CANDIDATE_SUBMITTED')
      await audit(supabase, { event: 'fabric_candidate.submitted', actor_id: caller.id, actor_role: 'TAILOR', order_id: order.id, payload: { function: FN, candidate_id: result.data.id, policy_version: result.data.policy_version, correlation_id: correlationId } })
      return json({ ok: true, candidate: result.data, acknowledgement: 'Fabric candidate sent for customer review.' }, 200, cors)
    }

    if (body.action === 'decide-candidate') {
      const candidateResult = await supabase.from('order_fabric_candidates').select('id,order_id,customer_id,tailor_id').eq('id', body.candidateId).single()
      if (candidateResult.error) throw candidateResult.error
      const candidateOrder = await supabase.from('orders').select('id,reference,stage,customer_id,tailor_id').eq('id', candidateResult.data.order_id).single()
      if (candidateOrder.error) throw candidateOrder.error
      order = candidateOrder.data
      if (order.customer_id !== caller.id) return json({ error: 'CUSTOMER_ONLY' }, 403, cors)
      const result = await supabase.rpc('decide_fabric_candidate_v2', { p_candidate_id: body.candidateId, p_customer_id: caller.id, p_decision: body.decision, p_reason_code: body.reasonCode ?? null, p_note: body.note ?? null })
      if (result.error) throw result.error
      await notifyCounterpart(supabase, order, caller.id, result.data, body.decision)
      if (result.data.status === 'RELEASE_QUEUED') {
        await enqueueBackgroundJob(supabase, { jobType: 'PROCESS_FABRIC_RELEASE', eventType: 'fabric.release_requested', aggregateType: 'fabric_candidate', aggregateId: result.data.id, orderId: order.id, actorId: caller.id, actorRole: 'CUSTOMER', idempotencyKey: `fabric-release:${result.data.id}`, payload: { candidateId: result.data.id }, priority: 10, maxAttempts: 8 })
      }
      await audit(supabase, { event: `fabric_candidate.customer_${body.decision.toLowerCase()}`, actor_id: caller.id, actor_role: 'CUSTOMER', order_id: order.id, payload: { function: FN, candidate_id: result.data.id, correlation_id: result.data.correlation_id } })
      return json({ ok: true, candidate: result.data, acknowledgement: body.decision === 'APPROVE' ? 'Fabric approved and exact funding authorization recorded.' : 'Your fabric decision was sent to the tailor.' }, 200, cors)
    }

    if (body.action === 'prepare-shortfall-payment' || body.action === 'confirm-shortfall-payment') {
      const candidateResult = await supabase.from('order_fabric_candidates')
        .select('id,order_id,customer_id,tailor_id,status,currency,allowance_applied_amount,shortfall_subtotal_amount,shortfall_tax_amount,shortfall_fee_amount,shortfall_payment_id,correlation_id,customer_media')
        .eq('id', body.candidateId).single()
      if (candidateResult.error) throw candidateResult.error
      const candidate = candidateResult.data
      if (candidate.customer_id !== caller.id) return json({ error: 'CUSTOMER_ONLY' }, 403, cors)
      const orderResult = await supabase.from('orders')
        .select('id,reference,stage,customer_id,tailor_id,tax_region,tax_fallback')
        .eq('id', candidate.order_id).single()
      if (orderResult.error) throw orderResult.error
      order = orderResult.data
      const chargeAmount = candidate.shortfall_subtotal_amount + candidate.shortfall_tax_amount + candidate.shortfall_fee_amount
      const breakdown = {
        protectedAllowance: candidate.allowance_applied_amount,
        subtotal: candidate.shortfall_subtotal_amount,
        tax: candidate.shortfall_tax_amount,
        fee: candidate.shortfall_fee_amount,
        total: chargeAmount,
        currency: candidate.currency,
      }
      const currency = normalizeAccountCurrency(candidate.currency)
      if (!currency) return json({ error: 'CURRENCY_UNSUPPORTED', message: 'This material shortfall currency is not supported.' }, 409, cors)
      if (candidate.status === 'RELEASE_QUEUED' || candidate.status === 'RELEASE_PROCESSING' || candidate.status === 'AWAITING_RECEIPT' || candidate.status === 'RECONCILED') {
        return json({ ok: true, confirmed: true, candidate, acknowledgement: 'The material shortfall is already paid.' }, 200, cors)
      }
      if (candidate.status !== 'AWAITING_SHORTFALL_PAYMENT' || chargeAmount <= 0) {
        return json({ error: 'FABRIC_SHORTFALL_NOT_DUE', message: 'This fabric does not have an unpaid material shortfall.' }, 409, cors)
      }

      let existingPayment: any = null
      if (candidate.shortfall_payment_id) {
        const existing = await supabase.from('order_payments')
          .select('id,provider,provider_payment_id,provider_checkout_url,status,amount,currency')
          .eq('id', candidate.shortfall_payment_id).maybeSingle()
        if (existing.error) throw existing.error
        existingPayment = existing.data
      }

      if (body.action === 'confirm-shortfall-payment') {
        if (!existingPayment?.provider_payment_id) return json({ error: 'PAYMENT_NOT_PREPARED', message: 'Start the material shortfall payment first.' }, 409, cors)
        if (body.paymentIntentId && body.paymentIntentId !== existingPayment.provider_payment_id) return json({ error: 'STALE_PAYMENT', message: 'This payment attempt is no longer current.' }, 409, cors)
        let succeeded = false
        let providerResponse: Record<string, unknown>
        if (existingPayment.provider === 'PAYSTACK') {
          const transaction = await verifyPaystackTransaction(existingPayment.provider_payment_id)
          succeeded = transaction.status === 'success'
          providerResponse = transaction as unknown as Record<string, unknown>
        } else {
          const intent = await retrieveStripePaymentIntent(existingPayment.provider_payment_id)
          succeeded = intent.status === 'succeeded'
          providerResponse = intent as unknown as Record<string, unknown>
        }
        if (!succeeded) return json({ error: 'PAYMENT_NOT_COMPLETE', message: 'The provider has not confirmed this material payment yet.' }, 409, cors)
        const payment = await markPaymentAttemptStatus(supabase, { provider: existingPayment.provider, providerPaymentId: existingPayment.provider_payment_id, status: 'SUCCEEDED', providerResponse })
        await notifyCounterpart(supabase, order, caller.id, candidate, 'SHORTFALL_PAID')
        return json({ ok: true, confirmed: true, payment, acknowledgement: 'Material shortfall paid. The exact approved fabric release is queued.' }, 200, cors)
      }

      if (existingPayment?.status === 'SUCCEEDED') {
        await supabase.rpc('mark_fabric_candidate_shortfall_paid_v2', { p_candidate_id: candidate.id, p_payment_id: existingPayment.id })
        return json({ ok: true, confirmed: true, amount: chargeAmount, currency, acknowledgement: 'The material shortfall is already paid.' }, 200, cors)
      }
      if (existingPayment?.status === 'PENDING' && existingPayment.provider_payment_id) {
        if (existingPayment.provider === 'PAYSTACK') {
          return json({ ok: true, provider: 'PAYSTACK', candidateId: candidate.id, paymentIntentId: existingPayment.provider_payment_id, authorizationUrl: existingPayment.provider_checkout_url, clientSecret: null, amount: chargeAmount, currency, breakdown }, 200, cors)
        }
        const intent = await retrieveStripePaymentIntent(existingPayment.provider_payment_id)
        return json({ ok: true, provider: 'STRIPE', candidateId: candidate.id, paymentIntentId: intent.id, authorizationUrl: null, clientSecret: intent.client_secret ?? null, amount: chargeAmount, currency, breakdown }, 200, cors)
      }
      if (order.tax_fallback) return json({ error: 'TAX_NOT_LOCKED', message: 'Tax must be resolved before this material shortfall can be paid.' }, 409, cors)

      const pricingResult = await prepareCommercialPricingReservation(supabase, {
        idempotencyKey: `fabric-shortfall-pricing:${candidate.id}`,
        orderId: order.id,
        phase: 'ADJUSTMENT',
        currency,
        amount: chargeAmount,
        correlationId: candidate.correlation_id,
        adjustmentAllocation: 'MATERIAL',
        adjustmentTaxAmount: candidate.shortfall_tax_amount,
        adjustmentTaxJurisdiction: candidate.shortfall_tax_amount > 0 ? order.tax_region : null,
      })
      const preparedPricing = pricingResult.skipped ? null : pricingResult
      const provider = resolvePaymentProviderForCurrency(currency)
      let providerPaymentId: string
      let authorizationUrl: string | null = null
      let clientSecret: string | null = null
      let providerResponse: Record<string, unknown>
      if (provider === 'PAYSTACK') {
        if (!caller.email) return json({ error: 'EMAIL_REQUIRED', message: 'A verified email is required for this checkout.' }, 409, cors)
        const transaction = await initializePaystackTransaction({
          amount: chargeAmount,
          currency,
          email: caller.email,
          reference: `DRAPE-FABRIC-SHORTFALL-${candidate.id}`,
          callbackUrl: getPaystackCallbackUrl(),
          metadata: { order_id: order.id, fabric_candidate_id: candidate.id, payment_phase: 'ADJUSTMENT', correlation_id: candidate.correlation_id },
        })
        providerPaymentId = transaction.reference
        authorizationUrl = transaction.authorization_url ?? null
        providerResponse = transaction as unknown as Record<string, unknown>
      } else {
        const intent = await createStripePaymentIntent({
          amount: chargeAmount,
          currency,
          description: `Drapeon fabric shortfall ${order.reference ?? order.id}`,
          idempotencyKey: `fabric-shortfall:${candidate.id}`,
          metadata: { order_id: order.id, fabric_candidate_id: candidate.id, payment_phase: 'ADJUSTMENT', correlation_id: candidate.correlation_id },
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
        amount: chargeAmount,
        idempotencyKey: `fabric-shortfall-payment:${candidate.id}`,
        providerPaymentId,
        providerCheckoutUrl: authorizationUrl,
        providerResponse,
        status: 'PENDING',
        preparedCommercialPricing: preparedPricing,
      })
      const link = await supabase.from('order_payments').update({ fabric_candidate_id: candidate.id }).eq('id', payment.id)
      if (link.error) throw link.error
      const candidateLink = await supabase.from('order_fabric_candidates').update({ shortfall_payment_id: payment.id }).eq('id', candidate.id).is('shortfall_payment_id', null)
      if (candidateLink.error) throw candidateLink.error
      await supabase.from('order_fabric_events').insert({ order_id: order.id, candidate_id: candidate.id, event_type: 'SHORTFALL_PAYMENT_PREPARED', actor_id: caller.id, actor_role: 'CUSTOMER', payload: { paymentId: payment.id, provider, shortfallSubtotalAmount: candidate.shortfall_subtotal_amount, taxAmount: candidate.shortfall_tax_amount, feeAmount: candidate.shortfall_fee_amount, totalAmount: chargeAmount }, correlation_id: candidate.correlation_id })
      return json({ ok: true, provider, candidateId: candidate.id, paymentIntentId: providerPaymentId, authorizationUrl, clientSecret, amount: chargeAmount, currency, breakdown }, 200, cors)
    }

    if (body.action === 'reconcile-candidate') {
      const candidate = await supabase.from('order_fabric_candidates').select('id,order_id,tailor_id,provider,provider_reference,correlation_id,supplier_cost_amount,currency').eq('id', body.candidateId).single()
      if (candidate.error) throw candidate.error
      if (candidate.data.tailor_id !== caller.id) return json({ error: 'TAILOR_ONLY' }, 403, cors)
      const orderResult = await supabase.from('orders').select('id,reference,stage,customer_id,tailor_id').eq('id', candidate.data.order_id).single()
      if (orderResult.error) throw orderResult.error
      order = orderResult.data
      const result = await supabase.rpc('reconcile_fabric_candidate_v2', { p_candidate_id: body.candidateId, p_tailor_id: caller.id, p_receipt_storage_path: body.receiptStoragePath, p_acquired_media: body.acquiredMedia, p_actual_spend_amount: body.actualSpendAmount })
      if (result.error) throw result.error
      const dedupeKey = `fabric-candidate:reconciliation:${body.candidateId}`
      if (result.data.status === 'RECONCILED') {
        await resolveOpsIssueByDedupeKey(supabase, dedupeKey, {
          resolvedBy: caller.id,
          outcome: 'EXACT',
          correlationId: candidate.data.correlation_id,
        })
      } else {
        const difference = body.actualSpendAmount - candidate.data.supplier_cost_amount
        const issue = await createOrRefreshOpsIssue(supabase, {
          issueType: 'ORDER_REVIEW',
          severity: Math.abs(difference) > Math.max(10_000, Math.round(candidate.data.supplier_cost_amount * 0.1)) ? 'HIGH' : 'MEDIUM',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          orderId: order.id,
          userId: caller.id,
          relatedEntityType: 'order_fabric_candidate',
          relatedEntityId: body.candidateId,
          provider: candidate.data.provider,
          stage: order.stage,
          title: result.data.reconciliation_status === 'UNUSED_VALUE' ? 'Unused fabric funding needs reconciliation' : 'Fabric cost exceeds the approved amount',
          description: `The final supplier receipt differs from the customer-authorized fabric amount by ${Math.abs(difference)} ${candidate.data.currency}. Cutting remains blocked until the difference reaches a terminal resolution.`,
          recommendedAction: result.data.reconciliation_status === 'UNUSED_VALUE'
            ? 'Verify the private receipt and acquired-material proof, then return the unused protected value through the established refund workflow.'
            : 'Verify the private receipt and acquired-material proof. Do not release additional funds unless the customer authorizes a reviewed commercial change.',
          dedupeKey,
          notifyOps: true,
          metadata: {
            candidate_id: body.candidateId,
            approved_amount: candidate.data.supplier_cost_amount,
            actual_spend_amount: body.actualSpendAmount,
            difference_amount: difference,
            currency: candidate.data.currency,
            reconciliation_status: result.data.reconciliation_status,
            provider_reference: candidate.data.provider_reference,
            correlation_id: candidate.data.correlation_id,
            receipt_storage_path: body.receiptStoragePath,
            acquired_media_count: body.acquiredMedia.length,
            recovery_action: result.data.reconciliation_status === 'UNUSED_VALUE' ? 'REFUND_UNUSED_FABRIC_VALUE' : 'REVIEW_FABRIC_OVERAGE',
          },
        })
        if (issue?.id) {
          await supabase.from('order_fabric_candidates').update({ ops_issue_id: issue.id }).eq('id', body.candidateId)
        }
      }
      await notifyCounterpart(supabase, order, caller.id, result.data, result.data.status === 'RECONCILED' ? 'RECONCILED' : 'RECONCILIATION_EXCEPTION')
      await audit(supabase, { event: result.data.status === 'RECONCILED' ? 'fabric_candidate.reconciled' : 'fabric_candidate.reconciliation_exception', actor_id: caller.id, actor_role: 'TAILOR', order_id: order.id, payload: { function: FN, candidate_id: body.candidateId, reconciliation_status: result.data.reconciliation_status, approved_amount: candidate.data.supplier_cost_amount, actual_spend_amount: body.actualSpendAmount, correlation_id: candidate.data.correlation_id } })
      return json({ ok: true, candidate: result.data, acknowledgement: result.data.status === 'RECONCILED' ? 'Receipt and acquired material reconciled exactly.' : 'Evidence saved. Drapeon is reviewing the amount difference.' }, 200, cors)
    }

    if (body.action === 'save-handoff') {
      if (body.mode === 'CUSTOMER_SHIPS_TO_TAILOR' && body.status !== 'AWAITING_HANDOFF' && (!body.carrier?.trim() || !body.trackingNumber?.trim())) {
        return json({ error: 'FABRIC_TRACKING_REQUIRED', message: 'Add the carrier and tracking number before marking customer fabric in transit.' }, 400, cors)
      }
      if (body.mode !== 'CUSTOMER_SHIPS_TO_TAILOR' && body.status !== 'AWAITING_HANDOFF' && !body.scheduledAt) {
        return json({ error: 'FABRIC_HANDOFF_TIME_REQUIRED', message: 'Choose the agreed handoff time before scheduling this fabric handoff.' }, 400, cors)
      }
      const result = await supabase.rpc('save_fabric_handoff_v2', { p_order_id: order.id, p_actor_id: caller.id, p_mode: body.mode, p_status: body.status, p_carrier: body.carrier ?? null, p_tracking_number: body.trackingNumber ?? null, p_tracking_url: body.trackingUrl ?? null, p_scheduled_at: body.scheduledAt ?? null, p_timezone: body.timezone ?? null, p_handoff_location: body.handoffLocation ?? null })
      if (result.error) throw result.error
      await notifyCounterpart(supabase, order, caller.id, result.data, 'HANDOFF_UPDATED')
      await audit(supabase, { event: 'fabric_handoff.updated', actor_id: caller.id, actor_role: order.customer_id === caller.id ? 'CUSTOMER' : 'TAILOR', order_id: order.id, payload: { function: FN, handoff_id: result.data.id, mode: result.data.mode, status: result.data.status, correlation_id: result.data.correlation_id } })
      return json({ ok: true, handoff: result.data, acknowledgement: 'Fabric handoff updated.' }, 200, cors)
    }

    if (body.action === 'confirm-handoff-receipt') {
      if (order.tailor_id !== caller.id) return json({ error: 'TAILOR_ONLY' }, 403, cors)
      const result = await supabase.rpc('confirm_fabric_handoff_receipt_v2', { p_order_id: order.id, p_tailor_id: caller.id, p_outcome: body.outcome, p_received_media: body.receivedMedia, p_issue_note: body.issueNote ?? null })
      if (result.error) throw result.error
      await notifyCounterpart(supabase, order, caller.id, result.data, 'HANDOFF_UPDATED')
      await audit(supabase, { event: body.outcome === 'RECEIVED_SUITABLE' ? 'fabric_handoff.received_suitable' : 'fabric_handoff.received_with_issue', actor_id: caller.id, actor_role: 'TAILOR', order_id: order.id, payload: { function: FN, handoff_id: result.data.id, correlation_id: result.data.correlation_id } })
      return json({ ok: true, handoff: result.data, acknowledgement: body.outcome === 'RECEIVED_SUITABLE' ? 'Fabric received and marked suitable for production.' : 'Material issue sent to the customer.' }, 200, cors)
    }

    if (body.action === 'resolve-handoff-issue') {
      if (order.customer_id !== caller.id) return json({ error: 'CUSTOMER_ONLY' }, 403, cors)
      const result = await supabase.rpc('resolve_fabric_handoff_issue_v2', { p_order_id: order.id, p_customer_id: caller.id, p_outcome: body.resolution, p_note: body.note ?? null })
      if (result.error) throw result.error
      await notifyCounterpart(supabase, order, caller.id, result.data, 'HANDOFF_UPDATED')
      await audit(supabase, { event: 'fabric_handoff.issue_resolved', actor_id: caller.id, actor_role: 'CUSTOMER', order_id: order.id, payload: { function: FN, handoff_id: result.data.id, resolution: body.resolution, correlation_id: result.data.correlation_id } })
      return json({ ok: true, handoff: result.data, acknowledgement: 'Your material-issue decision was sent.' }, 200, cors)
    }

    const result = await supabase.rpc('get_order_fabric_cutting_blockers_v2', { p_order_id: order.id })
    if (result.error) throw result.error
    return json({ ok: true, blockers: result.data }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Sentry.captureMessage('Fabric workflow action failed', { level: 'error', tags: { function: FN, action: parsed.data.action }, extra: { orderId: 'orderId' in parsed.data ? parsed.data.orderId : null, correlationId, error: message } })
    return json({ error: message.split(':')[0], message: 'This fabric action could not be completed. Your input was kept; try again or follow the recovery step shown.' }, 409, cors)
  }
})
