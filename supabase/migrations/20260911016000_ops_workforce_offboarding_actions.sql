-- Protected workforce offboarding with immediate Drapeon revocation and a
-- separate checker-owned external-access verification step.

create or replace function public.perform_ops_workforce_offboarding_action(
  p_target_principal_id uuid,
  p_action text,
  p_reason text,
  p_expected_target_updated_at timestamptz,
  p_expected_case_version bigint,
  p_evidence_refs jsonb,
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
  v_dedupe_key text;
  v_action_key text;
  v_actor public.ops_workforce_principals%rowtype;
  v_target public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_issue_id uuid;
  v_receipt public.ops_action_receipts%rowtype;
  v_initial_actor_id uuid;
  v_previous_status text;
  v_push_count integer := 0;
  v_now timestamptz := now();
  v_evidence record;
begin
  if v_action not in ('REVOKE_DRAPEON_ACCESS', 'VERIFY_EXTERNAL_OFFBOARDING') then
    raise exception 'Unsupported workforce offboarding action.' using errcode = '22023';
  end if;
  v_action_key := case v_action
    when 'REVOKE_DRAPEON_ACCESS' then 'WORKFORCE_REVOKE_DRAPEON_ACCESS'
    else 'WORKFORCE_VERIFY_EXTERNAL_OFFBOARDING'
  end;
  if p_target_principal_id is null or p_actor_principal_id is null or p_correlation_id is null then
    raise exception 'Target, workforce actor, and correlation ID are required.' using errcode = '22023';
  end if;
  if p_target_principal_id = p_actor_principal_id then
    raise exception 'Workforce access changes require a different named operator.' using errcode = '42501';
  end if;
  if p_expected_target_updated_at is null then
    raise exception 'The expected target version is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 16 or length(p_idempotency_key) > 180 then
    raise exception 'A bounded idempotency key is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_actor_label, ''))) < 3 or length(p_actor_label) > 180 then
    raise exception 'A named workforce actor is required.' using errcode = '22023';
  end if;
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION')
    or public.current_ops_environment() <> v_environment
  then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;
  if coalesce(p_sensitive_assurance, false) is not true then
    raise exception 'Fresh protected workforce assurance is required.' using errcode = '42501';
  end if;
  if length(v_reason) < 12 or length(v_reason) > 1000 then
    raise exception 'A reason between 12 and 1000 characters is required.' using errcode = '22023';
  end if;

  -- Principal rows are always locked in UUID order so two concurrent access
  -- changes cannot acquire actor/target locks in opposite order.
  perform 1
  from public.ops_workforce_principals
  where id in (p_actor_principal_id, p_target_principal_id)
  order by id
  for update;

  select * into v_actor
  from public.ops_workforce_principals
  where id = p_actor_principal_id;

  select * into v_target
  from public.ops_workforce_principals
  where id = p_target_principal_id;

  if v_actor.id is null
    or v_actor.status <> 'ACTIVE'
    or not ('admin' = any(v_actor.roles))
    or not (lower(v_environment) = any(v_actor.permitted_environments))
    or v_actor.access_review_due_at is null
    or v_actor.access_review_due_at <= v_now
  then
    raise exception 'An active, reviewed admin principal is required.' using errcode = '42501';
  end if;
  if v_target.id is null
    or not (lower(v_environment) = any(v_target.permitted_environments))
  then
    raise exception 'The target principal is unavailable in this environment.' using errcode = '42501';
  end if;

  v_dedupe_key := 'workforce-offboarding:' || lower(v_environment) || ':' || v_target.id::text;

  insert into public.ops_issues (
    issue_type, severity, status, source, related_entity_type,
    related_entity_id, title, description, recommended_action, dedupe_key,
    metadata, queue_key, owning_team, priority, sensitivity, environment,
    canonical_status, provenance, correlation_id
  ) values (
    'SYSTEM_ALERT', 'HIGH', 'OPEN', 'ops_workforce_principals', 'workforce_principal',
    v_target.id::text, 'Workforce offboarding',
    'A named workforce principal requires immediate access revocation and verified offboarding across connected staff systems.',
    'Revoke Drapeon access, then have a different admin verify the retained external-system evidence.',
    v_dedupe_key,
    jsonb_build_object('targetPrincipalId', v_target.id, 'phase', 'REVOCATION_REQUIRED'),
    'operations', 'ops', 'P1', 'HIGHLY_RESTRICTED', v_environment,
    'NEW', 'STAFF', p_correlation_id
  )
  on conflict (dedupe_key) do nothing;

  select * into v_issue
  from public.ops_issues
  where dedupe_key = v_dedupe_key
  for update;

  if v_issue.id is null
    or v_issue.environment <> v_environment
    or v_issue.provenance = 'UNKNOWN'
  then
    raise exception 'The workforce offboarding case is unavailable.' using errcode = '42501';
  end if;
  v_issue_id := v_issue.id;

  select * into v_receipt
  from public.ops_action_receipts
  where issue_id = v_issue_id
    and idempotency_key = trim(p_idempotency_key);
  if v_receipt.id is not null then
    if v_receipt.action_key <> v_action_key then
      raise exception 'The idempotency key belongs to a different workforce action.' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'duplicate', true,
      'receiptId', v_receipt.id,
      'receiptOutcome', v_receipt.outcome,
      'caseId', v_issue.id,
      'caseNumber', v_issue.case_number,
      'caseStatus', v_issue.canonical_status,
      'recordVersion', v_issue.record_version,
      'correlationId', v_receipt.correlation_id
    );
  end if;

  if v_target.updated_at <> p_expected_target_updated_at then
    raise exception 'WORKFORCE_TARGET_VERSION_CONFLICT' using errcode = '40001';
  end if;

  if v_action = 'REVOKE_DRAPEON_ACCESS' then
    if v_target.status = 'REVOKED' then
      raise exception 'The workforce principal is already revoked.' using errcode = '55000';
    end if;
    v_previous_status := v_issue.canonical_status;

    update public.ops_workforce_principals
    set status = 'REVOKED',
        session_revoked_before = v_now,
        revoked_by = trim(p_actor_label),
        revoked_at = v_now,
        revocation_reason = v_reason
    where id = v_target.id
      and updated_at = p_expected_target_updated_at;
    if not found then
      raise exception 'WORKFORCE_TARGET_VERSION_CONFLICT' using errcode = '40001';
    end if;

    update public.web_push_subscriptions
    set enabled = false,
        failed_at = coalesce(failed_at, v_now),
        failure_reason = 'WORKFORCE_ACCESS_REVOKED'
    where audience = 'OPS'
      and ops_principal_id = v_target.id
      and enabled = true;
    get diagnostics v_push_count = row_count;

    update public.ops_issues
    set status = 'IN_REVIEW',
        canonical_status = 'SCHEDULED_FOLLOW_UP',
        assigned_principal_id = v_actor.id,
        assigned_to = trim(p_actor_label),
        claimed_at = coalesce(claimed_at, v_now),
        first_responded_at = coalesce(first_responded_at, v_now),
        scheduled_follow_up_at = v_now,
        recommended_action = 'A different admin must verify Access/IdP, collaboration tools, provider dashboards, and scoped credentials with retained evidence references.',
        metadata = metadata || jsonb_build_object(
          'phase', 'EXTERNAL_VERIFICATION_REQUIRED',
          'drapeonRevokedAt', v_now,
          'disabledPushSubscriptions', v_push_count
        ),
        last_seen_at = v_now
    where id = v_issue_id;

    select * into v_issue from public.ops_issues where id = v_issue_id;

    insert into public.ops_action_receipts (
      issue_id, action_key, idempotency_key, actor_principal_id,
      expected_record_version, resulting_record_version, outcome, human_status,
      correlation_id, side_effects, blockers, next_action, completed_at
    ) values (
      v_issue.id, 'WORKFORCE_REVOKE_DRAPEON_ACCESS', trim(p_idempotency_key), v_actor.id,
      v_issue.record_version - 1, v_issue.record_version, 'SUCCEEDED',
      'Drapeon workforce sessions and Ops push delivery were revoked; external access verification remains due.',
      p_correlation_id,
      jsonb_build_array(
        jsonb_build_object('type', 'WORKFORCE_PRINCIPAL', 'status', 'REVOKED'),
        jsonb_build_object('type', 'INTERNAL_SESSION_CUTOFF', 'status', 'RECORDED'),
        jsonb_build_object('type', 'OPS_PUSH_SUBSCRIPTIONS', 'status', 'DISABLED', 'count', v_push_count)
      ),
      jsonb_build_array(
        jsonb_build_object('code', 'ACCESS_IDP_VERIFICATION_REQUIRED'),
        jsonb_build_object('code', 'COLLABORATION_TOOLS_VERIFICATION_REQUIRED'),
        jsonb_build_object('code', 'PROVIDER_DASHBOARDS_VERIFICATION_REQUIRED'),
        jsonb_build_object('code', 'SCOPED_CREDENTIALS_VERIFICATION_REQUIRED')
      ),
      'A different admin must record evidence references for every external offboarding control.',
      v_now
    ) returning * into v_receipt;

    insert into public.ops_case_events (
      issue_id, event_type, visibility, sensitivity, actor_principal_id,
      actor_label, from_status, to_status, summary, payload,
      idempotency_key, correlation_id, occurred_at
    ) values (
      v_issue.id, 'AUDIT_SECURITY', 'INTERNAL', 'HIGHLY_RESTRICTED', v_actor.id,
      trim(p_actor_label), v_previous_status, 'SCHEDULED_FOLLOW_UP',
      'Drapeon workforce access was revoked; independent external-system verification is required.',
      jsonb_build_object('targetPrincipalId', v_target.id, 'disabledPushSubscriptions', v_push_count),
      'workforce-offboarding:' || v_receipt.id::text,
      p_correlation_id, v_now
    );

    insert into public.ops_audit_logs (
      issue_id, action_taken, performed_by, performed_role, reason,
      before_state, after_state, created_at
    ) values (
      v_issue.id, 'WORKFORCE_REVOKE_DRAPEON_ACCESS', trim(p_actor_label),
      array_to_string(v_actor.roles, ','), v_reason,
      jsonb_build_object('targetPrincipalId', v_target.id, 'status', v_target.status),
      jsonb_build_object('targetPrincipalId', v_target.id, 'status', 'REVOKED', 'disabledPushSubscriptions', v_push_count),
      v_now
    );
  else
    if v_target.status <> 'REVOKED' then
      raise exception 'Drapeon access must be revoked before external offboarding can be verified.' using errcode = '55000';
    end if;
    if p_expected_case_version is null or p_expected_case_version < 1
      or v_issue.record_version <> p_expected_case_version
    then
      raise exception 'WORKFORCE_CASE_VERSION_CONFLICT:%', v_issue.record_version using errcode = '40001';
    end if;
    if v_issue.canonical_status in ('RESOLVED', 'CLOSED') then
      raise exception 'The workforce offboarding case is already terminal.' using errcode = '55000';
    end if;

    select actor_principal_id into v_initial_actor_id
    from public.ops_action_receipts
    where issue_id = v_issue.id
      and action_key = 'WORKFORCE_REVOKE_DRAPEON_ACCESS'
      and outcome = 'SUCCEEDED'
    order by completed_at desc, id desc
    limit 1;
    if v_initial_actor_id is null then
      raise exception 'The Drapeon revocation receipt is missing.' using errcode = '55000';
    end if;
    if v_initial_actor_id = v_actor.id then
      raise exception 'The revoking operator cannot verify external offboarding.' using errcode = '42501';
    end if;
    if jsonb_typeof(coalesce(p_evidence_refs, 'null'::jsonb)) <> 'object'
      or not (p_evidence_refs ?& array['accessProvider','collaborationTools','providerDashboards','scopedCredentials'])
      or (p_evidence_refs - array['accessProvider','collaborationTools','providerDashboards','scopedCredentials']) <> '{}'::jsonb
    then
      raise exception 'Four exact external evidence references are required.' using errcode = '22023';
    end if;
    for v_evidence in select * from jsonb_each_text(p_evidence_refs)
    loop
      if v_evidence.value is null
        or length(trim(v_evidence.value)) < 8
        or length(v_evidence.value) > 255
        or position('://' in trim(v_evidence.value)) > 0
        or trim(v_evidence.value) !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,254}$'
      then
        raise exception 'Every evidence reference must be a bounded stable identifier.' using errcode = '22023';
      end if;
    end loop;

    update public.ops_issues
    set status = 'RESOLVED',
        canonical_status = 'RESOLVED',
        resolved_at = v_now,
        closed_at = null,
        scheduled_follow_up_at = null,
        recommended_action = 'No action. Reopen only if an access source is found to remain active.',
        metadata = metadata || jsonb_build_object(
          'phase', 'OFFBOARDING_VERIFIED',
          'externalEvidenceRefs', p_evidence_refs,
          'verifiedAt', v_now,
          'verifiedByPrincipalId', v_actor.id
        ),
        last_seen_at = v_now
    where id = v_issue_id
      and record_version = p_expected_case_version;
    if not found then
      raise exception 'WORKFORCE_CASE_VERSION_CONFLICT' using errcode = '40001';
    end if;

    select * into v_issue from public.ops_issues where id = v_issue_id;

    insert into public.ops_action_receipts (
      issue_id, action_key, idempotency_key, actor_principal_id,
      expected_record_version, resulting_record_version, outcome, human_status,
      correlation_id, side_effects, blockers, next_action, completed_at
    ) values (
      v_issue.id, 'WORKFORCE_VERIFY_EXTERNAL_OFFBOARDING', trim(p_idempotency_key), v_actor.id,
      p_expected_case_version, v_issue.record_version, 'SUCCEEDED',
      'Independent evidence references were recorded for every external offboarding control.',
      p_correlation_id,
      jsonb_build_array(
        jsonb_build_object('type', 'ACCESS_IDP', 'status', 'EVIDENCE_RECORDED'),
        jsonb_build_object('type', 'COLLABORATION_TOOLS', 'status', 'EVIDENCE_RECORDED'),
        jsonb_build_object('type', 'PROVIDER_DASHBOARDS', 'status', 'EVIDENCE_RECORDED'),
        jsonb_build_object('type', 'SCOPED_CREDENTIALS', 'status', 'EVIDENCE_RECORDED')
      ),
      '[]'::jsonb, null, v_now
    ) returning * into v_receipt;

    insert into public.ops_case_events (
      issue_id, event_type, visibility, sensitivity, actor_principal_id,
      actor_label, from_status, to_status, summary, payload,
      idempotency_key, correlation_id, occurred_at
    ) values (
      v_issue.id, 'AUDIT_SECURITY', 'INTERNAL', 'HIGHLY_RESTRICTED', v_actor.id,
      trim(p_actor_label), 'SCHEDULED_FOLLOW_UP', 'RESOLVED',
      'A second administrator verified retained evidence for every external offboarding control.',
      jsonb_build_object('targetPrincipalId', v_target.id, 'evidenceRefs', p_evidence_refs),
      'workforce-offboarding:' || v_receipt.id::text,
      p_correlation_id, v_now
    );

    insert into public.ops_audit_logs (
      issue_id, action_taken, performed_by, performed_role, reason,
      before_state, after_state, created_at
    ) values (
      v_issue.id, 'WORKFORCE_VERIFY_EXTERNAL_OFFBOARDING', trim(p_actor_label),
      array_to_string(v_actor.roles, ','), v_reason,
      jsonb_build_object('caseStatus', 'SCHEDULED_FOLLOW_UP', 'recordVersion', p_expected_case_version),
      jsonb_build_object('caseStatus', v_issue.canonical_status, 'recordVersion', v_issue.record_version, 'evidenceRefs', p_evidence_refs),
      v_now
    );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'receiptId', v_receipt.id,
    'receiptOutcome', v_receipt.outcome,
    'humanStatus', v_receipt.human_status,
    'caseId', v_issue.id,
    'caseNumber', v_issue.case_number,
    'caseStatus', v_issue.canonical_status,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.perform_ops_workforce_offboarding_action(uuid,text,text,timestamptz,bigint,jsonb,text,uuid,text,text,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.perform_ops_workforce_offboarding_action(uuid,text,text,timestamptz,bigint,jsonb,text,uuid,text,text,boolean,uuid)
  to service_role;

comment on function public.perform_ops_workforce_offboarding_action(uuid,text,text,timestamptz,bigint,jsonb,text,uuid,text,text,boolean,uuid) is
  'Admin-only, maker-checker workforce offboarding boundary: immediately revokes Drapeon sessions and Ops push, then requires independently evidenced external-system verification.';
