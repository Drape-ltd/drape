import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { isApprovedTailorProfile, stageProfileChangeRequest } from '../_shared/verification-review.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  getTailorPriceLimitMessage,
  getTailorPriceMaxMajor,
  getTailorPriceMinimumMessage,
  getTailorPriceMinMajor,
  TAILOR_SETUP_VALIDATION,
} from '../../../packages/shared/src/tailor-setup.ts'

const FN = 'tailor-profile-action'
const INVALID_PROFILE_IMAGE_REJECTION_CODE = 'INVALID_PROFILE_IMAGE'

type AvatarReviewProfile = {
  id?: string | null
  user_id?: string | null
  display_name?: string | null
  location?: string | null
  specialty_tags?: string[] | null
  avatar_url?: string | null
  id_document_url?: string | null
  id_selfie_document_url?: string | null
  id_verification_status?: string | null
  id_verification_metadata?: Record<string, unknown> | null
  payout_account_verified?: boolean | null
  payout_currency?: string | null
}

function readVerificationRejectionCode(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== 'object') return null
  const direct = metadata.rejection_code
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim().toUpperCase()
  const nested = metadata.identity_verification
  if (nested && typeof nested === 'object' && 'rejection_code' in nested) {
    const nestedCode = (nested as Record<string, unknown>).rejection_code
    if (typeof nestedCode === 'string' && nestedCode.trim().length > 0) return nestedCode.trim().toUpperCase()
  }
  return null
}

