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
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { parseOrderSupportMeta } from '../_shared/order-support.ts'
import { enqueueOrderEventEmailJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import {
  createDailyMeetingToken,
  createDailyRoomWithObservability,
  recordDailyCallRoom,
} from '../_shared/daily-observability.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const BodySchema = z.object({
  orderId:  uuid,
  callType: z.enum(['video', 'audio']).default('video'),
  notifyCounterpart: z.boolean().default(true),
})

// Room expires 48h after creation — covers consultation window with buffer
const ROOM_TTL_SECONDS = 48 * 60 * 60
const CONSULTATION_JOIN_EARLY_MS = 5 * 60 * 1000

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

function consultationStartGate(scheduledStartAt: string | null | undefined) {
  if (!scheduledStartAt) return null
  const starts = new Date(scheduledStartAt).getTime()
  if (!Number.isFinite(starts)) return null
  const opensAt = starts - CONSULTATION_JOIN_EARLY_MS
  if (Date.now() < opensAt) {
    return 'This consultation opens 5 minutes before the scheduled time.'
  }
  return null
}

function consultationFallbackMessage(audioOnly: boolean) {
  return audioOnly
    ? 'Consultation audio is unavailable right now. Continue inside Messages so Drapeon keeps the consultation record complete.'
    : 'Consultation video is unavailable right now. Continue inside Messages so Drapeon keeps the consultation record complete.'
}

function consultationFallbackStageNote(audioOnly: boolean) {
  return audioOnly
    ? 'Consultation audio is unavailable. Continue this consultation in Messages; Drapeon has logged the fallback.'
    : 'Consultation video is unavailable. Continue this consultation in Messages; Drapeon has logged the fallback.'
}

function recipientAudience(callerRole: 'CUSTOMER' | 'TAILOR') {
  return callerRole === 'TAILOR' ? 'CUSTOMER' as const : 'TAILOR' as const
}

