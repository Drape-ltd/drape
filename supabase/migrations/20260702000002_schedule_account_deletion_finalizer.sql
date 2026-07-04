-- Schedule the account deletion finalizer.
--
-- Ops marks eligible deletion requests as COMPLETED. This scheduled worker
-- performs the final safety re-check, deletes personal storage, and either
-- finalizes accounts with no shared records or records restricted retention
-- when marketplace order history must remain.

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
  where jobname = 'finalize-account-deletions';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'finalize-account-deletions',
    '30 3 * * *',
    $job$select util.invoke_edge_function('finalize-account-deletions');$job$
  );
end $$;
