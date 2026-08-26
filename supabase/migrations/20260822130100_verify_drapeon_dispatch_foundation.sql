do $$
declare
  v_count integer;
begin
  select count(*) into v_count from information_schema.tables
  where table_schema='public' and table_name in (
    'order_fulfillment_runs','order_fulfillment_parcels',
    'order_fulfillment_events','order_fulfillment_internal_notes'
  );
  if v_count <> 4 then raise exception 'Drapeon Dispatch tables are incomplete.'; end if;

  if not exists(select 1 from pg_proc where proname='record_order_fulfillment_quote') then
    raise exception 'Dispatch quote RPC is missing.';
  end if;
  if not exists(select 1 from pg_proc where proname='record_order_fulfillment_event') then
    raise exception 'Dispatch event RPC is missing.';
  end if;
  if not exists(select 1 from pg_proc where proname='decide_order_fulfillment_quote') then
    raise exception 'Dispatch customer-decision RPC is missing.';
  end if;
  if not exists(select 1 from pg_trigger where tgname='order_fulfillment_events_append_only') then
    raise exception 'Dispatch event append-only trigger is missing.';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_fulfillment_events_event_type_check'
      and pg_get_constraintdef(oid) like '%DISPATCH_OPTION_DECLINED%'
  ) then
    raise exception 'Dispatch decline outcome is missing from the fulfillment event contract.';
  end if;
end $$;
