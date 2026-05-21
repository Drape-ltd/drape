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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
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

// Topship event types that mean "delivered"
const TOPSHIP_DELIVERED_EVENTS = new Set([
  'shipment.delivered',
  'DELIVERED',
  'delivery_confirmed',
])

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
function parseShippo(body: any): { trackingNumber: string | null; carrier: string | null; isDelivered: boolean } {
  const data = body?.data ?? body
  const trackingNumber: string | null = data?.tracking_number ?? data?.tracking?.tracking_number ?? null
  const carrier: string | null = data?.carrier ?? data?.tracking?.carrier ?? null
  const status: string = data?.tracking_status?.status ?? data?.status ?? ''
  return {
    trackingNumber: trackingNumber?.toUpperCase() ?? null,
    carrier,
    isDelivered: SHIPPO_DELIVERED_STATUSES.has(status.toUpperCase()),
  }
}

/** Parse a Topship webhook payload. Returns tracking number and whether delivered. */
function parseTopship(body: any): { trackingNumber: string | null; carrier: string | null; isDelivered: boolean } {
  const event: string = body?.event ?? body?.type ?? ''
  const data = body?.data ?? body
  const trackingNumber: string | null = data?.tracking_number ?? data?.trackingId ?? data?.tracking_id ?? null
  const carrier: string | null = data?.carrier ?? data?.courier ?? null
  return {
    trackingNumber: trackingNumber?.toUpperCase() ?? null,
    carrier,
    isDelivered: TOPSHIP_DELIVERED_EVENTS.has(event),
  }
}

/** Parse a Shipbubble webhook payload. */
function parseShipbubble(body: any): { trackingNumber: string | null; carrier: string | null; isDelivered: boolean } {
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
  }
}

