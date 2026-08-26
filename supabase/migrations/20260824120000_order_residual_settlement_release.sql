-- A reviewed partial refund can leave a closed order with two different
-- remaining liabilities: the tailor's residual work entitlement and a
-- separately protected fulfilment amount. Money Desk must derive this split;
-- an operator must never type the residual payout amount.

create or replace function public.derive_order_residual_settlement(
  p_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.order_payments%rowtype;
  v_resolution public.order_refund_resolutions%rowtype;
  v_refunded_tailor_work integer := 0;
  v_original_tailor_allocation integer;
  v_residual_tailor_entitlement integer;
  v_fulfilment_liability integer;
  v_payment_remaining integer;
  v_existing_release public.payouts%rowtype;
begin
  select * into v_order
  from public.orders
  where id::text = p_order_id;
  if not found then raise exception 'Order was not found.'; end if;

  select * into v_payment
  from public.order_payments
  where order_id::text = p_order_id
    and phase = 'INITIAL_ORDER'
    and status in ('SUCCEEDED', 'PARTIAL_REFUND')
  order by created_at desc
  limit 1;
  if not found then raise exception 'The settled order payment was not found.'; end if;

  select * into v_resolution
  from public.order_refund_resolutions
  where order_id = p_order_id
    and status = 'SUCCEEDED'
    and order_outcome = 'CLOSE_ORDER'
    and outcome_applied_at is not null
  order by updated_at desc
  limit 1;
  if not found then
    raise exception 'A completed close-order refund decision is required before residual settlement.';
  end if;

  select coalesce(sum(tailor_work_amount), 0)::integer
  into v_refunded_tailor_work
  from public.order_refund_resolutions
  where order_id = p_order_id and status = 'SUCCEEDED';

  v_original_tailor_allocation := coalesce(v_order.source_amount, 0);
  v_residual_tailor_entitlement := v_original_tailor_allocation - v_refunded_tailor_work;
  v_fulfilment_liability := greatest(
    coalesce(v_order.shipping_amount, 0),
    coalesce(v_order.fulfillment_fee, 0)
  );
  v_payment_remaining := coalesce(v_payment.amount, 0) - coalesce(v_payment.refunded_amount, 0);

  if v_order.stage::text <> 'COMPLETE' then
    raise exception 'The reviewed order must be closed before residual settlement.';
  end if;
  if exists (
    select 1 from public.disputes
    where order_id::text = p_order_id and status in ('OPEN', 'UNDER_REVIEW')
  ) then
    raise exception 'The order still has an open dispute.';
  end if;
  if v_original_tailor_allocation <= 0 or v_residual_tailor_entitlement <= 0 then
    raise exception 'No positive residual tailor entitlement remains.';
  end if;
  if v_payment.currency::text is distinct from v_order.currency::text then
    raise exception 'The payment and order currencies do not match.';
  end if;
  if v_payment_remaining <> v_residual_tailor_entitlement + v_fulfilment_liability then
    raise exception 'The remaining payment does not equal tailor entitlement plus fulfilment liability.';
  end if;

  select * into v_existing_release
  from public.payouts
  where order_id::text = p_order_id
    and payout_purpose = 'ORDER_EARNING'
    and status in ('PROCESSING', 'PAID')
  order by processed_at desc nulls last, created_at desc
  limit 1;
  if found then
    raise exception 'An order-earning payout is already processing or paid.';
  end if;

  return jsonb_build_object(
    'policyVersion', 'order-residual-settlement-v1',
    'orderId', v_order.id,
    'orderReference', v_order.reference,
    'sourcePaymentId', v_payment.id,
    'refundResolutionId', v_resolution.id,
    'currency', v_payment.currency,
    'provider', v_payment.provider,
    'originalTailorAllocation', v_original_tailor_allocation,
    'refundedTailorWork', v_refunded_tailor_work,
    'residualTailorEntitlement', v_residual_tailor_entitlement,
    'fulfillmentLiability', v_fulfilment_liability,
    'paymentRemaining', v_payment_remaining
  );
end;
$$;

create or replace function public.prepare_order_residual_settlement_release(
  p_money_desk_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_snapshot jsonb;
  v_transaction_id uuid;
  v_amount integer;
  v_fulfilment integer;
  v_currency public.currency;
  v_payment_id uuid;
begin
  select * into v_request
  from public.money_desk_requests
  where id = p_money_desk_request_id
  for update;
  if not found then raise exception 'Money Desk request was not found.'; end if;
  if v_request.action_type <> 'PAYOUT_RELEASE'
    or v_request.target_type <> 'ORDER_RESIDUAL_SETTLEMENT'
    or v_request.status <> 'EXECUTING'
    or v_request.order_id is null then
    raise exception 'The approved Money Desk request is not executing a residual order settlement.';
  end if;

  v_snapshot := public.derive_order_residual_settlement(v_request.order_id);
  v_amount := (v_snapshot->>'residualTailorEntitlement')::integer;
  v_fulfilment := (v_snapshot->>'fulfillmentLiability')::integer;
  v_currency := (v_snapshot->>'currency')::public.currency;
  v_payment_id := (v_snapshot->>'sourcePaymentId')::uuid;

  if v_request.amount is distinct from v_amount
    or v_request.currency is distinct from v_currency
    or v_request.target_id is distinct from v_request.order_id
    or v_request.action_payload->>'sourcePaymentId' is distinct from v_snapshot->>'sourcePaymentId'
    or v_request.action_payload->>'refundResolutionId' is distinct from v_snapshot->>'refundResolutionId'
    or (v_request.action_payload->>'residualTailorEntitlement')::integer is distinct from v_amount
    or (v_request.action_payload->>'fulfillmentLiability')::integer is distinct from v_fulfilment then
    raise exception 'The approved residual settlement snapshot no longer matches authoritative records.';
  end if;

  if v_fulfilment > 0 then
    v_transaction_id := public.post_commercial_ledger_transaction(
      'order-residual-settlement-reclass:' || v_request.order_id || ':' || v_payment_id::text,
      'ADJUSTMENT',
      'ORDER_RESIDUAL_SETTLEMENT_RECLASSIFICATION',
      v_request.order_id,
      v_payment_id,
      v_snapshot->>'policyVersion',
      1,
      v_request.correlation_id,
      null,
      jsonb_build_array(
        jsonb_build_object('accountCode','TAILOR_ENTITLEMENT','accountScope','order','direction','DEBIT','amount',v_fulfilment,'currency',v_currency),
        jsonb_build_object('accountCode','FULFILLMENT_LIABILITY','accountScope','order','direction','CREDIT','amount',v_fulfilment,'currency',v_currency)
      ),
      jsonb_build_object(
        'moneyDeskRequestId', v_request.id,
        'refundResolutionId', v_snapshot->>'refundResolutionId',
        'reason', 'Separate fulfilment liability before residual tailor settlement.'
      ),
      null, null, 'OPS', v_currency, v_fulfilment, v_currency, v_fulfilment, 1, 0
    );
  end if;

  return v_snapshot || jsonb_build_object(
    'moneyDeskRequestId', v_request.id,
    'ledgerReclassificationTransactionId', v_transaction_id
  );
end;
$$;

revoke all on function public.derive_order_residual_settlement(text) from public, anon, authenticated;
revoke all on function public.prepare_order_residual_settlement_release(uuid) from public, anon, authenticated;
grant execute on function public.derive_order_residual_settlement(text) to service_role;
grant execute on function public.prepare_order_residual_settlement_release(uuid) to service_role;
