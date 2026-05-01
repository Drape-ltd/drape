-- Rollback for 20260429000008_signup_trigger_hardening.sql
-- Restores the simpler handle_new_user() implementation used before hardening.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
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
    coalesce(new.email, format('%s@drape.invalid', new.id::text)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.id::text), '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'CUSTOMER'::user_role),
    nullif(new.raw_user_meta_data->>'phone', ''),
    'USD'::currency,
    now(),
    'UNSUPPORTED_FALLBACK',
    'ZZ'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
