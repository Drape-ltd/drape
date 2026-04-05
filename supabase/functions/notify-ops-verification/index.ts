/**
 * notify-ops-verification
 *
 * Called by the mobile app immediately after a tailor submits their profile
 * with id_verification_status = 'PENDING'. Sends an ops review email via Resend
 * containing one-click approve / reject links.
 *
 * Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
 *   RESEND_API_KEY   – Resend API key
 *   RESEND_FROM      – optional verified sender (e.g. Drape Verification <verify@drapeon.co>)
 *   OPS_EMAIL        – email address that receives verification requests (e.g. ops@drapeon.co)
 *   SUPABASE_URL     – injected automatically by Supabase runtime
 *   SUPABASE_ANON_KEY – injected automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY – injected automatically
 *   DECISION_FUNCTION_URL – optional public URL of the handle-verification-decision function
 *                           (defaults to https://<project-ref>.supabase.co/functions/v1/handle-verification-decision)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { signPayload, escapeHtml } from '../_shared/hmac.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

function getDecisionFunctionUrl() {
  const explicit = Deno.env.get('DECISION_FUNCTION_URL')
  if (explicit && explicit.trim().length > 0) return explicit.trim()

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL environment variable.')

  return `${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/handle-verification-decision`
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is an authenticated user — tailorId comes from the JWT,
    // not the request body, so a user cannot trigger notifications for another tailor.
    const caller = await getAuthUser(req)
    if (!caller) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const tailorId = caller.id

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Rate limit: 3 emails per hour per tailor (prevents ops inbox spam)
    const allowed = await checkRateLimit(supabase, `notify-ops-verification:${tailorId}`, 3600, 3)
    if (!allowed) {
      return new Response('Too many requests — try again later', { status: 429, headers: corsHeaders })
    }

    // Fetch tailor profile
    const { data: profile, error } = await supabase
      .from('tailor_profiles')
      .select('display_name, location, bio, specialty_tags, price_range_min, price_range_max, id_document_url, id_verification_status')
      .eq('user_id', tailorId)
      .single()

    if (error || !profile) {
      return new Response('Tailor profile not found', { status: 404, headers: corsHeaders })
    }

    // Only send if genuinely pending
    if (profile.id_verification_status !== 'PENDING') {
      return new Response('Not pending — no email sent', { status: 200, headers: corsHeaders })
    }

    const verificationSecret = Deno.env.get('VERIFICATION_SECRET')
    if (!verificationSecret) {
      console.error('[notify-ops-verification] VERIFICATION_SECRET env var not set')
      return new Response('Server configuration error', { status: 500, headers: corsHeaders })
    }

    // Tokens expire in 7 days — ops has a full week to act before needing a re-submit
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const approveToken = await signPayload(verificationSecret, `${tailorId}:APPROVE:${exp}`)
    const rejectToken  = await signPayload(verificationSecret, `${tailorId}:REJECT:${exp}`)

    const decisionBase = getDecisionFunctionUrl()
    const approveUrl = `${decisionBase}?tailorId=${tailorId}&decision=APPROVE&exp=${exp}&token=${approveToken}`
    const rejectUrl  = `${decisionBase}?tailorId=${tailorId}&decision=REJECT&exp=${exp}&token=${rejectToken}`

    const priceMin = profile.price_range_min != null ? `£${(profile.price_range_min / 100).toFixed(0)}` : '—'
    const priceMax = profile.price_range_max != null ? `£${(profile.price_range_max / 100).toFixed(0)}` : '—'
    const tags = (profile.specialty_tags ?? []).join(', ') || '—'

    // Escape all profile fields before embedding in HTML — prevents ops email injection
    const html = `
<h2>New tailor verification request</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:6px 12px;color:#666">Name</td><td style="padding:6px 12px"><strong>${escapeHtml(profile.display_name)}</strong></td></tr>
  <tr><td style="padding:6px 12px;color:#666">Location</td><td style="padding:6px 12px">${escapeHtml(profile.location ?? '—')}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Specialties</td><td style="padding:6px 12px">${escapeHtml(tags)}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Price range</td><td style="padding:6px 12px">${priceMin} – ${priceMax}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Bio</td><td style="padding:6px 12px">${escapeHtml(profile.bio ?? '—')}</td></tr>
  ${profile.id_document_url ? `<tr><td style="padding:6px 12px;color:#666">ID document</td><td style="padding:6px 12px"><a href="${escapeHtml(profile.id_document_url)}">View uploaded ID</a></td></tr>` : ''}
</table>

<br>
<a href="${approveUrl}" style="background:#2F6844;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin-right:12px">✓ Approve</a>
<a href="${rejectUrl}"  style="background:#B91C1C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">✗ Reject</a>

<p style="color:#999;font-size:12px;margin-top:24px">Expires: ${new Date(exp * 1000).toUTCString()}</p>
`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'User-Agent': 'drape-notify-ops-verification/1.0',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') ?? 'Drape Verification <verify@drapeon.co>',
        to: [Deno.env.get('OPS_EMAIL') ?? 'ops@drapeon.co'],
        subject: `Verification request: ${profile.display_name}`,
        html,
      }),
    })

    if (!resendRes.ok) {
      const body = await resendRes.text()
      console.error('[notify-ops-verification] Resend error:', body)
      return new Response('Email send failed', { status: 502, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notify-ops-verification]', err)
    return new Response('Internal error', { status: 500, headers: corsHeaders })
  }
})
