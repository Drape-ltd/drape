import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type DeliveryProvider = 'SHIPPO' | 'TOPSHIP' | 'SHIPBUBBLE'

const encoder = new TextEncoder()

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function validTimestamp(...values: unknown[]) {
  const value = firstString(...values)
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function deliveryWebhookLogistics(payload: Record<string, unknown>) {
  const data = asObject(payload.data)
  const tracking = asObject(data.tracking)
  const shipment = asObject(data.shipment)
  const courier = asObject(data.courier)
  const statusDetails = asObject(data.status_details)
  const rawLocation = payload.location ?? data.location ?? data.current_location ?? tracking.location ??
    shipment.current_location ?? statusDetails.location
  const locationObject = asObject(rawLocation)
  const latitude = firstNumber(
    locationObject.latitude,
    locationObject.lat,
    asObject(locationObject.coordinates).latitude,
    asObject(locationObject.coordinates).lat,
  )
  const longitude = firstNumber(
    locationObject.longitude,
    locationObject.lng,
    locationObject.lon,
    asObject(locationObject.coordinates).longitude,
    asObject(locationObject.coordinates).lng,
    asObject(locationObject.coordinates).lon,
  )
  const label = firstString(
    typeof rawLocation === 'string' ? rawLocation : null,
    locationObject.label,
    locationObject.name,
    locationObject.formatted_address,
    locationObject.address,
    locationObject.city,
  )
  const location = label || latitude != null || longitude != null
    ? { ...(label ? { label } : {}), ...(latitude != null ? { latitude } : {}), ...(longitude != null ? { longitude } : {}) }
    : null

  return {
    trackingUrl: firstString(
      payload.tracking_url,
      payload.trackingUrl,
      data.tracking_url,
      data.trackingUrl,
      tracking.tracking_url,
      tracking.trackingUrl,
      shipment.tracking_url,
      courier.tracking_url,
    ),
    etaAt: validTimestamp(
      payload.eta_at,
      payload.estimated_delivery,
      payload.estimated_delivery_date,
      data.eta_at,
      data.eta,
      data.estimated_delivery,
      data.estimated_delivery_date,
      tracking.eta,
      tracking.eta_at,
      shipment.eta,
      shipment.estimated_delivery,
    ),
    etaTimezone: firstString(
      payload.eta_timezone,
      payload.timezone,
      data.eta_timezone,
      data.timezone,
      tracking.eta_timezone,
      shipment.timezone,
    ),
    location,
  }
}

export async function identifyDeliveryWebhook(input: {
  provider: DeliveryProvider
  payload: Record<string, unknown>
  rawPayload: string
}) {
  const data = asObject(input.payload.data)
  const tracking = asObject(data.tracking)
  const payloadHash = await sha256Hex(input.rawPayload)
  const eventType = firstString(
    input.payload.type,
    input.payload.event,
    data.type,
    data.event,
    'tracking.updated',
  )!
  const providerEventId = firstString(
    input.payload.id,
    input.payload.event_id,
    input.payload.webhook_id,
    data.id,
    data.event_id,
    // Some delivery providers do not supply an event id. Their tracking,
    // status and timestamp tuple is stable enough to dedupe retries, while
    // the payload hash still prevents an id being reused with different data.
    [
      firstString(data.tracking_number, data.tracking_id, tracking.tracking_number, input.payload.tracking_code),
      eventType,
      firstString(input.payload.created_at, input.payload.updated_at, data.created_at, data.updated_at),
    ].filter(Boolean).join(':'),
    payloadHash,
  )!
  return { providerEventId, eventType, payloadHash }
}

export async function enqueueVerifiedDeliveryWebhook(
  supabase: SupabaseClient,
  input: {
    provider: DeliveryProvider
    providerEventId: string
    eventType: string
    payload: Record<string, unknown>
    payloadHash: string
  },
) {
  const { data, error } = await supabase.rpc('enqueue_verified_delivery_webhook', {
    p_provider: input.provider,
    p_provider_event_id: input.providerEventId,
    p_event_type: input.eventType,
    p_payload: input.payload,
    p_payload_sha256: input.payloadHash,
    p_max_attempts: 12,
  })
  if (error) throw new Error(`Could not durably enqueue delivery webhook: ${error.message}`)
  return data as {
    webhookEventId: string
    jobId: string | null
    duplicate: boolean
    alreadyProcessed: boolean
    processingStatus: string
  }
}

export async function loadQueuedDeliveryWebhook(
  supabase: SupabaseClient,
  webhookEventId: string,
) {
  const { data, error } = await supabase
    .from('delivery_webhook_events')
    .select('id,provider,provider_event_id,event_type,payload,payload_sha256,signature_valid,processed_at,processing_status,processing_result')
    .eq('id', webhookEventId)
    .maybeSingle()
  if (error) throw new Error(`Could not load queued delivery webhook: ${error.message}`)
  if (!data) throw new Error('Queued delivery webhook was not found.')
  if (!data.signature_valid) throw new Error('Queued delivery webhook signature was not verified.')
  if (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) {
    throw new Error('Queued delivery webhook payload is invalid.')
  }
  return data as {
    id: string
    provider: DeliveryProvider
    provider_event_id: string
    event_type: string
    payload: Record<string, unknown>
    payload_sha256: string
    processed_at: string | null
    processing_status: string
    processing_result: Record<string, unknown> | null
  }
}
