do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='order_refund_resolutions' and column_name='order_outcome'
  ) then raise exception 'order_refund_resolutions.order_outcome is missing'; end if;
  if to_regprocedure('public.set_ops_partial_refund_order_outcome(uuid,text)') is null then
    raise exception 'set_ops_partial_refund_order_outcome is missing';
  end if;
  if to_regprocedure('public.apply_ops_partial_refund_order_outcome(uuid,text)') is null then
    raise exception 'apply_ops_partial_refund_order_outcome is missing';
  end if;
  if has_function_privilege('authenticated','public.apply_ops_partial_refund_order_outcome(uuid,text)','EXECUTE') then
    raise exception 'authenticated users must not apply protected refund outcomes';
  end if;
end $$;
