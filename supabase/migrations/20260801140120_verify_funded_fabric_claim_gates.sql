do $$
begin
  if not exists(select 1 from pg_trigger where tgname='funded_fabric_claim_guard' and not tgisinternal) then
    raise exception 'funded fabric claim guard is missing';
  end if;
  if not exists(select 1 from pg_constraint where conname='order_material_advances_funded_terminal_check') then
    raise exception 'funded fabric terminal invariant is missing';
  end if;
end $$;
