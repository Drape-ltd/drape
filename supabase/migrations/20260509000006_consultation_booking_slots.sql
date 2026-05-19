create extension if not exists btree_gist;

create table if not exists consultation_bookings (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  tailor_id uuid not null,
  customer_id uuid not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  status text not null default 'CONFIRMED'
    check (status in ('CONFIRMED', 'CANCELLED', 'COMPLETED')),
  source text not null default 'ORDER_CONSULTATION',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultation_bookings_valid_time
    check (scheduled_end_at > scheduled_start_at)
);

create unique index if not exists consultation_bookings_one_active_order_idx
  on consultation_bookings (order_id)
  where status = 'CONFIRMED';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'consultation_bookings_no_tailor_overlap'
  ) then
    alter table consultation_bookings
      add constraint consultation_bookings_no_tailor_overlap
      exclude using gist (
        tailor_id with =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') with &&
      )
      where (status = 'CONFIRMED');
  end if;
end $$;

create index if not exists consultation_bookings_tailor_time_idx
  on consultation_bookings (tailor_id, scheduled_start_at, scheduled_end_at)
  where status = 'CONFIRMED';

alter table consultation_bookings enable row level security;

drop policy if exists "Order parties read consultation bookings" on consultation_bookings;
create policy "Order parties read consultation bookings"
  on consultation_bookings
  for select
  using (
    exists (
      select 1
      from orders o
      where o.id::text = consultation_bookings.order_id
        and (
          o.customer_id::text = auth.uid()::text
          or o.tailor_id::text = auth.uid()::text
        )
    )
  );

drop trigger if exists consultation_bookings_updated_at on consultation_bookings;
create trigger consultation_bookings_updated_at
  before update on consultation_bookings
  for each row execute function handle_updated_at();
