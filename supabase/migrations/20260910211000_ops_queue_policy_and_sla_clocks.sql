-- Versioned Ops queue ownership and SLA clocks.
--
-- V1 customer-facing response promises are elapsed-time commitments, so the
-- launch calendar is explicitly continuous. This is stored as policy data—not
-- inferred by the UI—and can be replaced by a reviewed staffed-hours calendar
-- without rewriting historical cases.

create table if not exists public.ops_coverage_calendars (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('DEVELOPMENT', 'PRODUCTION')),
  calendar_key text not null,
  version text not null,
  timezone text not null default 'UTC',
  clock_mode text not null check (clock_mode in ('ELAPSED_CONTINUOUS', 'COVERAGE_WINDOWS')),
  weekly_windows jsonb not null default '[]'::jsonb,
  holiday_dates date[] not null default '{}'::date[],
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ops_coverage_calendars_windows_array check (jsonb_typeof(weekly_windows) = 'array'),
  unique (environment, calendar_key, version)
);

create table if not exists public.ops_queue_policies (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('DEVELOPMENT', 'PRODUCTION')),
  queue_key text not null,
  version text not null,
  primary_team text not null,
  backup_team text not null,
  permitted_roles text[] not null,
  coverage_calendar_id uuid not null references public.ops_coverage_calendars(id),
  first_response_minutes jsonb not null,
  active_resolution_minutes jsonb not null,
  pause_statuses text[] not null default array['WAITING_CUSTOMER', 'WAITING_COUNTERPARTY', 'WAITING_PROVIDER']::text[],
  escalation_triggers text[] not null default '{}'::text[],
  permitted_actions text[] not null default '{}'::text[],
  runbook_path text not null,
  alert_policy text not null,
  active boolean not null default true,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_queue_policies_first_response_object check (jsonb_typeof(first_response_minutes) = 'object'),
  constraint ops_queue_policies_resolution_object check (jsonb_typeof(active_resolution_minutes) = 'object'),
  unique (environment, queue_key, version)
);

create unique index if not exists ops_queue_policies_one_active_idx
  on public.ops_queue_policies (environment, queue_key)
  where active and retired_at is null;

alter table public.ops_issues
  add column if not exists sla_clock_paused_at timestamptz,
  add column if not exists last_meaningful_activity_at timestamptz;

do $$
declare
  v_environment text := public.current_ops_environment();
  v_calendar_id uuid;
  v_response jsonb := jsonb_build_object('P0', 240, 'P1', 1440, 'P2', 2880, 'P3', 4320, 'P4', 10080);
