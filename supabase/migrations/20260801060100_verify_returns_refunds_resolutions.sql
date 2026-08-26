do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='order_return_requests') then raise exception 'returns missing'; end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='order_return_shipment_events') then raise exception 'return shipment events missing'; end if;
 if not exists(select 1 from pg_policies where tablename='order_refund_resolutions' and policyname='refund_resolution_parties_read') then raise exception 'refund resolution RLS missing'; end if;
 if not exists(select 1 from pg_trigger where tgname='resolution_proposal_claim_immutable') then raise exception 'proposal claims are not immutable'; end if;
 if not exists(select 1 from pg_trigger where tgname='return_shipment_events_append_only') then raise exception 'shipment evidence is not append-only'; end if;
 if has_function_privilege('authenticated','public.create_order_return_request(text,uuid,text,text,text,integer,currency,text)','EXECUTE') then raise exception 'client must not bypass return action'; end if;
 if has_function_privilege('authenticated','public.propose_order_resolution(uuid,uuid,text,integer,currency,boolean,text,text,text)','EXECUTE') then raise exception 'client must not bypass proposal action'; end if;
 if has_function_privilege('authenticated','public.prepare_order_refund_resolution(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer)','EXECUTE') then raise exception 'client must not prepare refunds'; end if;
end $$;
