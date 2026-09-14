-- Four production SEND_SMS jobs from 2026-09-02 predate automatic dead-job
-- Reliability case ownership. Preserve the jobs and create open cases for a
-- named operator to review. This migration does not replay or resolve anything.

with target_jobs as (
  select job.*
  from public.job_queue job
  join (values
    ('b5c11a66-a6c3-42ad-9f8a-6d34f3ddc78e'::uuid),
    ('3e45f6d2-b73e-4cdd-b585-7c2548f9d0e9'::uuid),
    ('54277731-b1bc-4be1-a7cb-951dd509492e'::uuid),
    ('53fbd656-a4c4-4622-b263-02ec70e6807b'::uuid)
  ) target(id) on target.id = job.id
  where job.job_type = 'SEND_SMS' and job.status = 'DEAD'
)
insert into public.ops_issues (
  issue_type, severity, status, source, related_entity_type, related_entity_id,
  provider, stage, title, description, recommended_action, dedupe_key,
  metadata, queue_key, owning_team, priority, sensitivity, environment,
  canonical_status, first_response_due_at, active_resolution_due_at,
  sla_policy_version, provenance, last_seen_at, created_at
)
select
  'SYSTEM_ALERT', 'HIGH', 'OPEN', 'historical-sms-dead-job-review',
  'job_queue', job.id::text, 'SMS', job.job_type,
  'Historical SMS delivery job needs review',
  'This terminal SMS job exhausted its retry budget before automatic Reliability case ownership. The message is stale and must not be replayed without a new customer event.',
  'Review the recorded attempts and current SMS configuration, then resolve without replay if no current customer action remains.',
  'job-dead:' || job.id::text,
  jsonb_build_object(
    'job_id', job.id,
    'job_type', job.job_type,
    'attempt_count', job.attempt_count,
    'max_attempts', job.max_attempts,
    'historicalCaseBackfill', true,
    'replayBlocked', true
  ),
  'reliability', 'engineering', 'P2', 'INTERNAL',
  public.current_ops_environment(), 'NEW',
  now() + interval '1 day', now() + interval '1 day',
  'reliability-v1',
  case when public.current_ops_environment() = 'DEVELOPMENT' then 'QA' else 'REAL' end,
  job.updated_at, job.created_at
from target_jobs job
on conflict (dedupe_key) do nothing;

insert into public.ops_case_events (
  issue_id, event_type, visibility, sensitivity, actor_label,
  from_status, to_status, summary, payload, idempotency_key,
  correlation_id, occurred_at
)
select
  issue.id, 'STATE_TRANSITION', 'INTERNAL', 'INTERNAL',
  'migration/historical-sms-case-backfill', null, 'NEW',
  'Historical SMS dead job entered Reliability review.',
  jsonb_build_object('jobId', issue.related_entity_id, 'jobType', 'SEND_SMS', 'replayBlocked', true),
  'historical-sms-case-created:' || issue.related_entity_id,
  issue.correlation_id, now()
from public.ops_issues issue
where issue.dedupe_key in (
  'job-dead:b5c11a66-a6c3-42ad-9f8a-6d34f3ddc78e',
  'job-dead:3e45f6d2-b73e-4cdd-b585-7c2548f9d0e9',
  'job-dead:54277731-b1bc-4be1-a7cb-951dd509492e',
  'job-dead:53fbd656-a4c4-4622-b263-02ec70e6807b'
)
on conflict (issue_id, idempotency_key) do nothing;
