drop trigger if exists tax_rate_cache_updated_at on public.tax_rate_cache;
drop table if exists public.tax_rate_cache;

drop index if exists orders_tax_region_idx;
drop index if exists orders_delivery_country_code_idx;

alter table if exists public.orders
  drop column if exists delivery_city,
  drop column if exists delivery_region,
  drop column if exists delivery_postal_code,
  drop column if exists delivery_country_code,
  drop column if exists tax_region,
  drop column if exists tax_fallback,
  drop column if exists tax_fallback_reason;

drop index if exists tailor_profiles_payout_account_verified_idx;
drop index if exists tailor_profiles_payout_account_type_idx;

alter table if exists public.tailor_profiles
  drop column if exists payout_account_type,
  drop column if exists payout_account_verified,
  drop column if exists paystack_recipient_code,
  drop column if exists stripe_connect_account_id,
  drop column if exists payout_account_verified_at;

drop type if exists payout_account_type;
