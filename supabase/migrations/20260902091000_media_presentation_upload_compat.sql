-- Forward repair for legacy upload RPCs and collision-safe portfolio reordering.

alter table public.media_assets
  alter column media_kind set default 'IMAGE';

create or replace function public.derive_media_asset_kind()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.mime_type, '')) like 'video/%' then
    new.media_kind := 'VIDEO';
  elsif lower(coalesce(new.mime_type, '')) like 'image/%' then
    new.media_kind := 'IMAGE';
  elsif new.media_kind is null then
    new.media_kind := 'IMAGE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_media_assets_derive_kind on public.media_assets;
create trigger trg_media_assets_derive_kind
before insert or update of mime_type, media_kind on public.media_assets
for each row execute function public.derive_media_asset_kind();

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
  v_previous_position integer;
  v_displaced_id uuid;
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

  v_previous_position := v_asset.portfolio_position;
  if p_portfolio_position is not null and p_portfolio_position is distinct from v_previous_position then
    select id into v_displaced_id
    from public.media_assets
    where tailor_profile_id = v_asset.tailor_profile_id
      and purpose = 'PORTFOLIO'
      and status = 'ACTIVE'
      and portfolio_position = p_portfolio_position
      and id <> v_asset.id
    for update;

    if v_displaced_id is not null then
      update public.media_assets
      set portfolio_position = null, updated_at = now()
      where id = v_displaced_id;
    end if;
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

  if v_displaced_id is not null then
    update public.media_assets
    set portfolio_position = v_previous_position, updated_at = now()
    where id = v_displaced_id;
  end if;

  return v_asset;
end;
$$;

revoke all on function public.derive_media_asset_kind() from public, anon, authenticated;
grant execute on function public.derive_media_asset_kind() to service_role;

comment on function public.derive_media_asset_kind() is
  'Keeps legacy upload RPCs compatible with the canonical IMAGE/VIDEO presentation contract.';
