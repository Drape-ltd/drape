import { escapeHtml } from './hmac.ts'

export const VERIFICATION_DECISIONS = ['APPROVE', 'REJECT'] as const
export type VerificationDecision = typeof VERIFICATION_DECISIONS[number]

export const VERIFICATION_STATUSES = {
  APPROVE: 'VERIFIED',
  REJECT: 'REJECTED',
} as const satisfies Record<VerificationDecision, string>

export const VERIFICATION_REJECTION_REASON_REQUIRED = 'REJECTION_REASON_REQUIRED'
export const DEFAULT_VERIFICATION_REJECTION_REASON =
  'We could not verify the submitted ID document. Please upload a clear photo of a valid government-issued ID and submit again.'
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

export type VerificationDecisionRequest = {
  tailorUserId: string
  decision: string
  reason?: string | null
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

export function resolveVerificationReason(decision: VerificationDecision, reason: string | null | undefined) {
  const trimmed = trim(reason)
  if (decision === 'APPROVE') return trimmed || null
  return trimmed || null
}

export function buildVerificationDecisionEmail(input: {
  displayName: string
  approved: boolean
  reason?: string | null
  appUrl?: string | null
}) {
  const appUrl = trim(input.appUrl) || DEFAULT_APP_URL
  const displayName = escapeHtml(input.displayName || 'there')
  const reason = trim(input.reason) || DEFAULT_VERIFICATION_REJECTION_REASON

  if (input.approved) {
    return {
      subject: 'Your ID has been verified - Drape',
      html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="${escapeHtml(appUrl)}/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">ID verification approved</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">Your ID has been verified. Your tailor account is now active on Drape.</p>
  <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Drape</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd.</p>
</div>`,
    }
  }

  return {
    subject: 'ID verification - action needed',
    html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="${escapeHtml(appUrl)}/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">ID verification needs another look</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">We could not approve your ID verification yet.</p>
  <p style="color:#555;line-height:1.6"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
  <p style="color:#555;line-height:1.6">Please update your ID document and submit your profile again when you are ready.</p>
  <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Drape</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd.</p>
</div>`,
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

export async function performVerificationDecision(
  supabase: VerificationSupabaseClient,
  input: VerificationDecisionRequest,
  options: {
    sendEmail: VerificationEmailSender
    appUrl?: string | null
    now?: () => Date
  },
): Promise<VerificationDecisionResult> {
  const tailorUserId = trim(input.tailorUserId)
  const decision = normalizeVerificationDecision(input.decision)
  const performedBy = trim(input.performedBy) || 'ops-session'
  const performedRole = trim(input.performedRole) || 'OPS'
  const source = trim(input.source) || VERIFICATION_SOURCE_OPS_DASHBOARD
  const reason = decision ? resolveVerificationReason(decision, input.reason) : null

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
    .select('id, user_id, display_name, id_verification_status, avatar_url, specialty_tags, portfolio_photo_urls, portfolio_video_urls, payout_account_verified, payout_reverification_required, paystack_recipient_code, stripe_connect_account_id')
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
    if (arrayCount(profile.specialty_tags) < 1) missing.push('specialties')
    if (arrayCount(profile.portfolio_photo_urls) + arrayCount(profile.portfolio_video_urls) < 1) missing.push('portfolio')
    if (profile.payout_account_verified !== true || profile.payout_reverification_required === true) missing.push('verified_payout_account')
    if (!trim(profile.paystack_recipient_code) && !trim(profile.stripe_connect_account_id)) missing.push('payout_destination')

    if (missing.length > 0) {
      return {
        ok: false,
        status: 409,
        code: 'TAILOR_GO_LIVE_PREFLIGHT_FAILED',
        message: `Tailor cannot go live yet. Missing: ${missing.join(', ')}.`,
      }
    }
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('ops_decide_verification', {
    p_tailor_user_id: tailorUserId,
    p_decision: decision,
  })

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
      },
    })
  }

  let emailSent = false
  let emailError: string | null = null
  const email = typeof user?.email === 'string' ? user.email.trim() : ''
  const displayName = user?.display_name ?? profile.display_name ?? 'there'

  if (email) {
    try {
      const message = buildVerificationDecisionEmail({
        displayName,
        approved: decision === 'APPROVE',
        reason,
        appUrl: options.appUrl,
      })
      await options.sendEmail({ to: email, ...message })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Email send failed.'
    }
  } else {
    emailError = 'Tailor user has no email address.'
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
      performed_by: performedBy,
      performed_role: performedRole,
      source,
      email_sent: emailSent,
      email_error: emailError,
    },
  })

  return {
    ok: true,
    profileId,
    displayName,
    status,
    emailSent,
    emailError,
  }
}
