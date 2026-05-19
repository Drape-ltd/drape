/**
 * account-security-notification
 *
 * Sends a security receipt to the signed-in user's current email for sensitive
 * auth changes initiated in-app.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'account-security-notification'
const RESEND_API = 'https://api.resend.com/emails'

const BodySchema = z.object({
  event: z.enum(['PASSWORD_CHANGED', 'EMAIL_CHANGE_STARTED']),
  newEmail: z.string().trim().email().max(254).optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  const payload =
    typeof body.error === 'string' && typeof body.message !== 'string'
      ? { ...body, message: body.error }
      : body
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
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
  return Deno.env.get('RESEND_FROM') ?? 'Drape Security <security@drapeon.co>'
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

async function sendSecurityEmail(input: {
  to: string
  event: 'PASSWORD_CHANGED' | 'EMAIL_CHANGE_STARTED'
  newEmail?: string
}) {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    log('warn', FN, 'resend.missing_api_key')
    return false
  }

  const timestamp = new Date().toISOString()
  const appUrl = getSiteUrl()
  const subject = input.event === 'PASSWORD_CHANGED'
    ? 'Your Drape password was changed'
    : 'Drape email change requested'
  const headline = input.event === 'PASSWORD_CHANGED'
    ? 'Password changed'
    : 'Email change requested'
  const body = input.event === 'PASSWORD_CHANGED'
    ? 'Your Drape password was changed from a signed-in session.'
    : `A signed-in session requested changing this Drape account email${input.newEmail ? ` to ${input.newEmail}` : ''}. Your account email changes only after the required confirmation step is complete.`
  const action = input.event === 'PASSWORD_CHANGED'
    ? 'If this was not you, reset your password immediately and contact security@drapeon.co.'
    : 'If this was not you, do not confirm the change and contact security@drapeon.co immediately.'

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
      subject,
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h1 style="font-size:24px;margin:0 0 12px">${escapeHtml(headline)}</h1>
  <p style="line-height:1.6;margin:0 0 16px">${escapeHtml(body)}</p>
  <p style="line-height:1.6;margin:0 0 16px">${escapeHtml(action)}</p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <tr><td style="padding:8px 0;color:#6b7280">Time</td><td style="padding:8px 0;font-weight:600">${escapeHtml(timestamp)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Account email</td><td style="padding:8px 0;font-weight:600">${escapeHtml(input.to)}</td></tr>
  </table>
  <a href="${appUrl}/security" style="display:inline-block;padding:12px 20px;background:#2f6844;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">Security help</a>
</div>`,
    }),
  })

  if (!response.ok) {
    const responseBody = await response.text()
    log('warn', FN, 'resend.send_failed', {
      to: input.to,
      event: input.event,
      status: response.status,
      body: responseBody,
    })
    return false
  }

  return true
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before sending account security notices.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `account-security-notification:${caller.id}`, 86400, 20)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    if (!caller.email) {
      return jsonResponse({ ok: false, emailQueued: false, error: 'No account email available.' }, 200, cors)
    }

    const emailQueued = await sendSecurityEmail({
      to: caller.email,
      event: parsed.data.event,
      newEmail: parsed.data.newEmail,
    })

    await audit(supabase, {
      event: parsed.data.event === 'PASSWORD_CHANGED'
        ? 'auth.password_security_notice_sent'
        : 'auth.email_change_security_notice_sent',
      actor_id: caller.id,
      severity: emailQueued ? 'info' : 'warn',
      payload: {
        function: FN,
        email_queued: emailQueued,
        new_email: parsed.data.event === 'EMAIL_CHANGE_STARTED' ? parsed.data.newEmail ?? null : null,
      },
    })

    return jsonResponse({ ok: true, emailQueued }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'Something went wrong sending this security notice. Please try again.' }, 500, cors)
  }
})
