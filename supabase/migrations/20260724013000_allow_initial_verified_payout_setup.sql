-- Identity approval locks payout destination replacements, not a tailor's first
-- provider-verified payout setup. The Edge action owns the same distinction and
-- stages later destination changes for Ops review.

create or replace function public.prevent_locked_identity_field_edits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  trusted boolean := coalesce(current_setting('drape.identity_verification_trusted_write', true), '') = 'true';
  status text := coalesce(old.id_verification_status, '');
  has_verified_payout_destination boolean :=
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
begin
  if trusted then
    return new;
  end if;

  if status in ('PENDING', 'VERIFIED', 'APPROVED') and (
    new.avatar_url is distinct from old.avatar_url
    or new.id_document_url is distinct from old.id_document_url
    or new.id_selfie_document_url is distinct from old.id_selfie_document_url
    or new.id_verification_status is distinct from old.id_verification_status
    or new.id_verified_at is distinct from old.id_verified_at
    or new.id_verification_method is distinct from old.id_verification_method
    or new.id_verification_handoff_id is distinct from old.id_verification_handoff_id
    or new.id_verification_rejection_reason is distinct from old.id_verification_rejection_reason
    or new.id_verification_rejected_at is distinct from old.id_verification_rejected_at
    or new.id_verification_metadata is distinct from old.id_verification_metadata
  ) then
    raise exception 'Identity verification fields are locked while verification is pending or approved.'
      using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED') and (
    new.display_name is distinct from old.display_name
    or new.bio is distinct from old.bio
    or new.location is distinct from old.location
    or new.languages is distinct from old.languages
    or new.specialty_tags is distinct from old.specialty_tags
    or new.currency is distinct from old.currency
  ) then
    raise exception 'Approved public profile fields must go through profile change review.'
      using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED')
    and has_verified_payout_destination
    and (
      new.payout_currency is distinct from old.payout_currency
      or new.payout_provider is distinct from old.payout_provider
      or new.payout_account_type is distinct from old.payout_account_type
      or new.payout_account_verified is distinct from old.payout_account_verified
      or new.payout_account_verified_at is distinct from old.payout_account_verified_at
      or new.payout_reverification_required is distinct from old.payout_reverification_required
      or new.payout_bank_name is distinct from old.payout_bank_name
      or new.payout_bank_code is distinct from old.payout_bank_code
      or new.payout_account_name is distinct from old.payout_account_name
      or new.payout_account_masked is distinct from old.payout_account_masked
      or new.payout_country_code is distinct from old.payout_country_code
      or new.paystack_recipient_code is distinct from old.paystack_recipient_code
      or new.paystack_account_id is distinct from old.paystack_account_id
      or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id
      or new.stripe_account_id is distinct from old.stripe_account_id
      or new.manual_bank_entry is distinct from old.manual_bank_entry
      or new.manual_bank_name is distinct from old.manual_bank_name
      or new.manual_bank_country_code is distinct from old.manual_bank_country_code
      or new.manual_bank_country_name is distinct from old.manual_bank_country_name
      or new.manual_bank_swift_bic is distinct from old.manual_bank_swift_bic
      or new.manual_bank_account_number is distinct from old.manual_bank_account_number
      or new.manual_bank_account_name is distinct from old.manual_bank_account_name
      or new.manual_bank_verification_status is distinct from old.manual_bank_verification_status
    )
  then
    raise exception 'Approved payout destination fields must go through payout change review.'
      using errcode = '42501';
  end if;

  return new;
end
$$;
