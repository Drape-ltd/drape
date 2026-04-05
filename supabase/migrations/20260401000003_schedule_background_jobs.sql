create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists util;

-- If Vault is available in the environment, create these Vault secrets once per
-- environment to activate the scheduled jobs:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--
-- Until both secrets exist (or until Vault is available at all),
-- util.invoke_edge_function() will no-op and the cron jobs will stay safely
-- dormant rather than failing noisily.

create or replace function util.project_url()
returns text
language plpgsql
security definer
set search_path = public, util, extensions
as $$
declare
  secret_value text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

  execute $sql$
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'project_url'
    limit 1
  $sql$
  into secret_value;

  return secret_value;
end;
$$;

create or replace function util.service_role_key()
returns text
language plpgsql
security definer
set search_path = public, util, extensions
as $$
declare
  secret_value text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

  execute $sql$
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1
  $sql$
  into secret_value;

  return secret_value;
end;
$$;

create or replace function util.invoke_edge_function(
  name text,
  body jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 300000
)
returns bigint
language plpgsql
security definer
set search_path = public, util, extensions
as $$
declare
  project_url text := util.project_url();
  role_key text := util.service_role_key();
begin
  if project_url is null or role_key is null then
    raise notice 'Skipping cron invocation for %, missing Vault secret(s): project_url and/or service_role_key', name;
    return null;
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/' || name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || role_key
    ),
    body := coalesce(body, '{}'::jsonb),
    timeout_milliseconds := timeout_milliseconds
  );
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'expire-pending-payments';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'expire-pending-payments',
    '*/10 * * * *',
    $job$select util.invoke_edge_function('expire-pending-payments');$job$
  );
end $$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'expire-quotes';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'expire-quotes',
    '*/30 * * * *',
    $job$select util.invoke_edge_function('expire-quotes');$job$
  );
end $$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'auto-release';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'auto-release',
    '0 9 * * *',
    $job$select util.invoke_edge_function('auto-release');$job$
  );
end $$;
