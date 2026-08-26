-- Production historically stores core order identifiers as uuid while newer
-- commercial workflow tables and RPC contracts use canonical text IDs. Keep
-- storage and public RPC signatures intact, but make cross-generation
-- comparisons explicit so the same functions remain valid in both schemas.

do $$
declare
  r record;
  v_definition text;
  v_repaired text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'append_financial_case_evidence',
        'create_customer_concern_case',
        'initialize_order_settlement_plan',
        'refresh_order_settlement',
        'reserve_order_benefit',
        'prepare_order_tip',
        'create_funded_fabric_release_claim',
        'submit_fabric_candidate_v2',
        'prepare_material_unused_value_refund',
        'decide_fabric_candidate_v2',
        'mark_fabric_candidate_shortfall_paid_v2',
        'save_fabric_handoff_v2',
        'get_order_fabric_cutting_blockers_v2',
        'ensure_order_fulfillment_run',
        'record_order_fulfillment_event',
        'request_order_fulfillment_method_change',
        'decide_order_fulfillment_quote',
        'request_order_fulfillment_method_change_with_details'
      ])
  loop
    v_definition := pg_get_functiondef(r.oid);
    v_repaired := v_definition;

    -- Core order row lookups.
    v_repaired := replace(v_repaired, 'where id = p_order_id', 'where id::text = p_order_id::text');
    v_repaired := replace(v_repaired, 'where id=p_order_id', 'where id::text=p_order_id::text');
    v_repaired := replace(v_repaired, 'where id = v_case.order_id', 'where id::text = v_case.order_id::text');
    v_repaired := replace(v_repaired, 'where id=v_case.order_id', 'where id::text=v_case.order_id::text');
    v_repaired := replace(v_repaired, 'where id = v_run.order_id', 'where id::text = v_run.order_id::text');
    v_repaired := replace(v_repaired, 'where id=v_run.order_id', 'where id::text=v_run.order_id::text');

    -- Related order foreign keys may be uuid in the legacy production schema
    -- and text in newer installations. Casting both operands is safe in both.
    v_repaired := replace(v_repaired, 'order_id = p_order_id', 'order_id::text = p_order_id::text');
    v_repaired := replace(v_repaired, 'order_id=p_order_id', 'order_id::text=p_order_id::text');
    v_repaired := replace(v_repaired, 'order_id = v_candidate.order_id', 'order_id::text = v_candidate.order_id::text');
    v_repaired := replace(v_repaired, 'order_id=v_candidate.order_id', 'order_id::text=v_candidate.order_id::text');
    v_repaired := replace(v_repaired, 'v_request.order_id<>v_advance.order_id', 'v_request.order_id::text<>v_advance.order_id::text');
    v_repaired := replace(v_repaired, 'v_request.order_id <> v_advance.order_id', 'v_request.order_id::text <> v_advance.order_id::text');

    if v_repaired is distinct from v_definition then
      execute v_repaired;
    end if;
  end loop;
end
$$;

