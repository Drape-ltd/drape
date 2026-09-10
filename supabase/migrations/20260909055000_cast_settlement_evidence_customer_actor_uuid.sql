-- Orders retain legacy text identifiers, while settlement evidence records the
-- authenticated customer as an auth.users UUID. Make that compatibility
-- boundary explicit so a customer-confirmed delivery can complete atomically.

create or replace function public.sync_settlement_evidence_from_order()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.commercial_policy_version = 'commercial-2026-07-31-v1'
    and new.customer_handoff_confirmed_at is not null
    and old.customer_handoff_confirmed_at is null then
    perform public.initialize_order_settlement_plan(new.id::text);

    if new.delivery_method = 'LOCAL_COLLECTION' and new.collection_code_used = true then
      perform public.record_order_settlement_evidence(
        new.id::text,
        'AUTHENTICATED_LOCAL_HANDOFF',
        'COLLECTION_CODE',
        new.customer_handoff_confirmed_at,
        new.collection_code,
        null,
        jsonb_build_object('confirmation_source', new.handoff_confirmation_source)
      );
    elsif new.delivery_method <> 'LOCAL_COLLECTION' then
      perform public.record_order_settlement_evidence(
        new.id::text,
        'VERIFIED_DELIVERY',
        'CUSTOMER_CONFIRMATION',
        new.customer_handoff_confirmed_at,
        null,
        nullif(new.customer_id::text, '')::uuid,
        jsonb_build_object('confirmation_source', new.handoff_confirmation_source)
      );
    end if;
  end if;

  return new;
end
$$;

comment on function public.sync_settlement_evidence_from_order() is
  'Creates staged-settlement evidence after a customer handoff confirmation, explicitly bridging legacy text order user ids to auth UUIDs.';
