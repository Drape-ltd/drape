-- Complete the uuid/text compatibility boundary for writes and party checks
-- that production lint can see only against the legacy core schema.

do $$
declare
  r record;
  v_definition text;
  v_repaired text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'create_customer_concern_case',
        'reserve_order_benefit',
        'prepare_order_tip',
        'record_order_fulfillment_event',
        'decide_order_fulfillment_quote',
        'prepare_material_unused_value_refund'
      ])
  loop
    v_definition := pg_get_functiondef(r.oid);
    v_repaired := v_definition;

    v_repaired := replace(
      v_repaired,
      'values (p_order_id, p_customer_id, p_reason_code, trim(p_description), now(), now())',
      'values (v_order.id, p_customer_id, p_reason_code, trim(p_description), now(), now())'
    );
    v_repaired := replace(v_repaired, 'v_order.customer_id<>p_customer_id::text', 'v_order.customer_id::text<>p_customer_id::text');
    v_repaired := replace(v_repaired, 'v_order.customer_id <> p_customer_id::text', 'v_order.customer_id::text <> p_customer_id::text');
    v_repaired := replace(v_repaired, 'extensions.extensions.gen_random_bytes(2)', 'extensions.gen_random_bytes(2)');
    v_repaired := replace(v_repaired, 'where order_id=v_advance.order_id', 'where order_id::text=v_advance.order_id::text');
    v_repaired := replace(v_repaired, 'where order_id = v_advance.order_id', 'where order_id::text = v_advance.order_id::text');
    v_repaired := replace(
      v_repaired,
      'values(\n        v_run.order_id,',
      'values(\n        (select id from public.orders where id::text=v_run.order_id::text),'
    );

    if v_repaired is distinct from v_definition then
      execute v_repaired;
    end if;
  end loop;
end
$$;

