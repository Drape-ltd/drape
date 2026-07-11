import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { sendOrderEventEmail } from '../_shared/order-email.ts'
import { serializeOrderSupportMeta } from '../_shared/order-support.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { normalizeStoredPhone, validateRecipientPhone } from '../_shared/phone.ts'
import { parseBody, z } from '../_shared/validate.ts'
import {
  normalizeAccountCurrency,
  resolvePaymentProviderForCurrency,
  resolveSellerOrderCurrency,
} from '../../../packages/shared/src/currency-config.ts'
import {
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  customOrderMinimumDeliveryDate,
  isAllowedCustomStyleReference,
  isCustomFabricSourcingDeadline,
  isCustomOrderBriefLongEnough,
  isKnownCustomGarmentType,
} from '../../../packages/shared/src/custom-order-flow.ts'
import { ORDER_CANCELLATION_POLICY_VERSION } from '../../../packages/shared/src/checkout-policy.ts'
import { normalizeTaxCountryCode } from '../../../packages/shared/src/tax.ts'
import { resolveDeadlineContextWarning } from '../../../packages/shared/src/deadline-context.ts'

const FN = 'custom-order-action'
const STALE_MEASUREMENT_MONTHS = 6
const ORDER_CONTRACT_VERSION = 1
const MEASUREMENT_FALLBACK_MIN_CHARS = 24
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const IN_PROGRESS_ORDER_STAGES = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
] as const

const BodySchema = z.object({
  action: z.enum(['create-order', 'preflight-create-order']),
  tailorProfileId: z.string().trim().uuid(),
  garmentType: z.string().trim().min(2).max(80),
  garmentTypeOther: z.string().trim().max(80).optional().nullable(),
  genderPresentation: z.enum(['Menswear', 'Womenswear', 'Unisex']).optional().nullable(),
  description: z.string().trim().min(1).max(1200),
  occasion: z.string().trim().max(80).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  referencePhotos: z.array(z.string().url()).max(CUSTOM_ORDER_MAX_REFERENCE_PHOTOS).default([]),
  referencePhotoCount: z.number().int().min(0).max(CUSTOM_ORDER_MAX_REFERENCE_PHOTOS).optional().default(0),
  styleReferenceLinks: z.array(z.string().trim().url()).max(CUSTOM_ORDER_MAX_STYLE_LINKS).default([]),
  styleNotes: z.string().trim().max(1200).optional().nullable(),
  customerMeasurementsSnapshot: z.unknown().optional().nullable(),
  fitNote: z.string().trim().max(2000).optional().nullable(),
  bodyNote: z.string().trim().max(1000).optional().nullable(),
  fabricSource: z.enum(['CUSTOMER_SUPPLIES', 'TAILOR_SOURCES']),
  fabricDescription: z.string().trim().max(1000).optional().nullable(),
  fabricBudgetAmount: z.number().int().nonnegative().optional().nullable(),
  fabricBudgetCurrency: z.string().trim().max(3).optional().nullable(),
  fabricSourcingDeadlineDays: z.number().int().optional().nullable(),
  supportMeta: z.unknown().optional().nullable(),
  deliveryMethod: z.enum(['SHIPPING', 'LOCAL_DELIVERY', 'LOCAL_COLLECTION']),
  shippingPreference: z.enum(['STANDARD', 'EXPRESS']).optional().nullable(),
  deliveryInstructions: z.string().trim().max(500).optional().nullable(),
  deliveryAddress: z.string().trim().max(500).optional().nullable(),
  deliveryCity: z.string().trim().max(120).optional().nullable(),
  deliveryRegion: z.string().trim().max(120).optional().nullable(),
  deliveryPostalCode: z.string().trim().max(40).optional().nullable(),
  deliveryCountryCode: z.string().trim().max(32).optional().nullable(),
  recipientName: z.string().trim().max(120).optional().nullable(),
  recipientPhone: z.string().trim().max(40).optional().nullable(),
  cancellationPolicyAcknowledged: z.boolean().optional(),
})

