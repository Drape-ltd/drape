-- Durable deny-first invalidation ledger for public marketplace entities.
-- Public reads are currently no-store. This ledger must be consulted before any
-- shared/edge cache is reintroduced so a cached object can never resurrect a
-- removed profile or seller item.

create table if not exists public.public_visibility_tombstones (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('TAILOR_PROFILE', 'SELLER_ITEM')),
  entity_id uuid not null,
  reason text not null,
  source text not null,
  removed_at timestamptz not null default now(),
  restored_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists public_visibility_tombstones_active_entity_idx
  on public.public_visibility_tombstones (entity_type, entity_id)
  where restored_at is null;

create index if not exists public_visibility_tombstones_removed_at_idx
  on public.public_visibility_tombstones (removed_at desc)
  where restored_at is null;

alter table public.public_visibility_tombstones enable row level security;
revoke all on table public.public_visibility_tombstones from public, anon, authenticated;
grant select, insert, update on table public.public_visibility_tombstones to service_role;

create or replace function public.record_public_visibility_tombstone(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_source text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.public_visibility_tombstones (
    entity_type,
    entity_id,
    reason,
    source,
    metadata
  ) values (
    p_entity_type,
    p_entity_id,
    left(coalesce(nullif(trim(p_reason), ''), 'VISIBILITY_REMOVED'), 160),
    left(coalesce(nullif(trim(p_source), ''), 'DATABASE_TRIGGER'), 120),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (entity_type, entity_id) where restored_at is null
  do update set
    reason = excluded.reason,
    source = excluded.source,
    removed_at = now(),
    metadata = public.public_visibility_tombstones.metadata || excluded.metadata;
end;
$$;

create or replace function public.capture_public_marketplace_visibility_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  was_public boolean := false;
  is_public boolean := false;
begin
  if tg_table_name = 'tailor_profiles' then
    if tg_op <> 'INSERT' then
      was_public := coalesce(old.is_live, false)
        and coalesce(old.is_verified, false)
        and not coalesce(old.is_test_profile, false);
    end if;
    if tg_op <> 'DELETE' then
      is_public := coalesce(new.is_live, false)
        and coalesce(new.is_verified, false)
        and not coalesce(new.is_test_profile, false);
    end if;

    if tg_op = 'DELETE' or (was_public and not is_public) then
      perform public.record_public_visibility_tombstone(
        'TAILOR_PROFILE',
        coalesce(new.id, old.id),
        case
          when tg_op = 'DELETE' then 'PROFILE_DELETED'
          when coalesce(new.is_test_profile, false) then 'TEST_PROFILE'
          when not coalesce(new.is_verified, false) then 'TRUST_REMOVED'
          else 'PROFILE_HIDDEN'
        end,
        'TAILOR_PROFILE_TRIGGER'
      );
    end if;
  elsif tg_table_name = 'seller_items' then
    if tg_op <> 'INSERT' then
      was_public := coalesce(old.is_live, false)
        and coalesce(old.stock_status, 'HIDDEN') not in ('HIDDEN', 'SOLD_OUT')
        and coalesce(old.inventory_quantity, 0) > 0;
    end if;
    if tg_op <> 'DELETE' then
      is_public := coalesce(new.is_live, false)
        and coalesce(new.stock_status, 'HIDDEN') not in ('HIDDEN', 'SOLD_OUT')
        and coalesce(new.inventory_quantity, 0) > 0;
    end if;

    if tg_op = 'DELETE' or (was_public and not is_public) then
      perform public.record_public_visibility_tombstone(
        'SELLER_ITEM',
        coalesce(new.id, old.id),
        case
          when tg_op = 'DELETE' then 'ITEM_DELETED'
          when not coalesce(new.is_live, false) then 'ITEM_HIDDEN'
          when coalesce(new.inventory_quantity, 0) <= 0 then 'OUT_OF_STOCK'
          else coalesce(new.stock_status, 'ITEM_UNAVAILABLE')
        end,
        'SELLER_ITEM_TRIGGER'
      );
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tailor_profile_public_visibility_tombstone on public.tailor_profiles;
create trigger trg_tailor_profile_public_visibility_tombstone
after update of is_live, is_verified, is_test_profile or delete on public.tailor_profiles
for each row execute function public.capture_public_marketplace_visibility_change();

drop trigger if exists trg_seller_item_public_visibility_tombstone on public.seller_items;
create trigger trg_seller_item_public_visibility_tombstone
after update of is_live, stock_status, inventory_quantity or delete on public.seller_items
for each row execute function public.capture_public_marketplace_visibility_change();

revoke all on function public.record_public_visibility_tombstone(text, uuid, text, text, jsonb) from public;
revoke all on function public.capture_public_marketplace_visibility_change() from public;
grant execute on function public.record_public_visibility_tombstone(text, uuid, text, text, jsonb) to service_role;

comment on table public.public_visibility_tombstones is
  'Deny-first visibility ledger. Any future public cache must consult active tombstones before serving cached entities.';
