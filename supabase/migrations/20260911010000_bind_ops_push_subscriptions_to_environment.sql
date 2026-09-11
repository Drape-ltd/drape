-- Ops notification subscriptions are environment-specific even when one named
-- workforce principal is permitted to operate in both projects.

alter table public.web_push_subscriptions
  add column if not exists ops_environment text
    check (ops_environment is null or ops_environment in ('development', 'production'));

update public.web_push_subscriptions
set ops_environment = lower(public.current_ops_environment())
where audience = 'OPS'
  and ops_environment is null
  and public.current_ops_environment() in ('DEVELOPMENT', 'PRODUCTION');

update public.web_push_subscriptions
set enabled = false,
    failure_reason = 'OPS_ENVIRONMENT_REQUIRED',
    failed_at = coalesce(failed_at, now())
where audience = 'OPS'
  and enabled = true
  and ops_environment is null;

alter table public.web_push_subscriptions
  drop constraint if exists web_push_subscriptions_ops_environment_check;

alter table public.web_push_subscriptions
  add constraint web_push_subscriptions_ops_environment_check check (
    audience <> 'OPS'
    or enabled is false
    or ops_environment in ('development', 'production')
  );

create index if not exists web_push_subscriptions_ops_environment_enabled_idx
  on public.web_push_subscriptions (ops_environment, ops_principal_id, enabled, expires_at desc)
  where audience = 'OPS';

comment on column public.web_push_subscriptions.ops_environment is
  'Authoritative Drapeon environment for an Ops subscription; prevents development/production alert crossover.';
