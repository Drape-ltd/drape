-- Named, idempotent incident-command actions. The service incident and its
-- canonical Ops case transition together so Slack can remain a delivery
-- surface rather than an alternate source of truth.

alter table public.service_incidents
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by_principal_id uuid
    references public.ops_workforce_principals(id) on delete set null,
  add column if not exists snoozed_until timestamptz,
  add column if not exists snooze_reason text,
  add column if not exists snoozed_by_principal_id uuid
    references public.ops_workforce_principals(id) on delete set null;

create index if not exists service_incidents_active_command_idx
  on public.service_incidents (environment, status, snoozed_until, severity, updated_at desc)
  where status <> 'RESOLVED';

create or replace function public.perform_ops_incident_action(
  p_incident_id uuid,
  p_action text,
  p_reason text,
  p_snooze_until timestamptz,
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
  v_incident public.service_incidents%rowtype;
  v_issue public.ops_issues%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_previous_status text;
  v_next_status text;
  v_case_status text;
  v_now timestamptz := now();
begin
  if v_action not in ('ACKNOWLEDGE', 'SNOOZE', 'RESOLVE') then
    raise exception 'Unsupported incident action.' using errcode = '22023';
  end if;
  if p_incident_id is null or p_actor_principal_id is null or p_correlation_id is null then
    raise exception 'Incident, workforce principal, and correlation ID are required.' using errcode = '22023';
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
  if v_action in ('SNOOZE', 'RESOLVE') and (length(v_reason) < 8 or length(v_reason) > 1000) then
    raise exception 'A reason between 8 and 1000 characters is required.' using errcode = '22023';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or not (v_principal.roles && array['admin','ops','engineering']::text[])
  then
    raise exception 'Workforce principal is not authorized for incident command.' using errcode = '42501';
  end if;
  if public.current_ops_environment() <> v_environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;

  select * into v_incident
  from public.service_incidents
  where id = p_incident_id
    and environment = v_environment
  for update;

  if v_incident.id is null then
    raise exception 'Incident is not actionable in this environment.' using errcode = '42501';
  end if;

  select * into v_issue
  from public.ops_issues
  where related_entity_type = 'service_incident'
    and related_entity_id = v_incident.id::text
    and environment = v_environment
  for update;

  if v_issue.id is null or v_issue.provenance = 'UNKNOWN' then
    raise exception 'Canonical incident case is unavailable.' using errcode = '55000';
  end if;

  select * into v_receipt
  from public.ops_action_receipts
  where issue_id = v_issue.id
    and idempotency_key = trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'receiptId', v_receipt.id,
      'receiptOutcome', v_receipt.outcome,
      'incidentStatus', v_incident.status,
      'caseStatus', v_issue.canonical_status,
      'recordVersion', v_issue.record_version,
      'correlationId', v_receipt.correlation_id
    );
  end if;

  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%', v_issue.record_version using errcode = '40001';
  end if;
  if v_incident.status = 'RESOLVED' or v_issue.canonical_status in ('RESOLVED', 'CLOSED') then
    raise exception 'Resolved incidents are read-only.' using errcode = '55000';
  end if;
  if v_action = 'SNOOZE' and (
    p_snooze_until is null
    or p_snooze_until <= v_now
    or p_snooze_until > v_now + case when v_incident.severity = 'CRITICAL' then interval '4 hours' else interval '24 hours' end
  ) then
    raise exception 'Snooze expiry is outside the allowed incident window.' using errcode = '22023';
  end if;
  if v_action = 'RESOLVE'
    and v_incident.incident_key like 'synthetic:%'
    and not exists (
      select 1
      from public.ops_monitor_state state
      where state.environment = v_environment
        and 'synthetic:' || state.monitor_key || ':' || state.target_id = v_incident.incident_key
        and state.healthy
        and state.checked_at >= coalesce(v_incident.last_observed_at, v_incident.started_at)
    )
  then
    raise exception 'Synthetic recovery evidence is required before resolution.' using errcode = '55000';
  end if;

  v_previous_status := v_issue.canonical_status;
  v_next_status := case
    when v_action = 'RESOLVE' then 'RESOLVED'
    when v_action = 'SNOOZE' then 'SCHEDULED_FOLLOW_UP'
    when v_issue.canonical_status = 'NEW' then 'TRIAGED'
    else v_issue.canonical_status
  end;
  v_case_status := case when v_next_status = 'RESOLVED' then 'RESOLVED' else 'IN_REVIEW' end;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action, completed_at
  ) values (
    v_issue.id,
    'INCIDENT_' || v_action,
    trim(p_idempotency_key),
    v_principal.id,
    p_expected_record_version,
    'SUCCEEDED',
    case
      when v_action = 'ACKNOWLEDGE' then 'Incident acknowledgement persisted.'
      when v_action = 'SNOOZE' then 'Incident follow-up window persisted.'
      else 'Incident resolution and recovery evidence persisted.'
    end,
    p_correlation_id,
    jsonb_build_array(jsonb_build_object('incidentId', v_incident.id, 'incidentStatus', case when v_action = 'RESOLVE' then 'RESOLVED' when v_action = 'SNOOZE' then 'MONITORING' else v_incident.status end)),
    '[]'::jsonb,
    case when v_action = 'SNOOZE' then 'Reassess the incident before the snooze expires.' else null end,
    v_now
  ) returning * into v_receipt;

  update public.service_incidents
  set acknowledgement_required = false,
      acknowledged_at = coalesce(acknowledged_at, v_now),
      acknowledged_by_principal_id = coalesce(acknowledged_by_principal_id, v_principal.id),
      status = case when v_action = 'RESOLVE' then 'RESOLVED' when v_action = 'SNOOZE' then 'MONITORING' else status end,
      snoozed_until = case when v_action = 'SNOOZE' then p_snooze_until when v_action = 'RESOLVE' then null else snoozed_until end,
      snooze_reason = case when v_action = 'SNOOZE' then v_reason when v_action = 'RESOLVE' then null else snooze_reason end,
      snoozed_by_principal_id = case when v_action = 'SNOOZE' then v_principal.id when v_action = 'RESOLVE' then null else snoozed_by_principal_id end,
      resolved_at = case when v_action = 'RESOLVE' then v_now else resolved_at end
  where id = v_incident.id;

  update public.ops_issues
  set canonical_status = v_next_status,
      status = v_case_status,
      assigned_principal_id = coalesce(assigned_principal_id, v_principal.id),
      assigned_to = coalesce(assigned_to, trim(p_actor_label)),
      claimed_at = coalesce(claimed_at, v_now),
      first_responded_at = coalesce(first_responded_at, v_now),
      scheduled_follow_up_at = case when v_action = 'SNOOZE' then p_snooze_until else null end,
      resolved_at = case when v_action = 'RESOLVE' then v_now else resolved_at end,
      closed_at = case when v_action = 'RESOLVE' then v_now else closed_at end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'lastIncidentAction', v_action,
        'lastIncidentActionAt', v_now,
        'lastIncidentActionReason', nullif(v_reason, ''),
        'incidentSnoozedUntil', case when v_action = 'SNOOZE' then p_snooze_until else null end
      )
  where id = v_issue.id
    and record_version = p_expected_record_version;

  if not found then
    raise exception 'Incident case changed while the action was being applied.' using errcode = '40001';
  end if;

  select * into v_issue from public.ops_issues where id = v_issue.id;
  select * into v_incident from public.service_incidents where id = v_incident.id;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    v_issue.id,
    'STATE_TRANSITION',
    'INTERNAL',
    v_issue.sensitivity,
    v_principal.id,
    trim(p_actor_label),
    v_previous_status,
    v_next_status,
    case
      when v_action = 'ACKNOWLEDGE' then 'A named operator acknowledged the incident.'
      when v_action = 'SNOOZE' then 'A named operator scheduled a bounded incident follow-up.'
      else 'A named operator resolved the incident after recovery evidence was recorded.'
    end,
    jsonb_build_object('action', v_action, 'reason', nullif(v_reason, ''), 'snoozedUntil', case when v_action = 'SNOOZE' then p_snooze_until else null end, 'incidentStatus', v_incident.status),
    'incident-action:' || v_receipt.id::text,
    p_correlation_id,
    v_now
  );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    v_issue.id,
    'INCIDENT_' || v_action,
    trim(p_actor_label),
    array_to_string(v_principal.roles, ','),
    nullif(v_reason, ''),
    jsonb_build_object('caseStatus', v_previous_status, 'recordVersion', p_expected_record_version),
    jsonb_build_object('caseStatus', v_issue.canonical_status, 'incidentStatus', v_incident.status, 'recordVersion', v_issue.record_version),
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
    'incidentStatus', v_incident.status,
    'caseStatus', v_issue.canonical_status,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.perform_ops_incident_action(uuid,text,text,timestamptz,bigint,text,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.perform_ops_incident_action(uuid,text,text,timestamptz,bigint,text,uuid,text,text,uuid)
  to service_role;

comment on function public.perform_ops_incident_action(uuid,text,text,timestamptz,bigint,text,uuid,text,text,uuid) is
  'Named, idempotent, environment-bound incident acknowledgement, bounded snooze, and recovery-gated resolution boundary.';
