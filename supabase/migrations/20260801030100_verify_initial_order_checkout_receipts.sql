-- Rollback-only proof for Implementation 6 receipt issuance.
do $$
declare
  v_order_id text;
  v_customer_id uuid;
  v_tailor_id uuid;
  v_payment_id uuid := gen_random_uuid();
  v_reservation jsonb;
  v_reservation_id uuid;
  v_token uuid;
  v_ledger_id uuid;
  v_receipt public.commercial_receipts%rowtype;
begin
  select o.id, o.customer_id::uuid, o.tailor_id::uuid
  into v_order_id, v_customer_id, v_tailor_id
  from public.orders o
  join auth.users customer_user on customer_user.id::text = o.customer_id::text
  join auth.users tailor_user on tailor_user.id::text = o.tailor_id::text
  where o.customer_id is not null and o.tailor_id is not null
  limit 1;
  if v_order_id is null then
    raise notice 'Implementation 6 receipt proof skipped: no order with two live auth parties.';
    return;
  end if;

  v_reservation := public.create_commercial_pricing_reservation(
    'verify-initial-receipt:' || v_payment_id::text, v_customer_id, v_order_id, null,
    'INITIAL_ORDER', 'USD', 10000, 500, 800, 1200, 12500,
    'Illinois', 'ZIPTAX', false, '{}'::jsonb, gen_random_uuid(), now() + interval '15 minutes'
  );
  v_reservation_id := (v_reservation ->> 'id')::uuid;
  v_token := (v_reservation ->> 'reservationToken')::uuid;
  perform public.consume_commercial_pricing_reservation(v_token, v_customer_id, v_order_id);

  insert into public.order_payments (
    id, order_id, phase, provider, currency, amount, status, idempotency_key,
    provider_payment_id, policy_version, pricing_version, correlation_id,
    commercial_breakdown, pricing_reservation_id, confirmed_at, ledger_recorded_at
  ) values (
    v_payment_id, v_order_id, 'INITIAL_ORDER', 'STRIPE', 'USD', 12500, 'SUCCEEDED',
    'verify-initial-receipt-payment:' || v_payment_id::text, 'pi_verify_' || v_payment_id::text,
    'commercial-2026-07-31-v1', 1, (v_reservation ->> 'correlationId')::uuid,
    jsonb_build_object('currency','USD','subtotalAmount',10000,'platformFeeAmount',500,'taxAmount',800,'shippingAmount',1200,'totalAmount',12500,'taxJurisdiction','Illinois','taxSource','ZIPTAX','taxFallback',false),
    v_reservation_id, now(), now()
  );

  v_ledger_id := public.post_commercial_ledger_transaction(
    'verify-initial-receipt-ledger:' || v_payment_id::text, 'CAPTURE', 'INITIAL_ORDER',
    v_order_id, v_payment_id, 'commercial-2026-07-31-v1', 1,
    (v_reservation ->> 'correlationId')::uuid, 'pi_verify_' || v_payment_id::text,
    jsonb_build_array(
      jsonb_build_object('accountCode','PROVIDER_CLEARING','accountScope','STRIPE','direction','DEBIT','amount',12500,'currency','USD'),
      jsonb_build_object('accountCode','TAILOR_ENTITLEMENT','accountScope',v_order_id,'direction','CREDIT','amount',10000,'currency','USD'),
      jsonb_build_object('accountCode','DRAPEON_REVENUE','accountScope','platform','direction','CREDIT','amount',500,'currency','USD'),
      jsonb_build_object('accountCode','TAX_LIABILITY','accountScope','Illinois','direction','CREDIT','amount',800,'currency','USD'),
      jsonb_build_object('accountCode','FULFILLMENT_LIABILITY','accountScope',v_order_id,'direction','CREDIT','amount',1200,'currency','USD')
    ), '{}'::jsonb, null, null, 'SYSTEM', 'USD', 12500, 'USD', 12500, 1, 0
  );

  select * into v_receipt from public.issue_initial_order_receipt(v_payment_id);
  if v_receipt.total_amount <> 12500 or v_receipt.ledger_transaction_id <> v_ledger_id then
    raise exception 'Implementation 6 receipt values do not match the locked capture.';
  end if;
  if (public.issue_initial_order_receipt(v_payment_id)).id <> v_receipt.id then
    raise exception 'Implementation 6 receipt issuance is not idempotent.';
  end if;

  begin
    update public.commercial_receipts set total_amount = 1 where id = v_receipt.id;
    raise exception 'Implementation 6 immutable receipt proof failed.';
  exception when others then
    if sqlerrm not like 'Commercial receipts are immutable%' then raise; end if;
  end;

  raise notice 'Implementation 6 receipt lock, ledger linkage, idempotency, and immutability verification passed.';
  raise exception using errcode = 'P0001', message = 'ROLLBACK_IMPLEMENTATION_6_RECEIPT_PROOF';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'ROLLBACK_IMPLEMENTATION_6_RECEIPT_PROOF' then
      raise notice 'Implementation 6 synthetic receipt rows rolled back.';
    else
      raise;
    end if;
end;
$$;
