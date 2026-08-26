-- Expose the installed payment-webhook worker cron to protected readiness and
-- remove synthetic verification jobs left by 20260818120100 in environments
-- where that migration already ran. Real provider jobs are never matched.

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
      'process-payment-webhooks'
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

do $$
declare
  v_issue public.ops_issues%rowtype;
begin
  for v_issue in
    select issue.*
    from public.ops_issues issue
    join public.job_queue job
      on issue.related_entity_type = 'job_queue'
     and issue.related_entity_id = job.id::text
    where issue.status <> 'RESOLVED'
      and issue.source = 'process-job-queue'
      and issue.issue_type = 'SYSTEM_ALERT'
      and job.job_type = 'PROCESS_PAYMENT_WEBHOOK'
      and job.payload ->> 'provider' = 'PAYSTACK'
      and job.payload ->> 'providerEventId' like 'verify_async_webhook_%'
  loop
    insert into public.ops_audit_logs (
      issue_id,
      action_taken,
      performed_by,
      performed_role,
      reason,
      before_state,
      after_state
    ) values (
      v_issue.id,
      'RESOLVED_SYNTHETIC_VERIFICATION_ARTIFACT',
      null,
      'SYSTEM',
      'Removed a migration-only webhook verification job that was never a provider delivery.',
      to_jsonb(v_issue),
      jsonb_build_object('status', 'RESOLVED', 'synthetic', true)
    );

    update public.ops_issues
    set
      status = 'RESOLVED',
      resolved_at = now(),
      last_seen_at = now(),
      metadata = metadata || jsonb_build_object(
        'resolution', 'synthetic_verification_artifact_removed',
        'resolved_by', 'migration:20260818120400'
      )
    where id = v_issue.id;
  end loop;

  delete from public.job_queue
  where job_type = 'PROCESS_PAYMENT_WEBHOOK'
    and payload ->> 'provider' = 'PAYSTACK'
    and payload ->> 'providerEventId' like 'verify_async_webhook_%';
end;
$$;
