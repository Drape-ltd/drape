create table if not exists public.measurement_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  capture_method text not null
    check (capture_method in ('GUIDED_MANUAL_BASELINE', 'GUIDED_HELPER_BASELINE', 'TAILOR_REVIEWED_BASELINE')),
  capture_version text not null default 'guided-fit-v1',
  status text not null default 'CAPTURED'
    check (status in ('CAPTURED', 'TAILOR_REVIEW_REQUIRED', 'TAILOR_REVIEWED')),
  confidence_overall text
    check (confidence_overall in ('LOW', 'MEDIUM', 'HIGH')),
  confidence_by_field jsonb not null default '{}'::jsonb,
  measurement_snapshot jsonb not null default '{}'::jsonb,
  garment_preferences jsonb not null default '{}'::jsonb,
  body_flags text[] not null default '{}',
  symmetry_flags text[] not null default '{}',
  requires_tailor_review boolean not null default false,
  source_device jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists measurement_scans_user_created_idx
  on public.measurement_scans (user_id, created_at desc);

alter table public.measurement_scans enable row level security;

drop policy if exists "Customer owns their measurement scans" on public.measurement_scans;
create policy "Customer owns their measurement scans" on public.measurement_scans
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.measurement_scans to authenticated;

drop trigger if exists measurement_scans_updated_at on public.measurement_scans;
create trigger measurement_scans_updated_at
before update on public.measurement_scans
for each row execute function handle_updated_at();
