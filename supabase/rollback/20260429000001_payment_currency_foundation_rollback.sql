-- Rollback for 20260429000001_payment_currency_foundation.sql
-- Safety rule:
-- This rollback refuses to continue if any surviving rows still use CAD
-- in columns that would remain after rollback. Resolve or migrate those
-- rows first before recreating the old six-value currency enum.

do $$
begin
  if exists (select 1 from public.users where default_currency::text = 'CAD') then
    raise exception 'Rollback blocked: public.users.default_currency still contains CAD.';
  end if;

  if exists (select 1 from public.tailor_profiles where currency::text = 'CAD') then
    raise exception 'Rollback blocked: public.tailor_profiles.currency still contains CAD.';
  end if;

  if exists (select 1 from public.orders where currency::text = 'CAD') then
    raise exception 'Rollback blocked: public.orders.currency still contains CAD.';
  end if;

  if exists (select 1 from public.payouts where currency::text = 'CAD') then
    raise exception 'Rollback blocked: public.payouts.currency still contains CAD.';
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'seller_items'
  ) and exists (select 1 from public.seller_items where currency::text = 'CAD') then
    raise exception 'Rollback blocked: public.seller_items.currency still contains CAD.';
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'offline_orders'
  ) and exists (select 1 from public.offline_orders where currency::text = 'CAD') then
    raise exception 'Rollback blocked: public.offline_orders.currency still contains CAD.';
  end if;
end;
$$;

drop trigger if exists order_payments_updated_at on public.order_payments;
drop table if exists public.payment_webhook_events;
drop table if exists public.order_payments;

drop trigger if exists trg_tailor_payout_currency_sync on public.tailor_profiles;
drop function if exists public.sync_tailor_payout_currency_fields();
drop function if exists public.resolve_payment_provider_for_currency(currency);

alter table public.payouts
  drop column if exists source_payment_id,
  drop column if exists provider_response,
  drop column if exists status;

alter table public.orders
  drop column if exists source_currency,
  drop column if exists source_amount,
  drop column if exists fx_rate,
  drop column if exists fx_rate_timestamp,
  drop column if exists subtotal_amount,
  drop column if exists platform_fee_amount,
  drop column if exists tax_amount,
  drop column if exists tax_rate_bps,
  drop column if exists shipping_amount,
  drop column if exists total_amount;

alter table public.tailor_profiles
  drop column if exists payout_currency,
  drop column if exists payout_provider,
  drop column if exists payout_reverification_required;

drop trigger if exists users_updated_at on public.users;

alter table public.users
  drop constraint if exists users_currency_source_check,
  drop constraint if exists users_region_code_check,
  drop column if exists default_currency,
  drop column if exists currency_confirmed_at,
  drop column if exists currency_source,
  drop column if exists region_code;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'CUSTOMER')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'currency_pre_cad'
  ) then
    create type currency_pre_cad as enum ('GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES');
  end if;
end;
$$;

alter table public.tailor_profiles
  alter column currency drop default,
  alter column currency type currency_pre_cad using currency::text::currency_pre_cad;

alter table public.orders
  alter column currency drop default,
  alter column currency type currency_pre_cad using currency::text::currency_pre_cad;

alter table public.payouts
  alter column currency type currency_pre_cad using currency::text::currency_pre_cad;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'seller_items'
  ) then
    execute 'alter table public.seller_items alter column currency drop default';
    execute 'alter table public.seller_items alter column currency type currency_pre_cad using currency::text::currency_pre_cad';
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'offline_orders'
  ) then
    execute 'alter table public.offline_orders alter column currency drop default';
    execute 'alter table public.offline_orders alter column currency type currency_pre_cad using currency::text::currency_pre_cad';
  end if;
end;
$$;

drop type if exists currency;
alter type currency_pre_cad rename to currency;

alter table public.tailor_profiles
  alter column currency set default 'GBP';

alter table public.orders
  alter column currency set default 'GBP';

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'seller_items'
  ) then
    execute 'alter table public.seller_items alter column currency set default ''GBP''';
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'offline_orders'
  ) then
    execute 'alter table public.offline_orders alter column currency set default ''GBP''';
  end if;
end;
$$;

drop type if exists payout_status;
drop type if exists order_payment_status;
drop type if exists order_payment_phase;
