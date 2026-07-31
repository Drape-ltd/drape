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
 *   advance-stage         CONFIRMED → DESIGNING|SOURCING|CUTTING → SEWING → FINISHING → READY_FOR_COLLECTION|READY_FOR_DRAPE_DISPATCH
 *                         When advancing to READY_FOR_COLLECTION: generates collection_code server-side
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import {
  MAX_COLLECTION_CODE_ATTEMPTS,
  readCollectionCodeAttempts,
  shouldResetCollectionCodeAttempts,
} from '../_shared/collection-code.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { log, audit } from '../_shared/logger.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { isSupportedTimeZone } from '../_shared/date-time.ts'
import {
  customerFulfillmentPaymentRequestedNotification,
  fulfillmentPaymentRequestedStageNote,
} from '../_shared/payment-copy.ts'
import { normalizeStoredPhone, validateDispatchPhone, validateRecipientPhone } from '../_shared/phone.ts'
import {
  buildTailorOrderDeclineTerminalRequest,
} from '../../../packages/shared/src/order-terminal.ts'
import { canTransition, type OrderStage } from '../../../packages/shared/src/order-machine.ts'
import {
  buildCancellationReviewNote,
  buildDeliveryReviewNote,
  buildFabricReceivedNote,
  buildFitProfileReviewedNote,
  buildMaterialIssueNote,
  buildMeasurementConfirmationRequestNote,
  buildScopeChangeRequestNote,
  buildScopeChangeResponseNote,
  CANCELLATION_REVIEW_REASON_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  FABRIC_HANDOFF_LABELS,
  fitProfileNeedsTailorReview,
  hasOpenScopeChange,
  MATERIAL_ISSUE_REASON_LABELS,
  materialIssueBlocksCutting,
  MEASUREMENT_SOURCE_LABELS,
  parseMeasurementSnapshot,
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
  SCOPE_CHANGE_TYPE_LABELS,
} from '../_shared/order-support.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'
import { refundSettledOrderPayments } from '../_shared/payment-refunds.ts'

function normalizeMeasurementSource(value: unknown) {
  return value === 'HELPER_GUIDED' ||
    value === 'TAILOR_CAPTURED' ||
    value === 'EXTERNAL_PRO_CAPTURED' ||
    value === 'DRAPE_VISION' ||
    value === 'TAILOR_ASSISTED_DRAPE_VISION'
    ? value
    : 'SELF_GUIDED'
}

function normalizeMeasurementConfirmationFields(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const fields: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const field = item.trim().slice(0, 80)
    if (!field || seen.has(field.toLowerCase())) continue
    seen.add(field.toLowerCase())
    fields.push(field)
    if (fields.length >= 20) break
  }
  return fields
}
import { deriveTailorReadiness } from '../_shared/tailor-readiness.ts'
import { z, parseBody, uuid, isoDate } from '../_shared/validate.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import {
  releaseConsultationSlot,
  reserveConsultationSlot,
} from '../_shared/consultation-bookings.ts'
import { resolveDrapeManagedFulfillmentFee } from '../../../packages/shared/src/fulfillment-fees.ts'
import { deriveCancellationPolicy } from '../../../packages/shared/src/cancellation-policy.ts'
import { buildCustomerStageSms } from '../../../packages/shared/src/sms-copy.ts'
import { normalizeAccountCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  CUSTOM_PRODUCTION_STAGE_REQUIREMENTS,
  CUSTOM_PRODUCTION_STAGE_LABELS,
  type CustomProductionStageKey,
} from '../../../packages/shared/src/custom-order-flow.ts'
import { normalizeTaxCountryCode } from '../../../packages/shared/src/tax.ts'
import { notificationDestinationData } from '../../../packages/shared/src/notification-policy.ts'
import { calculateLockedOrderAmountsWithTaxBase, resolveOrderTax } from '../_shared/tax.ts'

const MAX_MONEY_MINOR_UNITS = 999_999_999
const QUOTE_NEGOTIATION_V1 = Deno.env.get('QUOTE_NEGOTIATION_V1') === 'true'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    orderId:        uuid,
    action:         z.literal('send-quote'),
    amount:         z.number().int().positive().max(MAX_MONEY_MINOR_UNITS),
    fulfillmentFee: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
    currency:       z.string().trim().min(2).max(5),
    completionDate: isoDate,
    breakdown: z.object({
      laborAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
      sourcingAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
      rushAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
      included: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
      excluded: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
      summary: z.string().trim().max(300).optional(),
    }).optional(),
    note:           z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId:        uuid,
    action:         z.literal('revise-quote'),
    quoteId:        uuid,
    expectedQuoteVersion: z.number().int().positive(),
    revisionRequestId: uuid.optional(),
    changeKind: z.enum(['CUSTOMER_REVISION', 'TAILOR_CORRECTION', 'UNCHANGED_RENEWAL']),
    amount:         z.number().int().positive().max(MAX_MONEY_MINOR_UNITS),
    fulfillmentFee: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
    currency:       z.string().trim().min(2).max(5),
    completionDate: isoDate,
    breakdown: z.object({
      laborAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
      sourcingAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
      rushAmount: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).optional(),
      included: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
      excluded: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
      summary: z.string().trim().max(300).optional(),
    }).optional(),
    note:           z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('keep-current-quote'),
    quoteId: uuid,
    expectedQuoteVersion: z.number().int().positive(),
    revisionRequestId: uuid,
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('decline-after-revision'),
    quoteId: uuid,
    expectedQuoteVersion: z.number().int().positive(),
    revisionRequestId: uuid,
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('decline-order'),
    note:    z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId:         uuid,
    action:          z.literal('request-consultation'),
    consultationFee: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).nullable().optional(),
    currency: z.string().trim().min(2).max(5).optional(),
    creditFeeTowardOrder: z.boolean().optional(),
    paymentTiming: z.enum(['BEFORE_CALL_STARTS', 'WAIVED_OR_FREE']).optional(),
    reschedulePolicy: z.enum(['ONE_FREE_RESCHEDULE', 'FLEXIBLE_WITH_NOTICE', 'CASE_BY_CASE']).optional(),
    noShowPolicy: z.enum(['FEE_FORFEITED', 'ONE_REBOOK_ALLOWED', 'CASE_BY_CASE']).optional(),
    expiryPolicy: z.enum(['EXPIRES_IN_7_DAYS', 'EXPIRES_IN_14_DAYS', 'NO_EXPIRY']).optional(),
    reminderEnabled: z.boolean().optional(),
    scheduledStartAt: isoDate.optional(),
    timezone: z.string().trim().max(80).refine(isSupportedTimeZone, 'Choose a valid timezone.').optional(),
    note:            z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId:         uuid,
    action:          z.literal('approve-consultation'),
    consultationFee: z.number().int().nonnegative().max(MAX_MONEY_MINOR_UNITS).nullable().optional(),
    currency: z.string().trim().min(2).max(5).optional(),
    creditFeeTowardOrder: z.boolean().optional(),
    paymentTiming: z.enum(['BEFORE_CALL_STARTS', 'WAIVED_OR_FREE']).optional(),
    reschedulePolicy: z.enum(['ONE_FREE_RESCHEDULE', 'FLEXIBLE_WITH_NOTICE', 'CASE_BY_CASE']).optional(),
    noShowPolicy: z.enum(['FEE_FORFEITED', 'ONE_REBOOK_ALLOWED', 'CASE_BY_CASE']).optional(),
    expiryPolicy: z.enum(['EXPIRES_IN_7_DAYS', 'EXPIRES_IN_14_DAYS', 'NO_EXPIRY']).optional(),
    reminderEnabled: z.boolean().optional(),
    scheduledStartAt: isoDate,
    timezone: z.string().trim().max(80).refine(isSupportedTimeZone, 'Choose a valid timezone.').optional(),
    note:            z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('decline-consultation-request'),
    note:            z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('request-fulfillment-payment'),
    amount: z.number().int().positive().max(MAX_MONEY_MINOR_UNITS),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId:        uuid,
    action:         z.literal('advance-stage'),
    targetStage:    z.enum(['DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH']),
    note:           z.string().trim().min(10).max(300),
    photoUrl:       z.string().url().optional(),
    photoUrls:      z.array(z.string().url()).max(6).optional(),
    mediaFingerprints: z.array(z.string().trim().min(4).max(240)).max(6).optional(),
    trackingNumber: z.string().trim().max(50).optional(),
    carrier:        z.string().trim().max(50).optional(),
    fulfillmentProvider: z.string().trim().max(80).optional(),
    fulfillmentReference: z.string().trim().max(120).optional(),
    fulfillmentContactName: z.string().trim().max(120).optional(),
    fulfillmentContactPhone: z.string().trim().max(40).optional(),
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
    fields:  z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('confirm-fit-readiness'),
    note:    z.string().trim().min(10).max(300),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('request-style-alignment'),
    note:    z.string().trim().min(10).max(500),
    photoUrl: z.string().url().optional(),
  }),
  z.object({
    orderId: uuid,
    action:  z.literal('confirm-fabric-received'),
    note:    z.string().trim().max(300).optional(),
    photoUrl: z.string().url().optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('save-garment-qc'),
    note: z.string().trim().min(10).max(500),
    photoUrl: z.string().url().optional(),
    unit: z.enum(['in', 'cm']).default('in'),
    measurements: z.record(z.string(), z.number().positive().max(1000)).default({}),
    checks: z.object({
      seamsSecure: z.boolean().default(false),
      measurementsChecked: z.boolean().default(false),
      photoAttached: z.boolean().default(false),
      readyForHandoff: z.boolean().default(false),
    }).default({}),
    confidence: z.enum(['PASS', 'NEEDS_REVIEW']).default('PASS'),
    captureVersion: z.string().trim().max(40).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('request-scope-change'),
    scopeChangeType: z.enum([
      'MEASUREMENT_AMENDMENT',
      'STYLE_OR_REFERENCE',
      'FABRIC_OR_MATERIAL',
      'ADD_OR_REMOVE_ITEM',
      'DEADLINE_OR_EVENT',
      'PAUSE_OR_RESTART',
      'REWORK_OR_ALTERATION',
      'OTHER',
    ]),
    scopeChangeSummary: z.string().trim().min(10).max(500),
    scopeChangeImpacts: z.array(z.enum([
      'PRICE',
      'DEADLINE',
      'FIT',
      'FABRIC',
      'STYLE',
      'FULFILLMENT',
    ])).max(6).optional(),
    priceImpactMinor: z.number().int().min(-MAX_MONEY_MINOR_UNITS).max(MAX_MONEY_MINOR_UNITS).optional(),
    deadlineImpact: z.string().trim().max(120).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('respond-scope-change'),
    scopeChangeDecision: z.enum(['ACCEPTED', 'DECLINED', 'CANCELLED']),
    scopeChangeResponseNote: z.string().trim().max(300).optional(),
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
  z.object({
    orderId: uuid,
    action: z.literal('request-cancellation-review'),
    reason: z.enum([
      'ITEM_UNAVAILABLE',
      'ITEM_DAMAGED_BEFORE_DISPATCH',
      'TAILOR_CANNOT_FULFIL',
      'DISPATCH_DELAY',
      'OTHER',
    ]),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    orderId: uuid,
    action: z.literal('request-delivery-review'),
    reason: z.enum([
      'DISPATCH_DELAY',
      'DELIVERY_FAILED',
      'RETURN_TO_SENDER',
      'RECIPIENT_UNREACHABLE',
      'OTHER',
    ]),
    note: z.string().trim().max(300).optional(),
  }),
])

const FN = 'tailor-order-action'
const QUOTE_VALIDITY_HOURS = 48

function nextQuoteExpiryIso() {
  return new Date(Date.now() + QUOTE_VALIDITY_HOURS * 60 * 60 * 1000).toISOString()
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

function jsonErrorResponse(cors: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, cors)
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

function quoteNegotiationErrorResponse(cors: HeadersInit, error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error)
  const known = [
    'QUOTE_VERSION_CHANGED',
    'QUOTE_REVISION_NOT_OPEN',
    'PAID_ORDER_CANNOT_BE_REQUOTED',
    'REVISION_REQUEST_NOT_ALLOWED_FOR_CHANGE_KIND',
  ].find((code) => message.includes(code))
  const copy: Record<string, string> = {
    QUOTE_VERSION_CHANGED: 'The quote changed while you were editing it. Refresh the order before continuing.',
    QUOTE_REVISION_NOT_OPEN: 'The customer change request is no longer open.',
    PAID_ORDER_CANNOT_BE_REQUOTED: 'Paid orders cannot be requoted. Use the scope-change workflow instead.',
    REVISION_REQUEST_NOT_ALLOWED_FOR_CHANGE_KIND: 'This quote change does not match the selected revision type.',
  }
  const code = known ?? 'QUOTE_NEGOTIATION_FAILED'
  return jsonErrorResponse(cors, known ? 409 : 500, code, copy[code] ?? 'We could not update this quote right now.')
}

