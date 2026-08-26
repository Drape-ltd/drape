do $$
begin
  if to_regprocedure('public.request_order_fulfillment_method_change_with_details(text,uuid,text,text,text,text,text,text,text,text,text,text)') is null then
    raise exception 'Atomic dispatch delivery-details function is missing';
  end if;
  if has_function_privilege('authenticated', 'public.request_order_fulfillment_method_change_with_details(text,uuid,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE') then
    raise exception 'Authenticated clients must not invoke the atomic dispatch method-change RPC directly';
  end if;
end;
$$;
