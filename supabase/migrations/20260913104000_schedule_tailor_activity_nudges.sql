-- One daily lifecycle pass. The function chooses at most one nudge per tailor,
-- applies a six-day cross-campaign cooldown, and relies on durable job keys for
-- milestone/month deduplication.

create extension if not exists pg_cron;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname = 'send-tailor-activity-nudges';

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule(
    'send-tailor-activity-nudges',
    '40 14 * * *',
    $job$select util.invoke_edge_function('send-tailor-activity-nudges', '{}'::jsonb);$job$
  );
end
$$;
