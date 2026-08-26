do $$
begin
  if to_regprocedure('public.derive_order_residual_settlement(text)') is null then
    raise exception 'derive_order_residual_settlement(text) is missing';
  end if;
  if to_regprocedure('public.prepare_order_residual_settlement_release(uuid)') is null then
    raise exception 'prepare_order_residual_settlement_release(uuid) is missing';
  end if;
end;
$$;
