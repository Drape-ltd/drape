do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.finalize_order_terminal(uuid,text,text,text,text,text,jsonb,text[],text,boolean,boolean,boolean,boolean)') is null then
    raise exception 'Expected finalize_order_terminal uuid contract is missing';
  end if;

  select pg_get_functiondef(
    'public.apply_reviewed_post_refund_order_outcome(uuid,text,text,text,text)'::regprocedure
  ) into v_definition;

  if position('v_order.id::uuid' in v_definition) = 0 then
    raise exception 'Reviewed post-refund close path must cast the legacy text order id to uuid';
  end if;
end $$;
