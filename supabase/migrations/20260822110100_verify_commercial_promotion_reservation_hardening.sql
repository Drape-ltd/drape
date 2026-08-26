do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.reserve_order_benefit(text,uuid,text,uuid,text)'::regprocedure)
  into v_definition;

  if v_definition not like '%commercial_benefit_reservations x%status=''RESERVED''%expires_at>now()%' then
    raise exception 'Promotion reservation hardening must count active reservations.';
  end if;
  if v_definition not like '%Promotion redemption limit reached.%' then
    raise exception 'Promotion total-limit enforcement is missing.';
  end if;
  if v_definition not like '%An active promotion is already applied to this order.%' then
    raise exception 'One-active-promotion enforcement is missing.';
  end if;
  if v_definition not like '%for update%' then
    raise exception 'Promotion reservation must retain row locking.';
  end if;
end
$$;
