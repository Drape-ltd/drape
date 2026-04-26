import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getDailyApiKey, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { isHandoffStage } from '../_shared/handoff-support.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const FN = 'create-order-call-room'
const ROOM_TTL_SECONDS = 48 * 60 * 60

const BodySchema = z.object({
  orderId: uuid,
  callType: z.enum(['video', 'audio']).default('video'),
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
        ? 'Your tailor is trying to reach you on a Drape audio call. Open the order to join now.'
        : 'Your tailor is trying to reach you on a Drape call. Open the order to join now.',
    }
  }

  return {
    title: audioOnly ? 'Customer audio call ready' : 'Customer call ready',
    body: audioOnly
      ? 'Your customer is trying to reach you on a Drape audio call. Open the order to join now.'
      : 'Your customer is trying to reach you on a Drape call. Open the order to join now.',
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(corsHeaders, 401, 'UNAUTHORIZED', 'You need to sign in again before starting a Drape call.')

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonError(corsHeaders, 400, 'VALIDATION_FAILED', parsed.error)

    const { orderId, callType } = parsed.data
    const audioOnly = callType === 'audio'

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 12)
    if (!allowed) {
      return jsonError(corsHeaders, 429, 'RATE_LIMITED', 'Too many Drape call attempts right now. Please try again later.')
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, reference, stage, video_call_url, tailor_id, customer_id')
      .eq('id', orderId)
      .single()

    if (!order) return jsonError(corsHeaders, 404, 'ORDER_NOT_FOUND', 'That order could not be found anymore.')

    const isParticipant = order.tailor_id?.toString() === caller.id || order.customer_id?.toString() === caller.id
    if (!isParticipant) {
      return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only people on this order can start a Drape call.')
    }

    if (!isHandoffStage(order.stage)) {
      return jsonError(corsHeaders, 409, 'ORDER_CALL_NOT_READY', 'Drape calls open once pickup or delivery is actively in progress.')
    }

    const actorRole: 'CUSTOMER' | 'TAILOR' =
      order.tailor_id?.toString() === caller.id ? 'TAILOR' : 'CUSTOMER'
    const counterpartId = actorRole === 'TAILOR'
      ? order.customer_id?.toString() ?? null
      : order.tailor_id?.toString() ?? null

    let roomUrl = order.video_call_url
    let existing = !!roomUrl && isFreshRoomUrl(roomUrl)

    if (!existing) {
      let dailyApiKey = ''
      try {
        dailyApiKey = getDailyApiKey()
      } catch {
        return jsonError(corsHeaders, 503, 'DAILY_NOT_CONFIGURED', 'Drape calling is not configured in this environment yet.')
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
        return jsonError(corsHeaders, 502, 'DAILY_UNAVAILABLE', 'Drape calls are temporarily unavailable. Keep using messages and try again shortly.')
      }

      const room = await dailyRes.json()
      roomUrl = room.url

      const { error: updateError } = await supabase
        .from('orders')
        .update({ video_call_url: roomUrl })
        .eq('id', orderId)

      if (updateError) {
        return jsonError(corsHeaders, 500, 'ROOM_PERSIST_FAILED', 'The call room was created but could not be attached to this order cleanly.')
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

    if (counterpartId) {
      const push = counterpartPush(actorRole, audioOnly)
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, counterpartId, {
          title: push.title,
          body: push.body,
          data: { orderId },
        }),
      )
    }

    return jsonResponse({ url: roomUrl, existing }, 200, corsHeaders)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(corsHeaders, 500, 'INTERNAL_ERROR', 'Could not start the Drape call right now.')
  }
})
