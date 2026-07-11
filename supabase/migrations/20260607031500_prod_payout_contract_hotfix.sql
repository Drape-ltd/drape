-- Production payout contract hotfix.
--
-- Prod is intentionally being caught up in narrow launch-safe steps. The
-- current Edge payout/readiness functions expect these columns and ledgers.
-- This migration adds the runtime contract without pulling unrelated backlog
-- migrations into production.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_payment_phase') then
    create type order_payment_phase as enum ('INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_payment_status') then
    create type order_payment_status as enum ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');
  end if;

  if not exists (select 1 from pg_type where typname = 'payout_status') then
    create type payout_status as enum ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED', 'CANCELED');
  end if;

  if not exists (select 1 from pg_type where typname = 'payout_account_type') then
    create type payout_account_type as enum ('PAYSTACK', 'STRIPE_CONNECT');
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'currency')
    and not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'currency'
        and e.enumlabel = 'CAD'
    )
  then
    alter type currency add value 'CAD';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'order_payment_status')
    and not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'order_payment_status'
        and e.enumlabel = 'PARTIAL_REFUND'
    )
  then
    alter type order_payment_status add value 'PARTIAL_REFUND';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'payout_status')
    and not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'payout_status'
        and e.enumlabel = 'BLOCKED'
    )
  then
    alter type payout_status add value 'BLOCKED';
  end if;
end;
$$;

create or replace function public.resolve_payment_provider_for_currency(p_currency currency)
returns payment_provider
language plpgsql
immutable
as $$
begin
  case p_currency::text
    when 'NGN', 'GHS', 'KES' then
      return 'PAYSTACK'::payment_provider;
    else
      return 'STRIPE'::payment_provider;
  end case;
end;
$$;

alter table public.orders
  alter column currency set default 'USD',
  add column if not exists source_currency currency,
  add column if not exists source_amount integer,
  add column if not exists fx_rate numeric(18, 8),
  add column if not exists fx_rate_timestamp timestamptz,
  add column if not exists subtotal_amount integer,
  add column if not exists platform_fee_amount integer,
  add column if not exists tax_amount integer,
  add column if not exists tax_rate_bps integer,
  add column if not exists shipping_amount integer,
  add column if not exists total_amount integer,
  add column if not exists tailor_payout_currency_locked currency,
  add column if not exists tailor_payout_provider_locked payment_provider,
  add column if not exists tailor_paystack_recipient_code_locked text,
  add column if not exists tailor_stripe_connect_account_id_locked text,
  add column if not exists ops_payout_resolution_mode text,
  add column if not exists ops_payout_override_currency currency,
  add column if not exists ops_payout_override_provider payment_provider,
  add column if not exists ops_payout_override_amount integer,
  add column if not exists ops_payout_override_fx_rate numeric(18, 8),
  add column if not exists ops_payout_override_fx_rate_timestamp timestamptz,
  add column if not exists ops_payout_override_note text,
  add column if not exists handoff_completed_at timestamptz,
  add column if not exists customer_handoff_confirmed_at timestamptz,
  add column if not exists handoff_confirmation_source text;

alter table public.orders
  drop constraint if exists orders_handoff_confirmation_source_check,
  drop constraint if exists orders_ops_payout_resolution_mode_check;

alter table public.orders
  add constraint orders_handoff_confirmation_source_check
  check (
    handoff_confirmation_source is null
    or handoff_confirmation_source in (
      'CUSTOMER_RECEIPT',
      'CUSTOMER_COMPLETE',
      'COLLECTION_CODE_VERIFIED',
      'CARRIER_WEBHOOK',
      'SYSTEM_AUTO_DELIVERED',
      'HISTORICAL_BACKFILL'
    )
  ),
  add constraint orders_ops_payout_resolution_mode_check
  check (
    ops_payout_resolution_mode is null
    or ops_payout_resolution_mode in ('ORIGINAL_CURRENCY', 'CONVERT_TO_CURRENT', 'REFUND_CUSTOMER')
  );

-- Historical rows may already be terminal; keep runtime immutability intact while
-- allowing this schema-contract backfill to fill newly added accounting columns.
alter table if exists public.orders disable trigger orders_terminal_guard;

