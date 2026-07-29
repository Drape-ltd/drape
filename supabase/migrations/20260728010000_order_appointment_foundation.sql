create extension if not exists btree_gist;

alter table public.consultation_bookings
  drop constraint if exists consultation_bookings_status_check;

alter table public.consultation_bookings
  add column if not exists appointment_kind text not null default 'CONSULTATION',
  add column if not exists call_type text not null default 'AUDIO',
  add column if not exists proposer_role text not null default 'CUSTOMER',
  add column if not exists reason_code text not null default 'BRIEF_CLARIFICATION',
  add column if not exists note text,
  add column if not exists timezone text not null default 'UTC',
  add column if not exists duration_minutes integer not null default 30,
  add column if not exists version integer not null default 1,
  add column if not exists replaces_booking_id uuid references public.consultation_bookings(id),
  add column if not exists selected_slot_id uuid,
  add column if not exists confirmed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text,
  add column if not exists reminder_24h_sent_at timestamptz,
  add column if not exists reminder_30m_sent_at timestamptz,
  add column if not exists reminder_5m_sent_at timestamptz,
  add column if not exists reminder_start_sent_at timestamptz;

alter table public.consultation_bookings
  add constraint consultation_bookings_status_check
    check (status in ('PROPOSED', 'COUNTERED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED')),
  add constraint consultation_bookings_kind_check
    check (appointment_kind in ('CONSULTATION', 'ORDER_COORDINATION')),
  add constraint consultation_bookings_call_type_check
    check (call_type in ('AUDIO', 'VIDEO')),
  add constraint consultation_bookings_proposer_role_check
    check (proposer_role in ('CUSTOMER', 'TAILOR')),
  add constraint consultation_bookings_reason_check
    check (reason_code in (
      'BRIEF_CLARIFICATION',
      'FIT_AND_MEASUREMENTS',
      'FABRIC_AND_MATERIALS',
      'STYLE_APPROVAL',
      'TIMELINE_AND_FULFILLMENT',
      'ORDER_COORDINATION',
      'OTHER'
    )),
  add constraint consultation_bookings_duration_check
    check (duration_minutes in (15, 30, 45, 60)),
  add constraint consultation_bookings_version_check
    check (version > 0);

update public.consultation_bookings
set confirmed_at = coalesce(confirmed_at, created_at)
where status = 'CONFIRMED';

create table if not exists public.consultation_booking_slots (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.consultation_bookings(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rank smallint not null check (rank between 1 and 3),
  created_at timestamptz not null default now(),
  constraint consultation_booking_slots_valid_time check (ends_at > starts_at),
  constraint consultation_booking_slots_booking_rank_key unique (booking_id, rank)
);

insert into public.consultation_booking_slots (booking_id, starts_at, ends_at, rank)
select id, scheduled_start_at, scheduled_end_at, 1
from public.consultation_bookings booking
where not exists (
  select 1
  from public.consultation_booking_slots slot
  where slot.booking_id = booking.id
);

update public.consultation_bookings booking
set selected_slot_id = slot.id
from public.consultation_booking_slots slot
where slot.booking_id = booking.id
  and slot.rank = 1
  and booking.status = 'CONFIRMED'
  and booking.selected_slot_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.consultation_bookings'::regclass
      and conname = 'consultation_bookings_selected_slot_id_fkey'
  ) then
    alter table public.consultation_bookings
      add constraint consultation_bookings_selected_slot_id_fkey
      foreign key (selected_slot_id)
      references public.consultation_booking_slots(id)
      on delete set null;
  end if;
end $$;

drop index if exists public.consultation_bookings_one_active_order_idx;
create unique index consultation_bookings_one_pending_order_idx
  on public.consultation_bookings (order_id)
  where status in ('PROPOSED', 'COUNTERED');

create unique index consultation_bookings_one_confirmed_order_idx
  on public.consultation_bookings (order_id)
  where status = 'CONFIRMED';

alter table public.consultation_bookings
  drop constraint if exists consultation_bookings_no_tailor_overlap;

alter table public.consultation_bookings
  add constraint consultation_bookings_no_tailor_overlap
  exclude using gist (
    tailor_id with =,
    tstzrange(scheduled_start_at, scheduled_end_at, '[)') with &&
  )
  where (status = 'CONFIRMED');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.consultation_bookings'::regclass
      and conname = 'consultation_bookings_no_customer_overlap'
  ) then
    alter table public.consultation_bookings
      add constraint consultation_bookings_no_customer_overlap
      exclude using gist (
        customer_id with =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') with &&
      )
      where (status = 'CONFIRMED');
  end if;
end $$;

create index if not exists consultation_bookings_customer_time_idx
  on public.consultation_bookings (customer_id, scheduled_start_at, scheduled_end_at)
  where status = 'CONFIRMED';

create index if not exists consultation_booking_slots_booking_time_idx
  on public.consultation_booking_slots (booking_id, starts_at);

