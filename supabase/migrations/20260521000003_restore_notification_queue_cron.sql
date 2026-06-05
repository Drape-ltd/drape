-- Ensure transactional side effects keep moving after deploys or manual cron edits.
-- This worker handles user-visible push, SMS, and email jobs separately from ops-only
-- jobs so a noisy ops queue cannot starve order confirmations and quote alerts.

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-job-queue';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

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
