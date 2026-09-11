-- Reusable, non-terminal collaboration actions for the canonical Ops case.
-- Domain outcomes remain in typed domain RPCs; this function only supports
-- acknowledgement, self-assignment, and internal notes.

create or replace function public.perform_ops_case_collaboration_action(
  p_issue_id uuid,
  p_action text,
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
  v_action text := upper(trim(coalesce(p_action, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_principal public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_next_status text;
  v_previous_status text;
  v_event_type text;
  v_summary text;
  v_now timestamptz := now();
begin
  if v_action not in ('ACKNOWLEDGE', 'ASSIGN_SELF', 'ADD_NOTE') then
    raise exception 'Unsupported case collaboration action.' using errcode = '22023';
  end if;
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
  if v_action = 'ADD_NOTE' and (length(v_reason) < 8 or length(v_reason) > 2000) then
    raise exception 'An internal note between 8 and 2000 characters is required.' using errcode = '22023';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or not (v_principal.roles && array['admin','ops','customer_success','trust','finance','engineering']::text[])
  then
    raise exception 'Workforce principal is not authorized for case collaboration.' using errcode = '42501';
  end if;
  if public.current_ops_environment() <> v_environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;

  select * into v_issue
  from public.ops_issues
  where id = p_issue_id
  for update;

  if v_issue.id is null
    or v_issue.environment <> v_environment
    or v_issue.provenance = 'UNKNOWN'
  then
    raise exception 'Case is not actionable in this environment.' using errcode = '42501';
  end if;

  select * into v_receipt
  from public.ops_action_receipts
  where issue_id = p_issue_id
    and idempotency_key = trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'receiptId', v_receipt.id,
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
    raise exception 'Terminal cases are read-only in collaboration actions.' using errcode = '55000';
  end if;

  v_previous_status := v_issue.canonical_status;

  v_next_status := case
    when v_action = 'ACKNOWLEDGE' and v_issue.canonical_status = 'NEW' then 'TRIAGED'
    when v_action = 'ASSIGN_SELF' and v_issue.canonical_status in ('NEW', 'TRIAGED') then 'IN_PROGRESS'
    else v_issue.canonical_status
  end;
  v_event_type := case when v_action = 'ADD_NOTE' then 'INTERNAL_NOTE' when v_action = 'ASSIGN_SELF' then 'ASSIGNMENT' else 'STATE_TRANSITION' end;
  v_summary := case
    when v_action = 'ACKNOWLEDGE' then 'A named operator acknowledged the case.'
    when v_action = 'ASSIGN_SELF' then 'A named operator accepted ownership of the case.'
    else v_reason
  end;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action, completed_at
  ) values (
    p_issue_id,
    'CASE_' || v_action,
    trim(p_idempotency_key),
    p_actor_principal_id,
    p_expected_record_version,
    'SUCCEEDED',
    case
      when v_action = 'ACKNOWLEDGE' then 'Case acknowledgement persisted.'
      when v_action = 'ASSIGN_SELF' then 'Case ownership persisted.'
      else 'Internal case note persisted.'
    end,
    p_correlation_id,
    '[]'::jsonb,
    '[]'::jsonb,
    case when v_action = 'ACKNOWLEDGE' then v_issue.recommended_action else null end,
    v_now
  ) returning * into v_receipt;

  update public.ops_issues
  set canonical_status = v_next_status,
      status = case when v_next_status = 'NEW' then 'OPEN' else 'IN_REVIEW' end,
      assigned_principal_id = case when v_action = 'ASSIGN_SELF' then v_principal.id else assigned_principal_id end,
      assigned_to = case when v_action = 'ASSIGN_SELF' then trim(p_actor_label) else assigned_to end,
      claimed_at = case when v_action = 'ASSIGN_SELF' then coalesce(claimed_at, v_now) else claimed_at end,
      first_responded_at = case when v_action = 'ACKNOWLEDGE' then coalesce(first_responded_at, v_now) else first_responded_at end
  where id = p_issue_id
    and record_version = p_expected_record_version;

  if not found then
    raise exception 'Case changed while the action was being applied.' using errcode = '40001';
  end if;

  select * into v_issue from public.ops_issues where id = p_issue_id;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    p_issue_id,
    v_event_type,
    'INTERNAL',
    v_issue.sensitivity,
    p_actor_principal_id,
    trim(p_actor_label),
    v_previous_status,
    v_next_status,
    v_summary,
    jsonb_build_object('action', v_action, 'reason', nullif(v_reason, '')),
    'case-collaboration:' || v_receipt.id::text,
    p_correlation_id,
    v_now
  );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    p_issue_id,
    'CASE_' || v_action,
    trim(p_actor_label),
    array_to_string(v_principal.roles, ','),
    nullif(v_reason, ''),
    jsonb_build_object('recordVersion', p_expected_record_version),
    jsonb_build_object('caseStatus', v_issue.canonical_status, 'recordVersion', v_issue.record_version),
    v_now
  );

  update public.ops_action_receipts
  set resulting_record_version = v_issue.record_version
  where id = v_receipt.id
  returning * into v_receipt;

  return jsonb_build_object(
    'duplicate', false,
    'receiptId', v_receipt.id,
    'receiptOutcome', v_receipt.outcome,
    'caseStatus', v_issue.canonical_status,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid)
  to service_role;

comment on function public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid) is
  'Idempotent, optimistic-concurrency case acknowledgement, ownership, and internal-note boundary for the independently authenticated Ops broker.';
