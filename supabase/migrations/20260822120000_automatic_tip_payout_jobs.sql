-- Provider-confirmed tips are already customer-authorized money. Release them
-- automatically to a verified tailor payout destination; reserve Ops and Money
-- Desk for terminal exceptions and recovery.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
  tip record;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-tip-payouts'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-tip-payouts',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":25,"jobTypes":["PROCESS_TIP_PAYOUT"]}'::jsonb, 55000);$job$
  );

  -- Pick up tips captured before the automatic release worker existed. The
  -- domain-event/job dedupe keys make this safe to run more than once.
  for tip in
    select id, order_id
    from public.order_tips
    where status = 'PAYOUT_PENDING'
  loop
    perform public.enqueue_domain_event(
      p_event_type => 'tip.payout_requested',
      p_aggregate_type => 'order_tip',
      p_idempotency_key => 'tip-auto-payout:' || tip.id::text,
      p_payload => jsonb_build_object('tipId', tip.id),
      p_aggregate_id => tip.id::text,
      p_actor_role => 'SYSTEM',
      p_order_id => tip.order_id::uuid,
      p_metadata => jsonb_build_object('source', 'automatic-tip-payout-backfill'),
      p_jobs => array['PROCESS_TIP_PAYOUT'],
      p_priority => 5,
      p_max_attempts => 5,
      p_run_at => now()
    );
  end loop;
end $$;
