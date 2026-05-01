import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { partiallyRefundOrderPayments, refundSettledOrderPayments } from '../_shared/payment-refunds.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'refund-order-payments'

const BodySchema = z.object({
  orderId: uuid,
  reason: z.string().trim().max(300).optional(),
  amount: z.number().int().positive().optional(),
})

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
    return new Response('Unauthorized', { status: 401, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  try {
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return new Response(parsed.error, { status: 400, headers: cors })
    }

    const { orderId, reason, amount } = parsed.data
    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())

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
