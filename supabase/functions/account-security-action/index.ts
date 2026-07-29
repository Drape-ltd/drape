/**
 * account-security-action
 *
 * Performs sensitive account-security mutations only after a short-lived
 * signed reauth proof has been issued by reauth-proof-action. This keeps
 * "password confirmed within 5 minutes" enforced server-side, not only in
 * mobile UI state.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validatePasswordStrength } from '../../../packages/shared/src/auth-security.ts'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { normalizeDrapeonSender } from '../_shared/email-template.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import {
  logPreflightFailure,
  preflightFailureResponse,
  runPreflight,
} from '../_shared/preflight.ts'
import { verifyReauthProof } from '../_shared/reauth-proof.ts'
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'account-security-action'
const RESEND_API = 'https://api.resend.com/emails'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('change-password'),
    reauthProof: z.string().trim().min(20),
    newPassword: z.string().min(1).max(1024),
  }),
  z.object({
    action: z.literal('start-email-change'),
    reauthProof: z.string().trim().min(20),
    newEmail: z.string().trim().email().max(320),
  }),
])

function jsonResponse(payload: Record<string, unknown>, status: number, cors: HeadersInit) {
  const body =
    typeof payload.error === 'string' && typeof payload.message !== 'string'
      ? { ...payload, message: payload.error }
      : payload
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function getSiteUrl() {
  return (
    Deno.env.get('SITE_URL') ??
    Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
    'https://drapeon.co'
  ).replace(/\/+$/u, '')
}

function getResendFrom() {
  return normalizeDrapeonSender(
    Deno.env.get('RESEND_FROM'),
    'Drapeon Security',
    'security@drapeon.co'
  )
}

function getResendApiKey() {
  return Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function maskEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  const [local, domain] = email.split('@')
  const visible = local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}

async function sendResendEmail(input: { to: string; subject: string; html: string }) {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    log('warn', FN, 'resend.missing_api_key')
    return false
  }

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drape-account-security/1.0',
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  })

  if (!response.ok) {
    log('warn', FN, 'resend.send_failed', {
      to: maskEmail(input.to),
      status: response.status,
      body: await response.text(),
    })
    return false
  }

  return true
}

async function sendPasswordChangedEmail(to: string | null | undefined) {
  const email = to?.trim()
  if (!email) return false

  const timestamp = new Date().toISOString()
  return sendResendEmail({
    to: email,
    subject: 'Your Drapeon password was changed',
    html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h1 style="font-size:24px;margin:0 0 12px">Password changed</h1>
  <p style="line-height:1.6;margin:0 0 16px">Your Drapeon password was changed after a recent password confirmation.</p>
  <p style="line-height:1.6;margin:0 0 16px">If this was not you, reset your password immediately and contact security@drapeon.co.</p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <tr><td style="padding:8px 0;color:#6b7280">Time</td><td style="padding:8px 0;font-weight:600">${escapeHtml(
      timestamp
    )}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Account email</td><td style="padding:8px 0;font-weight:600">${escapeHtml(
      email
    )}</td></tr>
  </table>
  <a href="${getSiteUrl()}/security" style="display:inline-block;padding:12px 20px;background:#2f6844;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">Security help</a>
</div>`,
  })
}

function getEmailChangeRedirectUrl() {
  return Deno.env.get('EMAIL_CHANGE_REDIRECT_URL') ?? 'drape://'
}

function getActionLink(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : {}
  const candidates = [
    properties.action_link,
    properties.actionLink,
    record.action_link,
    record.actionLink,
  ]
  return (
    candidates.find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    ) ?? null
  )
}

async function generateEmailChangeLink(
  supabase: any,
  input: {
    type: 'email_change_current' | 'email_change_new'
    currentEmail: string
    newEmail: string
  }
) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: input.type,
    email: input.currentEmail,
    newEmail: input.newEmail,
    options: {
      redirectTo: getEmailChangeRedirectUrl(),
    },
  } as never)

  if (error) {
    return { error: error.message, link: null }
  }

  const link = getActionLink(data)
  if (!link) {
    return {
      error: 'Supabase did not return an email-change action link.',
      link: null,
    }
  }
  return { error: null, link }
}

function emailChangeHtml(input: {
  title: string
  body: string
  actionLabel: string
  actionLink: string
  currentEmail: string
  newEmail: string
}) {
  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h1 style="font-size:24px;margin:0 0 12px">${escapeHtml(input.title)}</h1>
  <p style="line-height:1.6;margin:0 0 16px">${escapeHtml(input.body)}</p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <tr><td style="padding:8px 0;color:#6b7280">Current email</td><td style="padding:8px 0;font-weight:600">${escapeHtml(
      input.currentEmail
    )}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">New email</td><td style="padding:8px 0;font-weight:600">${escapeHtml(
      input.newEmail
    )}</td></tr>
  </table>
  <a href="${escapeHtml(
    input.actionLink
  )}" style="display:inline-block;padding:12px 20px;background:#2f6844;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(
    input.actionLabel
  )}</a>
  <p style="line-height:1.6;margin:24px 0 0;color:#6b7280">If you did not request this, do not click the link and contact security@drapeon.co.</p>
</div>`
}

async function sendEmailChangeLinks(input: {
  currentEmail: string
  newEmail: string
  currentLink: string
  newLink: string
}) {
  const currentQueued = await sendResendEmail({
    to: input.currentEmail,
    subject: 'Confirm your Drapeon email change',
    html: emailChangeHtml({
      title: 'Confirm your email change',
      body: 'Someone signed in to Drapeon and asked to change the email on this account. Confirm this from your current inbox before we switch it.',
      actionLabel: 'Confirm from current email',
      actionLink: input.currentLink,
      currentEmail: input.currentEmail,
      newEmail: input.newEmail,
    }),
  })
  const newQueued = await sendResendEmail({
    to: input.newEmail,
    subject: 'Confirm this email for Drapeon',
    html: emailChangeHtml({
      title: 'Confirm this new email',
      body: 'Confirm this inbox so Drapeon can finish changing your account email. Your account email will not change until the confirmation steps are complete.',
      actionLabel: 'Confirm new email',
      actionLink: input.newLink,
      currentEmail: input.currentEmail,
      newEmail: input.newEmail,
    }),
  })
  return { currentQueued, newQueued }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse(
        {
          error: 'Please sign in again before changing account security settings.',
          message: 'Please sign in again before changing account security settings.',
        },
        401,
        cors
      )
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', {
        actor_id: caller.id,
        error: parsed.error,
      })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}:${clientIp}`, 3600, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN, ip: clientIp, action: parsed.data.action },
      })
      return rateLimitExceededResponse(cors)
    }

    if (parsed.data.action === 'start-email-change') {
      const currentEmail = caller.email?.trim().toLowerCase() ?? ''
      const newEmail = parsed.data.newEmail.trim().toLowerCase()
      const proofResult = await verifyReauthProof(parsed.data.reauthProof, {
        userId: caller.id,
        purpose: 'EMAIL_CHANGE',
      })

      const preflight = runPreflight([
        {
          name: 'current_email_available',
          condition: !!currentEmail,
          errorCode: 'CURRENT_EMAIL_MISSING',
          message:
            'We could not find the current email for this session. Sign out and sign back in, then retry.',
          field: 'email',
          severity: 'BLOCKING',
        },
        {
          name: 'new_email_valid',
          condition: isValidEmail(newEmail),
          errorCode: 'EMAIL_INVALID',
          message: 'Please enter a valid email address.',
          field: 'newEmail',
          severity: 'BLOCKING',
        },
        {
          name: 'new_email_differs_from_current',
          condition: newEmail !== currentEmail,
          errorCode: 'EMAIL_UNCHANGED',
          message: 'Enter a different email address.',
          field: 'newEmail',
          severity: 'BLOCKING',
          actual: {
            currentEmail: maskEmail(currentEmail),
            newEmail: maskEmail(newEmail),
          },
        },
        {
          name: 'email_change_has_recent_password_confirmation',
          condition: proofResult.ok,
          errorCode: proofResult.ok ? 'EMAIL_REAUTH_OK' : proofResult.code,
          message: proofResult.ok
            ? 'Email change has a current password confirmation.'
            : proofResult.message,
          field: 'reauthProof',
          severity: 'BLOCKING',
          actual: proofResult.ok
            ? {
                issuedAt: new Date(proofResult.payload.issuedAt).toISOString(),
                expiresAt: new Date(proofResult.payload.expiresAt).toISOString(),
                purpose: proofResult.payload.purpose,
              }
            : proofResult.actual,
        },
      ])

      if (!preflight.passed) {
        await logPreflightFailure(supabase, preflight, {
          operation: 'start_email_change',
          entityType: 'user',
          entityId: caller.id,
          actorId: caller.id,
          userId: caller.id,
          source: FN,
          metadata: {
            action: parsed.data.action,
            current_email: maskEmail(currentEmail),
            new_email: maskEmail(newEmail),
          },
        })
        const status =
          !proofResult.ok && proofResult.code === 'REAUTH_PROOF_SECRET_MISSING'
            ? 503
            : !proofResult.ok
              ? 401
              : 400
        return preflightFailureResponse(preflight, cors, status)
      }

      const [currentLinkResult, newLinkResult] = await Promise.all([
        generateEmailChangeLink(supabase, {
          type: 'email_change_current',
          currentEmail,
          newEmail,
        }),
        generateEmailChangeLink(supabase, {
          type: 'email_change_new',
          currentEmail,
          newEmail,
        }),
      ])

      if (
        currentLinkResult.error ||
        newLinkResult.error ||
        !currentLinkResult.link ||
        !newLinkResult.link
      ) {
        log('error', FN, 'email_change.link_generation_failed', {
          actor_id: caller.id,
          current_error: currentLinkResult.error,
          new_error: newLinkResult.error,
          current_email: maskEmail(currentEmail),
          new_email: maskEmail(newEmail),
        })
        await audit(supabase, {
          event: 'auth.email_change_failed',
          actor_id: caller.id,
          severity: 'error',
          payload: {
            function: FN,
            current_error: currentLinkResult.error,
            new_error: newLinkResult.error,
            current_email: maskEmail(currentEmail),
            new_email: maskEmail(newEmail),
          },
        })
        return jsonResponse(
          {
            error: 'We could not start the email change right now. Please try again in a moment.',
            message: 'We could not start the email change right now. Please try again in a moment.',
          },
          500,
          cors
        )
      }

      const emailQueued = await sendEmailChangeLinks({
        currentEmail,
        newEmail,
        currentLink: currentLinkResult.link,
        newLink: newLinkResult.link,
      })
      await audit(supabase, {
        event: 'auth.email_change_started',
        actor_id: caller.id,
        severity: emailQueued.currentQueued && emailQueued.newQueued ? 'info' : 'warn',
        payload: {
          function: FN,
          current_email_queued: emailQueued.currentQueued,
          new_email_queued: emailQueued.newQueued,
          current_email: maskEmail(currentEmail),
          new_email: maskEmail(newEmail),
        },
      })

      return jsonResponse(
        {
          ok: true,
          currentEmailQueued: emailQueued.currentQueued,
          newEmailQueued: emailQueued.newQueued,
        },
        200,
        cors
      )
    }

    const proofResult = await verifyReauthProof(parsed.data.reauthProof, {
      userId: caller.id,
      purpose: 'PASSWORD_CHANGE',
    })
    const passwordIssue = validatePasswordStrength(parsed.data.newPassword, {
      forbiddenValues: [caller.email],
    })

    const preflight = runPreflight([
      {
        name: 'password_confirmed_within_five_minutes',
        condition: proofResult.ok,
        errorCode: proofResult.ok ? 'REAUTH_OK' : proofResult.code,
        message: proofResult.ok ? 'Password confirmation is current.' : proofResult.message,
        field: 'reauthProof',
        severity: 'BLOCKING',
        actual: proofResult.ok
          ? {
              issuedAt: new Date(proofResult.payload.issuedAt).toISOString(),
              expiresAt: new Date(proofResult.payload.expiresAt).toISOString(),
              purpose: proofResult.payload.purpose,
            }
          : proofResult.actual,
      },
      {
        name: 'new_password_meets_policy',
        condition: !passwordIssue,
        errorCode: 'PASSWORD_POLICY_FAILED',
        message: passwordIssue ?? 'Password meets Drapeon policy.',
        field: 'newPassword',
        severity: 'BLOCKING',
      },
    ])

    if (!preflight.passed) {
      await logPreflightFailure(supabase, preflight, {
        operation: 'change_password',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { action: parsed.data.action },
      })
      const status =
        !proofResult.ok && proofResult.code === 'REAUTH_PROOF_SECRET_MISSING'
          ? 503
          : !proofResult.ok
            ? 401
            : 400
      return preflightFailureResponse(preflight, cors, status)
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(caller.id, {
      password: parsed.data.newPassword,
    })

    if (updateError) {
      log('error', FN, 'auth.update_password_failed', {
        actor_id: caller.id,
        error: updateError.message,
      })
      await audit(supabase, {
        event: 'auth.password_change_failed',
        actor_id: caller.id,
        severity: 'error',
        payload: { function: FN, reason: updateError.message },
      })
      return jsonResponse(
        {
          error: 'We could not update your password right now. Please try again in a moment.',
          message: 'We could not update your password right now. Please try again in a moment.',
        },
        500,
        cors
      )
    }

    const emailQueued = await sendPasswordChangedEmail(caller.email)
    await audit(supabase, {
      event: 'auth.password_changed',
      actor_id: caller.id,
      severity: 'info',
      payload: {
        function: FN,
        email_queued: emailQueued,
      },
    })

    return jsonResponse({ ok: true, emailQueued }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse(
      {
        error: 'Something went wrong updating account security. Please try again.',
        message: 'Something went wrong updating account security. Please try again.',
      },
      500,
      cors
    )
  }
})
