-- Rollback-only proof for funded fabric allocation section 1.
do $verification$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_version integer;
  v_failed boolean;
  v_transaction_id uuid;
begin
  begin
    select order_row.* into v_order
    from public.orders order_row
    join auth.users tailor_user on tailor_user.id::text = order_row.tailor_id::text
    where not exists (
      select 1
      from public.order_fabric_funding_allocations allocation
      where allocation.order_id = order_row.id::text
    )
    limit 1;

    if v_order.id is null then
      raise exception 'Fabric funding verification requires one order with a live tailor auth user.';
    end if;

    select coalesce(max(version), 0) + 100 into v_version
    from public.order_quotes
    where order_id::text = v_order.id::text;

    insert into public.order_quotes (
      order_id, version, status, change_kind, currency, subtotal_amount,
      tax_amount, platform_fee_amount, delivery_fee_amount, total_amount,
      completion_date, created_by, created_by_role,
      fabric_funding_policy_version, fabric_source_snapshot,
      tailoring_amount, fabric_allowance_amount, fabric_allowance_currency,
      fabric_allowance_coverage, fabric_sourcing_assumptions, pricing_version
    ) values (
      v_order.id, v_version, 'DECLINED', 'TAILOR_CORRECTION',
      coalesce(v_order.currency::text, v_order.quoted_currency, 'USD'),
      10000, 0, 0, 0, 10000, now() + interval '30 days',
      v_order.tailor_id::uuid, 'TAILOR',
      'fabric-funding-2026-08-01-v1', 'TAILOR_SOURCES',
      7000, 3000, coalesce(v_order.currency, v_order.quoted_currency::currency, 'USD'::currency),
      '["FABRIC","LINING"]'::jsonb,
      'Six yards of cotton with matching lining.', 1
    ) returning * into v_quote;

    insert into public.order_fabric_funding_allocations (
      order_id, quote_id, quote_version, customer_id, tailor_id,
      fabric_source, currency, seller_subtotal_amount, tailoring_amount,
      base_allowance_amount, coverage, sourcing_assumptions,
      policy_version, pricing_version
    ) values (
      v_order.id, v_quote.id, v_quote.version, v_order.customer_id::text,
      v_order.tailor_id::text, 'TAILOR_SOURCES', v_quote.currency::currency,
      v_quote.subtotal_amount, v_quote.tailoring_amount,
      v_quote.fabric_allowance_amount, v_quote.fabric_allowance_coverage,
      v_quote.fabric_sourcing_assumptions,
      v_quote.fabric_funding_policy_version, v_quote.pricing_version
    );

    update public.order_fabric_funding_allocations
    set funded_amount = 3000,
        released_amount = 2000,
        refunded_amount = 1000,
        status = 'RECONCILIATION_REQUIRED'
    where order_id = v_order.id::text;

    v_failed := false;
    begin
      update public.order_fabric_funding_allocations
      set released_amount = 2001
      where order_id = v_order.id::text;
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Fabric liability allowed release plus refund above funded value.';
    end if;

    v_failed := false;
    begin
      update public.order_fabric_funding_allocations
      set base_allowance_amount = 3001
      where order_id = v_order.id::text;
    exception when others then
      if sqlerrm like 'FABRIC_FUNDING_ALLOCATION_IDENTITY_IS_IMMUTABLE%' then
        v_failed := true;
      else
        raise;
      end if;
    end;
    if not v_failed then
      raise exception 'Locked fabric allocation identity was mutable.';
    end if;

    v_failed := false;
    begin
      insert into public.order_quotes (
        order_id, version, status, change_kind, currency, subtotal_amount,
        total_amount, completion_date, created_by, created_by_role,
        fabric_funding_policy_version, fabric_source_snapshot,
        tailoring_amount, fabric_allowance_amount, fabric_allowance_currency,
        fabric_allowance_coverage, fabric_sourcing_assumptions
      ) values (
        v_order.id, v_version + 1, 'DECLINED', 'TAILOR_CORRECTION', v_quote.currency,
        10000, 10000, now() + interval '30 days', v_order.tailor_id::uuid, 'TAILOR',
        'fabric-funding-2026-08-01-v1', 'TAILOR_SOURCES',
        9000, 500, v_quote.currency::currency, '["FABRIC"]'::jsonb,
        'This deliberately mismatches the subtotal.'
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'A hidden or mismatched fabric quote allocation was accepted.';
    end if;

    v_failed := false;
    begin
      insert into public.commercial_pricing_reservations (
        idempotency_key, request_hash, purpose, currency, subtotal_amount,
        total_amount, tax_source, tax_fallback, expires_at,
        fabric_funding_policy_version, fabric_source_snapshot,
        tailoring_amount, fabric_allowance_amount,
        fabric_allowance_coverage, fabric_sourcing_assumptions
      ) values (
        'fabric-foundation-invalid:' || gen_random_uuid()::text, 'verification',
        'INITIAL_ORDER', v_quote.currency::currency, 10000, 10000,
        'NOT_APPLICABLE', false, now() + interval '15 minutes',
        'fabric-funding-2026-08-01-v1', 'CUSTOMER_SUPPLIES',
        9000, 1000, '[]'::jsonb, null
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Customer-supplied fabric reserved a material allowance.';
    end if;

    v_transaction_id := public.post_commercial_ledger_transaction(
      'fabric-foundation-ledger:' || gen_random_uuid()::text,
      'CAPTURE', 'INITIAL_ORDER', v_order.id, null,
      'commercial-2026-07-31-v1', 1, gen_random_uuid(), 'verification',
      jsonb_build_array(
        jsonb_build_object('accountCode','PROVIDER_CLEARING','accountScope','provider','direction','DEBIT','amount',10000,'currency',v_quote.currency),
        jsonb_build_object('accountCode','TAILOR_ENTITLEMENT','accountScope','order','direction','CREDIT','amount',7000,'currency',v_quote.currency),
        jsonb_build_object('accountCode','MATERIAL_ADVANCE_LIABILITY','accountScope','order-fabric-allowance','direction','CREDIT','amount',3000,'currency',v_quote.currency)
      ),
      jsonb_build_object('fabricFundingPolicyVersion','fabric-funding-2026-08-01-v1'),
      null
    );
    set constraints commercial_ledger_entries_balance_guard immediate;
    set constraints commercial_ledger_entries_balance_guard deferred;

    if not exists (
      select 1 from public.commercial_ledger_entries
      where transaction_id = v_transaction_id
        and account_code = 'MATERIAL_ADVANCE_LIABILITY'
        and amount = 3000
    ) then
      raise exception 'Initial capture did not preserve the fabric liability allocation.';
    end if;

    raise exception 'ROLLBACK_FABRIC_FUNDING_FOUNDATION_PROOF';
  exception when others then
    if sqlerrm <> 'ROLLBACK_FABRIC_FUNDING_FOUNDATION_PROOF' then
      raise;
    end if;
  end;

  raise notice 'Fabric funding section 1 quote split, legacy boundary, immutable allocation, balance cap, and ledger isolation verification passed; synthetic rows rolled back.';
end;
$verification$;
