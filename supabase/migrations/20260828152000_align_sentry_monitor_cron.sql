-- Keep the Sentry monitor as a low-frequency recovery sweep. Event-driven
-- delivery remains primary; this cron only catches missed or delayed work.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'monitor-sentry-issues'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'monitor-sentry-issues',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('monitor-sentry-issues', '{}'::jsonb);$job$
  );
end;
$$;

do $$
begin
  if (
    select count(*)
    from cron.job
    where jobname = 'monitor-sentry-issues'
      and schedule = '*/15 * * * *'
  ) <> 1 then
    raise exception 'monitor-sentry-issues must have exactly one 15-minute recovery schedule';
  end if;
end;
$$;
