-- Drapeon commercial architecture, implementation 4.
-- Named, MFA-backed JIT elevation and maker-checker approval foundation.

create table public.money_desk_jit_grants (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  actor_subject text not null,
  actor_role text not null check (actor_role in ('OPS', 'CUSTOMER_SUCCESS', 'TRUST', 'FINANCE', 'ENGINEERING', 'ADMIN')),
  assurance_source text not null check (assurance_source in ('CLOUDFLARE_ACCESS', 'MIGRATION_DRY_RUN')),
  authentication_methods text[] not null default '{}',
  action_scopes text[] not null,
  reason text not null check (char_length(reason) between 12 and 500),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '15 minutes'),
  check (cardinality(action_scopes) > 0)
);

create table public.money_desk_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('MD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  idempotency_key text not null unique,
  request_hash text not null,
  action_type text not null check (action_type in (
    'PAYOUT_RELEASE', 'MATERIAL_ADVANCE_RELEASE', 'CUSTOMER_REFUND',
    'PAYOUT_DESTINATION_CHANGE', 'MANUAL_FX', 'POST_RELEASE_RECOVERY',
    'POLICY_OVERRIDE', 'OTHER_REVIEWED'
  )),
  status text not null default 'PENDING_APPROVAL' check (status in (
    'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTING',
    'SUCCEEDED', 'FAILED', 'CANCELLED'
  )),
  target_type text not null,
  target_id text not null,
  order_id text references public.orders(id) on delete restrict,
  case_id uuid references public.financial_cases(id) on delete restrict,
  amount integer check (amount is null or amount > 0),
  currency currency,
  amount_usd_equivalent integer check (amount_usd_equivalent is null or amount_usd_equivalent >= 0),
  usd_equivalent_source text,
  reason text not null check (char_length(reason) between 12 and 1000),
  action_payload jsonb not null default '{}'::jsonb,
  requester_email text not null,
  requester_subject text not null,
  requester_role text not null check (requester_role in ('OPS', 'CUSTOMER_SUCCESS', 'TRUST', 'FINANCE', 'ENGINEERING', 'ADMIN')),
  requester_jit_grant_id uuid not null references public.money_desk_jit_grants(id) on delete restrict,
  risk_level text not null check (risk_level in ('STANDARD', 'HIGH')),
  risk_reasons text[] not null default '{}',
  required_approval_count integer not null check (required_approval_count in (1, 2)),
  approval_count integer not null default 0 check (approval_count >= 0 and approval_count <= 2),
  policy_version text not null default 'commercial-2026-07-31-v1',
  correlation_id uuid not null default gen_random_uuid(),
  approved_at timestamptz,
  rejected_at timestamptz,
  executing_at timestamptz,
  terminal_at timestamptz,
  execution_outcome text check (execution_outcome is null or execution_outcome in ('SUCCEEDED', 'FAILED', 'BLOCKED')),
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((amount is null) = (currency is null)),
  check ((status = 'APPROVED') = (approved_at is not null) or status in ('EXECUTING', 'SUCCEEDED', 'FAILED')),
  check ((status = 'REJECTED') = (rejected_at is not null)),
  check ((status in ('SUCCEEDED', 'FAILED')) = (terminal_at is not null))
);

create table public.money_desk_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.money_desk_requests(id) on delete restrict,
  decision text not null check (decision in ('APPROVE', 'REJECT')),
  approver_email text not null,
  approver_subject text not null,
  approver_role text not null check (approver_role in ('FINANCE', 'ADMIN')),
  approver_jit_grant_id uuid not null references public.money_desk_jit_grants(id) on delete restrict,
  reason text not null check (char_length(reason) between 12 and 1000),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (request_id, approver_email)
);

