do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'consultation_reschedule_one_pending_order_idx'
  ) then
    raise exception 'pending consultation reschedule uniqueness is missing';
  end if;
end
$$;
