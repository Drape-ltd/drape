-- Trust and safety hardening for uploaded media.
-- Media stays usable while pending review, but ops can block public URLs from
-- read surfaces without deleting the underlying storage object.

alter table if exists public.media_assets
  add column if not exists moderation_status text not null default 'PENDING_REVIEW',
  add column if not exists moderation_risk_level text not null default 'UNKNOWN',
  add column if not exists moderation_reasons text[] not null default '{}'::text[],
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_moderation_status_check'
  ) then
    alter table public.media_assets
      add constraint media_assets_moderation_status_check
      check (moderation_status in ('PENDING_REVIEW', 'APPROVED', 'BLOCKED', 'AUTO_ALLOWED', 'AUTO_BLOCKED'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_moderation_risk_level_check'
  ) then
    alter table public.media_assets
      add constraint media_assets_moderation_risk_level_check
      check (moderation_risk_level in ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'));
  end if;
end $$;

create index if not exists media_assets_moderation_status_created_idx
  on public.media_assets (moderation_status, created_at desc);

create index if not exists media_assets_public_url_idx
  on public.media_assets (public_url)
  where public_url is not null;

create or replace function public.set_media_asset_moderation_status(
  p_media_asset_id uuid,
  p_status text,
  p_risk_level text default null,
  p_reasons text[] default '{}'::text[],
  p_reviewed_by text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_media_asset_id is null then
    raise exception 'media asset id is required' using errcode = '22023';
  end if;

  if p_status not in ('PENDING_REVIEW', 'APPROVED', 'BLOCKED', 'AUTO_ALLOWED', 'AUTO_BLOCKED') then
    raise exception 'unsupported media moderation status' using errcode = '22023';
  end if;

  if p_risk_level is not null and p_risk_level not in ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH') then
    raise exception 'unsupported media moderation risk level' using errcode = '22023';
  end if;

  update public.media_assets
  set
    moderation_status = p_status,
    moderation_risk_level = coalesce(p_risk_level, moderation_risk_level, 'UNKNOWN'),
    moderation_reasons = coalesce(p_reasons, '{}'::text[]),
    reviewed_by = nullif(btrim(coalesce(p_reviewed_by, '')), ''),
    reviewed_at = case
      when p_status in ('APPROVED', 'BLOCKED', 'AUTO_ALLOWED', 'AUTO_BLOCKED') then now()
      else null
    end,
    updated_at = now()
  where id = p_media_asset_id;
end;
$$;

revoke all on function public.set_media_asset_moderation_status(uuid, text, text, text[], text) from public, anon, authenticated;
grant execute on function public.set_media_asset_moderation_status(uuid, text, text, text[], text) to service_role;
