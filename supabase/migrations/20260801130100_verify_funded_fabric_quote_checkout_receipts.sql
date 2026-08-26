-- Rollback-only proof for funded fabric quote, checkout, ledger, and receipt.
do $verification$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_version integer;
  v_payment_id uuid := gen_random_uuid();
  v_reservation jsonb;
  v_reservation_id uuid;
  v_reservation_token uuid;
  v_ledger_id uuid;
  v_receipt public.commercial_receipts%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
begin
  begin
    select o.* into v_order from public.orders o
    join auth.users c on c.id::text=o.customer_id::text
    join auth.users t on t.id::text=o.tailor_id::text
    where not exists (select 1 from public.order_fabric_funding_allocations a where a.order_id=o.id::text)
    limit 1;
    if v_order.id is null then
      raise notice 'Funded checkout proof skipped: no order with two live auth parties and no allocation.';
      return;
    end if;
    select coalesce(max(version),0)+200 into v_version from public.order_quotes where order_id=v_order.id;
    insert into public.order_quotes (
      order_id,version,status,change_kind,currency,subtotal_amount,tax_amount,
      platform_fee_amount,delivery_fee_amount,total_amount,completion_date,
      created_by,created_by_role,fabric_funding_policy_version,fabric_source_snapshot,
      tailoring_amount,fabric_allowance_amount,fabric_allowance_currency,
      fabric_allowance_coverage,fabric_sourcing_assumptions,pricing_version
    ) values (
      v_order.id,v_version,'ACCEPTED','TAILOR_CORRECTION','USD',10000,800,500,1200,12500,
      now()+interval '30 days',v_order.tailor_id::uuid,'TAILOR','fabric-funding-2026-08-01-v1',
      'TAILOR_SOURCES',7000,3000,'USD','["FABRIC","LINING"]'::jsonb,
      'Six yards of cotton and a matching lining.',1
    ) returning * into v_quote;
    insert into public.order_fabric_funding_allocations (
      order_id,quote_id,quote_version,customer_id,tailor_id,fabric_source,currency,
      seller_subtotal_amount,tailoring_amount,base_allowance_amount,coverage,
      sourcing_assumptions,policy_version,pricing_version
    ) values (
      v_order.id,v_quote.id,v_quote.version,v_order.customer_id,v_order.tailor_id,
      'TAILOR_SOURCES','USD',10000,7000,3000,'["FABRIC","LINING"]'::jsonb,
      'Six yards of cotton and a matching lining.','fabric-funding-2026-08-01-v1',1
    );
    v_reservation:=public.create_funded_commercial_pricing_reservation(
      'verify-funded-checkout:'||v_payment_id,v_order.customer_id::uuid,v_order.id,v_quote.id,
      'INITIAL_ORDER','USD',10000,500,800,1200,12500,'Illinois','ZIPTAX',false,
      jsonb_build_object('currency','USD','subtotalAmount',10000,'platformFeeAmount',500,
        'taxAmount',800,'shippingAmount',1200,'totalAmount',12500,'taxJurisdiction','Illinois',
        'taxSource','ZIPTAX','taxFallback',false,'fabricFundingPolicyVersion','fabric-funding-2026-08-01-v1',
        'fabricSource','TAILOR_SOURCES','tailoringAmount',7000,'fabricAllowanceAmount',3000,
        'fabricAllowanceCoverage',jsonb_build_array('FABRIC','LINING'),
        'fabricSourcingAssumptions','Six yards of cotton and a matching lining.'),
      gen_random_uuid(),'fabric-funding-2026-08-01-v1','TAILOR_SOURCES',7000,3000,
      '["FABRIC","LINING"]'::jsonb,'Six yards of cotton and a matching lining.',now()+interval '15 minutes'
    );
    v_reservation_id:=(v_reservation->>'id')::uuid;
    v_reservation_token:=(v_reservation->>'reservationToken')::uuid;
    perform public.consume_commercial_pricing_reservation(v_reservation_token,v_order.customer_id::uuid,v_order.id);
    insert into public.order_payments (
      id,order_id,phase,provider,currency,amount,status,idempotency_key,provider_payment_id,
      policy_version,pricing_version,correlation_id,commercial_breakdown,
      pricing_reservation_id,confirmed_at,ledger_recorded_at
    ) values (
      v_payment_id,v_order.id,'INITIAL_ORDER','STRIPE','USD',12500,'SUCCEEDED',
      'verify-funded-payment:'||v_payment_id,'pi_verify_funded_'||v_payment_id,
      'commercial-2026-07-31-v1',1,(v_reservation->>'correlationId')::uuid,
      jsonb_build_object('currency','USD','subtotalAmount',10000,'platformFeeAmount',500,
        'taxAmount',800,'shippingAmount',1200,'totalAmount',12500,'taxJurisdiction','Illinois',
        'taxSource','ZIPTAX','taxFallback',false,'fabricFundingPolicyVersion','fabric-funding-2026-08-01-v1',
        'fabricSource','TAILOR_SOURCES','tailoringAmount',7000,'fabricAllowanceAmount',3000,
        'fabricAllowanceCoverage',jsonb_build_array('FABRIC','LINING'),
        'fabricSourcingAssumptions','Six yards of cotton and a matching lining.'),
      v_reservation_id,now(),now()
    );
    v_ledger_id:=public.post_commercial_ledger_transaction(
      'verify-funded-ledger:'||v_payment_id,'CAPTURE','INITIAL_ORDER',v_order.id,v_payment_id,
      'commercial-2026-07-31-v1',1,(v_reservation->>'correlationId')::uuid,
      'pi_verify_funded_'||v_payment_id,
      jsonb_build_array(
        jsonb_build_object('accountCode','PROVIDER_CLEARING','accountScope','STRIPE','direction','DEBIT','amount',12500,'currency','USD'),
        jsonb_build_object('accountCode','TAILOR_ENTITLEMENT','accountScope',v_order.id,'direction','CREDIT','amount',7000,'currency','USD'),
        jsonb_build_object('accountCode','MATERIAL_ADVANCE_LIABILITY','accountScope','order-fabric-allowance','direction','CREDIT','amount',3000,'currency','USD'),
        jsonb_build_object('accountCode','DRAPEON_REVENUE','accountScope','platform','direction','CREDIT','amount',500,'currency','USD'),
        jsonb_build_object('accountCode','TAX_LIABILITY','accountScope','Illinois','direction','CREDIT','amount',800,'currency','USD'),
        jsonb_build_object('accountCode','FULFILLMENT_LIABILITY','accountScope',v_order.id,'direction','CREDIT','amount',1200,'currency','USD')
      ),'{}'::jsonb,null,null,'SYSTEM','USD',12500,'USD',12500,1,0
    );
    select * into v_allocation from public.fund_order_fabric_allocation_for_payment(v_payment_id);
    if v_allocation.status <> 'FUNDED' or v_allocation.funded_amount <> 3000 then raise exception 'Funded allocation did not match the provider-confirmed liability.'; end if;
    select * into v_receipt from public.issue_initial_order_receipt(v_payment_id);
    if v_receipt.ledger_transaction_id <> v_ledger_id or v_receipt.tailoring_amount <> 7000
      or v_receipt.fabric_allowance_amount <> 3000 or v_receipt.protected_tailor_amount <> 7000 then
      raise exception 'Funded receipt did not preserve the accepted allocation.';
    end if;
    raise exception 'ROLLBACK_FUNDED_QUOTE_CHECKOUT_PROOF';
  exception when others then
    if sqlerrm <> 'ROLLBACK_FUNDED_QUOTE_CHECKOUT_PROOF' then raise; end if;
  end;
  raise notice 'Funded quote, pricing reservation, ledger isolation, allocation funding, and immutable receipt proof passed; synthetic rows rolled back.';
end;
$verification$;
