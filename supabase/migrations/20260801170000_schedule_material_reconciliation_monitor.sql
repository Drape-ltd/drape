do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'monitor-material-reconciliation';
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
  perform cron.schedule(
    'monitor-material-reconciliation',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('monitor-material-reconciliation');$job$
  );
end $$;
