-- Temporary bootstrap RPC for production cron Vault secrets.
--
-- This function is service_role-only and contains no secret values. It exists
-- only so a health-secret-gated Edge function can copy server-only Edge env
-- values into DB Vault, where pg_cron can read them for util.invoke_edge_function().

create or replace function public.bootstrap_cron_vault(
  p_project_url text,
  p_service_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
begin
  if nullif(btrim(coalesce(p_project_url, '')), '') is null then
    raise exception 'project_url is required';
  end if;

  if nullif(btrim(coalesce(p_service_role_key, '')), '') is null then
    raise exception 'service_role_key is required';
  end if;

  if to_regclass('vault.secrets') is null or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is not available';
  end if;

  delete from vault.secrets
  where name in ('project_url', 'service_role_key');

  perform vault.create_secret(btrim(p_project_url), 'project_url');
  perform vault.create_secret(btrim(p_service_role_key), 'service_role_key');

  return jsonb_build_object(
    'ok', true,
    'projectUrlConfigured', true,
    'serviceRoleConfigured', true
  );
end;
$$;

revoke all on function public.bootstrap_cron_vault(text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_cron_vault(text, text) to service_role;
