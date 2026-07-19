/**
 * on-message-created
 *
 * Database webhook handler — fires on INSERT to the messages table.
 * Sends a push notification to the other party in the conversation.
 *
 * Supabase sends a POST with the row payload:
 *   { type: 'INSERT', table: 'messages', record: { ... }, old_record: null }
 *
 * Any sender calling this function must sign the exact raw request body:
 *   x-drape-signature: sha256=<HMAC_SHA256(raw_body, WEBHOOK_SECRET)>
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WEBHOOK_SECRET  — shared secret to verify the webhook payload (set in EF secrets)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { log } from '../_shared/logger.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { verifyPayload } from '../_shared/hmac.ts'
import { enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'

const FN = 'on-message-created'

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function normalizeWebhookSignature(value: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const firstValue = trimmed.split(',').at(0)?.trim() ?? ''
  const hex = firstValue.toLowerCase().startsWith('sha256=')
    ? firstValue.slice('sha256='.length)
    : firstValue
  return /^[a-f0-9]{64}$/i.test(hex) ? hex : null
}

function readWebhookSignature(req: Request): string | null {
  return normalizeWebhookSignature(req.headers.get('x-drape-signature')) ??
    normalizeWebhookSignature(req.headers.get('x-webhook-signature')) ??
    normalizeWebhookSignature(req.headers.get('x-supabase-signature')) ??
    normalizeWebhookSignature(req.headers.get('x-hub-signature-256'))
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const rawBody = await req.text()

    // Verify the request comes from Supabase webhooks using HMAC-SHA256 over
    // the exact raw request body. WEBHOOK_SECRET must be a dedicated secret.
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
    if (!webhookSecret) {
      log('error', FN, 'auth.misconfigured', { reason: 'WEBHOOK_SECRET not set' })
      return jsonResponse({ error: 'Webhook is not configured.' }, 401, corsHeaders)
    }
    const signature = readWebhookSignature(req)
    const valid = signature ? await verifyPayload(webhookSecret, rawBody, signature) : false
    if (!valid) {
      log('warn', FN, 'auth.unauthorized')
      return jsonResponse({ error: 'This webhook request is not authorized.' }, 401, corsHeaders)
    }

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

    let payload: {
      type: string
      table: string
      record: {
        id: string
        order_id: string
        sender_id: string
        sender_role: 'CUSTOMER' | 'TAILOR'
        sender_name: string
        type: 'TEXT' | 'PHOTO' | 'VOICE'
        body: string | null
      }
    }
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return jsonResponse({ error: 'Webhook payload is not valid JSON.' }, 400, corsHeaders)
    }

    if (payload.type !== 'INSERT' || payload.table !== 'messages') {
      return jsonResponse({ ok: true, ignored: true }, 200, corsHeaders)
    }

    const msg = payload.record
    if (!msg?.order_id || !msg?.sender_id) {
      return jsonResponse({ error: 'Message webhook payload is missing required fields.' }, 400, corsHeaders)
    }

    // Look up the order to find the other party
    const { data: order } = await supabase
      .from('orders')
      .select('customer_id, tailor_id')
      .eq('id', msg.order_id)
      .single()

    if (!order) return jsonResponse({ ok: true, ignored: true, reason: 'ORDER_NOT_FOUND' }, 200, corsHeaders)

    // Determine recipient: if sender is CUSTOMER, notify tailor — and vice versa
    const recipientId = msg.sender_role === 'CUSTOMER'
      ? order.tailor_id?.toString()
      : order.customer_id?.toString()

    if (!recipientId || recipientId === msg.sender_id) {
      return jsonResponse({ ok: true, ignored: true, reason: 'NO_RECIPIENT' }, 200, corsHeaders)
    }

    // Build notification body — preview text or fallback label
    let preview: string
    if (msg.type === 'PHOTO') {
      preview = 'Sent a photo'
    } else if (msg.type === 'VOICE') {
      preview = 'Sent a voice note'
    } else {
      // Truncate long messages and strip potential PII from preview
      preview = (msg.body ?? '').slice(0, 60)
      if ((msg.body ?? '').length > 60) preview += '…'
    }

    const notification = {
      title: msg.sender_name ?? 'New message',
      body: preview || 'Sent you a message.',
      preferenceKey: 'messages' as const,
      channelId: 'default',
      sound: 'default',
      data: {
        orderId: msg.order_id,
        target: 'messages',
        destination: 'messages',
        messageId: msg.id,
      },
    }
    await enqueuePushJob(supabase, {
      userId: recipientId,
      source: FN,
      orderId: msg.order_id,
      idempotencyKey: `message-created:${msg.id}`,
      priority: 20,
      notification,
    })

    log('info', FN, 'notification.queued', { order_id: msg.order_id, sender_role: msg.sender_role })

    return jsonResponse({ ok: true }, 200, corsHeaders)

  } catch (err) {
    log('error', FN, 'unhandled_exception', { error: String(err) })
    return jsonResponse({ error: 'Message notification could not be processed right now.' }, 500, corsHeaders)
  }
})
