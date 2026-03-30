/**
 * customer-order-action
 *
 * Handles all customer-initiated order stage transitions.
 * Stage column is locked at DB level — only service role (this function) may mutate it.
 *
 * Actions:
 *   confirm-receipt  SHIPPED → DELIVERED
 *   open-dispute     CONFIRMED|DESIGNING|SOURCING|CUTTING|SEWING|FINISHING|SHIPPED|READY_FOR_COLLECTION → IN_DISPUTE
 *   accept-quote     QUOTE_SENT → CONFIRMED  (payment gateway plugs in here later)
 *   decline-quote    QUOTE_SENT → DECLINED
 *   complete-order   DELIVERED|COLLECTED → COMPLETE
 *   collect-order    READY_FOR_COLLECTION → COLLECTED  (customer enters 4-digit code)
 *                    NOTE: collect-order is currently dead from the UI. The active
 *                    collection path is tailor-order-action/confirm-collection, which
 *                    the tailor initiates by entering the code the customer shows them.
 *                    This action is retained for future customer-side code entry flow.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { z, parseBody, uuid, optionalNote } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'

const BodySchema = z.object({
  orderId:     uuid,
  action:      z.enum(['confirm-receipt', 'open-dispute', 'accept-quote', 'decline-quote', 'complete-order', 'collect-order', 'save-fabric-tracking']),
  reason:      z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(10).max(1000).optional(),
  // collect-order only — 4-digit numeric collection code
  code:        z.string().regex(/^\d{4}$/, 'Must be a 4-digit code').optional(),
  fabricTracking: z.string().trim().min(1).max(120).optional(),
})

const FN = 'customer-order-action'

type Action = 'confirm-receipt' | 'open-dispute' | 'accept-quote' | 'decline-quote' | 'complete-order' | 'collect-order' | 'save-fabric-tracking'

// Which stages each action is valid FROM
const VALID_FROM: Record<Action, string[]> = {
  'confirm-receipt': ['SHIPPED'],
  'open-dispute':    ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION'],
  'accept-quote':    ['QUOTE_SENT'],
  'decline-quote':   ['QUOTE_SENT'],
  'complete-order':  ['DELIVERED', 'COLLECTED'],
  'collect-order':   ['READY_FOR_COLLECTION'],
  'save-fabric-tracking': ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'],
}

const MAX_CODE_ATTEMPTS = 5

// The stage each action transitions TO (dispute handled separately)
const NEXT_STAGE: Partial<Record<Action, string>> = {
  'confirm-receipt': 'DELIVERED',
  'accept-quote':    'CONFIRMED',
  'decline-quote':   'DECLINED',
  'complete-order':  'COMPLETE',
}

// Push notification sent to the TAILOR after each customer action
const TAILOR_NOTIFICATION: Partial<Record<Action, { title: string; body: string }>> = {
  'confirm-receipt': { title: 'Delivery confirmed 📦',  body: 'The customer confirmed receipt of their order.' },
  'accept-quote':    { title: 'Quote accepted ✅',       body: 'Your quote was accepted. Time to get started!' },
  'decline-quote':   { title: 'Quote declined',          body: 'The customer declined your quote.' },
  'open-dispute':    { title: 'Concern raised ⚠️',       body: 'A customer raised a concern about their order.' },
  'complete-order':  { title: 'Order complete ⭐',       body: 'The customer marked the order complete!' },
}

const STAGE_NOTE: Partial<Record<Action, string>> = {
  'confirm-receipt': 'Customer confirmed receipt of their order.',
  'accept-quote':    'Customer accepted the quote.',
  'decline-quote':   'Customer declined the quote.',
  'complete-order':  'Order marked complete.',
  'collect-order':   'Customer collected the order in person.',
}

function hasBlockedContact(text: string) {
  return /(https?:\/\/|www\.|instagram|whatsapp|telegram|@\w+|\+?\d[\d\s().-]{6,}\d)/i.test(text)
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Verify caller is authenticated
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const parsed = parseBody(BodySchema, await req.json())
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return new Response(parsed.error, { status: 400, headers: cors })
    }

    const { orderId, action, reason, description, fabricTracking } = parsed.data

    const supabase = createClient(
      getSupabaseUrl(),
      getServiceRoleKey(),
    )

    // Rate limit: 20 actions per hour per customer
    const allowed = await checkRateLimit(supabase, `customer-order-action:${caller.id}`, 3600, 20)
    if (!allowed) {
      log('warn', FN, 'rate_limit.exceeded', { actor_id: caller.id })
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    // Only collect-order needs the collection code fields.
    const orderSelect = action === 'collect-order'
      ? 'id, stage, customer_id, tailor_id, collection_code, collection_code_attempts'
      : 'id, stage, customer_id, tailor_id'

    // Fetch order — verify ownership and current stage
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(orderSelect)
      .eq('id', orderId)
      .single()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: orderError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (!order) return new Response('Order not found', { status: 404, headers: cors })

    // Verify caller is the customer on this order
    if (order.customer_id?.toString() !== caller.id) {
      log('warn', FN, 'auth.forbidden', { actor_id: caller.id, order_id: orderId, action })
      await audit(supabase, {
        event: 'auth.forbidden',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        severity: 'warn',
        payload: { function: FN, action },
      })
      return new Response('Forbidden', { status: 403, headers: cors })
    }

    // Verify the current stage allows this transition
    if (!VALID_FROM[action].includes(order.stage)) {
      log('warn', FN, 'order.invalid_transition', { actor_id: caller.id, order_id: orderId, action, from_stage: order.stage })
      return new Response(
        JSON.stringify({ error: `Cannot ${action} from stage ${order.stage}` }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    // ── collect-order ─────────────────────────────────────────────────────────
    // Customer presents the 4-digit code at pickup.
    // Locked after MAX_CODE_ATTEMPTS wrong guesses.
    if (action === 'collect-order') {
      const { code } = parsed.data
      if (!code) return new Response('code is required', { status: 400, headers: cors })

      // Tight rate limit: 10 code attempts per hour per customer (separate bucket)
      const codeAllowed = await checkRateLimit(supabase, `collect-order-code:${caller.id}`, 3600, 10)
      if (!codeAllowed) {
        await audit(supabase, {
          event: 'collection_code.rate_limited',
          actor_id: caller.id,
          actor_role: 'CUSTOMER',
          order_id: orderId,
          severity: 'warn',
          payload: { function: FN },
        })
        return new Response('Too many attempts. Please try again later.', { status: 429, headers: cors })
      }

      // Per-order lock — blocks even if rate limit not yet hit
      const attempts = order.collection_code_attempts ?? 0
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await audit(supabase, {
          event: 'collection_code.order_locked',
          actor_id: caller.id,
          actor_role: 'CUSTOMER',
          order_id: orderId,
          severity: 'warn',
          payload: { attempts },
        })
        return new Response(
          JSON.stringify({ error: 'Too many incorrect attempts. Contact support to unlock collection.' }),
          { status: 423, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (code !== order.collection_code) {
        // Wrong code — increment attempt counter
        await supabase
          .from('orders')
          .update({ collection_code_attempts: attempts + 1 })
          .eq('id', orderId)

        await audit(supabase, {
          event: 'collection_code.wrong',
          actor_id: caller.id,
          actor_role: 'CUSTOMER',
          order_id: orderId,
          severity: 'warn',
          payload: { attempt_number: attempts + 1, remaining: MAX_CODE_ATTEMPTS - attempts - 1 },
        })

        log('warn', FN, 'collection_code.wrong', { actor_id: caller.id, order_id: orderId, attempt: attempts + 1 })
        return new Response(
          JSON.stringify({ error: 'Incorrect code.', remaining: MAX_CODE_ATTEMPTS - attempts - 1 }),
          { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      // Correct — transition to COLLECTED and reset attempts
      const { error } = await supabase
        .from('orders')
        .update({ stage: 'COLLECTED', collection_code_attempts: 0 })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'COLLECTED',
        note: STAGE_NOTE['collect-order'] ?? null,
      })

      await audit(supabase, {
        event: 'order.stage_changed',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: { action, from_stage: order.stage, to_stage: 'COLLECTED' },
      })

      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, from_stage: order.stage, to_stage: 'COLLECTED' })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            title: 'Order collected ✅',
            body: 'The customer collected their order in person.',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'save-fabric-tracking') {
      const value = fabricTracking?.trim() ?? ''
      if (!value) return new Response('fabricTracking is required', { status: 400, headers: cors })
      if (hasBlockedContact(value)) {
        return new Response("Contact details can't be included in tracking numbers.", { status: 400, headers: cors })
      }

      const { error } = await supabase
        .from('orders')
        .update({ fabric_tracking: value })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'order.fabric_tracking_saved',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: { length: value.length },
      })

      return new Response(JSON.stringify({ ok: true, fabricTracking: value }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'open-dispute') {
      if (!reason?.trim())      return new Response('Missing reason', { status: 400, headers: cors })
      if (!description?.trim()) return new Response('Missing description', { status: 400, headers: cors })

      const { error: stageError } = await supabase
        .from('orders')
        .update({ stage: 'IN_DISPUTE' })
        .eq('id', orderId)

      if (stageError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: stageError.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      const { error: disputeError } = await supabase.from('disputes').insert({
        order_id: orderId,
        customer_id: caller.id,
        reason: reason.trim(),
        description: description.trim(),
      })

      if (disputeError) {
        await supabase
          .from('orders')
          .update({ stage: order.stage })
          .eq('id', orderId)

        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: disputeError.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'IN_DISPUTE',
        note: `Customer raised a concern: ${reason.trim()}`,
      })

      await audit(supabase, {
        event: 'dispute.opened',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        severity: 'warn',
        payload: { reason: reason.trim(), from_stage: order.stage },
      })

      log('info', FN, 'dispute.opened', { actor_id: caller.id, order_id: orderId, reason: reason.trim() })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['open-dispute']!,
            data: { orderId },
          })
        )
      }

    } else {
      const nextStage = NEXT_STAGE[action]!

      const { error } = await supabase
        .from('orders')
        .update({ stage: nextStage })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: nextStage,
        note: STAGE_NOTE[action] ?? null,
      })

      await audit(supabase, {
        event: 'order.stage_changed',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: { action, from_stage: order.stage, to_stage: nextStage },
      })

      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, action, from_stage: order.stage, to_stage: nextStage })

      const notif = TAILOR_NOTIFICATION[action]
      if (notif && order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), { ...notif, data: { orderId } })
        )
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    log('error', FN, 'unhandled_exception', { error: String(err) })
    return new Response('Internal error', { status: 500, headers: cors })
  }
})
