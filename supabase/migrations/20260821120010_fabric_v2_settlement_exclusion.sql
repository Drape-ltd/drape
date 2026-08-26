-- V2 provider-confirmed fabric releases must never be paid again through the
-- production settlement plan. Older orders retain their captured v1 behavior.

create or replace function public.initialize_order_settlement_plan(p_order_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_order public.orders%rowtype; v_payment public.order_payments%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_plan uuid; v_method text; v_amount integer; v_seller_subtotal integer;
  v_excluded integer:=0; v_currency currency; v_correlation uuid;
  v_allocated integer:=0; v_amounts integer[]; v_codes text[]; v_bps integer[]; i integer;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;
  if v_order.commercial_policy_version <> 'commercial-2026-07-31-v1' then return null; end if;
  select * into v_payment from public.order_payments where order_id=p_order_id and phase='INITIAL_ORDER' and status in ('SUCCEEDED','PARTIAL_REFUND') order by confirmed_at desc nulls last limit 1;
  if v_payment.id is null or v_payment.ledger_recorded_at is null then raise exception 'A ledger-recorded initial payment is required.'; end if;
  v_seller_subtotal:=coalesce((v_payment.commercial_breakdown->>'subtotalAmount')::integer,v_order.subtotal_amount,v_order.source_amount);
  select * into v_allocation from public.order_fabric_funding_allocations where order_id=p_order_id;
  if v_order.fabric_funding_policy_version in ('fabric-funding-2026-08-01-v1','fabric-funding-2026-08-21-v2') then
    if v_allocation.id is null or v_allocation.tailoring_amount<=0 then raise exception 'Funded-fabric settlement requires the locked tailoring allocation.'; end if;
    v_amount:=v_allocation.tailoring_amount;
    v_excluded:=v_allocation.base_allowance_amount+v_allocation.paid_adjustment_amount;
  else v_amount:=v_seller_subtotal; end if;
  if coalesce(v_amount,0)<=0 then raise exception 'Tailor entitlement is missing.'; end if;
  v_currency:=v_payment.currency; v_correlation:=v_payment.correlation_id;
  v_method:=case when v_order.delivery_method='LOCAL_COLLECTION' then 'LOCAL_HANDOFF' else 'SHIPPED' end;
  insert into public.order_settlement_plans(order_id,customer_id,tailor_id,source_payment_id,method,currency,entitlement_amount,seller_subtotal_amount,excluded_fabric_allowance_amount,correlation_id)
  values(p_order_id,v_order.customer_id::uuid,v_order.tailor_id::uuid,v_payment.id,v_method,v_currency,v_amount,v_seller_subtotal,v_excluded,v_correlation)
  on conflict(order_id) do nothing returning id into v_plan;
  if v_plan is null then select id into v_plan from public.order_settlement_plans where order_id=p_order_id; return v_plan; end if;
  if v_method='LOCAL_HANDOFF' then v_codes:=array['LOCAL_HANDOFF_80','LOCAL_SETTLED_20']; v_bps:=array[8000,2000]; else v_codes:=array['SHIP_CUSTODY_70','SHIP_DELIVERY_20','SHIP_PROTECTION_10']; v_bps:=array[7000,2000,1000]; end if;
  v_amounts:=array[]::integer[];
  for i in 1..array_length(v_codes,1) loop v_amounts:=array_append(v_amounts,(v_amount::bigint*v_bps[i]/10000)::integer); v_allocated:=v_allocated+v_amounts[i]; end loop;
  v_amounts[1]:=v_amounts[1]+(v_amount-v_allocated);
  for i in 1..array_length(v_codes,1) loop
    insert into public.order_settlement_tranches(plan_id,order_id,code,sequence,basis_points,amount,currency,correlation_id)
    values(v_plan,p_order_id,v_codes[i],i,v_bps[i],v_amounts[i],v_currency,v_correlation);
  end loop;
  insert into public.order_settlement_events(plan_id,event_type,actor_role,payload,correlation_id)
  values(v_plan,'PLAN_CREATED','SYSTEM',jsonb_build_object('method',v_method,'entitlement_amount',v_amount,'seller_subtotal_amount',v_seller_subtotal,'excluded_fabric_allowance_amount',v_excluded,'currency',v_currency),v_correlation);
  return v_plan;
end $$;
