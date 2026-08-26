do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_material_advances' and column_name='funding_source') then
    raise exception 'funding_source is missing';
  end if;
  if to_regprocedure('public.create_funded_fabric_release_claim(text,uuid,text,text,integer,currency,text,text,text,text)') is null then
    raise exception 'funded fabric claim RPC is missing';
  end if;
  if to_regprocedure('public.record_funded_fabric_provider_outcome(uuid,text,text,text,jsonb)') is null then
    raise exception 'provider outcome RPC is missing';
  end if;
end $$;
