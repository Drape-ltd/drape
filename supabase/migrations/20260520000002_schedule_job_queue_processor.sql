-- Process retryable side-effect jobs every minute. The worker itself is
-- idempotent and claims rows with SKIP LOCKED, so this schedule can later be
-- complemented by manual or additional worker invocations.

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'process-job-queue';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-job-queue',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":25}'::jsonb, 300000);$job$
  );
end $$;
