-- Pickup-to-delivery changes must capture the order-specific recipient and
-- destination in the same transaction as the audited method change. This
-- prevents a half-saved address when the fulfilment transition is rejected.

create or replace function public.request_order_fulfillment_method_change_with_details(
  p_order_id text,
  p_customer_id uuid,
  p_method text,
  p_note text,
  p_idempotency_key text,
  p_recipient_name text,
  p_recipient_phone text,
  p_delivery_address text,
  p_delivery_city text,
  p_delivery_region text,
  p_delivery_postal_code text,
  p_delivery_country_code text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders%rowtype;
  v_result jsonb;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.customer_id::text <> p_customer_id::text then raise exception 'CUSTOMER_ONLY'; end if;
  if upper(coalesce(v_order.stage::text, '')) in (
    'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED',
    'COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED',
    'CANCELLED', 'DECLINED', 'EXPIRED'
  ) then
    raise exception 'FULFILLMENT_ALREADY_COMPLETE';
  end if;
  if nullif(trim(coalesce(p_recipient_name,'')),'') is null
    or nullif(trim(coalesce(p_recipient_phone,'')),'') is null
    or nullif(trim(coalesce(p_delivery_address,'')),'') is null
    or length(trim(coalesce(p_delivery_country_code,''))) <> 2 then
    raise exception 'DELIVERY_DETAILS_REQUIRED';
  end if;

  update public.orders set
    recipient_name=trim(p_recipient_name),
    recipient_phone=trim(p_recipient_phone),
    delivery_address=trim(p_delivery_address),
    delivery_city=nullif(trim(coalesce(p_delivery_city,'')),''),
    delivery_region=nullif(trim(coalesce(p_delivery_region,'')),''),
    delivery_postal_code=nullif(trim(coalesce(p_delivery_postal_code,'')),''),
    delivery_country_code=upper(trim(p_delivery_country_code)),
    updated_at=now()
  where id=p_order_id;

  select public.request_order_fulfillment_method_change(
    p_order_id,
    p_customer_id,
    p_method,
    p_note,
    p_idempotency_key
  ) into v_result;

  return v_result || jsonb_build_object('deliveryDetailsSaved', true);
end;
$$;

revoke all on function public.request_order_fulfillment_method_change_with_details(
  text,uuid,text,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.request_order_fulfillment_method_change_with_details(
  text,uuid,text,text,text,text,text,text,text,text,text,text
) to service_role;
