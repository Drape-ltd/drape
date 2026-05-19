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
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { signPayload, escapeHtml } from '../_shared/hmac.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { currencySymbol, normalizeAccountCurrency } from '../../../packages/shared/src/currency-config.ts'

const ID_DOCUMENT_BUCKET = 'id-documents'

type SupabaseStorageSigner = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
    }
  }
}

function idDocumentStoragePath(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null

  let path = trimmed
  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const decodedPath = decodeURIComponent(url.pathname)
      const match = decodedPath.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?id-documents\/(.+)$/u)
      if (!match?.[1]) return null
      path = match[1]
    } catch {
      return null
    }
  }

  path = path.replace(/^\/+/u, '').replace(/^id-documents\//u, '')
  if (!path.startsWith('id-verification/')) return null
  return path
}

async function createIdDocumentReviewUrl(
  supabase: SupabaseStorageSigner,
  value: string | null | undefined,
) {
  const path = idDocumentStoragePath(value)
  if (!path) return null

  const { data, error } = await supabase
    .storage
    .from(ID_DOCUMENT_BUCKET)
    .createSignedUrl(path, 7 * 24 * 60 * 60)

  if (error) {
    console.error('[notify-ops-verification] ID signed URL failed:', error.message)
    return null
  }
  return data?.signedUrl ?? null
}

function formatPrice(minor: number | null | undefined, currencyValue: string | null | undefined) {
  if (minor == null) return '—'
  const currency = normalizeAccountCurrency(currencyValue) ?? 'USD'
  return `${currencySymbol(currency)}${(minor / 100).toLocaleString('en', { maximumFractionDigits: 0 })}`
}

