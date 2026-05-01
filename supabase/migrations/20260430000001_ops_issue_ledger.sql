-- Drape V1 — Ops issue ledger
-- Durable numbered ops issues plus immutable ops action history.

create table if not exists public.ops_issues (
  id uuid primary key default gen_random_uuid(),
  issue_number bigint generated always as identity unique,
  issue_type text not null,
  severity text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'ESCALATED')),
  source text not null,
  actor_id text,
  actor_role text,
  order_id text,
  user_id text,
  tailor_profile_id text,
  related_entity_type text,
  related_entity_id text,
  provider text,
  stage text,
  title text not null,
  description text not null,
  recommended_action text not null,
  dedupe_key text not null unique,
  assigned_to text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_audit_logs (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.ops_issues(id) on delete cascade,
  action_taken text not null,
  performed_by text,
  performed_role text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_issues_status_severity_created_idx
  on public.ops_issues (status, severity, created_at desc);

create index if not exists ops_issues_order_id_idx
  on public.ops_issues (order_id)
  where order_id is not null;

create index if not exists ops_issues_issue_type_created_idx
  on public.ops_issues (issue_type, created_at desc);

create index if not exists ops_issues_assigned_to_idx
  on public.ops_issues (assigned_to)
  where assigned_to is not null;

create index if not exists ops_audit_logs_issue_id_created_idx
  on public.ops_audit_logs (issue_id, created_at desc);

create or replace function public.set_ops_issue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ops_issues_updated_at on public.ops_issues;
create trigger trg_ops_issues_updated_at
before update on public.ops_issues
for each row
execute function public.set_ops_issue_updated_at();

alter table public.ops_issues enable row level security;
alter table public.ops_audit_logs enable row level security;

grant select on table public.ops_issues to service_role;
grant select on table public.ops_audit_logs to service_role;
