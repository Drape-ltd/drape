-- Resend's send endpoint acknowledges provider acceptance; it does not prove
-- mailbox delivery. Preserve that state until a provider webhook records the
-- eventual delivery or failure outcome.

alter table public.notification_delivery_outcomes
  drop constraint if exists notification_delivery_outcomes_status_check;

alter table public.notification_delivery_outcomes
  add constraint notification_delivery_outcomes_status_check
  check (status in ('ACCEPTED', 'DELIVERED', 'SKIPPED', 'DEAD'));

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
  if p_status not in ('ACCEPTED', 'DELIVERED', 'SKIPPED', 'DEAD') then
    raise exception 'unsupported notification outcome';
  end if;
  if p_status = 'ACCEPTED' and p_channel <> 'EMAIL' then
    raise exception 'provider acceptance is only tracked for email';
  end if;

  insert into public.notification_delivery_outcomes (
    event_id, job_id, channel, recipient_user_id, order_id, status, reason,
    provider, provider_reference, metadata
  )
  select
    jobs.event_id, jobs.id, p_channel, p_recipient_user_id, p_order_id,
    p_status, nullif(btrim(coalesce(p_reason, '')), ''),
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

  if v_outcome_id is null then raise exception 'notification job not found'; end if;
  return v_outcome_id;
end;
$$;

revoke all on function public.record_notification_delivery_outcome(
  uuid, text, text, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_notification_delivery_outcome(
  uuid, text, text, uuid, uuid, text, text, text, jsonb
) to service_role;
