-- Drape V1 - Sync public user email only after Supabase Auth confirms the change.
--
-- Supabase Auth updates auth.users.email after the configured confirmation flow
-- completes. public.users.email is a mirror for app queries, so it must follow
-- auth.users instead of being changed directly by the mobile client.

create or replace function public.sync_public_user_email_after_auth_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.users
    set email = coalesce(nullif(trim(new.email), ''), email),
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_public_user_email_after_auth_change();
