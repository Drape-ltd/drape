-- HOLD_FEATURE: Do not apply to production until Drape Vision ships.
create table if not exists public.drape_vision_scan_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  mode text not null,
  event_type text not null
    check (event_type in ('STARTED', 'MANUAL_UPLOAD', 'COMPLETED', 'FAILED', 'ABORTED')),
  capture_version text not null default 'drape-vision-v1',
  capture_count integer not null default 0,
  frame_sample_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  source_device jsonb,
  created_at timestamptz not null default now()
);

create index if not exists drape_vision_scan_logs_user_created_idx
  on public.drape_vision_scan_logs (user_id, created_at desc);

create index if not exists drape_vision_scan_logs_session_idx
  on public.drape_vision_scan_logs (session_id, created_at desc);

alter table public.drape_vision_scan_logs enable row level security;

drop policy if exists "Customer owns their Drape Vision scan logs" on public.drape_vision_scan_logs;
create policy "Customer owns their Drape Vision scan logs" on public.drape_vision_scan_logs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.drape_vision_scan_logs to authenticated;
