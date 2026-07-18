import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getDailyApiKey, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { parseOrderSupportMeta, serializeOrderSupportMeta } from '../_shared/order-support.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const FN = 'create-order-call-room'
const ROOM_TTL_SECONDS = 48 * 60 * 60
const READY_MADE_JOIN_EARLY_MS = 5 * 60 * 1000
const READY_MADE_JOIN_LATE_MS = 30 * 60 * 1000
const ORDER_CALL_STAGES = [
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

function isReadyMadeOrder(orderKind: string | null | undefined) {
  return orderKind === 'READY_MADE'
}

function formatScheduledStart(startAt: string, timezone: string | null | undefined) {
  try {
    return new Date(startAt).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || undefined,
    })
  } catch {
    return new Date(startAt).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }
}

function readyMadeCallGate(specialNote: string | null | undefined) {
  const supportMeta = parseOrderSupportMeta(specialNote ?? null)
  const orderCall = supportMeta.orderCall ?? null
  if (!orderCall || orderCall.status !== 'SCHEDULED' || !orderCall.scheduledStartAt) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_NOT_SCHEDULED',
      message: 'Schedule this ready-made order call from Messages first so both sides know when to join.',
      supportMeta,
      orderCall,
    }
  }

  const startsAtMs = new Date(orderCall.scheduledStartAt).getTime()
  if (!Number.isFinite(startsAtMs)) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_INVALID_TIME',
      message: 'This ready-made call time looks invalid. Schedule a new call from Messages.',
      supportMeta,
      orderCall,
    }
  }

  const nowMs = Date.now()
  if (nowMs < startsAtMs - READY_MADE_JOIN_EARLY_MS) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_TOO_EARLY',
      message: `This ready-made call is scheduled for ${formatScheduledStart(orderCall.scheduledStartAt, orderCall.timezone)}. Join from Messages around the scheduled time.`,
      supportMeta,
      orderCall,
    }
  }

  if (nowMs > startsAtMs + READY_MADE_JOIN_LATE_MS) {
    return {
      ok: false as const,
      code: 'ORDER_CALL_EXPIRED',
      message: 'This ready-made call window has passed. Schedule a new call from Messages.',
      supportMeta,
      orderCall,
    }
  }

  return { ok: true as const, supportMeta, orderCall }
}

function callStartedStageNote(audioOnly: boolean) {
  return audioOnly
    ? 'A Drape audio call is open for this order. Open now to join.'
    : 'A Drape call is open for this order. Open now to join.'
}

function counterpartPush(actorRole: 'CUSTOMER' | 'TAILOR', audioOnly: boolean) {
  if (actorRole === 'TAILOR') {
    return {
      title: audioOnly ? 'Tailor audio call ready' : 'Tailor call ready',
      body: audioOnly
        ? 'Your tailor is trying to reach you on a Drape audio call. Tap to join now.'
        : 'Your tailor is trying to reach you on a Drape call. Tap to join now.',
    }
  }

  return {
    title: audioOnly ? 'Customer audio call ready' : 'Customer call ready',
    body: audioOnly
      ? 'Your customer is trying to reach you on a Drape audio call. Tap to join now.'
      : 'Your customer is trying to reach you on a Drape call. Tap to join now.',
  }
}

function counterpartAudience(actorRole: 'CUSTOMER' | 'TAILOR') {
  return actorRole === 'TAILOR' ? 'CUSTOMER' as const : 'TAILOR' as const
}

function orderCallSmsBody(reference: string | null, actorRole: 'CUSTOMER' | 'TAILOR', audioOnly: boolean) {
  const actor = actorRole === 'TAILOR' ? 'tailor' : 'customer'
  const kind = audioOnly ? 'audio call' : 'call'
  return `Drape: your ${actor} started a Drape ${kind} for order ${reference ?? 'your order'}. Open Drape to join.`;
}

function fallbackMessage(audioOnly: boolean) {
  return audioOnly
    ? 'Drape audio calling is unavailable right now. Continue inside Messages so the order record stays complete.'
    : 'Drape video calling is unavailable right now. Continue inside Messages so the order record stays complete.'
}

