import { escapeHtml } from './hmac.ts'

export const VERIFICATION_DECISIONS = ['APPROVE', 'REJECT'] as const
export type VerificationDecision = typeof VERIFICATION_DECISIONS[number]

export const VERIFICATION_STATUSES = {
  APPROVE: 'VERIFIED',
  REJECT: 'REJECTED',
} as const satisfies Record<VerificationDecision, string>

export const VERIFICATION_REJECTION_REASON_REQUIRED = 'REJECTION_REASON_REQUIRED'
export const DEFAULT_VERIFICATION_REJECTION_REASON =
  'We could not verify the submitted challenge video. Please record a clear retake with your face, voice, and full private phrase clearly captured.'
export const INVALID_PROFILE_IMAGE_REJECTION_CODE = 'INVALID_PROFILE_IMAGE'
export const PROFILE_IMAGE_REJECTION_REASON =
  'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.'
export const VERIFICATION_REJECTION_CODES = [INVALID_PROFILE_IMAGE_REJECTION_CODE] as const
export type VerificationRejectionCode = typeof VERIFICATION_REJECTION_CODES[number]
export const VERIFICATION_ISSUE_TYPE = 'TAILOR_VERIFICATION'
export const VERIFICATION_SOURCE_OPS_DASHBOARD = 'ops_dashboard'
export const VERIFICATION_SOURCE_SIGNED_LINK = 'signed_email_link'

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_APP_URL = 'https://drapeon.co'
const DEFAULT_EMAIL_FROM = 'Drape Verification <verify@drapeon.co>'

type DbError = { message?: string } | null

export type VerificationSupabaseClient = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: DbError }>
}

export type VerificationEmailMessage = {
  to: string
  subject: string
  html: string
}

export type VerificationEmailSender = (message: VerificationEmailMessage) => Promise<void>

export type VerificationPushMessage = {
  title: string
  body: string
  data?: Record<string, string>
  sound?: string
  channelId?: string
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical'
}

export type VerificationPushResult = {
  status: 'SENT' | 'SKIPPED' | 'ERROR'
  reason?: string
}

export type VerificationPushSender = (
  userId: string,
  message: VerificationPushMessage,
) => Promise<VerificationPushResult | void>

export type VerificationUserEmailLookup = (userId: string) => Promise<string | null>

export type VerificationDecisionRequest = {
  tailorUserId: string
  decision: string
  reason?: string | null
  rejectionCode?: string | null
  performedBy?: string | null
  performedRole?: string | null
  source?: string | null
}

export type VerificationDecisionResult =
  | {
      ok: true
      profileId: string
      displayName: string
      status: string
      emailSent: boolean
      emailError: string | null
      pushStatus: VerificationPushResult['status'] | null
      pushError: string | null
    }
  | {
      ok: false
      status: number
      code: string
      message: string
    }

function trim(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim().length > 0).length : 0
}

export function normalizeVerificationDecision(value: string | null | undefined): VerificationDecision | null {
  const normalized = trim(value).toUpperCase()
  return VERIFICATION_DECISIONS.includes(normalized as VerificationDecision)
    ? normalized as VerificationDecision
    : null
}

export function normalizeVerificationRejectionCode(value: string | null | undefined): VerificationRejectionCode | null {
  const normalized = trim(value).toUpperCase()
  return VERIFICATION_REJECTION_CODES.includes(normalized as VerificationRejectionCode)
    ? normalized as VerificationRejectionCode
    : null
}

export function resolveVerificationReason(
  decision: VerificationDecision,
  reason: string | null | undefined,
  rejectionCode?: VerificationRejectionCode | null,
) {
  const trimmed = trim(reason)
  if (decision === 'APPROVE') return trimmed || null
  if (rejectionCode === INVALID_PROFILE_IMAGE_REJECTION_CODE) return trimmed || PROFILE_IMAGE_REJECTION_REASON
  return trimmed || null
}

