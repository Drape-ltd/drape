/**
 * notify-ops-verification
 *
 * Called by the mobile app immediately after a tailor submits their profile
 * with id_verification_status = 'PENDING'. Sends an ops review email via Resend
 * containing one-click approve / reject links.
 *
 * Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
 *   RESEND_API_KEY   – Resend API key
 *   RESEND_FROM      – optional verified sender (e.g. Drapeon Verification <verify@drapeon.co>)
 *   OPS_NOTIFICATION_EMAILS – comma-separated review recipients
 *   OPS_EMAIL        – fallback review recipient (e.g. ops@drapeon.co)
 *   SUPABASE_URL     – injected automatically by Supabase runtime
 *   SUPABASE_ANON_KEY – injected automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY – injected automatically
 *   DECISION_FUNCTION_URL – optional public URL of the handle-verification-decision function
 *                           (defaults to https://<project-ref>.supabase.co/functions/v1/handle-verification-decision)
 *   OPS_DASHBOARD_URL – optional direct URL for the ops verification dashboard
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { signPayload, escapeHtml } from '../_shared/hmac.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { audit } from '../_shared/logger.ts'
import { getOpsNotificationFrom, getOpsRecipients } from '../_shared/ops-notifications.ts'
import {
  logPreflightFailure,
  preflightFailureResponse,
  runPreflight,
} from '../_shared/preflight.ts'
import {
  currencySymbol,
  normalizeAccountCurrency,
} from '../../../packages/shared/src/currency-config.ts'
import {
  buildOpsVerificationEvidenceSummary,
  type OpsVerificationProofItemEvidence,
} from '../../../packages/shared/src/ops-verification-evidence.ts'

const TRUST_VIDEO_BUCKET = 'trust-verification'

type SupabaseStorageSigner = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number
      ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
    }
  }
}

function trustVideoStoragePath(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null

  let path = trimmed
  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const decodedPath = decodeURIComponent(url.pathname)
      const match = decodedPath.match(
        /\/storage\/v1\/object\/(?:public\/|sign\/)?trust-verification\/(.+)$/u
      )
      if (!match?.[1]) return null
      path = match[1]
    } catch {
      return null
    }
  }

  path = path.replace(/^\/+/u, '').replace(/^trust-verification\//u, '')
  if (!path.startsWith('verification-video/')) return null
  return path
}

async function createTrustVideoReviewUrl(
  supabase: SupabaseStorageSigner,
  value: string | null | undefined
) {
  const path = trustVideoStoragePath(value)
  if (!path) return null

  const { data, error } = await supabase.storage
    .from(TRUST_VIDEO_BUCKET)
    .createSignedUrl(path, 7 * 24 * 60 * 60)

  if (error) {
    console.error('[notify-ops-verification] trust video signed URL failed:', error.message)
    return null
  }
  return data?.signedUrl ?? null
}

function safePublicReviewUrl(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function formatPrice(minor: number | null | undefined, currencyValue: string | null | undefined) {
  if (minor == null) return '—'
  const currency = normalizeAccountCurrency(currencyValue) ?? 'USD'
  return `${currencySymbol(currency)}${(minor / 100).toLocaleString('en', { maximumFractionDigits: 0 })}`
}

type SellerItemProofRow = {
  id: string
  title: string
  description: string | null
  category: string | null
  sizes: string[] | null
  photo_urls: string[] | null
  is_live: boolean
  stock_status: string | null
  inventory_quantity?: number | null
  created_at: string
  updated_at: string
}

function cleanEvidenceUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter((url) => url.length > 0)
}

function publicReviewUrls(values: string[]) {
  return values
    .map((url) => safePublicReviewUrl(url))
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
}

function isVerificationProofItem(item: SellerItemProofRow) {
  return item.is_live === false || item.stock_status === 'HIDDEN'
}

function proofItemEvidence(item: SellerItemProofRow): OpsVerificationProofItemEvidence {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    description: item.description,
    mediaUrls: cleanEvidenceUrls(item.photo_urls),
    isLive: item.is_live,
    stockStatus: item.stock_status,
    inventoryQuantity: typeof item.inventory_quantity === 'number' ? item.inventory_quantity : 0,
    sizes: Array.isArray(item.sizes)
      ? item.sizes.filter(
          (size): size is string => typeof size === 'string' && size.trim().length > 0
        )
      : [],
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

function renderEvidenceChecklist(summary: ReturnType<typeof buildOpsVerificationEvidenceSummary>) {
  return summary.checklist
    .map(
      (item) =>
        '<tr>' +
        '<td style="padding:6px 12px;color:#666">' +
        escapeHtml(item.label) +
        '</td>' +
        '<td style="padding:6px 12px"><strong>' +
        (item.ready ? 'Ready' : 'Missing') +
        '</strong><br>' +
        '<span style="color:#777;font-size:12px">' +
        escapeHtml(item.detail) +
        '</span></td>' +
        '</tr>'
    )
    .join('')
}

function renderLinkList(title: string, urls: string[]) {
  if (urls.length === 0) return ''
  return (
    '<p style="margin:14px 0 6px;color:#666;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">' +
    escapeHtml(title) +
    '</p>' +
    '<ul style="margin:0 0 12px;padding-left:18px;font-family:sans-serif;font-size:13px;line-height:1.7">' +
    urls
      .slice(0, 6)
      .map(
        (url, index) =>
          '<li><a href="' +
          escapeHtml(url) +
          '">' +
          escapeHtml(title) +
          ' ' +
          (index + 1) +
          '</a></li>'
      )
      .join('') +
    '</ul>'
  )
}

function renderProofItems(items: OpsVerificationProofItemEvidence[]) {
  if (items.length === 0)
    return '<p style="font-family:sans-serif;color:#777;font-size:13px">No hidden proof item was found for this review.</p>'
  return items
    .map((item) => {
      const mediaLinks = publicReviewUrls(item.mediaUrls)
      return (
        '<div style="border:1px solid #ddd;border-radius:14px;padding:12px;margin:10px 0;font-family:sans-serif">' +
        '<p style="margin:0;font-weight:700;color:#222">' +
        escapeHtml(item.title) +
        '</p>' +
        '<p style="margin:4px 0 8px;color:#666;font-size:13px">' +
        escapeHtml(item.category ?? 'Uncategorized') +
        ' / ' +
        escapeHtml(item.stockStatus ?? 'Hidden') +
        ' / Stock ' +
        item.inventoryQuantity +
        '</p>' +
        (item.description
          ? '<p style="margin:0 0 8px;color:#555;font-size:13px;line-height:1.5">' +
            escapeHtml(item.description) +
            '</p>'
          : '') +
        (item.sizes.length > 0
          ? '<p style="margin:0 0 8px;color:#666;font-size:12px">Sizes: ' +
            escapeHtml(item.sizes.join(', ')) +
            '</p>'
          : '') +
        renderLinkList('Proof media', mediaLinks) +
        '</div>'
      )
    })
    .join('')
}

function getOpsDashboardUrl() {
  const explicit = Deno.env.get('OPS_DASHBOARD_URL')?.trim()
  const candidate =
    explicit && explicit.length > 0
      ? explicit
      : 'https://drapeon.co/ops?view=verification#verification'
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
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

function isServiceRoleRequest(req: Request) {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const authorization = req.headers.get('Authorization')?.trim()
  const apiKey = req.headers.get('apikey')?.trim()
  return (
    !!serviceRoleKey && (authorization === `Bearer ${serviceRoleKey}` || apiKey === serviceRoleKey)
  )
}

async function readNotifyBody(
  req: Request
): Promise<{ tailorId?: unknown; deliveryKey?: unknown }> {
  try {
    const raw = await req.json()
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { tailorId?: unknown; deliveryKey?: unknown })
      : {}
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await readNotifyBody(req)
    const internalServiceCall = isServiceRoleRequest(req)

    // User calls derive tailorId from the JWT. Internal handoff worker calls are
    // allowed to pass tailorId only when signed with the service-role secret.
    const caller = internalServiceCall ? null : await getAuthUser(req)
    if (!internalServiceCall && !caller) {
      return jsonResponse(
        { error: 'Please sign in again before submitting verification for review.' },
        401,
        corsHeaders
      )
    }

    const requestedTailorId = typeof body.tailorId === 'string' ? body.tailorId.trim() : ''
    if (internalServiceCall && requestedTailorId.length === 0) {
      return jsonResponse(
        { error: 'Missing tailor profile for internal verification notification.' },
        400,
        corsHeaders
      )
    }

    const tailorId = internalServiceCall ? requestedTailorId : caller!.id
    const actorId = caller?.id ?? tailorId
    const actorRole = internalServiceCall ? 'SYSTEM' : 'TAILOR'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // User-triggered retries remain rate-limited. Internal delivery is already
    // deduplicated and retried by the durable job queue.
    if (!internalServiceCall) {
      const allowed = await checkRateLimit(supabase, `notify-ops-verification:${tailorId}`, 3600, 3)
      if (!allowed) {
        return rateLimitExceededResponse(corsHeaders)
      }
    }

    // Fetch tailor profile
    const { data: profile, error } = await supabase
      .from('tailor_profiles')
      .select(
        'id, display_name, location, bio, specialty_tags, portfolio_photo_urls, portfolio_video_urls, avatar_url, price_range_min, price_range_max, currency, trust_verification_video_path, trust_verification_challenge_id, trust_verification_challenge_text, id_verification_status, payout_account_verified, payout_reverification_required, paystack_recipient_code, stripe_connect_account_id, manual_bank_entry, manual_bank_verification_status'
      )
      .eq('user_id', tailorId)
      .single()

    if (error || !profile) {
      return jsonResponse(
        { error: 'Complete your tailor profile before submitting verification for review.' },
        404,
        corsHeaders
      )
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('phone')
      .eq('id', tailorId)
      .maybeSingle()

    if (userError) {
      console.error('[notify-ops-verification] user lookup failed:', userError.message)
      return jsonResponse(
        { error: 'We could not check your contact details right now. Please try again.' },
        500,
        corsHeaders
      )
    }

    const { data: proofRows, error: proofError } = await supabase
      .from('seller_items')
      .select(
        'id, title, description, category, sizes, photo_urls, is_live, stock_status, inventory_quantity, created_at, updated_at'
      )
      .eq('tailor_profile_id', profile.id)
      .order('updated_at', { ascending: false })
      .limit(4)

    if (proofError) {
      console.error('[notify-ops-verification] proof item lookup failed:', proofError.message)
    }

    const proofItems = ((proofRows ?? []) as SellerItemProofRow[])
      .filter(isVerificationProofItem)
      .map(proofItemEvidence)

    const portfolioPhotoUrls = cleanEvidenceUrls(profile.portfolio_photo_urls)
    const portfolioVideoUrls = cleanEvidenceUrls(profile.portfolio_video_urls)
    const portfolioPhotoCount = portfolioPhotoUrls.length
    const portfolioVideoCount = portfolioVideoUrls.length
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
        condition:
          typeof profile.display_name === 'string' && profile.display_name.trim().length >= 2,
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
        message:
          'Add at least one portfolio photo or video before sending verification for review.',
        field: 'portfolio',
        severity: 'BLOCKING',
        actual: { portfolioPhotoCount, portfolioVideoCount },
      },
      {
        name: 'trust_challenge_video_path_valid',
        condition:
          !!trustVideoStoragePath(profile.trust_verification_video_path) &&
          typeof profile.trust_verification_challenge_id === 'string' &&
          profile.trust_verification_challenge_id.trim().length > 0 &&
          typeof profile.trust_verification_challenge_text === 'string' &&
          profile.trust_verification_challenge_text.trim().length > 0,
        errorCode: 'TRUST_VIDEO_REQUIRED',
        message:
          'Record the short private challenge video before sending trust verification for review.',
        field: 'trust_verification_video_path',
        severity: 'BLOCKING',
        actual: {
          hasTrustVideo:
            typeof profile.trust_verification_video_path === 'string' &&
            profile.trust_verification_video_path.trim().length > 0,
          hasChallenge:
            typeof profile.trust_verification_challenge_id === 'string' &&
            profile.trust_verification_challenge_id.trim().length > 0,
        },
      },
      {
        name: 'payout_ready_before_paid_work',
        condition:
          profile.payout_account_verified === true &&
          profile.payout_reverification_required !== true &&
          ((typeof profile.paystack_recipient_code === 'string' &&
            profile.paystack_recipient_code.trim().length > 0) ||
            (typeof profile.stripe_connect_account_id === 'string' &&
              profile.stripe_connect_account_id.trim().length > 0) ||
            (profile.manual_bank_entry === true &&
              ['VERIFIED', 'APPROVED'].includes(
                String(profile.manual_bank_verification_status ?? '').toUpperCase()
              ))),
        errorCode: 'PAYOUT_SETUP_REQUIRED',
        message:
          'Payout is not verified yet. Keep paid quotes, live shop publishing, checkout, and earnings release paused until payout setup is complete.',
        field: 'payout_account_verified',
        severity: 'WARNING',
        actual: {
          payout_account_verified: profile.payout_account_verified ?? null,
          payout_reverification_required: profile.payout_reverification_required ?? null,
          has_paystack_recipient:
            typeof profile.paystack_recipient_code === 'string' &&
            profile.paystack_recipient_code.trim().length > 0,
          has_stripe_connect:
            typeof profile.stripe_connect_account_id === 'string' &&
            profile.stripe_connect_account_id.trim().length > 0,
        },
      },
    ])

    if (!verificationPreflight.passed) {
      await logPreflightFailure(supabase, verificationPreflight, {
        operation: 'notify_ops_verification',
        entityType: 'tailor_profile',
        entityId: tailorId,
        actorId,
        actorRole,
        userId: tailorId,
        source: 'notify-ops-verification',
      })
      return preflightFailureResponse(verificationPreflight, corsHeaders, 409)
    }

    const verificationSecret = Deno.env.get('VERIFICATION_SECRET')
    if (!verificationSecret) {
      console.error('[notify-ops-verification] VERIFICATION_SECRET env var not set')
      return jsonResponse(
        { error: 'Verification review is temporarily unavailable. Please try again later.' },
        500,
        corsHeaders
      )
    }

    // Tokens expire in 7 days — ops has a full week to act before needing a re-submit
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const approveToken = await signPayload(verificationSecret, `${tailorId}:APPROVE:${exp}`)
    const rejectToken = await signPayload(verificationSecret, `${tailorId}:REJECT:${exp}`)

    const decisionBase = getDecisionFunctionUrl()
    const approveUrl = `${decisionBase}?tailorId=${tailorId}&decision=APPROVE&exp=${exp}&token=${approveToken}`
    const rejectUrl = `${decisionBase}?tailorId=${tailorId}&decision=REJECT&exp=${exp}&token=${rejectToken}`

    const priceMin = formatPrice(profile.price_range_min, profile.currency)
    const priceMax = formatPrice(profile.price_range_max, profile.currency)
    const tags = (profile.specialty_tags ?? []).join(', ') || '—'
    const trustVideoPath = profile.trust_verification_video_path
    const trustVideoReviewUrl = await createTrustVideoReviewUrl(supabase, trustVideoPath)
    const avatarReviewUrl = safePublicReviewUrl(profile.avatar_url)
    const portfolioReviewUrls = publicReviewUrls([...portfolioPhotoUrls, ...portfolioVideoUrls])
    const proofMediaReviewUrls = publicReviewUrls(proofItems.flatMap((item) => item.mediaUrls))
    const opsDashboardUrl = getOpsDashboardUrl()
    const evidenceSummary = buildOpsVerificationEvidenceSummary({
      avatarUrl: avatarReviewUrl,
      trustVideoUrl: trustVideoReviewUrl,
      portfolioPhotoUrls,
      portfolioVideoUrls,
      proofItems,
    })

    // Escape all profile fields before embedding in HTML — prevents ops email injection
    const html = `
<h2>New tailor verification request</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:6px 12px;color:#666">Name</td><td style="padding:6px 12px"><strong>${escapeHtml(profile.display_name)}</strong></td></tr>
  <tr><td style="padding:6px 12px;color:#666">Location</td><td style="padding:6px 12px">${escapeHtml(profile.location ?? '—')}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Specialties</td><td style="padding:6px 12px">${escapeHtml(tags)}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Price range</td><td style="padding:6px 12px">${priceMin} – ${priceMax}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Bio</td><td style="padding:6px 12px">${escapeHtml(profile.bio ?? '—')}</td></tr>
  ${trustVideoPath ? `<tr><td style="padding:6px 12px;color:#666">Private challenge video</td><td style="padding:6px 12px">${trustVideoReviewUrl ? `<a href="${escapeHtml(trustVideoReviewUrl)}">Review challenge video</a>` : 'Uploaded, but review link could not be generated'}</td></tr>` : ''}
  <tr><td style="padding:6px 12px;color:#666">Challenge</td><td style="padding:6px 12px">${escapeHtml(profile.trust_verification_challenge_text ?? '—')}</td></tr>
</table>

<div style="display:flex;gap:16px;align-items:flex-start;margin-top:18px;font-family:sans-serif">
  <div style="width:180px">
    <p style="margin:0 0 8px;color:#666;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Public avatar</p>
    ${avatarReviewUrl ? `<a href="${escapeHtml(avatarReviewUrl)}"><img src="${escapeHtml(avatarReviewUrl)}" alt="Public avatar" width="160" height="160" style="display:block;border-radius:16px;object-fit:cover;border:1px solid #ddd" /></a><p style="margin:8px 0 0;font-size:12px"><a href="${escapeHtml(avatarReviewUrl)}">Open public avatar</a></p>` : '<div style="width:160px;height:160px;border-radius:16px;border:1px solid #ddd;background:#f5f1eb;display:flex;align-items:center;justify-content:center;color:#777;font-size:12px;text-align:center">No avatar URL</div>'}
  </div>
  <div style="width:220px">
    <p style="margin:0 0 8px;color:#666;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Private challenge video</p>
    <div style="border-radius:16px;border:1px solid #ddd;background:#f5f1eb;padding:16px;color:#555;font-size:13px;line-height:1.5">
      ${trustVideoReviewUrl ? `<a href="${escapeHtml(trustVideoReviewUrl)}">Open signed private video</a>` : 'Uploaded, but signed review link could not be generated.'}
      <p style="margin:10px 0 0"><strong>Prompt:</strong> ${escapeHtml(profile.trust_verification_challenge_text ?? 'Unavailable')}</p>
      <p style="margin:10px 0 0;color:#777">Drapeon does not collect a government ID for this review.</p>
    </div>
  </div>
</div>

<div style="margin-top:20px;font-family:sans-serif">
  <h3 style="margin:0 0 8px;color:#222">Review evidence</h3>
  <p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.5">${evidenceSummary.readyCount}/4 evidence checks ready. Missing: ${escapeHtml(evidenceSummary.missingLabels.length > 0 ? evidenceSummary.missingLabels.join(', ') : 'none')}.</p>
  ${opsDashboardUrl ? `<p style="margin:0 0 14px"><a href="${escapeHtml(opsDashboardUrl)}">Open full ops verification dashboard</a></p>` : ''}
  <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
    ${renderEvidenceChecklist(evidenceSummary)}
  </table>
  ${renderLinkList('Portfolio media', portfolioReviewUrls)}
  <p style="margin:14px 0 6px;color:#666;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Onboarding proof items</p>
  ${renderProofItems(proofItems)}
  ${renderLinkList('All proof media', proofMediaReviewUrls)}
</div>

<br>
<a href="${escapeHtml(approveUrl)}" style="background:#2F6844;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin-right:12px">Approve</a>
<a href="${escapeHtml(rejectUrl)}"  style="background:#B91C1C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reject</a>

<p style="color:#999;font-size:12px;margin-top:24px">Expires: ${new Date(exp * 1000).toUTCString()}</p>
`

    const recipients = getOpsRecipients()
    const requestedDeliveryKey = typeof body.deliveryKey === 'string' ? body.deliveryKey.trim() : ''
    const deliveryKey =
      requestedDeliveryKey.length > 0
        ? requestedDeliveryKey.slice(0, 180)
        : `tailor-verification-${tailorId}-${profile.trust_verification_challenge_id ?? 'review'}`
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'User-Agent': 'drape-notify-ops-verification/1.0',
        'Idempotency-Key': `drape-${deliveryKey}`,
      },
      body: JSON.stringify({
        from: getOpsNotificationFrom(),
        to: recipients,
        subject: `Verification request: ${profile.display_name}`,
        html,
      }),
    })

    if (!resendRes.ok) {
      console.error('[notify-ops-verification] Resend error', {
        status: resendRes.status,
        contentType: resendRes.headers.get('content-type'),
      })
      return jsonResponse(
        { error: 'We could not notify the review team right now. Please try again.' },
        502,
        corsHeaders
      )
    }

    const resendPayload = (await resendRes.json().catch(() => ({}))) as { id?: unknown }
    const deliveryId = typeof resendPayload.id === 'string' ? resendPayload.id : null
    await audit(supabase, {
      event: 'ops.verification_notification_sent',
      actor_id: actorId,
      actor_role: actorRole,
      severity: 'info',
      payload: {
        tailor_user_id: tailorId,
        tailor_profile_id: profile.id,
        delivery_id: deliveryId,
        delivery_key: deliveryKey,
        recipient_count: recipients.length,
      },
    })

    return jsonResponse(
      {
        ok: true,
        deliveryId,
        recipientCount: recipients.length,
      },
      200,
      corsHeaders
    )
  } catch (err) {
    console.error('[notify-ops-verification]', err)
    return jsonResponse(
      { error: 'We could not submit verification for review right now. Please try again.' },
      500,
      corsHeaders
    )
  }
})
