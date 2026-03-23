-- Drape V1 — authenticated in-app account deletion initiation

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('CUSTOMER', 'TAILOR', 'UNKNOWN')),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'REJECTED')),
  reason text,
  requested_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  processed_at timestamptz,
  metadata jsonb
);

create unique index if not exists account_deletion_requests_one_pending_per_user
  on account_deletion_requests (user_id)
  where status = 'PENDING';

alter table account_deletion_requests enable row level security;

drop policy if exists "account_deletion_requests: service role only" on account_deletion_requests;
create policy "account_deletion_requests: service role only"
  on account_deletion_requests
  for all
  to service_role
  using (true)
  with check (true);
