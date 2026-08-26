do $$
begin
  if to_regprocedure('public.prepare_ops_partial_refund_resolution(text,uuid,text,text,text,text,integer,currency,integer,integer,integer,integer,integer,integer,integer,integer,text,text,timestamptz,text,text,text,text,text,uuid)') is null then
    raise exception 'Ops reviewed partial-refund preparation function is missing.';
  end if;
  if has_function_privilege('authenticated', 'public.prepare_ops_partial_refund_resolution(text,uuid,text,text,text,text,integer,currency,integer,integer,integer,integer,integer,integer,integer,integer,text,text,timestamptz,text,text,text,text,text,uuid)', 'EXECUTE') then
    raise exception 'Authenticated clients must not prepare Ops partial refunds directly.';
  end if;
  if not exists(select 1 from storage.buckets where id='commercial-evidence' and public=false) then
    raise exception 'Ops refund evidence requires the private commercial-evidence bucket.';
  end if;
  raise notice 'Ops reviewed partial-refund evidence contract verification passed.';
end;
$$;
