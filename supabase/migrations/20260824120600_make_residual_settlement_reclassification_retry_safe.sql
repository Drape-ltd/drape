-- Reuse a previously-posted residual-settlement reclassification only after
-- proving that its immutable financial identity and balanced entries still
-- match the authoritative residual settlement. Request-specific audit data is
-- intentionally not rewritten on retries.

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
  v_transaction public.commercial_ledger_transactions%rowtype;
  v_transaction_id uuid;
  v_reclassification_key text;
  v_amount integer;
  v_fulfilment integer;
  v_currency public.currency;
  v_payment_id uuid;
  v_entry_count integer;
  v_tailor_debit_count integer;
  v_fulfilment_credit_count integer;
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
    v_reclassification_key := 'order-residual-settlement-reclass:' || v_request.order_id || ':' || v_payment_id::text;

    select * into v_transaction
    from public.commercial_ledger_transactions
    where idempotency_key = v_reclassification_key;

    if found then
      if v_transaction.transaction_kind <> 'ADJUSTMENT'
        or v_transaction.purpose <> 'ORDER_RESIDUAL_SETTLEMENT_RECLASSIFICATION'
        or v_transaction.order_id is distinct from v_request.order_id
        or v_transaction.payment_id is distinct from v_payment_id
        or v_transaction.policy_version is distinct from v_snapshot->>'policyVersion'
        or v_transaction.pricing_version <> 1
        or v_transaction.original_currency is distinct from v_currency
        or v_transaction.original_amount <> v_fulfilment
        or v_transaction.settlement_currency is distinct from v_currency
        or v_transaction.settlement_amount <> v_fulfilment
        or v_transaction.fx_rate <> 1
        or v_transaction.provider_fee_amount <> 0 then
        raise exception 'The existing residual-settlement reclassification does not match authoritative records.';
      end if;

      select
        count(*),
        count(*) filter (
          where account_code = 'TAILOR_ENTITLEMENT'
            and account_scope = 'order'
            and direction = 'DEBIT'
            and amount = v_fulfilment
            and currency = v_currency
        ),
        count(*) filter (
          where account_code = 'FULFILLMENT_LIABILITY'
            and account_scope = 'order'
            and direction = 'CREDIT'
            and amount = v_fulfilment
            and currency = v_currency
        )
      into v_entry_count, v_tailor_debit_count, v_fulfilment_credit_count
      from public.commercial_ledger_entries
      where transaction_id = v_transaction.id;

      if v_entry_count <> 2 or v_tailor_debit_count <> 1 or v_fulfilment_credit_count <> 1 then
        raise exception 'The existing residual-settlement reclassification entries are not the expected balanced pair.';
      end if;

      v_transaction_id := v_transaction.id;
    else
      v_transaction_id := public.post_commercial_ledger_transaction(
        v_reclassification_key,
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
  end if;

  return v_snapshot || jsonb_build_object(
    'moneyDeskRequestId', v_request.id,
    'ledgerReclassificationTransactionId', v_transaction_id
  );
end;
$$;

revoke all on function public.prepare_order_residual_settlement_release(uuid) from public, anon, authenticated;
grant execute on function public.prepare_order_residual_settlement_release(uuid) to service_role;
