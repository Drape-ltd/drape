-- Bound prelaunch pg_cron/pg_net write amplification.
--
-- Durable rows and event-driven wakeups remain authoritative. These schedules
-- are recovery/reconciliation lanes, so they do not need production-scale
-- polling while payments and marketplace traffic are not live.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'process-job-queue',
      'process-payment-webhooks',
      'process-tip-payouts',
      'process-notification-jobs',
      'process-ops-jobs',
      'process-money-jobs-recovery',
      'process-push-receipts',
      'process-ops-slack-jobs-recovery',
      'send-consultation-reminders',
      'expire-pending-payments',
      'expire-quotes',
      'auto-release',
      'release-order-payouts',
      'escalate-production-stalls',
      'monitor-tax-controls',
      'monitor-sentry-issues',
      'ops-slack-sla-reminders',
      'ops-slack-daily-digest',
      'monitor-settlements',
      'monitor-material-reconciliation',
      'monitor-payout-changes',
      'expire-commercial-benefits'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  -- Customer-facing delivery remains responsive without minute polling.
  perform cron.schedule(
    'process-notification-jobs',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ACCOUNT_EVENT_EMAIL","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS","SEND_OPS_VERIFICATION_EMAIL"]}'::jsonb, 300000);$job$
  );

  -- Scheduled-call reminders need five-minute precision for the 30/10/5/start
  -- reminder contract.
  perform cron.schedule(
    'send-consultation-reminders',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('send-consultation-reminders');$job$
  );

  perform cron.schedule(
    'process-ops-jobs',
    '7,37 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":20,"jobTypes":["CREATE_OPS_ISSUE"]}'::jsonb, 300000);$job$
  );

  perform cron.schedule(
    'process-money-jobs-recovery',
    '11,41 * * * *',
    $job$select public.wake_due_money_jobs();$job$
  );

  perform cron.schedule(
    'process-push-receipts',
    '13,43 * * * *',
    $job$select util.invoke_edge_function('process-push-receipts', '{"limit":500}'::jsonb, 300000);$job$
  );

  perform cron.schedule(
    'process-ops-slack-jobs-recovery',
    '17,47 * * * *',
    $job$select public.wake_due_ops_slack_jobs();$job$
  );

  perform cron.schedule(
    'monitor-sentry-issues',
    '23,53 * * * *',
    $job$select util.invoke_edge_function('monitor-sentry-issues', '{}'::jsonb);$job$
  );

  perform cron.schedule(
    'ops-slack-sla-reminders',
    '27,57 * * * *',
    $job$select public.enqueue_ops_slack_sla_reminders();$job$
  );

  -- Prelaunch payment/quote reconciliation remains available at a bounded
  -- cadence; payment webhooks and durable jobs still wake workers immediately.
  perform cron.schedule(
    'expire-pending-payments',
    '5 */2 * * *',
    $job$select util.invoke_edge_function('expire-pending-payments');$job$
  );

  perform cron.schedule(
    'expire-quotes',
    '25 */2 * * *',
    $job$select util.invoke_edge_function('expire-quotes');$job$
  );

  perform cron.schedule(
    'release-order-payouts',
    '15 */6 * * *',
    $job$select util.invoke_edge_function('release-order-payouts');$job$
  );

  perform cron.schedule(
    'escalate-production-stalls',
    '35 */6 * * *',
    $job$select util.invoke_edge_function('escalate-production-stalls');$job$
  );

  perform cron.schedule(
    'monitor-tax-controls',
    '17 */6 * * *',
    $job$select util.invoke_edge_function('monitor-tax-controls', '{}'::jsonb);$job$
  );

  perform cron.schedule(
    'auto-release',
    '0 9 * * *',
    $job$select util.invoke_edge_function('auto-release');$job$
  );

  perform cron.schedule(
    'ops-slack-daily-digest',
    '0 14 * * *',
    $job$select public.enqueue_ops_slack_daily_digest();$job$
  );
end
$$;

do $$
declare
  v_duplicate_count integer;
  v_legacy_count integer;
begin
  select count(*)
  into v_duplicate_count
  from (
    select jobname
    from cron.job
    group by jobname
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_legacy_count
  from cron.job
  where jobname in (
    'process-job-queue',
    'process-payment-webhooks',
    'process-tip-payouts',
    'monitor-settlements',
    'monitor-material-reconciliation',
    'monitor-payout-changes',
    'expire-commercial-benefits'
  );

  if v_duplicate_count > 0 then
    raise exception 'Duplicate cron jobs remain after prelaunch I/O stabilization';
  end if;

  if v_legacy_count > 0 then
    raise exception 'Optional or legacy polling jobs remain after prelaunch I/O stabilization';
  end if;
end
$$;
