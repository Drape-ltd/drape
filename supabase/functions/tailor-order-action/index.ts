/**
 * tailor-order-action
 *
 * Handles all tailor-initiated order mutations.
 * Stage column is locked at DB level — only service role (this function) may mutate it.
 *
 * Actions:
 *   send-quote            PENDING_QUOTE|CONSULTATION → QUOTE_SENT  (sets amount, currency, completion_date)
 *   decline-order         PENDING_QUOTE|CONSULTATION → DECLINED
 *   request-consultation  PENDING_QUOTE → CONSULTATION  (sets optional consultation_fee)
 *   advance-stage         CONFIRMED → DESIGNING|SOURCING|CUTTING → SEWING → FINISHING → READY_FOR_COLLECTION|SHIPPED
 *                         When advancing to READY_FOR_COLLECTION: generates collection_code server-side
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
import { z, parseBody, uuid, isoDate } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    orderId:        uuid,
    action:         z.literal('send-quote'),
    amount:         z.number().int().positive().max(100_000_00),
    currency:       z.string().trim().min(2).max(5),
    completionDate: isoDate,
    note:           z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('decline-order'),
    note:    z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId:         uuid,
    action:          z.literal('request-consultation'),
    consultationFee: z.number().int().nonnegative().max(100_000_00).nullable().optional(),
    note:            z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId:        uuid,
    action:         z.literal('advance-stage'),
    targetStage:    z.enum(['DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_COLLECTION', 'SHIPPED']),
    note:           z.string().trim().min(10).max(300),
    photoUrl:       z.string().url().optional(),
    trackingNumber: z.string().trim().max(50).optional(),
    carrier:        z.string().trim().max(50).optional(),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('confirm-collection'),
    // 4-digit code the tailor receives from the customer at pickup
    code:    z.string().regex(/^\d{4}$/, 'Must be a 4-digit numeric code'),
  }),
])

const FN = 'tailor-order-action'


type Action = 'send-quote' | 'decline-order' | 'request-consultation' | 'advance-stage' | 'confirm-collection'

// Valid source stages for each advance-stage target
const ADVANCE_VALID_FROM: Record<string, string[]> = {
  DESIGNING:            ['CONFIRMED'],
  SOURCING:             ['CONFIRMED', 'DESIGNING'],
  CUTTING:              ['CONFIRMED', 'DESIGNING', 'SOURCING'],
  SEWING:               ['CUTTING'],
  FINISHING:            ['SEWING'],
  READY_FOR_COLLECTION: ['FINISHING'],
  SHIPPED:              ['FINISHING'],
}

// Push notification sent to the CUSTOMER after each tailor action
const CUSTOMER_NOTIFICATION: Record<string, { title: string; body: string }> = {
  'send-quote':            { title: 'Quote received 💰',       body: 'Your tailor sent you a quote. Review it now.' },
  'decline-order':         { title: 'Order declined',           body: 'Your tailor was unable to accept this order.' },
  'request-consultation':  { title: 'Consultation requested',   body: 'Your tailor wants to schedule a quick consultation first.' },
  DESIGNING:               { title: 'Order update ✏️',          body: 'Your tailor is working through design details for your order.' },
  SOURCING:                { title: 'Order update 🧵',          body: 'Your tailor is sourcing materials for your order.' },
  CUTTING:                 { title: 'Order update ✂️',          body: 'Your tailor has started cutting the fabric.' },
  SEWING:                  { title: 'Order update 🧵',          body: 'Your tailor is now sewing your garment.' },
  FINISHING:               { title: 'Almost ready ✨',          body: 'Your tailor is putting the finishing touches on your order.' },
  READY_FOR_COLLECTION:    { title: 'Ready to collect! 📦',    body: 'Your order is ready. Show your collection code at pickup.' },
  SHIPPED:                 { title: 'On the way 🚚',            body: 'Your order has been shipped.' },
}

/** Cryptographically random 4-digit collection code (1000–9999). */
function generateCollectionCode(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(1000 + (arr[0] % 9000))
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
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

    const body = parsed.data
    const { orderId, action } = body

    const supabase = createClient(
      getSupabaseUrl(),
      getServiceRoleKey(),
    )

    // Rate limit: 60 actions per hour per tailor
    const allowed = await checkRateLimit(supabase, `tailor-order-action:${caller.id}`, 3600, 60)
    if (!allowed) {
      log('warn', FN, 'rate_limit.exceeded', { actor_id: caller.id })
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    // Only collection confirmation needs the collection code fields.
    const orderSelect = action === 'confirm-collection'
      ? 'id, stage, tailor_id, customer_id, collection_code, collection_code_attempts'
      : 'id, stage, tailor_id, customer_id, deadline'

    // Fetch order — verify tailor ownership and current stage
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

    // Verify caller is the tailor on this order
    if (order.tailor_id?.toString() !== caller.id) {
      log('warn', FN, 'auth.forbidden', { actor_id: caller.id, order_id: orderId, action })
      await audit(supabase, {
        event: 'auth.forbidden',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: 'warn',
        payload: { function: FN, action },
      })
      return new Response('Forbidden', { status: 403, headers: cors })
    }

    // ── send-quote ────────────────────────────────────────────────────────────
    if (action === 'send-quote') {
      // Idempotent: if already QUOTE_SENT, the previous request succeeded — return ok
      if (order.stage === 'QUOTE_SENT') {
        return new Response(JSON.stringify({ ok: true, idempotent: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (!['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot send-quote from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      // Zod already validated: amount, currency, completionDate — extract safely
      const { amount, currency, completionDate } = body as Extract<typeof body, { action: 'send-quote' }>
      const parsedDate = new Date(completionDate)
      const customerDeadline = order.deadline ? new Date(order.deadline) : null

      if (customerDeadline && parsedDate.getTime() > customerDeadline.getTime()) {
        return new Response(
          JSON.stringify({ error: 'Quoted completion date cannot be later than the customer deadline.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const { error } = await supabase
        .from('orders')
        .update({
          stage: 'QUOTE_SENT',
          quoted_amount: amount,
          quoted_currency: currency,
          quoted_completion_date: parsedDate.toISOString(),
        })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'QUOTE_SENT',
        note: body.note?.trim() || null,
      })

      await audit(supabase, {
        event: 'quote.sent',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { amount: body.amount, currency: body.currency, from_stage: order.stage },
      })

      log('info', FN, 'quote.sent', { actor_id: caller.id, order_id: orderId })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['send-quote'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── decline-order ─────────────────────────────────────────────────────────
    if (action === 'decline-order') {
      if (order.stage === 'DECLINED') {
        return new Response(JSON.stringify({ ok: true, idempotent: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (!['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot decline-order from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const { error } = await supabase
        .from('orders')
        .update({ stage: 'DECLINED' })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'DECLINED',
        note: body.note?.trim() || 'Tailor declined this order.',
      })

      await audit(supabase, {
        event: 'order.stage_changed',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { action, from_stage: order.stage, to_stage: 'DECLINED' },
      })

      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, from_stage: order.stage, to_stage: 'DECLINED' })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['decline-order'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── request-consultation ──────────────────────────────────────────────────
    if (action === 'request-consultation') {
      if (order.stage === 'CONSULTATION') {
        return new Response(JSON.stringify({ ok: true, idempotent: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (order.stage !== 'PENDING_QUOTE') {
        return new Response(
          JSON.stringify({ error: `Cannot request-consultation from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      // Zod already validated consultationFee — extract safely
      const { consultationFee = null } = body as Extract<typeof body, { action: 'request-consultation' }>

      const { error } = await supabase
        .from('orders')
        .update({ stage: 'CONSULTATION', consultation_fee: consultationFee })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'CONSULTATION',
        note: body.note?.trim() || null,
      })

      await audit(supabase, {
        event: 'order.stage_changed',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { action, from_stage: order.stage, to_stage: 'CONSULTATION', has_fee: consultationFee != null },
      })

      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, from_stage: order.stage, to_stage: 'CONSULTATION' })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-consultation'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── advance-stage ─────────────────────────────────────────────────────────
    if (action === 'advance-stage') {
      // Zod already validated targetStage against the enum
      const { targetStage, photoUrl, trackingNumber, carrier } = body as Extract<typeof body, { action: 'advance-stage' }>

      // Idempotent: if already in the target stage, the previous request succeeded
      if (order.stage === targetStage) {
        const responseBody: Record<string, unknown> = { ok: true, idempotent: true }
        // Re-fetch collection_code if needed so UI still gets it on retry
        if (targetStage === 'READY_FOR_COLLECTION') {
          const { data: fresh } = await supabase
            .from('orders').select('collection_code').eq('id', orderId).single()
          if (fresh?.collection_code) responseBody.collectionCode = fresh.collection_code
        }
        return new Response(JSON.stringify(responseBody), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const validFrom = ADVANCE_VALID_FROM[targetStage]
      if (!validFrom.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot advance to ${targetStage} from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'SHIPPED' && !trackingNumber?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Tracking number is required when marking an order as shipped.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const updates: Record<string, unknown> = { stage: targetStage }

      // Server-generated collection code — never trusted from client
      if (targetStage === 'READY_FOR_COLLECTION') {
        updates.collection_code = generateCollectionCode()
      }

      if (targetStage === 'SHIPPED' && trackingNumber?.trim()) {
        updates.tracking_number = trackingNumber.trim().toUpperCase()
        if (carrier?.trim()) updates.carrier = carrier.trim()
      }

      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, target_stage: targetStage, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: targetStage,
        note: body.note?.trim() || null,
        photo_url: photoUrl ?? null,
      })

      await audit(supabase, {
        event: 'order.stage_changed',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { action, from_stage: order.stage, to_stage: targetStage },
      })

      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, from_stage: order.stage, to_stage: targetStage })

      const stageNotif = CUSTOMER_NOTIFICATION[targetStage]
      if (stageNotif && order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), { ...stageNotif, data: { orderId } })
        )
      }

      // Return the collection_code so the UI can display it immediately
      const responseBody: Record<string, unknown> = { ok: true }
      if (targetStage === 'READY_FOR_COLLECTION') {
        responseBody.collectionCode = updates.collection_code
      }

      return new Response(JSON.stringify(responseBody), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── confirm-collection ────────────────────────────────────────────────────
    if (action === 'confirm-collection') {
      const { code } = body as Extract<typeof body, { action: 'confirm-collection' }>
      const MAX_ATTEMPTS = 5

      if (order.stage === 'COLLECTED') {
        return new Response(JSON.stringify({ ok: true, idempotent: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (order.stage !== 'READY_FOR_COLLECTION') {
        return new Response(
          JSON.stringify({ error: `Cannot confirm-collection from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const attempts = order.collection_code_attempts ?? 0
      // V1.1 TODO: add time-based reset (e.g. reset attempts after 24h) to prevent permanent lockout
      // on legitimate collections where the code was misread multiple times.
      if (attempts >= MAX_ATTEMPTS) {
        await audit(supabase, {
          event: 'collection_code.order_locked',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          order_id: orderId,
          severity: 'warn',
          payload: { attempts },
        })
        return new Response(
          JSON.stringify({ error: 'Too many incorrect attempts. Contact support.' }),
          { status: 423, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (code !== order.collection_code) {
        await supabase.from('orders')
          .update({ collection_code_attempts: attempts + 1 })
          .eq('id', orderId)
        await audit(supabase, {
          event: 'collection_code.wrong',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          order_id: orderId,
          severity: 'warn',
          payload: { attempts: attempts + 1 },
        })
        const remaining = MAX_ATTEMPTS - attempts - 1
        return new Response(
          JSON.stringify({ error: 'Incorrect code.', attemptsRemaining: remaining }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const { error } = await supabase.from('orders')
        .update({ stage: 'COLLECTED', collection_code_attempts: 0 })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'COLLECTED',
        note: 'Customer collected the order in person. Code verified by tailor.',
      })

      await audit(supabase, {
        event: 'order.stage_changed',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { action, from_stage: order.stage, to_stage: 'COLLECTED' },
      })
      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, from_stage: order.stage, to_stage: 'COLLECTED' })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            title: 'Order collected 🎉',
            body: 'Your order has been collected. Hope you love it!',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response('Unknown action', { status: 400, headers: cors })

  } catch (err) {
    log('error', FN, 'unhandled_exception', { error: String(err) })
    return new Response('Internal error', { status: 500, headers: cors })
  }
})