create table public.money_desk_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.money_desk_requests(id) on delete restrict,
  idempotency_key text not null unique,
  executor_email text not null,
  executor_subject text not null,
  executor_role text not null check (executor_role in ('FINANCE', 'ADMIN')),
  executor_jit_grant_id uuid not null references public.money_desk_jit_grants(id) on delete restrict,
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'SUCCEEDED', 'FAILED', 'BLOCKED')),
  provider_reference text,
  failure_code text,
  failure_summary text,
  correlation_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'PROCESSING') = (completed_at is null))
);

create table public.money_desk_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.money_desk_requests(id) on delete restrict,
  event_type text not null check (event_type in (
    'REQUEST_SUBMITTED', 'APPROVAL_RECORDED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
    'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED', 'EXECUTION_FAILED', 'EXECUTION_BLOCKED',
    'REQUEST_CANCELLED'
  )),
  actor_email text not null,
  actor_role text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index money_desk_jit_actor_expiry_idx on public.money_desk_jit_grants(actor_email, expires_at desc);
create index money_desk_requests_queue_idx on public.money_desk_requests(status, risk_level, created_at);
create index money_desk_requests_order_idx on public.money_desk_requests(order_id, created_at desc);
create index money_desk_decisions_request_idx on public.money_desk_decisions(request_id, created_at);
create index money_desk_attempts_request_idx on public.money_desk_execution_attempts(request_id, started_at desc);
create index money_desk_events_request_idx on public.money_desk_events(request_id, created_at);

create or replace function public.prevent_money_desk_append_only_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Money Desk decisions and events are append-only.';
end;
$$;

create trigger money_desk_decisions_append_only before update or delete on public.money_desk_decisions
  for each row execute function public.prevent_money_desk_append_only_mutation();
create trigger money_desk_events_append_only before update or delete on public.money_desk_events
  for each row execute function public.prevent_money_desk_append_only_mutation();

create or replace function public.protect_money_desk_request_claim()
returns trigger language plpgsql as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.action_type is distinct from old.action_type
    or new.target_type is distinct from old.target_type
    or new.target_id is distinct from old.target_id
    or new.order_id is distinct from old.order_id
    or new.case_id is distinct from old.case_id
    or new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.amount_usd_equivalent is distinct from old.amount_usd_equivalent
    or new.usd_equivalent_source is distinct from old.usd_equivalent_source
    or new.reason is distinct from old.reason
    or new.action_payload is distinct from old.action_payload
    or new.requester_email is distinct from old.requester_email
    or new.requester_subject is distinct from old.requester_subject
    or new.requester_role is distinct from old.requester_role
    or new.requester_jit_grant_id is distinct from old.requester_jit_grant_id
    or new.risk_level is distinct from old.risk_level
    or new.risk_reasons is distinct from old.risk_reasons
    or new.required_approval_count is distinct from old.required_approval_count
    or new.policy_version is distinct from old.policy_version
    or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Money Desk request claims are immutable.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger money_desk_request_claim_immutable before update on public.money_desk_requests
  for each row execute function public.protect_money_desk_request_claim();

alter table public.money_desk_jit_grants enable row level security;
alter table public.money_desk_requests enable row level security;
alter table public.money_desk_decisions enable row level security;
alter table public.money_desk_execution_attempts enable row level security;
alter table public.money_desk_events enable row level security;
revoke all on public.money_desk_jit_grants, public.money_desk_requests, public.money_desk_decisions,
  public.money_desk_execution_attempts, public.money_desk_events from public, anon, authenticated;
grant select, insert, update on public.money_desk_jit_grants to service_role;
grant select, insert, update on public.money_desk_requests to service_role;
grant select, insert on public.money_desk_decisions to service_role;
grant select, insert, update on public.money_desk_execution_attempts to service_role;
grant select, insert on public.money_desk_events to service_role;

