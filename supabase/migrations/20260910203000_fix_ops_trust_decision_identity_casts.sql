-- Forward-only correction: ops_issues keeps legacy related identifiers as
-- text, while tailor_profiles uses UUIDs. Compare canonical string forms so a
-- valid review can pass without weakening the identity binding.

create or replace function public.prepare_ops_trust_verification_decision(
  p_issue_id uuid,
  p_profile_id uuid,
  p_tailor_user_id uuid,
  p_decision text,
  p_reason text,
  p_rejection_code text,
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
  v_decision text := upper(trim(coalesce(p_decision, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_rejection_code text := nullif(upper(trim(coalesce(p_rejection_code, ''))), '');
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_principal public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
begin
  if v_decision not in ('APPROVE', 'REJECT') then
    raise exception 'Unsupported trust decision.' using errcode = '22023';
  end if;
  if p_issue_id is null or p_profile_id is null or p_tailor_user_id is null or p_actor_principal_id is null or p_correlation_id is null then
    raise exception 'Case, profile, tailor, workforce principal, and correlation ID are required.' using errcode = '22023';
  end if;
  if p_sensitive_assurance is distinct from true then
    raise exception 'Fresh sensitive assurance is required.' using errcode = '42501';
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
  if v_decision = 'REJECT' and (length(v_reason) < 8 or length(v_reason) > 1000) then
    raise exception 'A specific rejection reason between 8 and 1000 characters is required.' using errcode = '22023';
  end if;
  if v_rejection_code is not null and v_rejection_code <> 'INVALID_PROFILE_IMAGE' then
    raise exception 'Unsupported trust rejection code.' using errcode = '22023';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;
  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or not (v_principal.roles && array['admin','trust']::text[])
  then
    raise exception 'Workforce principal is not authorized for trust decisions.' using errcode = '42501';
  end if;
  if public.current_ops_environment() <> v_environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;

  select * into v_issue
  from public.ops_issues
  where id = p_issue_id
  for update;
  if v_issue.id is null
    or v_issue.issue_type <> 'TAILOR_VERIFICATION'
    or v_issue.tailor_profile_id is distinct from p_profile_id::text
    or coalesce(v_issue.user_id, v_issue.actor_id) is distinct from p_tailor_user_id::text
    or v_issue.environment <> v_environment
    or v_issue.provenance = 'UNKNOWN'
  then
    raise exception 'Case is not an actionable tailor trust review in this environment.' using errcode = '42501';
  end if;

  select * into v_receipt
  from public.ops_action_receipts
  where issue_id = p_issue_id and idempotency_key = trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object('duplicate', true, 'receiptId', v_receipt.id, 'receiptOutcome', v_receipt.outcome, 'recordVersion', v_receipt.resulting_record_version, 'correlationId', v_receipt.correlation_id);
  end if;
  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%', v_issue.record_version using errcode = '40001';
  end if;
  if v_issue.canonical_status in ('RESOLVED', 'CLOSED') then
    raise exception 'Trust case is already terminal.' using errcode = '55000';
  end if;

  select * into v_profile
  from public.tailor_profiles
  where id = p_profile_id and user_id = p_tailor_user_id
  for share;
  if v_profile.id is null or v_profile.id_verification_status <> 'PENDING' then
    raise exception 'Tailor trust review is no longer pending.' using errcode = '55000';
  end if;
  if nullif(trim(v_profile.trust_verification_video_path), '') is null then
    raise exception 'Private challenge video is unavailable.' using errcode = '55000';
  end if;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action
  ) values (
    p_issue_id,
    'TRUST_VERIFICATION_' || v_decision,
    trim(p_idempotency_key),
    p_actor_principal_id,
    p_expected_record_version,
    'PENDING',
    'The protected trust decision passed preflight and is awaiting its authoritative domain outcome.',
    p_correlation_id,
    '[]'::jsonb,
    '[]'::jsonb,
    'Apply the verification domain transition and record customer communication outcomes.'
  ) returning * into v_receipt;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id
  ) values (
    p_issue_id,
    'DECISION',
    'INTERNAL',
    'HIGHLY_RESTRICTED',
    p_actor_principal_id,
    trim(p_actor_label),
    v_issue.canonical_status,
    v_issue.canonical_status,
    'Protected tailor trust decision prepared for authoritative execution.',
    jsonb_build_object('decision', v_decision, 'reason', nullif(v_reason, ''), 'rejectionCode', v_rejection_code),
    'trust-decision-prepared:' || v_receipt.id::text,
    p_correlation_id
  );

  return jsonb_build_object(
    'duplicate', false,
    'receiptId', v_receipt.id,
    'receiptOutcome', v_receipt.outcome,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.prepare_ops_trust_verification_decision(uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_ops_trust_verification_decision(uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,boolean,uuid)
  to service_role;