async function orderAlreadyScheduledForConsultation(
  supabase: SupabaseClient,
  orderId: string,
  scheduledStartAt: string,
) {
  const { data } = await supabase
    .from('orders')
    .select('stage, special_note')
    .eq('id', orderId)
    .maybeSingle()

  const consultation = parseOrderSupportMeta(data?.special_note ?? null).consultation
  return data?.stage === 'CONSULTATION' &&
    consultation?.status === 'SCHEDULED' &&
    consultation.scheduledStartAt === scheduledStartAt
}


type Action =
  | 'send-quote'
  | 'revise-quote'
  | 'keep-current-quote'
  | 'decline-after-revision'
  | 'decline-order'
  | 'request-consultation'
  | 'approve-consultation'
  | 'decline-consultation-request'
  | 'request-fulfillment-payment'
  | 'advance-stage'
  | 'confirm-collection'
  | 'request-measurement-confirmation'
  | 'confirm-fit-readiness'
  | 'request-style-alignment'
  | 'confirm-fabric-received'
  | 'save-garment-qc'
  | 'request-scope-change'
  | 'respond-scope-change'
  | 'open-material-issue'
  | 'request-cancellation-review'
  | 'request-delivery-review'
type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  tailor_id?: string | null
  customer_id?: string | null
  deadline?: string | null
  fabric_source?: string | null
  garment_type?: string | null
  item_title?: string | null
  item_size?: string | null
  special_note?: string | null
  customer_measurements_snapshot?: unknown
  delivery_method?: string | null
  delivery_address?: string | null
  delivery_city?: string | null
  delivery_region?: string | null
  delivery_postal_code?: string | null
  delivery_country_code?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  currency?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  consultation_fee?: number | null
  fulfillment_fee?: number | null
  tax_region?: string | null
  tax_fallback?: boolean | null
  tax_fallback_reason?: string | null
  fulfillment_payment_requested_at?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_provider?: string | null
  fulfillment_reference?: string | null
  fulfillment_contact_name?: string | null
  fulfillment_contact_phone?: string | null
  tracking_number?: string | null
  carrier?: string | null
  collection_code?: string | null
  collection_code_attempts?: number | null
  collection_code_last_attempt_at?: string | null
  updated_at?: string | null
  active_quote_id?: string | null
  active_quote_version?: number | null
  negotiation_round_limit?: number | null
  negotiation_rounds_used?: number | null
}

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const CUSTOM_ADVANCE_SOURCE_STAGES: OrderStage[] = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
]

const PRE_CUTTING_STAGES = ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING']
const SCOPE_CHANGE_STAGES = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
]

// Push notification sent to the CUSTOMER after each tailor action
const CUSTOMER_NOTIFICATION: Record<string, { title: string; body: string }> = {
  'send-quote':            { title: 'Quote received 💰',       body: 'Your tailor sent you a quote. Review it now.' },
  'revise-quote':          { title: 'Revised quote received',   body: 'Your tailor responded with a new formal quote.' },
  'keep-current-quote':    { title: 'Quote response received',  body: 'Your tailor reviewed your request and kept the current quote.' },
  'decline-after-revision':{ title: 'Order declined',           body: 'Your tailor could not continue after reviewing the requested changes.' },
  'decline-order':         { title: 'Order declined',           body: 'Your tailor was unable to accept this order.' },
  'request-consultation':  { title: 'Consultation scheduled',   body: 'Your tailor reserved a consultation slot. Review the time and pay first if a fee is required.' },
  'approve-consultation':  { title: 'Consultation approved',    body: 'Your tailor approved and reserved the consultation slot. Pay the fee if required before the call.' },
  'decline-consultation-request': { title: 'Consultation declined', body: 'Your tailor declined the consultation request but can still send a quote or message you.' },
  DESIGNING:               { title: 'Order update ✏️',          body: 'Your tailor is working through design details for your order.' },
  SOURCING:                { title: 'Order update 🧵',          body: 'Your tailor is sourcing materials for your order.' },
  CUTTING:                 { title: 'Order update ✂️',          body: 'Your tailor has started cutting the fabric.' },
  SEWING:                  { title: 'Order update 🧵',          body: 'Your tailor is now sewing your garment.' },
  FINISHING:               { title: 'Almost ready ✨',          body: 'Your tailor is putting the finishing touches on your order.' },
  READY_FOR_COLLECTION:    { title: 'Ready to collect! 📦',    body: 'Your order is ready. Show your collection code at pickup.' },
  READY_FOR_DRAPE_DISPATCH:{ title: 'Ready for Drapeon dispatch 📦', body: 'Your order is packed and ready for Drapeon dispatch.' },
  'request-measurement-confirmation': { title: 'Measurement check needed', body: 'Your tailor wants you to confirm your measurements before cutting starts.' },
  'confirm-fit-readiness': { title: 'Fit intake reviewed', body: 'Your tailor reviewed the guided fit intake attached to this order.' },
  'request-style-alignment': { title: 'Style approval needed', body: 'Your tailor explained how they will interpret your references before cutting.' },
  'confirm-fabric-received': { title: 'Fabric received', body: 'Your tailor confirmed they received your fabric.' },
  'save-garment-qc': { title: 'Quality check saved', body: 'Your tailor added a Drapeon Vision quality check to your order timeline.' },
  'request-scope-change': { title: 'Order change proposed', body: 'Your tailor proposed a formal change. Review it before production continues.' },
  'respond-scope-change': { title: 'Order change updated', body: 'Your tailor responded to the change request on this order.' },
  'open-material-issue': { title: 'Fabric issue needs your decision', body: 'Your tailor reviewed the fabric and needs your choice before production can continue.' },
  'request-cancellation-review': { title: 'Cancellation review requested', body: 'Your tailor asked Drapeon to review cancelling this order before handoff.' },
  'request-delivery-review': { title: 'Delivery review requested', body: 'Your tailor asked Drapeon to review a dispatch or delivery issue.' },
}

function isReadyMadeOrder(order: Pick<OrderRow, 'order_kind'>) {
  return order.order_kind === 'READY_MADE'
}

function validAdvanceStages(order: Pick<OrderRow, 'order_kind'>, targetStage: string) {
  if (!isReadyMadeOrder(order)) {
    return CUSTOM_ADVANCE_SOURCE_STAGES.filter((stage) => canTransition(stage, targetStage as OrderStage, 'TAILOR'))
  }

  if (targetStage === 'FINISHING') return ['CONFIRMED']
  if (targetStage === 'READY_FOR_COLLECTION') return ['FINISHING']
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return ['FINISHING']
  return []
}

function customerNotificationForStage(targetStage: string, order: Pick<OrderRow, 'order_kind'>) {
  if (isReadyMadeOrder(order) && targetStage === 'FINISHING') {
    return {
      title: 'Order update 📦',
      body: 'Your seller is preparing your order for dispatch or pickup.',
    }
  }

  return CUSTOMER_NOTIFICATION[targetStage]
}

function queueCustomerOrderEmail(
  supabase: SupabaseClient,
  order: OrderRow,
  subject: string,
  body: string,
  evidenceImageUrl?: string | null,
) {
  if (!order.customer_id) return
  EdgeRuntime.waitUntil(
    enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id.toString(),
      audience: 'CUSTOMER',
      subject,
      body,
      evidenceImageUrl,
      source: FN,
      idempotencyKey: `${FN}:${order.id}:customer-email:${subject}`,
    }),
  )
}

async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  notification: {
    title: string
    body: string
    data?: Record<string, string>
    preferenceKey?: string
  },
) {
  const orderId = notification.data?.orderId ?? notification.data?.order_id ?? null
  const eventKey =
    notification.data?.eventId ??
    notification.data?.quoteId ??
    notification.data?.event ??
    notification.data?.type ??
    notification.data?.stage ??
    notification.preferenceKey ??
    notification.title
  await enqueuePushJob(supabase, {
    userId,
    notification: {
      ...notification,
      data: orderId
        ? {
            ...notification.data,
            ...notificationDestinationData({ kind: 'ORDER', orderId }),
          }
        : notification.data,
    },
    source: FN,
    orderId,
    idempotencyKey: `${FN}:${userId}:${orderId ?? 'user'}:${eventKey}:${notification.body}`,
  })
}

async function sendSmsToUser(input: {
  supabase: SupabaseClient
  userId: string | null | undefined
  audience: 'CUSTOMER' | 'TAILOR'
  orderId?: string | null
  event: string
  body: string
  fallbackPhone?: string | null
}) {
  await enqueueSmsJob(input.supabase, {
    userId: input.userId,
    audience: input.audience,
    orderId: input.orderId ?? null,
    event: input.event,
    body: input.body,
    fallbackPhone: input.fallbackPhone ?? null,
    source: FN,
    idempotencyKey: `${FN}:${input.userId ?? 'unknown'}:${input.orderId ?? 'user'}:${input.event}`,
  })
}

/** Cryptographically random 4-digit collection code (1000–9999). */
function generateCollectionCode(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(1000 + (arr[0] % 9000))
}

function formatMoneyForNote(amountMinorUnits: number, currency: string | null | undefined) {
  const normalizedCurrency = (currency ?? 'USD').trim().toUpperCase() || 'USD'
  return `${normalizedCurrency} ${(amountMinorUnits / 100).toFixed(2)}`
}

