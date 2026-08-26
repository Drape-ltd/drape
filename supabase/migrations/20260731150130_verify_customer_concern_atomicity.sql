-- Development-safe live-contract proof. This exercises the authoritative RPC
-- against a real eligible order, then rolls back every concern-side effect.

do $verification$
declare
  v_order public.orders%rowtype;
  v_result jsonb;
  v_retry jsonb;
  v_case_id uuid;
  v_rejected boolean := false;
begin
  begin
    select o.* into v_order
    from public.orders o
    where o.stage::text in (
      'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING',
      'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION'
    )
      and not exists (select 1 from public.disputes d where d.order_id = o.id)
    order by o.created_at desc
    limit 1;

    if v_order.id is null then
      raise exception 'Atomic concern verification requires one eligible development order without a concern.';
    end if;

    v_result := public.create_customer_concern_case(
      'migration-dry-run:atomic-concern:' || v_order.id,
      v_order.id,
      v_order.customer_id::uuid,
      'OTHER',
      'Synthetic concern used only to verify atomic development behavior.',
      'OPS_HELP',
      'QUALITY_CONCERN',
      gen_random_uuid()
    );
    v_case_id := (v_result->>'caseId')::uuid;

    v_retry := public.create_customer_concern_case(
      'migration-dry-run:atomic-concern:' || v_order.id,
      v_order.id,
      v_order.customer_id::uuid,
      'OTHER',
      'Synthetic concern used only to verify atomic development behavior.',
      'OPS_HELP',
      'QUALITY_CONCERN',
      gen_random_uuid()
    );

    if (v_retry->>'caseId')::uuid <> v_case_id or (v_retry->>'duplicate')::boolean is not true then
      raise exception 'Idempotent concern retry did not return the original case.';
    end if;
    if (select stage::text from public.orders where id = v_order.id) <> 'IN_DISPUTE' then
      raise exception 'Atomic concern did not pause the order.';
    end if;
    if (select count(*) from public.disputes where order_id = v_order.id) <> 1 then
      raise exception 'Atomic concern did not create exactly one compatibility dispute.';
    end if;
    if (select count(*) from public.financial_case_events where case_id = v_case_id) <> 1 then
      raise exception 'Atomic concern did not append exactly one opening event.';
    end if;
    if (select count(*) from public.financial_case_evidence where case_id = v_case_id) <> 3 then
      raise exception 'Atomic concern did not capture the three source-reference snapshots.';
    end if;

    begin
      perform public.create_customer_concern_case(
        'migration-dry-run:atomic-concern:' || v_order.id,
        v_order.id,
        v_order.customer_id::uuid,
        'OTHER',
        'A changed claim must not reuse the same idempotency key.',
        'FULL_REFUND',
        'QUALITY_CONCERN',
        gen_random_uuid()
      );
    exception when others then
      v_rejected := true;
    end;
    if not v_rejected then raise exception 'Changed concern retry reused an existing idempotency key.'; end if;

    raise exception 'CUSTOMER_CONCERN_ATOMICITY_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'CUSTOMER_CONCERN_ATOMICITY_VERIFICATION_ROLLBACK' then raise; end if;
  end;

  raise notice 'Atomic customer-concern verification passed; all live-order changes rolled back.';
end;
$verification$;
