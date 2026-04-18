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
import {
  MAX_COLLECTION_CODE_ATTEMPTS,
  readCollectionCodeAttempts,
  shouldResetCollectionCodeAttempts,
} from '../_shared/collection-code.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import {
  buildFabricReceivedNote,
  buildFitProfileReviewedNote,
  buildMaterialIssueNote,
  buildMeasurementConfirmationRequestNote,
  FABRIC_HANDOFF_LABELS,
  fitProfileNeedsTailorReview,
  MATERIAL_ISSUE_REASON_LABELS,
  materialIssueBlocksCutting,
  MEASUREMENT_SOURCE_LABELS,
  parseMeasurementSnapshot,
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
} from '../_shared/order-support.ts'
import { deriveTailorReadiness } from '../_shared/tailor-readiness.ts'
import { z, parseBody, uuid, isoDate } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    orderId:        uuid,
    action:         z.literal('send-quote'),
    amount:         z.number().int().positive().max(100_000_00),
    fulfillmentFee: z.number().int().nonnegative().max(100_000_00).optional(),
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
  z.object({
    orderId: uuid,
    action:  z.literal('request-measurement-confirmation'),
    note:    z.string().trim().min(10).max(300),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('confirm-fit-readiness'),
    note:    z.string().trim().min(10).max(300),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('confirm-fabric-received'),
    note:    z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('open-material-issue'),
    reason:  z.enum([
      'POOR_FABRIC_QUALITY',
      'INSUFFICIENT_YARDAGE',
      'FABRIC_NOT_RECEIVED',
      'WRONG_FABRIC_TYPE',
      'FABRIC_DAMAGED',
      'FABRIC_MISMATCH',
    ]),
    note:    z.string().trim().min(10).max(300),
  }),
])

const FN = 'tailor-order-action'
const QUOTE_VALIDITY_HOURS = 48

function nextQuoteExpiryIso() {
  return new Date(Date.now() + QUOTE_VALIDITY_HOURS * 60 * 60 * 1000).toISOString()
}


type Action =
  | 'send-quote'
  | 'decline-order'
  | 'request-consultation'
  | 'advance-stage'
  | 'confirm-collection'
  | 'request-measurement-confirmation'
  | 'confirm-fit-readiness'
  | 'confirm-fabric-received'
  | 'open-material-issue'
type OrderRow = {
  id: string
  stage: string
  tailor_id?: string | null
  customer_id?: string | null
  deadline?: string | null
  fabric_source?: string | null
  special_note?: string | null
  customer_measurements_snapshot?: unknown
  delivery_method?: string | null
  delivery_address?: string | null
  fulfillment_fee?: number | null
  collection_code?: string | null
  collection_code_attempts?: number | null
  collection_code_last_attempt_at?: string | null
  updated_at?: string | null
}

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

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

const PRE_CUTTING_STAGES = ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING']

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
  'request-measurement-confirmation': { title: 'Measurement check needed', body: 'Your tailor wants you to confirm your measurements before cutting starts.' },
  'confirm-fit-readiness': { title: 'Fit intake reviewed', body: 'Your tailor reviewed the guided fit intake attached to this order.' },
  'confirm-fabric-received': { title: 'Fabric received', body: 'Your tailor confirmed they received your fabric.' },
  'open-material-issue': { title: 'Fabric issue needs your decision', body: 'Your tailor reviewed the fabric and needs your choice before production can continue.' },
}

/** Cryptographically random 4-digit collection code (1000–9999). */
function generateCollectionCode(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(1000 + (arr[0] % 9000))
}

