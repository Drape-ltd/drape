import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
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

const FN = 'refund-order-payments'

const BodySchema = z.object({
  orderId: uuid,
  reason: z.string().trim().max(300).optional(),
  amount: z.number().int().positive().optional(),
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

function isServiceRoleCaller(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice('Bearer '.length).trim()
  return token.length > 0 && token === getServiceRoleKey()
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (!isServiceRoleCaller(req)) {
    return jsonResponse({ error: 'This refund action requires a trusted service request.' }, 401, cors)
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST to run this refund action.' }, 405, cors)
  }

  try {
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

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const { orderId, reason, amount } = parsed.data
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, stage')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      log('error', FN, 'db.error', { order_id: orderId, error: orderError.message, surface: 'orders.refund_preflight' })
      return jsonResponse({ error: 'Could not check this order before refund.' }, 500, cors)
    }

    const { data: attempts, error: attemptsError } = await supabase
      .from('order_payments')
      .select('id, status, amount, refunded_amount, provider_payment_id')
      .eq('order_id', orderId)
      .in('phase', ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT'])

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
    }>
    const refundableTotal = paymentRows.reduce((sum, attempt) => {
      if (attempt.status !== 'SUCCEEDED' && attempt.status !== 'PARTIAL_REFUND') return sum
      const charged = typeof attempt.amount === 'number' ? attempt.amount : 0
      const refunded = typeof attempt.refunded_amount === 'number' ? attempt.refunded_amount : 0
      return sum + Math.max(charged - refunded, 0)
    }, 0)
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
        condition: refundableTotal > 0,
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

    const result = typeof amount === 'number'
      ? await partiallyRefundOrderPayments(supabase, {
          orderId,
          amount,
          reason: reason ?? null,
          actorRole: 'OPS',
          allowedPhases: ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT'],
        })
      : await refundSettledOrderPayments(supabase, {
          orderId,
          reason: reason ?? null,
          actorRole: 'OPS',
          allowedPhases: ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT'],
        })

    return new Response(JSON.stringify({
      ok: true,
      orderId,
      refundMode: typeof amount === 'number' ? 'PARTIAL' : 'FULL',
      requestedAmount: amount ?? null,
      refundedAttempts: result.refundedAttempts,
      alreadyRefundedAttemptIds: result.alreadyRefundedAttemptIds,
      totalRefundedAmount: 'totalRefundedAmount' in result ? result.totalRefundedAmount : result.refundedAttempts.reduce((sum, attempt) => sum + attempt.amount, 0),
      remainingRefundableAmount: 'remainingRefundableAmount' in result ? result.remainingRefundableAmount : 0,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refund failed'
    log('error', FN, 'refund.failed', { error: message })
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
