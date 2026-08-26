-- Verified payout-destination replacements no longer add a second release delay.
-- Order delivery/protection windows remain unchanged. The seven-day change-again
-- cooldown remains an anti-churn control and does not block eligible earnings.

create or replace function public.prevent_payout_destination_release_hold()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.payout_destination_hold_until := null;
  return new;
end;
$$;

drop trigger if exists trg_prevent_payout_destination_release_hold on public.tailor_profiles;
create trigger trg_prevent_payout_destination_release_hold
before insert or update of payout_destination_hold_until on public.tailor_profiles
for each row
execute function public.prevent_payout_destination_release_hold();

update public.tailor_profiles
set payout_destination_hold_until = null,
    updated_at = now()
where payout_destination_hold_until is not null;

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

    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'lifecycle_state', 'ACTIVATED',
        'activated_at', coalesce(new.metadata ->> 'activated_at', now()::text),
        'hold_until', null,
        'activation_delay_applied', false
      );
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

comment on function public.enforce_payout_change_terminal_lifecycle() is
  'Requires tailor confirmation and any risk review, records immediate activation, and forbids an additional payout-destination release delay.';

comment on column public.tailor_profiles.payout_destination_hold_until is
  'Legacy compatibility field. Must remain null; verified payout-destination activation no longer delays otherwise eligible earnings.';

insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
values (
  null,
  'SYSTEM',
  'payout_destination.activation_policy_updated',
  'info',
  jsonb_build_object(
    'activation_policy', 'IMMEDIATE_AFTER_VERIFICATION_OR_REQUIRED_REVIEW',
    'payout_destination_release_hold_hours', 0,
    'change_again_cooldown_days', 7,
    'order_protection_windows_unchanged', true
  )
);
