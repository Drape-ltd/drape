-- Keep terminal job evidence immutable while allowing Reliability to record a
-- reviewed no-replay disposition. Only a resolved/closed Reliability case with
-- the explicit disposition removes a dead job from the actionable health count.

create or replace function public.get_job_queue_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  status_counts jsonb;
  oldest_pending timestamptz;
  oldest_processing timestamptz;
  actionable_dead_count integer;
  total_dead_count integer;
  retryable_count integer;
begin
  select coalesce(jsonb_object_agg(status, count), '{}'::jsonb)
    into status_counts
    from (
      select status, count(*)::integer
      from public.job_queue
      group by status
    ) counts;

  select min(created_at) into oldest_pending
  from public.job_queue where status in ('PENDING', 'RETRYABLE');

  select min(locked_at) into oldest_processing
  from public.job_queue where status = 'PROCESSING';

  select count(*)::integer into total_dead_count
  from public.job_queue where status = 'DEAD';

  select count(*)::integer into actionable_dead_count
  from public.job_queue job
  where job.status = 'DEAD'
    and not exists (
      select 1
      from public.ops_issues issue
      where issue.related_entity_type = 'job_queue'
        and issue.related_entity_id = job.id::text
        and issue.queue_key = 'reliability'
        and issue.canonical_status in ('RESOLVED', 'CLOSED')
        and issue.metadata ->> 'deadJobDisposition' in (
          'ACKNOWLEDGED_NO_REPLAY', 'RECOVERED', 'SUPERSEDED'
        )
    );

  select count(*)::integer into retryable_count
  from public.job_queue where status = 'RETRYABLE';

  return jsonb_build_object(
    'statusCounts', status_counts,
    'oldestPendingAt', oldest_pending,
    'oldestProcessingAt', oldest_processing,
    'deadCount', coalesce(actionable_dead_count, 0),
    'totalDeadCount', coalesce(total_dead_count, 0),
    'reviewedDeadCount', greatest(coalesce(total_dead_count, 0) - coalesce(actionable_dead_count, 0), 0),
    'retryableCount', coalesce(retryable_count, 0)
  );
end;
$$;

revoke all on function public.get_job_queue_health() from public, anon, authenticated;
grant execute on function public.get_job_queue_health() to service_role;

comment on function public.get_job_queue_health() is
  'Queue health with actionable dead-letter count separated from immutable reviewed terminal history.';

