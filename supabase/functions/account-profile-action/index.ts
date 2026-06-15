/**
 * account-profile-action
 *
 * Owns account profile/contact mutations that should never be written directly
 * by mobile clients. Phone changes require a short-lived signed reauth proof.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { filterContactInfo, validateDisplayName } from '../../../packages/shared/src/contact-filter.ts'
import { normalizePhoneForStorage, validatePhoneForProfile } from '../../../packages/shared/src/phone.ts'
import { normalizeAccountCurrency } from '../../../packages/shared/src/currency-config.ts'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { verifyReauthProof } from '../_shared/reauth-proof.ts'
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'account-profile-action'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('bootstrap-web-onboarding'),
    onboarding: z.discriminatedUnion('role', [
      z.object({
        source: z.literal('web'),
        role: z.literal('CUSTOMER'),
        displayName: z.string().trim().min(2).max(80),
        phone: z.string().trim().min(1).max(32),
        defaultCurrency: z.string().trim().min(3).max(3),
        currencySource: z.string().trim().min(1).max(40),
        regionCode: z.string().trim().min(2).max(8).default('ZZ'),
        customer: z.object({
          unitPreference: z.enum(['in', 'cm']),
          garmentContext: z.enum(['MENSWEAR', 'WOMENSWEAR', 'BOTH', 'PREFER_NOT_TO_SAY']),
        }),
      }),
      z.object({
        source: z.literal('web'),
        role: z.literal('TAILOR'),
        displayName: z.string().trim().min(2).max(80),
        phone: z.string().trim().min(1).max(32),
        defaultCurrency: z.string().trim().min(3).max(3),
        currencySource: z.string().trim().min(1).max(40),
        regionCode: z.string().trim().min(2).max(8).default('ZZ'),
        tailor: z.object({
          location: z.string().trim().min(2).max(120),
          languages: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
          specialties: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
          priceRangeMin: z.number().int().nonnegative().optional().nullable(),
          priceRangeMax: z.number().int().nonnegative().optional().nullable(),
          supportsCustomOrders: z.boolean().default(true),
          supportsReadyMade: z.boolean().default(false),
          fulfillment: z.array(z.enum(['PICKUP', 'DELIVERY', 'SHIPPING'])).min(1).max(3),
        }),
      }),
    ]),
  }),
  z.object({
    action: z.literal('update-personal-info'),
    role: z.enum(['CUSTOMER', 'TAILOR']),
    displayName: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(1).max(32),
    reauthProof: z.string().trim().min(20).optional(),
  }),
  z.object({
    action: z.literal('update-avatar'),
    role: z.enum(['CUSTOMER', 'TAILOR']),
    avatarUrl: z.string().url(),
  }),
  z.object({
    action: z.literal('update-display-name'),
    role: z.enum(['CUSTOMER', 'TAILOR']),
    displayName: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal('update-currency'),
    role: z.enum(['CUSTOMER', 'TAILOR']),
    currency: z.string().trim().min(3).max(3),
  }),
])

function jsonResponse(payload: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function maskPhone(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length <= 4) return phone ? '****' : null
  return `****${digits.slice(-4)}`
}

function readAuthMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function contactLeakMessage(field: string, value: string | string[] | null | undefined) {
  const entries = Array.isArray(value) ? value : [value]
  for (const entry of entries) {
    if (!entry) continue
    const result = filterContactInfo(entry)
    if (result.blocked) {
      return `${field} can't include phone numbers, emails, links, social handles, or off-platform contact instructions.`
    }
  }
  return null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({
        error: 'Please sign in again before updating your account.',
        message: 'Please sign in again before updating your account.',
      }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error, message: parsed.error }, 400, cors)
    }

    const body = parsed.data
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const allowed = await checkRateLimit(
      supabase,
      `${FN}:${body.action}:${caller.id}:${clientIp}`,
      3600,
      body.action === 'update-avatar' ? 20 : 5,
    )
    if (!allowed) {
      const actorRole = body.action === 'bootstrap-web-onboarding' ? body.onboarding.role : body.role
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: actorRole,
        severity: 'warn',
        payload: { function: FN, ip: clientIp, action: body.action },
      })
      return rateLimitExceededResponse(cors)
    }

    if (body.action === 'bootstrap-web-onboarding') {
      const onboarding = body.onboarding
      const displayName = onboarding.displayName.trim()
      const displayNameIssue = validateDisplayName(displayName)
      if (displayNameIssue) {
        return jsonResponse({ error: displayNameIssue, message: displayNameIssue }, 400, cors)
      }

      const normalizedPhone = normalizePhoneForStorage(onboarding.phone)
      const phoneIssue = validatePhoneForProfile(normalizedPhone)
      if (phoneIssue) {
        return jsonResponse({ error: phoneIssue, message: phoneIssue }, 400, cors)
      }

      const currency = normalizeAccountCurrency(onboarding.defaultCurrency)
      if (!currency) {
        return jsonResponse({ error: 'Choose a supported currency.', message: 'Choose a supported currency.' }, 400, cors)
      }

      if (onboarding.role === 'TAILOR') {
        const tailorLeak =
          contactLeakMessage('Location', onboarding.tailor.location) ||
          contactLeakMessage('Languages', onboarding.tailor.languages) ||
          contactLeakMessage('Specialties', onboarding.tailor.specialties)
        if (tailorLeak) {
          return jsonResponse({ error: tailorLeak, message: tailorLeak }, 400, cors)
        }
        if (
          onboarding.tailor.priceRangeMin != null &&
          onboarding.tailor.priceRangeMax != null &&
          onboarding.tailor.priceRangeMax < onboarding.tailor.priceRangeMin
        ) {
          return jsonResponse({
            error: 'Maximum price must be greater than or equal to minimum price.',
            message: 'Maximum price must be greater than or equal to minimum price.',
          }, 400, cors)
        }
      }

      const { data: authUserData } = await supabase.auth.admin.getUserById(caller.id)
      const email = caller.email ?? authUserData?.user?.email ?? ''
      if (!email.trim()) {
        return jsonResponse({
          error: 'We could not verify the email on this account. Sign out and sign back in, then retry.',
          message: 'We could not verify the email on this account. Sign out and sign back in, then retry.',
        }, 400, cors)
      }

      const now = new Date().toISOString()
      const { error: userUpsertError } = await supabase
        .from('users')
        .upsert(
          {
            id: caller.id,
            email,
            display_name: displayName,
            role: onboarding.role,
            phone: normalizedPhone,
            default_currency: currency,
            currency_source: onboarding.currencySource,
            region_code: onboarding.regionCode || 'ZZ',
            currency_confirmed_at: now,
            updated_at: now,
          },
          { onConflict: 'id' },
        )

      if (userUpsertError) {
        log('error', FN, 'web_onboarding.users_upsert_failed', { actor_id: caller.id, error: userUpsertError.message })
        return jsonResponse({
          error: 'We could not finish your account setup right now.',
          message: 'We could not finish your account setup right now.',
        }, 500, cors)
      }

      const metadata = readAuthMetadata(authUserData?.user?.user_metadata)
      await supabase.auth.admin.updateUserById(caller.id, {
        user_metadata: {
          ...metadata,
          display_name: displayName,
          phone: normalizedPhone,
          role: onboarding.role,
          web_onboarding: onboarding,
        },
      }).catch((error) => {
        log('warn', FN, 'web_onboarding.auth_metadata_update_failed', {
          actor_id: caller.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      if (onboarding.role === 'CUSTOMER') {
        const { error: profileError } = await supabase
          .from('customer_profiles')
          .upsert(
            {
              user_id: caller.id,
              display_name: displayName,
              phone: normalizedPhone,
              unit_preference: onboarding.customer.unitPreference,
              garment_context: onboarding.customer.garmentContext,
              measurements: {
                unit: onboarding.customer.unitPreference,
                garmentContext: onboarding.customer.garmentContext,
                fitFlags: [],
              },
              updated_at: now,
            },
            { onConflict: 'user_id' },
          )

        if (profileError) {
          log('error', FN, 'web_onboarding.customer_profile_upsert_failed', { actor_id: caller.id, error: profileError.message })
          return jsonResponse({
            error: 'We could not finish your customer setup right now.',
            message: 'We could not finish your customer setup right now.',
          }, 500, cors)
        }
      } else {
        const { error: profileError } = await supabase
          .from('tailor_profiles')
          .upsert(
            {
              user_id: caller.id,
              display_name: displayName,
              bio: null,
              location: onboarding.tailor.location,
              languages: onboarding.tailor.languages,
              specialty_tags: onboarding.tailor.specialties,
              price_range_min: onboarding.tailor.priceRangeMin,
              price_range_max: onboarding.tailor.priceRangeMax,
              currency,
              seller_type: 'TAILOR',
              supports_custom_orders: onboarding.tailor.supportsCustomOrders,
              supports_ready_made: onboarding.tailor.supportsReadyMade,
              pickup_available: onboarding.tailor.fulfillment.includes('PICKUP'),
              delivery_available: onboarding.tailor.fulfillment.includes('DELIVERY'),
              shipping_available: onboarding.tailor.fulfillment.includes('SHIPPING'),
              delivery_fee: 0,
              shipping_fee: 0,
              updated_at: now,
            },
            { onConflict: 'user_id' },
          )

        if (profileError) {
          log('error', FN, 'web_onboarding.tailor_profile_upsert_failed', { actor_id: caller.id, error: profileError.message })
          return jsonResponse({
            error: 'We could not finish your tailor setup right now.',
            message: 'We could not finish your tailor setup right now.',
          }, 500, cors)
        }
      }

      await audit(supabase, {
        event: 'account.web_onboarding_bootstrapped',
        actor_id: caller.id,
        actor_role: onboarding.role,
        severity: 'info',
        payload: { function: FN, role: onboarding.role, source: 'web' },
      })

      return jsonResponse({ ok: true, role: onboarding.role }, 200, cors)
    }

    if (body.action === 'update-display-name' || body.action === 'update-currency') {
      const { data: userRow, error: userLookupError } = await supabase
        .from('users')
        .select('id, email, role')
        .eq('id', caller.id)
        .maybeSingle()

      if (userLookupError) {
        log('error', FN, 'users.lookup_failed', { actor_id: caller.id, error: userLookupError.message })
        return jsonResponse({
          error: 'We could not load your account record right now.',
          message: 'We could not load your account record right now.',
        }, 500, cors)
      }

      if (userRow?.role && userRow.role !== body.role) {
        return jsonResponse({
          error: 'This profile does not match your account type. Sign out and sign back in, then retry.',
          message: 'This profile does not match your account type. Sign out and sign back in, then retry.',
        }, 400, cors)
      }

      const now = new Date().toISOString()

      if (body.action === 'update-display-name') {
        const displayName = body.displayName.trim()
        const displayNameIssue = validateDisplayName(displayName)
        if (displayNameIssue) {
          return jsonResponse({ error: displayNameIssue, message: displayNameIssue }, 400, cors)
        }

        const { data: authUserData } = await supabase.auth.admin.getUserById(caller.id)
        const email = caller.email ?? authUserData?.user?.email ?? userRow?.email ?? ''
        if (!email.trim()) {
          return jsonResponse({
            error: 'We could not verify the email on this account. Sign out and sign back in, then retry.',
            message: 'We could not verify the email on this account. Sign out and sign back in, then retry.',
          }, 400, cors)
        }

        const { error: usersError } = await supabase
          .from('users')
          .upsert({ id: caller.id, email, role: body.role, display_name: displayName, updated_at: now }, { onConflict: 'id' })

        if (usersError) {
          log('error', FN, 'users.display_name_upsert_failed', { actor_id: caller.id, error: usersError.message })
          return jsonResponse({
            error: 'We could not save your display name right now.',
            message: 'We could not save your display name right now.',
          }, 500, cors)
        }

        if (body.role === 'CUSTOMER') {
          const { error: profileError } = await supabase
            .from('customer_profiles')
            .upsert({ user_id: caller.id, display_name: displayName, updated_at: now }, { onConflict: 'user_id' })
          if (profileError) {
            log('error', FN, 'customer_profile.display_name_upsert_failed', { actor_id: caller.id, error: profileError.message })
            return jsonResponse({
              error: 'We could not save your customer profile right now.',
              message: 'We could not save your customer profile right now.',
            }, 500, cors)
          }
        } else {
          const { error: profileError } = await supabase
            .from('tailor_profiles')
            .update({ display_name: displayName, updated_at: now })
            .eq('user_id', caller.id)
          if (profileError) {
            log('error', FN, 'tailor_profile.display_name_update_failed', { actor_id: caller.id, error: profileError.message })
            return jsonResponse({
              error: 'We could not save your tailor profile right now.',
              message: 'We could not save your tailor profile right now.',
            }, 500, cors)
          }
        }

        await audit(supabase, {
          event: 'account.display_name_updated',
          actor_id: caller.id,
          actor_role: body.role,
          severity: 'info',
          payload: { function: FN },
        })

        return jsonResponse({ ok: true }, 200, cors)
      }

      const currency = normalizeAccountCurrency(body.currency)
      if (!currency) {
        return jsonResponse({
          error: 'Choose a supported currency.',
          message: 'Choose a supported currency.',
        }, 400, cors)
      }

      const { error: currencyError } = await supabase
        .from('users')
        .update({ default_currency: currency, updated_at: now })
        .eq('id', caller.id)

      if (currencyError) {
        log('error', FN, 'users.currency_update_failed', { actor_id: caller.id, error: currencyError.message })
        return jsonResponse({
          error: 'We could not save your currency right now.',
          message: 'We could not save your currency right now.',
        }, 500, cors)
      }

      if (body.role === 'TAILOR') {
        const { error: tailorCurrencyError } = await supabase
          .from('tailor_profiles')
          .update({ currency, updated_at: now })
          .eq('user_id', caller.id)

        if (tailorCurrencyError) {
          log('error', FN, 'tailor_profile.currency_update_failed', { actor_id: caller.id, error: tailorCurrencyError.message })
          return jsonResponse({
            error: 'We saved your account currency but could not update the tailor storefront yet.',
            message: 'We saved your account currency but could not update the tailor storefront yet.',
          }, 500, cors)
        }
      }

      await audit(supabase, {
        event: 'account.currency_updated',
        actor_id: caller.id,
        actor_role: body.role,
        severity: 'info',
        payload: { function: FN, currency },
      })

      return jsonResponse({ ok: true, currency }, 200, cors)
    }

    if (body.action === 'update-avatar') {
      const now = new Date().toISOString()
      let tailorProfileId: string | null = null

      if (body.role === 'CUSTOMER') {
        const { error: profileError } = await supabase
          .from('customer_profiles')
          .upsert(
            {
              user_id: caller.id,
              avatar_url: body.avatarUrl,
              updated_at: now,
            },
            { onConflict: 'user_id' },
          )

        if (profileError) {
          log('error', FN, 'customer_avatar.update_failed', { actor_id: caller.id, error: profileError.message })
          return jsonResponse({
            error: 'We could not update your profile photo right now.',
            message: 'We could not update your profile photo right now.',
          }, 500, cors)
        }
      } else {
        const { data: tailorProfile, error: tailorLookupError } = await supabase
          .from('tailor_profiles')
          .select('id')
          .eq('user_id', caller.id)
          .maybeSingle()

        if (tailorLookupError || !tailorProfile?.id) {
          log('error', FN, 'tailor_avatar.profile_lookup_failed', {
            actor_id: caller.id,
            error: tailorLookupError?.message ?? 'missing tailor profile',
          })
          return jsonResponse({
            error: 'Finish tailor setup before updating this photo.',
            message: 'Finish tailor setup before updating this photo.',
          }, tailorLookupError ? 500 : 404, cors)
        }

        tailorProfileId = tailorProfile.id
        const { error: profileError } = await supabase
          .from('tailor_profiles')
          .update({ avatar_url: body.avatarUrl, updated_at: now })
          .eq('id', tailorProfile.id)

        if (profileError) {
          log('error', FN, 'tailor_avatar.update_failed', { actor_id: caller.id, error: profileError.message })
          return jsonResponse({
            error: 'We could not update your profile photo right now.',
            message: 'We could not update your profile photo right now.',
          }, 500, cors)
        }
      }

      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: body.role,
        surface: 'avatar.public',
        publicUrls: [body.avatarUrl],
        purpose: 'AVATAR',
        tailorProfileId,
        relatedEntityType: body.role === 'TAILOR' ? 'tailor_profile' : 'customer_profile',
        relatedEntityId: tailorProfileId ?? caller.id,
        metadata: { action: body.action },
      })

      await audit(supabase, {
        event: 'account.avatar_updated',
        actor_id: caller.id,
        actor_role: body.role,
        severity: 'info',
        payload: { function: FN },
      })

      return jsonResponse({ ok: true }, 200, cors)
    }

    const displayName = body.displayName.trim()
    const displayNameIssue = validateDisplayName(displayName)
    const normalizedPhone = normalizePhoneForStorage(body.phone)
    const phoneIssue = validatePhoneForProfile(normalizedPhone)

    const { data: userRow, error: userRowError } = await supabase
      .from('users')
      .select('id, email, display_name, role, phone')
      .eq('id', caller.id)
      .maybeSingle()

    const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(caller.id)
    const tailorProfileLookup = body.role === 'TAILOR'
      ? await supabase
          .from('tailor_profiles')
          .select('id')
          .eq('user_id', caller.id)
          .maybeSingle()
      : { data: null, error: null }
    const authMetadata = readAuthMetadata(authUserData?.user?.user_metadata)
    const authPhone = typeof authMetadata.phone === 'string' ? authMetadata.phone : ''
    const currentPhone = normalizePhoneForStorage(String((userRow as { phone?: unknown } | null)?.phone ?? authPhone ?? ''))
    const phoneChanged = normalizedPhone !== currentPhone
    const proofResult = phoneChanged
      ? await verifyReauthProof(body.reauthProof, { userId: caller.id, purpose: 'PHONE_CHANGE' })
      : ({ ok: true, payload: null } as const)
    const email = caller.email ?? authUserData?.user?.email ?? (userRow as { email?: string | null } | null)?.email ?? ''

    const preflight = runPreflight([
      {
        name: 'user_record_lookup_succeeded',
        condition: !userRowError,
        errorCode: 'USER_RECORD_LOOKUP_FAILED',
        message: 'We could not load your account record. Try again in a moment.',
        field: 'account',
        severity: 'BLOCKING',
        actual: { error: userRowError?.message ?? null },
      },
      {
        name: 'auth_user_lookup_succeeded',
        condition: !authUserError && !!authUserData?.user?.id,
        errorCode: 'AUTH_USER_LOOKUP_FAILED',
        message: 'We could not verify your account session. Sign in again and retry.',
        field: 'account',
        severity: 'BLOCKING',
        actual: { error: authUserError?.message ?? null, hasUser: !!authUserData?.user?.id },
      },
      {
        name: 'account_email_available',
        condition: !!email.trim(),
        errorCode: 'ACCOUNT_EMAIL_MISSING',
        message: 'We could not verify the email on this account. Sign out and sign back in, then retry.',
        field: 'account',
        severity: 'BLOCKING',
      },
      {
        name: 'requested_role_matches_account',
        condition: !userRow || (userRow as { role?: string | null }).role === body.role,
        errorCode: 'ACCOUNT_ROLE_MISMATCH',
        message: 'This profile does not match your account type. Sign out and sign back in, then retry.',
        field: 'role',
        severity: 'BLOCKING',
        actual: { requestedRole: body.role, currentRole: (userRow as { role?: string | null } | null)?.role ?? null },
      },
      {
        name: 'tailor_profile_lookup_succeeded',
        condition: !tailorProfileLookup.error,
        errorCode: 'TAILOR_PROFILE_LOOKUP_FAILED',
        message: 'We could not load your tailor profile. Try again in a moment.',
        field: 'profile',
        severity: 'BLOCKING',
        actual: { error: tailorProfileLookup.error?.message ?? null },
      },
      {
        name: 'tailor_profile_exists',
        condition: body.role !== 'TAILOR' || !!tailorProfileLookup.data?.id,
        errorCode: 'TAILOR_PROFILE_NOT_FOUND',
        message: 'Finish tailor setup before editing this profile.',
        field: 'profile',
        severity: 'BLOCKING',
      },
      {
        name: 'display_name_valid',
        condition: !displayNameIssue,
        errorCode: 'DISPLAY_NAME_INVALID',
        message: displayNameIssue ?? 'Display name is valid.',
        field: 'displayName',
        severity: 'BLOCKING',
      },
      {
        name: 'phone_valid',
        condition: !phoneIssue,
        errorCode: 'PHONE_INVALID',
        message: phoneIssue ?? 'Phone number is valid.',
        field: 'phone',
        severity: 'BLOCKING',
      },
      {
        name: 'phone_change_has_recent_password_confirmation',
        condition: !phoneChanged || proofResult.ok,
        errorCode: proofResult.ok ? 'PHONE_REAUTH_OK' : proofResult.code,
        message: proofResult.ok ? 'Phone change has a current password confirmation.' : proofResult.message,
        field: 'reauthProof',
        severity: 'BLOCKING',
        actual: proofResult.ok
          ? { phoneChanged, maskedCurrentPhone: maskPhone(currentPhone), maskedNextPhone: maskPhone(normalizedPhone) }
          : proofResult.actual,
      },
    ])

    if (!preflight.passed) {
      await logPreflightFailure(supabase, preflight, {
        operation: 'update_personal_info',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        actorRole: body.role,
        userId: caller.id,
        source: FN,
        metadata: {
          action: body.action,
          requested_role: body.role,
          phone_changed: phoneChanged,
          masked_current_phone: maskPhone(currentPhone),
          masked_next_phone: maskPhone(normalizedPhone),
        },
      })

      const status = !proofResult.ok && proofResult.code === 'REAUTH_PROOF_SECRET_MISSING'
        ? 503
        : !proofResult.ok
          ? 401
          : 400
      return preflightFailureResponse(preflight, cors, status)
    }

    const now = new Date().toISOString()
    const { error: userUpdateError } = await supabase
      .from('users')
      .upsert(
        {
          id: caller.id,
          email,
          display_name: displayName,
          role: body.role,
          phone: normalizedPhone,
          updated_at: now,
        },
        { onConflict: 'id' },
      )

    if (userUpdateError) {
      log('error', FN, 'users.upsert_failed', { actor_id: caller.id, error: userUpdateError.message })
      return jsonResponse({
        error: 'We could not save your personal information right now.',
        message: 'We could not save your personal information right now.',
      }, 500, cors)
    }

    const mergedMetadata = {
      ...authMetadata,
      display_name: displayName,
      phone: normalizedPhone,
    }
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(caller.id, {
      user_metadata: mergedMetadata,
    })

    if (authUpdateError) {
      log('error', FN, 'auth_metadata.update_failed', { actor_id: caller.id, error: authUpdateError.message })
      return jsonResponse({
        error: 'We saved part of your profile but could not refresh your sign-in details. Please try again.',
        message: 'We saved part of your profile but could not refresh your sign-in details. Please try again.',
      }, 500, cors)
    }

    if (body.role === 'CUSTOMER') {
      const { error: profileError } = await supabase
        .from('customer_profiles')
        .upsert(
          {
            user_id: caller.id,
            display_name: displayName,
            phone: normalizedPhone,
            updated_at: now,
          },
          { onConflict: 'user_id' },
        )

      if (profileError) {
        log('error', FN, 'customer_profile.upsert_failed', { actor_id: caller.id, error: profileError.message })
        return jsonResponse({
          error: 'We could not save your customer profile right now.',
          message: 'We could not save your customer profile right now.',
        }, 500, cors)
      }
    } else {
      const { error: profileError } = await supabase
        .from('tailor_profiles')
        .update({ display_name: displayName, updated_at: now })
        .eq('id', tailorProfileLookup.data!.id)

      if (profileError) {
        log('error', FN, 'tailor_profile.update_failed', { actor_id: caller.id, error: profileError.message })
        return jsonResponse({
          error: 'We could not save your tailor profile right now.',
          message: 'We could not save your tailor profile right now.',
        }, 500, cors)
      }
    }

    await audit(supabase, {
      event: 'account.personal_info_updated',
      actor_id: caller.id,
      actor_role: body.role,
      severity: 'info',
      payload: {
        function: FN,
        phone_changed: phoneChanged,
        masked_phone: maskPhone(normalizedPhone),
      },
    })

    return jsonResponse({ ok: true, phoneChanged, maskedPhone: maskPhone(normalizedPhone) }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({
      error: 'Something went wrong updating your account. Please try again.',
      message: 'Something went wrong updating your account. Please try again.',
    }, 500, cors)
  }
})
