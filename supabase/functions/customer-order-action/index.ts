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
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { log, audit } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
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
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { z, parseBody, uuid, optionalNote, isoDate } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { assertConsultationSlotAvailable } from '../_shared/consultation-bookings.ts'

const BodySchema = z.object({
  orderId:     uuid,
  action:      z.enum([
    'confirm-receipt',
    'open-dispute',
    'accept-quote',
    'decline-quote',
    'complete-order',
    'save-fabric-tracking',
    'approve-sourced-fabric',
    'request-sourced-fabric-change',
    'confirm-measurements',
    'respond-material-issue',
    'cancel-order',
    'request-cancellation-review',
    'request-delivery-review',
    'request-aftercare-support',
    'request-consultation',
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
  scheduledStartAt: isoDate.optional(),
  timezone: z.string().trim().max(80).optional(),
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
  | 'approve-sourced-fabric'
  | 'request-sourced-fabric-change'
  | 'confirm-measurements'
  | 'respond-material-issue'
  | 'cancel-order'
  | 'request-cancellation-review'
  | 'request-delivery-review'
  | 'request-aftercare-support'
  | 'request-consultation'

type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  garment_type?: string | null
  item_title?: string | null
  item_size?: string | null
  fabric_source?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  currency?: string | null
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
  'approve-sourced-fabric': PRE_CUTTING_STAGES,
  'request-sourced-fabric-change': PRE_CUTTING_STAGES,
  'confirm-measurements': PRE_CUTTING_STAGES,
  'respond-material-issue': PRE_CUTTING_STAGES,
  'cancel-order': ['PENDING_QUOTE', 'CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
  'request-cancellation-review': ['CONFIRMED', 'DESIGNING', 'SOURCING', 'FINISHING'],
  'request-delivery-review': ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED'],
  'request-aftercare-support': ['DELIVERED', 'COLLECTED', 'COMPLETE'],
  'request-consultation': ['PENDING_QUOTE'],
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
  'approve-sourced-fabric': { title: 'Fabric approved', body: 'The customer approved the sourced fabric. Cutting can continue when the pattern is ready.' },
  'request-sourced-fabric-change': { title: 'Fabric changes requested', body: 'The customer asked for a sourced fabric change before cutting.' },
  'respond-material-issue': { title: 'Customer responded to fabric issue', body: 'The customer chose how they want to handle the material issue.' },
  'cancel-order': { title: 'Order cancelled', body: 'The customer cancelled this order before live production started.' },
  'request-cancellation-review': { title: 'Cancellation review requested', body: 'The customer asked Drape to review cancellation before handoff.' },
  'request-delivery-review': { title: 'Delivery review requested', body: 'The customer asked Drape to review a dispatch or delivery issue.' },
  'request-aftercare-support': { title: 'Aftercare support requested', body: 'The customer asked Drape to review a post-delivery fit or finish issue.' },
  'request-consultation': { title: 'Consultation requested', body: 'A customer asked for a consultation. Approve, price, reschedule, or decline from the order.' },
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
const AFTERCARE_WINDOW_DAYS = 14
const AFTERCARE_WINDOW_MS = AFTERCARE_WINDOW_DAYS * 24 * 60 * 60 * 1000

const STAGE_NOTE: Partial<Record<Action, string>> = {
  'confirm-receipt': 'Customer confirmed receipt of their order.',
  'accept-quote':    'Customer accepted the quote and started payment.',
  'decline-quote':   'Customer declined the quote.',
  'complete-order':  'Order marked complete.',
}

function queueTailorOrderEmail(
  supabase: any,
  order: OrderRow,
  subject: string,
  body: string,
) {
  if (!order.tailor_id) return
  EdgeRuntime.waitUntil(
    enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.tailor_id.toString(),
      audience: 'TAILOR',
      subject,
      body,
      source: FN,
      idempotencyKey: `${FN}:${order.id}:tailor-email:${subject}`,
    }),
  )
}

async function sendPushToUser(
  supabase: any,
  userId: string,
  notification: {
    title: string
    body: string
    data?: Record<string, string>
    preferenceKey?: string
  },
) {
  const orderId = notification.data?.orderId ?? notification.data?.order_id ?? null
  const eventKey = notification.data?.event ?? notification.data?.type ?? notification.data?.stage ?? notification.preferenceKey ?? notification.title
  await enqueuePushJob(supabase, {
    userId,
    notification,
    source: FN,
    orderId,
    idempotencyKey: `${FN}:${userId}:${orderId ?? 'user'}:${eventKey}:${notification.body}`,
  })
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

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

function validateScheduledStartAt(value: string | undefined, minLeadMinutes: number) {
  if (!value) return 'Choose a consultation time before sending the request.'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Choose a valid consultation time.'
  const min = Date.now() + minLeadMinutes * 60 * 1000
  if (timestamp < min) return `Choose a time at least ${minLeadMinutes} minutes from now.`
  const max = Date.now() + 30 * 24 * 60 * 60 * 1000
  if (timestamp > max) return 'Choose a consultation time within the next 30 days.'
  return null
}

function aftercareWindowClosesAt(order: OrderRow) {
  const anchor = order.customer_handoff_confirmed_at ?? order.handoff_completed_at
  if (!anchor) return null
  const parsed = Date.parse(anchor)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed + AFTERCARE_WINDOW_MS).toISOString()
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Verify caller is authenticated
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before updating this order.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json())
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
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
      return rateLimitExceededResponse(cors)
    }

    const orderSelect =
      'id, reference, stage, order_kind, customer_id, tailor_id, garment_type, item_title, item_size, fabric_source, quoted_amount, quoted_currency, currency, consultation_fee, quote_expires_at, delivery_method, delivery_address, recipient_name, recipient_phone, fulfillment_fee, fulfillment_payment_requested_at, fulfillment_payment_paid_at, special_note, customer_measurements_snapshot, handoff_completed_at, customer_handoff_confirmed_at, handoff_confirmation_source'

    // Fetch order — verify ownership and current stage
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(orderSelect)
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: orderError.message })
      return jsonResponse({ error: 'We could not load this order right now. Please try again.' }, 500, cors)
    }

    const order = orderData as unknown as OrderRow | null
    const actionPreflight = runPreflight([
      {
        name: 'order_exists',
        condition: !!order,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'This order could not be found anymore.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { orderId },
      },
      {
        name: 'customer_owns_order',
        condition: order?.customer_id?.toString() === caller.id,
        errorCode: 'ORDER_FORBIDDEN',
        message: 'This order is not available from your account.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { callerId: caller.id, customerId: order?.customer_id ?? null },
      },
      {
        name: 'action_allowed_from_stage',
        condition: !!order?.stage && VALID_FROM[action].includes(order.stage),
        errorCode: 'INVALID_ORDER_STAGE',
        message: 'This order changed while you were away. Refresh the order before continuing.',
        field: 'stage',
        severity: 'BLOCKING',
        actual: { stage: order?.stage ?? null, action },
      },
    ])

    if (!actionPreflight.passed) {
      await logPreflightFailure(supabase, actionPreflight, {
        operation: `customer_order_${action.replaceAll('-', '_')}`,
        entityType: 'order',
        entityId: orderId,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        orderId,
        source: FN,
      })
      return preflightFailureResponse(
        actionPreflight,
        cors,
        !order ? 404 : order.customer_id?.toString() !== caller.id ? 403 : 409,
      )
    }
    if (!order) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found anymore.')

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

    if (action === 'request-consultation') {
      if (order.order_kind && order.order_kind !== 'CUSTOM') {
        return jsonError(cors, 409, 'CONSULTATION_NOT_AVAILABLE', 'Consultations are only available before custom quotes.')
      }

      if (consultationMeta && consultationMeta.status !== 'DECLINED') {
        return jsonError(cors, 409, 'CONSULTATION_ALREADY_OPEN', 'A consultation request is already attached to this order.')
      }

      const scheduledError = validateScheduledStartAt(parsed.data.scheduledStartAt, 120)
      if (scheduledError) {
        return jsonError(cors, 400, 'CONSULTATION_TIME_REQUIRED', scheduledError)
      }

      const now = new Date().toISOString()
      const slotAvailability = await assertConsultationSlotAvailable(supabase, {
        orderId,
        tailorId: order.tailor_id!.toString(),
        scheduledStartAt: parsed.data.scheduledStartAt!,
      })
      if (!slotAvailability.ok) {
        return jsonError(cors, slotAvailability.status, slotAvailability.code, slotAvailability.error)
      }

      const nextSupportMeta = {
        ...supportMeta,
        consultation: {
          status: 'REQUESTED' as const,
          requestedBy: 'CUSTOMER' as const,
          feeMode: null,
          feeAmount: null,
          feeCurrency: null,
          feeCreditable: null,
          feeCreditedTowardQuote: false,
          paymentProvider: null,
          paymentIntentId: null,
          paymentCheckoutUrl: null,
          paymentTiming: 'BEFORE_CALL_STARTS' as const,
          paidAt: null,
          reschedulePolicy: 'ONE_FREE_RESCHEDULE' as const,
          noShowPolicy: 'CASE_BY_CASE' as const,
          expiryPolicy: 'EXPIRES_IN_14_DAYS' as const,
          reminderEnabled: true,
          requestNote: parsed.data.note?.trim() || null,
          requestedAt: now,
          proposedStartAt: parsed.data.scheduledStartAt!,
          scheduledStartAt: null,
          scheduledEndAt: null,
          timezone: parsed.data.timezone?.trim() || null,
          approvedAt: null,
          approvedBy: null,
          declinedAt: null,
          declinedBy: null,
          declineReason: null,
          reminder30SentAt: null,
          reminder5SentAt: null,
        },
      }

      const { data: updatedOrder, error } = await supabase
        .from('orders')
        .update({
          stage: 'CONSULTATION',
          special_note: serializeOrderSupportMeta(nextSupportMeta),
          stage_updated_at: now,
        })
        .eq('id', orderId)
        .eq('stage', 'PENDING_QUOTE')
        .select('id')
        .maybeSingle()

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonError(cors, 500, 'CONSULTATION_REQUEST_FAILED', 'Could not request a consultation right now.')
      }

      if (!updatedOrder?.id) {
        return jsonError(
          cors,
          409,
          'ORDER_STATE_CHANGED',
          'This order changed while you were requesting the consultation. Refresh the order and try again if a consultation is still needed.',
        )
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'CONSULTATION',
        note: parsed.data.note?.trim()
          || `Customer requested a consultation before quote for ${parsed.data.scheduledStartAt}. Tailor approval is required before it is booked.`,
      })

      await audit(supabase, {
        event: 'consultation.requested',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: {
          requested_by: 'CUSTOMER',
          proposed_start_at: parsed.data.scheduledStartAt,
          timezone: parsed.data.timezone ?? null,
        },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['request-consultation']!,
            preferenceKey: 'newOrders',
            data: { orderId },
          }),
        )
        queueTailorOrderEmail(
          supabase,
          order,
          'Consultation requested',
          'A customer requested a consultation before quote. Approve, price, reschedule, or decline from the order so they are not left waiting.',
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (action === 'approve-sourced-fabric' || action === 'request-sourced-fabric-change') {
      if (order.order_kind !== 'CUSTOM' || order.fabric_source !== 'TAILOR_SOURCES') {
        return jsonError(cors, 409, 'FABRIC_APPROVAL_NOT_ALLOWED', 'Fabric approval only applies when the tailor is sourcing fabric for a custom order.')
      }

      if (action === 'request-sourced-fabric-change' && (parsed.data.note?.trim().length ?? 0) < 5) {
        return jsonError(cors, 400, 'FABRIC_CHANGE_NOTE_REQUIRED', 'Tell the tailor what should change about the sourced fabric.')
      }

      const { data: customDetail, error: detailReadError } = await supabase
        .from('custom_order_details')
        .select('fabric_approval_required, fabric_approval_status')
        .eq('order_id', orderId)
        .maybeSingle()

      if (detailReadError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: detailReadError.message, surface: 'custom_order_details' })
        return jsonError(cors, 500, 'FABRIC_APPROVAL_READ_FAILED', 'Could not check fabric approval right now.')
      }

      if (!customDetail?.fabric_approval_required || customDetail.fabric_approval_status !== 'PENDING_CUSTOMER_APPROVAL') {
        return jsonError(cors, 409, 'FABRIC_APPROVAL_NOT_PENDING', 'There is no sourced fabric waiting for approval right now.')
      }

      const nowIso = new Date().toISOString()
      const approvalStatus = action === 'approve-sourced-fabric' ? 'APPROVED' : 'CHANGES_REQUESTED'
      const { error: detailError } = await supabase
        .from('custom_order_details')
        .update({
          fabric_approval_status: approvalStatus,
          fabric_approved_at: action === 'approve-sourced-fabric' ? nowIso : null,
          fabric_changes_requested_at: action === 'request-sourced-fabric-change' ? nowIso : null,
        })
        .eq('order_id', orderId)

      if (detailError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: detailError.message, surface: 'custom_order_details' })
        return jsonError(cors, 500, 'FABRIC_APPROVAL_SAVE_FAILED', 'Could not save your fabric decision right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: action === 'approve-sourced-fabric'
          ? 'Customer approved the tailor-sourced fabric.'
          : `Customer requested sourced fabric changes: ${parsed.data.note?.trim()}`,
      })

      await audit(supabase, {
        event: action === 'approve-sourced-fabric' ? 'fabric.approved' : 'fabric.change_requested',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: {
          stage: order.stage,
          status: approvalStatus,
          note_length: parsed.data.note?.trim().length ?? 0,
        },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION[action]!,
            preferenceKey: 'newOrders',
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true, fabricApprovalStatus: approvalStatus }, 200, cors)
    }

    if (action === 'save-fabric-tracking') {
      const value = fabricTracking?.trim() ?? ''
      if (!value) return jsonResponse({ error: 'Add the fabric tracking number before saving.' }, 400, cors)
      if (hasBlockedContact(value)) {
        return jsonResponse({ error: "Contact details can't be included in tracking numbers." }, 400, cors)
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
        return jsonResponse({ error: 'We could not save fabric tracking right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'order.fabric_tracking_saved',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: orderId,
        payload: { length: value.length },
      })

      return jsonResponse({ ok: true, fabricTracking: value }, 200, cors)
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
        confirmedFields: Array.isArray(snapshot.confirmationFields) ? snapshot.confirmationFields : null,
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
        payload: { stage: order.stage, fields: Array.isArray(snapshot.confirmationFields) ? snapshot.confirmationFields : [] },
      })

      if (order.tailor_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.tailor_id.toString(), {
            ...TAILOR_NOTIFICATION['confirm-measurements']!,
            preferenceKey: 'newOrders',
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
            preferenceKey: 'newOrders',
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

      const aftercareClosesAt = aftercareWindowClosesAt(order)
      if (!aftercareClosesAt) {
        return jsonError(
          cors,
          400,
          'AFTERCARE_NOT_OPEN',
          'Confirm delivery or collection before opening aftercare in Drape.',
        )
      }
      if (Date.parse(aftercareClosesAt) < Date.now()) {
        return jsonError(
          cors,
          400,
          'AFTERCARE_WINDOW_CLOSED',
          'The 14-day aftercare window has closed. Email support@drapeon.co if this is a serious safety, fraud, or workmanship concern.',
        )
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
          aftercare_closes_at: aftercareClosesAt,
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
          aftercare_closes_at: aftercareClosesAt,
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

      const { data: existingDispute, error: existingDisputeError } = await supabase
        .from('disputes')
        .select('id, status')
        .eq('order_id', orderId)
        .maybeSingle()

      if (existingDisputeError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: existingDisputeError.message, surface: 'disputes.existing' })
        return jsonError(cors, 500, 'DISPUTE_READ_FAILED', 'Could not check existing concerns for this order right now.')
      }

      const disputePreflight = runPreflight([
        {
          name: 'no_existing_dispute',
          condition: !existingDispute?.id,
          errorCode: 'DISPUTE_ALREADY_EXISTS',
          message: 'A concern is already open for this order. Drape support is reviewing it.',
          field: 'orderId',
          severity: 'BLOCKING',
          actual: { disputeId: existingDispute?.id ?? null, status: existingDispute?.status ?? null },
        },
        {
          name: 'dispute_has_evidence',
          condition: description.trim().length >= 10,
          errorCode: 'DISPUTE_EVIDENCE_REQUIRED',
          message: 'Add a short description so Drape can understand what happened.',
          field: 'description',
          severity: 'BLOCKING',
          actual: { descriptionLength: description.trim().length },
        },
      ])

      if (!disputePreflight.passed) {
        await logPreflightFailure(supabase, disputePreflight, {
          operation: 'customer_order_open_dispute',
          entityType: 'order',
          entityId: orderId,
          actorId: caller.id,
          actorRole: 'CUSTOMER',
          orderId,
          source: FN,
        })
        return preflightFailureResponse(disputePreflight, cors, 409)
      }

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
          return jsonResponse({ error: 'We could not decline this quote right now. Please try again.' }, 500, cors)
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
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
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
          sendPushToUser(supabase, order.tailor_id.toString(), { ...notif, preferenceKey: 'newOrders', data: { orderId } })
        )
        queueTailorOrderEmail(supabase, order, notif.title, notif.body)
      }
    }

    return jsonResponse({ ok: true }, 200, cors)

  } catch (err) {
    log('error', FN, 'unhandled_exception', { error: String(err) })
    return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
  }
})
