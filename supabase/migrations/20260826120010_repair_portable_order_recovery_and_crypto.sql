-- Forward repair for installations where earlier compatibility migrations
-- were already recorded. Keep order lookups portable across uuid/text schemas
-- and qualify pgcrypto functions because extensions live outside public.

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
        'create_order_return_request',
        'propose_order_resolution',
        'decide_order_resolution',
        'decide_order_fulfillment_quote'
      ])
  loop
    v_definition := pg_get_functiondef(r.oid);
    v_repaired := v_definition;
    v_repaired := replace(v_repaired, 'where id_text=p_order_id', 'where id::text=p_order_id::text');
    v_repaired := replace(v_repaired, 'where id_text = p_order_id', 'where id::text = p_order_id::text');
    v_repaired := replace(v_repaired, 'where id_text=rr.order_id', 'where id::text=rr.order_id::text');
    v_repaired := replace(v_repaired, 'where id_text = rr.order_id', 'where id::text = rr.order_id::text');
    v_repaired := replace(v_repaired, 'where id_text=p.order_id', 'where id::text=p.order_id::text');
    v_repaired := replace(v_repaired, 'where id_text = p.order_id', 'where id::text = p.order_id::text');
    v_repaired := replace(v_repaired, 'gen_random_bytes(2)', 'extensions.gen_random_bytes(2)');
    v_repaired := replace(v_repaired, 'extensions.extensions.gen_random_bytes(2)', 'extensions.gen_random_bytes(2)');

    if v_repaired is distinct from v_definition then
      execute v_repaired;
    end if;
  end loop;
end
$$;

