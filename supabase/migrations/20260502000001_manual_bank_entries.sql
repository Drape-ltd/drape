alter table public.tailor_profiles
  add column if not exists manual_bank_entry boolean not null default false,
  add column if not exists manual_bank_name text,
  add column if not exists manual_bank_country_code text,
  add column if not exists manual_bank_country_name text,
  add column if not exists manual_bank_swift_bic text,
  add column if not exists manual_bank_account_number text,
  add column if not exists manual_bank_account_name text,
  add column if not exists manual_bank_verification_status text not null default 'NOT_SUBMITTED',
  add column if not exists manual_bank_submitted_at timestamptz,
  add column if not exists manual_bank_verified_at timestamptz,
  add column if not exists manual_bank_verified_by text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tailor_profiles_manual_bank_verification_status_chk'
  ) then
    alter table public.tailor_profiles
      add constraint tailor_profiles_manual_bank_verification_status_chk
      check (
        manual_bank_verification_status in (
          'NOT_SUBMITTED',
          'PENDING',
          'IN_REVIEW',
          'VERIFIED',
          'REJECTED'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tailor_profiles_manual_bank_swift_bic_chk'
  ) then
    alter table public.tailor_profiles
      add constraint tailor_profiles_manual_bank_swift_bic_chk
      check (
        manual_bank_swift_bic is null
        or manual_bank_swift_bic ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tailor_profiles_manual_bank_required_fields_chk'
  ) then
    alter table public.tailor_profiles
      add constraint tailor_profiles_manual_bank_required_fields_chk
      check (
        manual_bank_entry = false
        or (
          nullif(trim(manual_bank_name), '') is not null
          and nullif(trim(manual_bank_country_code), '') is not null
          and length(trim(manual_bank_country_code)) = 2
          and nullif(trim(manual_bank_country_name), '') is not null
          and nullif(trim(manual_bank_swift_bic), '') is not null
          and nullif(trim(manual_bank_account_number), '') is not null
          and nullif(trim(manual_bank_account_name), '') is not null
          and manual_bank_verification_status in ('PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED')
          and manual_bank_submitted_at is not null
        )
      );
  end if;
end $$;

revoke select (
  manual_bank_entry,
  manual_bank_name,
  manual_bank_country_code,
  manual_bank_country_name,
  manual_bank_swift_bic,
  manual_bank_account_number,
  manual_bank_account_name,
  manual_bank_verification_status,
  manual_bank_submitted_at,
  manual_bank_verified_at,
  manual_bank_verified_by
) on table public.tailor_profiles from anon, authenticated;

revoke update (
  manual_bank_entry,
  manual_bank_name,
  manual_bank_country_code,
  manual_bank_country_name,
  manual_bank_swift_bic,
  manual_bank_account_number,
  manual_bank_account_name,
  manual_bank_verification_status,
  manual_bank_submitted_at,
  manual_bank_verified_at,
  manual_bank_verified_by
) on table public.tailor_profiles from authenticated;

create index if not exists tailor_profiles_manual_bank_status_idx
  on public.tailor_profiles (manual_bank_entry, manual_bank_verification_status, manual_bank_submitted_at desc)
  where manual_bank_entry = true;
