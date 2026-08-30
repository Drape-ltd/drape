-- Durable Slack delivery for the Ops issue ledger.
-- Slack remains a read-only alert surface; authenticated Drapeon Ops owns every decision.

create table if not exists public.ops_slack_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.job_queue(id) on delete set null,
  issue_id uuid references public.ops_issues(id) on delete cascade,
  audit_log_id uuid references public.ops_audit_logs(id) on delete cascade,
  event_kind text not null,
  channel_key text not null check (channel_key in (
    'ENGINEERING_ERRORS', 'OPS_CRITICAL', 'OPS_DELIVERY',
    'OPS_INTAKE', 'OPS_MONEY', 'OPS_SAFETY'
  )),
  channel_id text not null,
  slack_message_ts text,
  thread_ts text,
  status text not null default 'PENDING' check (status in (
    'PENDING', 'DELIVERED', 'SKIPPED', 'RETRYABLE', 'DEAD'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_status text,
  error_code text,
  error_message text,
  dedupe_key text not null unique,
  delivered_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_slack_deliveries_issue_channel_idx
  on public.ops_slack_deliveries(issue_id, channel_key, created_at);
create index if not exists ops_slack_deliveries_status_created_idx
  on public.ops_slack_deliveries(status, created_at desc);

create or replace function public.set_ops_slack_delivery_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ops_slack_deliveries_updated_at on public.ops_slack_deliveries;
create trigger trg_ops_slack_deliveries_updated_at
before update on public.ops_slack_deliveries
for each row execute function public.set_ops_slack_delivery_updated_at();

alter table public.ops_slack_deliveries enable row level security;
revoke all on table public.ops_slack_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_slack_deliveries to service_role;

create or replace function public.enqueue_ops_slack_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_domain_event(
    p_event_type := 'ops.issue.slack_delivery_requested',
    p_aggregate_type := 'ops_issue',
    p_idempotency_key := 'ops-slack-audit:' || new.id::text,
    p_payload := jsonb_build_object(
      'issueId', new.issue_id,
      'auditLogId', new.id
    ),
    p_aggregate_id := new.issue_id::text,
    p_actor_id := null,
    p_actor_role := coalesce(nullif(new.performed_role, ''), 'SYSTEM'),
    p_order_id := null,
    p_metadata := jsonb_build_object('action', new.action_taken),
    p_jobs := array['SEND_OPS_SLACK']::text[],
    p_priority := case
      when new.action_taken in ('ISSUE_CREATED', 'ISSUE_REOPENED', 'ISSUE_ESCALATED') then 10
      else 40
    end,
    p_max_attempts := 8,
    p_run_at := now()
  );
  return new;
end;
$$;

revoke all on function public.enqueue_ops_slack_audit_event() from public, anon, authenticated;
grant execute on function public.enqueue_ops_slack_audit_event() to service_role;

drop trigger if exists trg_enqueue_ops_slack_audit_event on public.ops_audit_logs;
create trigger trg_enqueue_ops_slack_audit_event
after insert on public.ops_audit_logs
for each row execute function public.enqueue_ops_slack_audit_event();

create or replace function public.enqueue_ops_slack_sla_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  with due as (
    select issue.id, issue.status, issue.severity, issue.updated_at
    from public.ops_issues issue
    where issue.status in ('OPEN', 'IN_REVIEW', 'ESCALATED')
      and issue.updated_at <= now() - case issue.severity
        when 'CRITICAL' then interval '15 minutes'
        when 'HIGH' then interval '1 hour'
        when 'MEDIUM' then interval '8 hours'
        else interval '24 hours'
      end
      and not exists (
        select 1
        from public.ops_audit_logs audit
        where audit.issue_id = issue.id
          and audit.action_taken = 'SLA_REMINDER_DUE'
          and audit.created_at >= now() - case issue.severity
            when 'CRITICAL' then interval '1 hour'
            when 'HIGH' then interval '4 hours'
            when 'MEDIUM' then interval '12 hours'
            else interval '24 hours'
          end
      )
  ), inserted as (
    insert into public.ops_audit_logs(
      issue_id, action_taken, performed_by, performed_role,
      reason, before_state, after_state
    )
    select
      due.id,
      'SLA_REMINDER_DUE',
      null,
      'SYSTEM',
      'This case still needs an operator outcome.',
      jsonb_build_object('status', due.status, 'severity', due.severity),
      jsonb_build_object('status', due.status, 'severity', due.severity, 'reminderAt', now())
    from due
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.enqueue_ops_slack_sla_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_ops_slack_sla_reminders() to service_role;

create or replace function public.enqueue_ops_slack_daily_digest()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  v_event_id := public.enqueue_domain_event(
    p_event_type := 'ops.digest.slack_delivery_requested',
    p_aggregate_type := 'ops_queue',
    p_idempotency_key := 'ops-slack-digest:' || current_date::text,
    p_payload := jsonb_build_object('digestDate', current_date),
    p_aggregate_id := current_date::text,
    p_actor_id := null,
    p_actor_role := 'SYSTEM',
    p_order_id := null,
    p_metadata := '{}'::jsonb,
    p_jobs := array['SEND_OPS_SLACK_DIGEST']::text[],
    p_priority := 60,
    p_max_attempts := 8,
    p_run_at := now()
  );
  return v_event_id;
end;
$$;

revoke all on function public.enqueue_ops_slack_daily_digest() from public, anon, authenticated;
grant execute on function public.enqueue_ops_slack_daily_digest() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'ops-slack-sla-reminders';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'ops-slack-sla-reminders',
    '*/15 * * * *',
    $job$select public.enqueue_ops_slack_sla_reminders();$job$
  );

  select jobid into v_job_id from cron.job where jobname = 'ops-slack-daily-digest';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'ops-slack-daily-digest',
    '0 14 * * *',
    $job$select public.enqueue_ops_slack_daily_digest();$job$
  );
end $$;

-- Seed one current lifecycle event per active case so Slack starts with an actionable queue.
insert into public.ops_audit_logs(
  issue_id, action_taken, performed_by, performed_role,
  reason, before_state, after_state
)
select
  issue.id,
  'SLACK_ALERTING_ENABLED',
  null,
  'SYSTEM',
  'Durable Slack alerting was enabled for this active Ops case.',
  jsonb_build_object('status', issue.status),
  jsonb_build_object('status', issue.status, 'slackAlerting', true)
from public.ops_issues issue
where issue.status in ('OPEN', 'IN_REVIEW', 'ESCALATED');
