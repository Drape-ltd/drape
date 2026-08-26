do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='decide_order_fulfillment_quote'
      and pg_get_functiondef(p.oid) like '%freshPickupCredentialIssued%'
      and pg_get_functiondef(p.oid) like '%QUOTE_REQUIRED%'
      and pg_get_functiondef(p.oid) like '%SWITCH_TO_PICKUP%'
  ) then
    raise exception 'Dispatch pickup recovery contract is not installed.';
  end if;
end $$;