function consultationCallSmsBody(reference: string | null, callerRole: 'CUSTOMER' | 'TAILOR', audioOnly: boolean) {
  const actor = callerRole === 'TAILOR' ? 'tailor' : 'customer'
  const kind = audioOnly ? 'audio room' : 'call'
  return `Drapeon: your ${actor} opened the consultation ${kind} for order ${reference ?? 'your order'}. Open Drapeon to join.`;
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

    const { orderId, notifyCounterpart } = parsed.data
    const callType = parsed.data.callType ?? 'video'
    const audioOnly = callType === 'audio'

    const supabase = createClient(
      getSupabaseUrl(),
      getServiceRoleKey(),
    )

    // Rate limit: 10 room creations per hour per user
    const allowed = await checkRateLimit(supabase, `create-consultation-room:${caller.id}`, 3600, 10)
    if (!allowed) {
      return rateLimitExceededResponse(corsHeaders)
    }

    // Check for existing room URL — also fetch tailor ownership fields
    const { data: order } = await supabase
      .from('orders')
      .select('id, reference, stage, video_call_url, tailor_id, tailor_profile_id, customer_id, consultation_fee, special_note, tailor_profiles!tailor_profile_id(user_id)')
      .eq('id', orderId)
      .single()

    if (!order) return jsonError(corsHeaders, 404, 'ORDER_NOT_FOUND', 'That order could not be found anymore.')

    // Verify the caller is one of the two people on this order
    const tailorUserId = order.tailor_id ?? (order.tailor_profiles as any)?.user_id
    const tailorProfileId =
      typeof (order as { tailor_profile_id?: string | null }).tailor_profile_id === 'string'
        ? (order as { tailor_profile_id?: string | null }).tailor_profile_id
        : null
    const customerUserId = (order as { customer_id?: string | null }).customer_id ?? null
    const callerRole = tailorUserId === caller.id ? 'TAILOR' : customerUserId === caller.id ? 'CUSTOMER' : null
    if (!callerRole) {
      return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only the customer or tailor on this order can start the consultation room.')
    }
    const callerName =
      (caller as { user_metadata?: { display_name?: unknown } }).user_metadata?.display_name
    const joinPayload = async (url: string, existing: boolean) => {
      const roomCreatedAt = extractRoomCreatedAt(url) ?? Date.now()
      await recordDailyCallRoom({
        supabase,
        orderId,
        roomUrl: url,
        callKind: 'CONSULTATION',
        callType,
        scheduledStartAt: consultationMeta?.scheduledStartAt ?? null,
        expiresAt: Math.floor(roomCreatedAt / 1000) + ROOM_TTL_SECONDS,
        createdBy: caller.id,
      })
      const token = await createDailyMeetingToken({
        roomUrl: url,
        userId: caller.id,
        userName: typeof callerName === 'string' && callerName.trim()
          ? callerName.trim()
          : callerRole === 'TAILOR' ? 'Tailor' : 'Customer',
        audioOnly,
      })
      return token
        ? jsonResponse({ url, token, existing }, 200, corsHeaders)
        : jsonError(corsHeaders, 503, 'DAILY_TOKEN_UNAVAILABLE', 'The protected call pass could not be created. Try again shortly.')
    }

    if (order.stage !== 'CONSULTATION') {
      return jsonError(corsHeaders, 409, 'CONSULTATION_NOT_READY', 'This order is no longer in the consultation stage.')
    }

    const supportMeta = parseOrderSupportMeta((order as { special_note?: string | null }).special_note)
    const consultationMeta = supportMeta.consultation ?? null
    if (!consultationMeta || consultationMeta.status === 'REQUESTED' || consultationMeta.status === 'DECLINED') {
      return jsonError(
        corsHeaders,
        409,
        'CONSULTATION_NOT_APPROVED',
        'This consultation has not been approved and scheduled yet.',
      )
    }

    const consultationPaymentRequired =
      typeof (order as { consultation_fee?: number | null }).consultation_fee === 'number'
      && ((order as { consultation_fee?: number | null }).consultation_fee ?? 0) > 0
      && consultationMeta?.paymentTiming === 'BEFORE_CALL_STARTS'
      && !consultationMeta?.paidAt

    if (consultationPaymentRequired) {
      return jsonError(
        corsHeaders,
        409,
        'CONSULTATION_PAYMENT_REQUIRED',
        'The customer still needs to pay the consultation fee before you can start the consultation call.',
      )
    }

    const startGate = consultationStartGate(consultationMeta.scheduledStartAt)
    if (startGate) {
      return jsonError(corsHeaders, 409, 'CONSULTATION_NOT_OPEN_YET', startGate)
    }

    const recipientId = callerRole === 'TAILOR' ? customerUserId : tailorUserId
    const returnMessageFallback = (reason: 'DAILY_NOT_CONFIGURED' | 'DAILY_UNAVAILABLE') => {
      EdgeRuntime.waitUntil(
        (async () => {
          const { error: stageUpdateError } = await supabase.from('order_stage_updates').insert({
            order_id: orderId,
            stage: order.stage,
            note: consultationFallbackStageNote(audioOnly),
          })

          if (stageUpdateError) {
            console.warn('[create-consultation-room] fallback stage update failed:', stageUpdateError.message)
          }

          await audit(supabase, {
            event: 'consultation.call_fallback_started',
            actor_id: caller.id,
            actor_role: callerRole,
            order_id: orderId,
            payload: {
              function: 'create-consultation-room',
              call_type: callType,
              reason,
              fallback: 'MESSAGES',
            },
          })

          if (recipientId) {
            await Promise.allSettled([
              sendPushToUser(supabase, recipientId.toString(), {
                title: 'Consultation fallback active',
                body: 'Calling is unavailable right now. Continue inside the order thread so Drapeon keeps the record.',
                preferenceKey: 'orderUpdates',
                data: { orderId },
              }),
              enqueueSmsJob(supabase, {
                userId: recipientId.toString(),
                audience: recipientAudience(callerRole),
                source: 'create-consultation-room',
                orderId,
                event: 'consultation_call_fallback',
                idempotencyKey: `consultation-call-fallback:${orderId}:${reason}:${recipientId}`,
                priority: 12,
                body: `Drapeon: consultation calling is unavailable for order ${order.reference ?? orderId}. Continue inside the order thread.`,
              }),
              enqueueOrderEventEmailJob(supabase, {
                order,
                recipientUserId: recipientId.toString(),
                audience: recipientAudience(callerRole),
                source: 'create-consultation-room',
                subject: 'Drapeon consultation calling is temporarily unavailable',
                headline: 'Continue your consultation in Messages',
                body: `Calling is unavailable for order ${order.reference ?? orderId}. Continue in the protected order thread while Drapeon keeps the consultation record.`,
                idempotencyKey: `consultation-call-fallback-email:${orderId}:${reason}:${recipientId}`,
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
          message: consultationFallbackMessage(audioOnly),
        },
        200,
        corsHeaders,
      )
    }

    // Reuse only rooms that still fall within the app TTL. Old Daily rooms can expire
    // while the stale URL remains on the order record.
    if (order.video_call_url) {
      if (isFreshRoomUrl(order.video_call_url)) {
        return await joinPayload(order.video_call_url, true)
      }
    }

    // Create a new Daily.co room
    const expiryTime = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS
    const roomName = `drapeon-${String(order.reference ?? order.id).toLowerCase()}-${Date.now()}`
    const dailyRoom = await createDailyRoomWithObservability({
      supabase,
      functionName: 'create-consultation-room',
      orderId,
      actorId: caller.id,
      actorRole: callerRole,
      stage: order.stage,
      callKind: 'CONSULTATION',
      roomName,
      expiresAt: expiryTime,
      audioOnly,
    })
    if (!dailyRoom.ok) return returnMessageFallback(dailyRoom.reason)
    const roomUrl = dailyRoom.url

    // Atomic write: re-verify ownership + stage + no existing URL in one UPDATE.
    // The WHERE clause prevents TOCTOU: if another request already set the URL,
    // this update matches 0 rows and we fall through to return the existing URL.
    let updateQuery = supabase
      .from('orders')
      .update({ video_call_url: roomUrl })
      .eq('id', orderId)
      .eq('stage', 'CONSULTATION')

    if (callerRole === 'CUSTOMER') {
      updateQuery = updateQuery.eq('customer_id', caller.id)
    } else if (order.tailor_id) {
      updateQuery = updateQuery.eq('tailor_id', caller.id)
    } else if (tailorProfileId) {
      updateQuery = updateQuery.eq('tailor_profile_id', tailorProfileId)
    } else {
      return jsonError(corsHeaders, 403, 'FORBIDDEN', 'Only the customer or tailor on this order can start the consultation room.')
    }

    updateQuery = order.video_call_url
      ? updateQuery.eq('video_call_url', order.video_call_url)
      : updateQuery.is('video_call_url', null)

    const { data: persistedRows } = await updateQuery.select('id')

    if (!persistedRows || persistedRows.length === 0) {
      // Race: another request beat us — return the URL it set
      let freshQuery = supabase
        .from('orders')
        .select('video_call_url')
        .eq('id', orderId)
        .eq('stage', 'CONSULTATION')

      if (callerRole === 'CUSTOMER') {
        freshQuery = freshQuery.eq('customer_id', caller.id)
      } else if (order.tailor_id) {
        freshQuery = freshQuery.eq('tailor_id', caller.id)
      } else if (tailorProfileId) {
        freshQuery = freshQuery.eq('tailor_profile_id', tailorProfileId)
      }

      const { data: fresh } = await freshQuery.maybeSingle()
      const existingUrl = (fresh as any)?.video_call_url
      if (existingUrl) {
        return await joinPayload(existingUrl, true)
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
      actor_role: callerRole,
      order_id: orderId,
      payload: {
        function: 'create-consultation-room',
        call_type: callType,
        actor_role: callerRole,
      },
    })

    if (recipientId && notifyCounterpart) {
      EdgeRuntime.waitUntil(
        Promise.allSettled([
          sendPushToUser(supabase, recipientId.toString(), {
            title: audioOnly ? 'Consultation audio ready' : 'Consultation call ready',
            body: audioOnly
              ? 'Your consultation audio room is ready. Tap to join now.'
              : 'Your consultation call is ready. Tap to join now.',
            preferenceKey: 'messages',
            channelId: 'calls',
            sound: 'default',
            interruptionLevel: 'time-sensitive',
            data: {
              orderId,
              target: 'call-join',
              callKind: 'consultation',
              callType,
            },
          }),
          enqueueSmsJob(supabase, {
            userId: recipientId.toString(),
            audience: recipientAudience(callerRole),
            source: 'create-consultation-room',
            orderId,
            event: 'consultation_call_started',
            idempotencyKey: `consultation-call-started:${orderId}:${recipientId}:${callType}`,
            priority: 10,
            body: consultationCallSmsBody(order.reference ?? null, callerRole, audioOnly),
          }),
          enqueueOrderEventEmailJob(supabase, {
            order,
            recipientUserId: recipientId.toString(),
            audience: recipientAudience(callerRole),
            source: 'create-consultation-room',
            subject: audioOnly ? 'Your Drapeon consultation audio is ready' : 'Your Drapeon consultation call is ready',
            headline: 'Join your consultation now',
            body: `Your ${callerRole === 'TAILOR' ? 'tailor' : 'customer'} opened the consultation for order ${order.reference ?? orderId}. Open Drapeon to join.`,
            idempotencyKey: `consultation-call-started-email:${orderId}:${recipientId}:${callType}`,
            ctaLabel: 'Open Drapeon',
            priority: 10,
          }),
        ]),
      )
    }

    return await joinPayload(roomUrl, false)
  } catch (err) {
    console.error('[create-consultation-room]', err)
    return jsonError(corsHeaders, 500, 'INTERNAL_ERROR', 'Could not start the consultation call right now.')
  }
})
