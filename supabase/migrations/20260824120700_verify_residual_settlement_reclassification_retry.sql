do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.prepare_order_residual_settlement_release(uuid)'::regprocedure)
  into v_definition;

  if v_definition not like '%where idempotency_key = v_reclassification_key%'
    or v_definition not like '%v_entry_count <> 2%'
    or v_definition not like '%v_tailor_debit_count <> 1%'
    or v_definition not like '%v_fulfilment_credit_count <> 1%' then
    raise exception 'Residual-settlement reclassification retry validation is incomplete.';
  end if;
end;
$$;
