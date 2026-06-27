-- Canonicalize account phone numbers and prevent one phone number from being
-- attached to multiple Drapeon accounts going forward.

create or replace function public.normalize_account_phone_e164(raw_phone text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
  trimmed text;
begin
  trimmed := nullif(btrim(coalesce(raw_phone, '')), '');
  if trimmed is null then
    return null;
  end if;

  digits := regexp_replace(trimmed, '\D', '', 'g');
  if digits = '' then
    return null;
  end if;

  if left(trimmed, 1) = '+' then
    return '+' || digits;
  end if;

  if left(trimmed, 2) = '00' and length(digits) > 2 then
    return '+' || substring(digits from 3);
  end if;

  if digits ~ '^0[789][0-9]{9}$' then
    return '+234' || substring(digits from 2);
  end if;

  if digits ~ '^[789][0-9]{9}$' then
    return '+234' || digits;
  end if;

  if digits ~ '^234[789][0-9]{9}$' then
    return '+' || digits;
  end if;

  if left(trimmed, 1) <> '0' and length(digits) > 10 then
    return '+' || digits;
  end if;

  return digits;
end;
$$;

create index if not exists users_phone_e164_lookup_idx
  on public.users (public.normalize_account_phone_e164(phone))
  where phone is not null;

create index if not exists customer_profiles_phone_e164_lookup_idx
  on public.customer_profiles (public.normalize_account_phone_e164(phone))
  where phone is not null;

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
    where existing.id <> new.id
      and public.normalize_account_phone_e164(existing.phone) = canonical_phone
    union all
    select 1
    from public.customer_profiles existing_profile
    where existing_profile.user_id <> new.id
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

drop trigger if exists prepare_account_phone_on_users on public.users;
create trigger prepare_account_phone_on_users
  before insert or update of phone on public.users
  for each row execute function public.prepare_account_phone();

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
    where existing.id <> new.user_id
      and public.normalize_account_phone_e164(existing.phone) = canonical_phone
    union all
    select 1
    from public.customer_profiles existing_profile
    where existing_profile.user_id <> new.user_id
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

drop trigger if exists prepare_customer_profile_phone_on_profiles on public.customer_profiles;
create trigger prepare_customer_profile_phone_on_profiles
  before insert or update of phone on public.customer_profiles
  for each row execute function public.prepare_customer_profile_phone();
