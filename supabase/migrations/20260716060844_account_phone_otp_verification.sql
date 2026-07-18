-- Store profile-phone OTP attempts for the current signed-in account.
--
-- This table is intentionally service-only. Clients request/send/verify OTP
-- through account-profile-action so phone existence and OTP state never leak
-- through the public Data API.

alter table public.users
  add column if not exists phone_verified_at timestamptz;

alter table public.customer_profiles
  add column if not exists phone_verified_at timestamptz;

create table if not exists public.account_phone_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  otp_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_phone_verifications_user_phone_key unique (user_id, phone)
);

create index if not exists account_phone_verifications_user_idx
  on public.account_phone_verifications (user_id);

create index if not exists account_phone_verifications_expiry_idx
  on public.account_phone_verifications (expires_at);

alter table public.account_phone_verifications enable row level security;

revoke all on table public.account_phone_verifications from public, anon, authenticated;
grant all on table public.account_phone_verifications to service_role;
