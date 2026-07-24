-- Rebind a provider token from a migrated legacy installation row to the
-- current installation identifier. A provider token identifies one install,
-- even when both rows belong to the same user.

create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_device_id text
)
returns public.push_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_token text := btrim(p_token);
  v_device_id text := btrim(p_device_id);
  v_row public.push_tokens;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'Unsupported push platform.' using errcode = '22023';
  end if;

  if v_token = '' or v_device_id = '' then
    raise exception 'Push token and device identifier are required.' using errcode = '22023';
  end if;

  delete from public.push_tokens
  where token = v_token
    and (
      user_id::text <> v_user_id::text
      or device_id <> v_device_id
    );

  insert into public.push_tokens (
    user_id,
    token,
    platform,
    device_id,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    v_token,
    p_platform,
    v_device_id,
    now(),
    now()
  )
  on conflict (user_id, device_id)
  do update set
    token = excluded.token,
    platform = excluded.platform,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public;
grant execute on function public.register_push_token(text, text, text) to authenticated, service_role;
