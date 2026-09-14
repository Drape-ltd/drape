-- Complete the payout destination mutation and its canonical Ops proof in one
-- transaction. The exact repair at the end is intentionally limited to Anna's
-- already-succeeded DEVELOPMENT request; it cannot mutate production records.

create or replace function public.ops_finalize_payout_change_request(
  p_request_id uuid,
  p_reason text,
  p_reviewed_by text,
  p_reviewed_role text,
  p_money_desk_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_money public.money_desk_requests%rowtype;
  v_issue public.ops_issues%rowtype;
  v_principal_id uuid;
  v_previous_status text;
  v_resulting_version bigint;
  v_now timestamptz := now();
begin
  select * into v_money
  from public.money_desk_requests
  where id = p_money_desk_request_id
  for update;

  if v_money.id is null
    or v_money.action_type <> 'PAYOUT_DESTINATION_CHANGE'
    or v_money.target_type <> 'PAYOUT_CHANGE_REQUEST'
    or v_money.target_id <> p_request_id::text
    or v_money.status <> 'EXECUTING' then
    raise exception 'The executing Money Desk request does not authorize this payout destination change.' using errcode = '42501';
  end if;

  select id into v_principal_id
  from public.ops_workforce_principals
  where email = lower(trim(p_reviewed_by))
    and status = 'ACTIVE'
    and 'admin' = any(roles)
  limit 1;

  if v_principal_id is null then
    raise exception 'An active admin workforce principal is required.' using errcode = '42501';
  end if;

  perform * from public.ops_decide_payout_change_request(
    p_request_id,
    'APPROVE',
    null,
    p_reason,
    lower(trim(p_reviewed_by))
  );

  select * into v_issue
  from public.ops_issues
  where issue_type = 'PAYOUT_BLOCKED'
    and related_entity_type = 'payout_change_request'
    and related_entity_id = p_request_id::text
  order by created_at desc
  limit 1
  for update;

  if v_issue.id is null then
    raise exception 'The linked payout Ops case was not found.' using errcode = 'P0001';
  end if;

  v_previous_status := v_issue.canonical_status;

  update public.ops_issues
  set status = 'RESOLVED',
      canonical_status = 'RESOLVED',
      assigned_to = lower(trim(p_reviewed_by)),
      assigned_principal_id = v_principal_id,
      resolved_at = v_now,
      recommended_action = 'Payout destination change completed after independent founder approval.'
  where id = v_issue.id
  returning record_version into v_resulting_version;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    v_issue.id, 'STATE_TRANSITION', 'INTERNAL', v_issue.sensitivity, v_principal_id,
    lower(trim(p_reviewed_by)), v_previous_status, 'RESOLVED',
    'Payout destination change completed after independent founder approval.',
    jsonb_build_object('payoutChangeRequestId', p_request_id, 'moneyDeskRequestId', p_money_desk_request_id),
    'payout-change-finalized:' || p_money_desk_request_id::text,
    v_money.correlation_id, v_now
  ) on conflict (issue_id, idempotency_key) do nothing;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, resulting_record_version, outcome, human_status,
    correlation_id, side_effects, blockers, next_action, completed_at
  ) values (
    v_issue.id, 'PAYOUT_DESTINATION_CHANGE',
    'payout-change-finalized:' || p_money_desk_request_id::text,
    v_principal_id, v_issue.record_version, v_resulting_version, 'SUCCEEDED',
    'The verified replacement payout destination is active and the case is resolved.',
    v_money.correlation_id,
    jsonb_build_array(jsonb_build_object('type', 'PAYOUT_CHANGE_REQUEST', 'status', 'APPROVED')),
    '[]'::jsonb, 'No further Ops action is required.', v_now
  ) on conflict (issue_id, idempotency_key) do nothing;

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    v_issue.id, 'PAYOUT_CHANGE_APPROVED_AFTER_INDEPENDENT_REVIEW',
    lower(trim(p_reviewed_by)), upper(trim(p_reviewed_role)), p_reason,
    jsonb_build_object('caseStatus', v_previous_status, 'recordVersion', v_issue.record_version),
    jsonb_build_object('caseStatus', 'RESOLVED', 'recordVersion', v_resulting_version),
    v_now
  );

  return jsonb_build_object(
    'requestId', p_request_id,
    'moneyDeskRequestId', p_money_desk_request_id,
    'issueId', v_issue.id,
    'caseStatus', 'RESOLVED',
    'recordVersion', v_resulting_version,
    'correlationId', v_money.correlation_id
  );
