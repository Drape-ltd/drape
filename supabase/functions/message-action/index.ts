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
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { parseBody, z, uuid } from '../_shared/validate.ts'
import { sendOrderEventEmail } from '../_shared/order-email.ts'

const FN = 'message-action'

const THREATENING_LANGUAGE_PATTERNS = [
  /\b(i('ll| will|'m going to| am going to)) (kill|hurt|harm|beat|attack|destroy|ruin) (you|u|your|ur)\b/i,
  /\b(you('re| are) (dead|finished|done)|watch your back|i know where you live)\b/i,
]

const UNSEND_WINDOW_MS = 15 * 60 * 1000
const messageId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/u, { message: "Must be a valid message id" })
const messageMediaReference = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => isValidMessageMediaReference(value), {
    message: "Must be a valid message media reference",
  })

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send-message'),
    orderId: uuid,
    type: z.enum(['TEXT', 'PHOTO', 'VOICE']),
    body: z.string().trim().max(2000).optional(),
    photoUrl: messageMediaReference.optional(),
    voiceUrl: messageMediaReference.optional(),
    voiceDuration: z.number().int().min(0).max(3600).optional(),
    replyToId: messageId.optional(),
  }),
  z.object({
    action: z.literal('unsend'),
    messageId,
  }),
  z.object({
    action: z.literal('edit'),
    messageId,
    body: z.string().trim().min(1).max(2000),
  }),
])

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

function isHttpMessageMediaUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")
  } catch {
    return false
  }
}

function normalizeMessageMediaPath(value: string) {
  let path = value.trim()
  if (path.startsWith("message-media/")) path = path.slice("message-media/".length)
  while (path.startsWith("/")) path = path.slice(1)
  return path
}

function isValidMessageMediaReference(value: string) {
  const trimmed = value.trim()
  if (isHttpMessageMediaUrl(trimmed)) return true

  const path = normalizeMessageMediaPath(trimmed)
  const lowerPath = path.toLowerCase()
  const backslash = String.fromCharCode(92)
  if (!path.startsWith("messages/")) return false
  if (path.includes("..") || path.includes(backslash) || Array.from(path).some((char) => char.charCodeAt(0) < 32)) return false

  return [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".mp4", ".mov", ".m4v", ".webm", ".m4a", ".mp3", ".wav", ".aac", ".ogg"].some((ext) => lowerPath.endsWith(ext))
}

function mediaReviewUrls(value: string) {
  const trimmed = value.trim()
  return isHttpMessageMediaUrl(trimmed) ? [trimmed] : []
}

function runBackgroundTask(task: Promise<unknown>, event: string) {
  const guarded = task.catch((error) => {
    log('warn', FN, event, { error: error instanceof Error ? error.message : String(error) })
  })
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(guarded)
  else void guarded
}

