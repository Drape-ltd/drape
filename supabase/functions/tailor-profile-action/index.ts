import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'

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
  bio: z.string().trim().max(1200).optional().nullable(),
  location: z.string().trim().min(2).max(120),
  languages: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  specialties: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  priceRangeMin: z.number().int().nonnegative().max(100_000_00).optional().nullable(),
  priceRangeMax: z.number().int().nonnegative().max(100_000_00).optional().nullable(),
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
      idDocumentUrl: z.string().url().optional().nullable(),
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

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return new Response('Unauthorized', { status: 401, headers: cors })

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return new Response(parsed.error, { status: 400, headers: cors })
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 60)
    if (!allowed) return new Response('Too many requests', { status: 429, headers: cors })

    const body = parsed.data

    const { data: existingProfile, error: profileLookupError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileLookupError) {
      log('error', FN, 'profile.lookup_failed', { actor_id: caller.id, error: profileLookupError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (body.action === 'update-avatar') {
      const { error } = await supabase
        .from('tailor_profiles')
        .update({ avatar_url: body.avatarUrl, updated_at: new Date().toISOString() })
        .eq('user_id', caller.id)

      if (error) {
        log('error', FN, 'avatar.update_failed', { actor_id: caller.id, error: error.message })
        return new Response('Could not update avatar', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'tailor_profile.avatar_updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN },
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const profile = body.profile
    const languages = profile.languages ?? []
    const specialties = profile.specialties ?? []
    if (profile.priceRangeMin != null && profile.priceRangeMax != null && profile.priceRangeMax < profile.priceRangeMin) {
      return new Response('Maximum price must be greater than or equal to minimum price.', { status: 400, headers: cors })
    }
    if (!(profile.pickupAvailable || profile.deliveryAvailable || profile.shippingAvailable)) {
      return new Response('Choose at least one fulfillment option.', { status: 400, headers: cors })
    }
    if (profile.pickupAvailable && !profile.pickupAddress?.trim()) {
      return new Response('Add your private pickup address before offering pickup.', { status: 400, headers: cors })
    }

    const existingValues = existingProfile?.id
      ? await supabase
          .from('tailor_profiles')
          .select('languages, price_range_min, price_range_max')
          .eq('user_id', caller.id)
          .maybeSingle()
      : { data: null, error: null }

    if (existingValues.error) {
      log('error', FN, 'profile.values_lookup_failed', { actor_id: caller.id, error: existingValues.error.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    const existingRow = (existingValues.data ?? {}) as { languages?: string[] | null; price_range_min?: number | null; price_range_max?: number | null }

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

    if (body.action === 'upsert-setup') {
      const setupProfile = body.profile
      payload.portfolio_photo_urls = setupProfile.portfolioPhotoUrls
      payload.portfolio_video_urls = setupProfile.portfolioVideoUrls
      payload.id_document_url = setupProfile.idDocumentUrl ?? null
      payload.id_verification_status = setupProfile.idDocumentUrl ? 'PENDING' : 'NOT_SUBMITTED'
    }

    const query = body.action === 'upsert-setup'
      ? supabase.from('tailor_profiles').upsert(payload, { onConflict: 'user_id' })
      : supabase.from('tailor_profiles').update(payload).eq('user_id', caller.id)

    const { error } = await query
    if (error) {
      log('error', FN, 'profile.write_failed', { actor_id: caller.id, action: body.action, error: error.message })
      return new Response('Could not save profile', { status: 500, headers: cors })
    }

    const { data: savedProfile, error: savedProfileError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id, display_name, location, specialty_tags, id_document_url, id_verification_status, payout_account_verified, payout_provider, payout_currency')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (savedProfileError) {
      log('error', FN, 'profile.saved_lookup_failed', { actor_id: caller.id, action: body.action, error: savedProfileError.message })
      return new Response('Could not load saved profile', { status: 500, headers: cors })
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
      return new Response('Could not save private pickup details', { status: 500, headers: cors })
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

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
