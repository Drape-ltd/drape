-- Scheduler-only release unit for short-lived Ops export content. Request and
-- event metadata remain auditable while generated CSV is purged.

create or replace function public.expire_ops_export_content()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_failed integer := 0;
begin
  with stalled as (
    update public.ops_export_requests
    set status = 'FAILED', content = null, content_sha256 = null,
        row_count = null, source_watermark = null, completed_at = now(),
        expires_at = null, failure_code = 'GENERATOR_TIMEOUT', updated_at = now()
    where (status = 'REQUESTED' and requested_at <= now() - interval '15 minutes')
       or (status = 'PROCESSING' and coalesce(started_at, requested_at) <= now() - interval '10 minutes')
    returning id, requester_principal_id, requester_email, correlation_id
  ), failure_events as (
    insert into public.ops_export_events (
      export_request_id, event_type, actor_principal_id, actor_label,
      summary, details, correlation_id
    )
    select
      id, 'FAILED', requester_principal_id, requester_email,
      'A stalled export generator was closed by the bounded recovery worker.',
      jsonb_build_object('failureCode', 'GENERATOR_TIMEOUT'), correlation_id
    from stalled
    returning 1
  )
  select count(*) into v_failed from failure_events;

  with expired as (
    update public.ops_export_requests
    set status = 'EXPIRED', content = null, updated_at = now()
    where status = 'READY'
      and content is not null
      and expires_at <= now()
    returning id, requester_principal_id, requester_email, correlation_id
  ), events as (
    insert into public.ops_export_events (
      export_request_id, event_type, actor_principal_id, actor_label,
      summary, details, correlation_id
    )
    select
      id, 'EXPIRED', requester_principal_id, requester_email,
      'Expired export content was purged by the bounded retention worker.',
      '{}'::jsonb, correlation_id
    from expired
    returning 1
  )
  select count(*) into v_count from events;
  return v_count + v_failed;
end;
$$;

revoke all on function public.expire_ops_export_content() from public, anon, authenticated;
grant execute on function public.expire_ops_export_content() to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron must be enabled before installing Ops export retention.';
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'expire-ops-export-content';

select cron.schedule(
  'expire-ops-export-content',
  '*/5 * * * *',
  $job$select public.expire_ops_export_content();$job$
);
