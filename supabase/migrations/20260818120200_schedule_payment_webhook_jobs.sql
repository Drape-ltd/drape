-- Payment webhooks have their own high-priority worker partition. This keeps
-- provider acknowledgements fast without allowing notification volume to
-- delay authoritative money transitions or reconciliation.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-payment-webhooks'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-payment-webhooks',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":50,"jobTypes":["PROCESS_PAYMENT_WEBHOOK","RECONCILE_PAYMENT_WEBHOOK"]}'::jsonb, 55000);$job$
  );
end $$;
