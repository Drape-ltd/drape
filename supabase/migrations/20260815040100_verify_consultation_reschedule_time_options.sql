do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'consultation_reschedule_requests'
      and column_name = 'proposed_start_options'
  ) then
    raise exception 'consultation reschedule time options are missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'consultation_reschedule_option_count_check'
  ) then
    raise exception 'consultation reschedule option-count guard is missing';
  end if;
end;
$$;
