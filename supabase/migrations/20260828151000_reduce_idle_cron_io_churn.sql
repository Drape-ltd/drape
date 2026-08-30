-- Reduce idle pg_cron/pg_net write amplification on small production compute.
-- Event-driven workers remain primary; these schedules are recovery sweeps.

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'send-consultation-reminders',
      'process-push-receipts',
      'monitor-payout-changes',
      'process-money-jobs-recovery',
      'process-ops-slack-jobs-recovery',
      'monitor-sentry-issues',
      'prune-cron-run-history'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  -- Five-minute reminder cadence still covers the 30/10/5-minute reminder
  -- contract without writing a cron result and HTTP response every minute.
  perform cron.schedule(
    'send-consultation-reminders',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('send-consultation-reminders');$job$
  );

  -- Receipt polling is eventual provider confirmation, not the source of truth.
  perform cron.schedule(
    'process-push-receipts',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('process-push-receipts', '{"limit":500}'::jsonb, 300000);$job$
  );

  perform cron.schedule(
    'monitor-payout-changes',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('monitor-payout-changes');$job$
  );

  perform cron.schedule(
    'process-money-jobs-recovery',
    '*/15 * * * *',
    $job$select public.wake_due_money_jobs();$job$
  );

  perform cron.schedule(
    'process-ops-slack-jobs-recovery',
    '*/15 * * * *',
    $job$select public.wake_due_ops_slack_jobs();$job$
  );

  perform cron.schedule(
    'monitor-sentry-issues',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('monitor-sentry-issues', '{}'::jsonb);$job$
  );

  -- Bound pg_cron's append-only execution history. Delete in small daily batches
  -- so cleanup itself cannot create an I/O spike on constrained compute.
  perform cron.schedule(
    'prune-cron-run-history',
    '35 3 * * *',
    $job$
      with stale as (
        select ctid
        from cron.job_run_details
        where coalesce(end_time, start_time) < now() - interval '7 days'
        order by start_time
        limit 5000
      )
      delete from cron.job_run_details d
      using stale
      where d.ctid = stale.ctid;
    $job$
  );
end
$$;

do $$
declare
  v_duplicate_count integer;
begin
  select count(*)
  into v_duplicate_count
  from (
    select jobname
    from cron.job
    where jobname in (
      'send-consultation-reminders',
      'process-push-receipts',
      'monitor-payout-changes',
      'process-money-jobs-recovery',
      'process-ops-slack-jobs-recovery',
      'monitor-sentry-issues',
      'prune-cron-run-history'
    )
    group by jobname
    having count(*) > 1
  ) duplicates;

  if v_duplicate_count > 0 then
    raise exception 'Duplicate high-frequency cron jobs remain after I/O relief migration';
  end if;
end
$$;
