create or replace function public.guard_terminal_order_update()
returns trigger
language plpgsql
as $$
begin
  if old.stage = 'COMPLETE'::public.order_stage
    and new.stage in ('PARTIALLY_REFUNDED'::public.order_stage, 'REFUNDED'::public.order_stage) then
    return new;
  end if;

  if public.is_terminal_order_stage(old.stage) then
    raise exception 'Terminal order % at stage % cannot be mutated.', old.id, old.stage
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
