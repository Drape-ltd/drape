-- A pre-booking delivery -> pickup reversal changes the method and stage in
-- the same order update. Ensure that transition can never commit a pickup-
-- ready order without a fresh handoff credential.

create or replace function public.ensure_pickup_collection_credential()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code_bytes bytea;
begin
  if new.delivery_method = 'LOCAL_COLLECTION'
    and new.stage = 'READY_FOR_COLLECTION'
    and (
      nullif(trim(coalesce(new.collection_code, '')), '') is null
      or coalesce(new.collection_code_used, false)
      or new.collection_code_expiry is null
      or new.collection_code_expiry <= now()
    ) then
    v_code_bytes := extensions.gen_random_bytes(2);
    new.collection_code := lpad(
      (1000 + ((get_byte(v_code_bytes, 0) * 256 + get_byte(v_code_bytes, 1)) % 9000))::text,
      4,
      '0'
    );
    new.collection_code_expiry := now() + interval '24 hours';
    new.collection_code_used := false;
    new.collection_code_attempts := 0;
    new.collection_code_last_attempt_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_ensure_pickup_collection_credential on public.orders;
create trigger zz_ensure_pickup_collection_credential
before insert or update of delivery_method, stage, collection_code, collection_code_expiry on public.orders
for each row execute function public.ensure_pickup_collection_credential();

-- Repair pickup-ready rows produced by the earlier split transition. This is
-- idempotent and does not rotate a still-valid unused credential.
update public.orders
set collection_code = collection_code,
    updated_at = now()
where delivery_method = 'LOCAL_COLLECTION'
  and stage = 'READY_FOR_COLLECTION'
  and (
    nullif(trim(coalesce(collection_code, '')), '') is null
    or coalesce(collection_code_used, false)
    or collection_code_expiry is null
    or collection_code_expiry <= now()
  );

-- The reversible-pickup RPC was deployed before credential generation moved
-- into the order transition. Keep its audit payload truthful without making
-- callers responsible for reproducing the credential rule.
create or replace function public.sync_pickup_selected_credential_audit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_active_credential boolean := false;
begin
  if new.event_type = 'PICKUP_SELECTED' then
    select
      nullif(trim(coalesce(o.collection_code, '')), '') is not null
      and not coalesce(o.collection_code_used, false)
      and o.collection_code_expiry > now()
    into v_has_active_credential
    from public.orders o
    where o.id::text = new.order_id::text;

    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
      'freshPickupCredentialIssued', coalesce(v_has_active_credential, false)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_pickup_selected_credential_audit on public.order_fulfillment_events;
create trigger sync_pickup_selected_credential_audit
before insert on public.order_fulfillment_events
for each row execute function public.sync_pickup_selected_credential_audit();

-- Historical fulfillment events remain append-only. Existing pickup-ready
-- orders are repaired above; newly inserted PICKUP_SELECTED events receive
-- the authoritative issuance flag through the trigger.
