import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl, isTrustedServiceRoleToken } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { partiallyRefundOrderPayments, refundSettledOrderPayments } from '../_shared/payment-refunds.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { Sentry } from '../_shared/sentry.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import {
  ensureCommercialPaymentCaptureForRefund,
  recordCommercialPaymentRefund,
} from '../_shared/commercial-ledger.ts'
import { pendingRefundOutcomeMessage, refundOutcomeMessage, refundTimingMessage } from '../_shared/refund-guidance.ts'

const FN = 'refund-order-payments'

const BodySchema = z.object({
  orderId: uuid,
  reason: z.string().trim().max(300).optional(),
  amount: z.number().int().positive().optional(),
  refundResolutionId: uuid.optional(),
  materialAdvanceId: uuid.optional(),
  includeUnreleasedMaterialAdvances: z.boolean().optional().default(false),
  allowedPhases: z.array(z.enum(['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT', 'MATERIAL_ADVANCE'])).min(1).optional(),
  reconcileIssueNumber: z.number().int().positive().optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  const payload =
    typeof body.error === 'string' && typeof body.message !== 'string'
      ? { ...body, message: body.error }
      : body
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return typeof error === 'string' && error.trim().length > 0 ? error : 'Refund failed'
}

async function isServiceRoleCaller(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice('Bearer '.length).trim()
  return isTrustedServiceRoleToken(token)
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (!(await isServiceRoleCaller(req))) {
    return jsonResponse({ error: 'This refund action requires a trusted service request.' }, 401, cors)
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST to run this refund action.' }, 405, cors)
  }

  let supabase: SupabaseClient | null = null
  let activeRefundResolutionId: string | null = null
  let activeMaterialContext: { advanceId: string; orderId: string; customerId: string | null; tailorId: string | null } | null = null
  try {
    supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
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

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const { orderId, reason, amount, refundResolutionId, materialAdvanceId, includeUnreleasedMaterialAdvances, allowedPhases, reconcileIssueNumber } = parsed.data
    if (reconcileIssueNumber) {
      if (amount || refundResolutionId || materialAdvanceId || includeUnreleasedMaterialAdvances) {
        return jsonResponse({ error: 'Ledger reconciliation cannot be combined with a new refund request.' }, 409, cors)
      }
      const { data: issue, error: issueError } = await supabase.from('ops_issues')
        .select('id,status,source,order_id,metadata').eq('issue_number', reconcileIssueNumber).maybeSingle()
      if (issueError) throw issueError
      if (!issue?.id || issue.order_id !== orderId || issue.source !== 'commercial-ledger' || !['OPEN','IN_REVIEW','ESCALATED'].includes(issue.status)) {
        return jsonResponse({ error: 'This active refund-ledger issue could not be reconciled.' }, 409, cors)
      }
      const issueMetadata = issue.metadata && typeof issue.metadata === 'object'
        ? issue.metadata as Record<string, unknown>
        : {}
      const paymentId = typeof issueMetadata.payment_id === 'string' ? issueMetadata.payment_id : null
      const refundAmount = typeof issueMetadata.refund_amount === 'number' ? issueMetadata.refund_amount : null
      if (!paymentId || !refundAmount || refundAmount <= 0) {
        return jsonResponse({ error: 'The reconciliation issue is missing its immutable payment snapshot.' }, 409, cors)
      }
      const { data: payment, error: paymentError } = await supabase.from('order_payments')
        .select('id,order_id,status,refunded_amount,provider_response,correlation_id').eq('id', paymentId).maybeSingle()
      if (paymentError) throw paymentError
      const providerResponse = payment?.provider_response && typeof payment.provider_response === 'object'
        ? payment.provider_response as Record<string, unknown>
        : {}
      const latestRefund = providerResponse.latest_refund && typeof providerResponse.latest_refund === 'object'
        ? providerResponse.latest_refund as Record<string, unknown>
        : null
      const latestProviderResponse = latestRefund?.response && typeof latestRefund.response === 'object'
        ? latestRefund.response as Record<string, unknown>
        : null
      if (
        !payment?.id
        || payment.order_id !== orderId
        || !['PARTIAL_REFUND','REFUNDED'].includes(payment.status)
        || (payment.refunded_amount ?? 0) < refundAmount
        || latestRefund?.refund_amount !== refundAmount
        || !latestProviderResponse
        || latestProviderResponse.status !== 'processed'
      ) {
        return jsonResponse({ error: 'Provider completion evidence does not match this reconciliation issue or the refund is still processing. Do not post a journal automatically.' }, 409, cors)
      }
      const metadataResolutionId = typeof issueMetadata.refund_resolution_id === 'string'
        ? issueMetadata.refund_resolution_id
        : null
      let resolutionQuery = supabase.from('order_refund_resolutions')
        .select('id,financial_case_id,amount,tailor_work_amount,platform_fee_amount,tax_amount,fulfillment_amount,consultation_amount,promotion_amount,drapeon_funded_amount,order_outcome,resume_stage,outcome_applied_at')
        .eq('order_id', orderId)
        .eq('amount', refundAmount)
        .in('status', ['SUCCEEDED','FAILED','PROCESSING'])
        .order('created_at', { ascending: false })
        .limit(metadataResolutionId ? 1 : 2)
      if (metadataResolutionId) resolutionQuery = resolutionQuery.eq('id', metadataResolutionId)
      const { data: resolutions, error: resolutionError } = await resolutionQuery
      if (resolutionError) throw resolutionError
      if ((resolutions ?? []).length !== 1) {
        return jsonResponse({ error: 'The exact approved refund allocation is ambiguous. Reconcile this issue manually.' }, 409, cors)
      }
      const resolution = resolutions![0]
      const beforeRefunded = Math.max((payment.refunded_amount ?? 0) - refundAmount, 0)
      const rawProviderReference = latestProviderResponse.id ?? latestProviderResponse.reference ?? latestProviderResponse.transaction ?? null
      const providerReference = typeof rawProviderReference === 'string' || typeof rawProviderReference === 'number'
        ? String(rawProviderReference)
        : null
      const exactRestoration = {
        refundResolutionId: resolution.id,
        tailorWorkAmount: resolution.tailor_work_amount,
        platformFeeAmount: resolution.platform_fee_amount,
        taxAmount: resolution.tax_amount,
        fulfillmentAmount: resolution.fulfillment_amount,
        consultationAmount: resolution.consultation_amount,
        promotionAmount: resolution.promotion_amount,
        drapeonFundedAmount: resolution.drapeon_funded_amount,
      }
      await ensureCommercialPaymentCaptureForRefund(supabase, paymentId)
      const journal = await recordCommercialPaymentRefund(supabase, {
        paymentId,
        orderId,
        refundAmount,
        idempotencyKey: `payment-refund:${paymentId}:${beforeRefunded}:${refundAmount}`,
        providerReference,
        correlationId: payment.correlation_id,
        metadata: {
          actor_role: 'OPS',
          reason: reason ?? 'Reconciled an already-completed provider refund without contacting the provider again.',
          reconciliation_issue_number: reconcileIssueNumber,
        },
        exactRestoration,
      })
      const now = new Date().toISOString()
      await supabase.from('order_refund_resolutions').update({
        status: 'SUCCEEDED',
        provider_reference: providerReference,
        failure_summary: null,
        updated_at: now,
      }).eq('id', resolution.id)
      const { error: outcomeError } = await supabase.rpc('apply_ops_partial_refund_order_outcome', {
        p_resolution_id: resolution.id,
        p_provider_reference: providerReference,
      })
      if (outcomeError) throw outcomeError
      await supabase.from('ops_issues').update({ status: 'RESOLVED', resolved_at: now, last_seen_at: now }).eq('id', issue.id)
      await supabase.from('ops_audit_logs').insert({
        issue_id: issue.id,
        action_taken: 'REFUND_LEDGER_RECONCILED',
        performed_by: null,
        performed_role: 'OPS',
        reason: reason ?? 'Posted the missing refund journal from preserved provider evidence.',
        before_state: { status: issue.status },
        after_state: { status: 'RESOLVED', payment_id: paymentId, ledger_transaction_id: journal.transactionId },
      })
      return jsonResponse({
        ok: true,
        orderId,
        reconciled: true,
        issueNumber: reconcileIssueNumber,
        paymentId,
        ledgerTransactionId: journal.transactionId,
        providerContacted: false,
      }, 200, cors)
    }
    if (refundResolutionId && materialAdvanceId) return jsonResponse({ error: 'Choose one reviewed refund source.' }, 409, cors)
    if (includeUnreleasedMaterialAdvances && (refundResolutionId || materialAdvanceId || typeof amount === 'number')) {
      return jsonResponse({ error: 'A cancellation refund cannot be combined with another partial or reviewed refund mode.' }, 409, cors)
    }
    const { data: refundResolution, error: resolutionError } = refundResolutionId
      ? await supabase.from('order_refund_resolutions')
        .select('id, order_id, financial_case_id, return_request_id, amount, currency, tailor_work_amount, platform_fee_amount, tax_amount, fulfillment_amount, consultation_amount, promotion_amount, drapeon_funded_amount, released_tailor_recovery_amount, status, correlation_id, order_outcome, resume_stage, outcome_applied_at')
        .eq('id', refundResolutionId).maybeSingle()
      : { data: null, error: null }
    if (resolutionError) throw resolutionError
    if (refundResolutionId && !refundResolution) return jsonResponse({ error: 'The approved refund resolution was not found.' }, 404, cors)
    activeRefundResolutionId = refundResolution?.id ?? null
    if (refundResolution && refundResolution.order_id !== orderId) return jsonResponse({ error: 'The refund resolution does not belong to this order.' }, 409, cors)
    if (refundResolution?.status === 'SUCCEEDED') return jsonResponse({ ok: true, orderId, refundResolutionId, alreadyCompleted: true, refundMode: 'PARTIAL', requestedAmount: refundResolution.amount, refundedAttempts: [], alreadyRefundedAttemptIds: [], totalRefundedAmount: refundResolution.amount, remainingRefundableAmount: 0 }, 200, cors)
    if (refundResolution && !['APPROVED','PROCESSING'].includes(refundResolution.status)) return jsonResponse({ error: 'This refund must be approved through Money Desk before execution.' }, 409, cors)
    if (refundResolution && amount !== refundResolution.amount) return jsonResponse({ error: 'The execution amount must match the approved refund resolution exactly.' }, 409, cors)
    const { data: materialAdvance, error: materialAdvanceError } = materialAdvanceId
      ? await supabase.from('order_material_advances')
        .select('id,order_id,customer_refund_amount,reconciliation_outcome,reconciliation_resolution,refund_provider_started_at,refund_provider_completed_at,refund_provider_reference')
        .eq('id', materialAdvanceId).maybeSingle()
      : { data: null, error: null }
    if (materialAdvanceError) throw materialAdvanceError
    if (materialAdvanceId && !materialAdvance) return jsonResponse({ error: 'The reviewed material reconciliation was not found.' }, 404, cors)
    if (materialAdvance && (materialAdvance.order_id !== orderId || materialAdvance.reconciliation_outcome !== 'UNUSED_VALUE' || amount !== materialAdvance.customer_refund_amount)) {
      return jsonResponse({ error: 'The material refund does not match the reviewed unused-value outcome.' }, 409, cors)
    }
    if (materialAdvance?.refund_provider_completed_at) {
      return jsonResponse({ ok: true, orderId, materialAdvanceId, alreadyCompleted: true, refundMode: 'PARTIAL', requestedAmount: amount, refundedAttempts: [], alreadyRefundedAttemptIds: [], totalRefundedAmount: amount ?? 0, remainingRefundableAmount: 0, providerReference: materialAdvance.refund_provider_reference }, 200, cors)
    }
    if (materialAdvance?.refund_provider_started_at) {
      return jsonResponse({ error: 'This material refund already reached provider execution. Ops must verify the provider outcome before any retry.' }, 409, cors)
    }
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, reference, stage, customer_id, tailor_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      log('error', FN, 'db.error', { order_id: orderId, error: orderError.message, surface: 'orders.refund_preflight' })
      return jsonResponse({ error: 'Could not check this order before refund.' }, 500, cors)
    }
    if (materialAdvance && order?.id) {
      activeMaterialContext = { advanceId: materialAdvance.id, orderId: order.id, customerId: order.customer_id ?? null, tailorId: order.tailor_id ?? null }
    }

    const { data: cancellationAdvances, error: cancellationAdvancesError } = includeUnreleasedMaterialAdvances
      ? await supabase.from('order_material_advances')
        .select('id,payment_id,status,release_status,provider_release_status,paid_at,released_at')
        .eq('order_id', orderId)
        .not('payment_id', 'is', null)
        .not('paid_at', 'is', null)
      : { data: [], error: null }
    if (cancellationAdvancesError) throw cancellationAdvancesError
    const unsafeCancellationAdvance = (cancellationAdvances ?? []).find((advance) =>
      advance.released_at
      || advance.release_status === 'RELEASED'
      || !['NOT_REQUESTED', 'BLOCKED'].includes(advance.provider_release_status ?? 'NOT_REQUESTED')
    )
    if (unsafeCancellationAdvance) {
      return jsonResponse({
        error: 'A paid material advance has already reached provider release and requires a separate recovery review.',
      }, 409, cors)
    }
    if (includeUnreleasedMaterialAdvances && order?.stage !== 'IN_DISPUTE') {
      return jsonResponse({ error: 'Combined cancellation refunds require an order that is still under dispute review.' }, 409, cors)
    }

    const refundablePhases = allowedPhases ?? (includeUnreleasedMaterialAdvances
      ? ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT', 'MATERIAL_ADVANCE'] as const
      : ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT'] as const)

    const { data: attempts, error: attemptsError } = await supabase
      .from('order_payments')
      .select('id, status, amount, refunded_amount, provider_payment_id, provider, provider_response')
      .eq('order_id', orderId)
      .in('phase', refundResolution ? ['INITIAL_ORDER'] : [...refundablePhases])

    if (attemptsError) {
      log('error', FN, 'db.error', { order_id: orderId, error: attemptsError.message, surface: 'order_payments.refund_preflight' })
      return jsonResponse({ error: 'Could not check this order payment before refund.' }, 500, cors)
    }

    const paymentRows = (attempts ?? []) as Array<{
      id?: string | null
      status?: string | null
      amount?: number | null
      refunded_amount?: number | null
      provider_payment_id?: string | null
      provider?: string | null
      provider_response?: Record<string, unknown> | null
    }>
    const refundableTotal = paymentRows.reduce((sum, attempt) => {
      if (attempt.status !== 'SUCCEEDED' && attempt.status !== 'PARTIAL_REFUND') return sum
      const charged = typeof attempt.amount === 'number' ? attempt.amount : 0
      const refunded = typeof attempt.refunded_amount === 'number' ? attempt.refunded_amount : 0
      return sum + Math.max(charged - refunded, 0)
    }, 0)
    const everyPaymentAlreadyRefunded = paymentRows.length > 0 && paymentRows.every((attempt) => {
      const charged = typeof attempt.amount === 'number' ? attempt.amount : 0
      const refunded = typeof attempt.refunded_amount === 'number' ? attempt.refunded_amount : 0
      return attempt.status === 'REFUNDED' || refunded >= charged
    })
    const missingProviderReference = paymentRows.some((attempt) => {
      if (attempt.status !== 'SUCCEEDED' && attempt.status !== 'PARTIAL_REFUND') return false
      const charged = typeof attempt.amount === 'number' ? attempt.amount : 0
      const refunded = typeof attempt.refunded_amount === 'number' ? attempt.refunded_amount : 0
      return charged - refunded > 0 && !attempt.provider_payment_id?.trim()
    })
    const refundPreflight = runPreflight([
      {
        name: 'order_exists',
        condition: !!order?.id,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'This order could not be found before refund.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { orderId },
      },
      {
        name: 'refundable_payment_exists',
        condition: refundableTotal > 0 || (Boolean(includeUnreleasedMaterialAdvances) && everyPaymentAlreadyRefunded),
        errorCode: 'NO_REFUNDABLE_PAYMENT',
        message: 'This order has no settled payment left to refund.',
        field: 'order_payments',
        severity: 'BLOCKING',
        actual: { refundableTotal, paymentCount: paymentRows.length },
      },
      {
        name: 'partial_refund_within_remaining_balance',
        condition: typeof amount !== 'number' || amount <= refundableTotal,
        errorCode: 'REFUND_AMOUNT_EXCEEDS_BALANCE',
        message: 'The requested refund is larger than the remaining refundable balance.',
        field: 'amount',
        severity: 'BLOCKING',
        actual: { requestedAmount: amount ?? null, refundableTotal },
      },
      {
        name: 'provider_reference_present',
        condition: !missingProviderReference,
        errorCode: 'REFUND_PROVIDER_REFERENCE_MISSING',
        message: 'A settled payment is missing its provider reference and cannot be refunded safely.',
        field: 'provider_payment_id',
        severity: 'BLOCKING',
        actual: { missingProviderReference },
      },
    ])

    if (!refundPreflight.passed) {
      await logPreflightFailure(supabase, refundPreflight, {
        operation: 'refund_order_payments',
        entityType: 'order',
        entityId: orderId,
        actorRole: 'OPS',
        orderId,
        source: FN,
        metadata: { refundMode: typeof amount === 'number' ? 'PARTIAL' : 'FULL' },
      })
      return preflightFailureResponse(refundPreflight, cors, !order?.id ? 404 : 409)
    }
    if (!order) return jsonResponse({ error: 'This order could not be found before refund.' }, 404, cors)

    if (refundResolution) {
      const { error: processingError } = await supabase.from('order_refund_resolutions').update({ status: 'PROCESSING', updated_at: new Date().toISOString(), failure_summary: null }).eq('id', refundResolution.id).in('status', ['APPROVED','PROCESSING'])
      if (processingError) throw processingError
    }
    if (materialAdvance) {
      const { data: started, error: startError } = await supabase.from('order_material_advances')
        .update({ refund_provider_started_at: new Date().toISOString() })
        .eq('id', materialAdvance.id)
        .is('refund_provider_started_at', null)
        .select('id')
        .maybeSingle()
      if (startError) throw startError
      if (!started?.id) return jsonResponse({ error: 'This material refund is already being executed. Verify its provider outcome before retrying.' }, 409, cors)
    }
    const result = includeUnreleasedMaterialAdvances && everyPaymentAlreadyRefunded
      ? {
          refundedAttempts: [],
          pendingAttempts: [],
          alreadyRefundedAttemptIds: paymentRows
            .map((attempt) => attempt.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        }
      : typeof amount === 'number'
      ? await partiallyRefundOrderPayments(supabase, {
          orderId,
          amount,
          reason: reason ?? null,
          actorRole: 'OPS',
          allowedPhases: refundResolution ? ['INITIAL_ORDER'] : [...refundablePhases],
          exactRestoration: refundResolution ? {
            refundResolutionId: refundResolution.id,
            tailorWorkAmount: refundResolution.tailor_work_amount,
            platformFeeAmount: refundResolution.platform_fee_amount,
            taxAmount: refundResolution.tax_amount,
            fulfillmentAmount: refundResolution.fulfillment_amount,
            consultationAmount: refundResolution.consultation_amount,
            promotionAmount: refundResolution.promotion_amount,
            drapeonFundedAmount: refundResolution.drapeon_funded_amount,
          } : undefined,
        })
      : await refundSettledOrderPayments(supabase, {
          orderId,
          reason: reason ?? null,
          actorRole: 'OPS',
          allowedPhases: [...refundablePhases],
        })

    if (result.pendingAttempts.length > 0) {
      if (refundResolution) {
        const provider = result.pendingAttempts[0]?.provider ?? null
        const title = 'Order refund is processing'
        for (const recipient of [{ id: order.customer_id, audience: 'CUSTOMER' as const }, { id: order.tailor_id, audience: 'TAILOR' as const }]) {
          if (!recipient.id) continue
          const body = `${refundTimingMessage(provider, recipient.audience)} ${pendingRefundOutcomeMessage(refundResolution.order_outcome, refundResolution.resume_stage)}`
          await enqueuePushJob(supabase, { userId: recipient.id, notification: { title, body, preferenceKey: 'orderUpdates', data: { orderId, type: 'refund_processing', refundResolutionId: refundResolution.id } }, source: FN, idempotencyKey: `refund-resolution:${refundResolution.id}:${recipient.audience}:processing:push`, orderId, priority: 25 })
          await enqueueOrderEventEmailJob(supabase, { order, recipientUserId: recipient.id, audience: recipient.audience, subject: title, headline: title, body, ctaLabel: 'View refund status', source: FN, idempotencyKey: `refund-resolution:${refundResolution.id}:${recipient.audience}:processing:email`, priority: 25 })
        }
      }
      return jsonResponse({
        ok: true,
        pending: true,
        orderId,
        materialAdvanceId: materialAdvance?.id ?? null,
        refundResolutionId: refundResolution?.id ?? null,
        refundMode: typeof amount === 'number' ? 'PARTIAL' : 'FULL',
        requestedAmount: amount ?? null,
        refundedAttempts: result.refundedAttempts,
        pendingAttempts: result.pendingAttempts,
        alreadyRefundedAttemptIds: result.alreadyRefundedAttemptIds,
        totalRefundedAmount: 'totalRefundedAmount' in result ? result.totalRefundedAmount : result.refundedAttempts.reduce((sum, attempt) => sum + attempt.amount, 0),
        remainingRefundableAmount: 'remainingRefundableAmount' in result ? result.remainingRefundableAmount : 0,
        providerReference: result.pendingAttempts[0]?.providerRefundId ?? null,
      }, 202, cors)
    }

    if (includeUnreleasedMaterialAdvances && (cancellationAdvances ?? []).length > 0) {
      const materialPaymentIds = new Set(
        result.refundedAttempts
          .filter((attempt) => attempt.phase === 'MATERIAL_ADVANCE')
          .map((attempt) => attempt.id),
      )
      const alreadyRefundedIds = new Set(result.alreadyRefundedAttemptIds)
      const incompleteAdvance = (cancellationAdvances ?? []).find((advance) =>
        !advance.payment_id || (!materialPaymentIds.has(advance.payment_id) && !alreadyRefundedIds.has(advance.payment_id))
      )
      if (incompleteAdvance) {
        throw new Error('A paid material advance did not reach a recorded refund outcome.')
      }
      const now = new Date().toISOString()
      const { error: cancelledAdvanceError } = await supabase.from('order_material_advances').update({
        status: 'CANCELLED',
        release_status: 'BLOCKED',
        reconciliation_status: 'RESOLVED',
        reconciliation_outcome: 'UNUSED_VALUE',
        reconciled_at: now,
        reconciliation_resolved_at: now,
        reconciliation_resolution: 'CUSTOMER_REFUNDED',
      }).in('id', (cancellationAdvances ?? []).map((advance) => advance.id))
      if (cancelledAdvanceError) throw cancelledAdvanceError
    }

    if (includeUnreleasedMaterialAdvances) {
      const title = 'Your order cancellation refund is complete'
      const body = 'Every captured payment that had not been released has been refunded to the original payment method. Provider timing may vary.'
      for (const recipient of [
        { id: order.customer_id, audience: 'CUSTOMER' as const },
        { id: order.tailor_id, audience: 'TAILOR' as const },
      ]) {
        if (!recipient.id) continue
        await enqueuePushJob(supabase, {
          userId: recipient.id,
          notification: {
            title,
            body,
            preferenceKey: 'orderUpdates',
            data: { orderId, type: 'order_cancellation_refund_completed' },
          },
          source: FN,
          idempotencyKey: `order-cancellation-refund:${orderId}:${recipient.audience}:push`,
          orderId,
          priority: 30,
        })
        await enqueueOrderEventEmailJob(supabase, {
          order,
          recipientUserId: recipient.id,
          audience: recipient.audience,
          subject: title,
          headline: title,
          body,
          ctaLabel: 'View refunded order',
          source: FN,
          idempotencyKey: `order-cancellation-refund:${orderId}:${recipient.audience}:email`,
          priority: 30,
        })
      }
    }

    if (refundResolution) {
      const providerReference = result.refundedAttempts[0]?.providerPaymentId ?? null
      const { error: completeError } = await supabase.from('order_refund_resolutions').update({ status: 'SUCCEEDED', provider_reference: providerReference, updated_at: new Date().toISOString() }).eq('id', refundResolution.id)
      if (completeError) throw completeError
      if (refundResolution.return_request_id) {
        await supabase.from('order_return_requests').update({ status: 'RESOLVED', updated_at: new Date().toISOString() }).eq('id', refundResolution.return_request_id)
      }
      await supabase.from('financial_cases').update({ status: 'RESOLVED', money_movement_blocked: false, resolved_at: new Date().toISOString(), resolution_code: 'CUSTOMER_REFUND_COMPLETED', resolution_summary: 'The approved customer refund completed through Money Desk.' }).eq('id', refundResolution.financial_case_id)
      await supabase.from('financial_case_events').insert({ case_id: refundResolution.financial_case_id, event_type: 'CASE_RESOLVED', actor_id: null, actor_role: 'SYSTEM', payload: { refund_resolution_id: refundResolution.id, amount: refundResolution.amount, currency: refundResolution.currency, provider_reference: providerReference }, correlation_id: refundResolution.correlation_id })
      const { error: outcomeError } = await supabase.rpc('apply_ops_partial_refund_order_outcome', { p_resolution_id: refundResolution.id, p_provider_reference: providerReference })
      if (outcomeError) throw outcomeError
      const originalPayment = paymentRows.find((payment) => payment.provider)
      const provider = originalPayment?.provider ?? null
      const expectedAt = originalPayment?.provider_response && typeof originalPayment.provider_response.expected_at === 'string'
        ? originalPayment.provider_response.expected_at
        : null
      const title = 'Order refund is complete'
      for (const recipient of [{ id: order.customer_id, audience: 'CUSTOMER' as const }, { id: order.tailor_id, audience: 'TAILOR' as const }]) {
        if (!recipient.id) continue
        const body = `${refundTimingMessage(provider, recipient.audience, expectedAt)} ${refundOutcomeMessage(refundResolution.order_outcome, refundResolution.resume_stage)}`
        await enqueuePushJob(supabase, { userId: recipient.id, notification: { title, body, preferenceKey: 'orderUpdates', data: { orderId, type: 'refund_completed', refundResolutionId: refundResolution.id } }, source: FN, idempotencyKey: `refund-resolution:${refundResolution.id}:${recipient.audience}:push`, orderId, priority: 30 })
        await enqueueOrderEventEmailJob(supabase, { order, recipientUserId: recipient.id, audience: recipient.audience, subject: title, headline: title, body, ctaLabel: 'View resolution', source: FN, idempotencyKey: `refund-resolution:${refundResolution.id}:${recipient.audience}:email`, priority: 30 })
      }
    }
    if (materialAdvance) {
      const providerReference = result.refundedAttempts[0]?.providerPaymentId ?? null
      const { error: materialCompleteError } = await supabase.from('order_material_advances').update({
        refund_provider_completed_at: new Date().toISOString(),
        refund_provider_reference: providerReference,
      }).eq('id', materialAdvance.id).is('refund_provider_completed_at', null)
      if (materialCompleteError) throw materialCompleteError
      await audit(supabase, {
        event: 'material_advance.refund_provider_completed',
        actor_role: 'OPS',
        order_id: orderId,
        payload: { function: FN, advance_id: materialAdvance.id, amount, provider_reference: providerReference, refund_attempt_count: result.refundedAttempts.length },
      })
    }

    return new Response(JSON.stringify({
      ok: true,
      orderId,
      materialAdvanceId: materialAdvance?.id ?? null,
      refundMode: typeof amount === 'number' ? 'PARTIAL' : 'FULL',
      requestedAmount: amount ?? null,
      refundedAttempts: result.refundedAttempts,
      alreadyRefundedAttemptIds: result.alreadyRefundedAttemptIds,
      totalRefundedAmount: 'totalRefundedAmount' in result ? result.totalRefundedAmount : result.refundedAttempts.reduce((sum, attempt) => sum + attempt.amount, 0),
      remainingRefundableAmount: 'remainingRefundableAmount' in result ? result.remainingRefundableAmount : 0,
      providerReference: materialAdvance ? (result.refundedAttempts[0]?.providerPaymentId ?? null) : null,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = errorMessage(error)
    if (supabase && activeRefundResolutionId) {
      await supabase.from('order_refund_resolutions').update({ status: 'FAILED', failure_summary: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', activeRefundResolutionId).eq('status', 'PROCESSING')
    }
    if (supabase && activeMaterialContext) {
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: 'CRITICAL',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: activeMaterialContext.orderId,
        userId: activeMaterialContext.customerId,
        title: 'Material refund provider outcome needs verification',
        description: 'The unused-value refund execution did not reach a clean recorded outcome after provider execution started.',
        recommendedAction: 'Verify the original payment provider before any retry. If the refund succeeded, record the provider reference and run the idempotent finalization; never issue a second refund blindly.',
        dedupeKey: `material-advance:refund_provider_verification:${activeMaterialContext.advanceId}`,
        relatedEntityType: 'order_material_advance',
        relatedEntityId: activeMaterialContext.advanceId,
        notifyOps: true,
        metadata: { advance_id: activeMaterialContext.advanceId, safe_error: message },
      })
    }
    log('error', FN, 'refund.failed', { error: message })
    await Sentry.captureMessage('Refund execution failed', { level: 'error', tags: { function: FN, material_refund: activeMaterialContext ? 'true' : 'false' }, extra: { error: message, orderId: activeMaterialContext?.orderId ?? null, advanceId: activeMaterialContext?.advanceId ?? null } })
    return new Response(
      JSON.stringify({
        ok: false,
        error: message,
      }),
      {
        status: message.includes('cannot be refunded safely') ? 409 : 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    )
  }
})