async function auditDeliveryWebhookEvent(
  supabase: any,
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

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
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

  // Read raw body first — needed for HMAC verification before JSON parsing
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return new Response('Could not read body', { status: 400 })
  }

  // ── HMAC signature verification ──────────────────────────────────────────
  // When a webhook secret is configured, reject requests that fail verification.
  // This is the primary defence against spoofed delivery events.
  const provider = detectProvider(req)

  if (provider === 'shippo' || provider === 'unknown') {
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

  if (provider === 'topship' || provider === 'unknown') {
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

  if (provider === 'shipbubble') {
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

  let trackingNumber: string | null = null
  let carrier: string | null = null
  let isDelivered = false

  if (provider === 'shippo') {
    ;({ trackingNumber, carrier, isDelivered } = parseShippo(body))
  } else if (provider === 'topship') {
    ;({ trackingNumber, carrier, isDelivered } = parseTopship(body))
  } else if (provider === 'shipbubble') {
    ;({ trackingNumber, carrier, isDelivered } = parseShipbubble(body))
  } else {
    // Try both parsers as a fallback
    const fromShippo = parseShippo(body)
    const fromTopship = parseTopship(body)
    const fromShipbubble = parseShipbubble(body)
    trackingNumber = fromShippo.trackingNumber ?? fromTopship.trackingNumber ?? fromShipbubble.trackingNumber
    carrier = fromShippo.carrier ?? fromTopship.carrier ?? fromShipbubble.carrier
    isDelivered = fromShippo.isDelivered || fromTopship.isDelivered || fromShipbubble.isDelivered
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

  if (!isDelivered) {
    log('info', FN, 'webhook.skipped', {
      provider,
      reason: 'not_delivered',
      tracking_number: trackingNumber,
      carrier,
    })
    await auditDeliveryWebhookEvent(supabase, 'shipping.webhook_skipped', 'info', {
      provider,
      reason: 'not_delivered',
      tracking_number: trackingNumber,
      carrier,
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'not_delivered' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Find the matching order
  const { data: order } = await supabase
    .from('orders')
    .select('id, stage, reference, order_kind, garment_type, item_title, item_size, delivery_method, recipient_phone, fulfillment_provider, customer_id, tailor_id, carrier')
    .eq('tracking_number', trackingNumber)
    .single()

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

  // Only advance if currently SHIPPED (avoid double-processing)
  if (order.stage !== 'SHIPPED') {
    log('info', FN, 'delivery.skipped_wrong_stage', {
      provider,
      order_id: order.id,
      reference: order.reference,
      tracking_number: trackingNumber,
      stage: order.stage,
    })
    await auditDeliveryWebhookEvent(supabase, 'shipping.delivery_skipped_wrong_stage', 'info', {
      provider,
      reference: order.reference,
      tracking_number: trackingNumber,
      carrier,
      stage: order.stage,
    }, order.id)
    return new Response(JSON.stringify({ ok: true, skipped: 'wrong_stage', stage: order.stage }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Advance to DELIVERED
  const updates: Record<string, unknown> = {
    stage: 'DELIVERED',
    stage_updated_at: new Date().toISOString(),
    handoff_completed_at: new Date().toISOString(),
    handoff_confirmation_source: 'CARRIER_WEBHOOK',
  }
  if (!order.carrier && carrier) {
    updates.carrier = carrier
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', order.id)

  if (updateError) {
    log('error', FN, 'delivery.update_failed', {
      provider,
      order_id: order.id,
      reference: order.reference,
      tracking_number: trackingNumber,
      error: updateError.message,
    })
    await auditDeliveryWebhookEvent(supabase, 'shipping.delivery_update_failed', 'error', {
      provider,
      reference: order.reference,
      tracking_number: trackingNumber,
      carrier,
      error: updateError.message,
    }, order.id)
    return new Response('DB update failed', { status: 500 })
  }

  // Insert a stage update record for the timeline
  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'DELIVERED',
    note: `Automatically confirmed as delivered by ${carrier ?? provider} tracking (${trackingNumber}).`,
  })

  if (order.customer_id) {
    await enqueuePushJob(supabase, {
      userId: order.customer_id.toString(),
      source: FN,
      orderId: order.id,
      idempotencyKey: `delivery-confirmed:${order.id}:customer:push`,
      priority: 15,
      notification: {
        title: 'Delivered ✅',
        body: 'Your carrier marked this order as delivered.',
        preferenceKey: 'orderUpdates',
        data: { orderId: order.id },
      },
    })
    const customerSms = buildCustomerStageSms({
      id: order.id,
      reference: order.reference ?? null,
      orderKind: order.order_kind ?? null,
      garmentType: order.garment_type ?? null,
      itemTitle: order.item_title ?? null,
      itemSize: order.item_size ?? null,
      deliveryMethod: order.delivery_method ?? null,
      fulfillmentProvider: order.fulfillment_provider ?? null,
      carrier: carrier ?? order.carrier ?? null,
    }, 'DELIVERED')
    if (customerSms) {
      await enqueueSmsJob(supabase, {
        userId: order.customer_id.toString(),
        audience: 'CUSTOMER',
        orderId: order.id,
        event: 'order.stage_delivered',
        body: customerSms,
        fallbackPhone: order.recipient_phone ?? null,
        source: FN,
        idempotencyKey: `delivery-confirmed:${order.id}:customer:sms`,
        priority: 15,
      })
    }
  }

  if (order.tailor_id) {
    await enqueuePushJob(supabase, {
      userId: order.tailor_id.toString(),
      source: FN,
      orderId: order.id,
      idempotencyKey: `delivery-confirmed:${order.id}:tailor:push`,
      priority: 20,
      notification: {
        title: 'Order delivered 📦',
        body: 'Tracking confirmed that the customer received this order.',
        preferenceKey: 'newOrders',
        data: { orderId: order.id },
      },
    })
    const tailorSms = buildTailorStageSms({
      id: order.id,
      reference: order.reference ?? null,
      orderKind: order.order_kind ?? null,
      garmentType: order.garment_type ?? null,
      itemTitle: order.item_title ?? null,
      itemSize: order.item_size ?? null,
      deliveryMethod: order.delivery_method ?? null,
      fulfillmentProvider: order.fulfillment_provider ?? null,
      carrier: carrier ?? order.carrier ?? null,
    }, 'DELIVERED')
    if (tailorSms) {
      await enqueueSmsJob(supabase, {
        userId: order.tailor_id.toString(),
        audience: 'TAILOR',
        orderId: order.id,
        event: 'order.stage_delivered',
        body: tailorSms,
        source: FN,
        idempotencyKey: `delivery-confirmed:${order.id}:tailor:sms`,
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
  await auditDeliveryWebhookEvent(supabase, 'shipping.delivered', 'info', {
    provider,
    reference: order.reference,
    tracking_number: trackingNumber,
    carrier: carrier ?? order.carrier ?? null,
  }, order.id)

  return new Response(JSON.stringify({ ok: true, orderId: order.id, stage: 'DELIVERED' }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