function hasLiveIdentitySelfie(profile: AvatarReviewProfile) {
  const path = typeof profile.id_selfie_document_url === 'string' && profile.id_selfie_document_url.trim().length > 0
    ? profile.id_selfie_document_url.trim()
    : typeof profile.id_document_url === 'string' && profile.id_document_url.trim().length > 0
      ? profile.id_document_url.trim()
      : ''
  return path.includes('/selfie_') || path.includes('selfie_')
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function normalizeStringArray(value: string[] | null | undefined) {
  return (value ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
}

function sameStringArray(left: string[] | null | undefined, right: string[] | null | undefined) {
  const a = normalizeStringArray(left)
  const b = normalizeStringArray(right)
  return a.length === b.length && a.every((item, index) => item === b[index])
}

async function resubmitAvatarOnlyVerificationIfNeeded(
  supabase: any,
  callerId: string,
  profile: AvatarReviewProfile | null | undefined,
  nextAvatarUrl: string,
) {
  if (!profile?.id) return false
  const previousAvatarUrl = typeof profile.avatar_url === 'string' ? profile.avatar_url.trim() : ''
  const avatarChanged = nextAvatarUrl.trim().length > 0 && nextAvatarUrl.trim() !== previousAvatarUrl
  const rejectionCode = readVerificationRejectionCode(profile.id_verification_metadata)
  if (
    profile.id_verification_status !== 'REJECTED' ||
    rejectionCode !== INVALID_PROFILE_IMAGE_REJECTION_CODE ||
    !avatarChanged ||
    !hasLiveIdentitySelfie(profile)
  ) {
    return false
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('tailor_profiles')
    .update({
      id_verification_status: 'PENDING',
      id_verification_submitted_at: now,
      id_verification_rejection_reason: null,
      id_verification_rejected_at: null,
      id_verification_metadata: {},
      updated_at: now,
    })
    .eq('user_id', callerId)

  if (error) throw error

  const payoutCurrency = normalizeAccountCurrency(profile.payout_currency)
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'TAILOR_VERIFICATION',
    severity: 'HIGH',
    source: FN,
    actorId: callerId,
    actorRole: 'TAILOR',
    userId: callerId,
    tailorProfileId: profile.id,
    title: 'Tailor profile photo resubmitted',
    description: `${profile.display_name ?? 'Tailor'} replaced a rejected public profile photo and is waiting on trust review. Existing live identity selfie is retained.`,
    recommendedAction: 'Review the new public avatar against the retained live selfie ID evidence, then approve or reject with a structured reason.',
    dedupeKey: `tailor-verification:${callerId}`,
    metadata: {
      display_name: profile.display_name ?? null,
      location: profile.location ?? null,
      specialty_tags: profile.specialty_tags ?? [],
      id_document_url: profile.id_selfie_document_url ?? profile.id_document_url ?? null,
      avatar_url: nextAvatarUrl,
      rejection_code: INVALID_PROFILE_IMAGE_REJECTION_CODE,
      payout_account_verified: profile.payout_account_verified ?? false,
      payout_provider: payoutCurrency ? resolvePaymentProviderForCurrency(payoutCurrency) : null,
      payout_currency: payoutCurrency ?? profile.payout_currency ?? null,
    },
  })

  return true
}

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
  acceptsCustomOrdersNow: z.boolean().default(true),
  shopPaused: z.boolean().default(false),
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
    }),
  }),
  z.object({
    action: z.literal('update-profile'),
    profile: BaseProfileSchema,
  }),
  z.object({
    action: z.literal('update-operational-status'),
    availability: AVAILABILITY.optional(),
    acceptsCustomOrdersNow: z.boolean().optional(),
    shopPaused: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('update-avatar'),
    avatarUrl: z.string().url(),
  }),
  z.object({
    action: z.literal('update-portfolio-videos'),
    videoUrls: z.array(z.string().url()).max(4).default([]),
  }),
  z.object({
    action: z.literal('update-portfolio-media'),
    photoUrls: z.array(z.string().url()).max(12).default([]),
    videoUrls: z.array(z.string().url()).max(4).default([]),
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
      .select('id, user_id, display_name, bio, location, languages, specialty_tags, avatar_url, id_document_url, id_selfie_document_url, id_verification_status, id_verification_metadata, payout_account_verified, payout_currency, portfolio_photo_urls, portfolio_video_urls, is_live')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileLookupError) {
      log('error', FN, 'profile.lookup_failed', { actor_id: caller.id, error: profileLookupError.message })
      return jsonResponse({ error: 'We could not load your tailor profile right now. Please try again.' }, 500, cors)
    }

    if (body.action === 'update-operational-status') {
      if (!existingProfile?.id) {
        return jsonResponse({ error: 'Complete your tailor profile before updating order status.' }, 404, cors)
      }

      const nextFields: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.availability) nextFields.availability = normalizeAvailability(body.availability)
      if (typeof body.acceptsCustomOrdersNow === 'boolean') nextFields.accepts_custom_orders_now = body.acceptsCustomOrdersNow
      if (typeof body.shopPaused === 'boolean') nextFields.shop_paused = body.shopPaused

      const changedFieldCount = Object.keys(nextFields).length - 1
      if (changedFieldCount <= 0) {
        return jsonResponse({ ok: true }, 200, cors)
      }

      const { error } = await supabase
        .from('tailor_profiles')
        .update(nextFields)
        .eq('user_id', caller.id)

      if (error) {
        log('error', FN, 'profile.operational_status_failed', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not update your order status right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'tailor_profile.operational_status_updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN, tailor_profile_id: existingProfile.id, fields: Object.keys(nextFields).filter((field) => field !== 'updated_at') },
      })

      return jsonResponse({ ok: true }, 200, cors)
    }

    if (body.action === 'update-avatar') {
      if (isApprovedTailorProfile(existingProfile)) {
        if (!existingProfile?.id) {
          return jsonResponse({ error: 'Complete your tailor profile before updating your profile photo.' }, 404, cors)
        }

        const request = await stageProfileChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: existingProfile.id,
          changes: { avatar_url: body.avatarUrl },
          metadata: { action: body.action, surface: 'avatar.public' },
        })

        await createOrRefreshOpsIssue(supabase, {
          issueType: 'TAILOR_VERIFICATION',
          severity: 'HIGH',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          userId: caller.id,
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? null,
          title: 'Tailor profile photo change needs review',
          description: `${existingProfile.display_name ?? 'A tailor'} changed their public profile photo after approval. The approved storefront stays live until ops reviews the replacement.`,
          recommendedAction: 'Compare the requested avatar with the retained live selfie ID and public profile standards, then approve or reject the profile change request.',
          dedupeKey: `profile-change:${caller.id}`,
          metadata: { avatar_url: body.avatarUrl, request_id: request?.id ?? null },
        })

        await queueMediaSafetyReview(supabase, {
          fn: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface: 'avatar.public.pending',
          publicUrls: [body.avatarUrl],
          purpose: 'AVATAR',
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? existingProfile.id,
          metadata: { action: body.action, pendingReview: true },
        })

        await audit(supabase, {
          event: 'tailor_profile.avatar_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          payload: { function: FN, request_id: request?.id ?? null },
        })

        return jsonResponse({ ok: true, pendingReview: true, requestId: request?.id ?? null }, 200, cors)
      }

      const { error } = await supabase
        .from('tailor_profiles')
        .update({ avatar_url: body.avatarUrl, updated_at: new Date().toISOString() })
        .eq('user_id', caller.id)

      if (error) {
        log('error', FN, 'avatar.update_failed', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not update your profile photo right now. Please try again.' }, 500, cors)
      }

      try {
        await resubmitAvatarOnlyVerificationIfNeeded(supabase, caller.id, existingProfile as AvatarReviewProfile | null, body.avatarUrl)
      } catch (resubmitError) {
        log('error', FN, 'avatar.resubmit_failed', {
          actor_id: caller.id,
          error: resubmitError instanceof Error ? resubmitError.message : String(resubmitError),
        })
        return jsonResponse({ error: 'Profile photo saved, but we could not resubmit verification. Please try Submit Setup again.' }, 500, cors)
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
    if (body.action === 'update-portfolio-media') {
      if (!existingProfile?.id) {
        return jsonResponse({ error: 'Complete your tailor profile before managing portfolio media.' }, 404, cors)
      }

      const nextPhotoUrls = Array.from(new Set(body.photoUrls)).slice(0, 12)
      const nextVideoUrls = Array.from(new Set(body.videoUrls)).slice(0, 4)
      const existingPhotoUrls = Array.isArray(existingProfile.portfolio_photo_urls)
        ? existingProfile.portfolio_photo_urls.filter((url): url is string => typeof url === 'string')
        : []
      const existingVideoUrls = Array.isArray(existingProfile.portfolio_video_urls)
        ? existingProfile.portfolio_video_urls.filter((url): url is string => typeof url === 'string')
        : []
      const existingPhotoSet = new Set(existingPhotoUrls)
      const existingVideoSet = new Set(existingVideoUrls)
      const introducesNewMedia = nextPhotoUrls.some((url) => !existingPhotoSet.has(url))
        || nextVideoUrls.some((url) => !existingVideoSet.has(url))

      if (isApprovedTailorProfile(existingProfile) && introducesNewMedia) {
        const request = await stageProfileChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: existingProfile.id,
          changes: {
            portfolio_photo_urls: nextPhotoUrls,
            portfolio_video_urls: nextVideoUrls,
          },
          metadata: { action: body.action, surface: 'portfolio.public' },
        })

        await createOrRefreshOpsIssue(supabase, {
          issueType: 'TAILOR_VERIFICATION',
          severity: 'HIGH',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          userId: caller.id,
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? null,
          title: 'Tailor portfolio media change needs review',
          description: `${existingProfile.display_name ?? 'A tailor'} added or replaced public portfolio media after approval. Existing approved media stays live until ops reviews the change.`,
          recommendedAction: 'Review the requested portfolio media for quality, stolen work, watermarks, and off-platform contact before approving.',
          dedupeKey: `profile-change:${caller.id}`,
          metadata: { request_id: request?.id ?? null, photo_count: nextPhotoUrls.length, video_count: nextVideoUrls.length },
        })

        await queueMediaSafetyReview(supabase, {
          fn: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface: 'portfolio.public.pending',
          publicUrls: [...nextPhotoUrls, ...nextVideoUrls].filter((url) => !existingPhotoSet.has(url) && !existingVideoSet.has(url)),
          purpose: 'PORTFOLIO',
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? existingProfile.id,
          metadata: { action: body.action, pendingReview: true },
        })

        await audit(supabase, {
          event: 'tailor_profile.portfolio_media_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          payload: { function: FN, request_id: request?.id ?? null, photo_count: nextPhotoUrls.length, video_count: nextVideoUrls.length },
        })

        return jsonResponse({ ok: true, pendingReview: true, requestId: request?.id ?? null }, 200, cors)
      }

      const { error } = await supabase
        .from('tailor_profiles')
        .update({
          portfolio_photo_urls: nextPhotoUrls,
          portfolio_video_urls: nextVideoUrls,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', caller.id)

      if (error) {
        log('error', FN, 'portfolio_media.update_failed', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not update your portfolio media right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'tailor_profile.portfolio_media_updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN, photo_count: nextPhotoUrls.length, video_count: nextVideoUrls.length },
      })

      return jsonResponse({ ok: true }, 200, cors)
    }
    if (body.action === 'update-portfolio-videos') {
      if (!existingProfile?.id) {
        return jsonResponse({ error: 'Complete your tailor profile before managing portfolio videos.' }, 404, cors)
      }

      const nextVideoUrls = Array.from(new Set(body.videoUrls)).slice(0, 4)
      const existingVideoUrls = Array.isArray(existingProfile.portfolio_video_urls)
        ? existingProfile.portfolio_video_urls.filter((url): url is string => typeof url === 'string')
        : []
      const existingVideoSet = new Set(existingVideoUrls)
      const introducesNewVideo = nextVideoUrls.some((url) => !existingVideoSet.has(url))

      if (isApprovedTailorProfile(existingProfile) && introducesNewVideo) {
        const request = await stageProfileChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: existingProfile.id,
          changes: { portfolio_video_urls: nextVideoUrls },
          metadata: { action: body.action, surface: 'portfolio.public' },
        })

        await createOrRefreshOpsIssue(supabase, {
          issueType: 'TAILOR_VERIFICATION',
          severity: 'HIGH',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          userId: caller.id,
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? null,
          title: 'Tailor portfolio video change needs review',
          description: `${existingProfile.display_name ?? 'A tailor'} added or replaced public portfolio videos after approval. Existing approved media stays live until ops reviews the change.`,
          recommendedAction: 'Review the requested videos for quality, stolen work, watermarks, and off-platform contact before approving.',
          dedupeKey: `profile-change:${caller.id}`,
          metadata: { request_id: request?.id ?? null, video_count: nextVideoUrls.length },
        })

        await queueMediaSafetyReview(supabase, {
          fn: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface: 'portfolio.public.pending',
          publicUrls: nextVideoUrls.filter((url) => !existingVideoSet.has(url)),
          purpose: 'PORTFOLIO',
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? existingProfile.id,
          metadata: { action: body.action, pendingReview: true },
        })

        await audit(supabase, {
          event: 'tailor_profile.portfolio_video_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          payload: { function: FN, request_id: request?.id ?? null, video_count: nextVideoUrls.length },
        })

        return jsonResponse({ ok: true, pendingReview: true, requestId: request?.id ?? null }, 200, cors)
      }

      const { error } = await supabase
        .from('tailor_profiles')
        .update({ portfolio_video_urls: nextVideoUrls, updated_at: new Date().toISOString() })
        .eq('user_id', caller.id)

      if (error) {
        log('error', FN, 'portfolio_videos.update_failed', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not update your portfolio videos right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'tailor_profile.portfolio_videos_updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN, video_count: nextVideoUrls.length },
      })

      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'portfolio.public',
        publicUrls: nextVideoUrls,
        purpose: 'PORTFOLIO',
        tailorProfileId: existingProfile.id,
        relatedEntityType: 'tailor_profile',
        relatedEntityId: existingProfile.id,
        metadata: { action: body.action, mediaCount: nextVideoUrls.length },
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
          .select('languages, specialty_tags, currency, price_range_min, price_range_max, avatar_url, id_document_url, id_selfie_document_url, id_verification_status, id_verification_metadata, payout_account_verified, payout_reverification_required, paystack_recipient_code, stripe_connect_account_id, manual_bank_entry, manual_bank_verification_status')
          .eq('user_id', caller.id)
          .maybeSingle()
      : { data: null, error: null }

    if (existingValues.error) {
      log('error', FN, 'profile.values_lookup_failed', { actor_id: caller.id, error: existingValues.error.message })
      return jsonResponse({ error: 'We could not load your saved setup details right now. Please try again.' }, 500, cors)
    }

    const existingRow = (existingValues.data ?? {}) as {
      languages?: string[] | null
      specialty_tags?: string[] | null
      currency?: string | null
      price_range_min?: number | null
      price_range_max?: number | null
      avatar_url?: string | null
      id_document_url?: string | null
      id_selfie_document_url?: string | null
      id_verification_status?: string | null
      id_verification_metadata?: Record<string, unknown> | null
      payout_account_verified?: boolean | null
      payout_reverification_required?: boolean | null
      paystack_recipient_code?: string | null
      stripe_connect_account_id?: string | null
      manual_bank_entry?: boolean | null
      manual_bank_verification_status?: string | null
    }

    const submittedAvatarUrl =
      typeof profile.avatarUrl === 'string' ? profile.avatarUrl.trim() : ''
    const existingAvatarUrl =
      typeof existingRow.avatar_url === 'string' ? existingRow.avatar_url.trim() : ''

    if (body.action === 'upsert-setup' && !submittedAvatarUrl && !existingAvatarUrl) {
      log('warn', FN, 'validation.profile_photo_missing', { actor_id: caller.id })
      return jsonResponse({ error: TAILOR_SETUP_VALIDATION.PROFILE_PHOTO_REQUIRED_MESSAGE }, 400, cors)
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
      accepts_custom_orders_now: profile.acceptsCustomOrdersNow,
      shop_paused: profile.shopPaused,
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
    }

    if (body.action === 'update-profile' && existingProfile?.id && isApprovedTailorProfile(existingProfile)) {
      const now = new Date().toISOString()
      const nextCurrency = (profile.currency ?? existingRow.currency ?? 'USD').trim().toUpperCase()
      const existingCurrency = (existingRow.currency ?? '').trim().toUpperCase()
      const currencyChanged = nextCurrency !== existingCurrency
      const directPayload: Record<string, unknown> = {
        availability: normalizeAvailability(profile.availability),
        seller_type: profile.sellerType,
        supports_custom_orders: profile.supportsCustomOrders,
        supports_ready_made: profile.supportsReadyMade,
        accepts_custom_orders_now: profile.acceptsCustomOrdersNow,
        shop_paused: profile.shopPaused,
        pickup_available: profile.pickupAvailable,
        delivery_available: profile.deliveryAvailable,
        shipping_available: profile.shippingAvailable,
        delivery_fee: 0,
        shipping_fee: 0,
        updated_at: now,
      }

      if (!currencyChanged) {
        directPayload.price_range_min = profile.priceRangeMin ?? existingRow.price_range_min ?? null
        directPayload.price_range_max = profile.priceRangeMax ?? existingRow.price_range_max ?? null
      }

      const { error: directProfileError } = await supabase
        .from('tailor_profiles')
        .update(directPayload)
        .eq('user_id', caller.id)

      if (directProfileError) {
        log('error', FN, 'profile.direct_fields_write_failed', { actor_id: caller.id, action: body.action, error: directProfileError.message })
        return jsonResponse({ error: 'We could not save your tailor profile right now. Please try again.' }, 500, cors)
      }

      const pickupAddress = profile.pickupAddress?.trim() || null
      const pickupInstructions = profile.pickupInstructions?.trim() || null
      const { error: pickupDetailsError } = await supabase
        .from('tailor_pickup_details')
        .upsert({
          user_id: caller.id,
          pickup_address: pickupAddress,
          pickup_instructions: pickupInstructions,
          updated_at: now,
        }, { onConflict: 'user_id' })

      if (pickupDetailsError) {
        log('error', FN, 'pickup_details.write_failed', { actor_id: caller.id, action: body.action, error: pickupDetailsError.message })
        return jsonResponse({ error: 'We could not save your private pickup details right now. Please try again.' }, 500, cors)
      }

      const requestedChanges: Record<string, unknown> = {}
      const nextDisplayName = profile.displayName.trim()
      if (nextDisplayName !== (existingProfile.display_name ?? '').trim()) requestedChanges.display_name = nextDisplayName

      const nextBio = trimOrNull(profile.bio)
      if (nextBio !== trimOrNull(existingProfile.bio)) requestedChanges.bio = nextBio

      const nextLocation = profile.location.trim()
      if (nextLocation !== (existingProfile.location ?? '').trim()) requestedChanges.location = nextLocation

      if (!sameStringArray(languages, existingRow.languages ?? existingProfile.languages ?? [])) requestedChanges.languages = normalizeStringArray(languages)
      if (!sameStringArray(specialties, existingRow.specialty_tags ?? existingProfile.specialty_tags ?? [])) requestedChanges.specialty_tags = normalizeStringArray(specialties)

      if (currencyChanged) {
        requestedChanges.currency = nextCurrency
        requestedChanges.price_range_min = profile.priceRangeMin ?? existingRow.price_range_min ?? null
        requestedChanges.price_range_max = profile.priceRangeMax ?? existingRow.price_range_max ?? null
      }

      if (submittedAvatarUrl.length > 0 && submittedAvatarUrl !== existingAvatarUrl) {
        requestedChanges.avatar_url = submittedAvatarUrl
      }

      let request: { id: string } | null = null
      if (Object.keys(requestedChanges).length > 0) {
        request = await stageProfileChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: existingProfile.id,
          changes: requestedChanges,
          metadata: { action: body.action, surface: 'tailor_profile.public', requested_fields: Object.keys(requestedChanges) },
        })

        await createOrRefreshOpsIssue(supabase, {
          issueType: 'TAILOR_VERIFICATION',
          severity: 'HIGH',
          source: FN,
          actorId: caller.id,
          actorRole: 'TAILOR',
          userId: caller.id,
          tailorProfileId: existingProfile.id,
          relatedEntityType: 'profile_change_request',
          relatedEntityId: request?.id ?? null,
          title: 'Tailor public profile changes need review',
          description: `${existingProfile.display_name ?? 'A tailor'} edited trust-sensitive public profile fields after approval. The approved storefront stays live until ops reviews the requested values.`,
          recommendedAction: 'Compare each requested public value with the approved storefront, reject off-platform contact or identity mismatch, and approve only safe fields.',
          dedupeKey: `profile-change:${caller.id}`,
          metadata: { request_id: request?.id ?? null, requested_fields: Object.keys(requestedChanges) },
        })

        if (typeof requestedChanges.avatar_url === 'string') {
          await queueMediaSafetyReview(supabase, {
            fn: FN,
            actorId: caller.id,
            actorRole: 'TAILOR',
            surface: 'avatar.public.pending',
            publicUrls: [requestedChanges.avatar_url],
            purpose: 'AVATAR',
            tailorProfileId: existingProfile.id,
            relatedEntityType: 'profile_change_request',
            relatedEntityId: request?.id ?? existingProfile.id,
            metadata: { action: body.action, pendingReview: true },
          })
        }
      }

      await audit(supabase, {
        event: request ? 'tailor_profile.change_requested' : 'tailor_profile.direct_fields_updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: {
          function: FN,
          tailor_profile_id: existingProfile.id,
          request_id: request?.id ?? null,
          requested_fields: Object.keys(requestedChanges),
          supports_ready_made: profile.supportsReadyMade,
          supports_custom_orders: profile.supportsCustomOrders,
        },
      })

      return jsonResponse({ ok: true, pendingReview: request !== null, requestId: request?.id ?? null }, 200, cors)
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

    if (savedProfile?.id && body.action === 'upsert-setup' && submittedAvatarUrl.length > 0) {
      try {
        await resubmitAvatarOnlyVerificationIfNeeded(
          supabase,
          caller.id,
          {
            ...existingRow,
            id: savedProfile.id,
            user_id: caller.id,
            display_name: savedProfile.display_name ?? profile.displayName,
            location: savedProfile.location ?? profile.location,
            specialty_tags: savedProfile.specialty_tags ?? specialties,
            payout_account_verified: savedProfile.payout_account_verified ?? existingRow.payout_account_verified ?? null,
            payout_currency: savedProfile.payout_currency ?? profile.currency,
          },
          submittedAvatarUrl,
        )
      } catch (resubmitError) {
        log('error', FN, 'setup.avatar_resubmit_failed', {
          actor_id: caller.id,
          error: resubmitError instanceof Error ? resubmitError.message : String(resubmitError),
        })
        return jsonResponse({ error: 'Profile saved, but we could not resubmit profile photo review. Try Submit Setup again.' }, 500, cors)
      }
    }

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
