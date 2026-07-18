-- Drapeon identity verification handoff sessions.
-- This moves tailor ID verification from a generic profile upload field into a
-- short-lived, server-mediated live selfie + ID capture flow.

create table if not exists public.identity_verification_handoffs (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'CREATED'
    check (status in ('CREATED', 'OPENED', 'CAPTURED', 'SUBMITTED', 'EXPIRED', 'CANCELLED')),
  channel text not null default 'QR'
    check (channel in ('QR', 'SMS', 'EMAIL')),
  requested_delivery text,
  expires_at timestamptz not null,
  opened_at timestamptz,
  submitted_at timestamptz,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_identity_handoffs_tailor_status
  on public.identity_verification_handoffs (tailor_user_id, status, expires_at desc);

create index if not exists idx_identity_handoffs_expires
  on public.identity_verification_handoffs (expires_at)
  where status in ('CREATED', 'OPENED', 'CAPTURED');

alter table public.identity_verification_handoffs enable row level security;

revoke all on public.identity_verification_handoffs from anon, authenticated;
grant all on public.identity_verification_handoffs to service_role;

alter table public.tailor_profiles
  add column if not exists id_selfie_document_url text,
  add column if not exists id_verification_method text not null default 'LIVE_SELFIE_ID',
  add column if not exists id_verification_handoff_id uuid references public.identity_verification_handoffs(id) on delete set null,
  add column if not exists id_verification_submitted_at timestamptz;

comment on column public.tailor_profiles.id_selfie_document_url is
  'Private id-documents storage path for the live selfie holding physical ID.';

comment on column public.tailor_profiles.id_verification_method is
  'Identity capture method. New submissions use LIVE_SELFIE_ID.';

comment on column public.tailor_profiles.id_verification_handoff_id is
  'Identity handoff session that produced the submitted selfie-ID capture.';

update storage.buckets
set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'id-documents';

drop policy if exists "id-documents: tailor can upload own" on storage.objects;
create policy "id-documents: handoff selfie insert only"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'id-documents'
    and split_part(name, '/', 1) = 'id-verification'
    and split_part(name, '/', 2) = auth.uid()::text
    and split_part(name, '/', 3) like 'selfie\_%' escape '\'
    and lower(storage.extension(name)) in ('jpg', 'jpeg')
  );

create or replace function public.touch_identity_verification_handoff_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_identity_verification_handoffs_updated_at
  on public.identity_verification_handoffs;

create trigger trg_identity_verification_handoffs_updated_at
before update on public.identity_verification_handoffs
for each row
execute function public.touch_identity_verification_handoff_updated_at();

create or replace function public.prevent_locked_identity_field_edits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  trusted_write text := current_setting('drape.identity_verification_trusted_write', true);
begin
  if coalesce(trusted_write, '') = 'true' then
    return new;
  end if;

  if old.id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED') then
    if new.id_document_url is distinct from old.id_document_url
      or new.id_selfie_document_url is distinct from old.id_selfie_document_url
      or new.id_verification_status is distinct from old.id_verification_status
      or new.id_verified_at is distinct from old.id_verified_at
      or new.id_verification_method is distinct from old.id_verification_method
      or new.id_verification_handoff_id is distinct from old.id_verification_handoff_id
    then
      raise exception 'Identity verification fields are locked while review is pending or approved.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tailor_profiles_identity_field_lock
  on public.tailor_profiles;

create trigger trg_tailor_profiles_identity_field_lock
before update on public.tailor_profiles
for each row
execute function public.prevent_locked_identity_field_edits();

