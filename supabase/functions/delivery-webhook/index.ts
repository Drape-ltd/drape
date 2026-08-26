/**
 * delivery-webhook
 *
 * Unified webhook handler for Shippo, Topship, and Shipbubble delivery tracking events.
 * Receives carrier status updates and automatically advances order stage to
 * DELIVERED when a delivery-confirmed event arrives.
 *
 * Configure in each provider's dashboard:
 *   Shippo:  Webhooks → Events: tracking_updated
 *   Topship: Webhooks → Events: shipment.delivered / shipment.out_for_delivery
 *   Shipbubble: API keys & Webhooks → Events: shipment.status.changed
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SHIPPO_WEBHOOK_SECRET      – HMAC secret from Shippo dashboard
 *   TOPSHIP_WEBHOOK_SECRET     – HMAC secret from Topship dashboard
 *   SHIPBUBBLE_WEBHOOK_SECRET  – secret used to verify x-ship-signature
 *                                (SHIPBUBBLE_SECRET_KEY is also accepted)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import {
  deliveryWebhookLogistics,
  enqueueVerifiedDeliveryWebhook,
  identifyDeliveryWebhook,
  loadQueuedDeliveryWebhook,
  type DeliveryProvider,
} from '../_shared/delivery-webhook.ts'
import { enqueueDispatchReconciliation } from '../_shared/drapeon-dispatch-reconciliation.ts'
import {
  buildCustomerStageSms,
  buildTailorStageSms,
} from '../../../packages/shared/src/sms-copy.ts'

const FN = 'delivery-webhook'

/**
 * Timing-safe HMAC-SHA256 verification using the Web Crypto API.
 * incomingHex may be prefixed with "sha256=" or "v1=" — both are stripped.
 */
async function verifyHmac(secret: string, incomingHex: string, payload: string, hash: 'SHA-256' | 'SHA-512'): Promise<boolean> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const msgData = encoder.encode(payload)

  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash }, false, ['verify'],
  )

  const cleanHex = incomingHex.replace(/^(sha256=|v1=)/, '')
  if (cleanHex.length % 2 !== 0) return false

  const sigBytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < cleanHex.length; i += 2) {
    sigBytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16)
  }

  // crypto.subtle.verify is constant-time — prevents timing attacks
  return crypto.subtle.verify('HMAC', key, sigBytes, msgData)
}

async function verifyHmacSha256(secret: string, incomingHex: string, payload: string): Promise<boolean> {
  return verifyHmac(secret, incomingHex, payload, 'SHA-256')
}

async function verifyHmacSha512(secret: string, incomingHex: string, payload: string): Promise<boolean> {
  return verifyHmac(secret, incomingHex, payload, 'SHA-512')
}

// Shippo tracking statuses that mean "delivered"
const SHIPPO_DELIVERED_STATUSES = new Set(['DELIVERED'])
const SHIPPO_ACCEPTED_STATUSES = new Set(['TRANSIT', 'OUT_FOR_DELIVERY'])