function fallbackStageNote(audioOnly: boolean) {
  return audioOnly
    ? 'Drape audio calling is unavailable. Continue this order conversation in Messages; Drape has logged the fallback.'
    : 'Drape video calling is unavailable. Continue this order conversation in Messages; Drape has logged the fallback.'
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(corsHeaders, 401, 'UNAUTHORIZED', 'You need to sign in again before starting a Drape call.')

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
      return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only people on this order can start a Drape call.')
    }

    if (!isOrderCallStage(order.stage)) {
      return jsonError(corsHeaders, 409, 'ORDER_CALL_NOT_READY', 'Drape calls open after payment is confirmed and while the order is active.')
    }

    const readyMadeGate = isReadyMadeOrder(order.order_kind)
      ? readyMadeCallGate(order.special_note)
      : null
    if (readyMadeGate && !readyMadeGate.ok) {
      return jsonError(corsHeaders, 409, readyMadeGate.code, readyMadeGate.message)
    }

    const actorRole: 'CUSTOMER' | 'TAILOR' =
      order.tailor_id?.toString() === caller.id ? 'TAILOR' : 'CUSTOMER'
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
                title: 'Drape call fallback active',
                body: 'Calling is unavailable right now. Continue inside the order thread so Drape keeps the record.',
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
                body: `Drape: calling is unavailable for order ${order.reference ?? orderId}. Continue in the order thread so the record stays complete.`,
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
      let dailyApiKey = ''
      try {
        dailyApiKey = getDailyApiKey()
      } catch {
        return returnMessageFallback('DAILY_NOT_CONFIGURED')
      }

      const expiryTime = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS
      const roomName = `drape-order-${String(order.reference ?? order.id).toLowerCase()}-${Date.now()}`
      const dailyRes = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dailyApiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'drape-order-call-room/1.0',
        },
        body: JSON.stringify({
          name: roomName,
          properties: {
            exp: expiryTime,
            max_participants: 2,
            enable_chat: true,
            enable_screenshare: false,
            start_video_off: audioOnly,
            start_audio_off: false,
          },
        }),
      })

      if (!dailyRes.ok) {
        const errBody = await dailyRes.text()
        log('error', FN, 'daily.error', { body: errBody })
        return returnMessageFallback('DAILY_UNAVAILABLE')
      }

      const room = await dailyRes.json()
      roomUrl = room.url

      const updatePayload: Record<string, unknown> = { video_call_url: roomUrl }
      if (readyMadeGate?.ok && !readyMadeGate.orderCall.completedAt) {
        updatePayload.special_note = serializeOrderSupportMeta({
          ...readyMadeGate.supportMeta,
          orderCall: {
            ...readyMadeGate.orderCall,
            completedAt: new Date().toISOString(),
          },
        })
      }

      const { error: updateError } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)

      if (updateError) {
        return jsonError(corsHeaders, 500, 'ROOM_PERSIST_FAILED', 'The call room was created but could not be attached to this order cleanly.')
      }
    } else if (readyMadeGate?.ok && !readyMadeGate.orderCall.completedAt) {
      const { error: updateCallMetaError } = await supabase
        .from('orders')
        .update({
          special_note: serializeOrderSupportMeta({
            ...readyMadeGate.supportMeta,
            orderCall: {
              ...readyMadeGate.orderCall,
              completedAt: new Date().toISOString(),
            },
          }),
        })
        .eq('id', orderId)

      if (updateCallMetaError) {
        log('warn', FN, 'ready_made_call_meta_update_failed', {
          actor_id: caller.id,
          order_id: orderId,
          error: updateCallMetaError.message,
        })
      }
    }

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
            interruptionLevel: 'timeSensitive',
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
        ]),
      )
    }

    return jsonResponse({ url: roomUrl, existing }, 200, corsHeaders)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(corsHeaders, 500, 'INTERNAL_ERROR', 'Could not start the Drape call right now.')
  }
})
