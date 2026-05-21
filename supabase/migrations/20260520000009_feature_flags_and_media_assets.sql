-- Launch control primitives: feature flags and media asset inventory.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  audience text not null default 'ALL',
  rollout_percent integer not null default 0 check (rollout_percent >= 0 and rollout_percent <= 100),
  metadata jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_feature_flags_updated_at on public.feature_flags;
create trigger trg_feature_flags_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
grant select, insert, update, delete on public.feature_flags to service_role;

insert into public.feature_flags (key, enabled, description, audience, rollout_percent)
values
  ('android_drape_vision', false, 'Android Drape Vision scanner. Launch uses manual fallback while iOS remains supported.', 'ALL', 0),
  ('consultation_booking', true, 'Paid consultation booking and reminders.', 'ALL', 100),
  ('sms_critical_updates', false, 'SMS for critical order/payment events when provider secrets are configured.', 'ALL', 0),
  ('web_checkout', false, 'Web account/checkout parity surface.', 'ALL', 0),
  ('ops_control_plane', true, 'Internal ops control plane.', 'OPS', 100)
on conflict (key) do update
set
  description = excluded.description,
  audience = excluded.audience,
  rollout_percent = greatest(public.feature_flags.rollout_percent, excluded.rollout_percent),
  updated_at = now();

create or replace function public.get_feature_flags(p_audience text default 'ALL')
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(
      key,
      jsonb_build_object(
        'enabled', enabled,
        'audience', audience,
        'rolloutPercent', rollout_percent,
        'metadata', metadata,
        'updatedAt', updated_at
      )
      order by key
    ),
    '{}'::jsonb
  )
  from public.feature_flags
  where audience in ('ALL', upper(coalesce(p_audience, 'ALL')));
$$;

revoke all on function public.get_feature_flags(text) from public, anon, authenticated;
grant execute on function public.get_feature_flags(text) to anon, authenticated, service_role;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  object_path text not null,
  owner_user_id uuid,
  order_id uuid,
  tailor_profile_id uuid,
  purpose text not null default 'UNKNOWN',
  mime_type text,
  byte_size integer check (byte_size is null or byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  checksum_sha256 text,
  public_url text,
  status text not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

drop trigger if exists trg_media_assets_updated_at on public.media_assets;
create trigger trg_media_assets_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

create index if not exists media_assets_owner_created_at_idx on public.media_assets (owner_user_id, created_at desc);
create index if not exists media_assets_order_created_at_idx on public.media_assets (order_id, created_at desc);
create index if not exists media_assets_tailor_created_at_idx on public.media_assets (tailor_profile_id, created_at desc);
create index if not exists media_assets_bucket_path_idx on public.media_assets (bucket_id, object_path);

alter table public.media_assets enable row level security;
revoke all on public.media_assets from anon, authenticated;
grant select, insert, update, delete on public.media_assets to service_role;

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
begin
  if nullif(btrim(coalesce(p_bucket_id, '')), '') is null then
    raise exception 'bucket_id is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_object_path, '')), '') is null then
    raise exception 'object_path is required' using errcode = '22023';
  end if;

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
    metadata
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
    nullif(btrim(coalesce(p_public_url, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
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
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_media_asset(text, text, uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_media_asset(text, text, uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, text, jsonb) to service_role;
