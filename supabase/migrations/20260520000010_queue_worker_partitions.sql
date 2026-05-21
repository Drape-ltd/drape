-- Allow queue workers to claim only specific job types. This lets Drape scale
-- notification, ops, and future payment workers independently without changing
-- producers.

drop function if exists public.claim_due_jobs(text, integer);

create or replace function public.claim_due_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_job_types text[] default null
)
returns setof public.job_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker_id is required';
  end if;

  return query
  with selected as (
    select id
    from public.job_queue
    where (
      (
        status in ('PENDING', 'RETRYABLE')
        and run_at <= now()
      )
      or (
        status = 'PROCESSING'
        and locked_at < now() - interval '15 minutes'
      )
    )
    and (
      p_job_types is null
      or cardinality(p_job_types) = 0
      or job_type = any(p_job_types)
    )
    order by priority asc, run_at asc, created_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update skip locked
  )
  update public.job_queue jobs
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = btrim(p_worker_id),
         attempt_count = jobs.attempt_count + 1,
         last_error = null
    from selected
   where jobs.id = selected.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_due_jobs(text, integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(text, integer, text[]) to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'process-job-queue';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'process-notification-jobs';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'process-ops-jobs';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-notification-jobs',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS"]}'::jsonb, 300000);$job$
  );

  perform cron.schedule(
    'process-ops-jobs',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":20,"jobTypes":["CREATE_OPS_ISSUE"]}'::jsonb, 300000);$job$
  );
end $$;

create or replace function public.get_drape_service_health()
returns jsonb
language plpgsql
security definer
set search_path = public, util, extensions
as $$
declare
  cron_available boolean := to_regclass('cron.job') is not null;
  vault_available boolean := to_regclass('vault.decrypted_secrets') is not null;
  jobs jsonb := '[]'::jsonb;
  project_url_configured boolean := false;
  service_role_configured boolean := false;
begin
  if cron_available then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'jobname', jobname,
          'schedule', schedule,
          'active', active
        )
        order by jobname
      ),
      '[]'::jsonb
    )
    into jobs
    from cron.job
    where jobname in (
      'expire-pending-payments',
      'expire-quotes',
      'auto-release',
      'release-order-payouts',
      'escalate-production-stalls',
      'send-consultation-reminders',
      'process-notification-jobs',
      'process-ops-jobs'
    );
  end if;

  if vault_available then
    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'project_url'
      )
    $sql$
    into project_url_configured;

    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    $sql$
    into service_role_configured;
  end if;

  return jsonb_build_object(
    'cronAvailable', cron_available,
    'vaultAvailable', vault_available,
    'vaultProjectUrlConfigured', project_url_configured,
    'vaultServiceRoleConfigured', service_role_configured,
    'jobs', jobs
  );
end;
$$;

revoke all on function public.get_drape_service_health() from public, anon, authenticated;
grant execute on function public.get_drape_service_health() to service_role;
