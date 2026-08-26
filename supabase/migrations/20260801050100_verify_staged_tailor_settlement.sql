do $$ begin
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='order_settlement_plans') then raise exception 'order_settlement_plans missing'; end if;
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='order_settlement_tranches') then raise exception 'order_settlement_tranches missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='order_settlement_evidence_append_only') then raise exception 'settlement evidence append-only trigger missing'; end if;
  if not exists(select 1 from pg_proc where proname='refresh_order_settlement') then raise exception 'refresh_order_settlement missing'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='order_settlement_tranches' and policyname='settlement_tranches_parties_read') then raise exception 'settlement tranche party RLS missing'; end if;
  if has_function_privilege('authenticated','public.record_order_settlement_evidence(text,text,text,timestamp with time zone,text,uuid,jsonb)','EXECUTE') then raise exception 'authenticated users must not record settlement evidence directly'; end if;
end $$;
