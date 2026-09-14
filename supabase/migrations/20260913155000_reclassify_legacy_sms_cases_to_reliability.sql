-- The four prelaunch SMS dead-job cases were originally created in the generic
-- Operations queue. After their explicit SUPERSEDED disposition is reconciled,
-- move only those terminal cases to their correct Reliability ownership so the
-- readiness RPC can recognize the audited evidence.

create temporary table legacy_sms_operations_cases on commit drop as
select
  issue.id,
  issue.record_version as previous_record_version,
  issue.correlation_id,
  issue.related_entity_id,
  issue.queue_key as previous_queue_key,
  issue.owning_team as previous_owning_team
from public.ops_issues issue
where issue.dedupe_key in (
  'job-dead:b5c11a66-a6c3-42ad-9f8a-6d34f3ddc78e',
  'job-dead:3e45f6d2-b73e-4cdd-b585-7c2548f9d0e9',
  'job-dead:54277731-b1bc-4be1-a7cb-951dd509492e',
  'job-dead:53fbd656-a4c4-4622-b263-02ec70e6807b'
)
  and issue.related_entity_type = 'job_queue'
  and issue.canonical_status in ('RESOLVED', 'CLOSED')
  and issue.metadata ->> 'deadJobDisposition' = 'SUPERSEDED'
  and issue.queue_key <> 'reliability';

update public.ops_issues issue
set
  queue_key = 'reliability',
  owning_team = 'engineering',
  sla_policy_version = 'reliability-v1',
  metadata = coalesce(issue.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacyQueueReclassified', true,
    'legacyQueueReclassifiedAt', now(),
    'legacyPreviousQueue', legacy.previous_queue_key
  )
from legacy_sms_operations_cases legacy
where issue.id = legacy.id;

insert into public.ops_action_receipts (
  issue_id, action_key, idempotency_key, actor_principal_id,
  expected_record_version, resulting_record_version, outcome, human_status,
  correlation_id, side_effects, blockers, next_action, completed_at
)
select
  legacy.id,
  'MIGRATE_LEGACY_DEAD_JOB_QUEUE_OWNERSHIP',
  'legacy-sms-dead-job-reliability:' || legacy.related_entity_id,
  null,
  legacy.previous_record_version,
  issue.record_version,
  'SUCCEEDED',
  'Legacy terminal SMS case moved from Operations to Reliability ownership.',
  legacy.correlation_id,
  jsonb_build_array(jsonb_build_object(
    'jobId', legacy.related_entity_id,
    'fromQueue', legacy.previous_queue_key,
    'toQueue', 'reliability',
    'jobMutated', false,
    'messageReplayed', false
  )),
  '[]'::jsonb,
  null,
  now()
from legacy_sms_operations_cases legacy
join public.ops_issues issue on issue.id = legacy.id
on conflict (issue_id, idempotency_key) do nothing;

insert into public.ops_case_events (
  issue_id, event_type, visibility, sensitivity, actor_label,
  from_status, to_status, summary, payload, idempotency_key,
  correlation_id, occurred_at
)
select
  legacy.id,
  'STATE_TRANSITION',
  'INTERNAL',
  issue.sensitivity,
  'migration/legacy-sms-reliability-ownership',
  issue.canonical_status,
  issue.canonical_status,
  'Legacy terminal SMS case moved to Reliability ownership.',
  jsonb_build_object(
    'jobId', legacy.related_entity_id,
    'fromQueue', legacy.previous_queue_key,
    'toQueue', 'reliability',
    'fromTeam', legacy.previous_owning_team,
    'toTeam', 'engineering'
  ),
  'legacy-sms-dead-job-reliability:' || legacy.related_entity_id,
  legacy.correlation_id,
  now()
from legacy_sms_operations_cases legacy
join public.ops_issues issue on issue.id = legacy.id
on conflict (issue_id, idempotency_key) do nothing;

insert into public.ops_audit_logs (
  issue_id, action_taken, performed_by, performed_role, reason,
  before_state, after_state, created_at
)
select
  legacy.id,
  'MIGRATE_LEGACY_DEAD_JOB_QUEUE_OWNERSHIP',
  'migration/legacy-sms-reliability-ownership',
  'system-migration',
  'Correct legacy ownership after explicit no-replay disposition reconciliation.',
  jsonb_build_object(
    'queueKey', legacy.previous_queue_key,
    'owningTeam', legacy.previous_owning_team,
    'recordVersion', legacy.previous_record_version
  ),
  jsonb_build_object(
    'queueKey', issue.queue_key,
    'owningTeam', issue.owning_team,
    'recordVersion', issue.record_version,
    'jobMutated', false,
    'messageReplayed', false
  ),
  now()
from legacy_sms_operations_cases legacy
join public.ops_issues issue on issue.id = legacy.id
where not exists (
  select 1
  from public.ops_audit_logs audit
  where audit.issue_id = legacy.id
    and audit.action_taken = 'MIGRATE_LEGACY_DEAD_JOB_QUEUE_OWNERSHIP'
  );
