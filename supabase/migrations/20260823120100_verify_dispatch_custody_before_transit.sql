do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_order_fulfillment_event';

  if v_definition is null
    or position('Trusted custody proof is required before tracking transit.' in v_definition) = 0
    or position('p_event_type in (''AT_HUB'',''IN_TRANSIT'',''OUT_FOR_DELIVERY'',''DELIVERY_ATTEMPTED'') and jsonb_typeof' in v_definition) = 0 then
    raise exception 'Dispatch custody-before-transit enforcement is missing';
  end if;
end;
$$;
