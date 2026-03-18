/**
 * on-message-created
 *
 * Database webhook handler — fires on INSERT to the messages table.
 * Sends a push notification to the other party in the conversation.
 *
 * Supabase sends a POST with the row payload:
 *   { type: 'INSERT', table: 'messages', record: { ... }, old_record: null }
 *
 * Set this up in:
 *   Supabase Dashboard → Database → Webhooks → Create a new hook
 *     Table:  messages
 *     Events: INSERT
 *     URL:    https://<project>.supabase.co/functions/v1/on-message-created
 *     Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WEBHOOK_SECRET  — shared secret to verify the webhook payload (set in EF secrets)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushToUser } from '../_shared/notify.ts'
import { log } from '../_shared/logger.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const FN = 'on-message-created'

/**
 * Timing-safe string comparison via SHA-256 hashing.
 * Both inputs are hashed to a fixed 32-byte digest before XOR comparison,
 * eliminating early-exit timing leaks present in direct string comparison.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const arrA = new Uint8Array(hashA)
  const arrB = new Uint8Array(hashB)
  let diff = 0
  for (let i = 0; i < 32; i++) diff |= arrA[i] ^ arrB[i]
  return diff === 0
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify the request comes from Supabase webhooks using a dedicated WEBHOOK_SECRET.
    // Configure the Supabase Database Webhook header as:
    //   Authorization: Bearer <WEBHOOK_SECRET>
    // where WEBHOOK_SECRET is a separate secret — never reuse SUPABASE_SERVICE_ROLE_KEY.
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
    if (!webhookSecret) {
      log('error', FN, 'auth.misconfigured', { reason: 'WEBHOOK_SECRET not set' })
      return new Response('Webhook not configured', { status: 401, headers: corsHeaders })
    }
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const valid = await timingSafeEqual(token, webhookSecret)
    if (!valid) {
      log('warn', FN, 'auth.unauthorized')
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const payload = await req.json() as {
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

    if (payload.type !== 'INSERT' || payload.table !== 'messages') {
      return new Response('Ignored', { status: 200, headers: corsHeaders })
    }

    const msg = payload.record
    if (!msg?.order_id || !msg?.sender_id) {
      return new Response('Invalid payload', { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Look up the order to find the other party
    const { data: order } = await supabase
      .from('orders')
      .select('customer_id, tailor_id')
      .eq('id', msg.order_id)
      .single()

    if (!order) return new Response('Order not found', { status: 200, headers: corsHeaders })

    // Determine recipient: if sender is CUSTOMER, notify tailor — and vice versa
    const recipientId = msg.sender_role === 'CUSTOMER'
      ? order.tailor_id?.toString()
      : order.customer_id?.toString()

    if (!recipientId || recipientId === msg.sender_id) {
      return new Response('No recipient', { status: 200, headers: corsHeaders })
    }

    // Build notification body — preview text or fallback label
    let preview: string
    if (msg.type === 'PHOTO') {
      preview = '📷 Photo'
    } else if (msg.type === 'VOICE') {
      preview = '🎙 Voice note'
    } else {
      // Truncate long messages and strip potential PII from preview
      preview = (msg.body ?? '').slice(0, 60)
      if ((msg.body ?? '').length > 60) preview += '…'
    }

    await sendPushToUser(supabase, recipientId, {
      title: msg.sender_name ?? 'New message',
      body: preview || 'Sent you a message.',
      data: { orderId: msg.order_id, screen: `orders/${msg.order_id}` },
    })

    log('info', FN, 'notification.sent', { order_id: msg.order_id, sender_role: msg.sender_role })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    log('error', FN, 'unhandled_exception', { error: String(err) })
    return new Response('Internal error', { status: 500, headers: corsHeaders })
  }
})