create or replace function public.perform_ops_dead_job_review_action(
  p_issue_id uuid,
  p_reason text,
  p_expected_record_version bigint,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_label text,
  p_environment text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_now timestamptz := now();
  v_principal public.ops_workforce_principals%rowtype;
  v_policy public.ops_queue_policies%rowtype;
  v_issue public.ops_issues%rowtype;
  v_job public.job_queue%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_previous_status text;
begin
  if p_issue_id is null or p_actor_principal_id is null or p_correlation_id is null then
    raise exception 'Case, workforce principal, and correlation ID are required.' using errcode = '22023';
  end if;
  if p_expected_record_version is null or p_expected_record_version < 1 then
    raise exception 'Expected case version is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 16 or length(p_idempotency_key) > 180 then
    raise exception 'A bounded idempotency key is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_actor_label, ''))) < 3 or length(p_actor_label) > 180 then
    raise exception 'A named workforce actor is required.' using errcode = '22023';
  end if;
  if length(v_reason) < 12 or length(v_reason) > 1000 then
    raise exception 'A review reason between 12 and 1000 characters is required.' using errcode = '22023';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or public.current_ops_environment() <> v_environment
  then
    raise exception 'Workforce principal is not authorized for dead-job review.' using errcode = '42501';
  end if;

  select * into v_issue
  from public.ops_issues
  where id = p_issue_id
  for update;

  if v_issue.id is null
    or v_issue.environment <> v_environment
    or v_issue.provenance = 'UNKNOWN'
    or v_issue.queue_key <> 'reliability'
    or v_issue.related_entity_type <> 'job_queue'
    or v_issue.related_entity_id is null
  then
    raise exception 'Case is not an actionable Reliability dead-job case.' using errcode = '42501';
  end if;

  select * into v_policy
  from public.ops_queue_policies policy
  where policy.environment = v_environment
    and policy.queue_key = 'reliability'
    and policy.active
    and policy.retired_at is null
    and policy.effective_at <= v_now
  order by (policy.version = v_issue.sla_policy_version) desc, policy.effective_at desc, policy.updated_at desc
  limit 1;

  if v_policy.id is null
    or not (v_principal.roles && v_policy.permitted_roles)
    or not ('resolve' = any(v_policy.permitted_actions))
  then
    raise exception 'Workforce principal cannot resolve Reliability dead jobs.' using errcode = '42501';
  end if;

  select * into v_receipt
  from public.ops_action_receipts
  where issue_id = p_issue_id and idempotency_key = trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object(
      'duplicate', true, 'receiptId', v_receipt.id,
      'receiptOutcome', v_receipt.outcome,
      'caseStatus', v_issue.canonical_status,
      'recordVersion', v_issue.record_version,
      'correlationId', v_receipt.correlation_id
    );
  end if;

  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%', v_issue.record_version using errcode = '40001';
  end if;
  if v_issue.canonical_status in ('RESOLVED', 'CLOSED') then
    raise exception 'Terminal cases are read-only.' using errcode = '55000';
  end if;

  select * into v_job
  from public.job_queue
  where id::text = v_issue.related_entity_id
  for share;
  if v_job.id is null or v_job.status <> 'DEAD' then
    raise exception 'The linked job is not in a terminal dead-letter state.' using errcode = '55000';
  end if;

  v_previous_status := v_issue.canonical_status;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action, completed_at
  ) values (
    p_issue_id, 'RESOLVE_DEAD_JOB_NO_REPLAY', trim(p_idempotency_key),
    p_actor_principal_id, p_expected_record_version, 'SUCCEEDED',
    'Dead job reviewed and retained without replay.', p_correlation_id,
    jsonb_build_array(jsonb_build_object('jobId', v_job.id, 'disposition', 'ACKNOWLEDGED_NO_REPLAY')),
    '[]'::jsonb, null, v_now
  ) returning * into v_receipt;

  update public.ops_issues
  set status = 'RESOLVED', canonical_status = 'RESOLVED', resolved_at = v_now,
      first_responded_at = coalesce(first_responded_at, v_now),
      recommended_action = 'No replay. Retain the terminal job, case, receipt, and provider evidence for audit.',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'deadJobDisposition', 'ACKNOWLEDGED_NO_REPLAY',
        'deadJobReviewedAt', v_now,
        'deadJobReviewedBy', trim(p_actor_label),
        'deadJobReviewReason', v_reason
      )
  where id = p_issue_id and record_version = p_expected_record_version;

  if not found then
    raise exception 'Case changed while the review was being applied.' using errcode = '40001';
  end if;

  select * into v_issue from public.ops_issues where id = p_issue_id;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    p_issue_id, 'DECISION', 'INTERNAL', v_issue.sensitivity,
    p_actor_principal_id, trim(p_actor_label), v_previous_status, 'RESOLVED',
    'A named operator reviewed the dead job and recorded a no-replay disposition.',
    jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'disposition', 'ACKNOWLEDGED_NO_REPLAY', 'reason', v_reason),
    'dead-job-review:' || v_receipt.id::text, p_correlation_id, v_now
  );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    p_issue_id, 'RESOLVE_DEAD_JOB_NO_REPLAY', trim(p_actor_label),
    array_to_string(v_principal.roles, ','), v_reason,
    jsonb_build_object('caseStatus', v_previous_status, 'jobStatus', v_job.status, 'recordVersion', p_expected_record_version),
    jsonb_build_object('caseStatus', 'RESOLVED', 'jobStatus', v_job.status, 'recordVersion', v_issue.record_version, 'disposition', 'ACKNOWLEDGED_NO_REPLAY'),
    v_now
  );

  update public.ops_action_receipts
  set resulting_record_version = v_issue.record_version
  where id = v_receipt.id
  returning * into v_receipt;

  return jsonb_build_object(
    'duplicate', false, 'receiptId', v_receipt.id,
    'receiptOutcome', v_receipt.outcome,
    'caseStatus', v_issue.canonical_status,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.perform_ops_dead_job_review_action(uuid,text,bigint,text,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.perform_ops_dead_job_review_action(uuid,text,bigint,text,uuid,text,text,uuid)
  to service_role;

comment on function public.perform_ops_dead_job_review_action(uuid,text,bigint,text,uuid,text,text,uuid) is
  'Idempotent Reliability-only review that resolves a dead job without replaying or mutating terminal job evidence.';
