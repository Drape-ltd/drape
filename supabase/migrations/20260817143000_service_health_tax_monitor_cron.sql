-- Keep the protected readiness RPC in sync with the required tax-control
-- monitor installed by 20260816110200_schedule_tax_control_monitor.sql.
--
-- The RPC intentionally exposes only an explicit allowlist of job metadata to
-- the service-role-only health endpoint. Adding a cron job without updating
-- this list makes readiness report the installed job as missing.

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
      'monitor-tax-controls'
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