export function buildVerificationDecisionEmail(input: {
  displayName: string
  approved: boolean
  reason?: string | null
  rejectionCode?: VerificationRejectionCode | null
  appUrl?: string | null
}) {
  const appUrl = trim(input.appUrl) || DEFAULT_APP_URL
  const displayName = escapeHtml(input.displayName || 'there')
  const reason = trim(input.reason) || DEFAULT_VERIFICATION_REJECTION_REASON
  const recoveryCopy = input.rejectionCode === INVALID_PROFILE_IMAGE_REJECTION_CODE
    ? 'Please upload a replacement profile photo. You do not need to retake your trust video unless the review team asks for it.'
    : 'Please record the challenge again in good light and submit your profile when you are ready.'

  if (input.approved) {
    return {
      subject: 'Your Drapeon profile has been verified',
      html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="${escapeHtml(appUrl)}/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">Trust review approved</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">Your challenge video and tailor profile have been approved. Your storefront is now active on Drapeon.</p>
  <p style="color:#555;line-height:1.6">Paid orders and earnings release still require payout verification with the payment provider.</p>
  <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Drape</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd.</p>
</div>`,
    }
  }

  return {
    subject: 'Drapeon trust review - action needed',
    html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="${escapeHtml(appUrl)}/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">Trust video needs another look</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">We could not approve your Drapeon trust review yet.</p>
  <p style="color:#555;line-height:1.6"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
  <p style="color:#555;line-height:1.6">${escapeHtml(recoveryCopy)}</p>
  <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Drape</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd.</p>
</div>`,
  }
}

export function buildVerificationDecisionPush(input: {
  displayName: string
  approved: boolean
  status: string
  profileId: string
}) {
  const displayName = trim(input.displayName) || 'Your tailor profile'

  if (input.approved) {
    return {
      title: 'You are live on Drapeon',
      body: displayName + ' passed trust review. Customers can now discover your work.',
      data: {
        type: 'tailor_verification_decision',
        decision: 'APPROVE',
        status: input.status,
        profileId: input.profileId,
      },
      sound: 'default',
      channelId: 'account-updates',
      interruptionLevel: 'active' as const,
    }
  }

  return {
    title: 'Trust review update',
    body: 'Your challenge video needs one more update before your tailor profile can go live.',
    data: {
      type: 'tailor_verification_decision',
      decision: 'REJECT',
      status: input.status,
      profileId: input.profileId,
    },
    sound: 'default',
    channelId: 'account-updates',
    interruptionLevel: 'active' as const,
  }
}
export function createResendVerificationEmailSender(options?: {
  apiKey?: string | null
  from?: string | null
}): VerificationEmailSender {
  return async (message) => {
    const apiKey = trim(options?.apiKey) || Deno.env.get('RESEND_API_KEY')
    if (!apiKey) throw new Error('Missing RESEND_API_KEY')

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'drape-verification-decision/1.0',
      },
      body: JSON.stringify({
        from: trim(options?.from) || Deno.env.get('RESEND_FROM') || DEFAULT_EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Resend email failed with ${response.status}${body ? `: ${body}` : ''}`)
    }
  }
}

async function safeInsert(
  supabase: VerificationSupabaseClient,
  table: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from(table).insert(payload)
  return error?.message ?? null
}

async function syncApprovedPortfolioPhotoUrls(
  supabase: VerificationSupabaseClient,
  tailorProfileId: string,
) {
  try {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('image_url')
      .eq('tailor_profile_id', tailorProfileId)
      .order('sort_order', { ascending: true })

    if (error) return error.message ?? 'Portfolio item lookup failed.'

    const nextUrls = ((data ?? []) as Array<{ image_url?: string | null }>)
      .map((row) => row.image_url)
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)

    const { error: updateError } = await supabase
      .from('tailor_profiles')
      .update({ portfolio_photo_urls: nextUrls, updated_at: new Date().toISOString() })
      .eq('id', tailorProfileId)

    return updateError?.message ?? null
  } catch (error) {
    return error instanceof Error ? error.message : 'Portfolio photo sync failed.'
  }
}

export async function performVerificationDecision(
  supabase: VerificationSupabaseClient,
  input: VerificationDecisionRequest,
  options: {
    sendEmail: VerificationEmailSender
    sendPush?: VerificationPushSender
    lookupUserEmail?: VerificationUserEmailLookup
    appUrl?: string | null
    now?: () => Date
  },
): Promise<VerificationDecisionResult> {
  const tailorUserId = trim(input.tailorUserId)
  const decision = normalizeVerificationDecision(input.decision)
  const performedBy = trim(input.performedBy) || 'ops-session'
  const performedRole = trim(input.performedRole) || 'OPS'
  const source = trim(input.source) || VERIFICATION_SOURCE_OPS_DASHBOARD
  const rejectionCode = decision ? normalizeVerificationRejectionCode(input.rejectionCode) : null
  const reason = decision ? resolveVerificationReason(decision, input.reason, rejectionCode) : null

  if (!tailorUserId || !decision) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_VERIFICATION_DECISION',
      message: 'Verification decision request is incomplete.',
    }
  }

  if (decision === 'REJECT' && !reason) {
    return {
      ok: false,
      status: 400,
      code: VERIFICATION_REJECTION_REASON_REQUIRED,
      message: 'A rejection reason is required.',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('tailor_profiles')
    .select('id, user_id, display_name, id_verification_status, trust_verification_video_path, trust_verification_challenge_id, trust_verification_challenge_text, avatar_url, specialty_tags, portfolio_photo_urls, portfolio_video_urls')
    .eq('user_id', tailorUserId)
    .maybeSingle()

  if (profileError) {
    return {
      ok: false,
      status: 500,
      code: 'PROFILE_LOOKUP_FAILED',
      message: profileError.message ?? 'Could not load tailor profile.',
    }
  }

  if (!profile?.id) {
    return {
      ok: false,
      status: 404,
      code: 'TAILOR_PROFILE_NOT_FOUND',
      message: 'Tailor profile not found.',
    }
  }

  if (profile.id_verification_status !== 'PENDING') {
    return {
      ok: false,
      status: 409,
      code: 'VERIFICATION_ALREADY_PROCESSED',
      message: 'Tailor verification is no longer pending.',
    }
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('email, display_name, phone')
    .eq('id', tailorUserId)
    .maybeSingle()

  if (userError) {
    return {
      ok: false,
      status: 500,
      code: 'USER_LOOKUP_FAILED',
      message: userError.message ?? 'Could not load tailor user.',
    }
  }

  if (decision === 'APPROVE') {
    const missing: string[] = []
    if (!trim(profile.display_name)) missing.push('display_name')
    if (!trim(user?.phone)) missing.push('phone')
    if (!trim(profile.avatar_url)) missing.push('profile_photo')
    if (!trim(profile.trust_verification_video_path) || !trim(profile.trust_verification_video_path).startsWith('verification-video/')) missing.push('challenge_video')
    if (!trim(profile.trust_verification_challenge_id)) missing.push('challenge_id')
    if (!trim(profile.trust_verification_challenge_text)) missing.push('challenge_prompt')
    if (arrayCount(profile.specialty_tags) < 1) missing.push('specialties')
    if (arrayCount(profile.portfolio_photo_urls) + arrayCount(profile.portfolio_video_urls) < 1) missing.push('portfolio')
    if (missing.length > 0) {
      return {
        ok: false,
        status: 409,
        code: 'TAILOR_GO_LIVE_PREFLIGHT_FAILED',
        message: `Tailor cannot go live yet. Missing: ${missing.join(', ')}.`,
      }
    }
  }

  const verificationRpcArgs: Record<string, unknown> = {
    p_tailor_user_id: tailorUserId,
    p_decision: decision,
    p_reason: reason,
  }
  if (rejectionCode) verificationRpcArgs.p_rejection_code = rejectionCode

  const { data: rpcData, error: rpcError } = await supabase.rpc('ops_decide_verification', verificationRpcArgs)

  if (rpcError) {
    return {
      ok: false,
      status: rpcError.message?.includes('no longer pending') ? 409 : 500,
      code: rpcError.message?.includes('no longer pending') ? 'VERIFICATION_ALREADY_PROCESSED' : 'VERIFICATION_UPDATE_FAILED',
      message: rpcError.message ?? 'Could not update verification status.',
    }
  }

  const decisionRow = Array.isArray(rpcData) ? rpcData[0] : null
  const profileId =
    decisionRow && typeof decisionRow === 'object' && 'profile_id' in decisionRow
      ? String(decisionRow.profile_id)
      : String(profile.id)
  const status =
    decisionRow && typeof decisionRow === 'object' && 'status' in decisionRow
      ? String(decisionRow.status)
      : VERIFICATION_STATUSES[decision]

  let portfolioSyncError: string | null = null
  if (decision === 'APPROVE') {
    await supabase
      .from('media_assets')
      .update({ moderation_status: 'AUTO_ALLOWED', status: 'ACTIVE' })
      .eq('owner_user_id', tailorUserId)
      .eq('moderation_status', 'PENDING')
    portfolioSyncError = await syncApprovedPortfolioPhotoUrls(supabase, profileId)
  }

  const { data: verificationIssue } = await supabase
    .from('ops_issues')
    .select('id, status, assigned_to, resolved_at')
    .eq('issue_type', VERIFICATION_ISSUE_TYPE)
    .eq('user_id', tailorUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (verificationIssue?.id) {
    const resolvedAt = (options.now?.() ?? new Date()).toISOString()
    const issueUpdate: Record<string, unknown> = {
      status: 'RESOLVED',
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    }
    if (profileId) issueUpdate.tailor_profile_id = profileId

    await supabase
      .from('ops_issues')
      .update(issueUpdate)
      .eq('id', verificationIssue.id)

    await safeInsert(supabase, 'ops_audit_logs', {
      issue_id: verificationIssue.id,
      action_taken: decision === 'APPROVE' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
      performed_by: performedBy,
      performed_role: performedRole.toUpperCase(),
      reason,
      before_state: {
        status: verificationIssue.status,
        assigned_to: verificationIssue.assigned_to ?? null,
        resolved_at: verificationIssue.resolved_at ?? null,
      },
      after_state: {
        status: 'RESOLVED',
        assigned_to: performedBy,
        resolved_at: resolvedAt,
        decision,
        rejection_code: rejectionCode,
      },
    })
  }

  let emailSent = false
  let emailError: string | null = null
  let email = typeof user?.email === 'string' ? user.email.trim() : ''
  const displayName = user?.display_name ?? profile.display_name ?? 'there'

  if (!email && options.lookupUserEmail) {
    try {
      email = await options.lookupUserEmail(tailorUserId) ?? ''
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Auth email lookup failed.'
    }
  }

  if (email) {
    try {
      const message = buildVerificationDecisionEmail({
        displayName,
        approved: decision === 'APPROVE',
        reason,
        rejectionCode,
        appUrl: options.appUrl,
      })
      await options.sendEmail({ to: email, ...message })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Email send failed.'
    }
  } else {
    emailError = emailError ?? 'Tailor user has no email address.'
  }

  let pushStatus: VerificationPushResult['status'] | null = null
  let pushError: string | null = null
  if (options.sendPush) {
    try {
      const pushResult = await options.sendPush(tailorUserId, buildVerificationDecisionPush({
        displayName,
        approved: decision === 'APPROVE',
        status,
        profileId,
      }))
      pushStatus = pushResult?.status ?? 'SENT'
      pushError = pushResult && pushResult.status !== 'SENT' ? pushResult.reason ?? pushResult.status : null
    } catch (error) {
      pushStatus = 'ERROR'
      pushError = error instanceof Error ? error.message : 'Push send failed.'
    }
  } else {
    pushStatus = 'SKIPPED'
    pushError = 'Push sender not configured.'
  }

  await safeInsert(supabase, 'audit_logs', {
    actor_role: 'OPS',
    event: 'ops.verification_decision_logged',
    severity: decision === 'APPROVE' ? 'info' : 'warn',
    payload: {
      tailor_user_id: tailorUserId,
      tailor_profile_id: profileId,
      decision,
      status,
      reason,
      rejection_code: rejectionCode,
      performed_by: performedBy,
      performed_role: performedRole,
      source,
      email_sent: emailSent,
      email_error: emailError,
      push_status: pushStatus,
      push_error: pushError,
      portfolio_sync_error: portfolioSyncError,
    },
  })

  return {
    ok: true,
    profileId,
    displayName,
    status,
    emailSent,
    emailError,
    pushStatus,
    pushError,
  }
}
