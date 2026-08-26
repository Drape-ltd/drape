do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.get_order_fabric_cutting_blockers_v2(text)'::regprocedure)
    into v_definition;
  if position('order_fabric_candidates' in v_definition) = 0
    or position('v_allocation.coverage' in v_definition) > 0
    or position('explicit_components' in v_definition) = 0 then
    raise exception 'FABRIC_COVERAGE_STILL_TREATED_AS_REQUIRED_COMPONENTS';
  end if;
end
$$;
