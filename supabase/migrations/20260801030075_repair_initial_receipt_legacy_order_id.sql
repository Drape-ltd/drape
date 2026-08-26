-- Keep receipt issuance compatible with production databases whose legacy orders
-- primary key is UUID while newer commercial contracts use text order identifiers.
create or replace function public.issue_initial_order_receipt(p_payment_id uuid)
returns public.commercial_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.order_payments%rowtype;
  v_reservation public.commercial_pricing_reservations%rowtype;
  v_order public.orders%rowtype;
  v_ledger public.commercial_ledger_transactions%rowtype;
  v_receipt public.commercial_receipts%rowtype;
  v_receipt_number text;
  v_consultation_credit integer := 0;
  v_promotion integer := 0;
begin
  select * into v_receipt
  from public.commercial_receipts
  where payment_id = p_payment_id;
  if v_receipt.id is not null then return v_receipt; end if;

  select * into v_payment
  from public.order_payments
  where id = p_payment_id
  for update;
  if v_payment.id is null then raise exception 'Payment was not found.'; end if;
  if v_payment.phase::text <> 'INITIAL_ORDER' or v_payment.status::text not in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED') then
    raise exception 'Only a captured initial-order payment can issue a receipt.';
  end if;
  if v_payment.pricing_reservation_id is null or v_payment.ledger_recorded_at is null then
    raise exception 'The captured payment is missing its pricing reservation or ledger outcome.';
  end if;

  select * into v_reservation
  from public.commercial_pricing_reservations
  where id = v_payment.pricing_reservation_id;
  if v_reservation.id is null or v_reservation.status <> 'CONSUMED' then
    raise exception 'The payment pricing reservation was not consumed.';
  end if;
  if v_reservation.total_amount <> v_payment.amount or v_reservation.currency <> v_payment.currency then
    raise exception 'The captured payment does not match its pricing reservation.';
  end if;

  select * into v_order from public.orders where id::text = v_payment.order_id::text;
  if v_order.id is null then raise exception 'The receipt order was not found.'; end if;

  select * into v_ledger
  from public.commercial_ledger_transactions
  where payment_id = v_payment.id and transaction_kind = 'CAPTURE';
  if v_ledger.id is null then raise exception 'The captured payment ledger transaction was not found.'; end if;

  v_consultation_credit := greatest(coalesce((v_reservation.breakdown ->> 'consultationCreditAmount')::integer, 0), 0);
  v_promotion := greatest(coalesce((v_reservation.breakdown ->> 'promotionAmount')::integer, 0), 0);
  v_receipt_number := 'DRP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.commercial_receipt_number_seq')::text, 8, '0');

  insert into public.commercial_receipts (
    receipt_number, order_id, order_reference, payment_id, pricing_reservation_id,
    ledger_transaction_id, quote_id, customer_id, tailor_id, purpose, provider,
    provider_reference, currency, subtotal_amount, consultation_credit_amount,
    promotion_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount,
    tax_jurisdiction, tax_source, protected_tailor_amount, policy_version,
    pricing_version, correlation_id, paid_at
  ) values (
    v_receipt_number, v_order.id::text, coalesce(nullif(v_order.reference, ''), v_order.id::text),
    v_payment.id, v_reservation.id, v_ledger.id, v_reservation.quote_id,
    v_order.customer_id, v_order.tailor_id, 'INITIAL_ORDER', v_payment.provider,
    v_payment.provider_payment_id, v_reservation.currency, v_reservation.subtotal_amount,
    v_consultation_credit, v_promotion, v_reservation.platform_fee_amount,
    v_reservation.tax_amount, v_reservation.shipping_amount, v_reservation.total_amount,
    v_reservation.tax_jurisdiction, v_reservation.tax_source,
    v_reservation.subtotal_amount, v_payment.policy_version, v_payment.pricing_version,
    v_payment.correlation_id, coalesce(v_payment.confirmed_at, now())
  )
  on conflict (payment_id) do nothing;

  select * into v_receipt from public.commercial_receipts where payment_id = p_payment_id;
  return v_receipt;
end;
$$;

revoke all on function public.issue_initial_order_receipt(uuid) from public, anon, authenticated;
grant execute on function public.issue_initial_order_receipt(uuid) to service_role;
