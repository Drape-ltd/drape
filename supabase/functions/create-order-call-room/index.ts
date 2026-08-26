import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { enqueueOrderEventEmailJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { parseOrderSupportMeta } from '../_shared/order-support.ts'
import { formatExplicitZonedDateTime } from '../_shared/date-time.ts'
import {
  createDailyMeetingToken,
  createDailyRoomWithObservability,
  recordDailyCallRoom,
} from '../_shared/daily-observability.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const FN = 'create-order-call-room'
const ROOM_TTL_SECONDS = 48 * 60 * 60
const ORDER_CALL_JOIN_EARLY_MS = 5 * 60 * 1000
const ORDER_CALL_JOIN_LATE_MS = 30 * 60 * 1000
const ORDER_CALL_STAGES = [
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
] as const

const BodySchema = z.object({
  orderId: uuid,
  callType: z.enum(['video', 'audio']).default('video'),
  notifyCounterpart: z.boolean().default(true),
})

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(corsHeaders: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, corsHeaders)
}

function extractRoomCreatedAt(url: string) {
  try {
    const pathname = new URL(url).pathname
    const roomName = pathname.split('/').filter(Boolean).at(-1) ?? ''
    const timestamp = Number(roomName.split('-').at(-1))
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null
    return timestamp
  } catch {
    return null
  }
}

function isFreshRoomUrl(url: string) {
  const createdAt = extractRoomCreatedAt(url)
  if (createdAt == null) return false
  return Date.now() - createdAt < ROOM_TTL_SECONDS * 1000
}

function isOrderCallStage(stage: string | null | undefined) {
  return typeof stage === 'string' && ORDER_CALL_STAGES.includes(stage as typeof ORDER_CALL_STAGES[number])
}

function scheduledOrderCallGate(specialNote: string | null | undefined) {
  const supportMeta = parseOrderSupportMeta(specialNote ?? null)
  const orderCall = supportMeta.orderCall ?? null
  if (!orderCall || orderCall.status !== 'SCHEDULED' || !orderCall.scheduledStartAt) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_NOT_SCHEDULED',
      message: 'Schedule this order call from Messages first so both sides know when to join.',
      supportMeta,
      orderCall,
    }
  }

  const startsAtMs = new Date(orderCall.scheduledStartAt).getTime()
  if (!Number.isFinite(startsAtMs)) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_INVALID_TIME',
      message: 'This order call time looks invalid. Schedule a new call from Messages.',
      supportMeta,
      orderCall,
    }
  }

  const nowMs = Date.now()
  if (nowMs < startsAtMs - ORDER_CALL_JOIN_EARLY_MS) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_TOO_EARLY',
      message: `This order call is scheduled for ${formatExplicitZonedDateTime(orderCall.scheduledStartAt, orderCall.timezone)}. Join from Messages around the scheduled time.`,
      supportMeta,
      orderCall,
    }
  }

  if (nowMs > startsAtMs + ORDER_CALL_JOIN_LATE_MS) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_EXPIRED',
      message: 'This order call window has passed. Schedule a new call from Messages.',
      supportMeta,
      orderCall,
    }
  }

  return { ok: true as const, supportMeta, orderCall }
}

function callStartedStageNote(audioOnly: boolean) {
  return audioOnly
    ? 'A Drapeon audio call is open for this order. Open now to join.'
    : 'A Drapeon call is open for this order. Open now to join.'
}

function counterpartPush(actorRole: 'CUSTOMER' | 'TAILOR', audioOnly: boolean) {
  if (actorRole === 'TAILOR') {
    return {
      title: audioOnly ? 'Tailor audio call ready' : 'Tailor call ready',
      body: audioOnly
        ? 'Your tailor is trying to reach you on a Drapeon audio call. Tap to join now.'
        : 'Your tailor is trying to reach you on a Drapeon call. Tap to join now.',
    }
  }

  return {
    title: audioOnly ? 'Customer audio call ready' : 'Customer call ready',
    body: audioOnly
      ? 'Your customer is trying to reach you on a Drapeon audio call. Tap to join now.'
      : 'Your customer is trying to reach you on a Drapeon call. Tap to join now.',
  }
}

function counterpartAudience(actorRole: 'CUSTOMER' | 'TAILOR') {
  return actorRole === 'TAILOR' ? 'CUSTOMER' as const : 'TAILOR' as const
}

function orderCallSmsBody(reference: string | null, actorRole: 'CUSTOMER' | 'TAILOR', audioOnly: boolean) {
  const actor = actorRole === 'TAILOR' ? 'tailor' : 'customer'
  const kind = audioOnly ? 'audio call' : 'call'
  return `Drapeon: your ${actor} started a Drapeon ${kind} for order ${reference ?? 'your order'}. Open Drapeon to join.`;
}

