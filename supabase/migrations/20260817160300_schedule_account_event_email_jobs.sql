-- Account lifecycle emails use the same audited notification queue as order
-- emails. Include them in the notification worker partition so every queued
-- payout/setup email reaches a recorded terminal outcome.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'process-notification-jobs'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-notification-jobs',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ACCOUNT_EVENT_EMAIL","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS"]}'::jsonb, 300000);$job$
  );
end $$;
