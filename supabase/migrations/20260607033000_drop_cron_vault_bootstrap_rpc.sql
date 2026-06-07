-- Remove the temporary production cron Vault bootstrap RPC after use.

drop function if exists public.bootstrap_cron_vault(text, text);
