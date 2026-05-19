do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'escalate-production-stalls';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'escalate-production-stalls',
    '0 * * * *',
    $job$select util.invoke_edge_function('escalate-production-stalls');$job$
  );
end $$;
