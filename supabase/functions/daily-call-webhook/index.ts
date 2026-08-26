import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'

type DailyWebhookEvent = {
  id: string
  type: 'meeting.started' | 'meeting.ended' | 'participant.joined' | 'participant.left'
  event_ts: number
  payload: Record<string, unknown>
}

const FN = 'daily-call-webhook'
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function secondsToIso(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null
}

function roomName(payload: Record<string, unknown>) {
  return typeof payload.room === 'string' ? payload.room : null
}

function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64(value: ArrayBuffer) {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function releaseVerifiedConsultation(
  supabase: SupabaseClient,
  bookingId: string,
  evidence: Record<string, unknown> | null,
) {
  if (evidence?.derived_outcome !== 'ATTENDED') return
  const { data: booking, error } = await supabase
    .from('consultation_bookings')
    .select('id,order_id,fee_mode,fee_amount,payment_status,settlement_status,commercial_correlation_id')
    .eq('id', bookingId)
    .maybeSingle()
  if (error || !booking) throw error ?? new Error('Consultation booking was not found.')
  if (booking.fee_mode !== 'PAID' || booking.payment_status !== 'PAID') {
    await supabase.from('consultation_bookings').update({
      settlement_status: 'NOT_REQUIRED',
      settlement_outcome: 'ATTENDED',
      settled_at: new Date().toISOString(),
    }).eq('id', booking.id)
    return
  }
  if (booking.settlement_status !== 'HELD') return
  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase.from('consultation_bookings').update({
    settlement_status: 'EARNED',
    settlement_outcome: 'ATTENDED',
    earned_amount: booking.fee_amount ?? 0,
    refunded_amount: 0,
    settlement_eligible_at: now,
    settlement_failure_reason: null,
  }).eq('id', booking.id).eq('settlement_status', 'HELD').select('id').maybeSingle()
  if (claimError) throw claimError
  if (!claimed?.id) return
  await supabase.from('consultation_commercial_events').insert({
    booking_id: booking.id,
    order_id: booking.order_id,
    event_type: 'ATTENDANCE_EARNED',
    actor_role: 'SYSTEM',
    amount: booking.fee_amount ?? 0,
    correlation_id: booking.commercial_correlation_id,
    payload: { attendance_outcome: 'ATTENDED', verified_overlap_seconds: evidence?.verified_overlap_seconds ?? null },
  })
  const { error: releaseError } = await supabase.functions.invoke('release-consultation-earning', {
    body: { bookingId: booking.id },
  })
  if (releaseError) {
    log('error', FN, 'consultation_release_invoke_failed', { booking_id: booking.id, error: releaseError.message })
  }
}

async function verifySignature(
  event: Record<string, unknown>,
  timestamp: string | null,
  signature: string | null,
) {
  const secret = Deno.env.get('DAILY_WEBHOOK_HMAC')?.trim()
  if (!secret || !timestamp || !signature) return false

  const timestampSeconds = Number(timestamp)
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_SIGNATURE_AGE_SECONDS
  ) {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase64(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const content = `${timestamp}.${JSON.stringify(event)}`
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content))
  return constantTimeEqual(encodeBase64(digest), signature)
}