begin
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION') then
    raise exception 'Configure ops_runtime_configuration before installing queue policies.' using errcode = '55000';
  end if;

  insert into public.ops_coverage_calendars (
    environment, calendar_key, version, timezone, clock_mode, weekly_windows
  ) values (
    v_environment,
    'customer-promise-elapsed',
    'v1',
    'UTC',
    'ELAPSED_CONTINUOUS',
    jsonb_build_array(jsonb_build_object('days', jsonb_build_array(0, 1, 2, 3, 4, 5, 6), 'startMinute', 0, 'endMinute', 1440))
  )
  on conflict (environment, calendar_key, version) do update set
    timezone = excluded.timezone,
    clock_mode = excluded.clock_mode,
    weekly_windows = excluded.weekly_windows,
    retired_at = null
  returning id into v_calendar_id;

  insert into public.ops_queue_policies (
    environment, queue_key, version, primary_team, backup_team,
    permitted_roles, coverage_calendar_id, first_response_minutes,
    active_resolution_minutes, escalation_triggers, permitted_actions,
    runbook_path, alert_policy
  ) values
    (v_environment, 'support', 'support-v1', 'customer_success', 'ops',
      array['customer_success','ops','admin'], v_calendar_id, v_response,
      jsonb_build_object('P0',1440,'P1',4320,'P2',4320,'P3',10080,'P4',20160),
      array['event_critical','active_order_blocked','counterparty_unresponsive'],
      array['assign','triage','request_evidence','schedule_follow_up','escalate','resolve'],
      '/ops/knowledge#support', 'Immediate P0; recovery update on terminal state'),
    (v_environment, 'privacy-deletion', 'privacy-deletion-v1', 'customer_success', 'admin',
      array['customer_success','admin'], v_calendar_id, v_response,
      jsonb_build_object('P0',43200,'P1',43200,'P2',43200,'P3',43200,'P4',43200),
      array['legal_hold','active_order','open_dispute','unreleased_balance'],
      array['assign','acknowledge','record_blocker','mark_ready','finalize','reject'],
      '/ops/knowledge#privacy', 'Immediate alert only for deadline or obligation risk'),
    (v_environment, 'trust-safety', 'trust-safety-v1', 'trust', 'admin',
      array['trust','admin'], v_calendar_id, v_response,
      jsonb_build_object('P0',1440,'P1',4320,'P2',7200,'P3',10080,'P4',20160),
      array['off_platform_payment','harassment','deception','restriction_required'],
      array['assign','triage','request_evidence','approve','reject','restrict','escalate'],
      '/ops/knowledge#trust', 'Immediate P0/high-risk trust alert; deduplicated recovery'),
    (v_environment, 'money-desk', 'money-desk-v1', 'finance', 'admin',
      array['finance','admin'], v_calendar_id, v_response,
      jsonb_build_object('P0',1440,'P1',4320,'P2',7200,'P3',10080,'P4',20160),
      array['processor_deadline','payout_release_near','provider_ambiguity','ledger_mismatch'],
      array['assign','prepare','approve','reject','execute','reconcile','escalate'],
      '/ops/knowledge#money', 'Immediate P0/provider ambiguity alert; maker-checker required'),
    (v_environment, 'delivery-supply', 'delivery-supply-v1', 'ops', 'customer_success',
      array['ops','customer_success','admin'], v_calendar_id, v_response,
      jsonb_build_object('P0',1440,'P1',4320,'P2',7200,'P3',10080,'P4',20160),
      array['event_critical','international_loss','customs_ambiguity','handoff_failure'],
      array['assign','triage','contact_provider','schedule_follow_up','escalate','resolve'],
      '/ops/knowledge#delivery', 'Immediate P0/event-critical alert; recovery on terminal state'),
    (v_environment, 'reliability', 'reliability-v1', 'engineering', 'admin',
      array['engineering','admin'], v_calendar_id,
      jsonb_build_object('P0',15,'P1',60,'P2',1440,'P3',4320,'P4',10080),
      jsonb_build_object('P0',60,'P1',240,'P2',1440,'P3',4320,'P4',10080),
      array['synthetic_failure','monitor_silence','provider_outage','queue_dead_letter','alert_storm'],
      array['assign','acknowledge','declare_incident','snooze','recover','resolve','escalate'],
      '/ops/knowledge#reliability', 'Immediate critical/high transition; dedupe and recovery required'),
    (v_environment, 'operations', 'operations-v1', 'ops', 'admin',
      array['ops','admin'], v_calendar_id, v_response,
      jsonb_build_object('P0',1440,'P1',4320,'P2',7200,'P3',10080,'P4',20160),
      array['policy_gap','cross_role_block','event_critical','customer_harm_risk'],
      array['assign','triage','request_evidence','schedule_follow_up','escalate','resolve'],
      '/ops/knowledge#operations', 'Immediate P0; otherwise queue digest and due reminders')
  on conflict (environment, queue_key, version) do update set
    primary_team = excluded.primary_team,
    backup_team = excluded.backup_team,
    permitted_roles = excluded.permitted_roles,
    coverage_calendar_id = excluded.coverage_calendar_id,
    first_response_minutes = excluded.first_response_minutes,
    active_resolution_minutes = excluded.active_resolution_minutes,
    pause_statuses = excluded.pause_statuses,
    escalation_triggers = excluded.escalation_triggers,
    permitted_actions = excluded.permitted_actions,
    runbook_path = excluded.runbook_path,
    alert_policy = excluded.alert_policy,
    active = true,
    retired_at = null,
    updated_at = now();
end;
$$;

create or replace function public.apply_ops_case_queue_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.ops_queue_policies%rowtype;
  v_first_response_minutes integer;
  v_resolution_minutes integer;
  v_entering_pause boolean := false;
  v_leaving_pause boolean := false;
  v_pause_seconds bigint := 0;
