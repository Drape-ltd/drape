-- Drape V1 — Tax jurisdiction + payout account hardening
-- Purpose:
-- 1. Add explicit locked tax metadata to orders.
-- 2. Preserve destination postal/country detail for server-side tax lookups.
-- 3. Add a 24h tax-rate cache for ZipTax lookups.
-- 4. Add verified payout-account fields needed for launch payout setup.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'payout_account_type'
  ) then
    create type payout_account_type as enum ('PAYSTACK', 'STRIPE_CONNECT');
  end if;
end;
$$;

alter table public.orders
  add column if not exists delivery_city text,
  add column if not exists delivery_region text,
  add column if not exists delivery_postal_code text,
  add column if not exists delivery_country_code text,
  add column if not exists tax_region text,
  add column if not exists tax_fallback boolean,
  add column if not exists tax_fallback_reason text;

alter table public.orders disable trigger orders_terminal_guard;

update public.orders
set tax_region = coalesce(
      nullif(trim(tax_region), ''),
      case
        when currency = 'NGN' then 'Nigeria VAT'
        when currency = 'GHS' then 'Ghana VAT'
        when currency = 'KES' then 'Kenya VAT'
        when currency = 'GBP' then 'United Kingdom VAT'
        when currency = 'EUR' then 'EU VAT (flat launch default)'
        when currency = 'CAD' then 'Ontario HST'
        when currency = 'USD' then 'United States'
        else 'Tax'
      end
    ),
    tax_fallback = coalesce(tax_fallback, false),
    tax_fallback_reason = case
      when tax_fallback = true then coalesce(nullif(trim(tax_fallback_reason), ''), 'UNKNOWN')
      else null
    end;

alter table public.orders enable trigger orders_terminal_guard;

alter table public.orders
  alter column tax_region set default 'Tax',
  alter column tax_region set not null,
  alter column tax_fallback set default false,
  alter column tax_fallback set not null;

create index if not exists orders_tax_region_idx
  on public.orders (tax_region);

create index if not exists orders_delivery_country_code_idx
  on public.orders (delivery_country_code);

create table if not exists public.tax_rate_cache (
  country_code text not null,
  postal_code text not null,
  rate_bps integer not null check (rate_bps >= 0),
  tax_region text not null,
  source text not null default 'ZIPTAX',
  shipping_taxable boolean not null default false,
  platform_fee_taxable boolean not null default false,
  raw_response jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (country_code, postal_code)
);

create index if not exists tax_rate_cache_expires_at_idx
  on public.tax_rate_cache (expires_at);

drop trigger if exists tax_rate_cache_updated_at on public.tax_rate_cache;
create trigger tax_rate_cache_updated_at
  before update on public.tax_rate_cache
  for each row execute function handle_updated_at();

alter table public.tailor_profiles
  add column if not exists payout_account_type payout_account_type,
  add column if not exists payout_account_verified boolean,
  add column if not exists paystack_recipient_code text,
  add column if not exists stripe_connect_account_id text,
  add column if not exists payout_account_verified_at timestamptz;

update public.tailor_profiles
set paystack_recipient_code = coalesce(paystack_recipient_code, nullif(trim(paystack_account_id), '')),
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
  alter column payout_account_verified set default false,
  alter column payout_account_verified set not null;

grant select (
  payout_account_type,
  payout_account_verified,
  paystack_recipient_code,
  stripe_connect_account_id,
  payout_account_verified_at
) on table public.tailor_profiles to authenticated;

grant update (
  payout_account_type,
  payout_account_verified,
  paystack_recipient_code,
  stripe_connect_account_id,
  payout_account_verified_at,
  payout_reverification_required
) on table public.tailor_profiles to authenticated;

create index if not exists tailor_profiles_payout_account_verified_idx
  on public.tailor_profiles (payout_account_verified);

create index if not exists tailor_profiles_payout_account_type_idx
  on public.tailor_profiles (payout_account_type);
