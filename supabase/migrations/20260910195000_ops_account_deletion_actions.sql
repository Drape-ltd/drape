-- Canonical, typed account-deletion actions for the Ops broker.
-- The broker independently verifies Cloudflare Access; this RPC rechecks the
-- named principal, environment, role, case version, domain transition, and
-- idempotency in the same transaction as its event and durable receipt.

create or replace function public.perform_ops_account_deletion_action(
  p_issue_id uuid,
  p_request_id uuid,
  p_action text,
  p_reason text,
  p_expected_record_version bigint,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_label text,
  p_environment text,
  p_sensitive_assurance boolean,
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
  v_request public.account_deletion_requests%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_status text;
  v_now timestamptz := now();
begin
  if v_action not in ('ACKNOWLEDGE', 'RECORD_BLOCKER', 'APPROVE_FINALIZATION') then
    raise exception 'Unsupported account deletion action.' using errcode = '22023';
  end if;
  if p_issue_id is null or p_request_id is null or p_actor_principal_id is null then
    raise exception 'Case, request, and workforce principal are required.' using errcode = '22023';
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
  if p_correlation_id is null then
    raise exception 'Correlation ID is required.' using errcode = '22023';
  end if;
  if v_action in ('RECORD_BLOCKER', 'APPROVE_FINALIZATION') and p_sensitive_assurance is distinct from true then
    raise exception 'Fresh sensitive assurance is required.' using errcode = '42501';
  end if;
  if v_action = 'RECORD_BLOCKER' and (length(v_reason) < 8 or length(v_reason) > 1000) then
    raise exception 'A specific blocker reason between 8 and 1000 characters is required.' using errcode = '22023';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or not (
      'admin' = any(v_principal.roles)
      or 'customer_success' = any(v_principal.roles)
    ) then
    raise exception 'Workforce principal is not authorized for privacy deletion actions.' using errcode = '42501';
  end if;

  if public.current_ops_environment() <> v_environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;

  select * into v_issue
  from public.ops_issues
  where id = p_issue_id
  for update;

  if v_issue.id is null
    or v_issue.related_entity_type <> 'account_deletion_request'
    or v_issue.related_entity_id <> p_request_id::text
    or v_issue.environment <> v_environment
    or v_issue.provenance = 'UNKNOWN' then
    raise exception 'Case is not an actionable deletion record in this environment.' using errcode = '42501';
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
      'requestStatus', null,
      'recordVersion', v_receipt.resulting_record_version,
      'correlationId', v_receipt.correlation_id
    );
  end if;

  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%', v_issue.record_version using errcode = '40001';
  end if;

  select * into v_request
  from public.account_deletion_requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'Deletion request no longer exists.' using errcode = 'P0002';
  end if;

  if v_action = 'ACKNOWLEDGE' then
    if v_request.status <> 'PENDING' then
      raise exception 'Deletion request cannot be acknowledged from %.', v_request.status using errcode = '55000';
    end if;
    v_status := 'ACKNOWLEDGED';
  elsif v_action = 'RECORD_BLOCKER' then
    if v_request.status not in ('PENDING', 'ACKNOWLEDGED', 'BLOCKED') then
      raise exception 'A blocker cannot be recorded from %.', v_request.status using errcode = '55000';
    end if;
    v_status := 'BLOCKED';
  else
    if v_request.status <> 'ACKNOWLEDGED' then
      raise exception 'Finalization requires an acknowledged, unblocked request.' using errcode = '55000';
    end if;
    v_status := 'READY_FOR_FINALIZATION';
  end if;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action
  ) values (
    p_issue_id,
    'ACCOUNT_DELETION_' || v_action,
    trim(p_idempotency_key),
    p_actor_principal_id,
    p_expected_record_version,
    'PENDING',
    'The deletion decision is persisted; required side effects are being recorded.',
    p_correlation_id,
    '[]'::jsonb,
    '[]'::jsonb,
    case when v_action = 'APPROVE_FINALIZATION'
      then 'Run the protected deletion worker and record its terminal outcome.'
      else 'Record customer communication enqueue outcome.'
    end
  ) returning * into v_receipt;

  update public.account_deletion_requests
  set status = v_status,
      acknowledged_at = case
        when v_status = 'PENDING' then null
        else coalesce(acknowledged_at, v_now)
      end,
      finalization_approved_at = case when v_status = 'READY_FOR_FINALIZATION' then v_now else null end,
      processed_at = null,
      metadata = case when v_action = 'RECORD_BLOCKER'
        then coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'finalization_state', 'blocked',
          'blocker_code', 'MANUAL_REVIEW',
          'blocker_detail', v_reason,
          'blocked_at', v_now
        )
        else coalesce(metadata, '{}'::jsonb)
      end
  where id = p_request_id
    and status = v_request.status;

  if not found then
    raise exception 'Deletion request changed while the action was being applied.' using errcode = '40001';
  end if;

  select * into v_issue from public.ops_issues where id = p_issue_id;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    p_issue_id,
    'DECISION',
    'INTERNAL',
    'HIGHLY_RESTRICTED',
    p_actor_principal_id,
    trim(p_actor_label),
    v_request.status,
    v_status,
    case v_action
      when 'ACKNOWLEDGE' then 'Privacy Ops acknowledged the deletion request.'
      when 'RECORD_BLOCKER' then 'Privacy Ops recorded a blocker after protected review.'
      else 'Privacy Ops approved the request for protected finalization.'
    end,
    jsonb_build_object('requestId', p_request_id, 'reason', nullif(v_reason, '')),
    'deletion-decision:' || v_receipt.id::text,
    p_correlation_id,
    v_now
  );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    p_issue_id,
    'ACCOUNT_DELETION_' || v_action,
    trim(p_actor_label),
    array_to_string(v_principal.roles, ','),
    nullif(v_reason, ''),
    jsonb_build_object('requestStatus', v_request.status, 'recordVersion', p_expected_record_version),
    jsonb_build_object('requestStatus', v_status, 'recordVersion', v_issue.record_version),
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
    'requestId', v_request.id,
    'requestStatus', v_status,
    'userId', v_request.user_id,
    'recipientEmail', v_request.email,
    'accountRole', v_request.role,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

