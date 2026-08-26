-- Rollback-only proof for Implementation 11B persistence controls.

do $verification$
declare
  v_failed boolean := false;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'custom_order_brief_drafts'
      and column_name = 'fulfillment_fingerprint'
  ) then raise exception 'Draft fulfillment fingerprint is missing.'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'fulfillment_origin_snapshot'
  ) then raise exception 'Order fulfillment origin snapshot is missing.'; end if;

  begin
    insert into public.fulfillment_selection_events (
      customer_id,tailor_profile_id,event_type,method,status
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000001',
      'RESOLVED','LOCAL_DELIVERY','ELIGIBLE'
    );
  exception when foreign_key_violation then v_failed := true; end;
  if not v_failed then raise exception 'Fulfillment event accepted unknown parties.'; end if;

  if has_table_privilege('authenticated','public.fulfillment_selection_events','SELECT')
    or has_table_privilege('anon','public.fulfillment_selection_events','SELECT') then
    raise exception 'Client role can read internal fulfillment selection events.';
  end if;
  if not has_table_privilege('service_role','public.fulfillment_selection_events','SELECT') then
    raise exception 'Service role cannot read fulfillment selection events.';
  end if;

  raise notice 'Early fulfillment eligibility persistence verification passed.';
end;
$verification$;
