-- One channel-level terminal record for every durable notification job.
-- Provider-specific tables (for example push_delivery_attempts) retain their
-- detailed receipts; this table provides the cross-channel audit surface.

create table if not exists public.notification_delivery_outcomes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.domain_events(id) on delete set null,
  job_id uuid not null references public.job_queue(id) on delete cascade,
  channel text not null check (channel in ('PUSH', 'EMAIL', 'SMS')),
  recipient_user_id uuid references auth.users(id) on delete set null,
  order_id uuid,
  status text not null check (status in ('DELIVERED', 'SKIPPED', 'DEAD')),
  reason text,
  provider text,
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  terminal_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (job_id)
);

create index if not exists notification_delivery_outcomes_order_created_idx
  on public.notification_delivery_outcomes (order_id, created_at desc)
  where order_id is not null;

create index if not exists notification_delivery_outcomes_status_created_idx
  on public.notification_delivery_outcomes (status, created_at desc);

alter table public.notification_delivery_outcomes enable row level security;
revoke all on table public.notification_delivery_outcomes from anon, authenticated;
grant select, insert, update, delete on table public.notification_delivery_outcomes to service_role;

create or replace function public.record_notification_delivery_outcome(
  p_job_id uuid,
  p_channel text,
  p_status text,
  p_recipient_user_id uuid default null,
  p_order_id uuid default null,
  p_reason text default null,
  p_provider text default null,
  p_provider_reference text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outcome_id uuid;
begin
  if p_channel not in ('PUSH', 'EMAIL', 'SMS') then
    raise exception 'unsupported notification channel';
  end if;
  if p_status not in ('DELIVERED', 'SKIPPED', 'DEAD') then
    raise exception 'notification outcome must be terminal';
  end if;

  insert into public.notification_delivery_outcomes (
    event_id,
    job_id,
    channel,
    recipient_user_id,
    order_id,
    status,
    reason,
    provider,
    provider_reference,
    metadata
  )
  select
    jobs.event_id,
    jobs.id,
    p_channel,
    p_recipient_user_id,
    p_order_id,
    p_status,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_provider, '')), ''),
    nullif(btrim(coalesce(p_provider_reference, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  from public.job_queue jobs
  where jobs.id = p_job_id
  on conflict (job_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    provider = excluded.provider,
    provider_reference = excluded.provider_reference,
    metadata = public.notification_delivery_outcomes.metadata || excluded.metadata,
    terminal_at = now()
  returning id into v_outcome_id;

  if v_outcome_id is null then
    raise exception 'notification job not found';
  end if;
  return v_outcome_id;
end;
$$;

revoke all on function public.record_notification_delivery_outcome(
  uuid, text, text, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_notification_delivery_outcome(
  uuid, text, text, uuid, uuid, text, text, text, jsonb
) to service_role;

create or replace function public.finish_notification_job(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text default null,
  p_duration_ms integer default null,
  p_channel text default null,
  p_outcome_status text default null,
  p_recipient_user_id uuid default null,
  p_order_id uuid default null,
  p_reason text default null,
  p_provider text default null,
  p_provider_reference text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.finish_job(
    p_job_id,
    p_worker_id,
    p_succeeded,
    p_error,
    null,
    p_duration_ms
  );

  if p_channel is not null and p_outcome_status is not null then
    perform public.record_notification_delivery_outcome(
      p_job_id,
      p_channel,
      p_outcome_status,
      p_recipient_user_id,
      p_order_id,
      p_reason,
      p_provider,
      p_provider_reference,
      p_metadata
    );
  end if;
end;
$$;

revoke all on function public.finish_notification_job(
  uuid, text, boolean, text, integer, text, text, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finish_notification_job(
  uuid, text, boolean, text, integer, text, text, uuid, uuid, text, text, text, jsonb
) to service_role;

create or replace view public.notification_delivery_audit
with (security_invoker = true)
as
select
  events.id as event_id,
  events.event_type,
  events.order_id,
  events.created_at as event_created_at,
  jobs.id as job_id,
  jobs.job_type,
  jobs.attempt_count,
  jobs.max_attempts,
  jobs.status as job_status,
  outcomes.channel,
  outcomes.status as delivery_status,
  outcomes.reason,
  outcomes.provider,
  outcomes.provider_reference,
  outcomes.terminal_at
from public.domain_events events
join public.job_queue jobs on jobs.event_id = events.id
left join public.notification_delivery_outcomes outcomes on outcomes.job_id = jobs.id
where jobs.job_type in (
  'SEND_PUSH',
  'SEND_SMS',
  'SEND_ORDER_EVENT_EMAIL',
  'SEND_ORDER_CONFIRMATION_EMAILS',
  'SEND_OPS_VERIFICATION_EMAIL'
);

revoke all on public.notification_delivery_audit from anon, authenticated;
grant select on public.notification_delivery_audit to service_role;
