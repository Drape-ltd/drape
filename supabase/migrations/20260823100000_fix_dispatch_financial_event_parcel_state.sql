-- Financial lifecycle events advance fulfillment funding without changing the
-- physical parcel location/status. The v1 recorder attempted to assign
-- SHORTFALL_PAID and RECONCILED to order_fulfillment_parcels.status even though
-- those are intentionally not parcel statuses, causing a provider-confirmed
-- payment to leave the dispatch run awaiting payment.

do $$
declare
  v_function_oid oid;
  v_definition text;
  v_old text := 'v_parcel_status:=case when p_event_type=''EXCEPTION_RECORDED'' then ''EXCEPTION'' else p_event_type end;';
  v_new text := 'v_parcel_status:=case when p_event_type in (''SHORTFALL_PAID'',''RECONCILED'') then v_parcel.status when p_event_type=''EXCEPTION_RECORDED'' then ''EXCEPTION'' else p_event_type end;';
begin
  select p.oid
  into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_order_fulfillment_event';

  if v_function_oid is null then
    raise exception 'record_order_fulfillment_event was not found';
  end if;

  v_definition := pg_get_functiondef(v_function_oid);
  if position(v_old in v_definition) = 0 then
    raise exception 'record_order_fulfillment_event does not contain the expected v1 parcel-state assignment';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
