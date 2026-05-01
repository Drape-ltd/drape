-- Verification checklist for 20260429000001_payment_currency_foundation.sql
-- Run before and after the migration on staging, then compare outputs.

-- Existing row counts that must remain stable after backfill.
select 'users' as table_name, count(*)::bigint as row_count from public.users
union all
select 'tailor_profiles', count(*)::bigint from public.tailor_profiles
union all
select 'orders', count(*)::bigint from public.orders
union all
select 'payouts', count(*)::bigint from public.payouts;

-- Currency/null audit after migration.
select
  count(*) filter (where default_currency is null) as users_missing_default_currency,
  count(*) filter (where currency_confirmed_at is null) as users_missing_currency_confirmed_at,
  count(*) filter (where currency_source is null or trim(currency_source) = '') as users_missing_currency_source,
  count(*) filter (where region_code is null or trim(region_code) = '') as users_missing_region_code
from public.users;

select
  count(*) filter (where payout_currency is null) as tailors_missing_payout_currency,
  count(*) filter (where payout_provider is null) as tailors_missing_payout_provider,
  count(*) filter (where payout_reverification_required is null) as tailors_missing_payout_reverification
from public.tailor_profiles;

select
  count(*) filter (where currency is null) as orders_missing_currency,
  count(*) filter (where subtotal_amount is null) as orders_missing_subtotal_amount,
  count(*) filter (where platform_fee_amount is null) as orders_missing_platform_fee_amount,
  count(*) filter (where tax_amount is null) as orders_missing_tax_amount,
  count(*) filter (where tax_rate_bps is null) as orders_missing_tax_rate_bps,
  count(*) filter (where shipping_amount is null) as orders_missing_shipping_amount,
  count(*) filter (where total_amount is null) as orders_missing_total_amount
from public.orders;

-- Distribution sanity.
select default_currency, count(*)::bigint
from public.users
group by default_currency
order by default_currency;

select payout_currency, payout_provider, count(*)::bigint
from public.tailor_profiles
group by payout_currency, payout_provider
order by payout_currency, payout_provider;

select currency, payment_provider, count(*)::bigint
from public.orders
group by currency, payment_provider
order by currency, payment_provider;

-- New ledger tables should exist and be empty right after migration.
select
  (select count(*) from public.order_payments) as order_payments_count,
  (select count(*) from public.payment_webhook_events) as payment_webhook_events_count;

-- KES and CAD routing spot check.
select
  count(*) filter (where currency = 'KES' and payment_provider <> 'PAYSTACK') as kes_wrong_provider_orders,
  count(*) filter (where currency = 'CAD' and payment_provider <> 'STRIPE') as cad_wrong_provider_orders
from public.orders;
