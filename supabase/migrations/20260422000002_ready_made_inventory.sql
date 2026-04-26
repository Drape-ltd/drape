alter table seller_items
  add column if not exists inventory_quantity integer not null default 0
    check (inventory_quantity >= 0);

update seller_items
set inventory_quantity = case
  when stock_status = 'SOLD_OUT' then 0
  when stock_status = 'LOW_STOCK' then 1
  else 3
end;

create or replace function public.derive_seller_item_stock_status(next_is_live boolean, next_inventory_quantity integer)
returns text
language plpgsql
immutable
as $$
begin
  if not next_is_live then
    return 'HIDDEN';
  end if;

  if coalesce(next_inventory_quantity, 0) <= 0 then
    return 'SOLD_OUT';
  end if;

  if next_inventory_quantity <= 2 then
    return 'LOW_STOCK';
  end if;

  return 'IN_STOCK';
end;
$$;

create or replace function public.reserve_seller_item_inventory(target_item_id uuid, requested_quantity integer)
returns table (inventory_quantity integer, stock_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if requested_quantity is null or requested_quantity < 1 then
    raise exception 'Requested quantity must be at least 1.';
  end if;

  return query
  update seller_items
  set inventory_quantity = seller_items.inventory_quantity - requested_quantity,
      stock_status = public.derive_seller_item_stock_status(
        seller_items.is_live,
        seller_items.inventory_quantity - requested_quantity
      ),
      updated_at = now()
  where seller_items.id = target_item_id
    and seller_items.is_live = true
    and seller_items.inventory_quantity >= requested_quantity
  returning seller_items.inventory_quantity, seller_items.stock_status;
end;
$$;

create or replace function public.release_seller_item_inventory(target_item_id uuid, released_quantity integer)
returns table (inventory_quantity integer, stock_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if released_quantity is null or released_quantity < 1 then
    raise exception 'Released quantity must be at least 1.';
  end if;

  return query
  update seller_items
  set inventory_quantity = seller_items.inventory_quantity + released_quantity,
      stock_status = public.derive_seller_item_stock_status(
        seller_items.is_live,
        seller_items.inventory_quantity + released_quantity
      ),
      updated_at = now()
  where seller_items.id = target_item_id
  returning seller_items.inventory_quantity, seller_items.stock_status;
end;
$$;

grant execute on function public.derive_seller_item_stock_status(boolean, integer) to authenticated;
grant execute on function public.reserve_seller_item_inventory(uuid, integer) to authenticated;
grant execute on function public.release_seller_item_inventory(uuid, integer) to authenticated;
