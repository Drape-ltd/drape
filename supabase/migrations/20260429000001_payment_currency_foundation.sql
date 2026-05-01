-- Drape V1 — Payment and currency foundation
-- Purpose:
-- 1. Make account-level currency durable on public.users.
-- 2. Separate payout currency from tailor pricing currency.
-- 3. Lock order currency + line items on the order row.
-- 4. Add append-only payment attempt and webhook ledgers.
-- 5. Backfill existing data without leaving null currency fields.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'order_payment_phase'
  ) then
    create type order_payment_phase as enum ('INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT');
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'order_payment_status'
  ) then
    create type order_payment_status as enum ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'payout_status'
  ) then
    create type payout_status as enum ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED', 'CANCELED');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'currency'
      and e.enumlabel = 'CAD'
  ) then
    alter type currency add value 'CAD';
  end if;
end;
$$;

create or replace function public.resolve_payment_provider_for_currency(p_currency currency)
returns payment_provider
language plpgsql
immutable
as $$
begin
  case p_currency
    when 'NGN', 'GHS', 'KES' then
      return 'PAYSTACK';
    when 'USD', 'GBP', 'EUR', 'CAD' then
      return 'STRIPE';
    else
      raise exception 'Unsupported currency % for payment routing', p_currency;
  end case;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text not null,
  role user_role not null,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.users
  add column if not exists default_currency currency,
  add column if not exists currency_confirmed_at timestamptz,
  add column if not exists currency_source text,
  add column if not exists region_code text;

update public.users
set default_currency = coalesce(default_currency, 'USD'::currency),
    currency_confirmed_at = coalesce(currency_confirmed_at, now()),
    currency_source = coalesce(nullif(trim(currency_source), ''), 'UNSUPPORTED_FALLBACK'),
    region_code = coalesce(nullif(upper(trim(region_code)), ''), 'ZZ');

alter table public.users
  alter column default_currency set default 'USD',
  alter column default_currency set not null,
  alter column currency_confirmed_at set default now(),
  alter column currency_confirmed_at set not null,
  alter column currency_source set default 'UNSUPPORTED_FALLBACK',
  alter column currency_source set not null,
  alter column region_code set default 'ZZ',
  alter column region_code set not null;

alter table public.users
  drop constraint if exists users_currency_source_check;

alter table public.users
  add constraint users_currency_source_check
  check (currency_source in ('DEVICE_LOCALE', 'IP_GEO', 'USER_SELECTED', 'UNSUPPORTED_FALLBACK'));

alter table public.users
  drop constraint if exists users_region_code_check;

alter table public.users
  add constraint users_region_code_check
  check (char_length(region_code) = 2);

insert into public.users (
  id,
  email,
  display_name,
  role,
  phone,
  default_currency,
  currency_confirmed_at,
  currency_source,
  region_code,
  created_at,
  updated_at
)
select
  au.id,
  coalesce(au.email, format('%s@drape.invalid', au.id::text)),
  coalesce(au.raw_user_meta_data->>'display_name', split_part(coalesce(au.email, au.id::text), '@', 1)),
  coalesce((au.raw_user_meta_data->>'role')::user_role, 'CUSTOMER'::user_role),
  nullif(au.raw_user_meta_data->>'phone', ''),
  'USD'::currency,
  now(),
  'UNSUPPORTED_FALLBACK',
  'ZZ',
  coalesce(au.created_at, now()),
  now()
