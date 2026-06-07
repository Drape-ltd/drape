-- Production missing cron jobs hotfix.
--
-- Vault is configured separately; this migration only ensures the required
-- launch cron entries exist with the current intended cadence.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists util;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'release-order-payouts';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'release-order-payouts',
    '15 * * * *',
    $job$select util.invoke_edge_function('release-order-payouts');$job$
  );

  select jobid into existing_job_id from cron.job where jobname = 'escalate-production-stalls';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'escalate-production-stalls',
    '0 * * * *',
    $job$select util.invoke_edge_function('escalate-production-stalls');$job$
  );

  select jobid into existing_job_id from cron.job where jobname = 'send-consultation-reminders';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'send-consultation-reminders',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('send-consultation-reminders');$job$
  );
end $$;
