-- Conservative hot-path indexes for launch QA and early scale.
-- Each block checks the column exists first because the dev database has some
-- historical schema drift between the original migrations and the live shape.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_id'
  ) then
    execute 'create index if not exists orders_customer_created_at_idx on public.orders (customer_id, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'tailor_id'
  ) then
    execute 'create index if not exists orders_tailor_created_at_idx on public.orders (tailor_id, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'stage'
  ) then
    execute 'create index if not exists orders_customer_stage_created_at_idx on public.orders (customer_id, stage, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'tailor_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'stage'
  ) then
    execute 'create index if not exists orders_tailor_stage_created_at_idx on public.orders (tailor_id, stage, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_stage_updates' and column_name = 'order_id'
  ) then
    execute 'create index if not exists order_stage_updates_order_created_at_idx on public.order_stage_updates (order_id, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'order_id'
  ) then
    execute 'create index if not exists messages_order_created_at_idx on public.messages (order_id, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wishlist_collections' and column_name = 'customer_id'
  ) then
    execute 'create index if not exists wishlist_collections_customer_updated_at_idx on public.wishlist_collections (customer_id, updated_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wishlist_items' and column_name = 'collection_id'
  ) then
    execute 'create index if not exists wishlist_items_collection_created_at_idx on public.wishlist_items (collection_id, created_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tailor_profiles' and column_name = 'is_live'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tailor_profiles' and column_name = 'avg_rating'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tailor_profiles' and column_name = 'updated_at'
  ) then
    execute 'create index if not exists tailor_profiles_live_rating_idx on public.tailor_profiles (is_live, avg_rating desc nulls last, updated_at desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'seller_items' and column_name = 'tailor_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'seller_items' and column_name = 'created_at'
  ) then
    execute 'create index if not exists seller_items_tailor_created_at_idx on public.seller_items (tailor_id, created_at desc)';
  end if;
end;
$$;
