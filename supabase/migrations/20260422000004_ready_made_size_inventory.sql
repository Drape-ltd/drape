alter table seller_items
  add column if not exists size_inventory jsonb not null default '{}'::jsonb;

update seller_items
set size_inventory = case
  when coalesce(array_length(sizes, 1), 0) = 0 then '{}'::jsonb
  when coalesce(array_length(sizes, 1), 0) = 1 then jsonb_build_object(sizes[1], greatest(inventory_quantity, 0))
  else (
    select coalesce(
      jsonb_object_agg(size_label, case when ordinality = 1 then greatest(seller_items.inventory_quantity, 0) else 0 end),
      '{}'::jsonb
    )
    from unnest(seller_items.sizes) with ordinality as expanded(size_label, ordinality)
  )
end
where size_inventory = '{}'::jsonb;

create or replace function public.reserve_seller_item_inventory(
  target_item_id uuid,
  requested_quantity integer,
  requested_size text default null
)
returns table (inventory_quantity integer, stock_status text, size_inventory jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_size text := nullif(trim(requested_size), '');
begin
  if requested_quantity is null or requested_quantity < 1 then
    raise exception 'Requested quantity must be at least 1.';
  end if;

  return query
  update seller_items
  set inventory_quantity = seller_items.inventory_quantity - requested_quantity,
      size_inventory = case
        when normalized_size is null then seller_items.size_inventory
        else jsonb_set(
          coalesce(seller_items.size_inventory, '{}'::jsonb),
          array[normalized_size],
          to_jsonb(greatest(coalesce((seller_items.size_inventory ->> normalized_size)::integer, 0) - requested_quantity, 0)),
          true
        )
      end,
      stock_status = public.derive_seller_item_stock_status(
        seller_items.is_live,
        seller_items.inventory_quantity - requested_quantity
      ),
      updated_at = now()
  where seller_items.id = target_item_id
    and seller_items.is_live = true
    and seller_items.inventory_quantity >= requested_quantity
    and (
      normalized_size is null
      or coalesce((seller_items.size_inventory ->> normalized_size)::integer, 0) >= requested_quantity
    )
  returning seller_items.inventory_quantity, seller_items.stock_status, seller_items.size_inventory;
end;
$$;

create or replace function public.release_seller_item_inventory(
  target_item_id uuid,
  released_quantity integer,
  released_size text default null
)
returns table (inventory_quantity integer, stock_status text, size_inventory jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_size text := nullif(trim(released_size), '');
begin
  if released_quantity is null or released_quantity < 1 then
    raise exception 'Released quantity must be at least 1.';
  end if;

  return query
  update seller_items
  set inventory_quantity = seller_items.inventory_quantity + released_quantity,
      size_inventory = case
        when normalized_size is null then seller_items.size_inventory
        else jsonb_set(
          coalesce(seller_items.size_inventory, '{}'::jsonb),
          array[normalized_size],
          to_jsonb(coalesce((seller_items.size_inventory ->> normalized_size)::integer, 0) + released_quantity),
          true
        )
      end,
      stock_status = public.derive_seller_item_stock_status(
        seller_items.is_live,
        seller_items.inventory_quantity + released_quantity
      ),
      updated_at = now()
  where seller_items.id = target_item_id
  returning seller_items.inventory_quantity, seller_items.stock_status, seller_items.size_inventory;
end;
$$;

grant execute on function public.reserve_seller_item_inventory(uuid, integer, text) to authenticated;
grant execute on function public.release_seller_item_inventory(uuid, integer, text) to authenticated;
