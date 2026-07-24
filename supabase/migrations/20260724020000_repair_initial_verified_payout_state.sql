-- The old payout-currency sync trigger could re-enable reverification after an
-- otherwise successful first provider-verified setup. Repair only first-setup
-- rows whose verification and destination timestamps identify the same write,
-- and never bypass an open payout destination review.

update public.tailor_profiles as profile
set payout_reverification_required = false
where profile.payout_account_verified is true
  and profile.payout_reverification_required is true
  and coalesce(profile.payout_account_change_count, 0) = 0
  and profile.payout_account_verified_at is not null
  and profile.payout_account_last_changed_at is not null
  and abs(
    extract(
      epoch from (
        profile.payout_account_verified_at
        - profile.payout_account_last_changed_at
      )
    )
  ) <= 5
  and (
    (
      profile.payout_account_type = 'PAYSTACK'
      and coalesce(
        nullif(btrim(profile.paystack_recipient_code), ''),
        nullif(btrim(profile.paystack_account_id), '')
      ) is not null
    )
    or (
      profile.payout_account_type = 'STRIPE_CONNECT'
      and coalesce(
        nullif(btrim(profile.stripe_connect_account_id), ''),
        nullif(btrim(profile.stripe_account_id), '')
      ) is not null
    )
  )
  and not exists (
    select 1
    from public.payout_change_requests as request
    where request.tailor_profile_id = profile.id
      and request.status = 'PENDING'
  );