create or replace function public.submit_identity_verification_handoff(
  p_handoff_id uuid,
  p_tailor_user_id uuid,
  p_storage_path text
)
returns table (
  profile_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_profile record;
  v_handoff record;
  v_profile_id uuid;
begin
  if p_storage_path is null
    or p_storage_path !~ ('^id-verification/' || p_tailor_user_id::text || '/selfie_[0-9]+\\.jpe?g$')
  then
    raise exception 'Invalid identity selfie storage path.' using errcode = '22023';
  end if;

  select *
    into v_handoff
  from identity_verification_handoffs
  where id = p_handoff_id
    and tailor_user_id = p_tailor_user_id
  for update;

  if v_handoff.id is null then
    raise exception 'Identity handoff session was not found.' using errcode = 'P0001';
  end if;

  if v_handoff.expires_at <= v_now then
    update identity_verification_handoffs
    set status = 'EXPIRED'
    where id = p_handoff_id;
    raise exception 'Identity handoff session has expired.' using errcode = 'P0001';
  end if;

  if v_handoff.status not in ('OPENED', 'CAPTURED') then
    raise exception 'Identity handoff session is not ready to submit.' using errcode = 'P0001';
  end if;

  select
    id,
    id_verification_status,
    payout_account_verified,
    payout_reverification_required,
    paystack_recipient_code,
    stripe_connect_account_id,
    manual_bank_entry,
    manual_bank_verification_status
  into v_profile
  from tailor_profiles
  where user_id = p_tailor_user_id
  for update;

  if v_profile.id is null then
    raise exception 'Complete your tailor profile before identity verification.' using errcode = 'P0001';
  end if;

  if v_profile.id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED') then
    raise exception 'Identity verification is already pending or approved.' using errcode = 'P0001';
  end if;

  if v_profile.payout_account_verified is not true
    or v_profile.payout_reverification_required is true
  then
    raise exception 'Link a verified payout account before submitting identity review.' using errcode = 'P0001';
  end if;

  if coalesce(v_profile.paystack_recipient_code, '') = ''
    and coalesce(v_profile.stripe_connect_account_id, '') = ''
    and not (
      v_profile.manual_bank_entry is true
      and coalesce(v_profile.manual_bank_verification_status, '') in ('VERIFIED', 'APPROVED')
    )
  then
    raise exception 'Add payout routing details before submitting identity review.' using errcode = 'P0001';
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);

  update identity_verification_handoffs
  set
    status = 'SUBMITTED',
    submitted_at = v_now,
    storage_path = p_storage_path,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('submitted_by', p_tailor_user_id)
  where id = p_handoff_id;

  update tailor_profiles
  set
    id_document_url = p_storage_path,
    id_selfie_document_url = p_storage_path,
    id_verification_method = 'LIVE_SELFIE_ID',
    id_verification_handoff_id = p_handoff_id,
    id_verification_submitted_at = v_now,
    id_verification_status = 'PENDING',
    updated_at = v_now
  where user_id = p_tailor_user_id
  returning id into v_profile_id;

  return query
  select v_profile_id, 'PENDING'::text;
end;
$$;

revoke all on function public.submit_identity_verification_handoff(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff(uuid, uuid, text) to service_role;

create or replace function public.ops_decide_verification(
  p_tailor_user_id uuid,
  p_decision text
)
returns table (
  profile_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_display_name text;
  v_now timestamptz := now();
  v_status text;
begin
  if p_decision = 'APPROVE' then
    v_status := 'VERIFIED';
  elsif p_decision = 'REJECT' then
    v_status := 'REJECTED';
  else
    raise exception 'Invalid verification decision: %', p_decision using errcode = '22023';
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);

  update tailor_profiles
  set
    id_verification_status = v_status,
    is_live = (p_decision = 'APPROVE'),
    id_verified_at = case when p_decision = 'APPROVE' then coalesce(id_verified_at, v_now) else null end
  where user_id::text = p_tailor_user_id::text
    and id_verification_status = 'PENDING'
  returning id::uuid, display_name into v_profile_id, v_display_name;

  if v_profile_id is null then
    raise exception 'Tailor verification is no longer pending.' using errcode = 'P0001';
  end if;

  insert into audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    null,
    'OPS',
    null,
    'id_verification.decision',
    case when p_decision = 'APPROVE' then 'info' else 'warn' end,
    jsonb_build_object(
      'decision', p_decision,
      'tailor_id', p_tailor_user_id,
      'display_name', v_display_name,
      'source', 'ops_dashboard'
    )
  );

  return query
  select v_profile_id, v_status;
end;
$$;

revoke all on function public.ops_decide_verification(uuid, text) from public, anon, authenticated;
grant execute on function public.ops_decide_verification(uuid, text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tailor_profiles;
  end if;
exception
  when duplicate_object then
    null;
end $$;
