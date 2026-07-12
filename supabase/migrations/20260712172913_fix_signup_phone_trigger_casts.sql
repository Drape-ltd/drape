-- Fix signup-trigger failures caused by mixed uuid/text account key columns.
--
-- public.users.id and public.customer_profiles.user_id have not always used the
-- same physical type across environments. Cast comparisons to text so the phone
-- uniqueness guard works during auth.users -> public.users bootstrapping.

create or replace function public.prepare_account_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  canonical_phone text;
begin
  canonical_phone := public.normalize_account_phone_e164(new.phone);

  if canonical_phone is null then
    new.phone := null;
    return new;
  end if;

  if exists (
    select 1
    from public.users existing
    where existing.id::text <> new.id::text
      and public.normalize_account_phone_e164(existing.phone) = canonical_phone
    union all
    select 1
    from public.customer_profiles existing_profile
    where existing_profile.user_id::text <> new.id::text
      and public.normalize_account_phone_e164(existing_profile.phone) = canonical_phone
  ) then
    raise exception 'PHONE_ALREADY_IN_USE'
      using errcode = '23505',
            detail = 'A Drapeon account already uses this phone number.';
  end if;

  new.phone := canonical_phone;
  return new;
end;
$$;

create or replace function public.prepare_customer_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  canonical_phone text;
begin
  canonical_phone := public.normalize_account_phone_e164(new.phone);

  if canonical_phone is null then
    new.phone := null;
    return new;
  end if;

  if exists (
    select 1
    from public.users existing
    where existing.id::text <> new.user_id::text
      and public.normalize_account_phone_e164(existing.phone) = canonical_phone
    union all
    select 1
    from public.customer_profiles existing_profile
    where existing_profile.user_id::text <> new.user_id::text
      and public.normalize_account_phone_e164(existing_profile.phone) = canonical_phone
  ) then
    raise exception 'PHONE_ALREADY_IN_USE'
      using errcode = '23505',
            detail = 'A Drapeon account already uses this phone number.';
  end if;

  new.phone := canonical_phone;
  return new;
end;
$$;
