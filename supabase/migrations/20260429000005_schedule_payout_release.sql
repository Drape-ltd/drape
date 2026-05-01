create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists util;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'release-order-payouts';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'release-order-payouts',
    '15 * * * *',
    $job$select util.invoke_edge_function('release-order-payouts');$job$
  );
end $$;
