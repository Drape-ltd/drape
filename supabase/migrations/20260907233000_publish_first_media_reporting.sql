-- Publish-first media moderation: verified tailor media is visible immediately,
-- while authenticated reports create an auditable, idempotent safety workflow.

create table if not exists public.media_safety_reports (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason_code text not null,
  details text,
  status text not null default 'OPEN',
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_safety_reports_reason_check check (
    reason_code in ('NUDITY_OR_SEXUAL', 'VIOLENCE_OR_HATE', 'CHILD_SAFETY', 'SCAM_OR_IMPERSONATION', 'OTHER')
  ),
  constraint media_safety_reports_status_check check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  constraint media_safety_reports_details_size_check check (details is null or char_length(details) <= 1000)
);

drop trigger if exists trg_media_safety_reports_updated_at on public.media_safety_reports;
create trigger trg_media_safety_reports_updated_at
before update on public.media_safety_reports
for each row execute function public.set_updated_at();

create unique index if not exists media_safety_reports_one_open_per_reporter_idx
  on public.media_safety_reports(media_asset_id, reporter_user_id)
  where status = 'OPEN';

create index if not exists media_safety_reports_open_asset_idx
  on public.media_safety_reports(media_asset_id, created_at desc)
  where status = 'OPEN';

alter table public.media_safety_reports enable row level security;
revoke all on public.media_safety_reports from anon, authenticated;
grant select, insert, update, delete on public.media_safety_reports to service_role;

comment on table public.media_safety_reports is
  'Authenticated reports for publish-first public media. One report raises Ops review; child-safety or two distinct open reports temporarily block the asset.';
