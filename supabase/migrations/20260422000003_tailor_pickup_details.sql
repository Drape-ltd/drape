-- Drape V1 — private pickup details for collection orders
--
-- Exact pickup details should not sit on the public tailor profile. Tailors
-- manage them privately, and customers only unlock them once a pickup order is
-- actually ready for collection.

create table if not exists public.tailor_pickup_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pickup_address text,
  pickup_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tailor_pickup_details enable row level security;

grant select, insert, update on table public.tailor_pickup_details to authenticated;

drop policy if exists "tailor_pickup_details: own row select" on public.tailor_pickup_details;
create policy "tailor_pickup_details: own row select"
  on public.tailor_pickup_details
  for select
  to authenticated
  using (user_id::text = auth.uid()::text);

drop policy if exists "tailor_pickup_details: own row insert" on public.tailor_pickup_details;
create policy "tailor_pickup_details: own row insert"
  on public.tailor_pickup_details
  for insert
  to authenticated
  with check (user_id::text = auth.uid()::text);

drop policy if exists "tailor_pickup_details: own row update" on public.tailor_pickup_details;
create policy "tailor_pickup_details: own row update"
  on public.tailor_pickup_details
  for update
  to authenticated
  using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

drop policy if exists "tailor_pickup_details: customer sees unlocked pickup details" on public.tailor_pickup_details;
create policy "tailor_pickup_details: customer sees unlocked pickup details"
  on public.tailor_pickup_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.tailor_id::text = tailor_pickup_details.user_id::text
        and o.customer_id::text = auth.uid()::text
        and o.delivery_method = 'LOCAL_COLLECTION'
        and o.stage in ('READY_FOR_COLLECTION', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE')
    )
  );

drop trigger if exists tailor_pickup_details_updated_at on public.tailor_pickup_details;
create trigger tailor_pickup_details_updated_at
before update on public.tailor_pickup_details
for each row execute function handle_updated_at();
