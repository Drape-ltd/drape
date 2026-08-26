-- Keep funded allocation and receipt finalization compatible with production
-- databases whose legacy order relations remain UUID while new commercial
-- records use the canonical text order identifier.
create or replace function public.fund_order_fabric_allocation_for_payment(p_payment_id uuid)
returns public.order_fabric_funding_allocations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_liability integer;
begin
  select * into v_payment
  from public.order_payments
  where id = p_payment_id
    and phase::text = 'INITIAL_ORDER'
    and status::text in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED');
  if v_payment.id is null or v_payment.ledger_recorded_at is null then
    raise exception 'PROVIDER_CONFIRMED_LEDGER_PAYMENT_REQUIRED';
  end if;

  select * into v_allocation
  from public.order_fabric_funding_allocations
  where order_id = v_payment.order_id::text
  for update;
  if v_allocation.id is null then raise exception 'FABRIC_FUNDING_ALLOCATION_NOT_FOUND'; end if;

  select coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0)::integer
  into v_liability
  from public.commercial_ledger_entries e
  join public.commercial_ledger_transactions t on t.id = e.transaction_id
  where t.payment_id = v_payment.id
    and t.transaction_kind = 'CAPTURE'
    and e.account_code = 'MATERIAL_ADVANCE_LIABILITY';
  if v_liability <> v_allocation.base_allowance_amount then
    raise exception 'FABRIC_LIABILITY_LEDGER_MISMATCH';
  end if;

  update public.order_fabric_funding_allocations
  set funded_amount = base_allowance_amount,
      funded_at = coalesce(funded_at, v_payment.confirmed_at, now()),
      status = case when base_allowance_amount = 0 then 'RECONCILED' else 'FUNDED' end
  where id = v_allocation.id
  returning * into v_allocation;
  return v_allocation;
end;
$$;

revoke all on function public.fund_order_fabric_allocation_for_payment(uuid) from public, anon, authenticated;
grant execute on function public.fund_order_fabric_allocation_for_payment(uuid) to service_role;

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
  select * into v_receipt from public.commercial_receipts where payment_id = p_payment_id;
  if v_receipt.id is not null then return v_receipt; end if;

  select * into v_payment from public.order_payments where id = p_payment_id for update;
  if v_payment.id is null or v_payment.phase::text <> 'INITIAL_ORDER'
    or v_payment.status::text not in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED') then
    raise exception 'Only a captured initial-order payment can issue a receipt.';
  end if;
  if v_payment.pricing_reservation_id is null or v_payment.ledger_recorded_at is null then
    raise exception 'The captured payment is missing its pricing reservation or ledger outcome.';
  end if;

  select * into v_reservation
  from public.commercial_pricing_reservations
  where id = v_payment.pricing_reservation_id;
  if v_reservation.id is null or v_reservation.status <> 'CONSUMED'
    or v_reservation.total_amount <> v_payment.amount
    or v_reservation.currency <> v_payment.currency then
    raise exception 'The captured payment does not match its consumed pricing reservation.';
  end if;

  select * into v_order from public.orders where id::text = v_payment.order_id::text;
  select * into v_ledger
  from public.commercial_ledger_transactions
  where payment_id = v_payment.id and transaction_kind = 'CAPTURE';
  if v_order.id is null or v_ledger.id is null then raise exception 'Receipt authority records are missing.'; end if;

  v_consultation_credit := greatest(coalesce((v_reservation.breakdown ->> 'consultationCreditAmount')::integer, 0), 0);
  v_promotion := greatest(coalesce((v_reservation.breakdown ->> 'promotionAmount')::integer, 0), 0);
  v_receipt_number := 'DRP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.commercial_receipt_number_seq')::text, 8, '0');

  insert into public.commercial_receipts (
    receipt_number, order_id, order_reference, payment_id, pricing_reservation_id, ledger_transaction_id,
    quote_id, customer_id, tailor_id, purpose, provider, provider_reference, currency, subtotal_amount,
    consultation_credit_amount, promotion_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount,
    tax_jurisdiction, tax_source, protected_tailor_amount, policy_version, pricing_version, correlation_id, paid_at,
    fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount, fabric_allowance_amount,
    fabric_allowance_coverage, fabric_sourcing_assumptions
  ) values (
    v_receipt_number, v_order.id::text, coalesce(nullif(v_order.reference, ''), v_order.id::text),
    v_payment.id, v_reservation.id, v_ledger.id, v_reservation.quote_id, v_order.customer_id, v_order.tailor_id,
    'INITIAL_ORDER', v_payment.provider, v_payment.provider_payment_id, v_reservation.currency,
    v_reservation.subtotal_amount, v_consultation_credit, v_promotion, v_reservation.platform_fee_amount,
    v_reservation.tax_amount, v_reservation.shipping_amount, v_reservation.total_amount,
    v_reservation.tax_jurisdiction, v_reservation.tax_source,
    coalesce(v_reservation.tailoring_amount, v_reservation.subtotal_amount), v_payment.policy_version,
    v_payment.pricing_version, v_payment.correlation_id, coalesce(v_payment.confirmed_at, now()),
    v_reservation.fabric_funding_policy_version, v_reservation.fabric_source_snapshot,
    v_reservation.tailoring_amount, v_reservation.fabric_allowance_amount,
    v_reservation.fabric_allowance_coverage, v_reservation.fabric_sourcing_assumptions
  ) on conflict (payment_id) do nothing;

  select * into v_receipt from public.commercial_receipts where payment_id = p_payment_id;
  return v_receipt;
end;
$$;

revoke all on function public.issue_initial_order_receipt(uuid) from public, anon, authenticated;
grant execute on function public.issue_initial_order_receipt(uuid) to service_role;
