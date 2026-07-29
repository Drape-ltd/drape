/**
 * handle-verification-decision
 *
 * Handles tailor verification approve / reject decisions.
 *
 * Existing one-click ops email links are still supported as signed GET requests:
 *   ?tailorId=<uuid>&decision=APPROVE|REJECT&exp=<unix_ts>&token=<hmac_hex>
 *
 * The token is HMAC-SHA256(VERIFICATION_SECRET, tailorId:decision:exp).
 * Links expire after 7 days. Invalid or tampered links are rejected.
 *
 * The ops dashboard calls this function as a service-role POST request with:
 *   { tailorUserId, decision, reason, performedBy, performedRole }
 *
 * On APPROVE: sets id_verification_status = 'VERIFIED', is_live = true,
 *             id_verified_at = now(), resolves the ops issue, audits, emails
 * On REJECT:  sets id_verification_status = 'REJECTED', is_live = false,
 *             id_verified_at = null, resolves the ops issue, audits, emails
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VERIFICATION_SECRET  – shared secret used to sign decision tokens
 *   RESEND_API_KEY       – sends tailor approval / rejection emails
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { verifyPayload, escapeHtml } from '../_shared/hmac.ts'
import { log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import {
  createResendVerificationEmailSender,
  DEFAULT_VERIFICATION_REJECTION_REASON,
  performVerificationDecision,
  VERIFICATION_SOURCE_OPS_DASHBOARD,
  VERIFICATION_SOURCE_SIGNED_LINK,
} from '../_shared/verification-decision.ts'

const FN = 'handle-verification-decision'

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f1eb}
    .card{background:#fff;border-radius:12px;padding:40px 48px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.08);max-width:420px}
    h1{margin:0 0 12px;font-size:22px}p{color:#666;line-height:1.6}</style></head>
    <body><div class="card">${body}</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } },
  )
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function readBearerToken(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

function constantTimeEqual(a: string, b: string) {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const length = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length

  for (let index = 0; index < length; index += 1) {
    diff |= (aBytes[index] ?? 0) ^ (bBytes[index] ?? 0)
  }

  return diff === 0
}

async function lookupAuthUserEmail(
  supabase: { auth: { admin: { getUserById: (userId: string) => Promise<{ data: { user?: { email?: string | null } | null }; error: { message: string } | null }> } } },
  userId: string,
) {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) {
    log('warn', FN, 'auth_email_lookup.failed', { user_id: userId, error: error.message })
    return null
  }
  return data.user?.email?.trim() || null
}

function isServiceRoleRequest(req: Request) {
  const serviceRoleKey = getServiceRoleKey()
  const bearerToken = readBearerToken(req)
  const apiKey = req.headers.get('apikey')?.trim() ?? ''

  return (
    (bearerToken.length > 0 && constantTimeEqual(bearerToken, serviceRoleKey)) ||
    (apiKey.length > 0 && constantTimeEqual(apiKey, serviceRoleKey))
  )
}

async function handleOpsDashboardPost(req: Request) {
  const corsHeaders = getCorsHeaders(req)

  if (!isServiceRoleRequest(req)) {
    log('warn', FN, 'auth.service_role_required')
    return jsonResponse({ ok: false, error: 'SERVICE_ROLE_REQUIRED' }, 401, corsHeaders)
  }

  const body = await req.json().catch(() => null) as {
    tailorUserId?: string
    decision?: string
    reason?: string | null
    rejectionCode?: string | null
    performedBy?: string | null
    performedRole?: string | null
  } | null

  if (!body || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: 'INVALID_JSON' }, 400, corsHeaders)
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const result = await performVerificationDecision(
    supabase,
    {
      tailorUserId: body.tailorUserId ?? '',
      decision: body.decision ?? '',
      reason: body.reason ?? null,
      rejectionCode: body.rejectionCode ?? null,
      performedBy: body.performedBy ?? null,
      performedRole: body.performedRole ?? 'OPS',
      source: VERIFICATION_SOURCE_OPS_DASHBOARD,
    },
    {
      appUrl: Deno.env.get('SITE_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? null,
      lookupUserEmail: (userId) => lookupAuthUserEmail(supabase, userId),
      sendEmail: createResendVerificationEmailSender(),
      sendPush: (userId, message) => sendPushToUser(supabase, userId, message),
    },
  )

  if (!result.ok) {
    log(result.status >= 500 ? 'error' : 'warn', FN, 'decision.failed', {
      tailor_id: body.tailorUserId ?? null,
      decision: body.decision ?? null,
      error: result.code,
    })
    return jsonResponse({ ok: false, error: result.code, message: result.message }, result.status, corsHeaders)
  }

  log('info', FN, 'id_verification.decision', {
    tailor_id: body.tailorUserId,
    decision: body.decision,
    source: VERIFICATION_SOURCE_OPS_DASHBOARD,
    email_sent: result.emailSent,
    email_error: result.emailError,
    push_status: result.pushStatus,
    push_error: result.pushError,
  })

  return jsonResponse(result, 200, corsHeaders)
}

async function handleSignedGet(req: Request) {
  const url = new URL(req.url)
  const tailorId = url.searchParams.get('tailorId')
  const decision = url.searchParams.get('decision')
  const expStr   = url.searchParams.get('exp')
  const token    = url.searchParams.get('token')

  // All four params are required
  if (!tailorId || !decision || !expStr || !token) {
    return htmlPage('Invalid link', '<h1>Invalid link</h1><p>This link is missing required parameters. Please use the link from the verification email.</p>')
  }

  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return htmlPage('Invalid link', '<h1>Invalid link</h1><p>Unrecognised decision value.</p>')
  }

  // Check expiry before hitting the database
  const exp = parseInt(expStr, 10)
  if (isNaN(exp) || Math.floor(Date.now() / 1000) > exp) {
    return htmlPage(
      'Link expired',
      '<h1>Link expired</h1><p>This decision link has expired (links are valid for 7 days).</p><p>Ask the tailor to re-submit their profile to receive a fresh link.</p>',
    )
  }

  // Verify HMAC — rejects tampered or forged links
  const verificationSecret = Deno.env.get('VERIFICATION_SECRET')
  if (!verificationSecret) {
    console.error('[handle-verification-decision] VERIFICATION_SECRET env var not set')
    return htmlPage('Configuration error', '<h1>Configuration error</h1><p>Please contact engineering.</p>')
  }

  const valid = await verifyPayload(verificationSecret, `${tailorId}:${decision}:${expStr}`, token)
  if (!valid) {
    log('warn', FN, 'hmac.invalid_token', { tailor_id: tailorId, decision })
    return htmlPage('Invalid link', '<h1>Invalid link</h1><p>This link is invalid or has been tampered with.</p>')
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

  // Rate limit: 5 decision attempts per hour per tailorId — blocks brute force
  const allowed = await checkRateLimit(supabase, `verification-decision:${tailorId}`, 3600, 5)
  if (!allowed) {
    log('warn', FN, 'rate_limit.exceeded', { tailor_id: tailorId })
    return rateLimitExceededResponse(getCorsHeaders(req))
  }

  const result = await performVerificationDecision(
    supabase,
    {
      tailorUserId: tailorId,
      decision,
      reason: decision === 'REJECT' ? DEFAULT_VERIFICATION_REJECTION_REASON : null,
      performedBy: 'signed-verification-link',
      performedRole: 'OPS',
      source: VERIFICATION_SOURCE_SIGNED_LINK,
    },
    {
      appUrl: Deno.env.get('SITE_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? null,
      lookupUserEmail: (userId) => lookupAuthUserEmail(supabase, userId),
      sendEmail: createResendVerificationEmailSender(),
      sendPush: (userId, message) => sendPushToUser(supabase, userId, message),
    },
  )

  if (!result.ok) {
    if (result.status === 404) {
      return htmlPage('Not found', '<h1>Tailor not found</h1><p>No profile found for this ID.</p>')
    }

    if (result.status === 409) {
      return htmlPage(
        'Already processed',
        `<h1>Already processed</h1><p>This verification was already handled.</p>`,
      )
    }

    log('error', FN, 'decision.failed', { tailor_id: tailorId, decision, error: result.code })
    return htmlPage('Database error', '<h1>Database error</h1><p>Could not update profile. Please review this from the dashboard.</p>')
  }

  log('info', FN, 'id_verification.decision', {
    tailor_id: tailorId,
    decision,
    source: VERIFICATION_SOURCE_SIGNED_LINK,
    email_sent: result.emailSent,
    email_error: result.emailError,
    push_status: result.pushStatus,
    push_error: result.pushError,
  })

  const displayName = result.displayName || 'This tailor'
  if (decision === 'APPROVE') {
    return htmlPage(
      'Tailor approved',
      `<h1 style="color:#2F6844">Approved</h1>
       <p><strong>${escapeHtml(displayName)}</strong> is now live on Drapeon.</p>
       <p style="font-size:13px;margin-top:16px">They will receive an app notification and email confirmation shortly when delivery is available.</p>`,
    )
  }

  return htmlPage(
    'Tailor rejected',
    `<h1 style="color:#B91C1C">Rejected</h1>
     <p><strong>${escapeHtml(displayName)}</strong>'s profile has been marked as rejected and will not go live.</p>`,
  )
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'POST') return handleOpsDashboardPost(req)
  if (req.method === 'GET') return handleSignedGet(req)
  return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, corsHeaders)
})
