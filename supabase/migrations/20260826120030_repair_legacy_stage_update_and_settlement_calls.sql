-- Keep current text-based commercial contracts compatible with older production
-- relations that still retain UUID order identifiers.
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
        'create_customer_concern_case',
        'record_order_fulfillment_event',
        'prepare_material_unused_value_refund'
      ])
  loop
    v_definition := pg_get_functiondef(r.oid);
    v_repaired := v_definition;

    if r.proname = 'create_customer_concern_case' then
      v_repaired := replace(
        v_repaired,
        'values (p_order_id, ''IN_DISPUTE'', ''Customer raised a concern for Drapeon review.'')',
        'values (v_order.id, ''IN_DISPUTE'', ''Customer raised a concern for Drapeon review.'')'
      );
    elsif r.proname = 'record_order_fulfillment_event' then
      v_repaired := replace(
        v_repaired,
        'v_run.order_id,',
        '(select id from public.orders where id::text = v_run.order_id::text),'
      );
    elsif r.proname = 'prepare_material_unused_value_refund' then
      v_repaired := replace(
        v_repaired,
        'public.initialize_order_settlement_plan(v_advance.order_id)',
        'public.initialize_order_settlement_plan(v_advance.order_id::text)'
      );
    end if;

    if v_repaired <> v_definition then
      execute v_repaired;
    else
      raise exception 'Expected compatibility target was not found in function %', r.proname;
    end if;
  end loop;
end
$$;
