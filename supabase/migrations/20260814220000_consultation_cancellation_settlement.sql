-- Consultation money lifecycle: every paid booking reaches an auditable
-- refund, earned-fee release, or Ops-review outcome without closing the order.

alter table public.consultation_bookings
  add column if not exists settlement_status text not null default 'NOT_REQUIRED',
  add column if not exists earned_amount integer not null default 0,
  add column if not exists refunded_amount integer not null default 0,
  add column if not exists settlement_outcome text,
  add column if not exists settlement_eligible_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists payout_id text references public.payouts(id_text) on delete set null,
  add column if not exists settlement_provider_reference text,
  add column if not exists settlement_failure_reason text,
  add column if not exists commercial_correlation_id uuid not null default gen_random_uuid();

update public.consultation_bookings
set settlement_status = case
  when fee_mode = 'PAID' and payment_status = 'PAID' then 'HELD'
  else 'NOT_REQUIRED'
end
where settlement_status = 'NOT_REQUIRED';

alter table public.consultation_bookings
  add constraint consultation_bookings_settlement_status_check check (
    settlement_status in (
      'NOT_REQUIRED','HELD','REFUND_PENDING','PARTIALLY_REFUNDED',
      'REFUNDED','EARNED','RELEASE_PENDING','RELEASED','OPS_REVIEW','FAILED'
    )
  ),
  add constraint consultation_bookings_settlement_money_check check (
    earned_amount >= 0 and refunded_amount >= 0
    and earned_amount + refunded_amount <= coalesce(fee_amount, 0)
  );

create index if not exists consultation_bookings_settlement_queue_idx
  on public.consultation_bookings(settlement_status, settlement_eligible_at)
  where settlement_status in ('EARNED','RELEASE_PENDING','OPS_REVIEW','FAILED');

create table public.consultation_commercial_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.consultation_bookings(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  event_type text not null check (event_type in (
    'CANCELLATION_REQUESTED','CANCELLATION_COMPLETED','REFUND_PENDING',
    'ATTENDANCE_EARNED','PAYOUT_STARTED','PAYOUT_RELEASED','SETTLEMENT_FAILED','OPS_REVIEW_OPENED'
  )),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('CUSTOMER','TAILOR','OPS','SYSTEM')),
  amount integer,
  currency public.currency,
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index consultation_commercial_events_booking_idx
  on public.consultation_commercial_events(booking_id, created_at desc);

alter table public.consultation_commercial_events enable row level security;
create policy "Order parties read consultation commercial events"
  on public.consultation_commercial_events for select using (
    exists (
      select 1 from public.orders order_record
      where order_record.id::text = consultation_commercial_events.order_id::text
        and (order_record.customer_id::text = auth.uid()::text or order_record.tailor_id::text = auth.uid()::text)
    )
  );

grant select on public.consultation_commercial_events to authenticated;
grant select, insert, update, delete on public.consultation_commercial_events to service_role;

alter publication supabase_realtime add table public.consultation_commercial_events;
