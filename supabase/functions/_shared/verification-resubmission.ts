import { createOrRefreshOpsIssue } from './ops-issues.ts'

export const INVALID_PORTFOLIO_MEDIA_REJECTION_CODE = 'INVALID_PORTFOLIO_MEDIA'

function readRejectionCode(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== 'object') return ''
  const direct = metadata.rejection_code
  if (typeof direct === 'string') return direct.trim().toUpperCase()
  const nested = metadata.identity_verification
  if (nested && typeof nested === 'object') {
    const code = (nested as Record<string, unknown>).rejection_code
    if (typeof code === 'string') return code.trim().toUpperCase()
  }
  return ''
}

function hasRetainedPrivateVideo(path: unknown) {
  return typeof path === 'string'
    && path.startsWith('verification-video/')
    && /\/challenge_[^/]+\.(mp4|mov|webm)$/iu.test(path)
}

export async function resubmitPortfolioVerificationIfNeeded(
  supabase: any,
  callerId: string,
  source: string,
) {
  const { data: profile, error: profileError } = await supabase
    .from('tailor_profiles')
    .select('id, display_name, location, specialty_tags, avatar_url, trust_verification_video_path, id_verification_status, id_verification_metadata, payout_account_verified, payout_currency')
    .eq('user_id', callerId)
    .maybeSingle()

  if (profileError) throw profileError
  if (
    !profile?.id
    || profile.id_verification_status !== 'REJECTED'
    || readRejectionCode(profile.id_verification_metadata) !== INVALID_PORTFOLIO_MEDIA_REJECTION_CODE
    || !hasRetainedPrivateVideo(profile.trust_verification_video_path)
  ) return false

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('tailor_profiles')
    .update({
      id_verification_status: 'PENDING',
      id_verification_submitted_at: now,
      id_verification_rejection_reason: null,
      id_verification_rejected_at: null,
      id_verification_metadata: {},
      updated_at: now,
    })
    .eq('id', profile.id)
    .eq('id_verification_status', 'REJECTED')

  if (updateError) throw updateError

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'TAILOR_VERIFICATION',
    severity: 'HIGH',
    source,
    actorId: callerId,
    actorRole: 'TAILOR',
    userId: callerId,
    tailorProfileId: profile.id,
    title: 'Tailor portfolio resubmitted',
    description: `${profile.display_name ?? 'Tailor'} updated rejected public portfolio media and is waiting on trust review. The existing private challenge video is retained.`,
    recommendedAction: 'Review the updated public portfolio against the retained private challenge video, then approve or reject with a structured reason.',
    dedupeKey: `tailor-verification:${profile.id}`,
    notifyOps: true,
    notifyOpsPush: true,
    metadata: {
      evidence_type: 'PORTFOLIO_REPLACEMENT',
      display_name: profile.display_name ?? null,
      location: profile.location ?? null,
      specialty_tags: profile.specialty_tags ?? [],
      avatar_url: profile.avatar_url ?? null,
      trust_verification_video_path: profile.trust_verification_video_path,
      rejection_code: INVALID_PORTFOLIO_MEDIA_REJECTION_CODE,
      payout_account_verified: profile.payout_account_verified ?? false,
      payout_currency: profile.payout_currency ?? null,
    },
  })

  return true
}
