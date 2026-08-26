-- A physical transit state must never exist without a recorded custody handoff.
-- Existing inconsistent runs remain recoverable by recording acceptance or
-- collection proof; future transit updates may establish custody when they
-- carry evidence themselves.

do $$
declare
  v_function_oid oid;
  v_definition text;
  v_old_guard text := 'if p_event_type=''DELIVERED'' and v_run.custody_accepted_at is null then raise exception ''Trusted custody proof is required before delivery.''; end if;';
  v_new_guard text := 'if p_event_type in (''AT_HUB'',''IN_TRANSIT'',''OUT_FOR_DELIVERY'',''DELIVERY_ATTEMPTED'') and v_run.custody_accepted_at is null and (jsonb_typeof(coalesce(p_evidence_media,''[]''::jsonb)) <> ''array'' or jsonb_array_length(coalesce(p_evidence_media,''[]''::jsonb))=0) then raise exception ''Trusted custody proof is required before tracking transit.''; end if;
  if p_event_type=''DELIVERED'' and v_run.custody_accepted_at is null then raise exception ''Trusted custody proof is required before delivery.''; end if;';
  v_old_assignment text := 'custody_accepted_at=case when p_event_type in (''CARRIER_ACCEPTED'',''COLLECTED'') then coalesce(custody_accepted_at,p_occurred_at,now()) else custody_accepted_at end,';
  v_new_assignment text := 'custody_accepted_at=case when p_event_type in (''CARRIER_ACCEPTED'',''COLLECTED'') or (p_event_type in (''AT_HUB'',''IN_TRANSIT'',''OUT_FOR_DELIVERY'',''DELIVERY_ATTEMPTED'') and jsonb_typeof(coalesce(p_evidence_media,''[]''::jsonb))=''array'' and jsonb_array_length(coalesce(p_evidence_media,''[]''::jsonb))>0) then coalesce(custody_accepted_at,p_occurred_at,now()) else custody_accepted_at end,';
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
  if position(v_old_guard in v_definition) = 0 then
    raise exception 'record_order_fulfillment_event does not contain the expected custody guard';
  end if;
  if position(v_old_assignment in v_definition) = 0 then
    raise exception 'record_order_fulfillment_event does not contain the expected custody assignment';
  end if;

  execute replace(replace(v_definition, v_old_guard, v_new_guard), v_old_assignment, v_new_assignment);
end;
$$;
