-- Authoritative environment identity for Ops records.
--
-- A database project is configured after this migration through the guarded
-- service-role RPC. Until then every new case remains UNKNOWN and canonical
-- actions must fail closed. The deployment verification script checks the
-- project ref before invoking the RPC.

create table if not exists public.ops_runtime_configuration (
  singleton boolean primary key default true check (singleton),
  environment text not null default 'UNKNOWN'
    check (environment in ('UNKNOWN', 'DEVELOPMENT', 'PRODUCTION')),
  project_ref text,
  configured_by text,
  configured_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ops_runtime_configuration_project_ref_valid check (
    project_ref is null or project_ref ~ '^[a-z0-9]{20}$'
  ),
  constraint ops_runtime_configuration_complete check (
    environment = 'UNKNOWN'
    or (project_ref is not null and configured_by is not null and configured_at is not null)
  )
);

insert into public.ops_runtime_configuration (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.current_ops_environment()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select environment from public.ops_runtime_configuration where singleton = true),
    'UNKNOWN'
  );
$$;

create or replace function public.configure_ops_runtime_environment(
  p_environment text,
  p_project_ref text,
  p_configured_by text
)
returns public.ops_runtime_configuration
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_project_ref text := lower(trim(coalesce(p_project_ref, '')));
  v_configured_by text := trim(coalesce(p_configured_by, ''));
  v_existing public.ops_runtime_configuration%rowtype;
  v_result public.ops_runtime_configuration%rowtype;
begin
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION') then
    raise exception 'Invalid Ops environment.' using errcode = '22023';
  end if;
  if v_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'Invalid Supabase project reference.' using errcode = '22023';
  end if;
  if length(v_configured_by) < 3 or length(v_configured_by) > 180 then
    raise exception 'A bounded configuration actor is required.' using errcode = '22023';
  end if;

  select * into v_existing
  from public.ops_runtime_configuration
  where singleton = true
  for update;

  if v_existing.environment <> 'UNKNOWN'
    and (
      v_existing.environment <> v_environment
      or v_existing.project_ref is distinct from v_project_ref
    ) then
    raise exception 'Ops environment is already bound to a different project.' using errcode = '55000';
  end if;

  update public.ops_runtime_configuration
  set environment = v_environment,
      project_ref = v_project_ref,
      configured_by = v_configured_by,
      configured_at = coalesce(configured_at, now()),
      updated_at = now()
  where singleton = true
  returning * into v_result;

  return v_result;
end;
$$;

-- Replace the first-pass deletion projection so it reads the database-bound
-- environment rather than a connection-local setting.
create or replace function public.sync_account_deletion_ops_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_issue public.ops_issues%rowtype;
  v_environment text := public.current_ops_environment();
  v_canonical_status text;
  v_legacy_status text;
  v_recommended_action text;
  v_provenance text;