create or replace function public.accept_consultation_booking_slot(
  p_booking_id uuid,
  p_slot_id uuid,
  p_expected_version integer,
  p_actor_id uuid
)
returns public.consultation_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.consultation_bookings%rowtype;
  slot_record public.consultation_booking_slots%rowtype;
  actor_role text;
  conflict_exists boolean;
begin
  if p_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select *
  into booking_record
  from public.consultation_bookings
  where id = p_booking_id
  for update;

  if booking_record.id is null then
    raise exception 'Appointment proposal not found.';
  end if;

  if booking_record.status not in ('PROPOSED', 'COUNTERED') then
    raise exception 'Appointment proposal is no longer pending.';
  end if;

  if booking_record.version <> p_expected_version then
    raise exception 'APPOINTMENT_VERSION_CHANGED';
  end if;

  if booking_record.customer_id = p_actor_id then
    actor_role := 'CUSTOMER';
  elsif booking_record.tailor_id = p_actor_id then
    actor_role := 'TAILOR';
  else
    raise exception 'You are not part of this order.';
  end if;

  if actor_role = booking_record.proposer_role then
    raise exception 'The other party must accept a proposed time.';
  end if;

  select *
  into slot_record
  from public.consultation_booking_slots
  where id = p_slot_id
    and booking_id = p_booking_id;

  if slot_record.id is null then
    raise exception 'Choose a valid proposed time.';
  end if;

  if slot_record.starts_at <= now() then
    raise exception 'This proposed time has already passed.';
  end if;

  select exists (
    select 1
    from public.consultation_bookings existing
    where existing.status = 'CONFIRMED'
      and existing.id <> coalesce(booking_record.replaces_booking_id, booking_record.id)
      and existing.id <> booking_record.id
      and (
        existing.customer_id = booking_record.customer_id
        or existing.tailor_id = booking_record.tailor_id
      )
      and tstzrange(existing.scheduled_start_at, existing.scheduled_end_at, '[)')
        && tstzrange(slot_record.starts_at, slot_record.ends_at, '[)')
  )
  into conflict_exists;

  if conflict_exists then
    raise exception 'APPOINTMENT_TIME_CONFLICT';
  end if;

  if booking_record.replaces_booking_id is not null then
    update public.consultation_bookings
    set status = 'CANCELLED',
        cancelled_at = now(),
        cancelled_by = p_actor_id,
        cancellation_reason = 'Replaced by confirmed reschedule',
        updated_at = now()
    where id = booking_record.replaces_booking_id
      and status = 'CONFIRMED';
  end if;

  update public.consultation_bookings
  set status = 'CONFIRMED',
      selected_slot_id = slot_record.id,
      scheduled_start_at = slot_record.starts_at,
      scheduled_end_at = slot_record.ends_at,
      confirmed_at = now(),
      version = version + 1,
      updated_at = now()
  where id = booking_record.id
  returning * into booking_record;

  update public.orders
  set video_call_url = null,
      updated_at = now()
  where id::text = booking_record.order_id;

  return booking_record;
end;
$$;

revoke all on function public.accept_consultation_booking_slot(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_consultation_booking_slot(uuid, uuid, integer, uuid)
  to service_role;

alter table public.consultation_booking_slots enable row level security;

drop policy if exists "Order parties read consultation booking slots"
  on public.consultation_booking_slots;
create policy "Order parties read consultation booking slots"
  on public.consultation_booking_slots
  for select
  using (
    exists (
      select 1
      from public.consultation_bookings booking
      join public.orders order_record
        on order_record.id::text = booking.order_id
      where booking.id = consultation_booking_slots.booking_id
        and (
          order_record.customer_id::text = auth.uid()::text
          or order_record.tailor_id::text = auth.uid()::text
        )
    )
  );

grant select on table public.consultation_bookings to authenticated;
grant select on table public.consultation_booking_slots to authenticated;
grant select, insert, update, delete on table public.consultation_bookings to service_role;
grant select, insert, update, delete on table public.consultation_booking_slots to service_role;

alter table public.order_events
  drop constraint if exists order_events_event_type_check;

alter table public.order_events
  add constraint order_events_event_type_check
  check (
    event_type in (
      'QUOTE_SENT',
      'QUOTE_REVISED',
      'QUOTE_RENEWED',
      'QUOTE_SUPERSEDED',
      'QUOTE_ACCEPTED',
      'QUOTE_DECLINED',
      'QUOTE_EXPIRED',
      'QUOTE_REVISION_REQUESTED',
      'QUOTE_REVISION_EDITED',
      'QUOTE_REVISION_WITHDRAWN',
      'QUOTE_RETAINED',
      'PAYMENT_CONFIRMED',
      'SCOPE_CHANGE_REQUESTED',
      'FABRIC_DECISION_RECORDED',
      'MEASUREMENT_DECISION_RECORDED',
      'FULFILLMENT_DECISION_RECORDED',
      'REMEDY_DECISION_RECORDED',
      'APPOINTMENT_PROPOSED',
      'APPOINTMENT_COUNTERED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_CANCELLED',
      'APPOINTMENT_COMPLETED',
      'APPOINTMENT_NO_SHOW',
      'APPOINTMENT_EXPIRED'
    )
  );
