do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='request_order_fulfillment_method_change'
  ) then raise exception 'request_order_fulfillment_method_change is missing'; end if;
  if not exists (
    select 1 from pg_constraint where conname='order_fulfillment_events_event_type_check'
      and pg_get_constraintdef(oid) like '%LOCAL_DELIVERY_REQUESTED%'
  ) then raise exception 'dispatch method-change event types are missing'; end if;
  if position('FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED' in pg_get_functiondef(
    'public.request_order_fulfillment_method_change(text,uuid,text,text,text)'::regprocedure
  )) = 0 then
    raise exception 'method changes do not preserve provider and refund history';
  end if;
  if position('fulfillment_payment_paid_at=null' in pg_get_functiondef(
    'public.request_order_fulfillment_method_change(text,uuid,text,text,text)'::regprocedure
  )) > 0 then
    raise exception 'method changes must not erase the order payment record';
  end if;
  if position('order_id=p_order_id' in pg_get_functiondef(
    'public.request_order_fulfillment_method_change(text,uuid,text,text,text)'::regprocedure
  )) = 0 then
    raise exception 'method-change idempotency must remain scoped to the authorized order';
  end if;
end $$;
