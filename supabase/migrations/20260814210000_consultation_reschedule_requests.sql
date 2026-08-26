create table if not exists public.consultation_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id_text) on delete cascade,
  booking_id uuid not null references public.consultation_bookings(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_by_role text not null check (requested_by_role in ('CUSTOMER', 'TAILOR')),
  proposed_start_at timestamptz not null,
  proposed_end_at timestamptz not null,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  responded_by uuid references auth.users(id) on delete restrict,
  response_note text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultation_reschedule_valid_time check (proposed_end_at > proposed_start_at)
);

create unique index if not exists consultation_reschedule_one_pending_order_idx
  on public.consultation_reschedule_requests(order_id)
  where status = 'PENDING';

create index if not exists consultation_reschedule_order_created_idx
  on public.consultation_reschedule_requests(order_id, created_at desc);

alter table public.consultation_reschedule_requests enable row level security;

drop policy if exists consultation_reschedule_participants_select on public.consultation_reschedule_requests;
create policy consultation_reschedule_participants_select
  on public.consultation_reschedule_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders order_record
      where order_record.id::text = consultation_reschedule_requests.order_id
        and (
          order_record.customer_id::text = auth.uid()::text
          or order_record.tailor_id::text = auth.uid()::text
        )
    )
  );

revoke insert, update, delete on public.consultation_reschedule_requests from anon, authenticated;
grant select on public.consultation_reschedule_requests to authenticated;
grant select, insert, update, delete on public.consultation_reschedule_requests to service_role;
