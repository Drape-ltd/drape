-- Drapeon Vision TestFlight tape-comparison data.
-- Stores tester-entered tape values and environment diagnostics, not camera frames.
create table if not exists public.drape_vision_ground_truth (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measurement_scan_id uuid references public.measurement_scans(id) on delete set null,
  participant_label text,
  measured_by text not null default 'SELF_TAPE'
    check (measured_by in ('SELF_TAPE', 'HELPER_TAPE', 'TAILOR_TAPE', 'OPS_TAPE')),
  measurement_unit text not null default 'in'
    check (measurement_unit in ('cm', 'in', 'mixed')),
  measurements_cm jsonb not null default '{}'::jsonb,
  measurements_in jsonb not null default '{}'::jsonb,
  environment jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drape_vision_ground_truth_cm_object_check
    check (jsonb_typeof(measurements_cm) = 'object'),
  constraint drape_vision_ground_truth_in_object_check
    check (jsonb_typeof(measurements_in) = 'object'),
  constraint drape_vision_ground_truth_environment_object_check
    check (jsonb_typeof(environment) = 'object'),
  constraint drape_vision_ground_truth_has_measurement_check
    check (measurements_cm <> '{}'::jsonb or measurements_in <> '{}'::jsonb)
);

create index if not exists drape_vision_ground_truth_user_created_idx
  on public.drape_vision_ground_truth (user_id, created_at desc);

create index if not exists drape_vision_ground_truth_scan_idx
  on public.drape_vision_ground_truth (measurement_scan_id);

alter table public.drape_vision_ground_truth enable row level security;

drop policy if exists "Customer owns their Drape Vision ground truth" on public.drape_vision_ground_truth;
create policy "Customer owns their Drape Vision ground truth" on public.drape_vision_ground_truth
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.drape_vision_ground_truth to authenticated;

drop trigger if exists drape_vision_ground_truth_updated_at on public.drape_vision_ground_truth;
create trigger drape_vision_ground_truth_updated_at
before update on public.drape_vision_ground_truth
for each row execute function handle_updated_at();

create or replace view public.drape_vision_ground_truth_comparison
with (security_invoker = true) as
select
  gt.id as ground_truth_id,
  gt.user_id,
  gt.measurement_scan_id,
  s.created_at as scan_created_at,
  gt.created_at as ground_truth_created_at,
  field.key as field_name,
  comparison_values.ground_truth_cm,
  comparison_values.scan_cm,
  round(comparison_values.scan_cm - comparison_values.ground_truth_cm, 2) as error_cm,
  round(abs(comparison_values.scan_cm - comparison_values.ground_truth_cm), 2) as absolute_error_cm,
  round(abs(comparison_values.scan_cm - comparison_values.ground_truth_cm) / nullif(comparison_values.ground_truth_cm, 0) * 100, 2) as percentage_error,
  s.confidence_by_field ->> field.key as confidence,
  s.status as scan_status,
  s.confidence_overall,
  gt.measured_by,
  gt.participant_label,
  gt.environment,
  gt.notes
from public.drape_vision_ground_truth gt
join public.measurement_scans s
  on s.id = gt.measurement_scan_id
cross join lateral jsonb_object_keys(gt.measurements_cm || gt.measurements_in) as field(key)
cross join lateral (
  select
    case
      when (gt.measurements_cm ->> field.key) ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (gt.measurements_cm ->> field.key)::numeric
      when (gt.measurements_in ->> field.key) ~ '^-?[0-9]+(\.[0-9]+)?$'
        then round((gt.measurements_in ->> field.key)::numeric * 2.54, 2)
      else null
    end as ground_truth_cm,
    case
      when (s.measurement_snapshot ->> field.key) ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (s.measurement_snapshot ->> field.key)::numeric
      when (s.garment_preferences -> 'visionLab' -> 'resultMeasurementsCm' ->> field.key) ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (s.garment_preferences -> 'visionLab' -> 'resultMeasurementsCm' ->> field.key)::numeric
      else null
    end as scan_cm
) as comparison_values
where comparison_values.ground_truth_cm is not null
  and comparison_values.scan_cm is not null;

grant select on public.drape_vision_ground_truth_comparison to authenticated;
