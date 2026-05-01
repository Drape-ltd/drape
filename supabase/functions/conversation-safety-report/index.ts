import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'conversation-safety-report'

const BodySchema = z.object({
  orderId: uuid,
  category: z.enum(['ABUSIVE_LANGUAGE', 'OFF_PLATFORM_PRESSURE', 'UNSAFE_BEHAVIOR']),
  surface: z.enum(['messages']),
})

type OrderRow = {
  id: string
  stage: string
  customer_id: string | null
  tailor_id: string | null
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ code: 'UNAUTHORIZED', error: 'Please sign in again before reporting this conversation.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json())
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ code: 'VALIDATION_ERROR', error: parsed.error }, 400, cors)
    }

    const { orderId, category, surface } = parsed.data
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `conversation-safety-report:${caller.id}`, 3600, 10)
    if (!allowed) {
      log('warn', FN, 'rate_limit.exceeded', { actor_id: caller.id })
      return jsonResponse({ code: 'RATE_LIMITED', error: 'You are sending reports too quickly. Please wait a moment and try again.' }, 429, cors)
    }

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('id, stage, customer_id, tailor_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, error: orderError.message })
      return jsonResponse({ code: 'DB_ERROR', error: 'Could not review this order right now.' }, 500, cors)
    }

    const order = orderData as OrderRow | null
    if (!order) {
      return jsonResponse({ code: 'ORDER_NOT_FOUND', error: 'This order is no longer available.' }, 404, cors)
    }

    const actorRole =
      order.customer_id === caller.id ? 'CUSTOMER'
      : order.tailor_id === caller.id ? 'TAILOR'
      : null

    if (!actorRole) {
      log('warn', FN, 'auth.forbidden', { actor_id: caller.id, order_id: orderId })
      await audit(supabase, {
        event: 'auth.forbidden',
        actor_id: caller.id,
        actor_role: 'UNKNOWN',
        order_id: orderId,
        severity: 'warn',
        payload: { function: FN },
      })
      return jsonResponse({ code: 'FORBIDDEN', error: 'You do not have access to this conversation.' }, 403, cors)
    }

    await audit(supabase, {
      event: 'conversation.safety_reported',
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: order.id,
      severity: 'warn',
      payload: {
        function: FN,
        category,
        surface,
        order_stage: order.stage,
        reported_party_role: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
      },
    })

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'CONVERSATION_SAFETY',
      severity: 'HIGH',
      source: FN,
      actorId: caller.id,
      actorRole,
      orderId: order.id,
      userId: caller.id,
      stage: order.stage,
      title: 'Conversation safety report',
      description: `A ${actorRole.toLowerCase()} reported ${category.replace(/_/gu, ' ').toLowerCase()} inside the order conversation.`,
      recommendedAction: 'Review the message thread, decide whether the chat should stay paused, and log the trust decision.',
      dedupeKey: `conversation-safety:${order.id}`,
      metadata: {
        category,
        surface,
        order_stage: order.stage,
        reported_party_role: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
      },
    })

    log('warn', FN, 'conversation.safety_reported', {
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: order.id,
      category,
      surface,
    })

    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unexpected', {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse({ code: 'INTERNAL_ERROR', error: 'Could not send this report right now.' }, 500, cors)
  }
})
