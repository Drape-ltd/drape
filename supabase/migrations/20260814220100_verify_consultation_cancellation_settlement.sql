do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='consultation_bookings' and column_name='settlement_status') then
    raise exception 'consultation settlement status is missing';
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='consultation_commercial_events') then
    raise exception 'consultation commercial events are missing';
  end if;
end $$;