end;
$$;

revoke all on function public.ops_finalize_payout_change_request(uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.ops_finalize_payout_change_request(uuid,text,text,text,uuid)
  to service_role;

comment on function public.ops_finalize_payout_change_request(uuid,text,text,text,uuid) is
  'Atomically activates an independently approved payout destination and persists canonical case closure, event, audit, and action receipt proof.';

do $$
declare
  v_money public.money_desk_requests%rowtype;
  v_issue public.ops_issues%rowtype;
  v_principal_id uuid;
  v_resulting_version bigint;
  v_now timestamptz := now();
begin
  select * into v_money
  from public.money_desk_requests
  where id = 'aa09a072-26c9-4ee7-a7b1-ada120b276d0'
    and target_id = '0ec370a2-4957-463a-8bfc-774b5664f69c'
    and status = 'SUCCEEDED';

  select * into v_issue
  from public.ops_issues
  where case_number = 'OPS-23E7C643'
    and environment = 'DEVELOPMENT'
    and related_entity_id = '0ec370a2-4957-463a-8bfc-774b5664f69c'
  for update;

  if v_money.id is not null and v_issue.id is not null and v_issue.canonical_status not in ('RESOLVED', 'CLOSED') then
    select id into v_principal_id
    from public.ops_workforce_principals
    where email = 'founders@drapeon.co' and status = 'ACTIVE'
    limit 1;

    update public.ops_issues
    set status = 'RESOLVED',
        canonical_status = 'RESOLVED',
        assigned_to = 'founders@drapeon.co',
        assigned_principal_id = v_principal_id,
        resolved_at = v_now,
        recommended_action = 'Payout destination change completed after independent founder approval.'
    where id = v_issue.id
    returning record_version into v_resulting_version;

    insert into public.ops_case_events (
      issue_id, event_type, visibility, sensitivity, actor_principal_id,
      actor_label, from_status, to_status, summary, payload,
      idempotency_key, correlation_id, occurred_at
    ) values (
      v_issue.id, 'STATE_TRANSITION', 'INTERNAL', v_issue.sensitivity, v_principal_id,
      'founders@drapeon.co', v_issue.canonical_status, 'RESOLVED',
      'Reconciled the completed development payout destination change.',
      jsonb_build_object('payoutChangeRequestId', v_money.target_id, 'moneyDeskRequestId', v_money.id),
      'payout-change-finalized:' || v_money.id::text,
      v_money.correlation_id, v_now
    ) on conflict (issue_id, idempotency_key) do nothing;

    insert into public.ops_action_receipts (
      issue_id, action_key, idempotency_key, actor_principal_id,
      expected_record_version, resulting_record_version, outcome, human_status,
      correlation_id, side_effects, blockers, next_action, completed_at
    ) values (
      v_issue.id, 'PAYOUT_DESTINATION_CHANGE',
      'payout-change-finalized:' || v_money.id::text,
      v_principal_id, v_issue.record_version, v_resulting_version, 'SUCCEEDED',
      'The verified replacement payout destination is active and the case is resolved.',
      v_money.correlation_id,
      jsonb_build_array(jsonb_build_object('type', 'PAYOUT_CHANGE_REQUEST', 'status', 'APPROVED')),
      '[]'::jsonb, 'No further Ops action is required.', v_now
    ) on conflict (issue_id, idempotency_key) do nothing;
  end if;
end;
$$;
