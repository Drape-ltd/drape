/**
 * customer-order-action
 *
 * Handles all customer-initiated order stage transitions.
 * Stage column is locked at DB level — only service role (this function) may mutate it.
 *
 * Actions:
 *   confirm-receipt  SHIPPED → DELIVERED
 *   open-dispute     CONFIRMED|DESIGNING|SOURCING|CUTTING|SEWING|FINISHING|SHIPPED|READY_FOR_COLLECTION → IN_DISPUTE
 *   accept-quote     QUOTE_SENT → PAYMENT_PENDING
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
import { hasBlockedContact, rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import {
  buildMaterialIssueResponseNote,
  buildMeasurementConfirmedNote,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  parseMeasurementSnapshot,
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
} from '../_shared/order-support.ts'
import { z, parseBody, uuid, optionalNote } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'

const BodySchema = z.object({
  orderId:     uuid,
  action:      z.enum([
    'confirm-receipt',
    'open-dispute',
    'accept-quote',
    'decline-quote',
    'complete-order',
    'collect-order',
    'save-fabric-tracking',
    'confirm-measurements',
    'respond-material-issue',
  ]),
  reason:      z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(10).max(1000).optional(),
  note:        optionalNote,
  // collect-order only — 4-digit numeric collection code
  code:        z.string().regex(/^\d{4}$/, 'Must be a 4-digit code').optional(),
  fabricTracking: z.string().trim().min(1).max(120).optional(),
  materialIssueResponse: z.enum(['REPLACE_FABRIC', 'ASK_TAILOR_TO_SOURCE', 'REVISE_DESIGN', 'CANCEL_ORDER']).optional(),
})

const FN = 'customer-order-action'
const THREATENING_LANGUAGE_PATTERNS = [
  /\b(i('ll| will|'m going to| am going to)) (kill|hurt|harm|beat|attack|destroy|ruin) (you|u|your|ur)\b/i,
  /\b(you('re| are) (dead|finished|done)|watch your back|i know where you live)\b/i,
]

type Action =
  | 'confirm-receipt'
  | 'open-dispute'
  | 'accept-quote'
  | 'decline-quote'
  | 'complete-order'
  | 'collect-order'
  | 'save-fabric-tracking'
  | 'confirm-measurements'
  | 'respond-material-issue'

type OrderRow = {
  id: string
  stage: string
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  quoted_amount?: number | null
  quote_expires_at?: string | null
  delivery_method?: string | null
  delivery_address?: string | null
  special_note?: string | null
  customer_measurements_snapshot?: unknown
  collection_code?: string | null
  collection_code_attempts?: number | null
}

const PRE_CUTTING_STAGES = ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING']

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

// Which stages each action is valid FROM
const VALID_FROM: Record<Action, string[]> = {
  'confirm-receipt': ['SHIPPED'],
  'open-dispute':    ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION'],
  'accept-quote':    ['QUOTE_SENT'],
  'decline-quote':   ['QUOTE_SENT'],
  'complete-order':  ['DELIVERED', 'COLLECTED'],
  'collect-order':   ['READY_FOR_COLLECTION'],
  'save-fabric-tracking': ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'],
  'confirm-measurements': PRE_CUTTING_STAGES,
  'respond-material-issue': PRE_CUTTING_STAGES,
}

const MAX_CODE_ATTEMPTS = 5

// The stage each action transitions TO (dispute handled separately)
const NEXT_STAGE: Partial<Record<Action, string>> = {
  'confirm-receipt': 'DELIVERED',
  'accept-quote':    'PAYMENT_PENDING',
  'decline-quote':   'DECLINED',
  'complete-order':  'COMPLETE',
}

// Push notification sent to the TAILOR after each customer action
const TAILOR_NOTIFICATION: Partial<Record<Action, { title: string; body: string }>> = {
  'confirm-receipt': { title: 'Delivery confirmed 📦',  body: 'The customer confirmed receipt of their order.' },
  'decline-quote':   { title: 'Quote declined',          body: 'The customer declined your quote.' },
  'open-dispute':    { title: 'Concern raised ⚠️',       body: 'A customer raised a concern about their order.' },
  'complete-order':  { title: 'Order complete ⭐',       body: 'The customer marked the order complete!' },
  'confirm-measurements': { title: 'Measurements confirmed', body: 'The customer confirmed their measurements for this order.' },
  'respond-material-issue': { title: 'Customer responded to fabric issue', body: 'The customer chose how they want to handle the material issue.' },
}

const STAGE_NOTE: Partial<Record<Action, string>> = {
  'confirm-receipt': 'Customer confirmed receipt of their order.',
  'accept-quote':    'Customer accepted the quote and started payment.',
  'decline-quote':   'Customer declined the quote.',
  'complete-order':  'Order marked complete.',
  'collect-order':   'Customer collected the order in person.',
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, cors)
}

function hasThreateningLanguage(text: string) {
  return THREATENING_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text))
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
      : action === 'accept-quote'
        ? 'id, stage, order_kind, customer_id, tailor_id, quoted_amount, quote_expires_at, delivery_method, delivery_address, special_note, customer_measurements_snapshot'
        : 'id, stage, customer_id, tailor_id, special_note, customer_measurements_snapshot'

    // Fetch order — verify ownership and current stage
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(orderSelect)
      .eq('id', orderId)
      .single()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: orderError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    const order = orderData as unknown as OrderRow | null
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

    if (action === 'accept-quote') {
      if (order.order_kind && order.order_kind !== 'CUSTOM') {
        return new Response(
          JSON.stringify({ error: 'This action is only valid for custom quotes.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (typeof order.quoted_amount !== 'number' || order.quoted_amount <= 0) {
        return new Response(
          JSON.stringify({ error: 'This quote is incomplete. Ask the tailor to resend it.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() <= Date.now()) {
        return new Response(
          JSON.stringify({ error: 'This quote has expired. Ask the tailor to send a fresh quote.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.delivery_method === 'SHIPPING' && !order.delivery_address?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Delivery address is required before you can accept this shipping quote.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }
    }

    const blockedNote = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      surface: `orders.${action}.note`,
      text: parsed.data.note,
      message: "Contact details can't be included in this note.",
      orderId,
      extra: { action },
    })
    if (blockedNote) return blockedNote

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
        .update({ stage: 'COLLECTED', collection_code_attempts: 0, stage_updated_at: new Date().toISOString() })
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

    if (action === 'confirm-measurements') {
      const snapshot = parseMeasurementSnapshot(order.customer_measurements_snapshot)
      if (snapshot.needsConfirmation !== true) {
        return jsonError(cors, 409, 'MEASUREMENT_CONFIRMATION_NOT_REQUIRED', 'There is no open measurement confirmation request on this order.')
      }

      const nextSnapshot = {
        ...snapshot,
        needsConfirmation: false,
        confirmedAt: new Date().toISOString(),
        confirmedBy: 'CUSTOMER',
      }

      const { error } = await supabase
        .from('orders')
        .update({ customer_measurements_snapshot: nextSnapshot })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonError(cors, 500, 'MEASUREMENT_CONFIRMATION_SAVE_FAILED', 'Could not confirm these measurements right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildMeasurementConfirmedNote(),
      })

      await audit(supabase, {
        event: 'measurements.confirmed',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: { stage: order.stage },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['confirm-measurements']!,
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (action === 'respond-material-issue') {
      const response = parsed.data.materialIssueResponse
      if (!response) {
        return jsonError(cors, 400, 'MATERIAL_ISSUE_RESPONSE_REQUIRED', 'Choose how you want to handle this fabric issue before continuing.')
      }

      const meta = parseOrderSupportMeta(order.special_note)
      if (!meta.materialIssue || meta.materialIssue.status !== 'OPEN') {
        return jsonError(cors, 409, 'MATERIAL_ISSUE_NOT_OPEN', 'This order does not have an open material issue right now.')
      }

      const responseLabel = MATERIAL_ISSUE_RESPONSE_LABELS[response]
      const nextMeta = {
        ...meta,
        fabricReceivedAt: response === 'REPLACE_FABRIC' ? null : meta.fabricReceivedAt ?? null,
        fabricReceivedNote: response === 'REPLACE_FABRIC' ? 'Waiting for replacement fabric from customer.' : meta.fabricReceivedNote ?? null,
        materialIssue: {
          ...meta.materialIssue,
          status: response === 'CANCEL_ORDER' ? 'CUSTOMER_REQUESTED_CANCEL' as const : 'CUSTOMER_RESPONDED' as const,
          response,
          responseLabel,
          responseNote: parsed.data.note?.trim() || null,
          respondedAt: new Date().toISOString(),
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonError(cors, 500, 'MATERIAL_ISSUE_RESPONSE_FAILED', 'Could not save your material issue decision right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildMaterialIssueResponseNote(responseLabel, parsed.data.note ?? null),
      })

      await audit(supabase, {
        event: 'material_issue.responded',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: { stage: order.stage, response },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['respond-material-issue']!,
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (action === 'open-dispute') {
      if (!reason?.trim()) return jsonError(cors, 400, 'DISPUTE_REASON_REQUIRED', 'Please choose a reason for this concern.')
      if (!description?.trim()) return jsonError(cors, 400, 'DISPUTE_DESCRIPTION_REQUIRED', 'Please describe what happened before submitting this concern.')

      if (hasThreateningLanguage(description.trim())) {
        await audit(supabase, {
          event: 'dispute.blocked',
          actor_id: caller.id,
          actor_role: 'CUSTOMER',
          order_id: orderId,
          severity: 'warn',
          payload: {
            function: FN,
            action,
            reason: 'THREATENING_LANGUAGE',
          },
        })

        log('warn', FN, 'dispute.blocked', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          reason: 'THREATENING_LANGUAGE',
        })

        return jsonError(
          cors,
          400,
          'THREATENING_LANGUAGE',
          "That concern description can't be submitted. Keep the wording respectful — our team reviews flagged messages.",
        )
      }

      const blockedDispute = await rejectIfBlockedContact({
        supabase,
        fn: FN,
        cors,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        surface: 'orders.dispute.description',
        text: description,
        message: "Contact details can't be included in dispute details.",
        orderId,
        extra: { action },
      })
      if (blockedDispute) return blockedDispute

      const { error: stageError } = await supabase
        .from('orders')
        .update({ stage: 'IN_DISPUTE', stage_updated_at: new Date().toISOString() })
        .eq('id', orderId)

      if (stageError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: stageError.message })
        return jsonError(cors, 500, 'DISPUTE_STAGE_UPDATE_FAILED', 'Could not pause this order for review right now.')
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
        return jsonError(cors, 500, 'DISPUTE_OPEN_FAILED', 'Could not submit this concern right now.')
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
        .update({ stage: nextStage, stage_updated_at: new Date().toISOString() })
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
