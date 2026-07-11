-- Web Push subscriptions for browser notifications.
--
-- Mobile push remains in public.push_tokens because it is Expo-token based.
-- Browser push subscriptions are endpoint based and can belong either to a
-- signed-in customer/tailor account or to an Ops browser session.

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('ACCOUNT', 'OPS')),
  user_id uuid references auth.users(id) on delete cascade,
  ops_role text,
  ops_email text,
  endpoint text not null unique,
  p256dh text,
  auth text,
  user_agent text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_subscriptions_audience_owner_check check (
    (audience = 'ACCOUNT' and user_id is not null)
    or
    (audience = 'OPS' and user_id is null)
  )
);

create index if not exists web_push_subscriptions_user_enabled_idx
  on public.web_push_subscriptions (user_id, enabled, last_seen_at desc)
  where audience = 'ACCOUNT';

create index if not exists web_push_subscriptions_ops_enabled_idx
  on public.web_push_subscriptions (enabled, last_seen_at desc)
  where audience = 'OPS';

create index if not exists web_push_subscriptions_endpoint_idx
  on public.web_push_subscriptions (endpoint);

create or replace function public.set_web_push_subscription_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_web_push_subscriptions_updated_at on public.web_push_subscriptions;
create trigger trg_web_push_subscriptions_updated_at
before update on public.web_push_subscriptions
for each row
execute function public.set_web_push_subscription_updated_at();

alter table public.web_push_subscriptions enable row level security;

grant select, insert, update, delete on table public.web_push_subscriptions to authenticated;
grant select, insert, update, delete on table public.web_push_subscriptions to service_role;

drop policy if exists "users: read own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: read own account web push subscriptions"
  on public.web_push_subscriptions
  for select
  to authenticated
  using (audience = 'ACCOUNT' and user_id = auth.uid());

drop policy if exists "users: insert own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: insert own account web push subscriptions"
  on public.web_push_subscriptions
  for insert
  to authenticated
  with check (audience = 'ACCOUNT' and user_id = auth.uid());

drop policy if exists "users: update own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: update own account web push subscriptions"
  on public.web_push_subscriptions
  for update
  to authenticated
  using (audience = 'ACCOUNT' and user_id = auth.uid())
  with check (audience = 'ACCOUNT' and user_id = auth.uid());

drop policy if exists "users: delete own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: delete own account web push subscriptions"
  on public.web_push_subscriptions
  for delete
  to authenticated
  using (audience = 'ACCOUNT' and user_id = auth.uid());
