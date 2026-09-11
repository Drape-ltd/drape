-- Bind Ops browser push subscriptions to active workforce principals and make
-- expiry/failure state explicit. The sender resolves live principal access.

alter table public.web_push_subscriptions
  add column if not exists ops_principal_id uuid references public.ops_workforce_principals(id) on delete cascade,
  add column if not exists last_authenticated_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists failure_count integer not null default 0 check (failure_count >= 0),
  add column if not exists last_delivered_at timestamptz;

update public.web_push_subscriptions subscription
set ops_principal_id = principal.id
from public.ops_workforce_principals principal
where subscription.audience = 'OPS'
  and subscription.ops_principal_id is null
  and lower(subscription.ops_email) = principal.email;

update public.web_push_subscriptions
set enabled = false,
    failure_reason = 'WORKFORCE_PRINCIPAL_REQUIRED',
    failed_at = coalesce(failed_at, now())
where audience = 'OPS'
  and ops_principal_id is null
  and enabled = true;

create index if not exists web_push_subscriptions_ops_principal_enabled_idx
  on public.web_push_subscriptions (ops_principal_id, enabled, expires_at desc)
  where audience = 'OPS';

alter table public.web_push_subscriptions
  drop constraint if exists web_push_subscriptions_ops_principal_check;

alter table public.web_push_subscriptions
  add constraint web_push_subscriptions_ops_principal_check check (
    audience <> 'OPS'
    or enabled is false
    or (
      ops_principal_id is not null
      and ops_email is not null
      and last_authenticated_at is not null
      and expires_at is not null
    )
  );

create or replace function public.record_web_push_delivery_result(
  p_endpoint text,
  p_delivered boolean,
  p_failure_reason text default null,
  p_disable boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.web_push_subscriptions
  set
    enabled = case when p_disable then false else enabled end,
    failure_count = case when p_delivered then 0 else failure_count + 1 end,
    failed_at = case when p_delivered then null else now() end,
    failure_reason = case when p_delivered then null else left(coalesce(p_failure_reason, 'UNKNOWN'), 180) end,
    last_delivered_at = case when p_delivered then now() else last_delivered_at end,
    updated_at = now()
  where endpoint = p_endpoint;
end;
$$;

revoke all on function public.record_web_push_delivery_result(text, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_web_push_delivery_result(text, boolean, text, boolean)
  to service_role;
