-- Server-authoritative device trust for post-password new-device verification.
-- Raw device tokens and email codes are never persisted.

create table if not exists public.auth_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  label text not null check (char_length(label) between 1 and 80),
  platform text not null check (platform in ('WEB', 'IOS', 'ANDROID')),
  remembered boolean not null default false,
  trusted_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 120),
  created_at timestamptz not null default now(),
  constraint auth_trusted_devices_expiry_after_trust check (expires_at > trusted_at)
);

create index if not exists auth_trusted_devices_user_active_idx
  on public.auth_trusted_devices (user_id, expires_at desc)
  where revoked_at is null;

create table if not exists public.auth_device_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null check (char_length(code_hash) = 64),
  label text not null check (char_length(label) between 1 and 80),
  platform text not null check (platform in ('WEB', 'IOS', 'ANDROID')),
  remember_device boolean not null default false,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'CANCELLED')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  verified_at timestamptz,
  delivery_status text not null default 'PENDING'
    check (delivery_status in ('PENDING', 'ACCEPTED', 'FAILED')),
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_device_challenges_expiry_after_create check (expires_at > created_at)
);

create index if not exists auth_device_challenges_user_pending_idx
  on public.auth_device_challenges (user_id, created_at desc)
  where status = 'PENDING';

alter table public.auth_trusted_devices enable row level security;
alter table public.auth_device_challenges enable row level security;

revoke all on table public.auth_trusted_devices from public, anon, authenticated;
revoke all on table public.auth_device_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_trusted_devices to service_role;
grant select, insert, update, delete on table public.auth_device_challenges to service_role;

comment on table public.auth_trusted_devices is
  'Revocable server-issued device trust. token_hash stores SHA-256 only.';
comment on table public.auth_device_challenges is
  'Short-lived new-device email challenges. code_hash is HMAC-peppered; raw codes are never stored.';
