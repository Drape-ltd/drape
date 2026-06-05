import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  getTailorPriceLimitMessage,
  getTailorPriceMaxMajor,
  getTailorPriceMinimumMessage,
  getTailorPriceMinMajor,
  TAILOR_SETUP_VALIDATION,
  validateTailorSetupIdDocumentUrl,
} from '../../../packages/shared/src/tailor-setup.ts'

const FN = 'tailor-profile-action'

const CURRENCY = z.enum(['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'])
const SELLER_TYPE = z.enum(['TAILOR', 'BOUTIQUE', 'TAILOR_SHOP'])
const AVAILABILITY = z.enum(['OPEN', 'LIMITED', 'FULLY_BOOKED', 'AVAILABLE', 'BOOKED'])

function normalizeAvailability(value: z.infer<typeof AVAILABILITY> | undefined) {
  if (!value) return 'OPEN'
  if (value === 'AVAILABLE') return 'OPEN'
  if (value === 'BOOKED') return 'FULLY_BOOKED'
  return value
}

const BaseProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  avatarUrl: z.string().url().optional().nullable(),
  bio: z.string().trim().max(1200).optional().nullable(),
  location: z.string().trim().min(2).max(120),
  languages: z.array(z.string().trim().min(1).max(40)).max(12, TAILOR_SETUP_VALIDATION.LANGUAGE_LIMIT_MESSAGE).default([]),
  specialties: z.array(z.string().trim().min(1).max(60)).max(20, TAILOR_SETUP_VALIDATION.SPECIALTY_LIMIT_MESSAGE).default([]),
  priceRangeMin: z.number().int().nonnegative().optional().nullable(),
  priceRangeMax: z.number().int().nonnegative().optional().nullable(),
  currency: CURRENCY.default('USD'),
  availability: AVAILABILITY.default('OPEN'),
  sellerType: SELLER_TYPE.default('TAILOR'),
  supportsCustomOrders: z.boolean().default(true),
  supportsReadyMade: z.boolean().default(false),
  pickupAvailable: z.boolean().default(false),
  pickupAddress: z.string().trim().max(240).optional().nullable(),
  pickupInstructions: z.string().trim().max(400).optional().nullable(),
  deliveryAvailable: z.boolean().default(false),
  shippingAvailable: z.boolean().default(false),
  deliveryFee: z.number().int().nonnegative().max(100_000_00).default(0),
  shippingFee: z.number().int().nonnegative().max(100_000_00).default(0),
})

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert-setup'),
    profile: BaseProfileSchema.extend({
      portfolioPhotoUrls: z.array(z.string().url()).max(12).default([]),
      portfolioVideoUrls: z.array(z.string().url()).max(4).default([]),
      idDocumentUrl: z.string().trim().optional().nullable(),
    }),
  }),
  z.object({
    action: z.literal('update-profile'),
    profile: BaseProfileSchema,
  }),
  z.object({
    action: z.literal('update-avatar'),
    avatarUrl: z.string().url(),
  }),
])

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonResponse({ error: 'Please sign in again before updating your tailor profile.' }, 401, cors)

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 60)
    if (!allowed) return rateLimitExceededResponse(cors)

    const body = parsed.data

    const { data: existingProfile, error: profileLookupError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileLookupError) {
      log('error', FN, 'profile.lookup_failed', { actor_id: caller.id, error: profileLookupError.message })
      return jsonResponse({ error: 'We could not load your tailor profile right now. Please try again.' }, 500, cors)
    }

    if (body.action === 'update-avatar') {
      const { error } = await supabase
        .from('tailor_profiles')
        .update({ avatar_url: body.avatarUrl, updated_at: new Date().toISOString() })
        .eq('user_id', caller.id)

      if (error) {
        log('error', FN, 'avatar.update_failed', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not update your profile photo right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'tailor_profile.avatar_updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN },
      })

      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'avatar.public',
        publicUrls: [body.avatarUrl],
        purpose: 'AVATAR',
        tailorProfileId: existingProfile?.id ?? null,
        relatedEntityType: 'tailor_profile',
        relatedEntityId: existingProfile?.id ?? caller.id,
        metadata: { action: body.action },
      })

      return jsonResponse({ ok: true }, 200, cors)
    }

    const profile = body.profile
    const languages = profile.languages ?? []
    const specialties = profile.specialties ?? []
    const minPriceMinor = getTailorPriceMinMajor(profile.currency) * 100
    const maxPriceMinor = getTailorPriceMaxMajor(profile.currency) * 100
    if (profile.priceRangeMin != null && profile.priceRangeMax != null && profile.priceRangeMax < profile.priceRangeMin) {
      return jsonResponse({ error: 'Maximum price must be greater than or equal to minimum price.' }, 400, cors)
    }
    if (
      (profile.priceRangeMin != null && profile.priceRangeMin < minPriceMinor)
      || (profile.priceRangeMax != null && profile.priceRangeMax < minPriceMinor)
    ) {
      return jsonResponse({ error: getTailorPriceMinimumMessage(profile.currency) }, 400, cors)
    }
    if (
      (profile.priceRangeMin != null && profile.priceRangeMin > maxPriceMinor)
      || (profile.priceRangeMax != null && profile.priceRangeMax > maxPriceMinor)
    ) {
      return jsonResponse({ error: getTailorPriceLimitMessage(profile.currency) }, 400, cors)
    }
    if (!(profile.pickupAvailable || profile.deliveryAvailable || profile.shippingAvailable)) {
      return jsonResponse({ error: 'Choose at least one fulfillment option.' }, 400, cors)
    }
    if (profile.pickupAvailable && !profile.pickupAddress?.trim()) {
      return jsonResponse({ error: 'Add your private pickup address before offering pickup.' }, 400, cors)
    }

    const contactCheckedFields: Array<[string, string, string | null | undefined, string]> = [
      ['tailor_profile.display_name', 'displayName', profile.displayName, "Contact details can't be included in your public profile name."],
      ['tailor_profile.bio', 'bio', profile.bio, "Contact details can't be included in your bio. Keep communication on Drape so orders stay protected."],
      ['tailor_profile.location', 'location', profile.location, "Contact details can't be included in your location."],
      ['tailor_profile.pickup_instructions', 'pickupInstructions', profile.pickupInstructions, "Contact details can't be included in pickup instructions."],
      ...languages.map((language): [string, string, string, string] => [
        'tailor_profile.languages',
        'languages',
        language,
        "Contact details can't be included in languages.",
      ]),
      ...specialties.map((specialty): [string, string, string, string] => [
        'tailor_profile.specialties',
        'specialties',
        specialty,
        "Contact details can't be included in specialties.",
      ]),
    ]

    for (const [surface, field, text, message] of contactCheckedFields) {
      const blocked = await rejectIfBlockedContact({
        supabase,
        fn: FN,
        cors,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface,
        text,
        message,
        extra: { field, action: body.action },
      })
      if (blocked) return blocked
    }

    const existingValues = existingProfile?.id
      ? await supabase
          .from('tailor_profiles')
          .select('languages, price_range_min, price_range_max, avatar_url, id_document_url, id_verification_status')
          .eq('user_id', caller.id)
          .maybeSingle()
      : { data: null, error: null }

    if (existingValues.error) {
      log('error', FN, 'profile.values_lookup_failed', { actor_id: caller.id, error: existingValues.error.message })
      return jsonResponse({ error: 'We could not load your saved setup details right now. Please try again.' }, 500, cors)
    }

    const existingRow = (existingValues.data ?? {}) as {
      languages?: string[] | null
      price_range_min?: number | null
      price_range_max?: number | null
      avatar_url?: string | null
      id_document_url?: string | null
      id_verification_status?: string | null
    }

    const submittedAvatarUrl =
      typeof profile.avatarUrl === 'string' ? profile.avatarUrl.trim() : ''
    const existingAvatarUrl =
      typeof existingRow.avatar_url === 'string' ? existingRow.avatar_url.trim() : ''

    if (body.action === 'upsert-setup' && !submittedAvatarUrl && !existingAvatarUrl) {
      log('warn', FN, 'validation.profile_photo_missing', { actor_id: caller.id })
      return jsonResponse({ error: TAILOR_SETUP_VALIDATION.PROFILE_PHOTO_REQUIRED_MESSAGE }, 400, cors)
    }

    const submittedIdDocumentUrl =
      body.action === 'upsert-setup' && typeof body.profile.idDocumentUrl === 'string'
        ? body.profile.idDocumentUrl.trim()
        : ''
    const existingIdDocumentUrl =
      typeof existingRow.id_document_url === 'string' ? existingRow.id_document_url.trim() : ''
    const mayReuseExistingIdDocument =
      body.action === 'upsert-setup'
      && existingRow.id_verification_status !== 'REJECTED'
      && existingIdDocumentUrl.length > 0
    const setupIdDocumentUrl =
      body.action === 'upsert-setup'
        ? (submittedIdDocumentUrl || (mayReuseExistingIdDocument ? existingIdDocumentUrl : null))
        : null
    const idDocumentError = body.action === 'upsert-setup'
      ? validateTailorSetupIdDocumentUrl(setupIdDocumentUrl)
      : null

    if (idDocumentError) {
      log('warn', FN, 'validation.id_document_missing', {
        actor_id: caller.id,
        has_existing_document: existingIdDocumentUrl.length > 0,
        existing_status: existingRow.id_verification_status ?? null,
      })
      return jsonResponse({ error: idDocumentError }, 400, cors)
    }

    const payload: Record<string, unknown> = {
      user_id: caller.id,
      display_name: profile.displayName,
      bio: profile.bio?.trim() || null,
      location: profile.location,
      languages: languages.length > 0 ? languages : (existingRow.languages ?? []),
      specialty_tags: specialties,
      price_range_min: profile.priceRangeMin ?? existingRow.price_range_min ?? null,
      price_range_max: profile.priceRangeMax ?? existingRow.price_range_max ?? null,
      currency: profile.currency,
      availability: normalizeAvailability(profile.availability),
      seller_type: profile.sellerType,
      supports_custom_orders: profile.supportsCustomOrders,
      supports_ready_made: profile.supportsReadyMade,
      pickup_available: profile.pickupAvailable,
      delivery_available: profile.deliveryAvailable,
      shipping_available: profile.shippingAvailable,
      delivery_fee: 0,
      shipping_fee: 0,
      updated_at: new Date().toISOString(),
    }

    if (submittedAvatarUrl.length > 0) {
      payload.avatar_url = submittedAvatarUrl
    }

    if (body.action === 'upsert-setup') {
      const setupProfile = body.profile
      payload.portfolio_photo_urls = setupProfile.portfolioPhotoUrls
      payload.portfolio_video_urls = setupProfile.portfolioVideoUrls
      payload.id_document_url = setupIdDocumentUrl
      if (submittedIdDocumentUrl) {
        payload.id_verification_status = 'PENDING'
      }
    }

    const query = body.action === 'upsert-setup'
      ? supabase.from('tailor_profiles').upsert(payload, { onConflict: 'user_id' })
      : supabase.from('tailor_profiles').update(payload).eq('user_id', caller.id)

    const { error } = await query
    if (error) {
      log('error', FN, 'profile.write_failed', { actor_id: caller.id, action: body.action, error: error.message })
      return jsonResponse({ error: 'We could not save your tailor profile right now. Please try again.' }, 500, cors)
    }

    const { data: savedProfile, error: savedProfileError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id, display_name, location, specialty_tags, id_document_url, id_verification_status, payout_account_verified, payout_provider, payout_currency')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (savedProfileError) {
      log('error', FN, 'profile.saved_lookup_failed', { actor_id: caller.id, action: body.action, error: savedProfileError.message })
      return jsonResponse({ error: 'Your profile saved, but we could not reload it yet. Pull to refresh in a moment.' }, 500, cors)
    }

    const pickupAddress = profile.pickupAddress?.trim() || null
    const pickupInstructions = profile.pickupInstructions?.trim() || null
    const { error: pickupDetailsError } = await supabase
      .from('tailor_pickup_details')
      .upsert({
        user_id: caller.id,
        pickup_address: pickupAddress,
        pickup_instructions: pickupInstructions,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (pickupDetailsError) {
      log('error', FN, 'pickup_details.write_failed', { actor_id: caller.id, action: body.action, error: pickupDetailsError.message })
      return jsonResponse({ error: 'We could not save your private pickup details right now. Please try again.' }, 500, cors)
    }

    await audit(supabase, {
      event: body.action === 'upsert-setup' ? 'tailor_profile.setup_saved' : 'tailor_profile.updated',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: {
        function: FN,
        tailor_profile_id: existingProfile?.id ?? null,
        supports_ready_made: profile.supportsReadyMade,
        supports_custom_orders: profile.supportsCustomOrders,
      },
    })

    if (savedProfile?.id) {
      const avatarMedia = [submittedAvatarUrl]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      const portfolioMedia = [
        ...(body.action === 'upsert-setup' ? body.profile.portfolioPhotoUrls ?? [] : []),
        ...(body.action === 'upsert-setup' ? body.profile.portfolioVideoUrls ?? [] : []),
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'avatar.public',
        publicUrls: avatarMedia,
        purpose: 'AVATAR',
        tailorProfileId: savedProfile.id,
        relatedEntityType: 'tailor_profile',
        relatedEntityId: savedProfile.id,
        metadata: { action: body.action, mediaCount: avatarMedia.length },
      })

      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'portfolio.public',
        publicUrls: portfolioMedia,
        purpose: 'PORTFOLIO',
        tailorProfileId: savedProfile.id,
        relatedEntityType: 'tailor_profile',
        relatedEntityId: savedProfile.id,
        metadata: { action: body.action, mediaCount: portfolioMedia.length },
      })
    }

    if (
      body.action === 'upsert-setup'
      && savedProfile?.id
      && savedProfile.id_verification_status === 'PENDING'
      && typeof savedProfile.id_document_url === 'string'
      && savedProfile.id_document_url.trim().length > 0
    ) {
      const payoutCurrency = normalizeAccountCurrency(savedProfile.payout_currency ?? profile.currency)
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'TAILOR_VERIFICATION',
        severity: 'HIGH',
        source: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        userId: caller.id,
        tailorProfileId: savedProfile.id,
        title: 'Tailor verification submitted',
        description: `${savedProfile.display_name ?? profile.displayName} submitted identity verification and is waiting on trust review.`,
        recommendedAction: 'Review the uploaded ID document, confirm the profile details, and approve, reject, or request a resubmission with specific feedback.',
        dedupeKey: `tailor-verification:${caller.id}`,
        metadata: {
          display_name: savedProfile.display_name ?? profile.displayName,
          location: savedProfile.location ?? profile.location,
          specialty_tags: savedProfile.specialty_tags ?? specialties,
          id_document_url: savedProfile.id_document_url,
          payout_account_verified: savedProfile.payout_account_verified ?? false,
          payout_provider: payoutCurrency ? resolvePaymentProviderForCurrency(payoutCurrency) : null,
          payout_currency: payoutCurrency ?? profile.currency,
        },
      })
    }

    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not save your tailor profile right now. Please try again.' }, 500, cors)
  }
})