function getDecisionFunctionUrl() {
  const explicit = Deno.env.get('DECISION_FUNCTION_URL')
  if (explicit && explicit.trim().length > 0) return explicit.trim()

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL environment variable.')

  return `${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/handle-verification-decision`
}

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
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is an authenticated user — tailorId comes from the JWT,
    // not the request body, so a user cannot trigger notifications for another tailor.
    const caller = await getAuthUser(req)
    if (!caller) return jsonResponse({ error: 'Please sign in again before submitting verification for review.' }, 401, corsHeaders)

    const tailorId = caller.id

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Rate limit: 3 emails per hour per tailor (prevents ops inbox spam)
    const allowed = await checkRateLimit(supabase, `notify-ops-verification:${tailorId}`, 3600, 3)
    if (!allowed) {
      return rateLimitExceededResponse(corsHeaders)
    }

    // Fetch tailor profile
    const { data: profile, error } = await supabase
      .from('tailor_profiles')
      .select('display_name, location, bio, specialty_tags, portfolio_photo_urls, portfolio_video_urls, avatar_url, price_range_min, price_range_max, currency, id_document_url, id_verification_status, payout_account_verified, payout_reverification_required')
      .eq('user_id', tailorId)
      .single()

    if (error || !profile) {
      return jsonResponse({ error: 'Complete your tailor profile before submitting verification for review.' }, 404, corsHeaders)
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('phone')
      .eq('id', tailorId)
      .maybeSingle()

    if (userError) {
      console.error('[notify-ops-verification] user lookup failed:', userError.message)
      return jsonResponse({ error: 'We could not check your contact details right now. Please try again.' }, 500, corsHeaders)
    }

    const portfolioPhotoCount = Array.isArray(profile.portfolio_photo_urls) ? profile.portfolio_photo_urls.length : 0
    const portfolioVideoCount = Array.isArray(profile.portfolio_video_urls) ? profile.portfolio_video_urls.length : 0
    const specialtyCount = Array.isArray(profile.specialty_tags) ? profile.specialty_tags.length : 0
    const verificationPreflight = runPreflight([
      {
        name: 'verification_pending',
        condition: profile.id_verification_status === 'PENDING',
        errorCode: 'VERIFICATION_NOT_PENDING',
        message: 'This tailor verification is not pending review.',
        field: 'id_verification_status',
        severity: 'BLOCKING',
        actual: { status: profile.id_verification_status ?? null },
      },
      {
        name: 'display_name_present',
        condition: typeof profile.display_name === 'string' && profile.display_name.trim().length >= 2,
        errorCode: 'DISPLAY_NAME_REQUIRED',
        message: 'Add your public or business name before sending verification for review.',
        field: 'display_name',
        severity: 'BLOCKING',
      },
      {
        name: 'phone_present',
        condition: typeof userRow?.phone === 'string' && userRow.phone.trim().length >= 8,
        errorCode: 'PHONE_REQUIRED',
        message: 'Add a phone number before sending verification for review.',
        field: 'phone',
        severity: 'BLOCKING',
        actual: { hasPhone: typeof userRow?.phone === 'string' && userRow.phone.trim().length > 0 },
      },
      {
        name: 'profile_photo_present',
        condition: typeof profile.avatar_url === 'string' && profile.avatar_url.trim().length > 0,
        errorCode: 'PROFILE_PHOTO_REQUIRED',
        message: 'Add a profile photo before going live.',
        field: 'avatar_url',
        severity: 'WARNING',
      },
      {
        name: 'specialty_present',
        condition: specialtyCount > 0,
        errorCode: 'SPECIALTY_REQUIRED',
        message: 'Choose at least one specialty before sending verification for review.',
        field: 'specialty_tags',
        severity: 'BLOCKING',
        actual: { specialtyCount },
      },
      {
        name: 'portfolio_present',
        condition: portfolioPhotoCount + portfolioVideoCount > 0,
        errorCode: 'PORTFOLIO_REQUIRED',
        message: 'Add at least one portfolio photo or video before sending verification for review.',
        field: 'portfolio',
        severity: 'BLOCKING',
        actual: { portfolioPhotoCount, portfolioVideoCount },
      },
      {
        name: 'id_document_path_valid',
        condition: !!idDocumentStoragePath(profile.id_document_url),
        errorCode: 'ID_DOCUMENT_REQUIRED',
        message: 'Upload a supported ID document before sending verification for review.',
        field: 'id_document_url',
        severity: 'BLOCKING',
        actual: { hasIdDocument: typeof profile.id_document_url === 'string' && profile.id_document_url.trim().length > 0 },
      },
      {
        name: 'payout_ready_before_paid_work',
        condition: profile.payout_account_verified === true && profile.payout_reverification_required !== true,
        errorCode: 'PAYOUT_SETUP_REQUIRED',
        message: 'Set up a verified payout account before accepting paid orders.',
        field: 'payout_account_verified',
        severity: 'WARNING',
        actual: {
          payout_account_verified: profile.payout_account_verified ?? null,
          payout_reverification_required: profile.payout_reverification_required ?? null,
        },
      },
    ])

    if (!verificationPreflight.passed) {
      await logPreflightFailure(supabase, verificationPreflight, {
        operation: 'notify_ops_verification',
        entityType: 'tailor_profile',
        entityId: tailorId,
        actorId: caller.id,
        actorRole: 'TAILOR',
        userId: tailorId,
        source: 'notify-ops-verification',
      })
      return preflightFailureResponse(verificationPreflight, corsHeaders, 409)
    }

    const verificationSecret = Deno.env.get('VERIFICATION_SECRET')
    if (!verificationSecret) {
      console.error('[notify-ops-verification] VERIFICATION_SECRET env var not set')
      return jsonResponse({ error: 'Verification review is temporarily unavailable. Please try again later.' }, 500, corsHeaders)
    }

    // Tokens expire in 7 days — ops has a full week to act before needing a re-submit
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const approveToken = await signPayload(verificationSecret, `${tailorId}:APPROVE:${exp}`)
    const rejectToken  = await signPayload(verificationSecret, `${tailorId}:REJECT:${exp}`)

    const decisionBase = getDecisionFunctionUrl()
    const approveUrl = `${decisionBase}?tailorId=${tailorId}&decision=APPROVE&exp=${exp}&token=${approveToken}`
    const rejectUrl  = `${decisionBase}?tailorId=${tailorId}&decision=REJECT&exp=${exp}&token=${rejectToken}`

    const priceMin = formatPrice(profile.price_range_min, profile.currency)
    const priceMax = formatPrice(profile.price_range_max, profile.currency)
    const tags = (profile.specialty_tags ?? []).join(', ') || '—'
    const idDocumentReviewUrl = await createIdDocumentReviewUrl(supabase, profile.id_document_url)

    // Escape all profile fields before embedding in HTML — prevents ops email injection
    const html = `
<h2>New tailor verification request</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:6px 12px;color:#666">Name</td><td style="padding:6px 12px"><strong>${escapeHtml(profile.display_name)}</strong></td></tr>
  <tr><td style="padding:6px 12px;color:#666">Location</td><td style="padding:6px 12px">${escapeHtml(profile.location ?? '—')}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Specialties</td><td style="padding:6px 12px">${escapeHtml(tags)}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Price range</td><td style="padding:6px 12px">${priceMin} – ${priceMax}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Bio</td><td style="padding:6px 12px">${escapeHtml(profile.bio ?? '—')}</td></tr>
  ${profile.id_document_url ? `<tr><td style="padding:6px 12px;color:#666">ID document</td><td style="padding:6px 12px">${idDocumentReviewUrl ? `<a href="${escapeHtml(idDocumentReviewUrl)}">View uploaded ID</a>` : 'Uploaded, but review link could not be generated'}</td></tr>` : ''}
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
      return jsonResponse({ error: 'We could not notify the review team right now. Please try again.' }, 502, corsHeaders)
    }

    return jsonResponse({ ok: true }, 200, corsHeaders)
  } catch (err) {
    console.error('[notify-ops-verification]', err)
    return jsonResponse({ error: 'We could not submit verification for review right now. Please try again.' }, 500, corsHeaders)
  }
})
