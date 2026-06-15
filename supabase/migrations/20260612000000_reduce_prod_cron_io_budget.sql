-- Reduce prod Disk IO spent on no-op cron/pg_net bookkeeping.
--
-- The production database is small, but pg_cron + pg_net write run details and
-- HTTP response rows for every invocation. At launch-stage traffic, minute-level
-- polling burns IO mostly to discover that no work is due.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'process-job-queue',
      'process-notification-jobs',
      'process-ops-jobs',
      'send-consultation-reminders',
      'expire-pending-payments',
      'expire-quotes',
      'release-order-payouts',
      'escalate-production-stalls',
      'escalate-handoff-issues',
      'auto-release'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  -- Critical notifications still go out within a few minutes without spending
  -- 1,440 cron invocations per day while the queue is mostly empty.
  perform cron.schedule(
    'process-notification-jobs',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS"]}'::jsonb, 300000);$job$
  );

  -- Ops issue creation is important, but not customer-blocking minute-by-minute.
  perform cron.schedule(
    'process-ops-jobs',
    '*/30 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":20,"jobTypes":["CREATE_OPS_ISSUE"]}'::jsonb, 300000);$job$
  );

  perform cron.schedule(
    'send-consultation-reminders',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('send-consultation-reminders');$job$
  );

  perform cron.schedule(
    'expire-pending-payments',
    '*/30 * * * *',
    $job$select util.invoke_edge_function('expire-pending-payments');$job$
  );

  perform cron.schedule(
    'expire-quotes',
    '20 * * * *',
    $job$select util.invoke_edge_function('expire-quotes');$job$
  );

  perform cron.schedule(
    'release-order-payouts',
    '15 * * * *',
    $job$select util.invoke_edge_function('release-order-payouts');$job$
  );

  perform cron.schedule(
    'escalate-production-stalls',
    '7 */6 * * *',
    $job$select util.invoke_edge_function('escalate-production-stalls');$job$
  );

  perform cron.schedule(
    'escalate-handoff-issues',
    '37 * * * *',
    $job$select util.invoke_edge_function('escalate-handoff-issues');$job$
  );

  perform cron.schedule(
    'auto-release',
    '0 9 * * *',
    $job$select util.invoke_edge_function('auto-release');$job$
  );
end $$;
