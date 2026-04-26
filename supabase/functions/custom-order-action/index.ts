import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { serializeOrderSupportMeta } from '../_shared/order-support.ts'
import { normalizeStoredPhone, validateRecipientPhone } from '../_shared/phone.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'custom-order-action'

const BodySchema = z.object({
  action: z.literal('create-order'),
  tailorProfileId: z.string().trim().uuid(),
  garmentType: z.string().trim().min(2).max(80),
  description: z.string().trim().min(1).max(1200),
  occasion: z.string().trim().max(80).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  referencePhotos: z.array(z.string().url()).max(5).default([]),
  customerMeasurementsSnapshot: z.unknown().optional().nullable(),
  fitNote: z.string().trim().max(2000).optional().nullable(),
  fabricSource: z.enum(['CUSTOMER_SUPPLIES', 'TAILOR_SOURCES']),
  supportMeta: z.unknown().optional().nullable(),
  deliveryMethod: z.enum(['SHIPPING', 'LOCAL_DELIVERY', 'LOCAL_COLLECTION']),
  deliveryAddress: z.string().trim().max(500).optional().nullable(),
  recipientName: z.string().trim().max(120).optional().nullable(),
  recipientPhone: z.string().trim().max(40).optional().nullable(),
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
    const needsRecipientDeliveryDetails = body.deliveryMethod !== 'LOCAL_COLLECTION'
    const normalizedDeliveryAddress = needsRecipientDeliveryDetails ? body.deliveryAddress?.trim() ?? '' : ''
    const normalizedRecipientName = needsRecipientDeliveryDetails ? body.recipientName?.trim() ?? '' : ''
    const normalizedRecipientPhone = needsRecipientDeliveryDetails ? normalizeStoredPhone(body.recipientPhone) : ''

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

    const supportMeta = body.supportMeta && typeof body.supportMeta === 'object' && !Array.isArray(body.supportMeta)
      ? body.supportMeta as Record<string, unknown>
      : null

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
      return jsonError(cors, 429, 'RATE_LIMITED', 'Too many order attempts right now. Please wait a moment and try again.')
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

    const { data: tailorProfile, error: tailorError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id, is_live, supports_custom_orders, location')
      .eq('id', body.tailorProfileId)
      .maybeSingle()

    if (tailorError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: tailorError.message })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not check this seller right now.')
    }

    if (!tailorProfile?.id || !tailorProfile.user_id) {
      return jsonError(cors, 404, 'SELLER_NOT_FOUND', 'Seller not found.')
    }

    if (!tailorProfile.is_live || !tailorProfile.supports_custom_orders) {
      return jsonError(cors, 409, 'SELLER_UNAVAILABLE', 'This seller is not accepting custom orders right now.')
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

    const { data: created, error: createError } = await supabase
      .from('orders')
      .insert({
        customer_id: caller.id,
        tailor_profile_id: body.tailorProfileId,
        tailor_id: tailorProfile.user_id,
        order_kind: 'CUSTOM',
        reference: buildReference(),
        garment_type: body.garmentType,
        garment_description: body.description,
        occasion: body.occasion?.trim() || null,
        deadline: body.deadline ?? null,
        reference_photos: body.referencePhotos,
        customer_measurements_snapshot: body.customerMeasurementsSnapshot ?? null,
        fit_note: body.fitNote?.trim() || null,
        fabric_source: body.fabricSource,
        special_note: serializeOrderSupportMeta(supportMeta),
        delivery_method: body.deliveryMethod,
        delivery_address: needsRecipientDeliveryDetails ? normalizedDeliveryAddress || null : null,
        recipient_name: needsRecipientDeliveryDetails ? normalizedRecipientName || null : null,
        recipient_phone: needsRecipientDeliveryDetails ? normalizedRecipientPhone || null : null,
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

    await audit(supabase, {
      event: 'custom_order.created',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: created.id,
      payload: { function: FN, tailor_profile_id: body.tailorProfileId },
    })

    return jsonResponse({ ok: true, orderId: created.id }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'INTERNAL_ERROR', 'Could not submit your order right now.')
  }
})