function isSupportedEvent(value: Record<string, unknown>): value is DailyWebhookEvent {
  return (
    typeof value.id === 'string' &&
    typeof value.event_ts === 'number' &&
    typeof value.payload === 'object' &&
    value.payload !== null &&
    (
      value.type === 'meeting.started' ||
      value.type === 'meeting.ended' ||
      value.type === 'participant.joined' ||
      value.type === 'participant.left'
    )
  )
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const rawEvent = await request.json().catch(() => null) as Record<string, unknown> | null
  if (rawEvent?.test === 'test') return json({ ok: true })
  if (!rawEvent || !isSupportedEvent(rawEvent)) return json({ error: 'Unsupported event' }, 400)

  const verified = await verifySignature(
    rawEvent,
    request.headers.get('X-Webhook-Timestamp'),
    request.headers.get('X-Webhook-Signature'),
  ).catch(() => false)
  if (!verified) return json({ error: 'Invalid signature' }, 401)

  const event = rawEvent
  const payload = event.payload
  const room = roomName(payload)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

  const { data: existingEvent } = await supabase
    .from('daily_webhook_events')
    .select('processed_at')
    .eq('id', event.id)
    .maybeSingle()
  if (existingEvent?.processed_at) return json({ ok: true, duplicate: true })

  if (!existingEvent) {
    const { error: insertError } = await supabase.from('daily_webhook_events').insert({
      id: event.id,
      event_type: event.type,
      room_name: room,
      event_created_at: secondsToIso(event.event_ts),
      payload: event,
    })
    if (insertError && insertError.code !== '23505') {
      log('error', FN, 'event_insert_failed', { event_id: event.id, error: insertError.message })
      return json({ error: 'Could not record event' }, 500)
    }
  }

  try {
    if (!room) throw new Error('Event did not include a room name')

    const { data: callRoom } = await supabase
      .from('order_call_rooms')
      .select('id, order_id, consultation_booking_id')
      .eq('provider', 'DAILY')
      .eq('provider_room_name', room)
      .maybeSingle()

    if (!callRoom) {
      log('warn', FN, 'room_not_mapped', { event_id: event.id, room_name: room })
    } else if (event.type === 'meeting.started') {
      const meetingId = typeof payload.meeting_id === 'string' ? payload.meeting_id : null
      const startedAt = secondsToIso(payload.start_ts)
      if (!meetingId || !startedAt) throw new Error('Meeting start metadata is incomplete')

      const { error } = await supabase.from('order_call_sessions').upsert({
        call_room_id: callRoom.id,
        order_id: callRoom.order_id,
        provider_meeting_id: meetingId,
        status: 'STARTED',
        started_at: startedAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_meeting_id' })
      if (error) throw error
    } else if (event.type === 'meeting.ended') {
      const meetingId = typeof payload.meeting_id === 'string' ? payload.meeting_id : null
      const startedAt = secondsToIso(payload.start_ts)
      const endedAt = secondsToIso(payload.end_ts)
      if (!meetingId || !startedAt || !endedAt) throw new Error('Meeting end metadata is incomplete')
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
      )

      const { error } = await supabase.from('order_call_sessions').upsert({
        call_room_id: callRoom.id,
        order_id: callRoom.order_id,
        provider_meeting_id: meetingId,
        status: 'ENDED',
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_meeting_id' })
      if (error) throw error
    } else {
      const providerSessionId = typeof payload.session_id === 'string'
        ? payload.session_id
        : null
      const joinedAt = secondsToIso(payload.joined_at)
      const userId = typeof payload.user_id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.user_id)
        ? payload.user_id
        : null
      if (!providerSessionId || !joinedAt) throw new Error('Participant metadata is incomplete')

      const durationSeconds = typeof payload.duration === 'number'
        ? Math.max(0, Math.round(payload.duration))
        : null
      const leftAt = durationSeconds == null
        ? null
        : new Date(new Date(joinedAt).getTime() + durationSeconds * 1000).toISOString()

      const { error } = await supabase.from('order_call_participations').upsert({
        call_room_id: callRoom.id,
        order_id: callRoom.order_id,
        provider_session_id: providerSessionId,
        user_id: userId,
        user_name: typeof payload.user_name === 'string' ? payload.user_name.slice(0, 80) : null,
        joined_at: joinedAt,
        ...(event.type === 'participant.left'
          ? {
              left_at: leftAt,
              duration_seconds: durationSeconds,
              updated_at: new Date().toISOString(),
            }
          : {}),
      }, { onConflict: 'provider_session_id' })
      if (error) throw error
    }

    if (callRoom?.consultation_booking_id) {
      const { data: evidence, error: evidenceError } = await supabase.rpc(
        'refresh_consultation_attendance_evidence',
        { p_booking_id: callRoom.consultation_booking_id },
      )
      if (evidenceError) {
        log('warn', FN, 'attendance_evidence_refresh_failed', {
          event_id: event.id,
          booking_id: callRoom.consultation_booking_id,
          error: evidenceError.message,
        })
      } else if (event.type === 'meeting.ended') {
        await releaseVerifiedConsultation(
          supabase,
          callRoom.consultation_booking_id,
          evidence && typeof evidence === 'object' ? evidence as Record<string, unknown> : null,
        )
      }
    }

    await supabase
      .from('daily_webhook_events')
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq('id', event.id)

    return json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase
      .from('daily_webhook_events')
      .update({ processing_error: message.slice(0, 500) })
      .eq('id', event.id)
    log('error', FN, 'event_processing_failed', { event_id: event.id, error: message })
    return json({ error: 'Event processing failed' }, 500)
  }
})
