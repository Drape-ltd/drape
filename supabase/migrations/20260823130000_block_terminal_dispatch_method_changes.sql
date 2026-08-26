-- Fulfilment changes are planning actions. Once custody, delivery, collection,
-- completion, refund, or cancellation is terminal, stale clients must not be
-- able to reopen the delivery lane.

create or replace function public.block_terminal_dispatch_method_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.delivery_method is distinct from old.delivery_method
    and upper(coalesce(old.stage::text, '')) in (
      'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED',
      'COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED',
      'CANCELLED', 'DECLINED', 'EXPIRED'
    ) then
    raise exception 'FULFILLMENT_ALREADY_COMPLETE';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_block_terminal_dispatch_method_change on public.orders;
create trigger orders_block_terminal_dispatch_method_change
before update of delivery_method on public.orders
for each row execute function public.block_terminal_dispatch_method_change();

revoke all on function public.block_terminal_dispatch_method_change() from public, anon, authenticated;
grant execute on function public.block_terminal_dispatch_method_change() to service_role;
