/**
 * create-consultation-room
 *
 * Creates a Daily.co video room for an order consultation and stores the URL
 * on the order so both tailor and customer can join.
 *
 * Called by the tailor when they want to start a video consultation.
 * Returns the existing URL if a room already exists for this order.
 *
 * Required env vars:
 *   DAILY_API_KEY             – Daily.co API key for server-side room creation
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getDailyApiKey, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const BodySchema = z.object({
  orderId:  uuid,
  callType: z.enum(['video', 'audio']).default('video'),
})

// Room expires 48h after creation — covers consultation window with buffer
const ROOM_TTL_SECONDS = 48 * 60 * 60

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(
  corsHeaders: HeadersInit,
  status: number,
  code: string,
  error: string,
) {
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is authenticated
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(corsHeaders, 401, 'UNAUTHORIZED', 'You need to sign in again before starting a consultation call.')

    const parsed = parseBody(BodySchema, await req.json())
    if (!parsed.ok) return jsonError(corsHeaders, 400, 'VALIDATION_FAILED', parsed.error)

    const { orderId, callType } = parsed.data
    const audioOnly = callType === 'audio'

    const supabase = createClient(
      getSupabaseUrl(),
      getServiceRoleKey(),
    )

    // Rate limit: 10 room creations per hour per user
    const allowed = await checkRateLimit(supabase, `create-consultation-room:${caller.id}`, 3600, 10)
    if (!allowed) {
      return jsonError(corsHeaders, 429, 'RATE_LIMITED', 'Too many consultation attempts right now. Please try again later.')
    }

    // Check for existing room URL — also fetch tailor ownership fields
    const { data: order } = await supabase
      .from('orders')
      .select('id, reference, stage, video_call_url, tailor_id, customer_id, tailor_profiles!tailor_profile_id(user_id)')
      .eq('id', orderId)
      .single()

    if (!order) return jsonError(corsHeaders, 404, 'ORDER_NOT_FOUND', 'That order could not be found anymore.')

    // Verify the caller is the tailor on this order
    const tailorUserId = order.tailor_id ?? (order.tailor_profiles as any)?.user_id
    if (tailorUserId !== caller.id) {
      return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only the tailor on this order can start the consultation room.')
    }

    if (order.stage !== 'CONSULTATION') {
      return jsonError(corsHeaders, 409, 'CONSULTATION_NOT_READY', 'This order is no longer in the consultation stage.')
    }

    // Reuse only rooms that still fall within the app TTL. Old Daily rooms can expire
    // while the stale URL remains on the order record.
    if (order.video_call_url) {
      if (isFreshRoomUrl(order.video_call_url)) {
        return jsonResponse({ url: order.video_call_url, existing: true }, 200, corsHeaders)
      }
    }

    // Create a new Daily.co room
    const expiryTime = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS
    const roomName = `drape-${String(order.reference ?? order.id).toLowerCase()}-${Date.now()}`
    let dailyApiKey = ''

    try {
      dailyApiKey = getDailyApiKey()
    } catch {
      return jsonError(
        corsHeaders,
        503,
        'DAILY_NOT_CONFIGURED',
        'Consultation calling is not configured in this environment yet.',
      )
    }

    const dailyRes = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dailyApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'drape-consultation-room/1.0',
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
      console.error('[create-consultation-room] Daily.co error:', errBody)
      return jsonError(
        corsHeaders,
        502,
        'DAILY_UNAVAILABLE',
        'Consultation calls are temporarily unavailable. Keep using messages and try again shortly.',
      )
    }

    const room = await dailyRes.json()
    const roomUrl: string = room.url

    // Atomic write: re-verify ownership + stage + no existing URL in one UPDATE.
    // The WHERE clause prevents TOCTOU: if another request already set the URL,
    // this update matches 0 rows and we fall through to return the existing URL.
    let updateQuery = supabase
      .from('orders')
      .update({ video_call_url: roomUrl })
      .eq('id', orderId)
      .eq('tailor_id', order.tailor_id)
      .eq('stage', 'CONSULTATION')

    updateQuery = order.video_call_url
      ? updateQuery.eq('video_call_url', order.video_call_url)
      : updateQuery.is('video_call_url', null)

    const { data: persistedRows } = await updateQuery.select('id')

    if (!persistedRows || persistedRows.length === 0) {
      // Race: another request beat us — return the URL it set
      const { data: fresh } = await supabase
        .from('orders').select('video_call_url').eq('id', orderId).single()
      const existingUrl = (fresh as any)?.video_call_url
      if (existingUrl) {
        return jsonResponse({ url: existingUrl, existing: true }, 200, corsHeaders)
      }
      return jsonError(
        corsHeaders,
        500,
        'ROOM_PERSIST_FAILED',
        'The consultation room was created but could not be attached to this order cleanly.',
      )
    }

    await audit(supabase, {
      event: 'consultation.room_created',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      order_id: orderId,
      payload: {
        function: 'create-consultation-room',
        call_type: callType,
      },
    })

    if (order.customer_id) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, order.customer_id.toString(), {
          title: audioOnly ? 'Consultation audio ready' : 'Consultation call ready',
          body: audioOnly
            ? 'Your tailor started an audio consultation. Join from your order or messages.'
            : 'Your tailor started a consultation call. Join from your order or messages.',
          data: { orderId },
        }),
      )
    }

    return jsonResponse({ url: roomUrl, existing: false }, 200, corsHeaders)
  } catch (err) {
    console.error('[create-consultation-room]', err)
    return jsonError(corsHeaders, 500, 'INTERNAL_ERROR', 'Could not start the consultation call right now.')
  }
})
