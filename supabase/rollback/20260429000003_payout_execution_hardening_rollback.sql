drop index if exists public.payouts_order_id_idx;
drop index if exists public.payouts_tailor_profile_id_idx;
drop index if exists public.payouts_status_idx;

alter table if exists public.payouts
  drop column if exists failed_at,
  drop column if exists completed_at,
  drop column if exists initiated_at,
  drop column if exists blocked_reason;

alter table if exists public.tailor_profiles
  drop column if exists payout_country_code,
  drop column if exists payout_account_masked,
  drop column if exists payout_account_name,
  drop column if exists payout_bank_code,
  drop column if exists payout_bank_name;

-- Enum values are intentionally left in place because Postgres enum rollback is destructive and unsafe on shared environments.
