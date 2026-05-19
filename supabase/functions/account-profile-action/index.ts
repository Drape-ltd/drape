/**
 * account-profile-action
 *
 * Owns account profile/contact mutations that should never be written directly
 * by mobile clients. Phone changes require a short-lived signed reauth proof.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateDisplayName } from '../../../packages/shared/src/contact-filter.ts'
import { normalizePhoneForStorage, validatePhoneForProfile } from '../../../packages/shared/src/phone.ts'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { verifyReauthProof } from '../_shared/reauth-proof.ts'
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'account-profile-action'

const BodySchema = z.object({
  action: z.literal('update-personal-info'),
  role: z.enum(['CUSTOMER', 'TAILOR']),
  displayName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(32),
  reauthProof: z.string().trim().min(20).optional(),
})

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
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}:${clientIp}`, 3600, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: body.role,
        severity: 'warn',
        payload: { function: FN, ip: clientIp, action: body.action },
      })
      return rateLimitExceededResponse(cors)
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
