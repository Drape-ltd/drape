-- Drapeon Vision TestFlight validation scorecards.
-- Compact scan QA only: no raw camera frames or uploaded media.
create table if not exists public.drape_vision_scorecard_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  measurement_scan_id uuid references public.measurement_scans(id) on delete set null,
  mode text not null,
  event_type text not null,
  pipeline_version text not null,
  verdict text not null
    check (verdict in ('green', 'yellow', 'red')),
  shipping_tape_accuracy_gate text not null
    check (shipping_tape_accuracy_gate in ('pass', 'watch', 'fail', 'pending', 'not_observed')),
  shipping_repeatability_gate text not null
    check (shipping_repeatability_gate in ('pass', 'watch', 'fail', 'pending', 'not_observed')),
  shipping_completion_gate text not null
    check (shipping_completion_gate in ('pass', 'watch', 'fail', 'pending', 'not_observed')),
  shipping_capture_stability_gate text not null
    check (shipping_capture_stability_gate in ('pass', 'watch', 'fail', 'pending', 'not_observed')),
  shipping_failure_clarity_gate text not null
    check (shipping_failure_clarity_gate in ('pass', 'watch', 'fail', 'pending', 'not_observed')),
  shipping_user_understanding_gate text not null
    check (shipping_user_understanding_gate in ('pass', 'watch', 'fail', 'pending', 'not_observed')),
  diagnostic_frame_sample_count integer not null default 0,
  diagnostic_capture_sample_count integer not null default 0,
  diagnostic_rejected_counts jsonb not null default '{}'::jsonb,
  diagnostic_quality_signals jsonb not null default '{}'::jsonb,
  shipping_scorecard jsonb not null default '{}'::jsonb,
  diagnostic_scorecard jsonb not null default '{}'::jsonb,
  scorecard jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint drape_vision_scorecard_rejected_counts_object_check
    check (jsonb_typeof(diagnostic_rejected_counts) = 'object'),
  constraint drape_vision_scorecard_quality_signals_object_check
    check (jsonb_typeof(diagnostic_quality_signals) = 'object'),
  constraint drape_vision_scorecard_shipping_object_check
    check (jsonb_typeof(shipping_scorecard) = 'object'),
  constraint drape_vision_scorecard_diagnostic_object_check
    check (jsonb_typeof(diagnostic_scorecard) = 'object'),
  constraint drape_vision_scorecard_object_check
    check (jsonb_typeof(scorecard) = 'object')
);

create index if not exists drape_vision_scorecard_rows_user_created_idx
  on public.drape_vision_scorecard_rows (user_id, created_at desc);

create index if not exists drape_vision_scorecard_rows_session_idx
  on public.drape_vision_scorecard_rows (session_id, created_at desc);

create index if not exists drape_vision_scorecard_rows_scan_idx
  on public.drape_vision_scorecard_rows (measurement_scan_id, created_at desc);

create index if not exists drape_vision_scorecard_rows_verdict_idx
  on public.drape_vision_scorecard_rows (verdict, created_at desc);

alter table public.drape_vision_scorecard_rows enable row level security;

drop policy if exists "Customer owns their Drape Vision scorecard rows" on public.drape_vision_scorecard_rows;
create policy "Customer owns their Drape Vision scorecard rows" on public.drape_vision_scorecard_rows
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.drape_vision_scorecard_rows to authenticated;
