-- Remind eligible tailors to finish payout setup without sending repeated mail
-- every day. The Edge Function uses durable idempotency keys for day 1, 3, 7,
-- 14, and 30; day 3 is inbox/push only.

create extension if not exists pg_cron;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname = 'send-tailor-readiness-reminders';

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule(
    'send-tailor-readiness-reminders',
    '20 14 * * *',
    $job$select util.invoke_edge_function('send-tailor-readiness-reminders', '{}'::jsonb);$job$
  );
end
$$;
