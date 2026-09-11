-- Historical cases that already have durable human ownership or review events
-- must not be presented as awaiting their first response. This bounded data
-- backfill is intentionally separate from the policy/schema migration.

update public.ops_issues issue
set first_responded_at = coalesce(
      issue.claimed_at,
      (
        select min(audit.created_at)
        from public.ops_audit_logs audit
        where audit.issue_id = issue.id
      ),
      issue.updated_at,
      issue.created_at
    ),
    last_meaningful_activity_at = coalesce(issue.last_meaningful_activity_at, issue.updated_at, issue.created_at)
where issue.first_responded_at is null
  and (
    issue.assigned_principal_id is not null
    or nullif(trim(coalesce(issue.assigned_to, '')), '') is not null
    or issue.canonical_status <> 'NEW'
    or exists (
      select 1 from public.ops_audit_logs audit where audit.issue_id = issue.id
    )
  );

insert into public.ops_case_events (
  issue_id, event_type, visibility, sensitivity, actor_label, summary,
  payload, idempotency_key, correlation_id, occurred_at
)
select
  issue.id,
  'AUDIT_SECURITY',
  'INTERNAL',
  issue.sensitivity,
  'SYSTEM_MIGRATION',
  'Historical first-response evidence was projected from durable ownership or audit history.',
  jsonb_build_object('firstRespondedAt', issue.first_responded_at, 'backfilled', true),
  'ops-first-response-evidence-v1:' || issue.id::text,
  issue.correlation_id,
  issue.first_responded_at
from public.ops_issues issue
where issue.first_responded_at is not null
  and (
    issue.assigned_principal_id is not null
    or nullif(trim(coalesce(issue.assigned_to, '')), '') is not null
    or issue.canonical_status <> 'NEW'
    or exists (select 1 from public.ops_audit_logs audit where audit.issue_id = issue.id)
  )
on conflict (issue_id, idempotency_key) do nothing;
