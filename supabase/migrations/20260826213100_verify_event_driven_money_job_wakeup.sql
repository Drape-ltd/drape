do $$
declare
  v_health jsonb;
begin
  if exists (
    select 1
    from cron.job
    where jobname in ('process-payment-webhooks', 'process-tip-payouts')
  ) then
    raise exception 'minute-level money polling jobs are still scheduled';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'process-money-jobs-recovery'
      and schedule = '*/5 * * * *'
      and command like '%wake_due_money_jobs%'
  ) then
    raise exception 'conditional money-job recovery sweep is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.job_queue'::regclass
      and tgname = 'trg_wake_money_job_worker'
      and tgenabled <> 'D'
  ) then
    raise exception 'event-driven money-job wakeup trigger is missing';
  end if;

  if position(
    'if not exists (' in lower(
      pg_get_functiondef('public.wake_due_money_jobs()'::regprocedure)
    )
  ) = 0 then
    raise exception 'money-job recovery sweep does not guard an empty queue';
  end if;

  v_health := public.get_drape_service_health();
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_health -> 'jobs', '[]'::jsonb)) as entry(value)
    where entry.value ->> 'jobname' = 'process-money-jobs-recovery'
      and coalesce((entry.value ->> 'active')::boolean, false)
  ) then
    raise exception 'event-driven money recovery is absent from protected readiness';
  end if;
end $$;
