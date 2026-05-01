select
  count(*) filter (where tax_region is null) as orders_missing_tax_region,
  count(*) filter (where tax_fallback is null) as orders_missing_tax_fallback,
  count(*) filter (where currency in ('USD', 'CAD') and delivery_country_code is null and delivery_method <> 'LOCAL_COLLECTION') as destination_orders_missing_country
from public.orders;

select
  count(*) filter (where payout_account_verified is null) as tailors_missing_payout_verified,
  count(*) filter (where payout_account_type is null and (stripe_connect_account_id is not null or paystack_recipient_code is not null)) as payout_accounts_missing_type
from public.tailor_profiles;

select
  count(*)::bigint as cached_rows,
  min(expires_at) as earliest_expiry,
  max(expires_at) as latest_expiry
from public.tax_rate_cache;
