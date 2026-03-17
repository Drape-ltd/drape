/**
 * handle-verification-decision
 *
 * Handles one-click approve / reject links from the ops verification email.
 * Called as a GET request with a signed, expiring token:
 *   ?tailorId=<uuid>&decision=APPROVE|REJECT&exp=<unix_ts>&token=<hmac_hex>
 *
 * The token is HMAC-SHA256(VERIFICATION_SECRET, tailorId:decision:exp).
 * Links expire after 7 days. Invalid or tampered links are rejected.
 *
 * On APPROVE: sets id_verification_status = 'VERIFIED', is_live = true
 * On REJECT:  sets id_verification_status = 'REJECTED', is_live = false
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VERIFICATION_SECRET  – shared secret used to sign decision tokens
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyPayload, escapeHtml } from '../_shared/hmac.ts'
import { log, audit } from '../_shared/logger.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

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

Deno.serve(async (req) => {
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Rate limit: 5 decision attempts per hour per tailorId — blocks brute force
  const allowed = await checkRateLimit(supabase, `verification-decision:${tailorId}`, 3600, 5)
  if (!allowed) {
    log('warn', FN, 'rate_limit.exceeded', { tailor_id: tailorId })
    return htmlPage('Too many requests', '<h1>Too many requests</h1><p>Please wait before trying this link again.</p>')
  }

  // Fetch current status to avoid double-processing
  const { data: profile } = await supabase
    .from('tailor_profiles')
    .select('display_name, id_verification_status')
    .eq('user_id', tailorId)
    .single()

  if (!profile) {
    return htmlPage('Not found', '<h1>Tailor not found</h1><p>No profile found for this ID.</p>')
  }

  if (profile.id_verification_status !== 'PENDING') {
    return htmlPage(
      'Already processed',
      `<h1>Already processed</h1><p><strong>${escapeHtml(profile.display_name)}</strong>'s verification was already handled (status: ${escapeHtml(profile.id_verification_status)}).</p>`,
    )
  }

  const updates =
    decision === 'APPROVE'
      ? { id_verification_status: 'VERIFIED', is_live: true,  updated_at: new Date().toISOString() }
      : { id_verification_status: 'REJECTED', is_live: false, updated_at: new Date().toISOString() }

  const { error } = await supabase
    .from('tailor_profiles')
    .update(updates)
    .eq('user_id', tailorId)

  if (error) {
    log('error', FN, 'db.error', { tailor_id: tailorId, decision, error: error.message })
    return htmlPage('Database error', '<h1>Database error</h1><p>Could not update profile. Please update manually in the dashboard.</p>')
  }

  const supabaseForAudit = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  await audit(supabaseForAudit, {
    event: 'id_verification.decision',
    actor_id: tailorId,
    actor_role: 'OPS',
    severity: decision === 'APPROVE' ? 'info' : 'warn',
    payload: { decision, tailor_id: tailorId, display_name: profile.display_name },
  })
  log('info', FN, 'id_verification.decision', { tailor_id: tailorId, decision })

  if (decision === 'APPROVE') {
    return htmlPage(
      'Tailor approved',
      `<h1 style="color:#2F6844">✓ Approved</h1>
       <p><strong>${escapeHtml(profile.display_name)}</strong> is now live on Drape.</p>
       <p style="font-size:13px;margin-top:16px">They will receive a push notification shortly.</p>`,
    )
  } else {
    return htmlPage(
      'Tailor rejected',
      `<h1 style="color:#B91C1C">✗ Rejected</h1>
       <p><strong>${escapeHtml(profile.display_name)}</strong>'s profile has been marked as rejected and will not go live.</p>`,
    )
  }
})