// Topship event types that mean "delivered"
const TOPSHIP_DELIVERED_EVENTS = new Set([
  'shipment.delivered',
  'DELIVERED',
  'delivery_confirmed',
])
const TOPSHIP_ACCEPTED_EVENTS = new Set(['shipment.picked_up', 'shipment.in_transit', 'shipment.out_for_delivery', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'])

// Shippo tracking statuses that mean "out for delivery" → advance to SHIPPED (already there, but update timestamp)
// We only act on DELIVERED for now

type Provider = 'shippo' | 'topship' | 'shipbubble' | 'unknown'

function detectProvider(req: Request): Provider {
  const ua = req.headers.get('user-agent') ?? ''
  const sig = req.headers.get('x-shippo-signature') ?? req.headers.get('shippo-webhook-signature') ?? ''
  const topshipSig = req.headers.get('x-topship-signature') ?? ''
  const shipbubbleSig = req.headers.get('x-ship-signature') ?? ''

  if (sig) return 'shippo'
  if (topshipSig) return 'topship'
  if (shipbubbleSig) return 'shipbubble'
  if (ua.toLowerCase().includes('shippo')) return 'shippo'
  if (ua.toLowerCase().includes('topship')) return 'topship'
  if (ua.toLowerCase().includes('shipbubble')) return 'shipbubble'
  return 'unknown'
}

/** Parse a Shippo tracking_updated webhook payload. Returns tracking number and whether delivered. */
function parseShippo(body: any): { trackingNumber: string | null; carrier: string | null; isDelivered: boolean; isAccepted: boolean } {
  const data = body?.data ?? body
  const trackingNumber: string | null = data?.tracking_number ?? data?.tracking?.tracking_number ?? null
  const carrier: string | null = data?.carrier ?? data?.tracking?.carrier ?? null
  const status: string = data?.tracking_status?.status ?? data?.status ?? ''
  return {
    trackingNumber: trackingNumber?.toUpperCase() ?? null,
    carrier,
    isDelivered: SHIPPO_DELIVERED_STATUSES.has(status.toUpperCase()),
    isAccepted: SHIPPO_ACCEPTED_STATUSES.has(status.toUpperCase()),
  }
}

/** Parse a Topship webhook payload. Returns tracking number and whether delivered. */
function parseTopship(body: any): { trackingNumber: string | null; carrier: string | null; isDelivered: boolean; isAccepted: boolean } {
  const event: string = body?.event ?? body?.type ?? ''
  const data = body?.data ?? body
  const trackingNumber: string | null = data?.tracking_number ?? data?.trackingId ?? data?.tracking_id ?? null
  const carrier: string | null = data?.carrier ?? data?.courier ?? null
  return {
    trackingNumber: trackingNumber?.toUpperCase() ?? null,
    carrier,
    isDelivered: TOPSHIP_DELIVERED_EVENTS.has(event),
    isAccepted: TOPSHIP_ACCEPTED_EVENTS.has(event),
  }
}

/** Parse a Shipbubble webhook payload. */
function parseShipbubble(body: any): { trackingNumber: string | null; carrier: string | null; isDelivered: boolean; isAccepted: boolean } {
  const event: string = body?.event ?? ''
  const status = typeof body?.status === 'string'
    ? body.status
    : Array.isArray(body?.package_status) && body.package_status.length > 0
      ? body.package_status[body.package_status.length - 1]?.status
      : ''
  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : ''

  return {
    trackingNumber:
      body?.courier?.tracking_code?.toUpperCase?.() ??
      body?.courier?.trackingCode?.toUpperCase?.() ??
      body?.tracking_code?.toUpperCase?.() ??
      null,
    carrier: body?.courier?.name ?? 'Shipbubble',
    isDelivered:
      event === 'shipment.status.changed' &&
      (normalizedStatus === 'completed' || normalizedStatus === 'delivered'),
    isAccepted:
      event === 'shipment.status.changed' &&
      ['picked up', 'picked_up', 'in transit', 'in_transit', 'out for delivery', 'out_for_delivery'].includes(normalizedStatus),
  }
}

function dispatchEventType(provider: Provider, body: any, delivered: boolean) {
  if (delivered) return 'DELIVERED'
  const data = body?.data ?? body
  const raw = String(
    data?.tracking_status?.status ??
    data?.status ??
    body?.status ??
    body?.event ??
    body?.type ??
    '',
  ).trim().toUpperCase().replace(/[. -]+/g, '_')
  if (raw.includes('OUT_FOR_DELIVERY')) return 'OUT_FOR_DELIVERY'
  if (raw.includes('IN_TRANSIT') || raw === 'TRANSIT') return 'IN_TRANSIT'
  if (raw.includes('PICKED_UP') || raw.includes('COLLECTED')) return 'COLLECTED'
  return provider === 'unknown' ? 'IN_TRANSIT' : 'CARRIER_ACCEPTED'
}

async function auditDeliveryWebhookEvent(
  supabase: SupabaseClient,
  event: string,
  severity: 'info' | 'warn' | 'error',
  payload: Record<string, unknown>,
  orderId?: string | null,
) {
  await audit(supabase, {
    event,
    order_id: orderId ?? null,
    severity,
    payload: {
      function: FN,
      ...payload,
    },
  })
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const serviceRoleKey = getServiceRoleKey()
  const supabase = createClient(getSupabaseUrl(), serviceRoleKey)
  const queuedWebhookEventId = req.headers.get('x-drape-delivery-webhook-event-id')?.trim() || null
  let provider: Provider
  let queuedProviderEventId: string | null = null
  let rawBody: string

  if (queuedWebhookEventId) {
    if (req.headers.get('authorization') !== `Bearer ${serviceRoleKey}`) {
      return new Response('Unauthorized replay', { status: 401 })
    }
    const queued = await loadQueuedDeliveryWebhook(supabase, queuedWebhookEventId)
    provider = queued.provider.toLowerCase() as Provider
    queuedProviderEventId = queued.provider_event_id
    rawBody = JSON.stringify(queued.payload)
  } else {
    const clientIp = getClientIp(req)
    const limit = await rateLimit(
      supabase,
      clientIp,
      FN,
      RATE_LIMITS.webhook.limit,
      RATE_LIMITS.webhook.windowMs,
      { ip: clientIp, userAgent: req.headers.get('user-agent') },
    )
    if (!limit.allowed) return rateLimitExceededResponse(corsHeaders, limit.retryAfter)
    try {
      rawBody = await req.text()
    } catch {
      return new Response('Could not read body', { status: 400 })
    }
    provider = detectProvider(req)
    if (provider === 'unknown') {
      return new Response('Unknown delivery provider', {
        status: 400,
        headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
      })
    }
  }

  // ── HMAC signature verification ──────────────────────────────────────────
  // When a webhook secret is configured, reject requests that fail verification.
  // This is the primary defence against spoofed delivery events.
  if (!queuedWebhookEventId && provider === 'shippo') {
    const shippoSecret = Deno.env.get('SHIPPO_WEBHOOK_SECRET')
    if (!shippoSecret) {
      // Fail closed — a missing secret is a misconfiguration, not an acceptable default
      console.error('[delivery-webhook] SHIPPO_WEBHOOK_SECRET not set — rejecting request to prevent spoofing')
      return new Response('Webhook not configured', { status: 401 })
    }
    const shippoSig = req.headers.get('x-shippo-signature') ?? req.headers.get('shippo-webhook-signature')
    if (!shippoSig) {
      console.warn('[delivery-webhook] Shippo: no signature header present — rejecting')
      return new Response('Missing signature', { status: 401 })
    }
    const valid = await verifyHmacSha256(shippoSecret, shippoSig, rawBody)
    if (!valid) {
      console.warn('[delivery-webhook] Shippo HMAC verification failed')
      return new Response('Invalid signature', { status: 401 })
    }
  }

  if (!queuedWebhookEventId && provider === 'topship') {
    const topshipSecret = Deno.env.get('TOPSHIP_WEBHOOK_SECRET')
    if (!topshipSecret) {
      console.error('[delivery-webhook] TOPSHIP_WEBHOOK_SECRET not set — rejecting request to prevent spoofing')
      return new Response('Webhook not configured', { status: 401 })
    }
    const topshipSig = req.headers.get('x-topship-signature')
    if (!topshipSig) {
      console.warn('[delivery-webhook] Topship: no signature header present — rejecting')
      return new Response('Missing signature', { status: 401 })
    }
    const valid = await verifyHmacSha256(topshipSecret, topshipSig, rawBody)
    if (!valid) {
      console.warn('[delivery-webhook] Topship HMAC verification failed')
      return new Response('Invalid signature', { status: 401 })
    }
  }

  if (!queuedWebhookEventId && provider === 'shipbubble') {
    const shipbubbleSecret =
      Deno.env.get('SHIPBUBBLE_WEBHOOK_SECRET') ??
      Deno.env.get('SHIPBUBBLE_SECRET_KEY')
    if (!shipbubbleSecret) {
      console.error('[delivery-webhook] SHIPBUBBLE_WEBHOOK_SECRET not set — rejecting request to prevent spoofing')
      return new Response('Webhook not configured', { status: 401 })
    }
    const shipbubbleSig = req.headers.get('x-ship-signature')
    if (!shipbubbleSig) {
      console.warn('[delivery-webhook] Shipbubble: no signature header present — rejecting')
      return new Response('Missing signature', { status: 401 })
    }
    const valid = await verifyHmacSha512(shipbubbleSecret, shipbubbleSig, rawBody)
    if (!valid) {
      console.warn('[delivery-webhook] Shipbubble HMAC verification failed')
      return new Response('Invalid signature', { status: 401 })
    }
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  if (!queuedWebhookEventId) {
    const identity = await identifyDeliveryWebhook({
      provider: provider.toUpperCase() as DeliveryProvider,
      payload: body,
      rawPayload: rawBody,
    })
    const queued = await enqueueVerifiedDeliveryWebhook(supabase, {
      provider: provider.toUpperCase() as DeliveryProvider,
      providerEventId: identity.providerEventId,
      eventType: identity.eventType,
      payload: body,
      payloadHash: identity.payloadHash,
    })
    return new Response(JSON.stringify({ ok: true, queued: true, ...queued }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  let trackingNumber: string | null = null
  let carrier: string | null = null
  let isDelivered = false
  let isAccepted = false

  if (provider === 'shippo') {
    ;({ trackingNumber, carrier, isDelivered, isAccepted } = parseShippo(body))
  } else if (provider === 'topship') {
    ;({ trackingNumber, carrier, isDelivered, isAccepted } = parseTopship(body))
  } else if (provider === 'shipbubble') {
    ;({ trackingNumber, carrier, isDelivered, isAccepted } = parseShipbubble(body))
  } else {
    // Try both parsers as a fallback
    const fromShippo = parseShippo(body)
    const fromTopship = parseTopship(body)
    const fromShipbubble = parseShipbubble(body)
    trackingNumber = fromShippo.trackingNumber ?? fromTopship.trackingNumber ?? fromShipbubble.trackingNumber
    carrier = fromShippo.carrier ?? fromTopship.carrier ?? fromShipbubble.carrier
    isDelivered = fromShippo.isDelivered || fromTopship.isDelivered || fromShipbubble.isDelivered
    isAccepted = fromShippo.isAccepted || fromTopship.isAccepted || fromShipbubble.isAccepted
  }

  if (!trackingNumber) {
    log('warn', FN, 'webhook.skipped', { provider, reason: 'no_tracking_number' })
    await auditDeliveryWebhookEvent(supabase, 'shipping.webhook_skipped', 'warn', {
      provider,
      reason: 'no_tracking_number',
      carrier,
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'no_tracking_number' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!isDelivered && !isAccepted) {
    log('info', FN, 'webhook.skipped', {
      provider,
      reason: 'not_financial_evidence',
      tracking_number: trackingNumber,
      carrier,
    })
    await auditDeliveryWebhookEvent(supabase, 'shipping.webhook_skipped', 'info', {
      provider,
      reason: 'not_financial_evidence',
      tracking_number: trackingNumber,
      carrier,
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'not_financial_evidence' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Dispatch v2 owns tracking on the parcel. Keep the legacy order-level lookup
  // only as a compatibility fallback for shipments created before v2.
  const { data: parcel, error: parcelError } = await supabase
    .from('order_fulfillment_parcels')
    .select('order_id')
    .ilike('tracking_number', trackingNumber)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (parcelError) throw new Error(`Could not match dispatch parcel: ${parcelError.message}`)

  const orderQuery = supabase
    .from('orders')
    .select('id, stage, reference, order_kind, garment_type, item_title, item_size, delivery_method, recipient_phone, fulfillment_provider, customer_id, tailor_id, carrier')
  const { data: order, error: orderError } = parcel?.order_id
    ? await orderQuery.eq('id', parcel.order_id).maybeSingle()
    : await orderQuery.ilike('tracking_number', trackingNumber).maybeSingle()
  if (orderError) throw new Error(`Could not load dispatch order: ${orderError.message}`)

  if (!order) {
    log('warn', FN, 'delivery.order_missing', { provider, tracking_number: trackingNumber, carrier })
    await auditDeliveryWebhookEvent(supabase, 'shipping.delivery_order_missing', 'warn', {
      provider,
      tracking_number: trackingNumber,
      carrier,
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'no_order' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const occurredAt = new Date().toISOString()
  const eventType = dispatchEventType(provider, body, isDelivered)
  const providerEventId = queuedProviderEventId ?? `${provider}:${trackingNumber}:${eventType}:${occurredAt}`
  const providerLabel = carrier ?? provider
  const logistics = deliveryWebhookLogistics(body)
  const providerEvidence = [{
    kind: 'PROVIDER_CONFIRMATION',
    provider: provider.toUpperCase(),
    providerEventId,
    trackingNumber,
  }]

  // A signed transport event is trusted custody evidence. Record custody first
  // so a provider whose first callback is DELIVERED still satisfies the gate.
  if (eventType !== 'CARRIER_ACCEPTED') {
    const { error: custodyError } = await supabase.rpc('record_order_fulfillment_event', {
      p_order_id: order.id,
      p_parcel_number: 1,
      p_event_type: 'CARRIER_ACCEPTED',
      p_source: 'PROVIDER',
      p_actor_id: null,
      p_actor_role: 'SYSTEM',
      p_provider_event_id: `${providerEventId}:custody`,
      p_idempotency_key: `dispatch-provider-custody:${provider.toLowerCase()}:${providerEventId}`,
      p_provider_name: providerLabel,
      p_service_level: null,
      p_provider_reference: providerEventId,
      p_tracking_number: trackingNumber,
      p_tracking_url: logistics.trackingUrl,
      p_contact_name: null,
      p_contact_phone: null,
      p_customer_note: `${providerLabel} confirmed custody of the parcel.`,
      p_internal_note: null,
      p_evidence_media: providerEvidence,
      p_location: logistics.location,
      p_eta_at: logistics.etaAt,
      p_eta_timezone: logistics.etaTimezone,
      p_occurred_at: occurredAt,
      p_payload: { signedWebhook: true, provider, carrier, inboxEventId: queuedWebhookEventId },
    })
    if (custodyError) throw custodyError
  }

  const customerNote = eventType === 'DELIVERED'
    ? `${providerLabel} confirmed delivery.`
    : eventType === 'OUT_FOR_DELIVERY'
      ? `Your Drapeon delivery is on the way.`
      : eventType === 'IN_TRANSIT'
        ? `Your order is moving through the delivery network.`
        : `${providerLabel} collected the parcel.`
  const { data: dispatchResult, error: dispatchError } = await supabase.rpc('record_order_fulfillment_event', {
    p_order_id: order.id,
    p_parcel_number: 1,
    p_event_type: eventType,
    p_source: 'PROVIDER',
    p_actor_id: null,
    p_actor_role: 'SYSTEM',
    p_provider_event_id: providerEventId,
    p_idempotency_key: `dispatch-provider-event:${provider.toLowerCase()}:${providerEventId}`,
    p_provider_name: providerLabel,
    p_service_level: null,
    p_provider_reference: providerEventId,
    p_tracking_number: trackingNumber,
    p_tracking_url: logistics.trackingUrl,
    p_contact_name: null,
    p_contact_phone: null,
    p_customer_note: customerNote,
    p_internal_note: null,
    p_evidence_media: providerEvidence,
    p_location: logistics.location,
    p_eta_at: logistics.etaAt,
    p_eta_timezone: logistics.etaTimezone,
    p_occurred_at: occurredAt,
    p_payload: { signedWebhook: true, provider, carrier, inboxEventId: queuedWebhookEventId },
  })
  if (dispatchError) throw dispatchError
  if (eventType === 'DELIVERED') {
    const dispatchRecord = dispatchResult && typeof dispatchResult === 'object' && !Array.isArray(dispatchResult)
      ? dispatchResult as Record<string, unknown>
      : {}
    const runId = typeof dispatchRecord.runId === 'string' ? dispatchRecord.runId : null
    if (runId) {
      await enqueueDispatchReconciliation(supabase, {
        runId,
        orderId: order.id,
        sourceId: `provider:${providerEventId}`,
      })
    }
  }

  const evidenceKind = eventType === 'DELIVERED' ? 'VERIFIED_DELIVERY' : 'CARRIER_ACCEPTED'
  const { error: evidenceError } = await supabase.rpc('record_order_settlement_evidence', {
    p_order_id: order.id,
    p_evidence_kind: evidenceKind,
    p_source: 'TRUSTED_CARRIER',
    p_occurred_at: occurredAt,
    p_external_reference: trackingNumber,
    p_recorded_by: null,
    p_metadata: { provider, carrier, signed_webhook: true, provider_event_id: providerEventId },
  })
  if (evidenceError && !evidenceError.message.includes('ledger-recorded initial payment')) {
    log('error', FN, 'settlement.delivery_evidence_failed', { order_id: order.id, error: evidenceError.message })
  }

  const notificationTitle = eventType === 'DELIVERED'
    ? 'Delivered'
    : eventType === 'OUT_FOR_DELIVERY'
      ? 'Your delivery is on the way'
      : 'Delivery update'
  const notificationBody = customerNote

  if (order.customer_id) {
    await enqueuePushJob(supabase, {
      userId: order.customer_id.toString(),
      source: FN,
      orderId: order.id,
      idempotencyKey: `dispatch:${providerEventId}:customer:push`,
      priority: 15,
      notification: {
        title: notificationTitle,
        body: notificationBody,
        preferenceKey: 'orderUpdates',
        data: { orderId: order.id },
      },
    })
    const customerSms = eventType === 'DELIVERED' ? buildCustomerStageSms({
      id: order.id,
      reference: order.reference ?? null,
      orderKind: order.order_kind ?? null,
      garmentType: order.garment_type ?? null,
      itemTitle: order.item_title ?? null,
      itemSize: order.item_size ?? null,
      deliveryMethod: order.delivery_method ?? null,
      fulfillmentProvider: order.fulfillment_provider ?? null,
      carrier: carrier ?? order.carrier ?? null,
    }, 'DELIVERED') : null
    if (customerSms) {
      await enqueueSmsJob(supabase, {
        userId: order.customer_id.toString(),
        audience: 'CUSTOMER',
        orderId: order.id,
        event: 'order.stage_delivered',
        body: customerSms,
        fallbackPhone: order.recipient_phone ?? null,
        source: FN,
        idempotencyKey: `dispatch:${providerEventId}:customer:sms`,
        priority: 15,
      })
    }
    if (eventType === 'DELIVERED' || eventType === 'OUT_FOR_DELIVERY') {
      await enqueueOrderEventEmailJob(supabase, {
        order: { ...order, id: order.id },
        recipientUserId: order.customer_id.toString(),
        audience: 'CUSTOMER',
        subject: eventType === 'DELIVERED' ? 'Your Drapeon order was delivered' : 'Your Drapeon delivery is on the way',
        headline: notificationTitle,
        body: `${notificationBody} Tracking: ${trackingNumber}.`,
        ctaLabel: 'View delivery',
        action: 'DISPATCH_UPDATE',
        source: FN,
        idempotencyKey: `dispatch:${providerEventId}:customer:email`,
        priority: 18,
      })
    }
  }

  if (order.tailor_id) {
    await enqueuePushJob(supabase, {
      userId: order.tailor_id.toString(),
      source: FN,
      orderId: order.id,
      idempotencyKey: `dispatch:${providerEventId}:tailor:push`,
      priority: 20,
      notification: {
        title: eventType === 'DELIVERED' ? 'Order delivered' : 'Delivery updated',
        body: eventType === 'DELIVERED' ? 'The provider confirmed that the customer received this order.' : customerNote,
        preferenceKey: 'newOrders',
        data: { orderId: order.id },
      },
    })
    const tailorSms = eventType === 'DELIVERED' ? buildTailorStageSms({
      id: order.id,
      reference: order.reference ?? null,
      orderKind: order.order_kind ?? null,
      garmentType: order.garment_type ?? null,
      itemTitle: order.item_title ?? null,
      itemSize: order.item_size ?? null,
      deliveryMethod: order.delivery_method ?? null,
      fulfillmentProvider: order.fulfillment_provider ?? null,
      carrier: carrier ?? order.carrier ?? null,
    }, 'DELIVERED') : null
    if (tailorSms) {
      await enqueueSmsJob(supabase, {
        userId: order.tailor_id.toString(),
        audience: 'TAILOR',
        orderId: order.id,
        event: 'order.stage_delivered',
        body: tailorSms,
        source: FN,
        idempotencyKey: `dispatch:${providerEventId}:tailor:sms`,
        priority: 20,
      })
    }
    if (eventType === 'DELIVERED' || eventType === 'OUT_FOR_DELIVERY') {
      await enqueueOrderEventEmailJob(supabase, {
        order: { ...order, id: order.id },
        recipientUserId: order.tailor_id.toString(),
        audience: 'TAILOR',
        subject: eventType === 'DELIVERED' ? 'The Drapeon order was delivered' : 'The Drapeon order is out for delivery',
        headline: eventType === 'DELIVERED' ? 'Delivery confirmed' : 'The parcel is on the way',
        body: eventType === 'DELIVERED'
          ? `The provider confirmed that the customer received this order. Tracking: ${trackingNumber}.`
          : `The provider has the parcel out for delivery. Tracking: ${trackingNumber}.`,
        ctaLabel: 'View delivery',
        action: 'DISPATCH_UPDATE',
        source: FN,
        idempotencyKey: `dispatch:${providerEventId}:tailor:email`,
        priority: 20,
      })
    }
  }

  log('info', FN, 'delivery.confirmed', {
    provider,
    order_id: order.id,
    reference: order.reference,
    tracking_number: trackingNumber,
    carrier: carrier ?? order.carrier ?? null,
  })
  await auditDeliveryWebhookEvent(supabase, `shipping.${eventType.toLowerCase()}`, 'info', {
    provider,
    reference: order.reference,
    tracking_number: trackingNumber,
    carrier: carrier ?? order.carrier ?? null,
  }, order.id)

  return new Response(JSON.stringify({
    ok: true,
    orderId: order.id,
    eventType,
    fulfillmentEventId: (dispatchResult as { eventId?: string } | null)?.eventId ?? null,
    runId: (dispatchResult as { runId?: string } | null)?.runId ?? null,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
