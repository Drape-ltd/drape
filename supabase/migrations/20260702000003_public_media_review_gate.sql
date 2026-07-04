-- Public media should not inherit a previous approval when the same storage
-- path is refreshed. Re-queueing a media asset moves it back to pending review
-- so public read surfaces can hide it until ops or automation approves it.

create or replace function public.upsert_media_asset(
  p_bucket_id text,
  p_object_path text,
  p_owner_user_id uuid default null,
  p_order_id uuid default null,
  p_tailor_profile_id uuid default null,
  p_purpose text default 'UNKNOWN',
  p_mime_type text default null,
  p_byte_size integer default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_ms integer default null,
  p_checksum_sha256 text default null,
  p_public_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_public_url text;
begin
  if nullif(btrim(coalesce(p_bucket_id, '')), '') is null then
    raise exception 'bucket_id is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_object_path, '')), '') is null then
    raise exception 'object_path is required' using errcode = '22023';
  end if;

  v_public_url := nullif(
    split_part(split_part(btrim(coalesce(p_public_url, '')), '?', 1), '#', 1),
    ''
  );

  insert into public.media_assets (
    bucket_id,
    object_path,
    owner_user_id,
    order_id,
    tailor_profile_id,
    purpose,
    mime_type,
    byte_size,
    width,
    height,
    duration_ms,
    checksum_sha256,
    public_url,
    metadata,
    status,
    moderation_status,
    moderation_risk_level,
    moderation_reasons,
    reviewed_at,
    reviewed_by
  )
  values (
    btrim(p_bucket_id),
    btrim(p_object_path),
    p_owner_user_id,
    p_order_id,
    p_tailor_profile_id,
    upper(btrim(coalesce(p_purpose, 'UNKNOWN'))),
    nullif(btrim(coalesce(p_mime_type, '')), ''),
    p_byte_size,
    p_width,
    p_height,
    p_duration_ms,
    nullif(btrim(coalesce(p_checksum_sha256, '')), ''),
    v_public_url,
    coalesce(p_metadata, '{}'::jsonb),
    'ACTIVE',
    'PENDING_REVIEW',
    'UNKNOWN',
    '{}'::text[],
    null,
    null
  )
  on conflict (bucket_id, object_path) do update
  set
    owner_user_id = coalesce(excluded.owner_user_id, public.media_assets.owner_user_id),
    order_id = coalesce(excluded.order_id, public.media_assets.order_id),
    tailor_profile_id = coalesce(excluded.tailor_profile_id, public.media_assets.tailor_profile_id),
    purpose = excluded.purpose,
    mime_type = coalesce(excluded.mime_type, public.media_assets.mime_type),
    byte_size = coalesce(excluded.byte_size, public.media_assets.byte_size),
    width = coalesce(excluded.width, public.media_assets.width),
    height = coalesce(excluded.height, public.media_assets.height),
    duration_ms = coalesce(excluded.duration_ms, public.media_assets.duration_ms),
    checksum_sha256 = coalesce(excluded.checksum_sha256, public.media_assets.checksum_sha256),
    public_url = coalesce(excluded.public_url, public.media_assets.public_url),
    metadata = public.media_assets.metadata || excluded.metadata,
    status = 'ACTIVE',
    moderation_status = 'PENDING_REVIEW',
    moderation_risk_level = 'UNKNOWN',
    moderation_reasons = '{}'::text[],
    reviewed_at = null,
    reviewed_by = null,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_media_asset(text, text, uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_media_asset(text, text, uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, text, jsonb) to service_role;