function buildMessagePreview(type: 'TEXT' | 'PHOTO' | 'VOICE', text: string) {
  if (type === 'PHOTO') return 'Photo'
  if (type === 'VOICE') return 'Voice note'

  const preview = text.trim().slice(0, 60)
  return text.trim().length > 60 ? `${preview}...` : preview || 'Sent you a message.'
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

async function handleUnsend(
  supabase: any,
  callerId: string,
  messageId: string,
  cors: HeadersInit,
) {
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('id, sender_id, body, type, order_id, created_at, is_deleted')
    .eq('id', messageId)
    .maybeSingle()

  if (msgError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this message right now.')
  if (!msg) return jsonError(cors, 404, 'MESSAGE_NOT_FOUND', 'Message not found.')

  const msgRow = msg as { id: string; sender_id: string; body: string | null; type: string; order_id: string; created_at: string; is_deleted: boolean }

  if (msgRow.sender_id !== callerId) {
    return jsonError(cors, 403, 'FORBIDDEN', 'You can only unsend your own messages.')
  }
  if (msgRow.is_deleted) {
    return jsonError(cors, 409, 'ALREADY_UNSENT', 'This message was already unsent.')
  }

  const sentAt = new Date(msgRow.created_at).getTime()
  if (isNaN(sentAt) || Date.now() - sentAt > UNSEND_WINDOW_MS) {
    return jsonError(cors, 409, 'UNSEND_WINDOW_EXPIRED', 'Messages can only be unsent within 15 minutes of sending.')
  }

  await supabase.from('message_audit_log').insert({
    message_id: msgRow.id,
    original_body: msgRow.body,
    action: 'unsend',
    actor_id: callerId,
  })

  const { error: updateError } = await supabase
    .from('messages')
    .update({ is_deleted: true, body: null })
    .eq('id', msgRow.id)

  if (updateError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not unsend this message right now.')

  await audit(supabase, {
    event: 'message.unsent',
    actor_id: callerId,
    actor_role: 'UNKNOWN',
    order_id: msgRow.order_id,
    payload: { function: FN, message_id: msgRow.id },
  })

  return jsonResponse({ ok: true }, 200, cors)
}

async function handleEdit(
  supabase: any,
  callerId: string,
  messageId: string,
  newBody: string,
  cors: HeadersInit,
) {
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('id, sender_id, body, type, order_id, is_deleted')
    .eq('id', messageId)
    .maybeSingle()

  if (msgError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this message right now.')
  if (!msg) return jsonError(cors, 404, 'MESSAGE_NOT_FOUND', 'Message not found.')

  const msgRow = msg as { id: string; sender_id: string; body: string | null; type: string; order_id: string; is_deleted: boolean }

  if (msgRow.sender_id !== callerId) {
    return jsonError(cors, 403, 'FORBIDDEN', 'You can only edit your own messages.')
  }
  if (msgRow.is_deleted) {
    return jsonError(cors, 409, 'MESSAGE_DELETED', 'Deleted messages cannot be edited.')
  }
  if (msgRow.type !== 'TEXT') {
    return jsonError(cors, 409, 'WRONG_TYPE', 'Only text messages can be edited.')
  }

  if (hasBlockedContact(newBody)) {
    return jsonError(cors, 400, 'BLOCKED_CONTACT', "Contact details can't be shared in messages. Keep everything on Drapeon so your order and payment stay protected.")
  }
  if (hasThreateningLanguage(newBody)) {
    return jsonError(cors, 400, 'THREATENING_LANGUAGE', "That message can't be sent. Keep communication respectful — our team reviews flagged messages.")
  }

  await supabase.from('message_audit_log').insert({
    message_id: msgRow.id,
    original_body: msgRow.body,
    action: 'edit',
    actor_id: callerId,
  })

  const { error: updateError } = await supabase
    .from('messages')
    .update({ body: newBody, edited_at: new Date().toISOString() })
    .eq('id', msgRow.id)

  if (updateError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not edit this message right now.')

  await audit(supabase, {
    event: 'message.edited',
    actor_id: callerId,
    actor_role: 'UNKNOWN',
    order_id: msgRow.order_id,
    payload: { function: FN, message_id: msgRow.id },
  })

  return jsonResponse({ ok: true }, 200, cors)
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
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    // Unsend and edit bypass order-level checks — they only need message ownership
    if (body.action === 'unsend') {
      const clientIp = getClientIp(req)
      const limit = await rateLimit(supabase, caller.id, `${FN}:unsend`, 20, 60_000, { ip: clientIp, userId: caller.id })
      if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)
      return handleUnsend(supabase, caller.id, body.messageId, cors)
    }

    if (body.action === 'edit') {
      const clientIp = getClientIp(req)
      const limit = await rateLimit(supabase, caller.id, `${FN}:edit`, 20, 60_000, { ip: clientIp, userId: caller.id })
      if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)
      return handleEdit(supabase, caller.id, body.messageId, body.body, cors)
    }

    // send-message
    if (body.type === 'TEXT' && !body.body?.trim()) {
      return jsonError(cors, 400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.')
    }
    if (body.type === 'PHOTO' && !body.photoUrl) {
      return jsonError(cors, 400, 'PHOTO_URL_REQUIRED', 'Photo URL is required.')
    }
    if (body.type === 'VOICE' && !body.voiceUrl) {
      return jsonError(cors, 400, 'VOICE_URL_REQUIRED', 'Voice URL is required.')
    }

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
      .select('id, reference, customer_id, tailor_id, stage, order_kind, garment_type, item_title, item_size, delivery_method, quoted_amount, quoted_currency, currency')
      .eq('id', body.orderId)
      .maybeSingle()

    if (orderError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not check this conversation right now.')

    const orderRow = order as { id?: string; reference?: string | null; customer_id?: string | null; tailor_id?: string | null; stage?: string | null; order_kind?: string | null; garment_type?: string | null; item_title?: string | null; item_size?: string | null; delivery_method?: string | null; quoted_amount?: number | null; quoted_currency?: string | null; currency?: string | null } | null
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
        message: 'This order thread is closed. Contact Drapeon support if you still need help.',
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
        "Contact details can't be shared in messages. Keep everything on Drapeon so your order and payment stay protected.",
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

    // Validate reply target is in the same order thread
    if (body.replyToId) {
      const { data: replyTarget } = await supabase
        .from('messages')
        .select('id')
        .eq('id', body.replyToId)
        .eq('order_id', body.orderId)
        .maybeSingle()

      if (!replyTarget) {
        return jsonError(cors, 404, 'REPLY_TARGET_NOT_FOUND', 'The message you are replying to was not found in this thread.')
      }
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
    if (body.type === 'VOICE') {
      payload.voice_url = body.voiceUrl!
      if (body.voiceDuration != null) payload.body = String(body.voiceDuration)
    }
    if (body.replyToId) payload.reply_to_id = body.replyToId

    const { data: insertedMessage, error } = await supabase
      .from('messages')
      .insert(payload)
      .select('id')
      .single()
    if (error) {
      log('error', FN, 'message.insert_failed', { actor_id: caller.id, error: error.message })
      return jsonError(cors, 500, 'MESSAGE_INSERT_FAILED', 'Could not send this message right now.')
    }

    const insertedMessageId =
      typeof insertedMessage?.id === 'string' ? insertedMessage.id : crypto.randomUUID()
    const recipientId = actorRole === 'CUSTOMER' ? orderRow.tailor_id : orderRow.customer_id
    if (recipientId && recipientId !== caller.id) {
      const notification = {
        title: senderName,
        body: buildMessagePreview(body.type, messageText),
        preferenceKey: 'messages' as const,
        channelId: 'default',
        sound: 'default',
        data: {
          orderId: body.orderId,
          target: 'messages',
          destination: 'messages',
          messageId: insertedMessageId,
        },
      }
      runBackgroundTask(enqueuePushJob(supabase, {
        userId: recipientId,
        source: FN,
        orderId: body.orderId,
        idempotencyKey: `message-created:${insertedMessageId}`,
        priority: 20,
        notification,
      }), 'notification.enqueue_failed')

      const recipientAudience = actorRole === 'CUSTOMER' ? 'TAILOR' as const : 'CUSTOMER' as const
      const unreadReminderAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      runBackgroundTask(
        enqueueOrderEventEmailJob(supabase, {
          order: {
            id: orderRow.id,
            reference: orderRow.reference ?? null,
            order_kind: orderRow.order_kind ?? 'CUSTOM',
            customer_id: orderRow.customer_id ?? null,
            tailor_id: orderRow.tailor_id ?? null,
            garment_type: orderRow.garment_type ?? null,
            item_title: orderRow.item_title ?? null,
            item_size: orderRow.item_size ?? null,
            delivery_method: orderRow.delivery_method ?? null,
            quoted_amount: orderRow.quoted_amount ?? null,
            quoted_currency: orderRow.quoted_currency ?? null,
            currency: orderRow.currency ?? orderRow.quoted_currency ?? null,
          },
          recipientUserId: recipientId,
          audience: recipientAudience,
          subject: `Unread message about order ${orderRow.reference ?? ''}`.trim(),
          headline: 'You still have an unread order message',
          body: `${senderName} sent a message about this order. Open the protected thread to review it and respond.`,
          ctaLabel: 'Open message',
          action: 'messages',
          source: FN,
          idempotencyKey: `message-unread-reminder:${insertedMessageId}`,
          runAt: unreadReminderAt,
          onlyIfMessageUnreadId: insertedMessageId,
          priority: 60,
        }),
        'unread_message_reminder.enqueue_failed',
      )

      const shouldEmailTailorBeforeQuote =
        actorRole === 'CUSTOMER' &&
        recipientId === orderRow.tailor_id &&
        ['PENDING_QUOTE', 'CONSULTATION'].includes(orderRow.stage ?? '')

      if (shouldEmailTailorBeforeQuote && orderRow.id && orderRow.tailor_id) {
        const messageKind = body.type === 'VOICE' ? 'voice note' : body.type === 'PHOTO' ? 'media update' : 'message'
        runBackgroundTask(
          sendOrderEventEmail(supabase, {
            order: {
            id: orderRow.id,
            reference: orderRow.reference ?? null,
            order_kind: orderRow.order_kind ?? 'CUSTOM',
            customer_id: orderRow.customer_id ?? null,
            tailor_id: orderRow.tailor_id ?? null,
            garment_type: orderRow.garment_type ?? null,
            item_title: orderRow.item_title ?? null,
            item_size: orderRow.item_size ?? null,
            delivery_method: orderRow.delivery_method ?? null,
            quoted_amount: orderRow.quoted_amount ?? null,
            quoted_currency: orderRow.quoted_currency ?? null,
            currency: orderRow.currency ?? orderRow.quoted_currency ?? null,
          },
          recipientUserId: orderRow.tailor_id,
          audience: 'TAILOR',
          subject: 'New customer message before quote',
          headline: 'Customer added details before your quote',
          body: senderName + ' sent a ' + messageKind + ' while this brief is still waiting for your quote.',
          ctaLabel: 'Review order',
        }),
          'prequote_message.email_failed',
        )
      }
    }

    if (body.type === 'PHOTO' || body.type === 'VOICE') {
      const reviewUrls = body.type === 'PHOTO' ? mediaReviewUrls(body.photoUrl!) : mediaReviewUrls(body.voiceUrl!)
      if (reviewUrls.length > 0) {
        await queueMediaSafetyReview(supabase, {
          fn: FN,
          actorId: caller.id,
          actorRole,
          surface: body.type === 'PHOTO' ? 'messages.photo' : 'messages.voice',
          publicUrls: reviewUrls,
          purpose: 'MESSAGE_MEDIA',
          orderId: body.orderId,
          relatedEntityType: 'message',
          metadata: { messageType: body.type },
        })
      }
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
