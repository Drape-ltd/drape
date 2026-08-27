-- Stop launch-stage money workers from spending Disk IO on empty polling.
--
-- Payment webhook intake and tip capture already persist durable job_queue rows.
-- Wake the worker only after those rows commit, then retain one five-minute
-- recovery sweep for delayed retries and missed wakeups.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.wake_money_job_worker()
returns trigger
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
as $$
declare
  v_job_types text[];
begin
  if new.status not in ('PENDING', 'RETRYABLE') or new.run_at > now() then
    return new;
  end if;

  v_job_types := case
    when new.job_type in ('PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK')
      then array['PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK']::text[]
    when new.job_type = 'PROCESS_TIP_PAYOUT'
      then array['PROCESS_TIP_PAYOUT']::text[]
    else null
  end;

  if v_job_types is null then
    return new;
  end if;

  begin
    perform util.invoke_edge_function(
      'process-job-queue',
      jsonb_build_object('limit', 50, 'jobTypes', to_jsonb(v_job_types)),
      55000
    );
  exception when others then
    -- The durable row is authoritative. A wakeup failure must never roll back
    -- webhook intake or tip capture; the recovery sweep will claim it later.
    raise warning 'money job wakeup deferred for job %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.wake_money_job_worker() from public, anon, authenticated;

drop trigger if exists trg_wake_money_job_worker on public.job_queue;
create trigger trg_wake_money_job_worker
after insert on public.job_queue
for each row
when (
  new.job_type in (
    'PROCESS_PAYMENT_WEBHOOK',
    'RECONCILE_PAYMENT_WEBHOOK',
    'PROCESS_TIP_PAYOUT'
  )
)
execute function public.wake_money_job_worker();

create or replace function public.wake_due_money_jobs()
returns bigint
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.job_queue
    where job_type in (
      'PROCESS_PAYMENT_WEBHOOK',
      'RECONCILE_PAYMENT_WEBHOOK',
      'PROCESS_TIP_PAYOUT'
    )
      and (
        (status in ('PENDING', 'RETRYABLE') and run_at <= now())
        or (status = 'PROCESSING' and locked_at < now() - interval '15 minutes')
      )
  ) then
    return null;
  end if;

  return util.invoke_edge_function(
    'process-job-queue',
    '{"limit":50,"jobTypes":["PROCESS_PAYMENT_WEBHOOK","RECONCILE_PAYMENT_WEBHOOK","PROCESS_TIP_PAYOUT"]}'::jsonb,
    55000
  );
end;
$$;

revoke all on function public.wake_due_money_jobs() from public, anon, authenticated;
grant execute on function public.wake_due_money_jobs() to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'process-payment-webhooks',
      'process-tip-payouts',
      'process-money-jobs-recovery'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'process-money-jobs-recovery',
    '*/5 * * * *',
    $job$select public.wake_due_money_jobs();$job$
  );
end $$;

-- Protected service health must follow the event-driven worker contract. The
-- recovery sweep is required, while immediate work is proven by the trigger.
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
      'finalize-account-deletions',
      'process-notification-jobs',
      'process-ops-jobs',
      'process-push-receipts',
      'monitor-tax-controls',
      'process-money-jobs-recovery'
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
