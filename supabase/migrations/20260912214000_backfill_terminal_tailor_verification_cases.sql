-- Repair terminal trust decisions that predate the canonical case-state sync.
-- This is intentionally separate from the trigger migration so the backfill
-- remains an independently reviewable production write.

update public.ops_issues as issue
set status = 'RESOLVED',
    canonical_status = 'RESOLVED',
    recommended_action = 'No action. The tailor trust review is complete.',
    resolved_at = coalesce(
      issue.resolved_at,
      profile.id_verified_at,
      profile.id_verification_rejected_at,
      now()
    ),
    metadata = coalesce(issue.metadata, '{}'::jsonb) || jsonb_build_object(
      'verificationStatus', profile.id_verification_status,
      'verificationDecidedAt', coalesce(
        profile.id_verified_at,
        profile.id_verification_rejected_at,
        now()
      )
    )
from public.tailor_profiles as profile
where issue.issue_type = 'TAILOR_VERIFICATION'
  and issue.environment = public.current_ops_environment()
  and coalesce(issue.user_id, issue.actor_id) = profile.user_id::text
  and (issue.tailor_profile_id is null or issue.tailor_profile_id = profile.id::text)
  and profile.id_verification_status in ('VERIFIED', 'APPROVED', 'REJECTED')
  and issue.canonical_status not in ('RESOLVED', 'CLOSED', 'CANCELLED');
