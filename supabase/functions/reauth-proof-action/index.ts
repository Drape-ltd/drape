/**
 * reauth-proof-action
 *
 * Issues short-lived signed proofs that the current user confirmed their
 * password for a specific sensitive action. The proof is bound to the JWT user,
 * expires in five minutes, and is verified server-side by downstream functions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseAnonKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { hasReauthProofSecret, issueReauthProof, REAUTH_PROOF_PURPOSES } from '../_shared/reauth-proof.ts'
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'reauth-proof-action'
const PROVIDER_REAUTH_WINDOW_SECONDS = 2 * 60

const BodySchema = z.object({
  action: z.enum(['issue-proof', 'issue-provider-proof']).default('issue-proof'),
  purpose: z.enum(REAUTH_PROOF_PURPOSES),
  password: z.string().max(1024).optional(),
  provider: z.enum(['apple', 'google']).optional(),
})

function bearerClaims(req: Request): Record<string, unknown> | null {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function claimProviders(claims: Record<string, unknown> | null) {
  const appMetadata = claims?.app_metadata
  const providers = appMetadata && typeof appMetadata === 'object'
    ? (appMetadata as Record<string, unknown>).providers
    : null
  return Array.isArray(providers)
    ? providers.filter((provider): provider is string => typeof provider === 'string')
    : []
}

function jsonResponse(payload: Record<string, unknown>, status: number, cors: HeadersInit) {
  if (typeof payload.error === 'string' && typeof payload.message !== 'string') {
    payload.message = payload.error
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before confirming your password.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const claims = bearerClaims(req)
    const clientIp = getClientIp(req)
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}:${clientIp}`, 300, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN, ip: clientIp, purpose: parsed.data.purpose },
      })
      return rateLimitExceededResponse(cors)
    }

    const providerProof = parsed.data.action === 'issue-provider-proof'
    const emailPreflight = runPreflight([
      {
        name: providerProof ? 'user_has_provider_identity' : 'user_has_email_password_identity',
        condition: providerProof
          ? !!parsed.data.provider && claimProviders(claims).includes(parsed.data.provider)
          : !!caller.email && !!parsed.data.password,
        errorCode: 'REAUTH_EMAIL_REQUIRED',
        message: providerProof
          ? 'Sign in with the provider connected to this account before continuing.'
          : 'This account needs an email and password before this action can continue.',
        field: providerProof ? 'provider' : 'email',
        severity: 'BLOCKING',
        actual: { hasEmail: !!caller.email, provider: parsed.data.provider ?? null },
      },
    ])

    if (!emailPreflight.passed) {
      await logPreflightFailure(supabase, emailPreflight, {
        operation: 'issue_reauth_proof',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { purpose: parsed.data.purpose },
      })
      return preflightFailureResponse(emailPreflight, cors, 400)
    }

    const secretPreflight = runPreflight([
      {
        name: 'reauth_signing_secret_configured',
        condition: hasReauthProofSecret(),
        errorCode: 'REAUTH_PROOF_SECRET_MISSING',
        message: 'Drapeon could not verify your recent password confirmation. Try again in a moment.',
        field: 'reauthProof',
        severity: 'BLOCKING',
      },
    ])

    if (!secretPreflight.passed) {
      await logPreflightFailure(supabase, secretPreflight, {
        operation: 'issue_reauth_proof',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { purpose: parsed.data.purpose },
      })
      return preflightFailureResponse(secretPreflight, cors, 503)
    }

    let verificationPassed = false
    let verificationCode = 'REAUTH_USER_MISMATCH'
    let verificationMessage = 'Confirm your identity again before continuing.'
    let verificationActual: Record<string, unknown> = {}

    if (providerProof) {
      const issuedAt = typeof claims?.iat === 'number' ? claims.iat : null
      const subject = typeof claims?.sub === 'string' ? claims.sub : null
      const ageSeconds = issuedAt == null ? null : Math.floor(Date.now() / 1000) - issuedAt
      verificationPassed = subject === caller.id && ageSeconds != null && ageSeconds >= -30 && ageSeconds <= PROVIDER_REAUTH_WINDOW_SECONDS
      verificationCode = verificationPassed ? '' : 'REAUTH_PROVIDER_SESSION_STALE'
      verificationMessage = 'Complete a fresh provider sign-in before continuing.'
      verificationActual = { provider: parsed.data.provider, issuedAt, ageSeconds, subjectMatches: subject === caller.id }
    } else {
      const authClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: passwordData, error: passwordError } = await authClient.auth.signInWithPassword({
        email: caller.email!,
        password: parsed.data.password!,
      })
      verificationPassed = !passwordError && passwordData.user?.id === caller.id
      verificationCode = passwordError ? 'REAUTH_PASSWORD_INCORRECT' : 'REAUTH_USER_MISMATCH'
      verificationMessage = passwordError ? 'Incorrect password. Try again.' : 'Confirm your password again before continuing.'
      verificationActual = {
        authError: passwordError?.message ?? null,
        signedInUserId: passwordData.user?.id ?? null,
        expectedUserId: caller.id,
      }
    }

    const passwordPreflight = runPreflight([
      {
        name: providerProof ? 'provider_verified_for_current_user' : 'password_verified_for_current_user',
        condition: verificationPassed,
        errorCode: verificationCode,
        message: verificationMessage,
        field: providerProof ? 'provider' : 'password',
        severity: 'BLOCKING',
        actual: verificationActual,
      },
    ])

    if (!passwordPreflight.passed) {
      await logPreflightFailure(supabase, passwordPreflight, {
        operation: 'issue_reauth_proof',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { purpose: parsed.data.purpose, ip: clientIp },
      })
      return preflightFailureResponse(passwordPreflight, cors, 401)
    }

    const { proof, payload } = await issueReauthProof({
      userId: caller.id,
      purpose: parsed.data.purpose,
    })

    await audit(supabase, {
      event: 'reauth_proof.issued',
      actor_id: caller.id,
      severity: 'info',
      payload: {
        function: FN,
        purpose: parsed.data.purpose,
        method: providerProof ? parsed.data.provider : 'password',
        issued_at: new Date(payload.issuedAt).toISOString(),
        expires_at: new Date(payload.expiresAt).toISOString(),
      },
    })

    return jsonResponse({
      ok: true,
      proof,
      purpose: payload.purpose,
      issuedAt: new Date(payload.issuedAt).toISOString(),
      expiresAt: new Date(payload.expiresAt).toISOString(),
    }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not confirm your password right now. Please try again.' }, 500, cors)
  }
})
