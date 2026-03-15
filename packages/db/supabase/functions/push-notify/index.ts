/**
 * Drape — push-notify Edge Function
 *
 * Called by Supabase Database Webhooks on:
 *   - orders table  INSERT / UPDATE
 *   - messages table INSERT
 *
 * Sends an Expo push notification to the relevant user(s).
 * Reads push tokens from the push_tokens table (service role).
 *
 * Deploy:
 *   supabase functions deploy push-notify --project-ref <ref>
 *
 * Set secret:
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key> --project-ref <ref>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ─── Stage → human-readable push copy ────────────────────────────────────────

const STAGE_COPY: Record<string, { title: string; body: (ref: string) => string }> = {
  QUOTE_SENT: {
    title: 'Quote received',
    body: (ref) => `Your tailor has sent a quote for order #${ref}. Tap to review.`,
  },
  CONFIRMED: {
    title: 'Order confirmed',
    body: (ref) => `Order #${ref} is confirmed. Your tailor will start soon.`,
  },
  CUTTING: {
    title: 'Cutting started',
    body: (ref) => `Order #${ref} — fabric is being cut.`,
  },
  SEWING: {
    title: 'Sewing in progress',
    body: (ref) => `Order #${ref} — your garment is being sewn.`,
  },
  FINISHING: {
    title: 'Finishing touches',
    body: (ref) => `Order #${ref} — final finishing underway.`,
  },
  SHIPPED: {
    title: 'Order shipped',
    body: (ref) => `Order #${ref} has been shipped. Check tracking details.`,
  },
  READY_FOR_COLLECTION: {
    title: 'Ready for collection',
    body: (ref) => `Order #${ref} is ready. Show your 4-digit code to collect.`,
  },
  DECLINED: {
    title: 'Brief declined',
    body: (ref) => `Your brief #${ref} was declined. Try another tailor.`,
  },
  IN_DISPUTE: {
    title: 'Dispute opened',
    body: (ref) => `A dispute has been opened on order #${ref}.`,
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getToken(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .single()
  return data?.token ?? null
}

async function send(token: string, title: string, body: string, data: Record<string, string>) {
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    const { table, type, record, old_record } = payload

    // ── New message ──────────────────────────────────────────────────────────
    if (table === 'messages' && type === 'INSERT') {
      const msg = record
      // Fetch order to find recipient
      const { data: order } = await supabase
        .from('orders')
        .select('customer_id, tailor_id, reference')
        .eq('id', msg.order_id)
        .single()

      if (!order) return new Response('ok')

      const recipientId = msg.sender_role === 'CUSTOMER'
        ? order.tailor_id
        : order.customer_id

      const token = await getToken(recipientId)
      if (token) {
        const senderLabel = msg.sender_name ?? (msg.sender_role === 'CUSTOMER' ? 'Customer' : 'Tailor')
        await send(
          token,
          `New message — ${senderLabel}`,
          msg.type === 'TEXT'
            ? (msg.body ?? 'Sent you a message')
            : msg.type === 'PHOTO' ? 'Sent a photo' : 'Sent a voice note',
          { orderId: msg.order_id, screen: `orders/${msg.order_id}` },
        )
      }
      return new Response('ok')
    }

    // ── Order INSERT — new brief, notify tailor ──────────────────────────────
    if (table === 'orders' && type === 'INSERT') {
      const order = record
      const token = await getToken(order.tailor_id)
      if (token) {
        await send(
          token,
          'New brief received',
          `A customer sent you a brief for a ${order.garment_type ?? 'garment'}. Tap to review.`,
          { orderId: order.id },
        )
      }
      return new Response('ok')
    }

    // ── Order UPDATE — stage changed ─────────────────────────────────────────
    if (table === 'orders' && type === 'UPDATE') {
      const order = record
      const prevStage = old_record?.stage
      const newStage = order.stage

      if (newStage === prevStage) return new Response('ok')

      const copy = STAGE_COPY[newStage]
      if (!copy) return new Response('ok')

      // Stages that notify the customer
      const customerStages = new Set([
        'QUOTE_SENT', 'CONFIRMED', 'CUTTING', 'SEWING',
        'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION', 'DECLINED',
      ])
      // Stages that notify the tailor
      const tailorStages = new Set(['IN_DISPUTE'])

      const recipientId = customerStages.has(newStage)
        ? order.customer_id
        : tailorStages.has(newStage)
          ? order.tailor_id
          : null

      if (!recipientId) return new Response('ok')

      const token = await getToken(recipientId)
      if (token) {
        await send(
          token,
          copy.title,
          copy.body(order.reference ?? order.id.slice(0, 6).toUpperCase()),
          { orderId: order.id },
        )
      }
      return new Response('ok')
    }

    return new Response('ok')
  } catch (err) {
    console.error('push-notify error:', err)
    return new Response('error', { status: 500 })
  }
})