create or replace function public.complete_ops_action_receipt(
  p_receipt_id uuid,
  p_actor_principal_id uuid,
  p_outcome text,
  p_human_status text,
  p_side_effects jsonb default '[]'::jsonb,
  p_blockers jsonb default '[]'::jsonb,
  p_next_action text default null,
  p_failure_code text default null
)
returns public.ops_action_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outcome text := upper(trim(coalesce(p_outcome, '')));
  v_receipt public.ops_action_receipts%rowtype;
begin
  if v_outcome not in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
    raise exception 'Receipt outcome must be terminal.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_human_status, ''))) < 8 or length(p_human_status) > 500 then
    raise exception 'A bounded human status is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_side_effects, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_blockers, '[]'::jsonb)) <> 'array' then
    raise exception 'Side effects and blockers must be arrays.' using errcode = '22023';
  end if;

  select * into v_receipt
  from public.ops_action_receipts
  where id = p_receipt_id
  for update;

  if v_receipt.id is null then
    raise exception 'Action receipt was not found.' using errcode = 'P0002';
  end if;
  if v_receipt.actor_principal_id is distinct from p_actor_principal_id then
    raise exception 'Only the initiating workforce principal may complete this receipt.' using errcode = '42501';
  end if;
  if v_receipt.outcome <> 'PENDING' then
    return v_receipt;
  end if;

  update public.ops_action_receipts
  set outcome = v_outcome,
      human_status = trim(p_human_status),
      side_effects = coalesce(p_side_effects, '[]'::jsonb),
      blockers = coalesce(p_blockers, '[]'::jsonb),
      next_action = nullif(trim(coalesce(p_next_action, '')), ''),
      failure_code = nullif(trim(coalesce(p_failure_code, '')), ''),
      completed_at = now()
  where id = p_receipt_id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke all on function public.perform_ops_account_deletion_action(uuid, uuid, text, text, bigint, text, uuid, text, text, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_ops_action_receipt(uuid, uuid, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.perform_ops_account_deletion_action(uuid, uuid, text, text, bigint, text, uuid, text, text, boolean, uuid)
  to service_role;
grant execute on function public.complete_ops_action_receipt(uuid, uuid, text, text, jsonb, jsonb, text, text)
  to service_role;

comment on function public.perform_ops_account_deletion_action(uuid, uuid, text, text, bigint, text, uuid, text, text, boolean, uuid) is
  'Typed, idempotent, optimistic-concurrency account deletion decision used only by the independently authenticated Ops broker.';
