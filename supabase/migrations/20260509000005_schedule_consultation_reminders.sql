do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'send-consultation-reminders';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'send-consultation-reminders',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('send-consultation-reminders');$job$
  );
end $$;
