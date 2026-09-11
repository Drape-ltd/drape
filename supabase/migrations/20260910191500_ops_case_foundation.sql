-- Drapeon Ops canonical case foundation.
--
-- Domain tables remain authoritative. This migration evolves the existing
-- ops_issues ledger into the shared case envelope and adds typed, durable case
-- events and action receipts. Interactive workforce claims/RLS arrive in a
-- separately reviewed migration after the token ADR is proven in development.

alter table public.ops_issues
  add column if not exists case_number text
    default ('OPS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  add column if not exists queue_key text,
  add column if not exists owning_team text,
  add column if not exists priority text not null default 'P3',
  add column if not exists sensitivity text not null default 'INTERNAL',
  add column if not exists environment text not null default 'UNKNOWN',
  add column if not exists canonical_status text not null default 'NEW',
  add column if not exists assigned_principal_id uuid
    references public.ops_workforce_principals(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists scheduled_follow_up_at timestamptz,
  add column if not exists first_response_due_at timestamptz,
  add column if not exists active_resolution_due_at timestamptz,
  add column if not exists first_responded_at timestamptz,
  add column if not exists active_duration_seconds bigint not null default 0,
  add column if not exists paused_duration_seconds bigint not null default 0,
  add column if not exists sla_policy_version text,
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists record_version bigint not null default 1,
  add column if not exists provenance text not null default 'UNKNOWN',
  add column if not exists reopened_from_issue_id uuid
    references public.ops_issues(id) on delete set null,
  add column if not exists closed_at timestamptz,
  add column if not exists retention_until timestamptz;

update public.ops_issues
set case_number = 'OPS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where case_number is null;

alter table public.ops_issues
  alter column case_number set not null;

create unique index if not exists ops_issues_case_number_unique
  on public.ops_issues (case_number);

create index if not exists ops_issues_my_work_idx
  on public.ops_issues (
    environment,
    canonical_status,
    assigned_principal_id,
    priority,
    active_resolution_due_at,
    last_seen_at desc
  );

create index if not exists ops_issues_queue_work_idx
  on public.ops_issues (
    environment,
    queue_key,
    canonical_status,
    priority,
    active_resolution_due_at,
    last_seen_at desc
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_issues_priority_valid'
      and conrelid = 'public.ops_issues'::regclass
  ) then
    alter table public.ops_issues add constraint ops_issues_priority_valid
      check (priority in ('P0', 'P1', 'P2', 'P3', 'P4'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_issues_sensitivity_valid'
      and conrelid = 'public.ops_issues'::regclass
  ) then
    alter table public.ops_issues add constraint ops_issues_sensitivity_valid
      check (sensitivity in ('INTERNAL', 'SENSITIVE', 'HIGHLY_RESTRICTED'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_issues_environment_valid'
      and conrelid = 'public.ops_issues'::regclass
  ) then
    alter table public.ops_issues add constraint ops_issues_environment_valid
      check (environment in ('UNKNOWN', 'DEVELOPMENT', 'PRODUCTION'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_issues_canonical_status_valid'
      and conrelid = 'public.ops_issues'::regclass
  ) then
    alter table public.ops_issues add constraint ops_issues_canonical_status_valid
      check (canonical_status in (
        'NEW',
        'TRIAGED',
        'IN_PROGRESS',
        'SCHEDULED_FOLLOW_UP',
        'WAITING_CUSTOMER',
        'WAITING_COUNTERPARTY',
        'WAITING_PROVIDER',
        'BLOCKED',
        'ESCALATED',
        'RESOLVED',
        'CLOSED'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_issues_provenance_valid'
      and conrelid = 'public.ops_issues'::regclass
  ) then
    alter table public.ops_issues add constraint ops_issues_provenance_valid
      check (provenance in ('UNKNOWN', 'REAL', 'STAFF', 'REVIEWER', 'CANARY', 'QA', 'SHOWCASE'));
  end if;
end;
$$;

create table if not exists public.ops_case_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.ops_issues(id) on delete cascade,
  event_type text not null check (event_type in (
    'STATE_TRANSITION',
    'INTERNAL_NOTE',
    'CUSTOMER_COMMUNICATION',
    'TAILOR_COMMUNICATION',
    'EVIDENCE_REQUEST',
    'EVIDENCE_ACCESS',
    'DECISION',
    'PROVIDER_ATTEMPT',
    'PROVIDER_OUTCOME',
    'ASSIGNMENT',
    'ESCALATION',
    'MERGE',
    'SPLIT',
    'REOPEN',
    'AUDIT_SECURITY'
  )),
  visibility text not null default 'INTERNAL'
    check (visibility in ('INTERNAL', 'CUSTOMER', 'TAILOR', 'CUSTOMER_AND_TAILOR')),
  sensitivity text not null default 'INTERNAL'
    check (sensitivity in ('INTERNAL', 'SENSITIVE', 'HIGHLY_RESTRICTED')),
  actor_principal_id uuid references public.ops_workforce_principals(id) on delete set null,
  actor_label text,
  from_status text,
  to_status text,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ops_case_events_payload_size check (octet_length(payload::text) <= 65536),
  unique (issue_id, idempotency_key)
);

create index if not exists ops_case_events_issue_timeline_idx
  on public.ops_case_events (issue_id, occurred_at desc, id desc);

create index if not exists ops_case_events_correlation_idx
  on public.ops_case_events (correlation_id, occurred_at desc);

create table if not exists public.ops_action_receipts (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.ops_issues(id) on delete cascade,
  action_key text not null,
  idempotency_key text not null,
  actor_principal_id uuid references public.ops_workforce_principals(id) on delete set null,
  expected_record_version bigint not null,
  resulting_record_version bigint,
  outcome text not null default 'PENDING'
    check (outcome in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  human_status text not null,
  correlation_id uuid not null default gen_random_uuid(),
  persisted_at timestamptz not null default now(),
  side_effects jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  next_action text,
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_action_receipts_side_effects_array check (jsonb_typeof(side_effects) = 'array'),
  constraint ops_action_receipts_blockers_array check (jsonb_typeof(blockers) = 'array'),
  constraint ops_action_receipts_terminal_complete check (
    outcome = 'PENDING' or completed_at is not null
  ),
  unique (issue_id, idempotency_key)
);

create index if not exists ops_action_receipts_issue_idx
  on public.ops_action_receipts (issue_id, persisted_at desc);

create index if not exists ops_action_receipts_correlation_idx
  on public.ops_action_receipts (correlation_id, persisted_at desc);

create or replace function public.set_ops_case_updated_at_and_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.record_version := old.record_version + 1;
  return new;
end;
$$;

drop trigger if exists trg_ops_issues_updated_at on public.ops_issues;
create trigger trg_ops_issues_updated_at
before update on public.ops_issues
for each row execute function public.set_ops_case_updated_at_and_version();

drop trigger if exists trg_ops_action_receipts_updated_at on public.ops_action_receipts;
create trigger trg_ops_action_receipts_updated_at
before update on public.ops_action_receipts
for each row execute function public.set_updated_at();

create or replace function public.reject_ops_case_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Ops case events are append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists trg_ops_case_events_immutable on public.ops_case_events;
create trigger trg_ops_case_events_immutable
before update or delete on public.ops_case_events
for each row execute function public.reject_ops_case_event_mutation();

create or replace function public.sync_account_deletion_ops_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_issue public.ops_issues%rowtype;
  v_environment text := upper(coalesce(nullif(current_setting('drape.environment', true), ''), 'UNKNOWN'));
  v_canonical_status text;
  v_legacy_status text;
  v_recommended_action text;
begin
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION') then
    v_environment := 'UNKNOWN';
  end if;

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
    issue_type,
    severity,
    status,
    source,
    user_id,
    related_entity_type,
    related_entity_id,
    title,
    description,
    recommended_action,
    dedupe_key,
    metadata,
    queue_key,
    owning_team,
    priority,
    sensitivity,
    environment,
    canonical_status,
    first_response_due_at,
    active_resolution_due_at,
    sla_policy_version,
    provenance,
    resolved_at,
    closed_at
  ) values (
    'ACCOUNT_DELETION_REQUEST',
    'HIGH',
    v_legacy_status,
    'account_deletion_requests',
    new.user_id::text,
    'account_deletion_request',
    new.id::text,
    'Account deletion request',
    'A customer or tailor requested account deletion. Review obligations before irreversible processing.',
    v_recommended_action,
    'account-deletion:' || new.user_id::text,
    jsonb_build_object(
      'requestId', new.id,
      'requestStatus', new.status,
      'requestedAt', new.requested_at,
      'role', new.role
    ),
    'privacy-deletion',
    'customer_success',
    'P1',
    'HIGHLY_RESTRICTED',
    v_environment,
    v_canonical_status,
    new.requested_at + interval '1 day',
    new.requested_at + interval '30 days',
    'privacy-deletion-v1',
    'REAL',
    case when new.status in ('COMPLETED', 'REJECTED') then coalesce(new.completed_at, new.processed_at, now()) end,
    case when new.status = 'REJECTED' then coalesce(new.processed_at, now()) end
  )
  on conflict (dedupe_key) do update set
    status = excluded.status,
    canonical_status = excluded.canonical_status,
    recommended_action = excluded.recommended_action,
    environment = case
      when public.ops_issues.environment = 'UNKNOWN' then excluded.environment
      else public.ops_issues.environment
    end,
    metadata = public.ops_issues.metadata || excluded.metadata,
    resolved_at = excluded.resolved_at,
    closed_at = excluded.closed_at,
    last_seen_at = now()
  returning * into v_issue;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.ops_case_events (
      issue_id,
      event_type,
      visibility,
      sensitivity,
      from_status,
      to_status,
      summary,
      payload,
      idempotency_key,
      correlation_id,
      occurred_at
    ) values (
      v_issue.id,
      'STATE_TRANSITION',
      'INTERNAL',
      'HIGHLY_RESTRICTED',
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
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

drop trigger if exists trg_sync_account_deletion_ops_case on public.account_deletion_requests;
create trigger trg_sync_account_deletion_ops_case
after insert or update of status, acknowledged_at, processed_at, completed_at
on public.account_deletion_requests
for each row execute function public.sync_account_deletion_ops_case();

alter table public.ops_case_events enable row level security;
alter table public.ops_action_receipts enable row level security;

revoke all on public.ops_case_events from public, anon, authenticated;
revoke all on public.ops_action_receipts from public, anon, authenticated;
grant select, insert on public.ops_case_events to service_role;
grant select, insert, update on public.ops_action_receipts to service_role;

revoke all on function public.sync_account_deletion_ops_case() from public, anon, authenticated;
grant execute on function public.sync_account_deletion_ops_case() to service_role;

comment on column public.ops_issues.environment is
  'Fail-closed case environment. UNKNOWN cases are visible for remediation but cannot be acted on by canonical Ops routes.';
comment on table public.ops_case_events is
  'Append-only typed timeline for canonical Ops cases. Domain records remain authoritative.';
comment on table public.ops_action_receipts is
  'Durable persisted outcome contract for idempotent privileged Ops actions and their side effects.';
