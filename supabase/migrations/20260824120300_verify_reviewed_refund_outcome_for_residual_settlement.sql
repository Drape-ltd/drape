do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.derive_order_residual_settlement(text)'::regprocedure)
  into v_definition;

  if position('coalesce(reviewed_order_outcome, order_outcome)' in v_definition) = 0 then
    raise exception 'Residual settlement does not use the reviewed refund outcome.';
  end if;

  if position('coalesce(reviewed_outcome_applied_at, outcome_applied_at)' in v_definition) = 0 then
    raise exception 'Residual settlement does not use the reviewed outcome timestamp.';
  end if;
end;
$$;
