do $$
begin
  if not exists (select 1 from pg_type where typname = 'seller_type') then
    create type seller_type as enum ('TAILOR', 'BOUTIQUE', 'TAILOR_SHOP');
  end if;
end
$$;

alter table tailor_profiles
  add column if not exists seller_type seller_type not null default 'TAILOR',
  add column if not exists supports_custom_orders boolean not null default true,
  add column if not exists supports_ready_made boolean not null default false,
  add column if not exists pickup_available boolean not null default false,
  add column if not exists delivery_available boolean not null default false,
  add column if not exists shipping_available boolean not null default false;

create table if not exists seller_items (
  id uuid primary key default gen_random_uuid(),
  tailor_profile_id uuid not null references tailor_profiles(id) on delete cascade,
  title text not null,
  description text,
  category text,
  sizes text[] not null default '{}',
  price_amount integer not null check (price_amount > 0),
  currency currency not null default 'GBP',
  photo_urls text[] not null default '{}',
  is_ready_made boolean not null default true,
  is_live boolean not null default false,
  stock_status text not null default 'IN_STOCK'
    check (stock_status in ('IN_STOCK', 'LOW_STOCK', 'SOLD_OUT', 'HIDDEN')),
  pickup_available boolean not null default false,
  delivery_available boolean not null default false,
  shipping_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seller_items_tailor_profile_id_idx on seller_items(tailor_profile_id);
create index if not exists seller_items_is_live_idx on seller_items(is_live);

grant select on table seller_items to anon;
grant select, insert, update, delete on table seller_items to authenticated;

alter table seller_items enable row level security;

drop policy if exists "public reads live seller items" on seller_items;
create policy "public reads live seller items"
  on seller_items for select
  using (
    is_live = true
    and exists (
      select 1 from tailor_profiles tp
      where tp.id = seller_items.tailor_profile_id
        and tp.is_live = true
    )
  );

drop policy if exists "tailors manage own seller items" on seller_items;
create policy "tailors manage own seller items"
  on seller_items for all
  to authenticated
  using (
    exists (
      select 1 from tailor_profiles tp
      where tp.id = seller_items.tailor_profile_id
        and tp.user_id::text = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from tailor_profiles tp
      where tp.id = seller_items.tailor_profile_id
        and tp.user_id::text = auth.uid()::text
    )
  );