create or replace function public.assert_money_desk_jit(
  p_grant_id uuid, p_actor_email text, p_actor_subject text, p_actor_role text, p_action_type text
)
returns public.money_desk_jit_grants
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_grant public.money_desk_jit_grants%rowtype;
begin
  select * into v_grant from public.money_desk_jit_grants where id = p_grant_id for update;
  if v_grant.id is null then raise exception 'Money Desk elevation was not found.'; end if;
  if v_grant.revoked_at is not null or v_grant.expires_at <= now() then raise exception 'Money Desk elevation expired.'; end if;
  if lower(v_grant.actor_email) <> lower(trim(p_actor_email))
    or v_grant.actor_subject <> trim(p_actor_subject)
    or v_grant.actor_role <> upper(trim(p_actor_role)) then
    raise exception 'Money Desk elevation does not belong to this workforce identity.';
  end if;
  if not (p_action_type = any(v_grant.action_scopes)) then raise exception 'Money Desk elevation does not cover this action.'; end if;
  return v_grant;
end;
$$;

create or replace function public.issue_money_desk_jit_grant(
  p_actor_email text, p_actor_subject text, p_actor_role text, p_assurance_source text,
  p_authentication_methods text[], p_action_scopes text[], p_reason text,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_grant public.money_desk_jit_grants%rowtype;
begin
  if nullif(trim(p_actor_email), '') is null or nullif(trim(p_actor_subject), '') is null then raise exception 'Named workforce identity is required.'; end if;
  if upper(trim(p_actor_role)) not in ('OPS', 'CUSTOMER_SUCCESS', 'FINANCE', 'ADMIN') then raise exception 'This role cannot request Money Desk elevation.'; end if;
  if p_assurance_source not in ('CLOUDFLARE_ACCESS', 'MIGRATION_DRY_RUN') then raise exception 'Unsupported identity assurance source.'; end if;
  if p_assurance_source = 'CLOUDFLARE_ACCESS' and not (p_authentication_methods && array['mfa','hwk','swk','otp','face','fpt','iris','retina','vbm']) then
    raise exception 'MFA-backed workforce access is required.';
  end if;
  if cardinality(p_action_scopes) is null or cardinality(p_action_scopes) = 0 then raise exception 'Choose at least one Money Desk action scope.'; end if;
  if exists (select 1 from unnest(p_action_scopes) s where s not in (
    'PAYOUT_RELEASE','MATERIAL_ADVANCE_RELEASE','CUSTOMER_REFUND','PAYOUT_DESTINATION_CHANGE',
    'MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED')) then
    raise exception 'Invalid Money Desk action scope.';
  end if;
  if char_length(trim(p_reason)) not between 12 and 500 then raise exception 'Elevation reason must be 12 to 500 characters.'; end if;

  insert into public.money_desk_jit_grants (
    actor_email, actor_subject, actor_role, assurance_source, authentication_methods,
    action_scopes, reason, expires_at, correlation_id
  ) values (
    lower(trim(p_actor_email)), trim(p_actor_subject), upper(trim(p_actor_role)), p_assurance_source,
    p_authentication_methods, p_action_scopes, trim(p_reason), now() + interval '15 minutes', p_correlation_id
  ) returning * into v_grant;
  return jsonb_build_object('grantId', v_grant.id, 'expiresAt', v_grant.expires_at, 'correlationId', v_grant.correlation_id);
end;
$$;

create or replace function public.submit_money_desk_request(
  p_idempotency_key text, p_jit_grant_id uuid, p_actor_email text, p_actor_subject text,
  p_actor_role text, p_action_type text, p_target_type text, p_target_id text,
  p_order_id text, p_case_id uuid, p_amount integer, p_currency currency,
  p_amount_usd_equivalent integer, p_usd_equivalent_source text, p_reason text,
  p_action_payload jsonb, p_correlation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_hash text;
  v_required integer;
  v_risk text;
  v_reasons text[] := array[]::text[];
begin
  perform public.assert_money_desk_jit(p_jit_grant_id, p_actor_email, p_actor_subject, p_actor_role, p_action_type);
  if p_action_type not in ('PAYOUT_RELEASE','MATERIAL_ADVANCE_RELEASE','CUSTOMER_REFUND','PAYOUT_DESTINATION_CHANGE','MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED') then raise exception 'Invalid Money Desk action.'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 12 and 1000 then raise exception 'Money Desk reason must be 12 to 1000 characters.'; end if;
  if (p_amount is null) <> (p_currency is null) then raise exception 'Amount and currency must be supplied together.'; end if;

  if p_action_type in ('PAYOUT_DESTINATION_CHANGE','MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED') then
    v_reasons := array_append(v_reasons, 'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL');
  end if;
  if p_amount_usd_equivalent is null then
    v_reasons := array_append(v_reasons, 'USD_EQUIVALENT_UNRESOLVED');
  elsif p_amount_usd_equivalent >= 50000 then
    v_reasons := array_append(v_reasons, 'USD_500_EQUIVALENT_OR_MORE');
  end if;
  v_required := case when cardinality(v_reasons) > 0 then 2 else 1 end;
  v_risk := case when v_required = 2 then 'HIGH' else 'STANDARD' end;

  v_hash := encode(digest(concat_ws('|', p_action_type, p_target_type, p_target_id,
    coalesce(p_order_id,''), coalesce(p_case_id::text,''), coalesce(p_amount::text,''),
    coalesce(p_currency::text,''), coalesce(p_amount_usd_equivalent::text,''), trim(p_reason),
    coalesce(p_action_payload,'{}'::jsonb)::text), 'sha256'), 'hex');

  select * into v_request from public.money_desk_requests where idempotency_key = p_idempotency_key;
  if v_request.id is not null then
    if v_request.request_hash <> v_hash then raise exception 'Money Desk idempotency key was reused with different values.'; end if;
    return jsonb_build_object('requestId',v_request.id,'reference',v_request.reference,'status',v_request.status,
      'requiredApprovalCount',v_request.required_approval_count,'riskLevel',v_request.risk_level,'duplicate',true);
  end if;

  insert into public.money_desk_requests (
    idempotency_key, request_hash, action_type, target_type, target_id, order_id, case_id,
    amount, currency, amount_usd_equivalent, usd_equivalent_source, reason, action_payload,
    requester_email, requester_subject, requester_role, requester_jit_grant_id,
    risk_level, risk_reasons, required_approval_count, correlation_id
  ) values (
    p_idempotency_key, v_hash, p_action_type, trim(p_target_type), trim(p_target_id), p_order_id, p_case_id,
    p_amount, p_currency, p_amount_usd_equivalent, nullif(trim(coalesce(p_usd_equivalent_source,'')),''),
    trim(p_reason), coalesce(p_action_payload,'{}'::jsonb), lower(trim(p_actor_email)), trim(p_actor_subject),
    upper(trim(p_actor_role)), p_jit_grant_id, v_risk, v_reasons, v_required, p_correlation_id
  ) returning * into v_request;

  insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (v_request.id,'REQUEST_SUBMITTED',v_request.requester_email,v_request.requester_role,
    jsonb_build_object('actionType',v_request.action_type,'riskLevel',v_risk,'requiredApprovalCount',v_required),p_correlation_id);
  return jsonb_build_object('requestId',v_request.id,'reference',v_request.reference,'status',v_request.status,
    'requiredApprovalCount',v_required,'riskLevel',v_risk,'duplicate',false);
end;
$$;

create or replace function public.decide_money_desk_request(
  p_request_id uuid, p_jit_grant_id uuid, p_actor_email text, p_actor_subject text,
  p_actor_role text, p_decision text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.money_desk_requests%rowtype; v_count integer;
begin
  select * into v_request from public.money_desk_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'Money Desk request was not found.'; end if;
  perform public.assert_money_desk_jit(p_jit_grant_id,p_actor_email,p_actor_subject,p_actor_role,v_request.action_type);
  if upper(trim(p_actor_role)) not in ('FINANCE','ADMIN') then raise exception 'Finance or admin approval is required.'; end if;
  if lower(trim(p_actor_email)) = lower(v_request.requester_email) then raise exception 'The preparer cannot approve their own request.'; end if;
  if v_request.status <> 'PENDING_APPROVAL' then raise exception 'Money Desk request is no longer pending approval.'; end if;
  if p_decision not in ('APPROVE','REJECT') then raise exception 'Invalid Money Desk decision.'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 12 and 1000 then raise exception 'Decision reason must be 12 to 1000 characters.'; end if;

  insert into public.money_desk_decisions (request_id,decision,approver_email,approver_subject,approver_role,approver_jit_grant_id,reason,correlation_id)
  values (p_request_id,p_decision,lower(trim(p_actor_email)),trim(p_actor_subject),upper(trim(p_actor_role)),p_jit_grant_id,trim(p_reason),v_request.correlation_id);

  if p_decision = 'REJECT' then
    update public.money_desk_requests set status='REJECTED',rejected_at=now() where id=p_request_id;
    insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
    values (p_request_id,'REQUEST_REJECTED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),jsonb_build_object('reason',trim(p_reason)),v_request.correlation_id);
    return jsonb_build_object('requestId',p_request_id,'status','REJECTED','approvalCount',v_request.approval_count);
  end if;

  select count(*) into v_count from public.money_desk_decisions where request_id=p_request_id and decision='APPROVE';
  update public.money_desk_requests set approval_count=v_count,
    status=case when v_count >= required_approval_count then 'APPROVED' else status end,
    approved_at=case when v_count >= required_approval_count then now() else approved_at end
  where id=p_request_id returning * into v_request;
  insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (p_request_id,'APPROVAL_RECORDED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),
    jsonb_build_object('approvalCount',v_count,'requiredApprovalCount',v_request.required_approval_count,'reason',trim(p_reason)),v_request.correlation_id);
  if v_request.status='APPROVED' then
    insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
    values (p_request_id,'REQUEST_APPROVED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),'{}'::jsonb,v_request.correlation_id);
  end if;
  return jsonb_build_object('requestId',p_request_id,'status',v_request.status,'approvalCount',v_count,'requiredApprovalCount',v_request.required_approval_count);
end;
$$;

create or replace function public.begin_money_desk_execution(
  p_request_id uuid, p_idempotency_key text, p_jit_grant_id uuid, p_actor_email text,
  p_actor_subject text, p_actor_role text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.money_desk_requests%rowtype; v_attempt public.money_desk_execution_attempts%rowtype;
begin
  select * into v_request from public.money_desk_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Money Desk request was not found.'; end if;
  perform public.assert_money_desk_jit(p_jit_grant_id,p_actor_email,p_actor_subject,p_actor_role,v_request.action_type);
  if upper(trim(p_actor_role)) not in ('FINANCE','ADMIN') then raise exception 'Finance or admin execution is required.'; end if;
  select * into v_attempt from public.money_desk_execution_attempts where idempotency_key=p_idempotency_key;
  if v_attempt.id is not null then return jsonb_build_object('attemptId',v_attempt.id,'status',v_attempt.status,'duplicate',true); end if;
  if v_request.status <> 'APPROVED' then raise exception 'Money Desk request is not approved for execution.'; end if;
  insert into public.money_desk_execution_attempts (request_id,idempotency_key,executor_email,executor_subject,executor_role,executor_jit_grant_id,correlation_id)
  values (p_request_id,p_idempotency_key,lower(trim(p_actor_email)),trim(p_actor_subject),upper(trim(p_actor_role)),p_jit_grant_id,v_request.correlation_id)
  returning * into v_attempt;
  update public.money_desk_requests set status='EXECUTING',executing_at=now() where id=p_request_id;
  insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (p_request_id,'EXECUTION_STARTED',v_attempt.executor_email,v_attempt.executor_role,jsonb_build_object('attemptId',v_attempt.id),v_request.correlation_id);
  return jsonb_build_object('attemptId',v_attempt.id,'status',v_attempt.status,'duplicate',false,'actionType',v_request.action_type,'actionPayload',v_request.action_payload);
end;
$$;

create or replace function public.complete_money_desk_execution(
  p_attempt_id uuid, p_status text, p_provider_reference text default null,
  p_failure_code text default null, p_failure_summary text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempt public.money_desk_execution_attempts%rowtype; v_request public.money_desk_requests%rowtype; v_event text;
begin
  select * into v_attempt from public.money_desk_execution_attempts where id=p_attempt_id for update;
  if v_attempt.id is null then raise exception 'Money Desk execution attempt was not found.'; end if;
  if v_attempt.status <> 'PROCESSING' then return jsonb_build_object('attemptId',v_attempt.id,'status',v_attempt.status,'duplicate',true); end if;
  if p_status not in ('SUCCEEDED','FAILED','BLOCKED') then raise exception 'Invalid Money Desk execution outcome.'; end if;
  update public.money_desk_execution_attempts set status=p_status,provider_reference=nullif(trim(coalesce(p_provider_reference,'')),''),
    failure_code=nullif(trim(coalesce(p_failure_code,'')),''),failure_summary=nullif(trim(coalesce(p_failure_summary,'')),''),completed_at=now()
  where id=p_attempt_id returning * into v_attempt;
  update public.money_desk_requests set status=case when p_status='SUCCEEDED' then 'SUCCEEDED' else 'FAILED' end,
    execution_outcome=p_status,provider_reference=v_attempt.provider_reference,terminal_at=now()
  where id=v_attempt.request_id returning * into v_request;
  v_event := case p_status when 'SUCCEEDED' then 'EXECUTION_SUCCEEDED' when 'BLOCKED' then 'EXECUTION_BLOCKED' else 'EXECUTION_FAILED' end;
  insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (v_request.id,v_event,v_attempt.executor_email,v_attempt.executor_role,
    jsonb_build_object('attemptId',v_attempt.id,'providerReference',v_attempt.provider_reference,'failureCode',v_attempt.failure_code),v_request.correlation_id);
  return jsonb_build_object('attemptId',v_attempt.id,'requestId',v_request.id,'status',p_status,'duplicate',false);
end;
$$;

revoke all on function public.assert_money_desk_jit(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.issue_money_desk_jit_grant(text,text,text,text,text[],text[],text,uuid) from public,anon,authenticated;
revoke all on function public.submit_money_desk_request(text,uuid,text,text,text,text,text,text,text,uuid,integer,currency,integer,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.decide_money_desk_request(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.begin_money_desk_execution(uuid,text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_money_desk_execution(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.assert_money_desk_jit(uuid,text,text,text,text) to service_role;
grant execute on function public.issue_money_desk_jit_grant(text,text,text,text,text[],text[],text,uuid) to service_role;
grant execute on function public.submit_money_desk_request(text,uuid,text,text,text,text,text,text,text,uuid,integer,currency,integer,text,text,jsonb,uuid) to service_role;
grant execute on function public.decide_money_desk_request(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.begin_money_desk_execution(uuid,text,uuid,text,text,text) to service_role;
grant execute on function public.complete_money_desk_execution(uuid,text,text,text,text) to service_role;

comment on table public.money_desk_requests is 'JIT-gated maker-checker requests for external money movement and sensitive financial overrides.';
comment on table public.money_desk_decisions is 'Append-only named approvals; the preparer can never approve their own request.';
comment on table public.money_desk_execution_attempts is 'Every provider execution attempt reaches a recorded terminal outcome or remains visibly processing for reconciliation.';
