import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import {
  buildConversationBlockedMessage,
  readConversationAccessState,
} from '../_shared/conversation-access.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'conversation-access'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-status'),
    orderId: uuid,
  }),
  z.object({
    action: z.literal('block'),
    orderId: uuid,
    reason: z.enum(['ABUSIVE_LANGUAGE', 'OFF_PLATFORM_PRESSURE', 'UNSAFE_BEHAVIOR']),
    surface: z.enum(['messages']).default('messages'),
  }),
])

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
      return jsonResponse({ code: 'UNAUTHORIZED', error: 'Please sign in again before opening this conversation.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ code: 'VALIDATION_ERROR', error: parsed.error }, 400, cors)
    }

    const body = parsed.data
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('id, stage, customer_id, tailor_id')
      .eq('id', body.orderId)
      .maybeSingle()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: orderError.message })
      return jsonResponse({ code: 'DB_ERROR', error: 'Could not load this conversation right now.' }, 500, cors)
    }

    const order = orderData as OrderRow | null
    if (!order) {
      return jsonResponse({ code: 'ORDER_NOT_FOUND', error: 'This order conversation is no longer available.' }, 404, cors)
    }

    const actorRole =
      order.customer_id === caller.id ? 'CUSTOMER'
      : order.tailor_id === caller.id ? 'TAILOR'
      : null

    if (!actorRole) {
      log('warn', FN, 'auth.forbidden', { actor_id: caller.id, order_id: body.orderId })
      await audit(supabase, {
        event: 'auth.forbidden',
        actor_id: caller.id,
        actor_role: 'UNKNOWN',
        order_id: body.orderId,
        severity: 'warn',
        payload: { function: FN },
      })
      return jsonResponse({ code: 'FORBIDDEN', error: 'You do not have access to this conversation.' }, 403, cors)
    }

    if (body.action === 'get-status') {
      const state = await readConversationAccessState(supabase, order.id)
      return jsonResponse({
        blocked: state.blocked,
        blockedAt: state.blockedAt,
        blockedByRole: state.blockedByRole,
        reason: state.reason,
        userMessage: state.blocked ? buildConversationBlockedMessage(state) : null,
      }, 200, cors)
    }

    const allowed = await checkRateLimit(supabase, `${FN}:block:${caller.id}`, 3600, 6)
    if (!allowed) {
      log('warn', FN, 'rate_limit.exceeded', { actor_id: caller.id })
      return rateLimitExceededResponse(cors)
    }

    const state = await readConversationAccessState(supabase, order.id)
    if (!state.blocked) {
      await audit(supabase, {
        event: 'conversation.blocked',
        actor_id: caller.id,
        actor_role: actorRole,
        order_id: order.id,
        severity: 'warn',
        payload: {
          function: FN,
          reason: body.reason,
          surface: body.surface,
          order_stage: order.stage,
          blocked_party_role: actorRole === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER',
        },
      })
    }

    const nextState = state.blocked
      ? state
      : {
          blocked: true,
          blockedAt: new Date().toISOString(),
          blockedByRole: actorRole,
          reason: body.reason,
        }

    log('warn', FN, 'conversation.blocked', {
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: order.id,
      reason: body.reason,
      already_blocked: state.blocked,
    })

    return jsonResponse({
      ok: true,
      blocked: true,
      blockedAt: nextState.blockedAt,
      blockedByRole: nextState.blockedByRole,
      reason: nextState.reason,
      userMessage: buildConversationBlockedMessage(nextState),
    }, 200, cors)
  } catch (error) {
    log('error', FN, 'unexpected', {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse({ code: 'INTERNAL_ERROR', error: 'Could not update this conversation right now.' }, 500, cors)
  }
})
