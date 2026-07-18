-- Service-only helper for preflighting account phone reuse before setup/profile save.
--
-- This mirrors the trigger checks in prepare_account_phone() and
-- prepare_customer_profile_phone(), including canonical E.164 normalization and
-- legacy formatted rows. The public client must call it through an Edge Function
-- so we do not expose account existence details through the Data API.

create or replace function public.is_account_phone_available(
  p_raw_phone text,
  p_actor_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  canonical_phone text;
begin
  canonical_phone := public.normalize_account_phone_e164(p_raw_phone);

  if canonical_phone is null then
    return true;
  end if;

  return not exists (
    select 1
    from public.users existing
    where existing.id::text <> coalesce(p_actor_id, '')
      and public.normalize_account_phone_e164(existing.phone) = canonical_phone
    union all
    select 1
    from public.customer_profiles existing_profile
    where existing_profile.user_id::text <> coalesce(p_actor_id, '')
      and public.normalize_account_phone_e164(existing_profile.phone) = canonical_phone
  );
end;
$$;

revoke all on function public.is_account_phone_available(text, text) from public, anon, authenticated;
grant execute on function public.is_account_phone_available(text, text) to service_role;
