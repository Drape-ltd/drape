do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'payout_status'
      and e.enumlabel = 'BLOCKED'
  ) then
    alter type payout_status add value 'BLOCKED';
  end if;
end $$;

alter table if exists public.tailor_profiles
  add column if not exists payout_bank_name text,
  add column if not exists payout_bank_code text,
  add column if not exists payout_account_name text,
  add column if not exists payout_account_masked text,
  add column if not exists payout_country_code text;

update public.tailor_profiles
set payout_provider = case
      when payout_currency in ('NGN'::currency, 'GHS'::currency, 'KES'::currency) then 'PAYSTACK'::payment_provider
      when payout_currency in ('USD'::currency, 'GBP'::currency, 'EUR'::currency, 'CAD'::currency) then 'STRIPE'::payment_provider
      else payout_provider
    end
where payout_provider is null;

update public.tailor_profiles
set payout_account_type = case
      when coalesce(nullif(trim(paystack_recipient_code), ''), nullif(trim(paystack_account_id), '')) is not null
        then 'PAYSTACK'::payout_account_type
      when coalesce(nullif(trim(stripe_connect_account_id), ''), nullif(trim(stripe_account_id), '')) is not null
        then 'STRIPE_CONNECT'::payout_account_type
      else payout_account_type
    end,
    payout_account_verified = case
      when payout_account_verified = true then true
      when coalesce(nullif(trim(paystack_recipient_code), ''), nullif(trim(paystack_account_id), '')) is not null then true
      when coalesce(nullif(trim(stripe_connect_account_id), ''), nullif(trim(stripe_account_id), '')) is not null then true
      else false
    end,
    payout_reverification_required = case
      when payout_account_verified = true then false
      when coalesce(nullif(trim(paystack_recipient_code), ''), nullif(trim(paystack_account_id), '')) is not null then false
      when coalesce(nullif(trim(stripe_connect_account_id), ''), nullif(trim(stripe_account_id), '')) is not null then false
      else payout_reverification_required
    end,
    payout_account_verified_at = case
      when payout_account_verified_at is not null then payout_account_verified_at
      when coalesce(nullif(trim(paystack_recipient_code), ''), nullif(trim(paystack_account_id), '')) is not null then updated_at
      when coalesce(nullif(trim(stripe_connect_account_id), ''), nullif(trim(stripe_account_id), '')) is not null then updated_at
      else payout_account_verified_at
    end
where
  payout_account_verified = false
  or payout_account_type is null
  or payout_provider is null
  or payout_account_verified_at is null;

alter table if exists public.payouts
  add column if not exists blocked_reason text,
  add column if not exists initiated_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz;

update public.payouts
set initiated_at = coalesce(initiated_at, processed_at, now());

update public.payouts
set completed_at = coalesce(completed_at, processed_at)
where status = 'PAID'::payout_status;

update public.payouts
set failed_at = coalesce(failed_at, processed_at)
where status::text in ('FAILED', 'REVERSED', 'CANCELED', 'BLOCKED');

alter table if exists public.payouts
  alter column initiated_at set default now();

update public.payouts
set initiated_at = now()
where initiated_at is null;

alter table if exists public.payouts
  alter column initiated_at set not null;

create index if not exists payouts_status_idx on public.payouts(status);
create index if not exists payouts_tailor_profile_id_idx on public.payouts(tailor_profile_id);
create index if not exists payouts_order_id_idx on public.payouts(order_id);