update public.orders
set currency = coalesce(currency, 'USD'::currency),
    source_currency = coalesce(source_currency, currency, 'USD'::currency),
    source_amount = coalesce(source_amount, quoted_amount, 0),
    subtotal_amount = coalesce(subtotal_amount, quoted_amount, 0),
    platform_fee_amount = coalesce(platform_fee_amount, 0),
    tax_amount = coalesce(tax_amount, 0),
    tax_rate_bps = coalesce(tax_rate_bps, 0),
    shipping_amount = coalesce(shipping_amount, 0),
    total_amount = coalesce(total_amount, quoted_amount, 0),
    handoff_completed_at = case
      when stage in ('DELIVERED', 'COLLECTED', 'COMPLETE') then coalesce(handoff_completed_at, stage_updated_at, updated_at, created_at)
      else handoff_completed_at
    end,
    customer_handoff_confirmed_at = case
      when stage in ('COLLECTED', 'COMPLETE') then coalesce(customer_handoff_confirmed_at, handoff_completed_at, stage_updated_at, updated_at, created_at)
      else customer_handoff_confirmed_at
    end,
    handoff_confirmation_source = case
      when stage in ('DELIVERED', 'COLLECTED', 'COMPLETE') then coalesce(handoff_confirmation_source, 'HISTORICAL_BACKFILL')
      else handoff_confirmation_source
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

create index if not exists orders_handoff_release_idx
  on public.orders (escrow_released, stage, customer_handoff_confirmed_at, handoff_completed_at);

create index if not exists orders_currency_idx
  on public.orders (currency);

alter table public.tailor_profiles
  alter column currency set default 'USD',
  add column if not exists payout_currency currency,
  add column if not exists payout_provider payment_provider,
  add column if not exists payout_reverification_required boolean,
  add column if not exists payout_account_type payout_account_type,
  add column if not exists payout_account_verified boolean,
  add column if not exists payout_account_verified_at timestamptz,
  add column if not exists payout_destination_hold_until timestamptz,
  add column if not exists paystack_recipient_code text,
  add column if not exists stripe_connect_account_id text,
  add column if not exists payout_bank_name text,
  add column if not exists payout_bank_code text,
  add column if not exists payout_account_name text,
  add column if not exists payout_account_masked text,
  add column if not exists payout_country_code text;

update public.tailor_profiles
set payout_currency = coalesce(payout_currency, currency, 'USD'::currency),
    payout_provider = coalesce(payout_provider, public.resolve_payment_provider_for_currency(coalesce(payout_currency, currency, 'USD'::currency))),
    payout_reverification_required = coalesce(payout_reverification_required, false),
    paystack_recipient_code = coalesce(paystack_recipient_code, nullif(trim(paystack_account_id), '')),
    stripe_connect_account_id = coalesce(stripe_connect_account_id, nullif(trim(stripe_account_id), '')),
    payout_account_type = coalesce(
      payout_account_type,
      case
        when coalesce(nullif(trim(paystack_recipient_code), ''), nullif(trim(paystack_account_id), '')) is not null then 'PAYSTACK'::payout_account_type
        when coalesce(nullif(trim(stripe_connect_account_id), ''), nullif(trim(stripe_account_id), '')) is not null then 'STRIPE_CONNECT'::payout_account_type
        else null
      end
    ),
    payout_account_verified = coalesce(payout_account_verified, false);

alter table public.tailor_profiles
  alter column payout_currency set default 'USD',
  alter column payout_currency set not null,
  alter column payout_reverification_required set default false,
  alter column payout_reverification_required set not null,
  alter column payout_account_verified set default false,
  alter column payout_account_verified set not null;

create index if not exists tailor_profiles_payout_currency_idx
  on public.tailor_profiles (payout_currency);

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
    raise exception 'Could not resolve public.orders.id type for order_payments migration.';
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
      refunded_amount integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      confirmed_at timestamptz,
      failed_at timestamptz,
      refunded_at timestamptz
    )
  $sql$, v_order_id_type);
end;
$$;

alter table public.order_payments
  add column if not exists refunded_amount integer not null default 0,
  drop constraint if exists order_payments_refunded_amount_check,
  add constraint order_payments_refunded_amount_check
  check (refunded_amount >= 0 and refunded_amount <= amount);

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
grant select, insert, update, delete on table public.order_payments to service_role;

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

alter table public.payouts
  add column if not exists status payout_status,
  add column if not exists blocked_reason text,
  add column if not exists source_payment_id uuid references public.order_payments(id) on delete set null,
  add column if not exists provider_response jsonb,
  add column if not exists initiated_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz;

update public.payouts
set status = coalesce(status, 'PAID'::payout_status),
    provider_response = coalesce(provider_response, '{}'::jsonb),
    initiated_at = coalesce(initiated_at, processed_at, now()),
    completed_at = case when status = 'PAID'::payout_status then coalesce(completed_at, processed_at) else completed_at end;

alter table public.payouts
  alter column status set default 'PAID',
  alter column status set not null,
  alter column provider_response set default '{}'::jsonb,
  alter column provider_response set not null,
  alter column initiated_at set default now(),
  alter column initiated_at set not null;

create index if not exists payouts_order_status_idx
  on public.payouts (order_id, status, processed_at desc);

create index if not exists payouts_status_idx
  on public.payouts(status);

create index if not exists payouts_tailor_profile_id_idx
  on public.payouts(tailor_profile_id);

create index if not exists payouts_order_id_idx
  on public.payouts(order_id);