begin
  if new.environment not in ('DEVELOPMENT', 'PRODUCTION') or new.queue_key is null then
    return new;
  end if;

  select * into v_policy
  from public.ops_queue_policies
  where environment = new.environment
    and queue_key = new.queue_key
    and active
    and retired_at is null
    and effective_at <= now()
  order by effective_at desc
  limit 1;

  if v_policy.id is null then return new; end if;

  v_first_response_minutes := nullif(v_policy.first_response_minutes ->> new.priority, '')::integer;
  v_resolution_minutes := nullif(v_policy.active_resolution_minutes ->> new.priority, '')::integer;

  new.owning_team := coalesce(new.owning_team, v_policy.primary_team);
  new.sla_policy_version := coalesce(new.sla_policy_version, v_policy.version);
  new.first_response_due_at := coalesce(
    new.first_response_due_at,
    coalesce(new.created_at, now()) + make_interval(mins => coalesce(v_first_response_minutes, 4320))
  );
  new.active_resolution_due_at := coalesce(
    new.active_resolution_due_at,
    coalesce(new.created_at, now()) + make_interval(mins => coalesce(v_resolution_minutes, 10080))
  );
  new.last_meaningful_activity_at := coalesce(new.last_meaningful_activity_at, new.updated_at, new.created_at, now());

  if tg_op = 'UPDATE' then
    if old.first_responded_at is null and new.first_responded_at is null
      and old.canonical_status = 'NEW' and new.canonical_status <> 'NEW' then
      new.first_responded_at := now();
    end if;

    v_entering_pause := new.canonical_status = any(v_policy.pause_statuses)
      and not (old.canonical_status = any(v_policy.pause_statuses));
    v_leaving_pause := old.canonical_status = any(v_policy.pause_statuses)
      and not (new.canonical_status = any(v_policy.pause_statuses));

    if v_entering_pause and new.sla_clock_paused_at is null then
      new.sla_clock_paused_at := now();
    elsif v_leaving_pause and old.sla_clock_paused_at is not null then
      v_pause_seconds := greatest(0, extract(epoch from (now() - old.sla_clock_paused_at))::bigint);
      new.paused_duration_seconds := coalesce(old.paused_duration_seconds, 0) + v_pause_seconds;
      new.active_resolution_due_at := new.active_resolution_due_at + make_interval(secs => v_pause_seconds::double precision);
      new.sla_clock_paused_at := null;
    end if;
  elsif new.canonical_status = any(v_policy.pause_statuses) then
    new.sla_clock_paused_at := coalesce(new.sla_clock_paused_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_ops_case_queue_policy on public.ops_issues;
create trigger trg_apply_ops_case_queue_policy
before insert or update of queue_key, priority, environment, canonical_status, first_responded_at
on public.ops_issues
for each row execute function public.apply_ops_case_queue_policy();

-- Canonicalize historical rows only when they have never received a policy.
-- Explicit domain priorities/deadlines already present remain authoritative.
update public.ops_issues issue
set priority = case
      when issue.severity = 'CRITICAL' then 'P0'
      when issue.issue_type ~ '(OFF_PLATFORM|HARASS|FRAUD|SAFETY)' then 'P0'
      when issue.severity = 'HIGH' then 'P1'
      when issue.issue_type = 'ACCOUNT_DELETION_REQUEST' then 'P2'
      when issue.severity in ('MEDIUM', 'WARNING') then 'P2'
      else 'P3'
    end,
    owning_team = coalesce(issue.owning_team, policy.primary_team),
    sla_policy_version = coalesce(issue.sla_policy_version, policy.version),
    first_response_due_at = coalesce(
      issue.first_response_due_at,
      issue.created_at + make_interval(mins => coalesce(nullif(policy.first_response_minutes ->> case
        when issue.severity = 'CRITICAL' then 'P0'
        when issue.issue_type ~ '(OFF_PLATFORM|HARASS|FRAUD|SAFETY)' then 'P0'
        when issue.severity = 'HIGH' then 'P1'
        when issue.issue_type = 'ACCOUNT_DELETION_REQUEST' then 'P2'
        when issue.severity in ('MEDIUM', 'WARNING') then 'P2'
        else 'P3'
      end, '')::integer, 4320))
    ),
    active_resolution_due_at = coalesce(
      issue.active_resolution_due_at,
      issue.created_at + make_interval(mins => coalesce(nullif(policy.active_resolution_minutes ->> case
        when issue.severity = 'CRITICAL' then 'P0'
        when issue.issue_type ~ '(OFF_PLATFORM|HARASS|FRAUD|SAFETY)' then 'P0'
        when issue.severity = 'HIGH' then 'P1'
        when issue.issue_type = 'ACCOUNT_DELETION_REQUEST' then 'P2'
        when issue.severity in ('MEDIUM', 'WARNING') then 'P2'
        else 'P3'
      end, '')::integer, 10080))
    ),
    last_meaningful_activity_at = coalesce(issue.last_meaningful_activity_at, issue.updated_at, issue.created_at)
from public.ops_queue_policies policy
where issue.environment = policy.environment
  and issue.queue_key = policy.queue_key
  and policy.active
  and policy.retired_at is null
  and issue.sla_policy_version is null;

revoke all on table public.ops_coverage_calendars from public, anon, authenticated;
revoke all on table public.ops_queue_policies from public, anon, authenticated;
grant select on table public.ops_coverage_calendars to service_role;
grant select on table public.ops_queue_policies to service_role;
revoke all on function public.apply_ops_case_queue_policy() from public, anon, authenticated;

comment on table public.ops_queue_policies is
  'Versioned environment-bound ownership, SLA, escalation, runbook, and action policy for canonical Ops queues.';
comment on column public.ops_coverage_calendars.clock_mode is
  'ELAPSED_CONTINUOUS preserves V1 public 24/48/72-hour promises; later reviewed coverage windows can replace it prospectively.';