function buildReference() {
  return `DRP${Date.now().toString(36).toUpperCase().slice(-6)}`
}

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(
  corsHeaders: HeadersInit,
  status: number,
  code: string,
  error: string,
) {
  return jsonResponse({ code, error }, status, corsHeaders)
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function addBusinessDays(start: Date, businessDays: number) {
  const result = new Date(start)
  result.setHours(12, 0, 0, 0)
  let remaining = businessDays
  while (remaining > 0) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return result
}

function normalizeDeadline(value: string | null | undefined) {
  if (!value) return null
  const deadline = new Date(value)
  deadline.setHours(0, 0, 0, 0)
  return deadline
}

function isDeadlineAllowed(value: string | null | undefined, now = new Date()) {
  const deadline = normalizeDeadline(value)
  if (!deadline) return false
  return deadline.getTime() >= customOrderMinimumDeliveryDate(now).getTime()
}

function measurementValue(snapshot: unknown, key: string) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const value = (snapshot as Record<string, unknown>)[key]
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function missingCoreMeasurements(snapshot: unknown, garmentType: string) {
  const normalizedGarment = garmentType.trim().toLowerCase()
  if (normalizedGarment === 'gele') return []
  const required = ['chest', 'waist', 'hips', 'height']
  return required.filter((field) => measurementValue(snapshot, field) == null)
}

function hasMeasurementFallbackNote(value: string | null | undefined) {
  return (value ?? '').trim().length >= MEASUREMENT_FALLBACK_MIN_CHARS
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeWearerContext(supportMeta: Record<string, unknown> | null, snapshot: unknown) {
  const snapshotRecord = objectRecord(snapshot)
  const source =
    objectRecord(supportMeta?.wearerContext) ??
    objectRecord(snapshotRecord?.wearerContext) ??
    {}
  const rawMode = source.mode
  const mode = rawMode === 'OTHER' || rawMode === 'GROUP' ? rawMode : 'SELF'
  const rawLabel = typeof source.label === 'string' ? source.label.trim() : ''
  const label = rawLabel || (mode === 'GROUP' ? 'Group order' : 'Me')
  return {
    mode,
    label,
    measurementProfileLabel:
      typeof source.measurementProfileLabel === 'string' && source.measurementProfileLabel.trim()
        ? source.measurementProfileLabel.trim()
        : label,
    relationship: mode === 'GROUP' ? 'GROUP' : mode === 'OTHER' ? 'NAMED_OTHER' : 'BUYER',
    selectedAt: typeof source.selectedAt === 'string' && source.selectedAt.trim()
      ? source.selectedAt
      : new Date().toISOString(),
    note: typeof source.note === 'string' && source.note.trim() ? source.note.trim() : null,
  }
}

function dateFromRecord(record: Record<string, unknown> | null, fields: string[]) {
  for (const field of fields) {
    const value = record?.[field]
    if (typeof value !== 'string' || value.trim().length === 0) continue
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}

function normalizeMeasurementAge(supportMeta: Record<string, unknown> | null, snapshot: unknown) {
  const snapshotRecord = objectRecord(snapshot)
  const source = objectRecord(supportMeta?.measurementAge)
  const lastUpdated =
    dateFromRecord(source, ['lastUpdatedAt']) ??
    dateFromRecord(snapshotRecord, ['measurementProfileUpdatedAt', 'capturedAt', 'confirmedAt'])
  if (!lastUpdated) return null
  const sourceAge = source?.ageMonths
  const ageMonths =
    typeof sourceAge === 'number' && Number.isFinite(sourceAge) && sourceAge >= 0
      ? Math.floor(sourceAge)
      : Math.max(
          0,
          Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
        )
  const sourceStale = source?.stale
  const stale =
    typeof sourceStale === 'boolean' ? sourceStale : ageMonths >= STALE_MEASUREMENT_MONTHS
  return {
    lastUpdatedAt: lastUpdated.toISOString(),
    ageMonths,
    stale,
    warningShown: typeof source?.warningShown === 'boolean' ? source.warningShown : stale,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonError(cors, 401, 'UNAUTHORIZED', 'You need to sign in again before placing this order.')
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonError(cors, 400, 'VALIDATION_FAILED', parsed.error)
    }

    const body = parsed.data
    const normalizedGarmentTypeOther = normalizeText(body.garmentTypeOther)
    const normalizedBodyNote = normalizeText(body.bodyNote) ?? normalizeText(body.fitNote)
    const referencePhotos = body.referencePhotos ?? []
    const preflightReferencePhotoCount = body.action === 'preflight-create-order' ? body.referencePhotoCount ?? 0 : 0
    const styleReferenceLinks = [...new Set((body.styleReferenceLinks ?? []).map((link) => link.trim()))]
    const hasStyleReference = referencePhotos.length + preflightReferencePhotoCount > 0 || styleReferenceLinks.length > 0

    if (!isKnownCustomGarmentType(body.garmentType)) {
      return jsonError(cors, 400, 'GARMENT_TYPE_UNSUPPORTED', 'Choose a supported garment type or select Other.')
    }

    if (body.garmentType === 'Other' && !normalizedGarmentTypeOther) {
      return jsonError(cors, 400, 'GARMENT_TYPE_OTHER_REQUIRED', 'Tell the tailor what garment you are having made.')
    }

    if (!body.genderPresentation) {
      return jsonError(cors, 400, 'GENDER_PRESENTATION_REQUIRED', 'Choose the fit category for this garment.')
    }

    if (!isCustomOrderBriefLongEnough(body.description)) {
      return jsonError(cors, 400, 'BRIEF_TOO_SHORT', 'Brief description must include 3 short lines or one clear paragraph.')
    }

    if (!isDeadlineAllowed(body.deadline)) {
      return jsonError(cors, 400, 'DELIVERY_DATE_TOO_SOON', 'Target delivery date must be at least 2 weeks from today.')
    }

    if (!hasStyleReference) {
      return jsonError(cors, 400, 'STYLE_REFERENCE_REQUIRED', 'Add at least one photo or supported style reference link.')
    }

    const unsupportedStyleLink = styleReferenceLinks.find((link) => !isAllowedCustomStyleReference(link))
    if (unsupportedStyleLink) {
      return jsonError(cors, 400, 'STYLE_LINK_UNSUPPORTED', 'Style links must be from Instagram, Pinterest, or TikTok.')
    }

    const fabricSourcingDeadlineDays =
      body.fabricSource === 'TAILOR_SOURCES'
        ? body.fabricSourcingDeadlineDays ?? CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS
        : null

    if (body.fabricSource === 'TAILOR_SOURCES') {
      if (!normalizeText(body.fabricDescription)) {
        return jsonError(cors, 400, 'FABRIC_DESCRIPTION_REQUIRED', 'Describe the fabric the tailor should source before submitting.')
      }

      if (!isCustomFabricSourcingDeadline(fabricSourcingDeadlineDays)) {
        return jsonError(cors, 400, 'FABRIC_SOURCING_DEADLINE_INVALID', 'Choose a supported fabric sourcing deadline.')
      }
    }

    const normalizedFabricBudgetCurrency = body.fabricBudgetCurrency
      ? normalizeAccountCurrency(body.fabricBudgetCurrency)
      : null
    if (body.fabricBudgetAmount && !normalizedFabricBudgetCurrency) {
      return jsonError(cors, 400, 'FABRIC_BUDGET_CURRENCY_INVALID', 'Choose a supported currency for the fabric budget.')
    }

    const needsRecipientDeliveryDetails = body.deliveryMethod !== 'LOCAL_COLLECTION'
    const normalizedDeliveryAddress = needsRecipientDeliveryDetails ? body.deliveryAddress?.trim() ?? '' : ''
    const normalizedDeliveryCity = needsRecipientDeliveryDetails ? body.deliveryCity?.trim() ?? '' : ''
    const normalizedDeliveryRegion = needsRecipientDeliveryDetails ? body.deliveryRegion?.trim() ?? '' : ''
    const normalizedDeliveryPostalCode = needsRecipientDeliveryDetails ? body.deliveryPostalCode?.trim() ?? '' : ''
    const normalizedDeliveryCountryCode = needsRecipientDeliveryDetails ? normalizeTaxCountryCode(body.deliveryCountryCode) ?? '' : ''
    const normalizedRecipientName = needsRecipientDeliveryDetails ? body.recipientName?.trim() ?? '' : ''
    const normalizedRecipientPhone = needsRecipientDeliveryDetails ? normalizeStoredPhone(body.recipientPhone) : ''
    const normalizedShippingPreference = body.deliveryMethod === 'SHIPPING' ? body.shippingPreference ?? 'STANDARD' : null

    if (needsRecipientDeliveryDetails && !normalizedDeliveryAddress) {
      return jsonError(cors, 400, 'DELIVERY_ADDRESS_REQUIRED', 'Delivery address is required for this fulfillment option.')
    }

    if (needsRecipientDeliveryDetails && !normalizedRecipientName) {
      return jsonError(cors, 400, 'RECIPIENT_NAME_REQUIRED', 'Recipient name is required for this fulfillment option.')
    }

    if (needsRecipientDeliveryDetails && !normalizedRecipientPhone) {
      return jsonError(cors, 400, 'RECIPIENT_PHONE_REQUIRED', 'Recipient phone is required for this fulfillment option.')
    }

    if (needsRecipientDeliveryDetails) {
      const recipientPhoneError = validateRecipientPhone(normalizedRecipientPhone)
      if (recipientPhoneError) {
        return jsonError(cors, 400, 'RECIPIENT_PHONE_INVALID', recipientPhoneError)
      }
    }

    if (body.deliveryMethod === 'SHIPPING' && !normalizedShippingPreference) {
      return jsonError(cors, 400, 'SHIPPING_PREFERENCE_REQUIRED', 'Choose standard or express shipping before submitting.')
    }

    if (body.cancellationPolicyAcknowledged !== true) {
      return jsonError(
        cors,
        400,
        'CANCELLATION_POLICY_REQUIRED',
        'Review and acknowledge the cancellation policy before submitting this order.',
      )
    }

    const supportMeta = body.supportMeta && typeof body.supportMeta === 'object' && !Array.isArray(body.supportMeta)
      ? body.supportMeta as Record<string, unknown>
      : null
    const wearerContext = normalizeWearerContext(supportMeta, body.customerMeasurementsSnapshot)
    const measurementAge = normalizeMeasurementAge(supportMeta, body.customerMeasurementsSnapshot)
    const measurementSnapshot = objectRecord(body.customerMeasurementsSnapshot)
      ? {
          ...(body.customerMeasurementsSnapshot as Record<string, unknown>),
          wearerContext,
          measurementProfileLabel: wearerContext.measurementProfileLabel,
          measurementAge,
        }
      : body.customerMeasurementsSnapshot

    if (body.fabricSource === 'CUSTOMER_SUPPLIES' && !supportMeta?.fabricHandoffMode) {
      return jsonError(cors, 400, 'FABRIC_HANDOFF_REQUIRED', 'Tell the tailor how your fabric will reach them before submitting this order.')
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 20)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const missingMeasurements = missingCoreMeasurements(measurementSnapshot, body.garmentType)
    const hasStructuredMeasurements =
      !!measurementSnapshot && typeof measurementSnapshot === 'object' && !Array.isArray(measurementSnapshot)
    const hasMeasurementFallback = hasMeasurementFallbackNote(normalizedBodyNote)
    const measurementPreflight = runPreflight([
      {
        name: 'measurement_snapshot_present',
        condition: hasStructuredMeasurements || hasMeasurementFallback,
        errorCode: 'MEASUREMENTS_REQUIRED',
        message: 'Add a measurement profile or explain that the tailor should follow up for measurements before quoting.',
        field: 'customerMeasurementsSnapshot',
        severity: 'BLOCKING',
        actual: { hasMeasurements: hasStructuredMeasurements, hasMeasurementFallback },
      },
      {
        name: 'core_measurements_present',
        condition: missingMeasurements.length === 0 || hasMeasurementFallback,
        errorCode: 'MEASUREMENTS_INCOMPLETE',
        message: missingMeasurements.length > 0
          ? `Your measurement profile is missing ${missingMeasurements.join(', ')} for this garment type. Add them, or explain that the tailor should follow up before quoting.`
          : 'Your measurement profile is complete enough for this order.',
        field: 'customerMeasurementsSnapshot',
        severity: 'BLOCKING',
        actual: { missingMeasurements, garmentType: body.garmentType, hasMeasurementFallback },
      },
    ])

    if (!measurementPreflight.passed) {
      await logPreflightFailure(supabase, measurementPreflight, {
        operation: 'custom_order_create',
        entityType: 'tailor_profile',
        entityId: body.tailorProfileId,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        userId: caller.id,
        source: FN,
        metadata: { garmentType: body.garmentType, missingMeasurements },
      })
      return preflightFailureResponse(measurementPreflight, cors, 400)
    }

    const blockedDescription = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      surface: 'custom_order.description',
      text: body.description,
      message: "Contact details can't be included in the order description.",
      extra: { field: 'description' },
    })
    if (blockedDescription) return blockedDescription

    const blockedFitNote = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      surface: 'custom_order.fit_note',
      text: body.fitNote,
      message: "Contact details can't be included in fit notes.",
      extra: { field: 'fit_note' },
    })
    if (blockedFitNote) return blockedFitNote

    const blockedOccasion = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      surface: 'custom_order.occasion',
      text: body.occasion,
      message: "Contact details can't be included in occasion notes.",
      extra: { field: 'occasion' },
    })
    if (blockedOccasion) return blockedOccasion

    const contactCheckedFields: Array<[string, string, string | null | undefined, string]> = [
      ['custom_order.garment_type_other', 'garment_type_other', normalizedGarmentTypeOther, "Contact details can't be included in the garment type."],
      ['custom_order.style_notes', 'style_notes', body.styleNotes, "Contact details can't be included in style notes."],
      ['custom_order.body_note', 'body_note', normalizedBodyNote, "Contact details can't be included in body notes."],
      ['custom_order.fabric_description', 'fabric_description', body.fabricDescription, "Contact details can't be included in fabric notes."],
      ['custom_order.delivery_instructions', 'delivery_instructions', body.deliveryInstructions, "Contact details can't be included in delivery instructions."],
    ]

    for (const [surface, field, text, message] of contactCheckedFields) {
      const blocked = await rejectIfBlockedContact({
        supabase,
        fn: FN,
        cors,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        surface,
        text,
        message,
        extra: { field },
      })
      if (blocked) return blocked
    }

    const bulkMeta = objectRecord(supportMeta?.bulkOrder)
    const blockedStructuredContext = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      surface: 'custom_order.structured_context',
      text: [
        wearerContext.label,
        typeof bulkMeta?.label === 'string' ? bulkMeta.label : null,
        typeof bulkMeta?.notes === 'string' ? bulkMeta.notes : null,
        ...stringList(bulkMeta?.memberNames),
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n'),
      message: "Contact details can't be included in group or wearer details.",
      extra: { field: 'support_meta' },
    })
    if (blockedStructuredContext) return blockedStructuredContext

    const { data: accountRow, error: accountError } = await supabase
      .from('users')
      .select('default_currency')
      .eq('id', caller.id)
      .maybeSingle()

    if (accountError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: accountError.message, surface: 'users.default_currency' })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not resolve your account currency right now.')
    }

    const accountCurrency = normalizeAccountCurrency((accountRow as any)?.default_currency) ?? 'USD'

    const { data: tailorProfile, error: tailorError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id, is_live, supports_custom_orders, availability, location, currency, payout_currency, payout_provider, payout_account_type, paystack_recipient_code, paystack_account_id, stripe_connect_account_id, stripe_account_id')
      .eq('id', body.tailorProfileId)
      .maybeSingle()

    if (tailorError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: tailorError.message })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not check this seller right now.')
    }

    const orderCurrency = resolveSellerOrderCurrency({
      tailorCurrency: (tailorProfile as any)?.currency,
      payoutCurrency: (tailorProfile as any)?.payout_currency,
      payoutProvider: (tailorProfile as any)?.payout_provider,
      payoutAccountType: (tailorProfile as any)?.payout_account_type,
      hasPaystackRecipient: !!((tailorProfile as any)?.paystack_recipient_code ?? (tailorProfile as any)?.paystack_account_id),
      hasStripeConnectAccount: !!((tailorProfile as any)?.stripe_connect_account_id ?? (tailorProfile as any)?.stripe_account_id),
      customerCurrency: accountCurrency,
    })

    const sellerPreflight = runPreflight([
      {
        name: 'tailor_exists',
        condition: !!tailorProfile?.id && !!tailorProfile?.user_id,
        errorCode: 'SELLER_NOT_FOUND',
        message: 'Seller not found.',
        field: 'tailorProfileId',
        severity: 'BLOCKING',
        actual: { tailorProfileId: body.tailorProfileId },
      },
      {
        name: 'not_ordering_from_self',
        condition: tailorProfile?.user_id !== caller.id,
        errorCode: 'SELF_ORDER_BLOCKED',
        message: 'You cannot place an order with your own tailor profile.',
        field: 'tailorProfileId',
        severity: 'BLOCKING',
        actual: { customerId: caller.id, tailorUserId: tailorProfile?.user_id ?? null },
      },
      {
        name: 'tailor_live_for_custom_orders',
        condition: tailorProfile?.is_live === true && tailorProfile?.supports_custom_orders === true,
        errorCode: 'SELLER_UNAVAILABLE',
        message: 'This seller is not accepting custom orders right now.',
        field: 'is_live',
        severity: 'BLOCKING',
        actual: {
          is_live: tailorProfile?.is_live ?? null,
          supports_custom_orders: tailorProfile?.supports_custom_orders ?? null,
        },
      },
      {
        name: 'tailor_accepting_orders',
        condition: tailorProfile?.availability !== 'FULLY_BOOKED',
        errorCode: 'SELLER_ON_BREAK',
        message: 'This tailor is not currently accepting orders. Check back later or browse other tailors.',
        field: 'availability',
        severity: 'BLOCKING',
        actual: { availability: tailorProfile?.availability ?? null },
      },
      {
        name: 'seller_order_currency_resolved',
        condition: !!orderCurrency,
        errorCode: 'SELLER_PAYMENT_SETUP_NEEDS_REVIEW',
        message: 'This tailor’s payment setup needs review before they can accept new paid orders.',
        field: 'currency',
        severity: 'BLOCKING',
        actual: {
          accountCurrency,
          tailorCurrency: (tailorProfile as any)?.currency ?? null,
          payoutCurrency: (tailorProfile as any)?.payout_currency ?? null,
          orderCurrency,
        },
      },
    ])

    if (!sellerPreflight.passed) {
      await logPreflightFailure(supabase, sellerPreflight, {
        operation: 'custom_order_create',
        entityType: 'tailor_profile',
        entityId: body.tailorProfileId,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        userId: caller.id,
        source: FN,
      })
      return preflightFailureResponse(sellerPreflight, cors, sellerPreflight.failures[0]?.errorCode === 'SELLER_NOT_FOUND' ? 404 : 409)
    }

    if (!tailorProfile?.id || !tailorProfile.user_id) {
      return jsonError(cors, 404, 'SELLER_NOT_FOUND', 'Seller not found.')
    }

    if (!tailorProfile.is_live || !tailorProfile.supports_custom_orders) {
      return jsonError(cors, 409, 'SELLER_UNAVAILABLE', 'This seller is not accepting custom orders right now.')
    }

    if (tailorProfile.availability === 'FULLY_BOOKED') {
      return jsonError(cors, 409, 'SELLER_ON_BREAK', 'This seller is on a break and is not accepting new orders right now.')
    }

    if (body.deliveryMethod === 'LOCAL_COLLECTION') {
      const { data: pickupDetails, error: pickupDetailsError } = await supabase
        .from('tailor_pickup_details')
        .select('pickup_address')
        .eq('user_id', tailorProfile.user_id)
        .maybeSingle()

      if (pickupDetailsError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: pickupDetailsError.message })
        return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not check pickup details for this seller right now.')
      }

      if (!pickupDetails?.pickup_address?.trim()) {
        return jsonError(
          cors,
          409,
          'PICKUP_NOT_READY',
          'This seller has not finished pickup details yet. Please choose shipping or try local collection later.',
        )
      }
    }

    const { count: duplicateOrderCount, error: duplicateOrderError } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', caller.id)
      .eq('tailor_profile_id', body.tailorProfileId)
      .eq('order_kind', 'CUSTOM')
      .in('stage', [...IN_PROGRESS_ORDER_STAGES])

    if (duplicateOrderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: duplicateOrderError.message, surface: 'duplicate_order_check' })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not check existing orders right now.')
    }

    const duplicatePreflight = runPreflight([
      {
        name: 'no_duplicate_in_progress_order',
        condition: (duplicateOrderCount ?? 0) === 0,
        errorCode: 'DUPLICATE_ORDER_IN_PROGRESS',
        message: 'You already have an active order with this tailor. Open that order before starting another one.',
        field: 'tailorProfileId',
        severity: 'BLOCKING',
        actual: { duplicateOrderCount: duplicateOrderCount ?? 0 },
      },
    ])

    if (!duplicatePreflight.passed) {
      await logPreflightFailure(supabase, duplicatePreflight, {
        operation: 'custom_order_create',
        entityType: 'tailor_profile',
        entityId: body.tailorProfileId,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        userId: caller.id,
        source: FN,
        metadata: { duplicateOrderCount: duplicateOrderCount ?? 0 },
      })
      return preflightFailureResponse(duplicatePreflight, cors, 409)
    }

    if (body.action === 'preflight-create-order') {
      return jsonResponse({ ok: true, preflight: true }, 200, cors)
    }

    const lockedTailorPayoutCurrency =
      resolveSellerOrderCurrency({
        tailorCurrency: (tailorProfile as any)?.currency,
        payoutCurrency: (tailorProfile as any)?.payout_currency,
        payoutProvider: (tailorProfile as any)?.payout_provider,
        payoutAccountType: (tailorProfile as any)?.payout_account_type,
        hasPaystackRecipient: !!((tailorProfile as any)?.paystack_recipient_code ?? (tailorProfile as any)?.paystack_account_id),
        hasStripeConnectAccount: !!((tailorProfile as any)?.stripe_connect_account_id ?? (tailorProfile as any)?.stripe_account_id),
        customerCurrency: orderCurrency,
      })
    const lockedTailorPayoutProvider = resolvePaymentProviderForCurrency(lockedTailorPayoutCurrency)
    const deadlineContextWarning = resolveDeadlineContextWarning({
      deadline: body.deadline,
      fulfillmentOption: body.deliveryMethod,
      shippingCountry: body.deliveryCountryCode,
      tailorCountry: null,
    })
    const { data: referralRow, error: referralError } = await supabase
      .from('referrals')
      .select('referrer_user_id, trust_context, claimed_at')
      .eq('referred_user_id', caller.id)
      .eq('status', 'CLAIMED')
      .order('claimed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (referralError) {
      log('warn', FN, 'referral_trust.lookup_failed', {
        actor_id: caller.id,
        error: referralError.message,
      })
    }

    const referralTrustContext = objectRecord((referralRow as { trust_context?: unknown } | null)?.trust_context)
    const referralTrust = referralRow
      ? {
        referrerUserId: (referralRow as { referrer_user_id?: string }).referrer_user_id ?? null,
        referrerName: typeof referralTrustContext?.referrerName === 'string'
          ? referralTrustContext.referrerName
          : null,
        completedOrderCount: typeof referralTrustContext?.completedOrderCount === 'number'
          ? referralTrustContext.completedOrderCount
          : null,
        visibleToTailor: true,
      }
      : (objectRecord(supportMeta?.referralTrust) ? supportMeta?.referralTrust : null)

    const nextSupportMeta = {
      ...(supportMeta ?? {}),
      orderContract: {
        version: ORDER_CONTRACT_VERSION,
        orderKind: 'CUSTOM',
        createdAt: new Date().toISOString(),
      },
      wearerContext,
      measurementAge,
      deadlineContext: deadlineContextWarning
        ? {
          warningCode: deadlineContextWarning.code,
          warningShown: true,
          message: deadlineContextWarning.message,
          suggestedDate: deadlineContextWarning.suggestedDate ?? null,
        }
        : null,
      referralTrust,
      customOrder: {
        garmentType: body.garmentType,
        garmentTypeOther: normalizedGarmentTypeOther,
        genderPresentation: body.genderPresentation,
        targetDeliveryDate: body.deadline,
        referencePhotoCount: referencePhotos.length,
        styleReferenceLinkCount: styleReferenceLinks.length,
        shippingPreference: normalizedShippingPreference,
      },
      styleReferenceLinks,
      styleAlignment: {
        requiredBeforeCutting: true,
        status: referencePhotos.length > 0 || styleReferenceLinks.length > 0
          ? 'NEEDS_TAILOR_CONFIRMATION'
          : 'NOT_REQUIRED',
        referencePhotoCount: referencePhotos.length,
        styleReferenceLinkCount: styleReferenceLinks.length,
        instruction:
          'Before cutting, confirm what can and cannot be matched from the customer references inside Drape.',
        customerExpectation:
          'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.',
      },
      styleNotes: normalizeText(body.styleNotes),
      bodyNote: normalizedBodyNote,
      measurementFallback: hasMeasurementFallback && missingMeasurements.length > 0
        ? {
          requiredBeforeQuote: true,
          missingMeasurements,
          note: normalizedBodyNote,
        }
        : null,
      fabricSourcing: body.fabricSource === 'TAILOR_SOURCES'
        ? {
          description: normalizeText(body.fabricDescription),
          budgetAmount: body.fabricBudgetAmount ?? null,
          budgetCurrency: normalizedFabricBudgetCurrency,
          deadlineBusinessDays: fabricSourcingDeadlineDays,
        }
        : null,
      deliveryInstructions: normalizeText(body.deliveryInstructions),
      checkoutPolicy: {
        cancellationPolicyVersion: ORDER_CANCELLATION_POLICY_VERSION,
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: caller.id,
        policyName: 'order-cancellation-policy',
      },
    }

    const orderReference = buildReference()
    const { data: created, error: createError } = await supabase
      .from('orders')
      .insert({
        customer_id: caller.id,
        tailor_profile_id: body.tailorProfileId,
        tailor_id: tailorProfile.user_id,
        order_kind: 'CUSTOM',
        reference: orderReference,
        garment_type: body.garmentType,
        garment_description: body.description,
        occasion: body.occasion?.trim() || null,
        deadline: body.deadline ?? null,
        reference_photos: referencePhotos,
        customer_measurements_snapshot: measurementSnapshot ?? null,
        fit_note: normalizedBodyNote,
        fabric_source: body.fabricSource,
        special_note: serializeOrderSupportMeta(nextSupportMeta as any),
        delivery_method: body.deliveryMethod,
        delivery_address: needsRecipientDeliveryDetails ? normalizedDeliveryAddress || null : null,
        delivery_city: needsRecipientDeliveryDetails ? normalizedDeliveryCity || null : null,
        delivery_region: needsRecipientDeliveryDetails ? normalizedDeliveryRegion || null : null,
        delivery_postal_code: needsRecipientDeliveryDetails ? normalizedDeliveryPostalCode || null : null,
        delivery_country_code: needsRecipientDeliveryDetails ? normalizedDeliveryCountryCode || null : null,
        recipient_name: needsRecipientDeliveryDetails ? normalizedRecipientName || null : null,
        recipient_phone: needsRecipientDeliveryDetails ? normalizedRecipientPhone || null : null,
        currency: orderCurrency,
        quoted_currency: orderCurrency,
        tailor_payout_currency_locked: lockedTailorPayoutCurrency,
        tailor_payout_provider_locked: lockedTailorPayoutProvider,
        tailor_paystack_recipient_code_locked:
          lockedTailorPayoutProvider === 'PAYSTACK'
            ? ((tailorProfile as any)?.paystack_recipient_code ?? (tailorProfile as any)?.paystack_account_id ?? null)
            : null,
        tailor_stripe_connect_account_id_locked:
          lockedTailorPayoutProvider === 'STRIPE'
            ? ((tailorProfile as any)?.stripe_connect_account_id ?? (tailorProfile as any)?.stripe_account_id ?? null)
            : null,
        fulfillment_fee: 0,
        stage: 'PENDING_QUOTE',
        stage_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (createError || !created?.id) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: createError?.message ?? 'create failed' })
      return jsonError(cors, 500, 'ORDER_CREATE_FAILED', 'Could not submit your order right now.')
    }

    const fabricApprovalRequired = body.fabricSource === 'TAILOR_SOURCES'
    const fabricSourcingDeadlineAt = fabricSourcingDeadlineDays
      ? addBusinessDays(new Date(), fabricSourcingDeadlineDays).toISOString()
      : null

    const { error: detailError } = await supabase
      .from('custom_order_details')
      .insert({
        order_id: created.id,
        garment_type_other: normalizedGarmentTypeOther,
        gender_presentation: body.genderPresentation,
        social_reference_links: styleReferenceLinks,
        style_notes: normalizeText(body.styleNotes),
        body_note: normalizedBodyNote,
        fabric_description: normalizeText(body.fabricDescription),
        fabric_budget_amount: body.fabricBudgetAmount ?? null,
        fabric_budget_currency: normalizedFabricBudgetCurrency,
        fabric_sourcing_deadline_days: fabricSourcingDeadlineDays,
        fabric_sourcing_deadline_at: fabricSourcingDeadlineAt,
        fabric_approval_required: fabricApprovalRequired,
        fabric_approval_status: fabricApprovalRequired ? 'PENDING_TAILOR_UPLOAD' : 'NOT_REQUIRED',
        shipping_preference: normalizedShippingPreference,
        delivery_instructions: normalizeText(body.deliveryInstructions),
        target_delivery_date: body.deadline,
      })

    if (detailError) {
      await supabase.from('orders').delete().eq('id', created.id)
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: created.id, error: detailError.message, surface: 'custom_order_details' })
      return jsonError(cors, 500, 'ORDER_CREATE_FAILED', 'Could not submit your order right now.')
    }

    if (wearerContext.mode === 'OTHER' && objectRecord(measurementSnapshot)) {
      const { error: namedProfileError } = await supabase
        .from('customer_measurement_profiles')
        .insert({
          customer_id: caller.id,
          label: wearerContext.measurementProfileLabel,
          relationship: 'OTHER',
          measurements: measurementSnapshot,
          unit_preference: typeof (measurementSnapshot as Record<string, unknown>).unit === 'string'
            ? (measurementSnapshot as Record<string, unknown>).unit
            : 'cm',
          source: 'IMPORT',
          is_default: false,
          last_measured_at: measurementAge?.lastUpdatedAt ?? new Date().toISOString(),
        })

      if (namedProfileError) {
        log('warn', FN, 'measurement_profile.create_failed', {
          actor_id: caller.id,
          order_id: created.id,
          error: namedProfileError.message,
        })
      }
    }

    const createdGroupMembers: string[] = []
    const groupMeta = objectRecord((nextSupportMeta as Record<string, unknown>).bulkOrder)
    const rawGroupCount = typeof groupMeta?.recipientCount === 'number' ? groupMeta.recipientCount : null
    const groupCount = rawGroupCount != null && Number.isFinite(rawGroupCount)
      ? Math.max(0, Math.trunc(rawGroupCount))
      : 0
    const groupNames = stringList(groupMeta?.memberNames)
    if (wearerContext.mode === 'GROUP' && groupCount >= 2) {
      const memberNames = Array.from({ length: groupCount }, (_, index) =>
        groupNames[index]?.trim() || `Group member ${index + 1}`
      )
      const { data: groupRows, error: groupMemberError } = await supabase
        .from('order_group_members')
        .insert(memberNames.map((name) => ({
          order_id: created.id,
          owner_customer_id: caller.id,
          display_name: name,
          role: 'WEARER',
          status: 'DRAFT',
        })))
        .select('id')

      if (groupMemberError) {
        await supabase.from('custom_order_details').delete().eq('order_id', created.id)
        await supabase.from('orders').delete().eq('id', created.id)
        log('error', FN, 'group_members.create_failed', {
          actor_id: caller.id,
          order_id: created.id,
          error: groupMemberError.message,
        })
        return jsonError(cors, 500, 'GROUP_MEMBERS_SAVE_FAILED', 'Could not save the group members for this order. Please try again.')
      }
      createdGroupMembers.push(...((groupRows ?? []) as Array<{ id: string }>).map((row) => row.id))
    }

    await queueMediaSafetyReview(supabase, {
      fn: FN,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      surface: 'custom_order.reference',
      publicUrls: referencePhotos,
      purpose: 'ORDER_REFERENCE',
      orderId: created.id,
      relatedEntityType: 'order',
      relatedEntityId: created.id,
      metadata: { referencePhotoCount: referencePhotos.length },
    })

    await audit(supabase, {
      event: 'custom_order.created',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: created.id,
      payload: {
        function: FN,
        tailor_profile_id: body.tailorProfileId,
        group_member_count: createdGroupMembers.length,
        wearer_mode: wearerContext.mode,
      },
    })

    const orderNotificationContext = {
      id: created.id,
      reference: orderReference,
      order_kind: 'CUSTOM',
      customer_id: caller.id,
      tailor_id: tailorProfile.user_id,
      garment_type: body.garmentType,
      delivery_method: body.deliveryMethod,
      quoted_currency: orderCurrency,
      currency: orderCurrency,
    }
    const notificationTitle = 'New custom order request'
    const notificationBody = `A customer sent a ${body.garmentType} brief. Review it and send a quote when you are ready.`

    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, tailorProfile.user_id.toString(), {
        title: notificationTitle,
        body: notificationBody,
        preferenceKey: 'newOrders',
        data: { orderId: created.id, type: 'custom_order_created' },
      }),
    )
    EdgeRuntime.waitUntil(
      sendOrderEventEmail(supabase, {
        order: orderNotificationContext,
        recipientUserId: tailorProfile.user_id.toString(),
        audience: 'TAILOR',
        subject: notificationTitle,
        headline: 'A customer sent you a new custom brief',
        body: notificationBody,
        ctaLabel: 'Review order',
      }),
    )

    return jsonResponse({ ok: true, orderId: created.id }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'INTERNAL_ERROR', 'Could not submit your order right now.')
  }
})
