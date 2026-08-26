do $$
begin
  if exists (
    select 1
    from public.orders o
    join public.order_fulfillment_runs r on r.order_id::text=o.id::text
    where o.delivery_method in ('LOCAL_DELIVERY','SHIPPING')
      and r.method=o.delivery_method
      and r.status not in ('CANCELLED','RECONCILED')
      and (o.collection_code is not null or o.collection_code_expiry is not null)
  ) then
    raise exception 'Active delivery replacement retained a pickup credential.';
  end if;
end $$;
