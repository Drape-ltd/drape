do $$
begin
  if exists (
    select 1
    from public.orders o
    join public.order_fulfillment_runs r on r.order_id = o.id
    where r.method in ('LOCAL_DELIVERY', 'SHIPPING')
      and r.status not in ('CANCELLED', 'RECONCILED')
      and (
        o.delivery_method is distinct from r.method
        or o.collection_code is not null
        or o.collection_code_expiry is not null
      )
  ) then
    raise exception 'Active dispatch run still conflicts with the order fulfillment method or pickup credential';
  end if;
end;
$$;
