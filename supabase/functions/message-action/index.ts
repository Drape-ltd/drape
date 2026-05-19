import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { hasBlockedContact, logContactBypassAttempt } from '../_shared/contact-bypass.ts'
import {
  buildConversationBlockedMessage,
  readConversationAccessState,
} from '../_shared/conversation-access.ts'
import { getClientIp, rateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { parseBody, z, uuid } from '../_shared/validate.ts'

const FN = 'message-action'

const THREATENING_LANGUAGE_PATTERNS = [
  /\b(i('ll| will|'m going to| am going to)) (kill|hurt|harm|beat|attack|destroy|ruin) (you|u|your|ur)\b/i,
  /\b(you('re| are) (dead|finished|done)|watch your back|i know where you live)\b/i,
]

const BodySchema = z.object({
  action: z.literal('send-message'),
  orderId: uuid,
  type: z.enum(['TEXT', 'PHOTO', 'VOICE']),
  body: z.string().trim().max(2000).optional(),
  photoUrl: z.string().url().optional(),
  voiceUrl: z.string().url().optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, cors)
}

function hasThreateningLanguage(text: string) {
  return THREATENING_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text))
}

async function resolveSenderName(
  supabase: any,
  callerId: string,
  actorRole: 'CUSTOMER' | 'TAILOR',
) {
  if (actorRole === 'TAILOR') {
    const { data } = await supabase
      .from('tailor_profiles')
      .select('display_name')
      .eq('user_id', callerId)
      .maybeSingle()
    const tailorProfile = data as { display_name?: string | null } | null

    if (typeof tailorProfile?.display_name === 'string' && tailorProfile.display_name.trim().length > 0) {
      return tailorProfile.display_name.trim()
    }
  } else {
    const { data } = await supabase
      .from('customer_profiles')
      .select('display_name')
      .eq('user_id', callerId)
      .maybeSingle()
    const customerProfile = data as { display_name?: string | null } | null

    if (typeof customerProfile?.display_name === 'string' && customerProfile.display_name.trim().length > 0) {
      return customerProfile.display_name.trim()
    }
  }

  const { data } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', callerId)
    .maybeSingle()
  const userRow = data as { display_name?: string | null } | null

  if (typeof userRow?.display_name === 'string' && userRow.display_name.trim().length > 0) {
    return userRow.display_name.trim()
  }

  return actorRole === 'TAILOR' ? 'Tailor' : 'Customer'
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(cors, 401, 'UNAUTHORIZED', 'You need to sign in again before sending a message.')

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonError(cors, 400, 'VALIDATION_FAILED', parsed.error)

    const body = parsed.data
    if (body.type === 'TEXT' && !body.body?.trim()) {
      return jsonError(cors, 400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.')
    }
    if (body.type === 'PHOTO' && !body.photoUrl) {
      return jsonError(cors, 400, 'PHOTO_URL_REQUIRED', 'Photo URL is required.')
    }
    if (body.type === 'VOICE' && !body.voiceUrl) {
      return jsonError(cors, 400, 'VOICE_URL_REQUIRED', 'Voice URL is required.')
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const limit = await rateLimit(
      supabase,
      caller.id,
      FN,
      10,
      60_000,
      { ip: clientIp, userAgent: req.headers.get('user-agent'), userId: caller.id },
    )
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_id, tailor_id, stage')
      .eq('id', body.orderId)
      .maybeSingle()

    if (orderError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not check this conversation right now.')

    const orderRow = order as { id?: string; customer_id?: string | null; tailor_id?: string | null; stage?: string | null } | null
    const isCustomer = orderRow?.customer_id === caller.id
    const isTailor = orderRow?.tailor_id === caller.id
    const messagePreflight = runPreflight([
      {
        name: 'conversation_order_exists',
        condition: !!orderRow?.id,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'This order conversation could not be found anymore.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { orderId: body.orderId },
      },
      {
        name: 'sender_is_participant',
        condition: isCustomer || isTailor,
        errorCode: 'CONVERSATION_FORBIDDEN',
        message: 'This conversation is not available from your account.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { callerId: caller.id, customerId: orderRow?.customer_id ?? null, tailorId: orderRow?.tailor_id ?? null },
      },
      {
        name: 'conversation_open',
        condition: !['CANCELLED', 'COMPLETE'].includes(orderRow?.stage ?? ''),
        errorCode: 'CONVERSATION_CLOSED',
        message: 'This order thread is closed. Contact Drape support if you still need help.',
        field: 'stage',
        severity: 'BLOCKING',
        actual: { stage: orderRow?.stage ?? null },
      },
    ])

    if (!messagePreflight.passed) {
      await logPreflightFailure(supabase, messagePreflight, {
        operation: 'send_message',
        entityType: 'order',
        entityId: body.orderId,
        orderId: body.orderId,
        actorId: caller.id,
        actorRole: isTailor ? 'TAILOR' : 'CUSTOMER',
        userId: caller.id,
        source: FN,
        metadata: { messageType: body.type },
      })
      return preflightFailureResponse(messagePreflight, cors, messagePreflight.failures[0]?.errorCode === 'ORDER_NOT_FOUND' ? 404 : 409)
    }

    if (!orderRow?.id) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order conversation could not be found anymore.')
    if (!isCustomer && !isTailor) {
      return jsonError(cors, 403, 'FORBIDDEN', 'This conversation is not available from your account.')
    }

    const actorRole = isTailor ? 'TAILOR' : 'CUSTOMER'
    const messageText = body.type === 'TEXT' ? body.body?.trim() ?? '' : ''
    const conversationState = await readConversationAccessState(supabase, body.orderId)
    const senderName = await resolveSenderName(supabase, caller.id, actorRole)

    if (conversationState.blocked) {
      return jsonError(
        cors,
        409,
        'CONVERSATION_BLOCKED',
        buildConversationBlockedMessage(conversationState),
      )
    }

    if (messageText && hasBlockedContact(messageText)) {
      await logContactBypassAttempt({
        supabase,
        fn: FN,
        actorId: caller.id,
        actorRole,
        surface: 'messages.text',
        content: messageText,
        orderId: body.orderId,
        extra: { message_type: body.type },
      })

      return jsonError(
        cors,
        400,
        'BLOCKED_CONTACT',
        "Contact details can't be shared in messages. Keep everything on Drape so your order and payment stay protected.",
      )
    }

    if (messageText && hasThreateningLanguage(messageText)) {
      await audit(supabase, {
        event: 'message.blocked',
        actor_id: caller.id,
        actor_role: actorRole,
        order_id: body.orderId,
        severity: 'warn',
        payload: {
          function: FN,
          message_type: body.type,
          reason: 'THREATENING_LANGUAGE',
        },
      })

      log('warn', FN, 'message.blocked', {
        actor_id: caller.id,
        actor_role: actorRole,
        order_id: body.orderId,
        reason: 'THREATENING_LANGUAGE',
      })

      return jsonError(
        cors,
        400,
        'THREATENING_LANGUAGE',
        "That message can't be sent. Keep communication respectful — our team reviews flagged messages.",
      )
    }

    const payload: Record<string, unknown> = {
      order_id: body.orderId,
      sender_id: caller.id,
      sender_role: actorRole,
      sender_name: senderName,
      type: body.type,
    }
    if (body.type === 'TEXT') payload.body = body.body!.trim()
    if (body.type === 'PHOTO') payload.photo_url = body.photoUrl!
    if (body.type === 'VOICE') payload.voice_url = body.voiceUrl!

    const { error } = await supabase.from('messages').insert(payload)
    if (error) {
      log('error', FN, 'message.insert_failed', { actor_id: caller.id, error: error.message })
      return jsonError(cors, 500, 'MESSAGE_INSERT_FAILED', 'Could not send this message right now.')
    }

    await audit(supabase, {
      event: 'message.sent',
      actor_id: caller.id,
      actor_role: actorRole,
      payload: { function: FN, order_id: body.orderId, type: body.type },
    })

    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'INTERNAL_ERROR', 'Could not send this message right now.')
  }
})
