-- Add non-destructive presentation metadata to the canonical media inventory.
-- Originals remain immutable; clients update only framing and ordering metadata.

alter table if exists public.media_assets
  add column if not exists media_kind text,
  add column if not exists poster_url text,
  add column if not exists poster_timestamp_ms integer,
  add column if not exists focal_x numeric(6,5) not null default 0.5,
  add column if not exists focal_y numeric(6,5) not null default 0.5,
  add column if not exists alt_text text,
  add column if not exists portfolio_position integer,
  add column if not exists is_primary boolean not null default false,
  add column if not exists processing_state text not null default 'READY',
  add column if not exists derivative_manifest jsonb not null default '{}'::jsonb,
  add column if not exists availability_state text not null default 'AVAILABLE',
  add column if not exists availability_reason text;

update public.media_assets
set media_kind = case
  when lower(coalesce(mime_type, '')) like 'video/%' then 'VIDEO'
  else 'IMAGE'
end
where media_kind is null;

alter table public.media_assets alter column media_kind set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_assets_media_kind_check') then
    alter table public.media_assets add constraint media_assets_media_kind_check
      check (media_kind in ('IMAGE', 'VIDEO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_poster_timestamp_check') then
    alter table public.media_assets add constraint media_assets_poster_timestamp_check
      check (poster_timestamp_ms is null or poster_timestamp_ms >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_focal_x_check') then
    alter table public.media_assets add constraint media_assets_focal_x_check
      check (focal_x between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_focal_y_check') then
    alter table public.media_assets add constraint media_assets_focal_y_check
      check (focal_y between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_alt_text_size_check') then
    alter table public.media_assets add constraint media_assets_alt_text_size_check
      check (alt_text is null or char_length(alt_text) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_portfolio_position_check') then
    alter table public.media_assets add constraint media_assets_portfolio_position_check
      check (portfolio_position is null or portfolio_position >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_processing_state_check') then
    alter table public.media_assets add constraint media_assets_processing_state_check
      check (processing_state in ('PENDING', 'PROCESSING', 'READY', 'FAILED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_availability_state_check') then
    alter table public.media_assets add constraint media_assets_availability_state_check
      check (availability_state in ('AVAILABLE', 'UNAVAILABLE', 'QUARANTINED', 'DELETED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_derivative_manifest_size_check') then
    alter table public.media_assets add constraint media_assets_derivative_manifest_size_check
      check (pg_column_size(derivative_manifest) <= 32768);
  end if;
end $$;

create unique index if not exists media_assets_one_primary_portfolio_idx
  on public.media_assets (tailor_profile_id)
  where purpose = 'PORTFOLIO' and is_primary = true and status = 'ACTIVE';

create unique index if not exists media_assets_portfolio_position_idx
  on public.media_assets (tailor_profile_id, portfolio_position)
  where purpose = 'PORTFOLIO' and status = 'ACTIVE' and portfolio_position is not null;

create index if not exists media_assets_public_portfolio_read_idx
  on public.media_assets (tailor_profile_id, is_primary desc, portfolio_position asc, created_at asc)
  where purpose = 'PORTFOLIO'
    and status = 'ACTIVE'
    and availability_state = 'AVAILABLE'
    and moderation_status in ('APPROVED', 'AUTO_ALLOWED');

create or replace function public.set_media_asset_presentation(
  p_media_asset_id uuid,
  p_focal_x numeric,
  p_focal_y numeric,
  p_alt_text text default null,
  p_poster_timestamp_ms integer default null,
  p_portfolio_position integer default null,
  p_is_primary boolean default false
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_asset public.media_assets;
begin
  select * into v_asset
  from public.media_assets
  where id = p_media_asset_id
  for update;

  if v_asset.id is null then
    raise exception 'media asset not found' using errcode = 'P0002';
  end if;
  if auth.role() <> 'service_role' and v_asset.owner_user_id is distinct from auth.uid() then
    raise exception 'media asset does not belong to this account' using errcode = '42501';
  end if;
  if v_asset.purpose <> 'PORTFOLIO' then
    raise exception 'presentation editing is only available for portfolio media' using errcode = '22023';
  end if;
  if p_focal_x is null or p_focal_x < 0 or p_focal_x > 1 or p_focal_y is null or p_focal_y < 0 or p_focal_y > 1 then
    raise exception 'focal coordinates must be between 0 and 1' using errcode = '22023';
  end if;
  if p_poster_timestamp_ms is not null and p_poster_timestamp_ms < 0 then
    raise exception 'poster timestamp cannot be negative' using errcode = '22023';
  end if;
  if p_portfolio_position is not null and p_portfolio_position < 0 then
    raise exception 'portfolio position cannot be negative' using errcode = '22023';
  end if;
  if char_length(coalesce(p_alt_text, '')) > 500 then
    raise exception 'alt text cannot exceed 500 characters' using errcode = '22023';
  end if;

  if p_is_primary then
    update public.media_assets
    set is_primary = false, updated_at = now()
    where tailor_profile_id = v_asset.tailor_profile_id
      and purpose = 'PORTFOLIO'
      and id <> v_asset.id
      and is_primary = true;
  end if;

  update public.media_assets
  set
    focal_x = p_focal_x,
    focal_y = p_focal_y,
    alt_text = nullif(btrim(coalesce(p_alt_text, '')), ''),
    poster_timestamp_ms = case when media_kind = 'VIDEO' then p_poster_timestamp_ms else null end,
    portfolio_position = p_portfolio_position,
    is_primary = p_is_primary,
    updated_at = now()
  where id = v_asset.id
  returning * into v_asset;

  return v_asset;
end;
$$;

revoke all on function public.set_media_asset_presentation(uuid, numeric, numeric, text, integer, integer, boolean) from public, anon;
grant execute on function public.set_media_asset_presentation(uuid, numeric, numeric, text, integer, integer, boolean) to authenticated, service_role;

comment on column public.media_assets.focal_x is 'Normalized horizontal focal point for cover previews; the immutable original is unchanged.';
comment on column public.media_assets.focal_y is 'Normalized vertical focal point for cover previews; the immutable original is unchanged.';
comment on function public.set_media_asset_presentation(uuid, numeric, numeric, text, integer, integer, boolean) is
  'Owner-scoped non-destructive portfolio presentation update used across mobile and web.';
