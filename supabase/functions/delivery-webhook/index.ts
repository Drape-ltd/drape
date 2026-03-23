/**
 * delivery-webhook
 *
 * Unified webhook handler for Shippo and Topship delivery tracking events.
 * Receives carrier status updates and automatically advances order stage to
 * DELIVERED when a delivery-confirmed event arrives.
 *
 * Configure in each provider's dashboard:
 *   Shippo:  Webhooks → Events: tracking_updated
 *   Topship: Webhooks → Events: shipment.delivered / shipment.out_for_delivery
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SHIPPO_WEBHOOK_SECRET   – HMAC secret from Shippo dashboard (optional but recommended)
 *   TOPSHIP_WEBHOOK_SECRET  – HMAC secret from Topship dashboard (optional but recommended)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { sendPushToUser } from '../_shared/notify.ts'

/**
 * Timing-safe HMAC-SHA256 verification using the Web Crypto API.
 * incomingHex may be prefixed with "sha256=" or "v1=" — both are stripped.
 */
async function verifyHmacSha256(secret: string, incomingHex: string, payload: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const msgData = encoder.encode(payload)

  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
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

type Provider = 'shippo' | 'topship' | 'unknown'

function detectProvider(req: Request): Provider {
  const ua = req.headers.get('user-agent') ?? ''
  const sig = req.headers.get('x-shippo-signature') ?? req.headers.get('shippo-webhook-signature') ?? ''
  const topshipSig = req.headers.get('x-topship-signature') ?? ''

  if (sig) return 'shippo'
  if (topshipSig) return 'topship'
  if (ua.toLowerCase().includes('shippo')) return 'shippo'
  if (ua.toLowerCase().includes('topship')) return 'topship'
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

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
  } else {
    // Try both parsers as a fallback
    const fromShippo = parseShippo(body)
    const fromTopship = parseTopship(body)
    trackingNumber = fromShippo.trackingNumber ?? fromTopship.trackingNumber
    carrier = fromShippo.carrier ?? fromTopship.carrier
    isDelivered = fromShippo.isDelivered || fromTopship.isDelivered
  }

  if (!trackingNumber) {
    console.log('[delivery-webhook] No tracking number found in payload')
    return new Response(JSON.stringify({ ok: true, skipped: 'no_tracking_number' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!isDelivered) {
    console.log(`[delivery-webhook] Non-delivery event for ${trackingNumber} — ignoring`)
    return new Response(JSON.stringify({ ok: true, skipped: 'not_delivered' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Find the matching order
  const { data: order } = await supabase
    .from('orders')
    .select('id, stage, reference, customer_id, tailor_id')
    .eq('tracking_number', trackingNumber)
    .single()

  if (!order) {
    console.log(`[delivery-webhook] No order found for tracking number ${trackingNumber}`)
    return new Response(JSON.stringify({ ok: true, skipped: 'no_order' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Only advance if currently SHIPPED (avoid double-processing)
  if (order.stage !== 'SHIPPED') {
    console.log(`[delivery-webhook] Order ${order.reference} is already in stage ${order.stage} — skipping`)
    return new Response(JSON.stringify({ ok: true, skipped: 'wrong_stage', stage: order.stage }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Advance to DELIVERED
  const { error: updateError } = await supabase
    .from('orders')
    .update({ stage: 'DELIVERED' })
    .eq('id', order.id)

  if (updateError) {
    console.error('[delivery-webhook] Failed to update order stage:', updateError)
    return new Response('DB update failed', { status: 500 })
  }

  // Insert a stage update record for the timeline
  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'DELIVERED',
    note: `Automatically confirmed as delivered by ${carrier ?? provider} tracking (${trackingNumber}).`,
  })

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id.toString(), {
        title: 'Delivered ✅',
        body: 'Your carrier marked this order as delivered.',
        data: { orderId: order.id },
      })
    )
  }

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id.toString(), {
        title: 'Order delivered 📦',
        body: 'Tracking confirmed that the customer received this order.',
        data: { orderId: order.id },
      })
    )
  }

  console.log(`[delivery-webhook] Order ${order.reference} advanced to DELIVERED via ${trackingNumber}`)

  return new Response(JSON.stringify({ ok: true, orderId: order.id, stage: 'DELIVERED' }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
