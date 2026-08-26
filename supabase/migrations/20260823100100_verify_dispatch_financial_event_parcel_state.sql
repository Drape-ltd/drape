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

  if position('p_event_type in (''SHORTFALL_PAID'',''RECONCILED'') then v_parcel.status' in v_definition) = 0 then
    raise exception 'dispatch financial events still mutate parcel status';
  end if;
end;
$$;
