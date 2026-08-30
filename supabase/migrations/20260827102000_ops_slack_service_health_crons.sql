-- Keep protected service health aligned with the durable Slack Ops worker.
-- Immediate delivery is event-driven; these cron jobs provide reminders,
-- digesting, and recovery for any missed wakeup.

create or replace function public.get_drape_service_health()
returns jsonb
language plpgsql
security definer
set search_path = public, util, extensions
as $$
declare
  cron_available boolean := to_regclass('cron.job') is not null;
  vault_available boolean := to_regclass('vault.decrypted_secrets') is not null;
  jobs jsonb := '[]'::jsonb;
  project_url_configured boolean := false;
  service_role_configured boolean := false;
begin
  if cron_available then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'jobname', jobname,
          'schedule', schedule,
          'active', active
        )
        order by jobname
      ),
      '[]'::jsonb
    )
    into jobs
    from cron.job
    where jobname in (
      'expire-pending-payments',
      'expire-quotes',
      'auto-release',
      'release-order-payouts',
      'escalate-production-stalls',
      'send-consultation-reminders',
      'finalize-account-deletions',
      'process-notification-jobs',
      'process-ops-jobs',
      'process-push-receipts',
      'monitor-tax-controls',
      'process-money-jobs-recovery',
      'ops-slack-sla-reminders',
      'ops-slack-daily-digest',
      'process-ops-slack-jobs-recovery'
    );
  end if;

  if vault_available then
    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'project_url'
      )
    $sql$
    into project_url_configured;

    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    $sql$
    into service_role_configured;
  end if;

  return jsonb_build_object(
    'cronAvailable', cron_available,
    'vaultAvailable', vault_available,
    'vaultProjectUrlConfigured', project_url_configured,
    'vaultServiceRoleConfigured', service_role_configured,
    'jobs', jobs
  );
end;
$$;

revoke all on function public.get_drape_service_health() from public, anon, authenticated;
grant execute on function public.get_drape_service_health() to service_role;