from auth.users au
where not exists (
  select 1
  from public.users u
  where u.id = au.id
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (
    id,
    email,
    display_name,
    role,
    phone,
    default_currency,
    currency_confirmed_at,
    currency_source,
    region_code
  )
  values (
    new.id,
    coalesce(new.email, format('%s@drape.invalid', new.id::text)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.id::text), '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'CUSTOMER'::user_role),
    nullif(new.raw_user_meta_data->>'phone', ''),
    'USD'::currency,
    now(),
    'UNSUPPORTED_FALLBACK',
    'ZZ'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.users enable row level security;

drop policy if exists "Users can view their own profile" on public.users;
create policy "Users can view their own profile"
  on public.users
  for select
  using (id::text = auth.uid()::text);

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users
  for update
  using (id::text = auth.uid()::text)
  with check (id::text = auth.uid()::text);

grant select (
  id,
  email,
  display_name,
  role,
  phone,
  default_currency,
  currency_confirmed_at,
  currency_source,
  region_code,
  created_at,
  updated_at
) on table public.users to authenticated;

revoke update on table public.users from authenticated;
grant update (
  display_name,
  role,
  phone,
  default_currency,
  currency_confirmed_at,
  currency_source,
  region_code,
  updated_at
) on table public.users to authenticated;

create index if not exists users_default_currency_idx
  on public.users (default_currency);

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function handle_updated_at();

alter table public.tailor_profiles
  alter column currency set default 'USD';

alter table public.tailor_profiles
  add column if not exists payout_currency currency,
  add column if not exists payout_provider payment_provider,
  add column if not exists payout_reverification_required boolean;

update public.tailor_profiles
set payout_currency = coalesce(payout_currency, currency, 'USD'::currency),
    payout_provider = coalesce(payout_provider, public.resolve_payment_provider_for_currency(coalesce(payout_currency, currency, 'USD'::currency))),
    payout_reverification_required = coalesce(payout_reverification_required, false);

alter table public.tailor_profiles
  alter column payout_currency set default 'USD',
  alter column payout_currency set not null,
  alter column payout_reverification_required set default false,
  alter column payout_reverification_required set not null;

create or replace function public.sync_tailor_payout_currency_fields()
returns trigger
language plpgsql
as $$
begin
  if new.payout_currency is null then
    new.payout_currency := coalesce(new.currency, 'USD'::currency);
  end if;

  new.payout_provider := public.resolve_payment_provider_for_currency(new.payout_currency);

  if tg_op = 'INSERT' then
    new.payout_reverification_required := coalesce(new.payout_reverification_required, false);
  elsif new.payout_currency is distinct from old.payout_currency then
    new.payout_reverification_required := true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tailor_payout_currency_sync on public.tailor_profiles;
create trigger trg_tailor_payout_currency_sync
  before insert or update of payout_currency
  on public.tailor_profiles
  for each row execute function public.sync_tailor_payout_currency_fields();

grant select (
  payout_currency,
  payout_provider,
  payout_reverification_required
) on table public.tailor_profiles to authenticated;

grant update (
  payout_currency
) on table public.tailor_profiles to authenticated;

create index if not exists tailor_profiles_payout_currency_idx
  on public.tailor_profiles (payout_currency);

alter table if exists public.seller_items
  alter column currency set default 'USD';

alter table if exists public.offline_orders
  alter column currency set default 'USD';

alter table public.orders
  alter column currency set default 'USD';

alter table public.orders
  add column if not exists source_currency currency,
  add column if not exists source_amount integer,
  add column if not exists fx_rate numeric(18, 8),
  add column if not exists fx_rate_timestamp timestamptz,
  add column if not exists subtotal_amount integer,
  add column if not exists platform_fee_amount integer,
  add column if not exists tax_amount integer,
  add column if not exists tax_rate_bps integer,
  add column if not exists shipping_amount integer,
  add column if not exists total_amount integer;

-- Historical terminal orders are immutable after 20260428000002_order_terminal_hardening.
-- Temporarily disable only that guard trigger so this one-time metadata backfill can
-- populate canonical currency and payment ledger columns on legacy rows without weakening
-- terminal-order protection for runtime application writes.
alter table if exists public.orders disable trigger orders_terminal_guard;

update public.orders
set currency = case
      when quoted_currency is not null
        and upper(trim(quoted_currency)) in ('NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD')
        then upper(trim(quoted_currency))::currency
      else coalesce(currency, 'USD'::currency)
    end,
    source_currency = coalesce(
      source_currency,
      case
        when quoted_currency is not null
          and upper(trim(quoted_currency)) in ('NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD')
          then upper(trim(quoted_currency))::currency
        else currency
      end
    ),
    source_amount = coalesce(source_amount, quoted_amount, item_subtotal, item_unit_price),
    subtotal_amount = coalesce(
      subtotal_amount,
      item_subtotal,
      case
        when quoted_amount is not null then greatest(quoted_amount - coalesce(fulfillment_fee, 0), 0)
        else 0
      end,
      0
    ),
    platform_fee_amount = coalesce(platform_fee_amount, 0),
    tax_amount = coalesce(tax_amount, 0),
    tax_rate_bps = coalesce(tax_rate_bps, 0),
    shipping_amount = coalesce(shipping_amount, fulfillment_fee, 0),
    total_amount = coalesce(total_amount, quoted_amount, coalesce(item_subtotal, 0) + coalesce(fulfillment_fee, 0), 0),
    payment_provider = case
      when currency is not null then public.resolve_payment_provider_for_currency(
        case
          when quoted_currency is not null
            and upper(trim(quoted_currency)) in ('NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD')
            then upper(trim(quoted_currency))::currency
          else currency
        end
      )
      else payment_provider
    end,
    fulfillment_payment_provider = case
      when coalesce(fulfillment_payment_requested_at, fulfillment_payment_paid_at) is not null then public.resolve_payment_provider_for_currency(
        case
          when quoted_currency is not null
            and upper(trim(quoted_currency)) in ('NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD')
            then upper(trim(quoted_currency))::currency
          else coalesce(currency, 'USD'::currency)
        end
      )
      else fulfillment_payment_provider
    end;

alter table if exists public.orders enable trigger orders_terminal_guard;

alter table public.orders
  alter column subtotal_amount set default 0,
  alter column subtotal_amount set not null,
  alter column platform_fee_amount set default 0,
  alter column platform_fee_amount set not null,
  alter column tax_amount set default 0,
  alter column tax_amount set not null,
  alter column tax_rate_bps set default 0,
  alter column tax_rate_bps set not null,
  alter column shipping_amount set default 0,
  alter column shipping_amount set not null,
  alter column total_amount set default 0,
  alter column total_amount set not null;

comment on column public.orders.currency is 'Canonical locked order currency used for display, provider routing, and settlement.';
comment on column public.orders.quoted_currency is 'Deprecated compatibility field. New payment flows should use orders.currency.';
comment on column public.orders.total_amount is 'Locked total in minor units for the order currency.';

create index if not exists orders_currency_idx
  on public.orders (currency);

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
    raise exception 'Could not resolve public.orders.id type for order_payments backfill migration.';
  end if;

  execute format($sql$
    create table if not exists public.order_payments (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      phase order_payment_phase not null,
      provider payment_provider not null,
      currency currency not null,
      amount integer not null check (amount >= 0),
      status order_payment_status not null default 'INITIATED',
      idempotency_key text not null unique,
      provider_payment_id text,
      provider_checkout_url text,
      provider_response jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      confirmed_at timestamptz,
      failed_at timestamptz,
      refunded_at timestamptz
    )
  $sql$, v_order_id_type);
end;
$$;

alter table public.order_payments enable row level security;

drop policy if exists "Order participants view payment attempts" on public.order_payments;
create policy "Order participants view payment attempts"
  on public.order_payments
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_payments.order_id
        and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
    )
  );