begin
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION') then
    v_environment := 'UNKNOWN';
  end if;

  v_provenance := case when v_environment = 'DEVELOPMENT' then 'QA' else 'REAL' end;
  v_canonical_status := case new.status
    when 'PENDING' then 'NEW'
    when 'ACKNOWLEDGED' then 'TRIAGED'
    when 'BLOCKED' then 'BLOCKED'
    when 'READY_FOR_FINALIZATION' then 'SCHEDULED_FOLLOW_UP'
    when 'COMPLETED' then 'RESOLVED'
    when 'REJECTED' then 'CLOSED'
    else 'NEW'
  end;

  v_legacy_status := case
    when new.status in ('COMPLETED', 'REJECTED') then 'RESOLVED'
    when new.status = 'PENDING' then 'OPEN'
    else 'IN_REVIEW'
  end;

  v_recommended_action := case new.status
    when 'PENDING' then 'Acknowledge the request and review active obligations.'
    when 'ACKNOWLEDGED' then 'Confirm whether any order, dispute, payout, or legal-retention blocker remains.'
    when 'BLOCKED' then 'Resolve the recorded blocker, then re-evaluate finalization eligibility.'
    when 'READY_FOR_FINALIZATION' then 'Run the protected deletion finalizer and inspect its durable receipt.'
    when 'COMPLETED' then 'No action. Retain only the policy-required audit record.'
    when 'REJECTED' then 'No action unless the customer appeals or submits new information.'
    else 'Review the request state.'
  end;

  insert into public.ops_issues (
    issue_type, severity, status, source, user_id, related_entity_type,
    related_entity_id, title, description, recommended_action, dedupe_key,
    metadata, queue_key, owning_team, priority, sensitivity, environment,
    canonical_status, first_response_due_at, active_resolution_due_at,
    sla_policy_version, provenance, resolved_at, closed_at
  ) values (
    'ACCOUNT_DELETION_REQUEST', 'HIGH', v_legacy_status,
    'account_deletion_requests', new.user_id::text,
    'account_deletion_request', new.id::text, 'Account deletion request',
    'A customer or tailor requested account deletion. Review obligations before irreversible processing.',
    v_recommended_action, 'account-deletion:' || new.user_id::text,
    jsonb_build_object(
      'requestId', new.id,
      'requestStatus', new.status,
      'requestedAt', new.requested_at,
      'role', new.role
    ),
    'privacy-deletion', 'customer_success', 'P1', 'HIGHLY_RESTRICTED',
    v_environment, v_canonical_status, new.requested_at + interval '1 day',
    new.requested_at + interval '30 days', 'privacy-deletion-v1', v_provenance,
    case when new.status in ('COMPLETED', 'REJECTED') then coalesce(new.completed_at, new.processed_at, now()) end,
    case when new.status = 'REJECTED' then coalesce(new.processed_at, now()) end
  )
  on conflict (dedupe_key) do update set
    status = excluded.status,
    canonical_status = excluded.canonical_status,
    recommended_action = excluded.recommended_action,
    environment = excluded.environment,
    provenance = excluded.provenance,
    metadata = public.ops_issues.metadata || excluded.metadata,
    resolved_at = excluded.resolved_at,
    closed_at = excluded.closed_at,
    last_seen_at = now()
  returning * into v_issue;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.ops_case_events (
      issue_id, event_type, visibility, sensitivity, from_status, to_status,
      summary, payload, idempotency_key, correlation_id, occurred_at
    ) values (
      v_issue.id, 'STATE_TRANSITION', 'INTERNAL', 'HIGHLY_RESTRICTED',
      case when tg_op = 'UPDATE' then old.status end, new.status,
      case when tg_op = 'INSERT'
        then 'Account deletion request entered the privacy queue.'
        else 'Account deletion request moved to ' || replace(new.status, '_', ' ') || '.'
      end,
      jsonb_build_object('requestId', new.id, 'role', new.role),
      'account-deletion-status:' || new.id::text || ':' || new.status || ':v' || v_issue.record_version::text,
      v_issue.correlation_id,
      coalesce(new.processed_at, new.acknowledged_at, new.requested_at, now())
    )
    on conflict (issue_id, idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

alter table public.ops_runtime_configuration enable row level security;
revoke all on public.ops_runtime_configuration from public, anon, authenticated;
grant select, insert, update on public.ops_runtime_configuration to service_role;

revoke all on function public.current_ops_environment() from public, anon, authenticated;
revoke all on function public.configure_ops_runtime_environment(text, text, text) from public, anon, authenticated;
grant execute on function public.current_ops_environment() to service_role;
grant execute on function public.configure_ops_runtime_environment(text, text, text) to service_role;

comment on table public.ops_runtime_configuration is
  'Fail-closed database binding for one Drapeon environment and Supabase project.';
comment on function public.configure_ops_runtime_environment(text, text, text) is
  'Idempotently binds an Ops database project to DEVELOPMENT or PRODUCTION. Cross-project rebinding is rejected.';
