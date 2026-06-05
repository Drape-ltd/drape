-- Reduce no-op cron write churn while keeping customer-facing notification
-- delivery responsive. Ops issue creation can safely run every five minutes;
-- push/SMS/email queue processing remains every minute.

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'process-ops-jobs';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-ops-jobs',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":20,"jobTypes":["CREATE_OPS_ISSUE"]}'::jsonb, 300000);$job$
  );
end $$;
