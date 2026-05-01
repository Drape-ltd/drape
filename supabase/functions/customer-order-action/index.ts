/**
 * customer-order-action
 *
 * Handles all customer-initiated order stage transitions.
 * Stage column is locked at DB level — only service role (this function) may mutate it.
 *
 * Actions:
 *   confirm-receipt  SHIPPED|OUT_FOR_DELIVERY → DELIVERED
 *   open-dispute     CONFIRMED|DESIGNING|SOURCING|CUTTING|SEWING|FINISHING|READY_FOR_DRAPE_DISPATCH|OUT_FOR_DELIVERY|SHIPPED|READY_FOR_COLLECTION → IN_DISPUTE
 *   accept-quote     QUOTE_SENT → PAYMENT_PENDING
 *   decline-quote    QUOTE_SENT → DECLINED
 *   complete-order   DELIVERED|COLLECTED → COMPLETE
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
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import {
  buildCustomerOrderCancellationTerminalRequest,
  buildCustomerQuoteDeclineTerminalRequest,
} from '../../../packages/shared/src/order-terminal.ts'
import {
  buildCancellationReviewNote,
  buildDeliveryReviewNote,
  buildMaterialIssueResponseNote,
  buildMeasurementConfirmedNote,
  CANCELLATION_REVIEW_REASON_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  parseMeasurementSnapshot,
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
} from '../_shared/order-support.ts'
import { deriveCancellationPolicy } from '../../../packages/shared/src/cancellation-policy.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'
import { refundSettledOrderPayments } from '../_shared/payment-refunds.ts'
import { validateRecipientPhone } from '../_shared/phone.ts'
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
    'save-fabric-tracking',
    'confirm-measurements',
    'respond-material-issue',
    'cancel-order',
    'request-cancellation-review',
    'request-delivery-review',
    'request-aftercare-support',
  ]),
  reason:      z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(10).max(1000).optional(),
  note:        optionalNote,
  fabricTracking: z.string().trim().min(1).max(120).optional(),
  materialIssueResponse: z.enum(['REPLACE_FABRIC', 'ASK_TAILOR_TO_SOURCE', 'REVISE_DESIGN', 'CANCEL_ORDER']).optional(),
  cancellationReason: z.enum([
    'CUSTOMER_CHANGED_MIND',
    'NEED_FULFILLMENT_CHANGE',
    'OTHER',
  ]).optional(),
  deliveryReason: z.enum([
    'DISPATCH_DELAY',
    'DELIVERY_FAILED',
    'RETURN_TO_SENDER',
    'MARKED_DELIVERED_NOT_RECEIVED',
    'WRONG_ITEM_RECEIVED',
    'OTHER',
  ]).optional(),
  aftercareType: z.enum([
    'FIT_ISSUE',
    'FINISH_ISSUE',
    'DAMAGE_OR_DEFECT',
    'ALTERATION_FOLLOW_UP',
    'OTHER',
  ]).optional(),
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
  | 'save-fabric-tracking'
  | 'confirm-measurements'
  | 'respond-material-issue'
  | 'cancel-order'
  | 'request-cancellation-review'
  | 'request-delivery-review'
  | 'request-aftercare-support'

type OrderRow = {
  id: string
  stage: string
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  fabric_source?: string | null
  quoted_amount?: number | null
  consultation_fee?: number | null
  quote_expires_at?: string | null
  delivery_method?: string | null
  delivery_address?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  fulfillment_fee?: number | null
  fulfillment_payment_requested_at?: string | null
  fulfillment_payment_paid_at?: string | null
  special_note?: string | null
  customer_measurements_snapshot?: unknown
  handoff_completed_at?: string | null
  customer_handoff_confirmed_at?: string | null
  handoff_confirmation_source?: string | null
}

const PRE_CUTTING_STAGES = ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING']

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

// Which stages each action is valid FROM
const VALID_FROM: Record<Action, string[]> = {
  'confirm-receipt': ['SHIPPED', 'OUT_FOR_DELIVERY'],
  'open-dispute':    ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION'],
  'accept-quote':    ['QUOTE_SENT'],
  'decline-quote':   ['QUOTE_SENT'],
  'complete-order':  ['DELIVERED', 'COLLECTED'],
  'save-fabric-tracking': ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'],
  'confirm-measurements': PRE_CUTTING_STAGES,
  'respond-material-issue': PRE_CUTTING_STAGES,
  'cancel-order': ['PENDING_QUOTE', 'CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
  'request-cancellation-review': ['CONFIRMED', 'DESIGNING', 'SOURCING', 'FINISHING'],
  'request-delivery-review': ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED'],
  'request-aftercare-support': ['DELIVERED', 'COLLECTED', 'COMPLETE'],
}

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
  'cancel-order': { title: 'Order cancelled', body: 'The customer cancelled this order before live production started.' },
  'request-cancellation-review': { title: 'Cancellation review requested', body: 'The customer asked Drape to review cancellation before handoff.' },
  'request-delivery-review': { title: 'Delivery review requested', body: 'The customer asked Drape to review a dispatch or delivery issue.' },
  'request-aftercare-support': { title: 'Aftercare support requested', body: 'The customer asked Drape to review a post-delivery fit or finish issue.' },
}

const AFTERCARE_TYPE_LABELS: Record<
  'FIT_ISSUE' | 'FINISH_ISSUE' | 'DAMAGE_OR_DEFECT' | 'ALTERATION_FOLLOW_UP' | 'OTHER',
  string
> = {
  FIT_ISSUE: 'Fit issue',
  FINISH_ISSUE: 'Finish issue',
  DAMAGE_OR_DEFECT: 'Damage or defect',
  ALTERATION_FOLLOW_UP: 'Alteration follow-up',
  OTHER: 'Other aftercare issue',
}

const STAGE_NOTE: Partial<Record<Action, string>> = {
  'confirm-receipt': 'Customer confirmed receipt of their order.',
  'accept-quote':    'Customer accepted the quote and started payment.',
  'decline-quote':   'Customer declined the quote.',
  'complete-order':  'Order marked complete.',
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

    const orderSelect =
      'id, stage, order_kind, customer_id, tailor_id, fabric_source, quoted_amount, consultation_fee, quote_expires_at, delivery_method, delivery_address, recipient_name, recipient_phone, fulfillment_fee, fulfillment_payment_requested_at, fulfillment_payment_paid_at, special_note, customer_measurements_snapshot, handoff_completed_at, customer_handoff_confirmed_at, handoff_confirmation_source'

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

    const supportMeta = parseOrderSupportMeta(order.special_note)
    const consultationMeta = supportMeta.consultation ?? null
    const dispatchRecord = supportMeta.dispatchRecord ?? null
    const cancellationPolicy = deriveCancellationPolicy({
      orderKind: order.order_kind === 'READY_MADE' ? 'READY_MADE' : 'CUSTOM',
      stage: order.stage as any,
      deliveryMethod: order.delivery_method ?? null,
      consultationFee: order.consultation_fee ?? null,
      consultationPaidAt: consultationMeta?.paidAt ?? null,
      consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
      fulfillmentFee: order.fulfillment_fee ?? null,
      fulfillmentPaymentRequestedAt: order.fulfillment_payment_requested_at ?? null,
      fulfillmentPaymentPaidAt: order.fulfillment_payment_paid_at ?? null,
      dispatchBookedAt: dispatchRecord?.bookedAt ?? null,
      premiumDispatch: dispatchRecord?.premiumException ?? null,
    })

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

      if (order.delivery_method !== 'LOCAL_COLLECTION' && !order.delivery_address?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Delivery address is required before you can accept this quote.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.delivery_method !== 'LOCAL_COLLECTION' && !order.recipient_name?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Recipient name is required before you can accept this quote.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.delivery_method !== 'LOCAL_COLLECTION' && !order.recipient_phone?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Recipient phone is required before you can accept this quote.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (order.delivery_method !== 'LOCAL_COLLECTION') {
        const recipientPhoneError = validateRecipientPhone(order.recipient_phone)
        if (recipientPhoneError) {
          return new Response(
            JSON.stringify({ error: recipientPhoneError }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }
      }
    }

    if (action === 'cancel-order') {
      if (!cancellationPolicy.customerCanSelfCancel) {
        return jsonError(
          cors,
          409,
          'CANCELLATION_NOT_ALLOWED',
          'This order can no longer be self-cancelled from here. Use Drape review or support if something has gone wrong.',
        )
      }

      let refundResult: Awaited<ReturnType<typeof refundSettledOrderPayments>> | null = null

      try {
        refundResult = await refundSettledOrderPayments(supabase, {
          orderId,
          reason: `Customer cancelled order from ${order.stage}`,
          actorId: caller.id,
          actorRole: 'CUSTOMER',
          allowedPhases: ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT'],
        })
      } catch (error) {
        log('error', FN, 'refund.error', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          error: error instanceof Error ? error.message : String(error),
        })
        return jsonError(
          cors,
          409,
          'REFUND_FAILED',
          'We could not safely cancel this order because the payment refund did not complete. Please try again or contact Drape support.',
        )
      }

      try {
        await finalizeOrderTerminal(
          supabase,
          orderId,
          buildCustomerOrderCancellationTerminalRequest({
            actorId: caller.id,
            fromStage: order.stage as any,
            consultationPaid: !!consultationMeta?.paidAt,
          }),
        )
      } catch (error) {
        log('error', FN, 'db.error', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          error: error instanceof Error ? error.message : String(error),
        })
        return jsonError(cors, 500, 'CANCELLATION_FAILED', 'Could not cancel this order right now.')
      }

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['cancel-order']!,
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true, refundedAttempts: refundResult?.refundedAttempts ?? [] }, 200, cors)
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

    if (action === 'save-fabric-tracking') {
      const value = fabricTracking?.trim() ?? ''
      if (!value) return new Response('fabricTracking is required', { status: 400, headers: cors })
      if (hasBlockedContact(value)) {
        return new Response("Contact details can't be included in tracking numbers.", { status: 400, headers: cors })
      }

      if (order.fabric_source !== 'CUSTOMER_SUPPLIES') {
        return jsonError(
          cors,
          409,
          'FABRIC_TRACKING_NOT_ALLOWED',
          'Fabric tracking only applies when the customer is supplying fabric.',
        )
      }

      const supportMeta = parseOrderSupportMeta(order.special_note)
      if (supportMeta.fabricHandoffMode && supportMeta.fabricHandoffMode !== 'CUSTOMER_SHIPS_TO_TAILOR') {
        return jsonError(
          cors,
          409,
          'FABRIC_TRACKING_NOT_ALLOWED',
          'Fabric tracking only applies when the customer is shipping fabric to the tailor.',
        )
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

    if (action === 'request-cancellation-review') {
      if (!cancellationPolicy.customerCanRequestReview) {
        return jsonError(
          cors,
          409,
          'CANCELLATION_REVIEW_NOT_ALLOWED',
          'This order can no longer open a standard cancellation review from its current stage.',
        )
      }

      const cancellationReason = parsed.data.cancellationReason
      if (!cancellationReason) {
        return jsonError(cors, 400, 'CANCELLATION_REASON_REQUIRED', 'Choose why you want Drape to review this cancellation.')
      }

      if (supportMeta.cancellationReview?.status === 'OPEN') {
        return jsonError(cors, 409, 'CANCELLATION_REVIEW_ALREADY_OPEN', 'A cancellation review is already open on this order.')
      }

      const reasonLabel = CANCELLATION_REVIEW_REASON_LABELS[cancellationReason]
      const nextMeta = {
        ...supportMeta,
        cancellationReview: {
          status: 'OPEN' as const,
          requestedBy: 'CUSTOMER' as const,
          reason: cancellationReason,
          reasonLabel,
          note: parsed.data.note?.trim() || null,
          requestedAt: new Date().toISOString(),
          requestedFromStage: order.stage,
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({
          stage: 'IN_DISPUTE',
          stage_updated_at: new Date().toISOString(),
          special_note: serializeOrderSupportMeta(nextMeta),
        })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonError(cors, 500, 'CANCELLATION_REVIEW_FAILED', 'Could not open cancellation review right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'IN_DISPUTE',
        note: buildCancellationReviewNote('CUSTOMER', reasonLabel, parsed.data.note ?? null),
      })

      await audit(supabase, {
        event: 'order.cancellation_review_requested',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        severity: 'warn',
        payload: { reason: cancellationReason, from_stage: order.stage },
      })

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'ORDER_REVIEW',
        severity: 'HIGH',
        source: FN,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        orderId,
        userId: caller.id,
        stage: order.stage,
        title: 'Cancellation review requested',
        description: `Customer asked Drape to review a cancellation from ${order.stage}.`,
        recommendedAction: 'Review the order timeline, cancellation reason, and refund implications before ruling.',
        dedupeKey: `order-review:cancellation:${orderId}`,
        metadata: {
          review_type: 'CANCELLATION',
          requested_by: 'CUSTOMER',
          reason: cancellationReason,
          from_stage: order.stage,
        },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['request-cancellation-review']!,
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (action === 'request-delivery-review') {
      const deliveryReason = parsed.data.deliveryReason
      if (!deliveryReason) {
        return jsonError(cors, 400, 'DELIVERY_REVIEW_REASON_REQUIRED', 'Choose why you want Drape to review this dispatch or delivery issue.')
      }

      const meta = parseOrderSupportMeta(order.special_note)
      if (meta.deliveryReview?.status === 'OPEN') {
        return jsonError(cors, 409, 'DELIVERY_REVIEW_ALREADY_OPEN', 'A delivery review is already open on this order.')
      }

      const reasonLabel = DELIVERY_REVIEW_REASON_LABELS[deliveryReason]
      const nextMeta = {
        ...meta,
        deliveryReview: {
          status: 'OPEN' as const,
          requestedBy: 'CUSTOMER' as const,
          reason: deliveryReason,
          reasonLabel,
          note: parsed.data.note?.trim() || null,
          requestedAt: new Date().toISOString(),
          requestedFromStage: order.stage,
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({
          stage: 'IN_DISPUTE',
          stage_updated_at: new Date().toISOString(),
          special_note: serializeOrderSupportMeta(nextMeta),
        })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonError(cors, 500, 'DELIVERY_REVIEW_FAILED', 'Could not open delivery review right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'IN_DISPUTE',
        note: buildDeliveryReviewNote('CUSTOMER', reasonLabel, parsed.data.note ?? null),
      })

      await audit(supabase, {
        event: 'order.delivery_review_requested',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        severity: 'warn',
        payload: { reason: deliveryReason, from_stage: order.stage },
      })

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'DELIVERY_REVIEW',
        severity: 'HIGH',
        source: FN,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        orderId,
        userId: caller.id,
        stage: order.stage,
        title: 'Delivery review requested',
        description: `Customer asked Drape to review a dispatch or delivery issue from ${order.stage}.`,
        recommendedAction: 'Check dispatch evidence, customer contact attempts, and the current delivery stage before deciding the next step.',
        dedupeKey: `order-review:delivery:${orderId}`,
        metadata: {
          review_type: 'DELIVERY',
          requested_by: 'CUSTOMER',
          reason: deliveryReason,
          from_stage: order.stage,
        },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['request-delivery-review']!,
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (action === 'request-aftercare-support') {
      const aftercareType = parsed.data.aftercareType
      const aftercareNote = parsed.data.note?.trim() ?? ''

      if (!aftercareType) {
        return jsonError(cors, 400, 'AFTERCARE_TYPE_REQUIRED', 'Choose the kind of aftercare help you need before sending this to Drape.')
      }

      if (aftercareNote.length < 10) {
        return jsonError(cors, 400, 'AFTERCARE_NOTE_REQUIRED', 'Add a short note so Drape knows what happened and how to help.')
      }

      const issueLabel = AFTERCARE_TYPE_LABELS[aftercareType]

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: `Customer requested aftercare support in Drape. Issue: ${issueLabel}. Note: ${aftercareNote}`,
      })

      await audit(supabase, {
        event: 'order.aftercare_requested',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        severity: 'warn',
        payload: {
          aftercare_type: aftercareType,
          aftercare_label: issueLabel,
          from_stage: order.stage,
          note_length: aftercareNote.length,
        },
      })

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'AFTERCARE_REQUEST',
        severity: 'MEDIUM',
        source: FN,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        orderId,
        userId: caller.id,
        stage: order.stage,
        title: 'Aftercare support requested',
        description: `Customer requested Drape aftercare support for ${issueLabel.toLowerCase()}.`,
        recommendedAction: 'Review the aftercare note, gather evidence if needed, and decide whether support, alteration follow-up, or refund review is required.',
        dedupeKey: `aftercare:${orderId}`,
        metadata: {
          aftercare_type: aftercareType,
          aftercare_label: issueLabel,
          from_stage: order.stage,
          note_length: aftercareNote.length,
        },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['request-aftercare-support']!,
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

      if (nextStage === 'DECLINED') {
        try {
          await finalizeOrderTerminal(
            supabase,
            orderId,
            buildCustomerQuoteDeclineTerminalRequest(caller.id, order.stage as any),
          )
        } catch (error) {
          log('error', FN, 'db.error', {
            actor_id: caller.id,
            order_id: orderId,
            action,
            error: error instanceof Error ? error.message : String(error),
          })
          return new Response('Database error', { status: 500, headers: cors })
        }
      } else {
        const nowIso = new Date().toISOString()
        const updatePatch: Record<string, unknown> = {
          stage: nextStage,
          stage_updated_at: nowIso,
        }

        if (action === 'confirm-receipt') {
          updatePatch.handoff_completed_at = order.handoff_completed_at ?? nowIso
          updatePatch.customer_handoff_confirmed_at = nowIso
          updatePatch.handoff_confirmation_source = 'CUSTOMER_RECEIPT'
        }

        if (action === 'complete-order') {
          updatePatch.handoff_completed_at = order.handoff_completed_at ?? nowIso
          updatePatch.customer_handoff_confirmed_at = order.customer_handoff_confirmed_at ?? nowIso
          updatePatch.handoff_confirmation_source =
            order.customer_handoff_confirmed_at
              ? (order.handoff_confirmation_source ?? 'CUSTOMER_COMPLETE')
              : 'CUSTOMER_COMPLETE'
        }

        const { error } = await supabase
          .from('orders')
          .update(updatePatch)
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
      }

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
