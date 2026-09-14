-- Reconcile the four historical SMS jobs that were already closed by the
-- operator-approved prelaunch cleanup before explicit dead-job dispositions
-- existed. Preserve the DEAD jobs and legacy case history, add a migration
-- receipt, and classify the old closure as SUPERSEDED so readiness no longer
-- treats reviewed prelaunch noise as actionable.

create temporary table legacy_sms_dead_job_cases on commit drop as
select
  issue.id,
  issue.record_version as previous_record_version,
  issue.correlation_id,
  issue.related_entity_id,
  issue.canonical_status
from public.ops_issues issue
where issue.dedupe_key in (
  'job-dead:b5c11a66-a6c3-42ad-9f8a-6d34f3ddc78e',
  'job-dead:3e45f6d2-b73e-4cdd-b585-7c2548f9d0e9',
  'job-dead:54277731-b1bc-4be1-a7cb-951dd509492e',
  'job-dead:53fbd656-a4c4-4622-b263-02ec70e6807b'
)
  and issue.related_entity_type = 'job_queue'
  and issue.canonical_status in ('RESOLVED', 'CLOSED')
  and coalesce(issue.metadata ->> 'deadJobDisposition', '') = ''
  and exists (
    select 1
    from public.ops_case_events event
    where event.issue_id = issue.id
      and (
        event.event_type = 'PRELAUNCH_NOISE_ARCHIVED'
        or event.actor_label = 'prelaunch-ops-cleanup'
      )
  );

update public.ops_issues issue
set
  recommended_action = 'No replay. The prelaunch notification is superseded; retain the terminal job and case evidence for audit.',
  metadata = coalesce(issue.metadata, '{}'::jsonb) || jsonb_build_object(
    'deadJobDisposition', 'SUPERSEDED',
    'deadJobReviewedAt', now(),
    'deadJobReviewedBy', 'prelaunch-ops-cleanup',
    'deadJobReviewReason', 'Existing operator-approved prelaunch cleanup superseded this stale SMS; no replay was performed.',
    'legacyDispositionReconciled', true
  )
from legacy_sms_dead_job_cases legacy
where issue.id = legacy.id;

insert into public.ops_action_receipts (
  issue_id, action_key, idempotency_key, actor_principal_id,
  expected_record_version, resulting_record_version, outcome, human_status,
  correlation_id, side_effects, blockers, next_action, completed_at
)
select
  legacy.id,
  'MIGRATE_LEGACY_DEAD_JOB_DISPOSITION',
  'legacy-sms-dead-job-disposition:' || legacy.related_entity_id,
  null,
  legacy.previous_record_version,
  issue.record_version,
  'SUCCEEDED',
  'Legacy operator-approved closure reconciled as superseded without replay.',
  legacy.correlation_id,
  jsonb_build_array(jsonb_build_object(
    'jobId', legacy.related_entity_id,
    'disposition', 'SUPERSEDED',
    'jobMutated', false,
    'messageReplayed', false
  )),
  '[]'::jsonb,
  null,
  now()
from legacy_sms_dead_job_cases legacy
join public.ops_issues issue on issue.id = legacy.id
on conflict (issue_id, idempotency_key) do nothing;

insert into public.ops_case_events (
  issue_id, event_type, visibility, sensitivity, actor_label,
  from_status, to_status, summary, payload, idempotency_key,
  correlation_id, occurred_at
)
select
  legacy.id,
  'DECISION',
  'INTERNAL',
  issue.sensitivity,
  'migration/legacy-sms-dead-job-disposition',
  legacy.canonical_status,
  issue.canonical_status,
  'Legacy operator-approved closure was classified as superseded without replay.',
  jsonb_build_object(
    'jobId', legacy.related_entity_id,
    'disposition', 'SUPERSEDED',
    'inheritedFrom', 'prelaunch-ops-cleanup',
    'jobMutated', false,
    'messageReplayed', false
  ),
  'legacy-sms-dead-job-disposition:' || legacy.related_entity_id,
  legacy.correlation_id,
  now()
from legacy_sms_dead_job_cases legacy
join public.ops_issues issue on issue.id = legacy.id
on conflict (issue_id, idempotency_key) do nothing;

insert into public.ops_audit_logs (
  issue_id, action_taken, performed_by, performed_role, reason,
  before_state, after_state, created_at
)
select
  legacy.id,
  'MIGRATE_LEGACY_DEAD_JOB_DISPOSITION',
  'migration/legacy-sms-dead-job-disposition',
  'system-migration',
  'Reconcile an existing operator-approved prelaunch closure without replaying or mutating the terminal SMS job.',
  jsonb_build_object(
    'caseStatus', legacy.canonical_status,
    'recordVersion', legacy.previous_record_version,
    'deadJobDisposition', null
  ),
  jsonb_build_object(
    'caseStatus', issue.canonical_status,
    'recordVersion', issue.record_version,
    'deadJobDisposition', 'SUPERSEDED',
    'jobMutated', false,
    'messageReplayed', false
  ),
  now()
from legacy_sms_dead_job_cases legacy
join public.ops_issues issue on issue.id = legacy.id
where not exists (
  select 1
  from public.ops_audit_logs audit
  where audit.issue_id = legacy.id
    and audit.action_taken = 'MIGRATE_LEGACY_DEAD_JOB_DISPOSITION'
  );
