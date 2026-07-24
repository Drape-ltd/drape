-- Return the signed-in tailor's small route-guard projection without granting
-- clients SELECT access to tailor_profiles.user_id.

create or replace function public.get_my_tailor_profile_guard()
returns table (
  id text,
  profile_completed boolean,
  display_name text,
  location text,
  id_verification_status text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    tp.id,
    tp.profile_completed,
    tp.display_name,
    tp.location,
    tp.id_verification_status,
    tp.avatar_url
  from public.tailor_profiles as tp
  where tp.user_id::text = (select auth.uid())::text
  limit 1;
$$;

revoke all on function public.get_my_tailor_profile_guard() from public;
revoke all on function public.get_my_tailor_profile_guard() from anon;
grant execute on function public.get_my_tailor_profile_guard() to authenticated;
