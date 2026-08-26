-- A pickup -> delivery/shipping request is a replacement, not a parallel
-- fulfilment option. Retire the pickup credential in the same transaction as
-- the authoritative method change and repair already-transitioned DEV rows.

create or replace function public.request_order_fulfillment_method_change(
  p_order_id text,
  p_customer_id uuid,
  p_method text,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders%rowtype;
  v_run public.order_fulfillment_runs%rowtype;
  v_event public.order_fulfillment_events%rowtype;
  v_event_type text;
  v_previous_run_status text;
  v_pickup_credential_retired boolean;
begin
  if p_method not in ('LOCAL_DELIVERY','SHIPPING') then
    raise exception 'INVALID_FULFILLMENT_METHOD';
  end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'An idempotency key is required.';
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.customer_id::text <> p_customer_id::text then raise exception 'CUSTOMER_ONLY'; end if;
  v_pickup_credential_retired := v_order.collection_code is not null;

  select * into v_event from public.order_fulfillment_events
  where idempotency_key=p_idempotency_key and order_id=p_order_id;
  if v_event.id is not null then
    -- Idempotent retries also repair legacy split-brain rows where the method
    -- changed but the pickup credential survived.
    update public.orders set
      delivery_method=p_method::public.delivery_method,
      collection_code=null,
      collection_code_expiry=null,
      collection_code_used=false,
      collection_code_attempts=0,
      collection_code_last_attempt_at=null,
      updated_at=now()
    where id=p_order_id;
    return jsonb_build_object(
      'runId',v_event.run_id,
      'eventId',v_event.id,
      'existing',true,
      'method',p_method,
      'pickupCredentialRetired',v_pickup_credential_retired
    );
  end if;

  if nullif(trim(coalesce(v_order.recipient_name,'')),'') is null
    or nullif(trim(coalesce(v_order.recipient_phone,'')),'') is null
    or nullif(trim(coalesce(v_order.delivery_address,'')),'') is null
    or nullif(trim(coalesce(v_order.delivery_country_code,'')),'') is null then
    raise exception 'DELIVERY_DETAILS_REQUIRED';
  end if;

  v_run:=public.ensure_order_fulfillment_run(p_order_id);
  select * into v_run from public.order_fulfillment_runs where id=v_run.id for update;
  v_previous_run_status:=v_run.status;
  if v_run.status not in ('QUOTE_REQUIRED','AWAITING_CUSTOMER_DECISION','PICKUP_READY','CANCELLED')
    or v_run.booked_at is not null
    or v_run.provider_payment_id is not null
    or v_run.shortfall_paid_at is not null
    or v_run.commercial_adjustment_id is not null
    or v_run.customer_refund_status not in ('NOT_REQUIRED','FAILED')
    or coalesce(v_run.customer_refund_amount,0) > 0
    or coalesce(v_run.customer_refund_tax_amount,0) > 0
    or coalesce(v_run.subsidy_restored_amount,0) > 0 then
    raise exception 'FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED';
  end if;

  update public.orders set
    delivery_method=p_method::public.delivery_method,
    collection_code=null,
    collection_code_expiry=null,
    collection_code_used=false,
    collection_code_attempts=0,
    collection_code_last_attempt_at=null,
    updated_at=now()
  where id=p_order_id;

  update public.order_fulfillment_runs set
    method=p_method::public.delivery_method,
    status='QUOTE_REQUIRED', funding_status='UNQUOTED',
    actual_provider_cost_amount=null, allowance_applied_amount=0,
    shortfall_subtotal_amount=0, shortfall_tax_amount=0,
    shortfall_fee_amount=0, shortfall_total_amount=0,
    unused_allowance_amount=0, provider_name=null,
    provider_quote_reference=null, provider_quote_evidence='[]'::jsonb,
    customer_decision=null, customer_decision_note=null,
    customer_decided_at=null, quote_recorded_at=null,
    updated_at=now()
  where id=v_run.id returning * into v_run;

  v_event_type:=case when p_method='SHIPPING' then 'SHIPPING_REQUESTED' else 'LOCAL_DELIVERY_REQUESTED' end;
  insert into public.order_fulfillment_events(
    run_id,order_id,event_type,source,actor_id,actor_role,idempotency_key,
    customer_note,occurred_at,correlation_id,payload
  ) values (
    v_run.id,p_order_id,v_event_type,'CUSTOMER',p_customer_id,'CUSTOMER',p_idempotency_key,
    nullif(trim(coalesce(p_note,'')),''),now(),v_run.correlation_id,
    jsonb_build_object(
      'method',p_method,
      'previousMethod',v_order.delivery_method,
      'previousRunStatus',v_previous_run_status,
      'pickupCredentialRetired',v_pickup_credential_retired,
      'capturedAllowanceAmount',v_run.captured_allowance_amount,
      'customerFundedAllowanceAmount',v_run.customer_funded_allowance_amount,
      'drapeonSubsidyAmount',v_run.drapeon_subsidy_amount
    )
  ) returning * into v_event;

  return jsonb_build_object(
    'runId',v_run.id,
    'eventId',v_event.id,
    'existing',false,
    'method',p_method,
    'status','QUOTE_REQUIRED',
    'pickupCredentialRetired',v_pickup_credential_retired
  );
end;
$$;

revoke all on function public.request_order_fulfillment_method_change(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.request_order_fulfillment_method_change(text,uuid,text,text,text) to service_role;

update public.orders o set
  collection_code=null,
  collection_code_expiry=null,
  collection_code_used=false,
  collection_code_attempts=0,
  collection_code_last_attempt_at=null,
  updated_at=now()
from public.order_fulfillment_runs r
where r.order_id::text=o.id::text
  and o.delivery_method in ('LOCAL_DELIVERY','SHIPPING')
  and r.method=o.delivery_method
  and r.status not in ('CANCELLED','RECONCILED')
  and o.collection_code is not null;
