-- Grouped customer wishlists.
-- Existing saved_tailors rows are preserved and backfilled into a default
-- "My Go-To Tailors" collection so older saves do not disappear.

create table if not exists public.wishlist_collections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  cover_image_url text,
  item_count integer not null default 0 check (item_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, name)
);

create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.wishlist_collections(id) on delete cascade,
  item_type text not null check (item_type in ('TAILOR', 'READY_MADE_ITEM')),
  -- Keep target IDs as text because older environments have mixed uuid/text
  -- profile IDs. App-layer queries already treat identifiers as strings.
  tailor_id text,
  ready_made_item_id text,
  note text check (note is null or char_length(note) <= 240),
  created_at timestamptz not null default now(),
  constraint wishlist_item_target_check check (
    (item_type = 'TAILOR' and tailor_id is not null and ready_made_item_id is null)
    or
    (item_type = 'READY_MADE_ITEM' and ready_made_item_id is not null and tailor_id is null)
  )
);

create index if not exists wishlist_collections_customer_id_idx
  on public.wishlist_collections(customer_id, updated_at desc);

create index if not exists wishlist_items_collection_id_idx
  on public.wishlist_items(collection_id, created_at desc);

create unique index if not exists wishlist_items_collection_tailor_unique
  on public.wishlist_items(collection_id, tailor_id)
  where item_type = 'TAILOR' and tailor_id is not null;

create unique index if not exists wishlist_items_collection_ready_made_unique
  on public.wishlist_items(collection_id, ready_made_item_id)
  where item_type = 'READY_MADE_ITEM' and ready_made_item_id is not null;

alter table public.wishlist_collections enable row level security;
alter table public.wishlist_items enable row level security;

drop policy if exists "customers manage own wishlist collections" on public.wishlist_collections;
create policy "customers manage own wishlist collections"
  on public.wishlist_collections
  for all
  to authenticated
  using (auth.uid() = customer_id)
  with check (auth.uid() = customer_id);

drop policy if exists "customers manage own wishlist items" on public.wishlist_items;
create policy "customers manage own wishlist items"
  on public.wishlist_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.wishlist_collections wc
      where wc.id = wishlist_items.collection_id
        and wc.customer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.wishlist_collections wc
      where wc.id = wishlist_items.collection_id
        and wc.customer_id = auth.uid()
    )
  );

grant select, insert, update, delete on table public.wishlist_collections to authenticated;
grant select, insert, update, delete on table public.wishlist_items to authenticated;

create or replace function public.touch_wishlist_collection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wishlist_collections_touch_updated_at on public.wishlist_collections;
create trigger wishlist_collections_touch_updated_at
  before update on public.wishlist_collections
  for each row
  execute function public.touch_wishlist_collection();

create or replace function public.refresh_wishlist_collection_summary(target_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
  next_cover text;
begin
  select count(*)::integer
  into next_count
  from public.wishlist_items
  where collection_id = target_collection_id;

  select coalesce(tp.portfolio_photo_urls[1], si.photo_urls[1])
  into next_cover
  from public.wishlist_items wi
  left join public.tailor_profiles tp on tp.id::text = wi.tailor_id
  left join public.seller_items si on si.id::text = wi.ready_made_item_id
  where wi.collection_id = target_collection_id
  order by wi.created_at asc
  limit 1;

  update public.wishlist_collections
  set item_count = coalesce(next_count, 0),
      cover_image_url = next_cover,
      updated_at = now()
  where id = target_collection_id;
end;
$$;

create or replace function public.refresh_wishlist_collection_summary_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_wishlist_collection_summary(old.collection_id);
    return old;
  end if;

  perform public.refresh_wishlist_collection_summary(new.collection_id);
  if tg_op = 'UPDATE' and old.collection_id <> new.collection_id then
    perform public.refresh_wishlist_collection_summary(old.collection_id);
  end if;
  return new;
end;
$$;

drop trigger if exists wishlist_items_refresh_collection_summary on public.wishlist_items;
create trigger wishlist_items_refresh_collection_summary
  after insert or update or delete on public.wishlist_items
  for each row
  execute function public.refresh_wishlist_collection_summary_trigger();

with default_collections as (
  insert into public.wishlist_collections (customer_id, name)
  select distinct st.user_id, 'My Go-To Tailors'
  from public.saved_tailors st
  where not exists (
    select 1
    from public.wishlist_collections wc
    where wc.customer_id = st.user_id
      and wc.name = 'My Go-To Tailors'
  )
  returning id, customer_id
)
insert into public.wishlist_items (collection_id, item_type, tailor_id, created_at)
select wc.id, 'TAILOR', st.tailor_profile_id::text, st.created_at
from public.saved_tailors st
join public.wishlist_collections wc
  on wc.customer_id = st.user_id
 and wc.name = 'My Go-To Tailors'
on conflict do nothing;

do $$
declare
  collection_row record;
begin
  for collection_row in select id from public.wishlist_collections loop
    perform public.refresh_wishlist_collection_summary(collection_row.id);
  end loop;
end;
$$;
