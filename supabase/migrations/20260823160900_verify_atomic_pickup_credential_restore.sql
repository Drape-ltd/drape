do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'zz_ensure_pickup_collection_credential'
      and not tgisinternal
  ) then
    raise exception 'pickup credential restore trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'sync_pickup_selected_credential_audit'
      and not tgisinternal
  ) then
    raise exception 'pickup credential audit trigger is missing';
  end if;

  if exists (
    select 1
    from public.orders
    where delivery_method = 'LOCAL_COLLECTION'
      and stage = 'READY_FOR_COLLECTION'
      and (
        nullif(trim(coalesce(collection_code, '')), '') is null
        or coalesce(collection_code_used, false)
        or collection_code_expiry is null
        or collection_code_expiry <= now()
      )
  ) then
    raise exception 'pickup-ready order exists without a valid collection credential';
  end if;
end;
$$;
