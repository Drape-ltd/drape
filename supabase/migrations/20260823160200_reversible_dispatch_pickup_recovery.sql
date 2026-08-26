-- A delivery replacement retires the old pickup credential, but the customer
-- may explicitly return to pickup until a provider booking has started.
create or replace function public.decide_order_fulfillment_quote(
  p_order_id text,
  p_customer_id uuid,
  p_decision text,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders%rowtype;
  v_run public.order_fulfillment_runs%rowtype;
  v_event public.order_fulfillment_events%rowtype;
  v_event_type text;
  v_code_bytes bytea;
  v_fresh_collection_code text;
begin
  if p_decision not in ('PAY_SHORTFALL','REQUEST_CHEAPER_OPTION','SWITCH_TO_PICKUP','DECLINE_DISPATCH') then
    raise exception 'Invalid dispatch decision.';
  end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'A dispatch decision idempotency key is required.';
  end if;

  select * into v_event from public.order_fulfillment_events where idempotency_key=p_idempotency_key;
  if v_event.id is not null then
    return jsonb_build_object('runId',v_event.run_id,'eventId',v_event.id,'existing',true);
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.customer_id::text <> p_customer_id::text then
    raise exception 'Only the customer can decide this dispatch quote.';
  end if;

  select * into v_run from public.order_fulfillment_runs where order_id=p_order_id for update;
  if v_run.id is null then raise exception 'This dispatch request no longer exists.'; end if;

  if p_decision='SWITCH_TO_PICKUP' then
    if v_run.status not in ('QUOTE_REQUIRED','AWAITING_CUSTOMER_DECISION','AWAITING_SHORTFALL_PAYMENT','READY_TO_BOOK') then
      raise exception 'FULFILLMENT_ALREADY_IN_PROGRESS';
    end if;
  elsif v_run.status <> 'AWAITING_CUSTOMER_DECISION' then
    raise exception 'This dispatch quote is no longer awaiting a customer decision.';
  end if;

  if p_decision='PAY_SHORTFALL' then
    if v_run.shortfall_total_amount <= 0 then raise exception 'No delivery shortfall is due.'; end if;
    update public.order_fulfillment_runs set
      status='AWAITING_SHORTFALL_PAYMENT', funding_status='SHORTFALL_DUE',
      customer_decision=p_decision,customer_decision_note=nullif(trim(coalesce(p_note,'')),''),
      customer_decided_at=now(),updated_at=now()
    where id=v_run.id returning * into v_run;
    update public.orders set
      fulfillment_fee=v_run.shortfall_total_amount,
      fulfillment_payment_requested_at=coalesce(fulfillment_payment_requested_at,now()),
      fulfillment_payment_paid_at=null,fulfillment_payment_provider=null,
      fulfillment_payment_intent_id=null,fulfillment_payment_checkout_url=null
    where id=v_order.id;
    v_event_type:='SHORTFALL_REQUESTED';
  elsif p_decision in ('REQUEST_CHEAPER_OPTION','DECLINE_DISPATCH') then
    update public.order_fulfillment_runs set
      status='QUOTE_REQUIRED',funding_status='UNQUOTED',customer_decision=p_decision,
      customer_decision_note=nullif(trim(coalesce(p_note,'')),''),customer_decided_at=now(),
      actual_provider_cost_amount=null,allowance_applied_amount=0,shortfall_subtotal_amount=0,
      shortfall_tax_amount=0,shortfall_fee_amount=0,shortfall_total_amount=0,
      unused_allowance_amount=0,customer_refund_amount=0,customer_refund_tax_amount=0,
      subsidy_restored_amount=0,provider_name=null,provider_quote_reference=null,
      provider_quote_evidence='[]'::jsonb,quote_recorded_at=null,updated_at=now()
    where id=v_run.id returning * into v_run;
    update public.orders set fulfillment_payment_requested_at=null,fulfillment_payment_paid_at=null,
      fulfillment_payment_provider=null,fulfillment_payment_intent_id=null,
      fulfillment_payment_checkout_url=null where id=v_order.id;
    v_event_type:=case when p_decision='DECLINE_DISPATCH' then 'DISPATCH_OPTION_DECLINED' else 'CHEAPER_OPTION_REQUESTED' end;
  else
    if v_run.tax_attribution_status='AMBIGUOUS' and v_run.customer_funded_allowance_amount>0 then
      raise exception 'FULFILLMENT_TAX_ATTRIBUTION_REQUIRED';
    end if;

    if v_order.stage in ('READY_FOR_COLLECTION','READY_FOR_DRAPE_DISPATCH') then
      v_code_bytes := extensions.gen_random_bytes(2);
      v_fresh_collection_code := lpad((1000 + ((get_byte(v_code_bytes,0) * 256 + get_byte(v_code_bytes,1)) % 9000))::text, 4, '0');
    end if;

    update public.order_fulfillment_runs set
      method='LOCAL_COLLECTION',status='PICKUP_READY',funding_status='REFUND_PENDING',
      customer_decision=p_decision,customer_decision_note=nullif(trim(coalesce(p_note,'')),''),
      customer_decided_at=now(),customer_refund_amount=customer_funded_allowance_amount,
      customer_refund_tax_amount=captured_fulfillment_tax_amount,
      customer_refund_status=case when customer_funded_allowance_amount+captured_fulfillment_tax_amount>0 then 'QUEUED' else 'NOT_REQUIRED' end,
      subsidy_restored_amount=drapeon_subsidy_amount,unused_allowance_amount=captured_allowance_amount,
      updated_at=now()
    where id=v_run.id returning * into v_run;

    update public.orders set
      delivery_method='LOCAL_COLLECTION',fulfillment_fee=0,
      fulfillment_payment_requested_at=null,fulfillment_payment_paid_at=null,
      fulfillment_payment_provider=null,fulfillment_payment_intent_id=null,
      fulfillment_payment_checkout_url=null,
      collection_code=v_fresh_collection_code,
      collection_code_expiry=case when v_fresh_collection_code is not null then now()+interval '24 hours' else null end,
      collection_code_used=false,collection_code_attempts=0,collection_code_last_attempt_at=null,
      updated_at=now()
    where id=v_order.id;
    v_event_type:='PICKUP_SELECTED';
  end if;

  insert into public.order_fulfillment_events(
    run_id,order_id,event_type,source,actor_id,actor_role,idempotency_key,
    customer_note,occurred_at,correlation_id,payload
  ) values (
    v_run.id,v_run.order_id,v_event_type,'CUSTOMER',p_customer_id,'CUSTOMER',p_idempotency_key,
    nullif(trim(coalesce(p_note,'')),''),now(),v_run.correlation_id,
    jsonb_build_object('decision',p_decision,'customerDueAmount',v_run.shortfall_total_amount,
      'customerRefundAmount',v_run.customer_refund_amount,
      'customerRefundTaxAmount',v_run.customer_refund_tax_amount,
      'customerRefundTotalAmount',v_run.customer_refund_amount+v_run.customer_refund_tax_amount,
      'freshPickupCredentialIssued',v_fresh_collection_code is not null)
  ) returning * into v_event;

  return jsonb_build_object('runId',v_run.id,'eventId',v_event.id,'status',v_run.status,
    'method',v_run.method,'fundingStatus',v_run.funding_status,
    'customerDueAmount',v_run.shortfall_total_amount,
    'customerRefundAmount',v_run.customer_refund_amount,
    'customerRefundTaxAmount',v_run.customer_refund_tax_amount,
    'customerRefundTotalAmount',v_run.customer_refund_amount+v_run.customer_refund_tax_amount,
    'freshPickupCredentialIssued',v_fresh_collection_code is not null,'existing',false);
end;
$$;

revoke all on function public.decide_order_fulfillment_quote(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.decide_order_fulfillment_quote(text,uuid,text,text,text) to service_role;
