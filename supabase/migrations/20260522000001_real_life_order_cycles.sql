-- Real-life order cycles for launch:
-- named wearer profiles, group member invites, trust transfer, and tailor data exports.

create table if not exists public.customer_measurement_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  relationship text not null default 'SELF' check (relationship in ('SELF', 'SPOUSE', 'PARENT', 'CHILD', 'FRIEND', 'GROUP_MEMBER', 'OTHER')),
  measurements jsonb not null default '{}'::jsonb,
  unit_preference text not null default 'cm',
  source text not null default 'MANUAL' check (source in ('MANUAL', 'DRAPE_VISION', 'TAILOR_ASSISTED', 'PASSPORT_CLAIM', 'IMPORT')),
  is_default boolean not null default false,
  last_measured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_measurement_profiles_one_default_idx
  on public.customer_measurement_profiles (customer_id)
  where is_default;

create index if not exists customer_measurement_profiles_customer_idx
  on public.customer_measurement_profiles (customer_id, updated_at desc);

alter table public.customer_measurement_profiles enable row level security;

drop policy if exists "Customers manage own measurement profiles" on public.customer_measurement_profiles;
create policy "Customers manage own measurement profiles"
  on public.customer_measurement_profiles
  for all
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

drop trigger if exists customer_measurement_profiles_updated_at on public.customer_measurement_profiles;
create trigger customer_measurement_profiles_updated_at
  before update on public.customer_measurement_profiles
  for each row execute function handle_updated_at();

do $$
declare
  v_order_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_order_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'orders'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_order_id_type is null then
    raise exception 'Could not resolve public.orders.id type for order_group_members.';
  end if;

  execute format($sql$
    create table if not exists public.order_group_members (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      owner_customer_id uuid not null references public.users(id) on delete cascade,
      measurement_profile_id uuid references public.customer_measurement_profiles(id) on delete set null,
      invited_user_id uuid references public.users(id) on delete set null,
      display_name text not null check (char_length(trim(display_name)) between 1 and 120),
      role text not null default 'WEARER' check (role in ('WEARER', 'RECIPIENT', 'BUYER', 'COORDINATOR')),
      status text not null default 'DRAFT' check (status in ('DRAFT', 'INVITED', 'ACCEPTED', 'DECLINED', 'REMOVED')),
      invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
      invited_at timestamptz,
      accepted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (order_id, display_name)
    )
  $sql$, v_order_id_type);
end;
$$;

create index if not exists order_group_members_order_idx
  on public.order_group_members (order_id, status);

create index if not exists order_group_members_invited_user_idx
  on public.order_group_members (invited_user_id, status)
  where invited_user_id is not null;

alter table public.order_group_members enable row level security;

drop policy if exists "Order owners manage group members" on public.order_group_members;
create policy "Order owners manage group members"
  on public.order_group_members
  for all
  using (owner_customer_id = auth.uid())
  with check (owner_customer_id = auth.uid());

drop policy if exists "Invited users view their group member row" on public.order_group_members;
create policy "Invited users view their group member row"
  on public.order_group_members
  for select
  using (invited_user_id = auth.uid());

drop trigger if exists order_group_members_updated_at on public.order_group_members;
create trigger order_group_members_updated_at
  before update on public.order_group_members
  for each row execute function handle_updated_at();

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid references public.users(id) on delete set null,
  referral_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  source text not null default 'APP',
  status text not null default 'CREATED' check (status in ('CREATED', 'CLICKED', 'CLAIMED', 'EXPIRED', 'BLOCKED')),
  trust_context jsonb not null default '{}'::jsonb,
  clicked_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_user_id, created_at desc);

create index if not exists referrals_referred_idx
  on public.referrals (referred_user_id, created_at desc)
  where referred_user_id is not null;

alter table public.referrals enable row level security;

drop policy if exists "Users view their own referral links" on public.referrals;
create policy "Users view their own referral links"
  on public.referrals
  for select
  using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

drop policy if exists "Users create their own referrals" on public.referrals;
create policy "Users create their own referrals"
  on public.referrals
  for insert
  with check (referrer_user_id = auth.uid());

drop trigger if exists referrals_updated_at on public.referrals;
create trigger referrals_updated_at
  before update on public.referrals
  for each row execute function handle_updated_at();

create table if not exists public.tailor_data_exports (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'IN_REVIEW', 'READY', 'DELIVERED', 'REJECTED', 'EXPIRED')),
  export_scope text not null default 'TAILOR_PORTABILITY',
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  generated_at timestamptz,
  expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tailor_data_exports_tailor_status_idx
  on public.tailor_data_exports (tailor_user_id, status, requested_at desc);

alter table public.tailor_data_exports enable row level security;

drop policy if exists "Tailors view own data export requests" on public.tailor_data_exports;
create policy "Tailors view own data export requests"
  on public.tailor_data_exports
  for select
  using (tailor_user_id = auth.uid());

drop trigger if exists tailor_data_exports_updated_at on public.tailor_data_exports;
create trigger tailor_data_exports_updated_at
  before update on public.tailor_data_exports
  for each row execute function handle_updated_at();
