-- Process rich tailor-verification review emails through the durable notification
-- queue so submission alerts are retried and dead-letter failures reach Ops.

create extension if not exists pg_cron;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'process-notification-jobs'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'process-notification-jobs',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS","SEND_OPS_VERIFICATION_EMAIL"]}'::jsonb, 300000);$job$
  );
end $$;
