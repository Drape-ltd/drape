-- Implementation 7 uses a distinct payment phase so post-acceptance charges
-- never masquerade as the initial order, consultation, fulfillment deposit, or
-- material advance.

do $$
begin
  if exists (select 1 from pg_type where typname = 'order_payment_phase')
    and not exists (
      select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'order_payment_phase' and e.enumlabel = 'ADJUSTMENT'
    )
  then
    alter type order_payment_phase add value 'ADJUSTMENT';
  end if;
end;
$$;
