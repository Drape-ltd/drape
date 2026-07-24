-- Changing payout currency normally invalidates an existing destination. A
-- provider-verified first setup is different: the currency and destination are
-- established atomically, so the sync trigger must not undo that verification.

create or replace function public.sync_tailor_payout_currency_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  trusted boolean :=
    coalesce(current_setting('drape.identity_verification_trusted_write', true), '') = 'true';
  old_has_verified_destination boolean := false;
  new_has_verified_destination boolean :=
    coalesce(new.payout_account_verified, false)
    and (
      (
        new.payout_account_type = 'PAYSTACK'
        and coalesce(
          nullif(btrim(new.paystack_recipient_code), ''),
          nullif(btrim(new.paystack_account_id), '')
        ) is not null
      )
      or (
        new.payout_account_type = 'STRIPE_CONNECT'
        and coalesce(
          nullif(btrim(new.stripe_connect_account_id), ''),
          nullif(btrim(new.stripe_account_id), '')
        ) is not null
      )
    );
begin
  if tg_op = 'UPDATE' then
    old_has_verified_destination :=
      coalesce(old.payout_account_verified, false)
      and not coalesce(old.payout_reverification_required, false)
      and (
        (
          old.payout_account_type = 'PAYSTACK'
          and coalesce(
            nullif(btrim(old.paystack_recipient_code), ''),
            nullif(btrim(old.paystack_account_id), '')
          ) is not null
        )
        or (
          old.payout_account_type = 'STRIPE_CONNECT'
          and coalesce(
            nullif(btrim(old.stripe_connect_account_id), ''),
            nullif(btrim(old.stripe_account_id), '')
          ) is not null
        )
        or old.manual_bank_entry is true
      );
  end if;

  if new.payout_currency is null then
    new.payout_currency := coalesce(new.currency, 'USD'::currency);
  end if;

  new.payout_provider := public.resolve_payment_provider_for_currency(new.payout_currency);

  if tg_op = 'INSERT' then
    new.payout_reverification_required := coalesce(new.payout_reverification_required, false);
  elsif new.payout_currency is distinct from old.payout_currency then
    if trusted or (not old_has_verified_destination and new_has_verified_destination) then
      new.payout_reverification_required :=
        coalesce(new.payout_reverification_required, false);
    else
      new.payout_reverification_required := true;
    end if;
  end if;

  return new;
end;
$$;
