-- Prevent public/live tailor profile RLS policies from exposing private payout
-- and identity-document columns through direct PostgREST selects.
--
-- RLS constrains rows, not columns. Public discovery still needs to read live
-- tailor profile rows, so sensitive column access is denied at the column
-- privilege layer and kept behind service-role Edge Functions.

do $$
declare
  sensitive_column text;
begin
  foreach sensitive_column in array array[
    'stripe_account_id',
    'paystack_account_id',
    'id_document_url',
    'payout_bank_name',
    'payout_bank_code',
    'payout_account_name',
    'payout_account_masked',
    'paystack_recipient_code',
    'stripe_connect_account_id',
    'manual_bank_name',
    'manual_bank_country_code',
    'manual_bank_country_name',
    'manual_bank_swift_bic',
    'manual_bank_account_number',
    'manual_bank_account_name',
    'manual_bank_verified_by',
    'paystack_account_id'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tailor_profiles'
        and column_name = sensitive_column
    ) then
      execute format(
        'revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table public.tailor_profiles from anon, authenticated',
        sensitive_column
      );
    end if;
  end loop;
end $$;