async function auditFulfillmentHandoffBlocked(
  supabase: SupabaseClient,
  callerId: string,
  order: Pick<OrderRow, 'id' | 'stage' | 'delivery_method'>,
  reason: string,
  payload?: Record<string, unknown>,
) {
  await audit(supabase, {
    event: 'fulfillment.handoff_blocked',
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

function isCustomOrder(order: Pick<OrderRow, 'order_kind'>) {
  return order.order_kind === 'CUSTOM'
}

function uniquePhotoUrls(photoUrl?: string | null, photoUrls?: string[] | null) {
  return [...new Set([...(photoUrls ?? []), photoUrl ?? ''].map((value) => value.trim()).filter(Boolean))]
}

function uniqueMediaFingerprints(values?: string[] | null) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

async function findReusedProductionMedia(
  supabase: SupabaseClient,
  orderId: string,
  mediaUrls: string[],
  mediaFingerprints: string[],
) {
  const reused = new Set<string>()

  if (mediaUrls.length > 0) {
    const { data: updates, error: updatesError } = await supabase
      .from('order_stage_updates')
      .select('photo_url')
      .eq('order_id', orderId)
      .in('photo_url', mediaUrls)

    if (updatesError) throw new Error(updatesError.message)
    for (const row of updates ?? []) {
      if (typeof row.photo_url === 'string' && row.photo_url.trim()) reused.add(row.photo_url.trim())
    }
  }

  const { data: evidenceRows, error: evidenceError } = await supabase
    .from('order_production_evidence')
    .select('photo_urls, metadata')
    .eq('order_id', orderId)
    .limit(200)

  if (evidenceError) throw new Error(evidenceError.message)

  const mediaUrlSet = new Set(mediaUrls)
  const fingerprintSet = new Set(mediaFingerprints)

  for (const row of evidenceRows ?? []) {
    const photoUrls = Array.isArray(row.photo_urls) ? row.photo_urls : []
    for (const url of photoUrls) {
      if (typeof url === 'string' && mediaUrlSet.has(url.trim())) reused.add(url.trim())
    }

    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {}
    const storedFingerprints = Array.isArray(metadata.media_fingerprints)
      ? metadata.media_fingerprints
      : []
    for (const fingerprint of storedFingerprints) {
      if (typeof fingerprint === 'string' && fingerprintSet.has(fingerprint.trim())) {
        reused.add(fingerprint.trim())
      }
    }
  }

  return [...reused]
}

async function readCustomFabricApprovalForCutting(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from('custom_order_details')
    .select('fabric_approval_required, fabric_approval_status')
    .eq('order_id', orderId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return {
    required: data?.fabric_approval_required === true,
    status: typeof data?.fabric_approval_status === 'string' ? data.fabric_approval_status : null,
  }
}

function customProductionStageForTarget(targetStage: string, deliveryMethod?: string | null): CustomProductionStageKey {
  if (targetStage === 'SOURCING') return 'FABRIC'
  if (targetStage === 'DESIGNING') return 'PRE_CUTTING'
  if (targetStage === 'CUTTING') return 'CUTTING'
  if (targetStage === 'SEWING') return 'SEWING'
  if (targetStage === 'FINISHING') return 'FINISHING'
  if (targetStage === 'READY_FOR_COLLECTION') return 'QUALITY_CHECK'
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return deliveryMethod === 'LOCAL_COLLECTION' ? 'QUALITY_CHECK' : 'DISPATCHED'
  return 'PRE_CUTTING'
}

async function insertCustomProductionEvidence(
  supabase: SupabaseClient,
  input: {
    orderId: string
    stageKey: CustomProductionStageKey
    note: string | null
    photoUrls: string[]
    actorId: string
    metadata?: Record<string, unknown>
  },
) {
  const { error } = await supabase
    .from('order_production_evidence')
    .insert({
      order_id: input.orderId,
      stage_key: input.stageKey,
      note: input.note,
      photo_urls: input.photoUrls,
      actor_id: input.actorId,
      actor_role: 'TAILOR',
      metadata: input.metadata ?? {},
    })

  if (!error) {
    await queueMediaSafetyReview(supabase, {
      fn: FN,
      actorId: input.actorId,
      actorRole: 'TAILOR',
      surface: 'production_stage.evidence',
      publicUrls: input.photoUrls,
      purpose: 'PRODUCTION_STAGE',
      orderId: input.orderId,
      relatedEntityType: 'order',
      relatedEntityId: input.orderId,
      metadata: {
        stageKey: input.stageKey,
        ...(input.metadata ?? {}),
      },
    })
  }

  return error
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
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

    const body = parsed.data
    const { orderId, action } = body
    let sellerProfileLocation: string | null = null

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
      return rateLimitExceededResponse(cors)
    }

    if (action === 'send-quote' || action === 'revise-quote') {
      const { data: profile, error: profileError } = await supabase
        .from('tailor_profiles')
        .select('profile_completed, id_verification_status, stripe_account_id, paystack_account_id, stripe_connect_account_id, paystack_recipient_code, payout_account_verified, payout_reverification_required, payout_account_type, location')
        .eq('user_id', caller.id)
        .maybeSingle()

      if (profileError) {
        log('error', FN, 'db.error', { actor_id: caller.id, action, error: profileError.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      const readiness = deriveTailorReadiness(profile)
      sellerProfileLocation = profile?.location ?? null
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
      : 'id, reference, stage, order_kind, tailor_id, customer_id, deadline, fabric_source, garment_type, item_title, item_size, special_note, customer_measurements_snapshot, delivery_method, delivery_address, delivery_city, delivery_region, delivery_postal_code, delivery_country_code, recipient_name, recipient_phone, currency, quoted_amount, quoted_currency, consultation_fee, fulfillment_fee, tax_region, tax_fallback, tax_fallback_reason, fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, tracking_number, carrier, active_quote_id, active_quote_version, negotiation_round_limit, negotiation_rounds_used'

    // Fetch order — verify tailor ownership and current stage
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(orderSelect)
      .eq('id', orderId)
      .single()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: orderError.message })
      return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
    }

    const order = orderData as unknown as OrderRow | null
    if (!order) return jsonErrorResponse(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found anymore.')

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
      return jsonErrorResponse(cors, 403, 'FORBIDDEN', 'This order is not available from your tailor account.')
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

    if (action === 'keep-current-quote') {
      if (!QUOTE_NEGOTIATION_V1) {
        return jsonErrorResponse(cors, 409, 'QUOTE_NEGOTIATION_NOT_ENABLED', 'Formal quote changes are not enabled here yet.')
      }
      const { data, error } = await supabase.rpc('keep_current_order_quote', {
        p_order_id: orderId,
        p_tailor_id: caller.id,
        p_revision_request_id: body.revisionRequestId,
        p_quote_id: body.quoteId,
        p_expected_quote_version: body.expectedQuoteVersion,
        p_response_note: body.note?.trim() || null,
      })
      if (error) return quoteNegotiationErrorResponse(cors, error)

      const result = (data ?? {}) as Record<string, unknown>
      const eventId = typeof result.eventId === 'string' ? result.eventId : ''
      const notification = CUSTOMER_NOTIFICATION['keep-current-quote']
      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...notification,
            preferenceKey: 'quotes',
            data: {
              orderId,
              destination: 'messages',
              eventId,
              quoteId: body.quoteId,
            },
          }),
        )
        EdgeRuntime.waitUntil(
          enqueueOrderEventEmailJob(supabase, {
            order,
            recipientUserId: order.customer_id.toString(),
            audience: 'CUSTOMER',
            subject: notification.title,
            headline: notification.title,
            body: notification.body,
            ctaLabel: 'Review in Drapeon',
            source: FN,
            idempotencyKey: `${action}:${orderId}:${eventId || body.revisionRequestId}`,
          }),
        )
      }
      return jsonResponse({ ok: true, ...result }, 200, cors)
    }

    if (action === 'decline-after-revision') {
      if (!QUOTE_NEGOTIATION_V1) {
        return jsonErrorResponse(cors, 409, 'QUOTE_NEGOTIATION_NOT_ENABLED', 'Formal quote changes are not enabled here yet.')
      }
      const { data, error } = await supabase.rpc('decline_order_after_quote_revision', {
        p_order_id: orderId,
        p_quote_id: body.quoteId,
        p_tailor_id: caller.id,
        p_expected_quote_version: body.expectedQuoteVersion,
        p_revision_request_id: body.revisionRequestId,
        p_response_note: body.note?.trim() || null,
      })
      if (error) return quoteNegotiationErrorResponse(cors, error)

      const result = (data ?? {}) as Record<string, unknown>
      const eventId = typeof result.eventId === 'string' ? result.eventId : ''

      const notification = CUSTOMER_NOTIFICATION['decline-after-revision']
      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...notification,
            preferenceKey: 'quotes',
            data: {
              orderId,
              destination: 'messages',
              eventId,
              quoteId: body.quoteId,
            },
          }),
        )
        EdgeRuntime.waitUntil(
          enqueueOrderEventEmailJob(supabase, {
            order,
            recipientUserId: order.customer_id.toString(),
            audience: 'CUSTOMER',
            subject: notification.title,
            headline: notification.title,
            body: notification.body,
            ctaLabel: 'Review closed order',
            source: FN,
            idempotencyKey: `decline-after-revision:${orderId}:${eventId || body.quoteId}`,
          }),
        )
      }
      await audit(supabase, {
        event: 'quote.declined_after_revision',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: {
          quote_id: body.quoteId,
          quote_version: body.expectedQuoteVersion,
          revision_request_id: body.revisionRequestId,
          event_id: eventId || null,
        },
      })
      return jsonResponse({ ok: true, ...result }, 200, cors)
    }

    if (action === 'request-style-alignment') {
      if (order.order_kind !== 'CUSTOM') {
        return jsonErrorResponse(cors, 409, 'STYLE_ALIGNMENT_NOT_AVAILABLE', 'Style approval only applies to custom orders.')
      }
      if (!PRE_CUTTING_STAGES.includes(order.stage)) {
        return jsonErrorResponse(cors, 409, 'STYLE_ALIGNMENT_STAGE_CLOSED', 'This order is too far along for pre-cutting style approval.')
      }

      const meta = parseOrderSupportMeta(order.special_note)
      const now = new Date().toISOString()
      const nextMeta = {
        ...meta,
        styleAlignment: {
          ...(meta.styleAlignment ?? {}),
          requiredBeforeCutting: true,
          status: 'PENDING_CUSTOMER_APPROVAL' as const,
          tailorInterpretation: body.note.trim(),
          approvalRequestedAt: now,
          referencePhotoCount: meta.styleAlignment?.referencePhotoCount ?? null,
          styleReferenceLinkCount: meta.styleAlignment?.styleReferenceLinkCount ?? null,
          instruction: meta.styleAlignment?.instruction ??
            'Before cutting, confirm what can and cannot be matched from the customer references inside Drapeon.',
          customerExpectation: meta.styleAlignment?.customerExpectation ??
            'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.',
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonErrorResponse(cors, 500, 'STYLE_ALIGNMENT_SAVE_FAILED', 'Could not request style approval right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: `Tailor requested style approval before cutting: ${body.note.trim()}`,
        photo_url: body.photoUrl ?? null,
      })

      await audit(supabase, {
        event: 'style_alignment.requested',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: 'warn',
        payload: {
          stage: order.stage,
          has_photo: !!body.photoUrl,
        },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-style-alignment'],
            preferenceKey: 'orderUpdates',
            data: { orderId, type: 'style_alignment' },
          }),
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Style approval needed',
          'Your tailor explained how they will interpret your references. Approve it or request changes before cutting starts.',
        )
      }

      return jsonResponse({ ok: true, styleAlignmentStatus: 'PENDING_CUSTOMER_APPROVAL' }, 200, cors)
    }

    if (action === 'request-scope-change') {
      if (order.order_kind && order.order_kind !== 'CUSTOM') {
        return jsonErrorResponse(
          cors,
          409,
          'SCOPE_CHANGE_NOT_AVAILABLE',
          'Ready-made orders use dispatch, delivery, or aftercare review instead of scope changes.',
        )
      }

      if (!SCOPE_CHANGE_STAGES.includes(order.stage)) {
        return jsonErrorResponse(
          cors,
          409,
          'SCOPE_CHANGE_STAGE_CLOSED',
          'This order is too far along for a standard change request. Use delivery review or aftercare instead.',
        )
      }

      const blockedSummary = await rejectIfBlockedContact({
        supabase,
        fn: FN,
        cors,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'tailor_order.request-scope-change.summary',
        text: body.scopeChangeSummary,
        message: "Contact details can't be included in a change request.",
        orderId,
        extra: { action, scopeChangeType: body.scopeChangeType },
      })
      if (blockedSummary) return blockedSummary

      const meta = parseOrderSupportMeta(order.special_note)
      if (hasOpenScopeChange(meta)) {
        return jsonErrorResponse(cors, 409, 'SCOPE_CHANGE_ALREADY_OPEN', 'There is already an open change request on this order.')
      }

      const typeLabel = SCOPE_CHANGE_TYPE_LABELS[body.scopeChangeType]
      const impacts = body.scopeChangeImpacts ?? []
      const now = new Date().toISOString()
      const nextMeta = {
        ...meta,
        scopeChange: {
          status: 'OPEN' as const,
          requestedBy: 'TAILOR' as const,
          type: body.scopeChangeType,
          typeLabel,
          summary: body.scopeChangeSummary.trim(),
          impacts,
          priceImpactMinor: typeof body.priceImpactMinor === 'number' ? body.priceImpactMinor : null,
          deadlineImpact: body.deadlineImpact?.trim() || null,
          requestedAt: now,
          requestedFromStage: order.stage,
          respondedAt: null,
          respondedBy: null,
          responseNote: null,
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonErrorResponse(cors, 500, 'SCOPE_CHANGE_FAILED', 'Could not send this change request right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildScopeChangeRequestNote('TAILOR', typeLabel, body.scopeChangeSummary.trim(), impacts),
      })

      await audit(supabase, {
        event: 'order.scope_change_requested',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: impacts.includes('PRICE') || impacts.includes('DEADLINE') ? 'warn' : 'info',
        payload: {
          requested_by: 'TAILOR',
          type: body.scopeChangeType,
          impacts,
          price_impact_minor: typeof body.priceImpactMinor === 'number' ? body.priceImpactMinor : null,
          deadline_impact: body.deadlineImpact?.trim() || null,
          from_stage: order.stage,
        },
      })

      const needsOpsAwareness =
        ['CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage) ||
        impacts.includes('PRICE') ||
        impacts.includes('DEADLINE')

      if (needsOpsAwareness) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'ORDER_REVIEW',
          severity: 'MEDIUM',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          orderId,
          userId: caller.id,
          stage: order.stage,
          title: 'Scope change proposed',
          description: `Tailor proposed a ${typeLabel.toLowerCase()} from ${order.stage}.`,
          recommendedAction: 'Confirm whether the customer needs to approve price, deadline, fit, or fabric changes before production continues.',
          dedupeKey: `order-review:scope-change:${orderId}`,
          metadata: {
            review_type: 'SCOPE_CHANGE',
            requested_by: 'TAILOR',
            type: body.scopeChangeType,
            impacts,
            price_impact_minor: typeof body.priceImpactMinor === 'number' ? body.priceImpactMinor : null,
            deadline_impact: body.deadlineImpact?.trim() || null,
            from_stage: order.stage,
          },
        })
      }

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-scope-change'],
            preferenceKey: 'orderUpdates',
            data: { orderId, type: 'scope_change' },
          }),
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Order change proposed',
          `Your tailor proposed a ${typeLabel.toLowerCase()}. Review the order before production continues so price, deadline, fit, or fabric changes stay on record.`,
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (action === 'respond-scope-change') {
      const meta = parseOrderSupportMeta(order.special_note)
      if (!meta.scopeChange || meta.scopeChange.status !== 'OPEN') {
        return jsonErrorResponse(cors, 409, 'SCOPE_CHANGE_NOT_OPEN', 'There is no open change request on this order.')
      }
      if (body.scopeChangeDecision === 'CANCELLED' && meta.scopeChange.requestedBy !== 'TAILOR') {
        return jsonErrorResponse(cors, 403, 'SCOPE_CHANGE_CANCEL_FORBIDDEN', 'Only the person who opened this proposal can cancel it.')
      }
      if (body.scopeChangeDecision !== 'CANCELLED' && meta.scopeChange.requestedBy !== 'CUSTOMER') {
        return jsonErrorResponse(cors, 403, 'SCOPE_CHANGE_RESPONSE_FORBIDDEN', 'The customer still needs to respond to this proposal.')
      }

      const responseNote = body.scopeChangeResponseNote?.trim() ?? ''
      if (responseNote) {
        const blockedResponse = await rejectIfBlockedContact({
          supabase,
          fn: FN,
          cors,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface: 'tailor_order.respond-scope-change.note',
          text: responseNote,
          message: "Contact details can't be included in a change response.",
          orderId,
          extra: { action, decision: body.scopeChangeDecision },
        })
        if (blockedResponse) return blockedResponse
      }

      const typeLabel =
        meta.scopeChange.typeLabel ??
        (meta.scopeChange.type ? SCOPE_CHANGE_TYPE_LABELS[meta.scopeChange.type] : 'Order change')
      const now = new Date().toISOString()
      const nextMeta = {
        ...meta,
        scopeChange: {
          ...meta.scopeChange,
          status: body.scopeChangeDecision,
          respondedAt: now,
          respondedBy: 'TAILOR' as const,
          responseNote: responseNote || null,
        },
      }

      const { error } = await supabase
        .from('orders')
        .update({ special_note: serializeOrderSupportMeta(nextMeta) })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonErrorResponse(cors, 500, 'SCOPE_CHANGE_RESPONSE_FAILED', 'Could not update this change request right now.')
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildScopeChangeResponseNote('TAILOR', body.scopeChangeDecision, typeLabel, responseNote || null),
      })

      await audit(supabase, {
        event: 'order.scope_change_responded',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: body.scopeChangeDecision === 'DECLINED' ? 'warn' : 'info',
        payload: {
          decision: body.scopeChangeDecision,
          requested_by: meta.scopeChange.requestedBy ?? null,
          type: meta.scopeChange.type ?? null,
          from_stage: meta.scopeChange.requestedFromStage ?? order.stage,
        },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['respond-scope-change'],
            preferenceKey: 'orderUpdates',
            data: { orderId, type: 'scope_change_response' },
          }),
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Order change updated',
          `Your tailor ${body.scopeChangeDecision === 'ACCEPTED' ? 'accepted' : body.scopeChangeDecision === 'DECLINED' ? 'declined' : 'cancelled'} the ${typeLabel.toLowerCase()} request. Review the order timeline before continuing.`,
        )
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

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

      const source = normalizeMeasurementSource(snapshot.measurementSource)
      const sourceLabel = MEASUREMENT_SOURCE_LABELS[source]
      const now = new Date().toISOString()
      const confirmationFields = normalizeMeasurementConfirmationFields('fields' in body ? body.fields : [])
      const nextSnapshot = {
        ...snapshot,
        needsConfirmation: true,
        confirmationReason: body.note.trim(),
        confirmationFields,
        confirmationRequestedAt: now,
        confirmedAt: null,
        confirmedBy: null,
        confirmedFields: null,
      }

      const { error } = await supabase
        .from('orders')
        .update({ customer_measurements_snapshot: nextSnapshot })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildMeasurementConfirmationRequestNote(
          confirmationFields.length
            ? `${body.note.trim()} Fields: ${confirmationFields.join(', ')}.`
            : body.note.trim(),
          sourceLabel,
        ),
      })

      await audit(supabase, {
        event: 'measurements.confirmation_requested',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { stage: order.stage, measurement_source: source, fields: confirmationFields },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-measurement-confirmation'],
            preferenceKey: 'orderUpdates',
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

      if (isCustomOrder(order) && !body.photoUrl?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Add a fabric receipt photo before confirming fabric was received.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
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
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note: buildFabricReceivedNote(handoffLabel, body.note ?? null),
        photo_url: body.photoUrl ?? null,
      })

      if (isCustomOrder(order)) {
        const evidenceError = await insertCustomProductionEvidence(supabase, {
          orderId,
          stageKey: 'FABRIC',
          note: body.note?.trim() || 'Customer fabric received.',
          photoUrls: uniquePhotoUrls(body.photoUrl),
          actorId: caller.id,
          metadata: {
            fabric_source: order.fabric_source,
            handoff_mode: handoffMode,
          },
        })
        if (evidenceError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: evidenceError.message, surface: 'order_production_evidence' })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }
      }

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
            preferenceKey: 'orderUpdates',
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
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
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
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'save-garment-qc') {
      const measurementEntries = Object.entries(body.measurements ?? {})
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0)
      const hasQcCheck = Object.values(body.checks ?? {}).some((value) => value === true)
      const hasPhoto = Boolean(body.photoUrl?.trim())
      const blockedStages = new Set(['CANCELLED', 'DECLINED', 'COMPLETED', 'DELIVERED', 'DISPUTED'])

      const qcPreflight = runPreflight([
        {
          name: 'order_active_for_quality_check',
          condition: !blockedStages.has(order.stage),
          errorCode: 'ORDER_NOT_ACTIVE_FOR_QC',
          message: 'This order is no longer active, so a quality check cannot be added.',
          field: 'stage',
          severity: 'BLOCKING',
          actual: { stage: order.stage },
        },
        {
          name: 'qc_has_evidence',
          condition: measurementEntries.length > 0 || hasQcCheck || hasPhoto,
          errorCode: 'QC_EVIDENCE_REQUIRED',
          message: 'Add at least one measurement, checklist item, or proof photo before saving quality control.',
          field: 'measurements',
          severity: 'BLOCKING',
          actual: {
            measurementCount: measurementEntries.length,
            hasPhoto,
            hasQcCheck,
          },
        },
      ])

      if (!qcPreflight.passed) {
        await logPreflightFailure(supabase, qcPreflight, {
          operation: 'save_garment_qc',
          entityType: 'order',
          entityId: orderId,
          actorId: caller.id,
          actorRole: 'TAILOR',
          orderId,
          source: FN,
          metadata: { stage: order.stage, action },
        })
        return preflightFailureResponse(qcPreflight, cors, 409)
      }

      const now = new Date().toISOString()
      const normalizedMeasurements = Object.fromEntries(measurementEntries)
      const note = `Drapeon Vision QC: ${body.note.trim()}`
      const photoUrls = uniquePhotoUrls(body.photoUrl)

      const stageUpdate = await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: order.stage,
        note,
        photo_url: photoUrls[0] ?? null,
      })

      if (stageUpdate.error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: stageUpdate.error.message, surface: 'order_stage_updates' })
        return jsonResponse({ error: 'We could not save this quality check right now. Please try again.' }, 500, cors)
      }

      const evidenceError = await insertCustomProductionEvidence(supabase, {
        orderId,
        stageKey: 'QUALITY_CHECK',
        note: body.note.trim(),
        photoUrls,
        actorId: caller.id,
        metadata: {
          source: 'DRAPE_VISION_GARMENT_QC',
          order_stage: order.stage,
          capture_version: body.captureVersion ?? null,
          recorded_at: now,
          measurement_unit: body.unit,
          measurements: normalizedMeasurements,
          checks: body.checks,
          confidence: body.confidence,
        },
      })

      if (evidenceError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: evidenceError.message, surface: 'order_production_evidence' })
        return jsonResponse({ error: 'We could not save this quality check right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'order.quality_check_saved',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: {
          function: FN,
          stage: order.stage,
          source: 'DRAPE_VISION_GARMENT_QC',
          measurement_count: measurementEntries.length,
          has_photo: hasPhoto,
          confidence: body.confidence,
        },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['save-garment-qc'],
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
      }

      return jsonResponse({ ok: true, measurementCount: measurementEntries.length, hasPhoto }, 200, cors)
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
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      if (isCustomOrder(order)) {
        const { error: detailError } = await supabase
          .from('custom_order_details')
          .update({
            fabric_approval_status: 'UNSUITABLE',
            fabric_marked_unsuitable_at: now,
          })
          .eq('order_id', orderId)

        if (detailError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: detailError.message, surface: 'custom_order_details' })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }

        await createOrRefreshOpsIssue(supabase, {
          issueType: 'FABRIC_APPROVAL',
          severity: 'HIGH',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          orderId,
          userId: caller.id,
          stage: order.stage,
          title: 'Fabric marked unsuitable',
          description: `Tailor flagged customer-provided fabric as unsuitable: ${reasonLabel}.`,
          recommendedAction: 'Review the tailor note, customer response, and fabric evidence before allowing production to continue.',
          dedupeKey: `fabric-unsuitable:${orderId}`,
          metadata: {
            reason: body.reason,
            reason_label: reasonLabel,
            from_stage: order.stage,
          },
        })
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
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'request-cancellation-review') {
      const meta = parseOrderSupportMeta(order.special_note)
      if (meta.cancellationReview?.status === 'OPEN') {
        return new Response(
          JSON.stringify({ error: 'A cancellation review is already open on this order.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const cancellationPolicy = deriveCancellationPolicy({
        orderKind: order.order_kind === 'READY_MADE' ? 'READY_MADE' : 'CUSTOM',
        stage: order.stage as any,
        deliveryMethod: order.delivery_method ?? null,
        consultationFee: order.consultation_fee ?? null,
        consultationPaidAt: meta.consultation?.paidAt ?? null,
        consultationFeeCreditable: meta.consultation?.feeCreditable ?? null,
        fulfillmentFee: order.fulfillment_fee ?? null,
        fulfillmentPaymentRequestedAt: order.fulfillment_payment_requested_at ?? null,
        fulfillmentPaymentPaidAt: order.fulfillment_payment_paid_at ?? null,
        dispatchBookedAt: meta.dispatchRecord?.bookedAt ?? null,
        premiumDispatch: meta.dispatchRecord?.premiumException ?? null,
      })

      if (!cancellationPolicy.tailorCanRequestReview) {
        return new Response(
          JSON.stringify({ error: `Cannot request cancellation review from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const reasonLabel = CANCELLATION_REVIEW_REASON_LABELS[body.reason]
      const nextMeta = {
        ...meta,
        cancellationReview: {
          status: 'OPEN' as const,
          requestedBy: 'TAILOR' as const,
          reason: body.reason,
          reasonLabel,
          note: body.note?.trim() || null,
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
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'IN_DISPUTE',
        note: buildCancellationReviewNote('TAILOR', reasonLabel, body.note ?? null),
      })

      await audit(supabase, {
        event: 'order.cancellation_review_requested',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: 'warn',
        payload: { reason: body.reason, from_stage: order.stage },
      })

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'ORDER_REVIEW',
        severity: 'HIGH',
        source: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        orderId,
        userId: caller.id,
        stage: order.stage,
        title: 'Cancellation review requested',
        description: `Tailor asked Drapeon to review a cancellation from ${order.stage}.`,
        recommendedAction: 'Review the order timeline, tailor note, and refund implications before ruling.',
        dedupeKey: `order-review:cancellation:${orderId}`,
        metadata: {
          review_type: 'CANCELLATION',
          requested_by: 'TAILOR',
          reason: body.reason,
          from_stage: order.stage,
        },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-cancellation-review'],
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'request-delivery-review') {
      const meta = parseOrderSupportMeta(order.special_note)
      if (meta.deliveryReview?.status === 'OPEN') {
        return new Response(
          JSON.stringify({ error: 'A delivery review is already open on this order.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (!['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED'].includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot request delivery review from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const reasonLabel = DELIVERY_REVIEW_REASON_LABELS[body.reason]
      const nextMeta = {
        ...meta,
        deliveryReview: {
          status: 'OPEN' as const,
          requestedBy: 'TAILOR' as const,
          reason: body.reason,
          reasonLabel,
          note: body.note?.trim() || null,
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
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'IN_DISPUTE',
        note: buildDeliveryReviewNote('TAILOR', reasonLabel, body.note ?? null),
      })

      await audit(supabase, {
        event: 'order.delivery_review_requested',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        severity: 'warn',
        payload: { reason: body.reason, from_stage: order.stage },
      })

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'DELIVERY_REVIEW',
        severity: 'HIGH',
        source: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        orderId,
        userId: caller.id,
        stage: order.stage,
        title: 'Delivery review requested',
        description: `Tailor asked Drapeon to review a dispatch or delivery issue from ${order.stage}.`,
        recommendedAction: 'Check dispatch evidence, courier handoff context, and the current delivery stage before deciding the next step.',
        dedupeKey: `order-review:delivery:${orderId}`,
        metadata: {
          review_type: 'DELIVERY',
          requested_by: 'TAILOR',
          reason: body.reason,
          from_stage: order.stage,
        },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['request-delivery-review'],
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── send or revise quote ──────────────────────────────────────────────────
    if (action === 'send-quote' || action === 'revise-quote') {
      if (action === 'revise-quote' && !QUOTE_NEGOTIATION_V1) {
        return jsonErrorResponse(cors, 409, 'QUOTE_NEGOTIATION_NOT_ENABLED', 'Formal quote revisions are not enabled here yet.')
      }
      // Idempotent: if already QUOTE_SENT, the previous request succeeded — return ok
      if (action === 'send-quote' && order.stage === 'QUOTE_SENT') {
        return new Response(JSON.stringify({ ok: true, idempotent: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      const allowedQuoteStages = action === 'send-quote'
        ? ['PENDING_QUOTE', 'CONSULTATION']
        : ['QUOTE_SENT']
      if (!allowedQuoteStages.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot ${action} from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      // Zod already validated: amount, currency, completionDate — extract safely
      const quoteBody = body as Extract<typeof body, { action: 'send-quote' }> | Extract<typeof body, { action: 'revise-quote' }>
      const { amount, currency, completionDate, breakdown } = quoteBody
      const quoteCurrency = normalizeAccountCurrency(currency)
      if (!quoteCurrency) {
        return new Response(
          JSON.stringify({ error: 'This quote currency is not supported.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }
      const lockedOrderCurrency = normalizeAccountCurrency(order.currency ?? order.quoted_currency)
      if (!lockedOrderCurrency) {
        log('error', FN, 'quote.currency_missing', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          orderCurrency: order.currency ?? null,
          quotedCurrency: order.quoted_currency ?? null,
        })
        return new Response(
          JSON.stringify({ error: 'This order currency needs review before quoting. Please contact Drapeon support.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }
      if (quoteCurrency !== lockedOrderCurrency) {
        log('warn', FN, 'quote.currency_mismatch', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          requestedCurrency: quoteCurrency,
          orderCurrency: order.currency ?? null,
          quotedCurrency: order.quoted_currency ?? null,
          lockedOrderCurrency,
        })
        return new Response(
          JSON.stringify({
            error: `This order is locked to ${lockedOrderCurrency}. Refresh the order and send the quote in ${lockedOrderCurrency}.`,
          }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }
      const parsedDate = new Date(completionDate)
      const customerDeadline = order.deadline ? new Date(order.deadline) : null
      const supportMeta = parseOrderSupportMeta(order.special_note)
      const { data: customerUserRow, error: customerUserError } = await supabase
        .from('users')
        .select('region_code')
        .eq('id', order.customer_id)
        .maybeSingle()

      if (customerUserError) {
        log('error', FN, 'db.error', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          error: customerUserError.message,
          surface: 'users.region_code',
        })
        return jsonErrorResponse(cors, 500, 'TAX_REGION_UNAVAILABLE', 'Could not resolve the customer tax region.')
      }

      const customerRegionCode =
        typeof (customerUserRow as any)?.region_code === 'string' && (customerUserRow as any).region_code.trim().length > 0
          ? (customerUserRow as any).region_code.trim().toUpperCase()
          : 'ZZ'
      const fulfillmentFee = order.delivery_method === 'LOCAL_COLLECTION'
        ? 0
        : resolveDrapeManagedFulfillmentFee({
            fulfillment:
              order.delivery_method === 'LOCAL_DELIVERY'
                ? 'DELIVERY'
                : 'SHIPPING',
            orderCurrency: quoteCurrency,
            sellerLocation: sellerProfileLocation,
            destinationAddress: order.delivery_address ?? null,
          }).feeMinorUnits
      let resolvedTax
      try {
        resolvedTax = await resolveOrderTax({
          supabase,
          orderId,
          currency: quoteCurrency,
          regionCode: customerRegionCode,
          countryCode: normalizeTaxCountryCode(order.delivery_country_code) ?? customerRegionCode,
          address: order.delivery_address ?? null,
          postalCode: order.delivery_postal_code ?? null,
          stateRegion: order.delivery_region ?? null,
          city: order.delivery_city ?? null,
        })
      } catch (error) {
        log('warn', FN, 'tax.lookup_unavailable', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          error: error instanceof Error ? error.message : String(error),
        })
        return new Response(
          JSON.stringify({ error: 'We could not calculate tax for this quote right now. Please try again in a moment.' }),
          { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }
      const lockedAmounts = calculateLockedOrderAmountsWithTaxBase({
        subtotalAmount: amount,
        platformFeeAmount: 0,
        shippingAmount: fulfillmentFee,
        taxRateBps: resolvedTax.rateBps,
        shippingTaxable: resolvedTax.shippingTaxable,
        platformFeeTaxable: resolvedTax.platformFeeTaxable,
      })

      if (customerDeadline && parsedDate.getTime() > customerDeadline.getTime()) {
        return new Response(
          JSON.stringify({ error: 'Quoted completion date cannot be later than the customer deadline.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const cleanBreakdown = breakdown
        ? {
            laborAmount: typeof breakdown.laborAmount === 'number' ? breakdown.laborAmount : null,
            sourcingAmount: typeof breakdown.sourcingAmount === 'number' ? breakdown.sourcingAmount : null,
            rushAmount: typeof breakdown.rushAmount === 'number' ? breakdown.rushAmount : null,
            consultationCreditAmount:
              supportMeta.consultation?.feeCreditable && typeof order.consultation_fee === 'number' && order.consultation_fee > 0
                ? Math.min(order.consultation_fee, amount)
                : null,
            included: breakdown.included?.map((value) => value.trim()).filter(Boolean) ?? [],
            excluded: breakdown.excluded?.map((value) => value.trim()).filter(Boolean) ?? [],
            summary: breakdown.summary?.trim() || null,
          }
        : null

      const nextSupportMeta = {
        ...supportMeta,
        consultation: supportMeta.consultation
          ? {
              ...supportMeta.consultation,
              status: supportMeta.consultation.status === 'REQUESTED' ? 'COMPLETED' as const : supportMeta.consultation.status ?? null,
              feeCreditedTowardQuote:
                supportMeta.consultation.feeCreditable === true
                && typeof order.consultation_fee === 'number'
                && order.consultation_fee > 0,
            }
          : supportMeta.consultation ?? null,
        quoteBreakdown: cleanBreakdown,
      }

      const quoteExpiry = nextQuoteExpiryIso()
      let quotedOrder: { id: string } | null = null
      let quoteResult: Record<string, unknown> = {}
      let error: { message: string } | null = null

      if (QUOTE_NEGOTIATION_V1) {
        const revisionBody = quoteBody.action === 'revise-quote' ? quoteBody : null
        const { data, error: snapshotError } = await supabase.rpc('create_order_quote_snapshot', {
          p_order_id: orderId,
          p_tailor_id: caller.id,
          p_expected_quote_id: revisionBody?.quoteId ?? null,
          p_expected_quote_version: revisionBody?.expectedQuoteVersion ?? null,
          p_revision_request_id: revisionBody?.revisionRequestId ?? null,
          p_change_kind: revisionBody?.changeKind ?? 'INITIAL',
          p_currency: quoteCurrency,
          p_subtotal_amount: lockedAmounts.subtotalAmount,
          p_tax_amount: lockedAmounts.taxAmount,
          p_platform_fee_amount: lockedAmounts.platformFeeAmount,
          p_delivery_fee_amount: lockedAmounts.shippingAmount,
          p_total_amount: lockedAmounts.totalAmount,
          p_completion_date: parsedDate.toISOString(),
          p_breakdown: cleanBreakdown ? JSON.stringify(cleanBreakdown) : null,
          p_assumptions: quoteBody.note?.trim() || null,
          p_expires_at: quoteExpiry,
        })

        if (snapshotError) {
          return quoteNegotiationErrorResponse(cors, snapshotError)
        }

        quoteResult = (data ?? {}) as Record<string, unknown>
        quotedOrder = { id: orderId }
        const { error: projectionError } = await supabase
          .from('orders')
          .update({
            fulfillment_payment_requested_at: null,
            fulfillment_payment_paid_at: null,
            fulfillment_payment_provider: null,
            fulfillment_payment_intent_id: null,
            fulfillment_payment_checkout_url: null,
            tax_rate_bps: lockedAmounts.taxRateBps,
            tax_region: resolvedTax.taxRegion,
            tax_fallback: resolvedTax.fallback,
            tax_fallback_reason: resolvedTax.fallbackReason,
            special_note: serializeOrderSupportMeta(nextSupportMeta),
          })
          .eq('id', orderId)
          .eq('active_quote_id', quoteResult.quoteId)
        if (projectionError) error = projectionError
      } else {
        const legacyResult = await supabase
          .from('orders')
          .update({
            stage: 'QUOTE_SENT',
            quoted_amount: lockedAmounts.totalAmount,
            fulfillment_fee: fulfillmentFee,
            fulfillment_payment_requested_at: null,
            fulfillment_payment_paid_at: null,
            fulfillment_payment_provider: null,
            fulfillment_payment_intent_id: null,
            fulfillment_payment_checkout_url: null,
            currency: quoteCurrency,
            quoted_currency: quoteCurrency,
            source_currency: quoteCurrency,
            source_amount: amount,
            fx_rate: 1,
            fx_rate_timestamp: new Date().toISOString(),
            subtotal_amount: lockedAmounts.subtotalAmount,
            platform_fee_amount: lockedAmounts.platformFeeAmount,
            tax_amount: lockedAmounts.taxAmount,
            tax_rate_bps: lockedAmounts.taxRateBps,
            tax_region: resolvedTax.taxRegion,
            tax_fallback: resolvedTax.fallback,
            tax_fallback_reason: resolvedTax.fallbackReason,
            shipping_amount: lockedAmounts.shippingAmount,
            total_amount: lockedAmounts.totalAmount,
            quoted_completion_date: parsedDate.toISOString(),
            quote_note: quoteBody.note?.trim() || null,
            quote_expires_at: quoteExpiry,
            special_note: serializeOrderSupportMeta(nextSupportMeta),
            stage_updated_at: new Date().toISOString(),
          })
          .eq('id', orderId)
          .eq('tailor_id', caller.id)
          .in('stage', ['PENDING_QUOTE', 'CONSULTATION'])
          .select('id')
          .maybeSingle()
        quotedOrder = legacyResult.data
        error = legacyResult.error
      }

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      if (!quotedOrder?.id) {
        const { data: freshOrder, error: freshOrderError } = await supabase
          .from('orders')
          .select('stage')
          .eq('id', orderId)
          .eq('tailor_id', caller.id)
          .maybeSingle()

        if (freshOrderError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: freshOrderError.message, surface: 'orders.stage_after_quote_race' })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }

        if ((freshOrder as { stage?: string | null } | null)?.stage === 'QUOTE_SENT') {
          return new Response(JSON.stringify({ ok: true, idempotent: true }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }

        return jsonErrorResponse(
          cors,
          409,
          'ORDER_STATE_CHANGED',
          'This order changed while the quote was being sent. Refresh the order before sending another quote.',
        )
      }

      await releaseConsultationSlot(supabase, orderId, 'COMPLETED')

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'QUOTE_SENT',
        note: body.note?.trim() || null,
      })

      await audit(supabase, {
        event: action === 'revise-quote' ? 'quote.revised' : 'quote.sent',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: {
          amount: quoteBody.amount,
          currency: quoteCurrency,
          from_stage: order.stage,
          quote_id: quoteResult.quoteId ?? null,
          quote_version: quoteResult.quoteVersion ?? null,
          revision_request_id: quoteResult.revisionRequestId ?? null,
          event_id: quoteResult.eventId ?? null,
        },
      })

      log('info', FN, action === 'revise-quote' ? 'quote.revised' : 'quote.sent', { actor_id: caller.id, order_id: orderId })

      if (order.customer_id) {
        let notificationOrder = order
        const { data: currentOrder, error: currentOrderError } = await supabase
          .from('orders')
          .select(orderSelect)
          .eq('id', orderId)
          .maybeSingle()

        if (currentOrder) {
          notificationOrder = currentOrder as unknown as OrderRow
        } else if (currentOrderError) {
          log('warn', FN, 'quote.notification_snapshot_failed', {
            actor_id: caller.id,
            order_id: orderId,
            action,
            error: currentOrderError.message,
          })
        }

        const notification = CUSTOMER_NOTIFICATION[action]
        const eventId = typeof quoteResult.eventId === 'string' ? quoteResult.eventId : ''
        const quoteId = typeof quoteResult.quoteId === 'string' ? quoteResult.quoteId : ''
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...notification,
            preferenceKey: 'quotes',
            data: {
              orderId,
              destination: 'messages',
              eventId,
              quoteId,
            },
          })
        )
        EdgeRuntime.waitUntil(
          enqueueOrderEventEmailJob(supabase, {
            order: notificationOrder,
            recipientUserId: order.customer_id.toString(),
            audience: 'CUSTOMER',
            subject: notification.title,
            headline: notification.title,
            body: notification.body,
            ctaLabel: 'Review quote',
            source: FN,
            idempotencyKey: `${action}:${orderId}:${eventId || quoteId || quoteExpiry}`,
          }),
        )
      }

      return new Response(JSON.stringify({ ok: true, ...quoteResult }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'request-fulfillment-payment') {
      return new Response(
        JSON.stringify({
          error:
            'Standard delivery and shipping are now Drapeon-managed with a flat fee paid at checkout. Finish packing the order, then mark it ready for Drapeon dispatch.',
        }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
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

      let refundResult: Awaited<ReturnType<typeof refundSettledOrderPayments>> | null = null

      try {
        refundResult = await refundSettledOrderPayments(supabase, {
          orderId,
          reason: `Tailor declined order from ${order.stage}`,
          actorId: caller.id,
          actorRole: 'TAILOR',
          allowedPhases: ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT'],
        })
      } catch (error) {
        log('error', FN, 'refund.error', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          error: error instanceof Error ? error.message : String(error),
        })
        return new Response(
          JSON.stringify({
            error: 'We could not safely decline this order because the payment refund did not complete. Please try again or contact Drapeon support.',
          }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      try {
        await finalizeOrderTerminal(
          supabase,
          orderId,
          buildTailorOrderDeclineTerminalRequest({
            actorId: caller.id,
            fromStage: order.stage as any,
            note: body.note?.trim() || 'Tailor declined this order.',
          }),
        )
      } catch (error) {
        log('error', FN, 'db.error', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          error: error instanceof Error ? error.message : String(error),
        })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      await releaseConsultationSlot(supabase, orderId)

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['decline-order'],
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Order declined',
          'Your tailor could not take this order. If any payment had already settled, Drapeon will handle the refund path before closing it out.',
        )
      }

      return new Response(JSON.stringify({ ok: true, refundedAttempts: refundResult?.refundedAttempts ?? [] }), {
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
      const {
        consultationFee = null,
        currency,
        creditFeeTowardOrder,
        paymentTiming,
        reschedulePolicy,
        noShowPolicy,
        expiryPolicy,
        reminderEnabled,
        scheduledStartAt,
        timezone,
      } = body as Extract<typeof body, { action: 'request-consultation' }>
      const scheduledError = validateScheduledStartAt(scheduledStartAt, 60)
      if (scheduledError) {
        return new Response(
          JSON.stringify({ error: scheduledError }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const booking = await reserveConsultationSlot(supabase, {
        orderId,
        tailorId: caller.id,
        customerId: String(order.customer_id),
        scheduledStartAt: scheduledStartAt!,
      })
      if (!booking.ok) {
        return jsonErrorResponse(cors, booking.status, booking.code, booking.error)
      }

      const supportMeta = parseOrderSupportMeta(order.special_note)
      const feeAmount = typeof consultationFee === 'number' && consultationFee > 0 ? consultationFee : null
      const feeCurrency = feeAmount
        ? normalizeAccountCurrency(currency ?? order.currency ?? order.quoted_currency) ?? 'USD'
        : normalizeAccountCurrency(order.currency ?? order.quoted_currency)
      const now = new Date().toISOString()
      const consultationMeta = {
        ...(supportMeta.consultation ?? {}),
        status: 'SCHEDULED' as const,
        requestedBy: 'TAILOR' as const,
        feeMode: feeAmount ? 'PAID' as const : 'FREE' as const,
        feeAmount,
        feeCurrency,
        feeCreditable: feeAmount ? creditFeeTowardOrder === true : false,
        feeCreditedTowardQuote: false,
        paymentProvider: null,
        paymentIntentId: null,
        paymentCheckoutUrl: null,
        paymentTiming: feeAmount ? (paymentTiming ?? 'BEFORE_CALL_STARTS') : 'WAIVED_OR_FREE' as const,
        paidAt: null,
        reschedulePolicy: reschedulePolicy ?? 'ONE_FREE_RESCHEDULE',
        noShowPolicy: noShowPolicy ?? (feeAmount ? 'FEE_FORFEITED' : 'CASE_BY_CASE'),
        expiryPolicy: expiryPolicy ?? 'EXPIRES_IN_14_DAYS',
        reminderEnabled: reminderEnabled ?? true,
        requestNote: body.note?.trim() || null,
        requestedAt: now,
        proposedStartAt: scheduledStartAt!,
        scheduledStartAt: scheduledStartAt!,
        scheduledEndAt: booking.scheduledEndAt,
        timezone: timezone?.trim() || null,
        approvedAt: now,
        approvedBy: caller.id,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
        reminder30SentAt: null,
        reminder10SentAt: null,
        reminder5SentAt: null,
        reminderStartSentAt: null,
      }

      const { data: updatedOrder, error } = await supabase
        .from('orders')
        .update({
          stage: 'CONSULTATION',
          consultation_fee: feeAmount,
          currency: feeAmount ? feeCurrency : normalizeAccountCurrency(order.currency) ?? normalizeAccountCurrency(order.quoted_currency) ?? 'USD',
          quoted_currency: feeAmount ? feeCurrency : normalizeAccountCurrency(order.quoted_currency) ?? null,
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            consultation: consultationMeta,
          }),
          stage_updated_at: now,
        })
        .eq('id', orderId)
        .eq('stage', 'PENDING_QUOTE')
        .select('id')
        .maybeSingle()

      if (error) {
        if (booking.reservationState === 'created') await releaseConsultationSlot(supabase, orderId)
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      if (!updatedOrder?.id) {
        if (await orderAlreadyScheduledForConsultation(supabase, orderId, scheduledStartAt!)) {
          return new Response(JSON.stringify({ ok: true, idempotent: true }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }
        if (booking.reservationState === 'created') await releaseConsultationSlot(supabase, orderId)
        return jsonErrorResponse(
          cors,
          409,
          'ORDER_STATE_CHANGED',
          'This order changed while you were scheduling the consultation. Refresh the order and try again if consultation is still needed.',
        )
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'CONSULTATION',
        note: body.note?.trim()
          || 'Tailor scheduled a consultation. Review the agreed time below. Customer must pay first if a fee is required.',
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
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Consultation scheduled',
          'Your tailor reserved a consultation slot. Review the time in Drapeon and pay the consultation fee first if one is required.',
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── approve-consultation ─────────────────────────────────────────────────
    if (action === 'approve-consultation') {
      if (order.stage !== 'CONSULTATION') {
        return new Response(
          JSON.stringify({ error: `Cannot approve consultation from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const supportMeta = parseOrderSupportMeta(order.special_note)
      const existingConsultation = supportMeta.consultation
      if (existingConsultation?.requestedBy !== 'CUSTOMER' || existingConsultation.status !== 'REQUESTED') {
        return new Response(
          JSON.stringify({ error: 'This order is not waiting on a customer consultation request approval.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const {
        consultationFee = null,
        currency,
        creditFeeTowardOrder,
        paymentTiming,
        reschedulePolicy,
        noShowPolicy,
        expiryPolicy,
        reminderEnabled,
        scheduledStartAt,
        timezone,
      } = body as Extract<typeof body, { action: 'approve-consultation' }>
      const scheduledError = validateScheduledStartAt(scheduledStartAt, 60)
      if (scheduledError) {
        return new Response(
          JSON.stringify({ error: scheduledError }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const booking = await reserveConsultationSlot(supabase, {
        orderId,
        tailorId: caller.id,
        customerId: String(order.customer_id),
        scheduledStartAt,
      })
      if (!booking.ok) {
        return jsonErrorResponse(cors, booking.status, booking.code, booking.error)
      }

      const feeAmount = typeof consultationFee === 'number' && consultationFee > 0 ? consultationFee : null
      const feeCurrency = feeAmount
        ? normalizeAccountCurrency(currency ?? order.currency ?? order.quoted_currency) ?? 'USD'
        : normalizeAccountCurrency(order.currency ?? order.quoted_currency)
      const now = new Date().toISOString()
      const nextConsultationMeta = {
        ...existingConsultation,
        status: 'SCHEDULED' as const,
        feeMode: feeAmount ? 'PAID' as const : 'FREE' as const,
        feeAmount,
        feeCurrency,
        feeCreditable: feeAmount ? creditFeeTowardOrder === true : false,
        feeCreditedTowardQuote: false,
        paymentProvider: null,
        paymentIntentId: null,
        paymentCheckoutUrl: null,
        paymentTiming: feeAmount ? (paymentTiming ?? 'BEFORE_CALL_STARTS') : 'WAIVED_OR_FREE' as const,
        paidAt: null,
        reschedulePolicy: reschedulePolicy ?? 'ONE_FREE_RESCHEDULE',
        noShowPolicy: noShowPolicy ?? (feeAmount ? 'FEE_FORFEITED' : 'CASE_BY_CASE'),
        expiryPolicy: expiryPolicy ?? 'EXPIRES_IN_14_DAYS',
        reminderEnabled: reminderEnabled ?? true,
        requestNote: body.note?.trim() || existingConsultation.requestNote || null,
        scheduledStartAt,
        scheduledEndAt: booking.scheduledEndAt,
        timezone: timezone?.trim() || existingConsultation.timezone || null,
        approvedAt: now,
        approvedBy: caller.id,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
        reminder30SentAt: null,
        reminder10SentAt: null,
        reminder5SentAt: null,
        reminderStartSentAt: null,
      }

      const { data: updatedOrder, error } = await supabase
        .from('orders')
        .update({
          consultation_fee: feeAmount,
          currency: feeAmount ? feeCurrency : normalizeAccountCurrency(order.currency) ?? normalizeAccountCurrency(order.quoted_currency) ?? 'USD',
          quoted_currency: feeAmount ? feeCurrency : normalizeAccountCurrency(order.quoted_currency) ?? null,
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            consultation: nextConsultationMeta,
          }),
          stage_updated_at: now,
        })
        .eq('id', orderId)
        .eq('stage', 'CONSULTATION')
        .eq('special_note', order.special_note ?? '')
        .select('id')
        .maybeSingle()

      if (error) {
        if (booking.reservationState === 'created') await releaseConsultationSlot(supabase, orderId)
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      if (!updatedOrder?.id) {
        if (await orderAlreadyScheduledForConsultation(supabase, orderId, scheduledStartAt)) {
          return new Response(JSON.stringify({ ok: true, idempotent: true }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }
        if (booking.reservationState === 'created') await releaseConsultationSlot(supabase, orderId)
        return jsonErrorResponse(
          cors,
          409,
          'ORDER_STATE_CHANGED',
          'This consultation request changed while you were approving it. Refresh the order before choosing a time.',
        )
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'CONSULTATION',
        note: body.note?.trim()
          || 'Tailor approved and scheduled the consultation. Review the agreed time below. Customer must pay first if a fee is required.',
      })

      await audit(supabase, {
        event: 'consultation.approved',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: {
          requested_by: 'CUSTOMER',
          scheduled_start_at: scheduledStartAt,
          has_fee: feeAmount != null,
        },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['approve-consultation'],
            preferenceKey: 'orderUpdates',
            data: { orderId },
          }),
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Consultation approved',
          'Your tailor approved and reserved your consultation slot. Pay the fee if required before the call opens.',
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── decline-consultation-request ─────────────────────────────────────────
    if (action === 'decline-consultation-request') {
      if (order.stage !== 'CONSULTATION') {
        return new Response(
          JSON.stringify({ error: `Cannot decline consultation request from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const supportMeta = parseOrderSupportMeta(order.special_note)
      const existingConsultation = supportMeta.consultation
      if (existingConsultation?.requestedBy !== 'CUSTOMER' || existingConsultation.status !== 'REQUESTED') {
        return new Response(
          JSON.stringify({ error: 'This order is not waiting on a customer consultation request.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const now = new Date().toISOString()
      const { error } = await supabase
        .from('orders')
        .update({
          stage: 'PENDING_QUOTE',
          consultation_fee: null,
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            consultation: {
              ...existingConsultation,
              status: 'DECLINED' as const,
              declinedAt: now,
              declinedBy: caller.id,
              declineReason: body.note?.trim() || null,
            },
          }),
          stage_updated_at: now,
        })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      await releaseConsultationSlot(supabase, orderId)

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: 'PENDING_QUOTE',
        note: body.note?.trim() || 'Tailor declined the consultation request and returned to quote review.',
      })

      await audit(supabase, {
        event: 'consultation.declined',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        order_id: orderId,
        payload: { requested_by: 'CUSTOMER' },
      })

      if (order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), {
            ...CUSTOMER_NOTIFICATION['decline-consultation-request'],
            preferenceKey: 'orderUpdates',
            data: { orderId },
          }),
        )
        queueCustomerOrderEmail(
          supabase,
          order,
          'Consultation declined',
          'Your tailor declined the consultation request. They can still send a quote or continue by message if the order is a fit.',
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── advance-stage ─────────────────────────────────────────────────────────
    if (action === 'advance-stage') {
      // Zod already validated targetStage against the enum
      const {
        targetStage,
        photoUrl,
        photoUrls,
        trackingNumber,
        carrier,
        fulfillmentProvider,
        fulfillmentReference,
        fulfillmentContactName,
        fulfillmentContactPhone,
        mediaFingerprints,
      } = body as Extract<typeof body, { action: 'advance-stage' }>
      const normalizedTrackingNumber = trackingNumber?.trim().toUpperCase() ?? ''
      const normalizedProvider = fulfillmentProvider?.trim() || carrier?.trim() || ''
      const normalizedReference = fulfillmentReference?.trim() ?? ''
      const normalizedContactName = fulfillmentContactName?.trim() ?? ''
      const normalizedContactPhone = normalizeStoredPhone(fulfillmentContactPhone)
      const productionPhotoUrls = uniquePhotoUrls(photoUrl, photoUrls)
      const productionMediaFingerprints = uniqueMediaFingerprints(mediaFingerprints)
      const customStageKey = isCustomOrder(order)
        ? customProductionStageForTarget(targetStage, order.delivery_method)
        : null
      const customStageRequirements = customStageKey ? CUSTOM_PRODUCTION_STAGE_REQUIREMENTS[customStageKey] : null

      // Idempotent: if already in the target stage, the previous request succeeded
      if (order.stage === targetStage) {
        if (customStageKey === 'FABRIC' && order.fabric_source === 'TAILOR_SOURCES' && productionPhotoUrls.length > 0) {
          const { error: detailError } = await supabase
            .from('custom_order_details')
            .update({
              fabric_approval_status: 'PENDING_CUSTOMER_APPROVAL',
              fabric_approval_requested_at: new Date().toISOString(),
            })
            .eq('order_id', orderId)

          if (detailError) {
            log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: detailError.message, surface: 'custom_order_details' })
            return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
          }

          await supabase.from('order_stage_updates').insert({
            order_id: orderId,
            stage: targetStage,
            note: body.note.trim(),
            photo_url: productionPhotoUrls[0] ?? null,
          })

          const evidenceError = await insertCustomProductionEvidence(supabase, {
            orderId,
            stageKey: 'FABRIC',
            note: body.note.trim(),
            photoUrls: productionPhotoUrls,
            actorId: caller.id,
            metadata: {
              order_stage: targetStage,
              fabric_source: order.fabric_source,
              resubmission: true,
              media_fingerprints: productionMediaFingerprints,
              media_count: productionPhotoUrls.length,
            },
          })

          if (evidenceError) {
            log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: evidenceError.message, surface: 'order_production_evidence' })
            return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
          }

          await audit(supabase, {
            event: 'fabric.sourced_submitted',
            actor_id: caller.id,
            actor_role: 'TAILOR',
            order_id: orderId,
            payload: { stage: order.stage, resubmission: true },
          })

          if (order.customer_id) {
            EdgeRuntime.waitUntil(
              sendPushToUser(supabase, order.customer_id.toString(), {
                ...CUSTOMER_NOTIFICATION.SOURCING,
                preferenceKey: 'orderUpdates',
                data: { orderId },
              })
            )
          }

          return new Response(JSON.stringify({ ok: true, fabricApprovalStatus: 'PENDING_CUSTOMER_APPROVAL' }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }

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

      const validFrom = validAdvanceStages(order, targetStage)
      const cuttingSnapshot = targetStage === 'CUTTING'
        ? parseMeasurementSnapshot(order.customer_measurements_snapshot)
        : null
      const cuttingSupportMeta = targetStage === 'CUTTING'
        ? parseOrderSupportMeta(order.special_note)
        : null
      const cuttingMaterialIssue = cuttingSupportMeta?.materialIssue
      const cuttingStyleAlignment = cuttingSupportMeta?.styleAlignment
      const waitingOnTailorSourcing =
        cuttingMaterialIssue?.status === 'CUSTOMER_RESPONDED' &&
        cuttingMaterialIssue.response === 'ASK_TAILOR_TO_SOURCE'
      let reusedProductionMedia: string[] = []
      let customFabricApproval: { required: boolean; status: string | null } | null = null
      try {
        if (order.stage !== targetStage && (productionPhotoUrls.length > 0 || productionMediaFingerprints.length > 0)) {
          reusedProductionMedia = await findReusedProductionMedia(
            supabase,
            orderId,
            productionPhotoUrls,
            productionMediaFingerprints,
          )
        }
        if (targetStage === 'CUTTING' && order.fabric_source === 'TAILOR_SOURCES' && isCustomOrder(order)) {
          customFabricApproval = await readCustomFabricApprovalForCutting(supabase, orderId)
        }
      } catch (error) {
        log('error', FN, 'db.error', {
          actor_id: caller.id,
          order_id: orderId,
          action,
          target_stage: targetStage,
          error: error instanceof Error ? error.message : String(error),
          surface: 'production_preflight_lookup',
        })
        return jsonResponse({ error: 'We could not verify this stage update right now. Please try again.' }, 500, cors)
      }
      const dispatchRecipientPhoneError =
        targetStage === 'READY_FOR_DRAPE_DISPATCH'
          ? validateRecipientPhone(order.recipient_phone)
          : null
      const advancePreflight = runPreflight([
        {
          name: 'ready_made_stage_supported',
          condition: !(isReadyMadeOrder(order) && ['DESIGNING', 'SOURCING', 'CUTTING', 'SEWING'].includes(targetStage)),
          errorCode: 'READY_MADE_STAGE_UNSUPPORTED',
          message: 'Ready-made orders skip tailoring production stages. Move this order into preparation instead.',
          field: 'targetStage',
          severity: 'BLOCKING',
          actual: { orderKind: order.order_kind, targetStage },
        },
        {
          name: 'next_stage_valid',
          condition: validFrom.includes(order.stage),
          errorCode: 'STAGE_OUT_OF_ORDER',
          message: `You need to complete ${validFrom.join(' or ') || 'the previous stage'} before moving to this step.`,
          field: 'targetStage',
          severity: 'BLOCKING',
          actual: { currentStage: order.stage, targetStage, validFrom },
        },
        {
          name: 'production_photo_present',
          condition: !customStageKey || !customStageRequirements?.photoRequired || productionPhotoUrls.length >= customStageRequirements.minPhotoCount,
          errorCode: 'PHOTO_REQUIRED',
          message: customStageKey && customStageRequirements
            ? `${CUSTOM_PRODUCTION_STAGE_LABELS[customStageKey]} requires ${customStageRequirements.minPhotoCount} fresh proof media item${customStageRequirements.minPhotoCount === 1 ? '' : 's'} before it can be marked complete.`
            : 'Please upload a fresh photo or video of this stage before continuing.',
          field: 'photoUrl',
          severity: 'BLOCKING',
          actual: { photoCount: productionPhotoUrls.length, requiredPhotoCount: customStageRequirements?.minPhotoCount ?? 0 },
        },
        {
          name: 'production_media_not_reused',
          condition: reusedProductionMedia.length === 0,
          errorCode: 'PRODUCTION_MEDIA_REUSED',
          message: 'Use a fresh photo or video for this stage. This media is already attached to the order timeline.',
          field: 'photoUrl',
          severity: 'BLOCKING',
          actual: { reusedCount: reusedProductionMedia.length },
        },
        {
          name: 'collection_stage_matches_method',
          condition: targetStage !== 'READY_FOR_COLLECTION' || order.delivery_method === 'LOCAL_COLLECTION',
          errorCode: 'COLLECTION_METHOD_MISMATCH',
          message: 'This order is not set for pickup. Use the matching delivery handoff instead.',
          field: 'delivery_method',
          severity: 'BLOCKING',
          actual: { deliveryMethod: order.delivery_method, targetStage },
        },
        {
          name: 'dispatch_stage_matches_method',
          condition: targetStage !== 'READY_FOR_DRAPE_DISPATCH' || order.delivery_method !== 'LOCAL_COLLECTION',
          errorCode: 'DISPATCH_METHOD_MISMATCH',
          message: 'This order is set for local collection. Mark it ready for collection instead.',
          field: 'delivery_method',
          severity: 'BLOCKING',
          actual: { deliveryMethod: order.delivery_method, targetStage },
        },
        {
          name: 'dispatch_address_present',
          condition: targetStage !== 'READY_FOR_DRAPE_DISPATCH' || !!order.delivery_address?.trim(),
          errorCode: 'DELIVERY_ADDRESS_MISSING',
          message: 'Delivery address is missing on this order. Ask the customer to update it before Drapeon dispatch.',
          field: 'delivery_address',
          severity: 'BLOCKING',
          actual: { hasDeliveryAddress: !!order.delivery_address?.trim() },
        },
        {
          name: 'dispatch_recipient_name_present',
          condition: targetStage !== 'READY_FOR_DRAPE_DISPATCH' || !!order.recipient_name?.trim(),
          errorCode: 'RECIPIENT_NAME_MISSING',
          message: 'Recipient name is missing on this order. Ask the customer to update it before Drapeon dispatch.',
          field: 'recipient_name',
          severity: 'BLOCKING',
          actual: { hasRecipientName: !!order.recipient_name?.trim() },
        },
        {
          name: 'dispatch_recipient_phone_valid',
          condition: targetStage !== 'READY_FOR_DRAPE_DISPATCH' || !dispatchRecipientPhoneError,
          errorCode: 'RECIPIENT_PHONE_INVALID',
          message: dispatchRecipientPhoneError ?? 'Recipient phone is missing on this order. Ask the customer to update it before Drapeon dispatch.',
          field: 'recipient_phone',
          severity: 'BLOCKING',
          actual: { recipientPhone: order.recipient_phone ?? null },
        },
        {
          name: 'dispatch_photo_present',
          condition: targetStage !== 'READY_FOR_DRAPE_DISPATCH' || productionPhotoUrls.length >= 1,
          errorCode: 'DISPATCH_PROOF_MISSING',
          message: 'Add fresh packed-order proof before marking this order ready for Drapeon dispatch.',
          field: 'photoUrl',
          severity: 'BLOCKING',
          actual: { photoCount: productionPhotoUrls.length },
        },
        {
          name: 'measurements_confirmed_before_cutting',
          condition: targetStage !== 'CUTTING' || cuttingSnapshot?.needsConfirmation !== true,
          errorCode: 'MEASUREMENTS_CONFIRMATION_REQUIRED',
          message: 'Measurements still need customer confirmation before cutting can start.',
          field: 'customer_measurements_snapshot',
          severity: 'BLOCKING',
          actual: { needsConfirmation: cuttingSnapshot?.needsConfirmation ?? null },
        },
        {
          name: 'fabric_received_before_cutting',
          condition: targetStage !== 'CUTTING' || order.fabric_source !== 'CUSTOMER_SUPPLIES' || !!cuttingSupportMeta?.fabricReceivedAt || waitingOnTailorSourcing,
          errorCode: 'FABRIC_NOT_RECEIVED',
          message: 'Confirm that the customer fabric has been received before cutting starts.',
          field: 'fabric_source',
          severity: 'BLOCKING',
          actual: {
            fabricSource: order.fabric_source ?? null,
            fabricReceivedAt: cuttingSupportMeta?.fabricReceivedAt ?? null,
            waitingOnTailorSourcing,
          },
        },
        {
          name: 'tailor_sourced_fabric_approved_before_cutting',
          condition:
            targetStage !== 'CUTTING' ||
            order.fabric_source !== 'TAILOR_SOURCES' ||
            !isCustomOrder(order) ||
            (customFabricApproval?.required === true && customFabricApproval?.status === 'APPROVED'),
          errorCode: 'FABRIC_APPROVAL_REQUIRED',
          message: 'Wait for the customer to approve the sourced fabric before cutting starts.',
          field: 'fabric_approval_status',
          severity: 'BLOCKING',
          actual: {
            fabricSource: order.fabric_source ?? null,
            fabricApprovalRequired: customFabricApproval?.required ?? null,
            fabricApprovalStatus: customFabricApproval?.status ?? null,
          },
        },
        {
          name: 'material_issue_resolved_before_cutting',
          condition: targetStage !== 'CUTTING' || !materialIssueBlocksCutting(cuttingSupportMeta),
          errorCode: 'MATERIAL_ISSUE_OPEN',
          message: 'This order has an open material issue. Resolve it before cutting starts.',
          field: 'special_note',
          severity: 'BLOCKING',
          actual: { materialIssueStatus: cuttingMaterialIssue?.status ?? null },
        },
        {
          name: 'fit_profile_reviewed_before_cutting',
          condition: targetStage !== 'CUTTING' || !fitProfileNeedsTailorReview(cuttingSupportMeta),
          errorCode: 'FIT_PROFILE_REVIEW_REQUIRED',
          message: 'Review the guided fit intake or request measurement confirmation before cutting starts.',
          field: 'special_note',
          severity: 'BLOCKING',
          actual: { requiresTailorReview: cuttingSupportMeta?.fitProfile?.requiresTailorReview ?? null },
        },
        {
          name: 'style_alignment_approved_before_cutting',
          condition:
            targetStage !== 'CUTTING' ||
            cuttingStyleAlignment?.requiredBeforeCutting !== true ||
            cuttingStyleAlignment.status === 'NOT_REQUIRED' ||
            cuttingStyleAlignment.status === 'APPROVED',
          errorCode: 'STYLE_ALIGNMENT_REQUIRED',
          message: 'Get customer approval on your style interpretation before cutting starts.',
          field: 'special_note',
          severity: 'BLOCKING',
          actual: {
            requiredBeforeCutting: cuttingStyleAlignment?.requiredBeforeCutting ?? null,
            status: cuttingStyleAlignment?.status ?? null,
          },
        },
      ])

      if (!advancePreflight.passed) {
        await logPreflightFailure(supabase, advancePreflight, {
          operation: 'production_stage_update',
          entityType: 'order',
          entityId: orderId,
          orderId,
          actorId: caller.id,
          actorRole: 'TAILOR',
          userId: caller.id,
          source: FN,
          metadata: {
            currentStage: order.stage,
            targetStage,
            deliveryMethod: order.delivery_method ?? null,
            orderKind: order.order_kind ?? null,
          },
        })
        return preflightFailureResponse(advancePreflight, cors, 409)
      }

      if (isReadyMadeOrder(order) && ['DESIGNING', 'SOURCING', 'CUTTING', 'SEWING'].includes(targetStage)) {
        return new Response(
          JSON.stringify({ error: 'Ready-made orders skip tailoring production stages. Move this order into preparation instead.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (!validFrom.includes(order.stage)) {
        return new Response(
          JSON.stringify({ error: `Cannot advance to ${targetStage} from stage ${order.stage}` }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (customStageKey && customStageRequirements?.photoRequired && productionPhotoUrls.length < customStageRequirements.minPhotoCount) {
        return new Response(
          JSON.stringify({
            error: `${CUSTOM_PRODUCTION_STAGE_LABELS[customStageKey]} requires ${customStageRequirements.minPhotoCount} production photo${customStageRequirements.minPhotoCount === 1 ? '' : 's'} before it can be marked complete.`,
          }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'READY_FOR_COLLECTION' && order.delivery_method !== 'LOCAL_COLLECTION') {
        await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'requires_shipping_flow')
        return new Response(
          JSON.stringify({ error: 'This order is not set for pickup. Use the matching delivery handoff instead.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'READY_FOR_COLLECTION') {
        const { data: pickupDetails, error: pickupDetailsError } = await supabase
          .from('tailor_pickup_details')
          .select('pickup_address')
          .eq('user_id', caller.id)
          .maybeSingle()

        if (pickupDetailsError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: pickupDetailsError.message })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }

        if (!pickupDetails?.pickup_address?.trim()) {
          return new Response(
            JSON.stringify({ error: 'Add your private pickup address in Profile before marking this order ready for collection.' }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }
      }

      if (targetStage === 'READY_FOR_DRAPE_DISPATCH' && order.delivery_method === 'LOCAL_COLLECTION') {
        await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'requires_collection_flow')
        return new Response(
          JSON.stringify({
            error:
              'This order is set for local collection. Mark it ready for collection instead.',
          }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'READY_FOR_DRAPE_DISPATCH' && !order.delivery_address?.trim()) {
        await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'delivery_address_missing')
        return new Response(
          JSON.stringify({ error: 'Delivery address is missing on this order. Ask the customer to update it before Drapeon dispatch.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'READY_FOR_DRAPE_DISPATCH' && !order.recipient_name?.trim()) {
        await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'recipient_name_missing')
        return new Response(
          JSON.stringify({ error: 'Recipient name is missing on this order. Ask the customer to update it before Drapeon dispatch.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'READY_FOR_DRAPE_DISPATCH' && !order.recipient_phone?.trim()) {
        await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'recipient_phone_missing')
        return new Response(
          JSON.stringify({ error: 'Recipient phone is missing on this order. Ask the customer to update it before Drapeon dispatch.' }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
        const recipientPhoneError = validateRecipientPhone(order.recipient_phone)
        if (recipientPhoneError) {
          await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'recipient_phone_invalid')
          return new Response(
            JSON.stringify({ error: recipientPhoneError }),
            { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }
      }

      if (targetStage === 'READY_FOR_DRAPE_DISPATCH' && productionPhotoUrls.length < 1) {
        await auditFulfillmentHandoffBlocked(supabase, caller.id, order, 'dispatch_proof_missing')
        return new Response(
          JSON.stringify({ error: 'Add a packed-order photo before marking this order ready for Drapeon dispatch.' }),
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

        const styleAlignment = supportMeta.styleAlignment
        if (
          styleAlignment?.requiredBeforeCutting === true &&
          styleAlignment.status !== 'NOT_REQUIRED' &&
          styleAlignment.status !== 'APPROVED'
        ) {
          return new Response(
            JSON.stringify({ error: 'Get customer approval on your style interpretation before cutting starts.' }),
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

      if (customStageKey === 'FABRIC' && order.fabric_source === 'TAILOR_SOURCES') {
        const { error: detailError } = await supabase
          .from('custom_order_details')
          .update({
            fabric_approval_status: 'PENDING_CUSTOMER_APPROVAL',
            fabric_approval_requested_at: new Date().toISOString(),
          })
          .eq('order_id', orderId)

        if (detailError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: detailError.message, surface: 'custom_order_details' })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
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

      const { data: advancedOrder, error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId)
        .eq('tailor_id', caller.id)
        .in('stage', validFrom)
        .select('id, collection_code')
        .maybeSingle()

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, target_stage: targetStage, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
      }

      if (!advancedOrder?.id) {
        const { data: freshOrder, error: freshOrderError } = await supabase
          .from('orders')
          .select('stage, collection_code')
          .eq('id', orderId)
          .eq('tailor_id', caller.id)
          .maybeSingle()

        if (freshOrderError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, target_stage: targetStage, error: freshOrderError.message, surface: 'orders.stage_after_advance_race' })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }

        const fresh = freshOrder as { stage?: string | null; collection_code?: string | null } | null
        if (fresh?.stage === targetStage) {
          const retryBody: Record<string, unknown> = { ok: true, idempotent: true }
          if (targetStage === 'READY_FOR_COLLECTION' && fresh.collection_code) {
            retryBody.collectionCode = fresh.collection_code
          }
          return new Response(JSON.stringify(retryBody), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }

        return jsonErrorResponse(
          cors,
          409,
          'ORDER_STATE_CHANGED',
          'This order changed while the stage update was being saved. Refresh the order before advancing it again.',
        )
      }

      await supabase.from('order_stage_updates').insert({
        order_id: orderId,
        stage: targetStage,
        note: body.note?.trim() || null,
        photo_url: productionPhotoUrls[0] ?? null,
      })

      if (customStageKey) {
        const evidenceError = await insertCustomProductionEvidence(supabase, {
          orderId,
          stageKey: customStageKey,
          note: body.note.trim(),
          photoUrls: productionPhotoUrls,
          actorId: caller.id,
          metadata: {
            order_stage: targetStage,
            from_stage: order.stage,
            fabric_source: order.fabric_source ?? null,
            delivery_method: order.delivery_method ?? null,
            tracking_number: normalizedTrackingNumber || null,
            carrier: normalizedProvider || null,
            media_fingerprints: productionMediaFingerprints,
            media_count: productionPhotoUrls.length,
          },
        })

        if (evidenceError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: evidenceError.message, surface: 'order_production_evidence' })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }
      }

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
        },
      })

      log('info', FN, 'order.stage_changed', { actor_id: caller.id, order_id: orderId, from_stage: order.stage, to_stage: targetStage })

      const stageNotif = customerNotificationForStage(targetStage, order)
      if (stageNotif && order.customer_id) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, order.customer_id.toString(), { ...stageNotif, preferenceKey: 'orderUpdates', data: { orderId } })
        )
        queueCustomerOrderEmail(supabase, order, stageNotif.title, stageNotif.body, productionPhotoUrls[0] ?? null)

        const stageSms = buildCustomerStageSms({
          id: order.id,
          reference: order.reference ?? null,
          orderKind: order.order_kind ?? null,
          garmentType: order.garment_type ?? null,
          itemTitle: order.item_title ?? null,
          itemSize: order.item_size ?? null,
          deliveryMethod: order.delivery_method ?? null,
          fulfillmentProvider: targetStage === 'READY_FOR_DRAPE_DISPATCH' ? 'Drapeon' : null,
          carrier: null,
        }, targetStage)

        if (stageSms) {
          EdgeRuntime.waitUntil(
            sendSmsToUser({
              supabase,
              userId: order.customer_id.toString(),
              audience: 'CUSTOMER',
              orderId,
              event: `order.stage_${targetStage.toLowerCase()}`,
              body: stageSms,
              fallbackPhone: targetStage === 'READY_FOR_COLLECTION' ? null : order.recipient_phone ?? null,
            }),
          )
        }
      }

      // Return the collection_code so the UI can display it immediately
      const responseBody: Record<string, unknown> = { ok: true }
      if (targetStage === 'READY_FOR_COLLECTION') {
        responseBody.collectionCode = (advancedOrder as { collection_code?: string | null }).collection_code ?? updates.collection_code
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
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
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
        const { data: incrementedAttempt, error: incrementError } = await supabase
          .rpc('increment_collection_code_attempt', {
            p_order_id: orderId,
            p_max_attempts: MAX_COLLECTION_CODE_ATTEMPTS,
          })
          .maybeSingle()

        if (incrementError) {
          log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: incrementError.message })
          return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
        }

        const failedAttempts = Math.max(
          0,
          Number((incrementedAttempt as { attempts?: number | null } | null)?.attempts ?? attempts + 1),
        )
        const locked = Boolean((incrementedAttempt as { locked?: boolean | null } | null)?.locked) ||
          failedAttempts >= MAX_COLLECTION_CODE_ATTEMPTS

        await audit(supabase, {
          event: 'collection_code.wrong',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          order_id: orderId,
          severity: 'warn',
          payload: { attempts: failedAttempts, locked },
        })
        if (locked) {
          return new Response(
            JSON.stringify({ error: 'Too many incorrect attempts. Try again after the 24-hour reset window or contact support.', attemptsRemaining: 0 }),
            { status: 423, headers: { ...cors, 'Content-Type': 'application/json' } },
          )
        }

        const remaining = Math.max(0, MAX_COLLECTION_CODE_ATTEMPTS - failedAttempts)
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
          handoff_completed_at: new Date().toISOString(),
          customer_handoff_confirmed_at: new Date().toISOString(),
          handoff_confirmation_source: 'COLLECTION_CODE_VERIFIED',
        })
        .eq('id', orderId)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, action, error: error.message })
        return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
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
            preferenceKey: 'orderUpdates',
            data: { orderId },
          })
        )
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return jsonErrorResponse(cors, 400, 'UNKNOWN_ACTION', 'This order action is not supported.')

  } catch (err) {
    log('error', FN, 'unhandled_exception', { error: String(err) })
    return jsonResponse({ error: 'We could not update this order right now. Please try again.' }, 500, cors)
  }
})
