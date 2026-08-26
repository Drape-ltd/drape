create or replace function public.enforce_payout_change_terminal_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  lifecycle_state text := upper(coalesce(new.metadata ->> 'lifecycle_state', ''));
  confirmation_status text := upper(coalesce(new.metadata ->> 'confirmation_status', ''));
begin
  if old.status = 'PENDING' and new.status = 'APPROVED' then
    if confirmation_status <> 'CONFIRMED'
      or lifecycle_state not in ('SECURITY_HOLD', 'OPS_REVIEW', 'ACTIVATED') then
      raise exception 'Payout change must be confirmed and complete its reviewed lifecycle before activation.'
        using errcode = 'P0001';
    end if;
  end if;

  if old.status = 'PENDING' and new.status = 'REJECTED' then
    if confirmation_status <> 'CONFIRMED' or lifecycle_state <> 'OPS_REVIEW' then
      raise exception 'Only a confirmed payout exception in ops review may be rejected.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_payout_change_terminal_lifecycle on public.payout_change_requests;
create trigger trg_enforce_payout_change_terminal_lifecycle
before update of status on public.payout_change_requests
for each row
execute function public.enforce_payout_change_terminal_lifecycle();

comment on function public.enforce_payout_change_terminal_lifecycle() is
  'Prevents payout destination activation or rejection before tailor confirmation and the required security or ops-review lifecycle.';
