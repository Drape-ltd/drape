create table if not exists public.signup_media_quarantine (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claim_hash text not null,
  manifest jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now()
);

alter table public.signup_media_quarantine enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signup-media-quarantine',
  'signup-media-quarantine',
  false,
  31457280,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.signup_media_quarantine is
  'Private, short-lived signup media manifests. Service-role access only; objects expire after 48 hours.';

do $$ declare v_job bigint; begin
  select jobid into v_job from cron.job where jobname = 'cleanup-signup-media-quarantine';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'cleanup-signup-media-quarantine',
    '17 * * * *',
    $job$select util.invoke_edge_function('cleanup-signup-media-quarantine');$job$
  );
end $$;
