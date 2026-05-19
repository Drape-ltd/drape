-- Drape V1 — payout account change guards
-- Purpose:
-- 1. Track payout destination changes on tailor profiles.
-- 2. Enforce a reasonable cooldown between destination changes in Edge Functions.
-- 3. Hold payout releases briefly after a destination change so ops can catch mistakes or abuse.

alter table public.tailor_profiles
  add column if not exists payout_account_change_count integer not null default 0,
  add column if not exists payout_account_last_changed_at timestamptz,
  add column if not exists payout_account_change_locked_until timestamptz,
  add column if not exists payout_destination_hold_until timestamptz;

alter table public.tailor_profiles
  drop constraint if exists tailor_profiles_payout_account_change_count_check;

alter table public.tailor_profiles
  add constraint tailor_profiles_payout_account_change_count_check
  check (payout_account_change_count >= 0);

create index if not exists tailor_profiles_payout_change_locked_until_idx
  on public.tailor_profiles (payout_account_change_locked_until)
  where payout_account_change_locked_until is not null;

create index if not exists tailor_profiles_payout_destination_hold_until_idx
  on public.tailor_profiles (payout_destination_hold_until)
  where payout_destination_hold_until is not null;

grant select (
  payout_account_change_count,
  payout_account_last_changed_at,
  payout_account_change_locked_until,
  payout_destination_hold_until
) on table public.tailor_profiles to authenticated;
