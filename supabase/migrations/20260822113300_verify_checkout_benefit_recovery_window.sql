do $$
declare
  v_default text;
begin
  select pg_get_expr(d.adbin, d.adrelid)
  into v_default
  from pg_attrdef d
  join pg_attribute a
    on a.attrelid=d.adrelid and a.attnum=d.adnum
  where d.adrelid='public.commercial_benefit_reservations'::regclass
    and a.attname='expires_at';

  if v_default is null or (v_default not like '%2 hours%' and v_default not like '%02:00:00%') then
    raise exception 'Commercial benefit reservations must share the two-hour checkout recovery window.';
  end if;
end
$$;