async function auditShippingHandoffBlocked(
  supabase: any,
  callerId: string,
  order: Pick<OrderRow, 'id' | 'stage' | 'delivery_method'>,
  reason: string,
  payload?: Record<string, unknown>,
) {
  await audit(supabase, {
    event: 'shipping.handoff_blocked',
    actor_id: callerId,
    actor_role: 'TAILOR',
    order_id: order.id,
    severity: 'warn',
    payload: {
      function: FN,
      reason,
      stage: order.stage,
      delivery_method: order.delivery_method ?? null,
      ...(payload ?? {}),
    },
  })
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

    if (action === 'send-quote') {
      const { data: profile, error: profileError } = await supabase
        .from('tailor_profiles')
        .select('profile_completed, id_verification_status, stripe_account_id, paystack_account_id')
        .eq('user_id', caller.id)
        .maybeSingle()

      if (profileError) {
        log('error', FN, 'db.error', { actor_id: caller.id, action, error: profileError.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      const readiness = deriveTailorReadiness(profile)
      if (!readiness.canAcceptPaidOrders) {
        await audit(supabase, {
          event: 'seller.paid_work_blocked',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          order_id: orderId,
          severity: 'warn',
          payload: { function: FN, action, reason: readiness.code },
        })
        return new Response(
          JSON.stringify({ code: readiness.code, error: readiness.message ?? 'Payout setup is still required before taking paid work.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }
    }

    // Only collection confirmation needs the collection code fields.
    const orderSelect = action === 'confirm-collection'
      ? 'id, stage, tailor_id, customer_id, collection_code, collection_code_attempts, collection_code_last_attempt_at, updated_at'
      : 'id, stage, tailor_id, customer_id, deadline, fabric_source, special_note, customer_measurements_snapshot, delivery_method, delivery_address, fulfillment_fee'

    // Fetch order — verify tailor ownership and current stage
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

    const blockedNote = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: 'TAILOR',
      surface: `tailor_order.${action}.note`,
      text: 'note' in body ? body.note : null,
      message: "Contact details can't be included in order notes.",
      orderId,
      extra: { action },
    })
    if (blockedNote) return blockedNote

    if (action === 'request-measurement-confirmation') {
      if (!PRE_CUTTING_STAGES.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot request measurement confirmation from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const snapshot = parseMeasurementSnapshot(order.customer_measurements_snapshot)
      if (Object.keys(snapshot).length === 0) {
        return new Response(
          JSON.stringify({ error: 'No measurements are attached to this order yet.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const source = snapshot.measurementSource === 'HELPER_GUIDED' ||
        snapshot.measurementSource === 'TAILOR_CAPTURED' ||
        snapshot.measurementSource === 'EXTERNAL_PRO_CAPTURED'
        ? snapshot.measurementSource
        : 'SELF_GUIDED'
      const sourceLabel = MEASUREMENT_SOURCE_LABELS[source]
      const now = new Date().toISOString()
      const nextSnapshot = {
        ...snapshot,
        needsConfirmation: true,
        confirmationReason: body.note.trim(),
        confirmationRequestedAt: now,
        confirmedAt: null,
        confirmedBy: null,
      }

      const { error } = await supabase
        .from('orders')
        .update({ customer_measurements_snapshot: nextSnapshot })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildMeasurementConfirmationRequestNote(body.note.trim(), sourceLabel),
      })

      await audit(supabase, {
        event: 'measurements.confirmation_requested',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { stage: order.stage, measurement_source: source },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-measurement-confirmation'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'confirm-fabric-received') {
      if (!PRE_CUTTING_STAGES.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot confirm fabric receipt from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.fabric_source !== 'CUSTOMER_SUPPLIES') {
        return new Response(
          JSON.stringify({ error: 'Fabric receipt only applies when the customer is supplying fabric.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const meta = parseOrderSupportMeta(order.special_note)
      const handoffMode = meta.fabricHandoffMode && meta.fabricHandoffMode in FABRIC_HANDOFF_LABELS
        ? meta.fabricHandoffMode
        : 'CUSTOMER_SHIPS_TO_TAILOR'
      const handoffLabel = meta.fabricHandoffLabel?.trim() || FABRIC_HANDOFF_LABELS[handoffMode]
      const nextMeta = {
        ...meta,
        fabricReceivedAt: new Date().toISOString(),
        fabricReceivedNote: body.note?.trim() || null,
        materialIssue:
          meta.materialIssue?.status === 'CUSTOMER_RESPONDED' && meta.materialIssue.response === 'REPLACE_FABRIC'
            ? { ...meta.materialIssue, status: 'RESOLVED' as const }
            : meta.materialIssue,
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildFabricReceivedNote(handoffLabel, body.note ?? null),
      })

      await audit(supabase, {
        event: 'fabric.received',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { stage: order.stage, handoff_mode: handoffMode },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['confirm-fabric-received'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'confirm-fit-readiness') {
      if (!PRE_CUTTING_STAGES.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot confirm fit readiness from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const meta = parseOrderSupportMeta(order.special_note)
      if (!meta.fitProfile) {
        return new Response(
          JSON.stringify({ error: 'No guided fit intake is attached to this order yet.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const nextMeta = {
        ...meta,
        fitProfile: {
          ...meta.fitProfile,
          status: 'TAILOR_REVIEWED' as const,
          requiresTailorReview: false,
          tailorMeasurementOverride: true,
          tailorMeasurementOverrideReason: body.note.trim(),
          tailorMeasurementOverrideAt: new Date().toISOString(),
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildFitProfileReviewedNote(body.note.trim()),
      })

      await audit(supabase, {
        event: 'measurements.fit_reviewed',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { stage: order.stage },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['confirm-fit-readiness'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'open-material-issue') {
      if (!PRE_CUTTING_STAGES.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot open a material issue from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.fabric_source !== 'CUSTOMER_SUPPLIES') {
        return new Response(
          JSON.stringify({ error: 'Material issues only apply when the customer is supplying fabric.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const reasonLabel = MATERIAL_ISSUE_REASON_LABELS[body.reason]
      const now = new Date().toISOString()
      const meta = parseOrderSupportMeta(order.special_note)
      const nextMeta = {
        ...meta,
        materialIssue: {
          status: 'OPEN' as const,
          reason: body.reason,
          reasonLabel,
          note: body.note.trim(),
          openedAt: now,
          openedBy: 'TAILOR' as const,
          response: null,
          responseLabel: null,
          responseNote: null,
          respondedAt: null,
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildMaterialIssueNote(reasonLabel, body.note.trim()),
      })

      await audit(supabase, {
        event: 'material_issue.opened',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: 'warn',
        payload: { stage: order.stage, reason: body.reason },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['open-material-issue'],
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
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
      const fulfillmentFee = order.delivery_method === 'LOCAL_COLLECTION'
        ? 0
        : Math.max(body.fulfillmentFee ?? order.fulfillment_fee ?? 0, 0)

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
          quoted_amount: amount + fulfillmentFee,
          fulfillment_fee: fulfillmentFee,
          quoted_currency: currency,
          quoted_completion_date: parsedDate.toISOString(),
          quote_note: body.note?.trim() || null,
          quote_expires_at: nextQuoteExpiryIso(),
          stage_updated_at: new Date().toISOString(),
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
        .update({ stage: 'DECLINED', stage_updated_at: new Date().toISOString() })
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
        .update({
          stage: 'CONSULTATION',
          consultation_fee: consultationFee,
          stage_updated_at: new Date().toISOString(),
        })
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

      if (targetStage === 'READY_FOR_COLLECTION' && order.delivery_method !== 'LOCAL_COLLECTION') {
        await auditShippingHandoffBlocked(supabase, caller.id, order, 'requires_shipping_flow')
        return new Response(
          JSON.stringify({ error: 'This order is set for shipping. Mark it as shipped instead.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'SHIPPED' && order.delivery_method === 'LOCAL_COLLECTION') {
        await auditShippingHandoffBlocked(supabase, caller.id, order, 'requires_collection_flow')
        return new Response(
          JSON.stringify({ error: 'This order is set for local collection. Mark it ready for collection instead.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'SHIPPED' && !trackingNumber?.trim()) {
        await auditShippingHandoffBlocked(supabase, caller.id, order, 'tracking_number_missing')
        return new Response(
          JSON.stringify({ error: 'Tracking number is required when marking an order as shipped.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'SHIPPED' && !carrier?.trim()) {
        await auditShippingHandoffBlocked(supabase, caller.id, order, 'carrier_missing')
        return new Response(
          JSON.stringify({ error: 'Carrier is required when marking an order as shipped.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'SHIPPED' && !order.delivery_address?.trim()) {
        await auditShippingHandoffBlocked(supabase, caller.id, order, 'delivery_address_missing')
        return new Response(
          JSON.stringify({ error: 'Shipping address is missing on this order. Ask the customer to update it before shipping.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'SHIPPED' && !photoUrl?.trim()) {
        await auditShippingHandoffBlocked(supabase, caller.id, order, 'shipment_proof_missing')
        return new Response(
          JSON.stringify({ error: 'Add a shipment photo or dispatch proof before marking this order as shipped.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'CUTTING') {
        const snapshot = parseMeasurementSnapshot(order.customer_measurements_snapshot)
        if (snapshot.needsConfirmation === true) {
          return new Response(
            JSON.stringify({ error: 'Measurements still need customer confirmation before cutting can start.' }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }

        const supportMeta = parseOrderSupportMeta(order.special_note)
        const materialIssue = supportMeta.materialIssue
        const waitingOnTailorSourcing = materialIssue?.status === 'CUSTOMER_RESPONDED' && materialIssue.response === 'ASK_TAILOR_TO_SOURCE'

        if (order.fabric_source === 'CUSTOMER_SUPPLIES' && !supportMeta.fabricReceivedAt && !waitingOnTailorSourcing) {
          return new Response(
            JSON.stringify({ error: 'Confirm that the customer fabric has been received before cutting starts.' }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }

        if (materialIssueBlocksCutting(supportMeta)) {
          return new Response(
            JSON.stringify({ error: 'This order has an open material issue. Resolve it before cutting starts.' }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }

        if (fitProfileNeedsTailorReview(supportMeta)) {
          return new Response(
            JSON.stringify({ error: 'Review the guided fit intake or request measurement confirmation before cutting starts.' }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }
      }

      const updates: Record<string, unknown> = {
        stage: targetStage,
        stage_updated_at: new Date().toISOString(),
      }

      // Server-generated collection code — never trusted from client
      if (targetStage === 'READY_FOR_COLLECTION') {
        updates.collection_code = generateCollectionCode()
        updates.collection_code_attempts = 0
        updates.collection_code_last_attempt_at = null
      }

      if (targetStage === 'SHIPPED' && trackingNumber?.trim()) {
        updates.tracking_number = trackingNumber.trim().toUpperCase()
        updates.carrier = carrier?.trim() ?? null
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
        payload: {
          action,
          from_stage: order.stage,
          to_stage: targetStage,
          delivery_method: order.delivery_method ?? null,
          tracking_number: targetStage === 'SHIPPED' ? updates.tracking_number ?? null : null,
          carrier: targetStage === 'SHIPPED' ? updates.carrier ?? null : null,
        },
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

      let attempts = readCollectionCodeAttempts({
        attempts: order.collection_code_attempts,
        lastAttemptAt: order.collection_code_last_attempt_at,
        updatedAt: order.updated_at,
      })

      if (shouldResetCollectionCodeAttempts({
        attempts,
        lastAttemptAt: order.collection_code_last_attempt_at,
        updatedAt: order.updated_at,
      })) {
        const { error: resetError } = await supabase
          .from('orders')
          .update({ collection_code_attempts: 0, collection_code_last_attempt_at: null })
          .eq('id', orderId)

        if (resetError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: resetError.message })
          return new Response('Database error', { status: 500, headers: cors })
        }

        attempts = 0
      }

      if (attempts >= MAX_COLLECTION_CODE_ATTEMPTS) {
        await audit(supabase, {
          event: 'collection_code.order_locked',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          order_id: orderId,
          severity: 'warn',
          payload: { attempts },
        })
        return new Response(
          JSON.stringify({ error: 'Too many incorrect attempts. Try again after the 24-hour reset window or contact support.' }),
          { status: 423, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (code !== order.collection_code) {
        const nowIso = new Date().toISOString()
        await supabase.from('orders')
          .update({ collection_code_attempts: attempts + 1, collection_code_last_attempt_at: nowIso })
          .eq('id', orderId)
        await audit(supabase, {
          event: 'collection_code.wrong',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          order_id: orderId,
          severity: 'warn',
          payload: { attempts: attempts + 1 },
        })
        const remaining = MAX_COLLECTION_CODE_ATTEMPTS - attempts - 1
        return new Response(
          JSON.stringify({ error: 'Incorrect code.', attemptsRemaining: remaining }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const { error } = await supabase.from('orders')
        .update({
          stage: 'COLLECTED',
          collection_code_attempts: 0,
          collection_code_last_attempt_at: null,
          stage_updated_at: new Date().toISOString(),
        })
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
