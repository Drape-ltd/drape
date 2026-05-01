create table if not exists public.order_handoff_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reporter_role text not null check (reporter_role in ('CUSTOMER', 'TAILOR')),
  issue_type text not null check (
    issue_type in (
      'AT_PICKUP',
      'CANT_FIND_LOCATION',
      'COUNTERPART_NOT_RESPONDING',
      'ORDER_NOT_READY',
      'COURIER_OR_DELIVERY_ISSUE',
      'NEED_DRAPE_HELP'
    )
  ),
  description text,
  stage_at_report text not null,
  delivery_method text,
  status text not null default 'OPEN' check (status in ('OPEN', 'ESCALATED', 'RESOLVED', 'DISMISSED')),
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_handoff_issues_order_created_idx
  on public.order_handoff_issues (order_id, created_at desc);

create index if not exists order_handoff_issues_status_created_idx
  on public.order_handoff_issues (status, created_at asc);

alter table public.order_handoff_issues enable row level security;

grant select on table public.order_handoff_issues to authenticated;

drop policy if exists "order_handoff_issues: participant select" on public.order_handoff_issues;
create policy "order_handoff_issues: participant select"
  on public.order_handoff_issues
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_handoff_issues.order_id
        and (
          o.customer_id::text = auth.uid()::text
          or o.tailor_id::text = auth.uid()::text
        )
    )
  );

drop trigger if exists order_handoff_issues_updated_at on public.order_handoff_issues;
create trigger order_handoff_issues_updated_at
before update on public.order_handoff_issues
for each row execute function handle_updated_at();

create table if not exists public.tailor_payout_setup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('STRIPE', 'PAYSTACK')),
  currency text not null,
  country text not null,
  account_holder_name text not null,
  business_name text,
  payout_details text not null,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_REVIEW', 'LINKED', 'REJECTED', 'CANCELLED')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tailor_payout_setup_requests_user_created_idx
  on public.tailor_payout_setup_requests (user_id, created_at desc);

create index if not exists tailor_payout_setup_requests_status_created_idx
  on public.tailor_payout_setup_requests (status, created_at asc);

alter table public.tailor_payout_setup_requests enable row level security;

grant select on table public.tailor_payout_setup_requests to authenticated;

drop policy if exists "tailor_payout_setup_requests: own row select" on public.tailor_payout_setup_requests;
create policy "tailor_payout_setup_requests: own row select"
  on public.tailor_payout_setup_requests
  for select
  using (auth.uid()::text = user_id::text);

drop trigger if exists tailor_payout_setup_requests_updated_at on public.tailor_payout_setup_requests;
create trigger tailor_payout_setup_requests_updated_at
before update on public.tailor_payout_setup_requests
for each row execute function handle_updated_at();