grant select on table public.order_payments to authenticated;

create index if not exists order_payments_order_created_idx
  on public.order_payments (order_id, created_at desc);

create index if not exists order_payments_status_created_idx
  on public.order_payments (status, created_at desc);

create unique index if not exists order_payments_provider_payment_id_idx
  on public.order_payments (provider, provider_payment_id)
  where provider_payment_id is not null;

drop trigger if exists order_payments_updated_at on public.order_payments;
create trigger order_payments_updated_at
  before update on public.order_payments
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
    raise exception 'Could not resolve public.orders.id type for payment_webhook_events backfill migration.';
  end if;

  execute format($sql$
    create table if not exists public.payment_webhook_events (
      id uuid primary key default gen_random_uuid(),
      provider payment_provider not null,
      provider_event_id text not null,
      event_type text not null,
      order_id %s references public.orders(id) on delete set null,
      payment_id uuid references public.order_payments(id) on delete set null,
      signature_valid boolean not null default false,
      payload jsonb not null default '{}'::jsonb,
      processed_at timestamptz,
      processing_result text,
      created_at timestamptz not null default now()
    )
  $sql$, v_order_id_type);
end;
$$;

alter table public.payment_webhook_events enable row level security;

create unique index if not exists payment_webhook_events_provider_event_idx
  on public.payment_webhook_events (provider, provider_event_id);

create index if not exists payment_webhook_events_order_created_idx
  on public.payment_webhook_events (order_id, created_at desc);

create index if not exists payment_webhook_events_payment_created_idx
  on public.payment_webhook_events (payment_id, created_at desc);

alter table public.payouts
  add column if not exists status payout_status,
  add column if not exists source_payment_id uuid references public.order_payments(id) on delete set null,
  add column if not exists provider_response jsonb;

update public.payouts
set status = coalesce(status, 'PAID'::payout_status),
    provider_response = coalesce(provider_response, '{}'::jsonb);

alter table public.payouts
  alter column status set default 'PAID',
  alter column status set not null,
  alter column provider_response set default '{}'::jsonb,
  alter column provider_response set not null;

create index if not exists payouts_status_processed_idx
  on public.payouts (status, processed_at desc);
