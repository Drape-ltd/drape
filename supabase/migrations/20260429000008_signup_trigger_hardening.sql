-- Drape V1 — Signup trigger hardening
-- Purpose:
-- 1. Prevent malformed auth user_metadata from breaking auth signup.
-- 2. Ensure public.handle_new_user() is safe for email/password and OAuth signups.
-- 3. Preserve durable public.users profile bootstrapping.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  next_email text;
  next_display_name text;
  next_role_text text;
  next_role user_role;
  next_phone text;
begin
  next_email := coalesce(
    nullif(trim(new.email), ''),
    format('%s@drape.invalid', new.id::text)
  );

  next_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(next_email, '@', 1)
  );

  next_role_text := upper(trim(coalesce(new.raw_user_meta_data->>'role', '')));
  next_role := case
    when next_role_text = 'TAILOR' then 'TAILOR'::user_role
    when next_role_text = 'CUSTOMER' then 'CUSTOMER'::user_role
    else 'CUSTOMER'::user_role
  end;

  next_phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');

  insert into public.users (
    id,
    email,
    display_name,
    role,
    phone,
    default_currency,
    currency_confirmed_at,
    currency_source,
    region_code
  )
  values (
    new.id,
    next_email,
    next_display_name,
    next_role,
    next_phone,
    'USD'::currency,
    now(),
    'UNSUPPORTED_FALLBACK',
    'ZZ'
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(nullif(excluded.display_name, ''), public.users.display_name),
      role = excluded.role,
      phone = coalesce(excluded.phone, public.users.phone),
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