function fallbackMessage(audioOnly: boolean) {
  return audioOnly
    ? 'Drapeon audio calling is unavailable right now. Continue inside Messages so the order record stays complete.'
    : 'Drapeon video calling is unavailable right now. Continue inside Messages so the order record stays complete.'
}

function fallbackStageNote(audioOnly: boolean) {
  return audioOnly
    ? 'Drapeon audio calling is unavailable. Continue this order conversation in Messages; Drapeon has logged the fallback.'
    : 'Drapeon video calling is unavailable. Continue this order conversation in Messages; Drapeon has logged the fallback.'
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(corsHeaders, 401, 'UNAUTHORIZED', 'You need to sign in again before starting a Drapeon call.')

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonError(corsHeaders, 400, 'VALIDATION_FAILED', parsed.error)

    const { orderId, notifyCounterpart } = parsed.data
    const callType = parsed.data.callType ?? 'video'
    const audioOnly = callType === 'audio'

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 12)
    if (!allowed) {
      return rateLimitExceededResponse(corsHeaders)
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, reference, order_kind, stage, video_call_url, tailor_id, customer_id, special_note')
      .eq('id', orderId)
      .single()

    if (!order) return jsonError(corsHeaders, 404, 'ORDER_NOT_FOUND', 'That order could not be found anymore.')

    const isParticipant = order.tailor_id?.toString() === caller.id || order.customer_id?.toString() === caller.id
    if (!isParticipant) {
      return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only people on this order can start a Drapeon call.')
    }

    if (order.stage === 'CONSULTATION') {
      return jsonError(corsHeaders, 409, 'CONSULTATION_CALL_REQUIRED', 'Use the scheduled consultation on this order. Regular order calls are unavailable until the consultation is complete.')
    }
    if (order.stage === 'PENDING_QUOTE') {
      return jsonError(corsHeaders, 409, 'QUOTE_REQUIRED_FOR_ORDER_CALL', 'Keep using Messages while the tailor reviews the brief. Regular scheduled calls unlock after the quote is sent.')
    }

    if (!isOrderCallStage(order.stage)) {
      return jsonError(corsHeaders, 409, 'ORDER_CALL_NOT_READY', 'Regular scheduled calls are unavailable for this order right now. Keep the conversation in Messages.')
    }

    const orderCallGate = scheduledOrderCallGate(order.special_note)
    if (!orderCallGate.ok) {
      return jsonError(corsHeaders, 409, orderCallGate.code, orderCallGate.message)
    }

    const actorRole: 'CUSTOMER' | 'TAILOR' =
      order.tailor_id?.toString() === caller.id ? 'TAILOR' : 'CUSTOMER'
    const callerName =
      (caller as { user_metadata?: { display_name?: unknown } }).user_metadata?.display_name
    const counterpartId = actorRole === 'TAILOR'
      ? order.customer_id?.toString() ?? null
      : order.tailor_id?.toString() ?? null

    const returnMessageFallback = (reason: 'DAILY_NOT_CONFIGURED' | 'DAILY_UNAVAILABLE') => {
      EdgeRuntime.waitUntil(
        (async () => {
          const { error: stageUpdateError } = await supabase.from('order_stage_updates').insert({
            order_id: orderId,
            stage: order.stage,
            note: fallbackStageNote(audioOnly),
          })

          if (stageUpdateError) {
            log('warn', FN, 'fallback_stage_update_failed', {
              actor_id: caller.id,
              order_id: orderId,
              error: stageUpdateError.message,
            })
          }

          await audit(supabase, {
            event: 'order.call_fallback_started',
            actor_id: caller.id,
            actor_role: actorRole,
            order_id: orderId,
            payload: {
              function: FN,
              call_type: callType,
              stage: order.stage,
              reason,
              fallback: 'MESSAGES',
            },
          })

          if (counterpartId) {
            await Promise.allSettled([
              sendPushToUser(supabase, counterpartId, {
                title: 'Drapeon call fallback active',
                body: 'Calling is unavailable right now. Continue inside the order thread so Drapeon keeps the record.',
                preferenceKey: 'messages',
                data: { orderId },
              }),
              enqueueSmsJob(supabase, {
                userId: counterpartId,
                audience: counterpartAudience(actorRole),
                source: FN,
                orderId,
                event: 'order_call_fallback',
                idempotencyKey: `order-call-fallback:${orderId}:${reason}:${counterpartId}`,
                priority: 12,
                body: `Drapeon: calling is unavailable for order ${order.reference ?? orderId}. Continue in the order thread so the record stays complete.`,
              }),
              enqueueOrderEventEmailJob(supabase, {
                order,
                recipientUserId: counterpartId,
                audience: counterpartAudience(actorRole),
                source: FN,
                subject: 'Drapeon calling is temporarily unavailable',
                headline: 'Continue in Messages',
                body: `Calling is unavailable for order ${order.reference ?? orderId}. Continue in the protected order thread while Drapeon keeps the order record.`,
                idempotencyKey: `order-call-fallback-email:${orderId}:${reason}:${counterpartId}`,
                ctaLabel: 'Open Messages',
                priority: 12,
              }),
            ])
          }
        })(),
      )

      return jsonResponse(
        {
          url: null,
          existing: false,
          fallback: 'MESSAGES',
          code: reason,
          message: fallbackMessage(audioOnly),
        },
        200,
        corsHeaders,
      )
    }

    let roomUrl = order.video_call_url
    let existing = !!roomUrl && isFreshRoomUrl(roomUrl)

    if (!existing) {
      const expiryTime = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS
      const roomName = `drapeon-order-${String(order.reference ?? order.id).toLowerCase()}-${Date.now()}`
      const dailyRoom = await createDailyRoomWithObservability({
        supabase,
        functionName: FN,
        orderId,
        actorId: caller.id,
        actorRole,
        stage: order.stage,
        callKind: 'READY_MADE',
        roomName,
        expiresAt: expiryTime,
        audioOnly,
      })
      if (!dailyRoom.ok) return returnMessageFallback(dailyRoom.reason)
      roomUrl = dailyRoom.url

      const { error: updateError } = await supabase
        .from('orders')
        .update({ video_call_url: roomUrl })
        .eq('id', orderId)

      if (updateError) {
        return jsonError(corsHeaders, 500, 'ROOM_PERSIST_FAILED', 'The call room was created but could not be attached to this order cleanly.')
      }
    }

    const roomCreatedAt = extractRoomCreatedAt(roomUrl) ?? Date.now()
    await recordDailyCallRoom({
      supabase,
      orderId,
      roomUrl,
      callKind: 'ORDER',
      callType,
      scheduledStartAt: orderCallGate.orderCall.scheduledStartAt,
      expiresAt: Math.floor(roomCreatedAt / 1000) + ROOM_TTL_SECONDS,
      createdBy: caller.id,
    })

    const { error: stageUpdateError } = await supabase.from('order_stage_updates').insert({
      order_id: orderId,
      stage: order.stage,
      note: callStartedStageNote(audioOnly),
    })

    if (stageUpdateError) {
      log('warn', FN, 'order_stage_updates.insert_failed', {
        actor_id: caller.id,
        order_id: orderId,
        error: stageUpdateError.message,
      })
    }

    await audit(supabase, {
      event: existing ? 'order.call_join_requested' : 'order.call_room_created',
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: orderId,
      payload: {
        function: FN,
        call_type: callType,
        stage: order.stage,
        existing,
      },
    })

    if (counterpartId && notifyCounterpart) {
      const push = counterpartPush(actorRole, audioOnly)
      EdgeRuntime.waitUntil(
        Promise.allSettled([
          sendPushToUser(supabase, counterpartId, {
            title: push.title,
            body: push.body,
            preferenceKey: 'messages',
            channelId: 'calls',
            sound: 'default',
            interruptionLevel: 'time-sensitive',
            data: {
              orderId,
              target: 'call-join',
              callKind: 'ready-made',
              callType,
            },
          }),
          enqueueSmsJob(supabase, {
            userId: counterpartId,
            audience: counterpartAudience(actorRole),
            source: FN,
            orderId,
            event: 'order_call_started',
            idempotencyKey: `order-call-started:${orderId}:${counterpartId}:${callType}`,
            priority: 10,
            body: orderCallSmsBody(order.reference ?? null, actorRole, audioOnly),
          }),
          enqueueOrderEventEmailJob(supabase, {
            order,
            recipientUserId: counterpartId,
            audience: counterpartAudience(actorRole),
            source: FN,
            subject: audioOnly ? 'A Drapeon audio call is ready' : 'A Drapeon call is ready',
            headline: 'Join the order call now',
            body: `Your ${actorRole === 'TAILOR' ? 'tailor' : 'customer'} opened the call for order ${order.reference ?? orderId}. Open Drapeon to join.`,
            idempotencyKey: `order-call-started-email:${orderId}:${counterpartId}:${callType}`,
            ctaLabel: 'Open Drapeon',
            priority: 10,
          }),
        ]),
      )
    }

    const token = await createDailyMeetingToken({
      roomUrl,
      userId: caller.id,
      userName: typeof callerName === 'string' && callerName.trim()
        ? callerName.trim()
        : actorRole === 'TAILOR' ? 'Tailor' : 'Customer',
      audioOnly,
    })
    if (!token) {
      return jsonError(corsHeaders, 503, 'DAILY_TOKEN_UNAVAILABLE', 'The protected call pass could not be created. Try again shortly.')
    }
    return jsonResponse({ url: roomUrl, token, existing }, 200, corsHeaders)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(corsHeaders, 500, 'INTERNAL_ERROR', 'Could not start the Drapeon call right now.')
  }
})
