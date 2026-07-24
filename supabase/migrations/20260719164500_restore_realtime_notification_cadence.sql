-- Push and transactional email are user-facing interaction paths. Five-minute
-- polling makes successful delivery feel broken, so restore minute-level queue
-- processing while keeping ops-only background work on its lower cadence.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-notification-jobs';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-notification-jobs',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS"]}'::jsonb, 300000);$job$
  );
end $$;
