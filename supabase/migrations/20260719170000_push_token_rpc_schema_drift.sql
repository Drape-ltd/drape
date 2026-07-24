-- Historical environments disagree on whether push_tokens.user_id is uuid or
-- text. Normalize ownership comparisons without weakening auth.uid() checks.

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

  insert into public.push_tokens (user_id, token, platform, device_id)
  values (v_user_id, btrim(p_token), p_platform, btrim(p_device_id))
  on conflict (user_id, device_id)
  do update set
    token = excluded.token,
    platform = excluded.platform,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.unregister_push_token(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  delete from public.push_tokens
  where user_id::text = auth.uid()::text
    and device_id = btrim(p_device_id);
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public;
revoke all on function public.unregister_push_token(text) from public;
grant execute on function public.register_push_token(text, text, text) to authenticated, service_role;
grant execute on function public.unregister_push_token(text) to authenticated, service_role;
