do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.create_commercial_pricing_reservation(text,uuid,text,uuid,text,currency,integer,integer,integer,integer,integer,text,text,boolean,jsonb,uuid,timestamptz)'::regprocedure
  ) into v_definition;

  if v_definition not like '%p_total_amount + v_promotion_amount <>%' then
    raise exception 'Generic pricing reservations do not account for promotions.';
  end if;
  if v_definition not like '%Promotion amount must be a non-negative integer in minor units.%' then
    raise exception 'Generic pricing reservations do not validate promotion amounts.';
  end if;
end
$$;
