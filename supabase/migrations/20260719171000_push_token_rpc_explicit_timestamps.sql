-- Some older push_tokens tables were created before timestamp defaults were
-- standardized. Registration owns these timestamps explicitly so those
-- installations can still register without weakening the table constraint.

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
  v_row public.push_tokens;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'Unsupported push platform.' using errcode = '22023';
  end if;

  if p_token is null or btrim(p_token) = '' or p_device_id is null or btrim(p_device_id) = '' then
    raise exception 'Push token and device identifier are required.' using errcode = '22023';
  end if;

  delete from public.push_tokens
  where token = btrim(p_token)
    and user_id::text <> v_user_id::text;

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
    btrim(p_token),
    p_platform,
    btrim(p_device_id),
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
