do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'sync_order_dispatch_stage_with_method'
      and not tgisinternal
  ) then
    raise exception 'dispatch method/stage synchronization trigger is missing';
  end if;

  if exists (
    select 1
    from public.orders o
    join public.order_fulfillment_runs r on r.order_id::text = o.id::text
    where o.delivery_method in ('LOCAL_DELIVERY', 'SHIPPING')
      and r.method = o.delivery_method
      and r.status not in ('CANCELLED', 'RECONCILED')
      and o.stage = 'READY_FOR_COLLECTION'
  ) then
    raise exception 'active delivery/shipping orders remain in pickup-ready stage';
  end if;
end;
$$;
