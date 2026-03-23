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
 *   DAILY_API_KEY             – Daily.co API key (REST API → Developers)
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'

const BodySchema = z.object({
  orderId:  uuid,
  callType: z.enum(['video', 'audio']).default('video'),
})

// Room expires 48h after creation — covers consultation window with buffer
const ROOM_TTL_SECONDS = 48 * 60 * 60

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is authenticated
    const caller = await getAuthUser(req)
    if (!caller) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const parsed = parseBody(BodySchema, await req.json())
    if (!parsed.ok) return new Response(parsed.error, { status: 400, headers: corsHeaders })

    const { orderId, callType } = parsed.data
    const audioOnly = callType === 'audio'

    const supabase = createClient(
      getSupabaseUrl(),
      getServiceRoleKey(),
    )

    // Rate limit: 10 room creations per hour per user
    const allowed = await checkRateLimit(supabase, `create-consultation-room:${caller.id}`, 3600, 10)
    if (!allowed) {
      return new Response('Too many requests — try again later', { status: 429, headers: corsHeaders })
    }

    // Check for existing room URL — also fetch tailor ownership fields
    const { data: order } = await supabase
      .from('orders')
      .select('id, reference, stage, video_call_url, tailor_id, tailor_profiles!tailor_profile_id(user_id)')
      .eq('id', orderId)
      .single()

    if (!order) return new Response('Order not found', { status: 404, headers: corsHeaders })

    // Verify the caller is the tailor on this order
    const tailorUserId = order.tailor_id ?? (order.tailor_profiles as any)?.user_id
    if (tailorUserId !== caller.id) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    if (order.stage !== 'CONSULTATION') {
      return new Response('Order is not in CONSULTATION stage', { status: 400, headers: corsHeaders })
    }

    // Return existing room if one already exists (same room works for both audio/video)
    if (order.video_call_url) {
      return new Response(JSON.stringify({ url: order.video_call_url, existing: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create a new Daily.co room
    const expiryTime = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS
    const roomName = `drape-${order.reference.toLowerCase()}-${Date.now()}`

    const dailyRes = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('DAILY_API_KEY')}`,
        'Content-Type': 'application/json',
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
      return new Response('Could not create video room', { status: 502, headers: corsHeaders })
    }

    const room = await dailyRes.json()
    const roomUrl: string = room.url

    // Atomic write: re-verify ownership + stage + no existing URL in one UPDATE.
    // The WHERE clause prevents TOCTOU: if another request already set the URL,
    // this update matches 0 rows and we fall through to return the existing URL.
    const { count } = await supabase
      .from('orders')
      .update({ video_call_url: roomUrl })
      .eq('id', orderId)
      .eq('tailor_id', order.tailor_id)      // re-verify ownership at write time
      .eq('stage', 'CONSULTATION')            // re-verify stage at write time
      .is('video_call_url', null)             // only write if still unset (prevents double-create)
      .select('id', { count: 'exact', head: true })

    if (!count || count === 0) {
      // Race: another request beat us — return the URL it set
      const { data: fresh } = await supabase
        .from('orders').select('video_call_url').eq('id', orderId).single()
      const existingUrl = (fresh as any)?.video_call_url
      if (existingUrl) {
        return new Response(JSON.stringify({ url: existingUrl, existing: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response('Could not persist video room', { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ url: roomUrl, existing: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[create-consultation-room]', err)
    return new Response('Internal error', { status: 500, headers: corsHeaders })
  }
})
