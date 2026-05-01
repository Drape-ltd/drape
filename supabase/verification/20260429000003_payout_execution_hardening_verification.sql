select
  count(*) filter (where payout_provider is not null) as payout_provider_rows,
  count(*) filter (where payout_account_type is not null) as payout_account_type_rows,
  count(*) filter (where payout_account_verified = true) as payout_account_verified_rows
from public.tailor_profiles;

select
  count(*) filter (where initiated_at is not null) as initiated_rows,
  count(*) filter (where status = 'BLOCKED'::payout_status) as blocked_rows
from public.payouts;

select id, payout_currency, payout_provider, payout_account_type, payout_account_verified, payout_reverification_required
from public.tailor_profiles
order by updated_at desc
limit 20;

select id, status, amount, currency, provider, blocked_reason, initiated_at, completed_at, failed_at
from public.payouts
order by processed_at desc
limit 20;
