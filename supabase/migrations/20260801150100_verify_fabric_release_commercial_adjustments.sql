do $$ begin
  if to_regclass('public.fabric_release_adjustment_links') is null then raise exception 'fabric release adjustment links missing'; end if;
  if to_regprocedure('public.create_fabric_release_commercial_adjustment(text,uuid,text,text,integer,currency,text,text,text)') is null then raise exception 'fabric release adjustment creator missing'; end if;
  if to_regprocedure('public.activate_paid_fabric_release_adjustment(uuid)') is null then raise exception 'paid fabric adjustment activation missing'; end if;
end $$;
