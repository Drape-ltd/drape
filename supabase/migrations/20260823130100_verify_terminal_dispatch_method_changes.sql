do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'orders_block_terminal_dispatch_method_change'
      and not tgisinternal
  ) then
    raise exception 'orders terminal dispatch method trigger is missing';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'block_terminal_dispatch_method_change'
  ) then
    raise exception 'terminal dispatch method guard function is missing';
  end if;
end;
$$;
