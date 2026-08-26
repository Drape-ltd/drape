-- Implementation 11E review-expiry monitor. The Edge endpoint remains
-- cron-secret protected and produces identifier-only Ops/Sentry context.
select cron.schedule(
  'monitor-tax-controls',
  '17 * * * *',
  $$select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/monitor-tax-controls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );$$
)
where not exists (select 1 from cron.job where jobname = 'monitor-tax-controls');
