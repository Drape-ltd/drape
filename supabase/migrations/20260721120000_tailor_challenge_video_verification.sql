-- Replace new Drape-managed government-ID capture with a short private
-- challenge video. Existing verification status columns and RPC names remain
-- in place so approved accounts and readiness gates keep working.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trust-verification',
  'trust-verification',
  false,
  52428800,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "trust-verification: challenge video insert only" on storage.objects;
create policy "trust-verification: challenge video insert only"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trust-verification'
    and split_part(name, '/', 1) = 'verification-video'
    and split_part(name, '/', 2) = auth.uid()::text
    and split_part(name, '/', 3) like 'challenge\_%' escape '\'
    and lower(storage.extension(name)) in ('mp4', 'mov', 'webm')
  );

alter table public.identity_verification_handoffs
  add column if not exists challenge_id text,
  add column if not exists challenge_text text,
  add column if not exists media_content_type text;

alter table public.tailor_profiles
  add column if not exists trust_verification_video_path text,
  add column if not exists trust_verification_challenge_id text,
  add column if not exists trust_verification_challenge_text text;

comment on column public.tailor_profiles.trust_verification_video_path is
  'Private trust-verification storage path for the latest Drape challenge video.';
comment on column public.tailor_profiles.trust_verification_challenge_text is
  'Exact phrase and movement prompt shown during the latest challenge video.';
comment on column public.tailor_profiles.id_verification_status is
  'Compatibility status for Drape marketplace trust review. New evidence uses CHALLENGE_VIDEO.';

update public.identity_consent_policies
set
  is_active = false,
  retired_at = coalesce(retired_at, now())
where policy_version = 'identity-verification-v1';

insert into public.identity_consent_policies (
  policy_version,
  purpose,
  consent_copy,
  is_active,
  metadata
)
values (
  'tailor-trust-video-v1',
  'Marketplace trust review, account safety, and fraud prevention',
  'I consent to Drapeon processing this short challenge video for marketplace trust review, account safety, and fraud prevention. The video stays private, is limited to authorized trust reviewers, and is retained or erased under Drapeon''s published privacy obligations.',
  true,
  jsonb_build_object(
    'privacy_url', 'https://drapeon.co/privacy',
    'evidence_type', 'CHALLENGE_VIDEO',
    'government_id_collected', false,
    'automated_biometrics', false
  )
)
on conflict (policy_version) do update
set
  purpose = excluded.purpose,
  consent_copy = excluded.consent_copy,
  is_active = excluded.is_active,
  retired_at = null,
  metadata = excluded.metadata;

create or replace function public.prevent_locked_trust_verification_edits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  trusted boolean := coalesce(current_setting('drape.identity_verification_trusted_write', true), '') = 'true';
begin
  if trusted then
    return new;
  end if;

  if coalesce(old.id_verification_status, '') in ('PENDING', 'VERIFIED', 'APPROVED') and (
    new.trust_verification_video_path is distinct from old.trust_verification_video_path
    or new.trust_verification_challenge_id is distinct from old.trust_verification_challenge_id
    or new.trust_verification_challenge_text is distinct from old.trust_verification_challenge_text
  ) then
    raise exception 'Trust verification evidence is locked while review is pending or approved.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_locked_trust_verification_edits on public.tailor_profiles;
create trigger trg_prevent_locked_trust_verification_edits
before update on public.tailor_profiles
for each row execute function public.prevent_locked_trust_verification_edits();

create or replace function public.submit_identity_verification_handoff(
  p_handoff_id uuid,
  p_tailor_user_id uuid,
  p_storage_path text
)
returns table (
  profile_id text,
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
  v_profile_id text;
begin
  if p_storage_path is null
    or p_storage_path !~ ('^verification-video/' || p_tailor_user_id::text || '/challenge_[a-zA-Z0-9_-]+_[0-9]+\.(mp4|mov|webm)$')
  then
    raise exception 'Invalid trust verification video path.' using errcode = '22023';
  end if;

  select *
    into v_handoff
  from public.identity_verification_handoffs
  where id = p_handoff_id
    and tailor_user_id = p_tailor_user_id
  for update;

  if v_handoff.id is null then
    raise exception 'Verification handoff session was not found.' using errcode = 'P0001';
  end if;
  if v_handoff.expires_at <= v_now then
    update public.identity_verification_handoffs
    set status = 'EXPIRED'
    where id = p_handoff_id;
    raise exception 'Verification handoff session has expired.' using errcode = 'P0001';
  end if;
  if v_handoff.status not in ('OPENED', 'CAPTURED') then
    raise exception 'Verification handoff session is not ready to submit.' using errcode = 'P0001';
  end if;
  if nullif(trim(v_handoff.challenge_id), '') is null
    or nullif(trim(v_handoff.challenge_text), '') is null then
    raise exception 'Verification challenge is missing. Start a new session.' using errcode = 'P0001';
  end if;

  select id, id_verification_status
    into v_profile
  from public.tailor_profiles
  where user_id::text = p_tailor_user_id::text
  for update;

  if v_profile.id is null then
    raise exception 'Complete your tailor profile before trust verification.' using errcode = 'P0001';
  end if;
  if v_profile.id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED') then
    raise exception 'Trust verification is already pending or approved.' using errcode = 'P0001';
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);

  update public.identity_verification_handoffs
  set
    status = 'SUBMITTED',
    submitted_at = v_now,
    storage_path = p_storage_path,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'submitted_by', p_tailor_user_id,
      'evidence_type', 'CHALLENGE_VIDEO'
    )
  where id = p_handoff_id;

  update public.tailor_profiles
  set
    trust_verification_video_path = p_storage_path,
    trust_verification_challenge_id = v_handoff.challenge_id,
    trust_verification_challenge_text = v_handoff.challenge_text,
    id_verification_method = 'CHALLENGE_VIDEO',
    id_verification_handoff_id = p_handoff_id,
    id_verification_submitted_at = v_now,
    id_verification_status = 'PENDING',
    id_verification_rejection_reason = null,
    id_verification_rejected_at = null,
    id_verification_metadata = (
      coalesce(id_verification_metadata, '{}'::jsonb)
      - 'rejection_reason' - 'rejection_code' - 'rejected_at'
    ) || jsonb_build_object(
      'verification_type', 'CHALLENGE_VIDEO',
      'challenge_id', v_handoff.challenge_id,
      'government_id_collected', false,
      'automated_biometrics', false
    ),
    updated_at = v_now
  where user_id::text = p_tailor_user_id::text
  returning id::text into v_profile_id;

  return query select v_profile_id, 'PENDING'::text;
end;
$$;

revoke all on function public.submit_identity_verification_handoff(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff(uuid, uuid, text)
  to service_role;

create or replace function public.submit_identity_verification_handoff_with_consent(
  p_handoff_id uuid,
  p_tailor_user_id uuid,
  p_storage_path text,
  p_policy_version text,
  p_source text,
  p_locale text default null
)
returns table (
  profile_id text,
  status text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_profile_id public.tailor_profiles.id%type;
  v_consent_copy text;
  v_consent_hash text;
begin
  if p_source not in ('MOBILE_SETUP', 'WEB_SETUP', 'MOBILE_HANDOFF', 'WEB_HANDOFF') then
    raise exception 'Invalid trust verification consent source.' using errcode = '22023';
  end if;

  select id into v_profile_id
  from public.tailor_profiles
  where user_id::text = p_tailor_user_id::text
  for update;

  if v_profile_id is null then
    raise exception 'Complete your tailor profile before trust verification.' using errcode = 'P0001';
  end if;

  select consent_copy into v_consent_copy
  from public.identity_consent_policies
  where policy_version = p_policy_version
    and is_active = true
    and effective_at <= now()
    and retired_at is null;

  if v_consent_copy is null then
    raise exception 'Trust verification consent policy is unavailable. Refresh setup and try again.' using errcode = 'P0001';
  end if;

  v_consent_hash := encode(digest(convert_to(v_consent_copy, 'UTF8'), 'sha256'), 'hex');

  insert into public.identity_verification_consents (
    tailor_user_id,
    tailor_profile_id,
    handoff_id,
    policy_version,
    consent_text_hash,
    source,
    locale,
    metadata
  )
  values (
    p_tailor_user_id,
    v_profile_id,
    p_handoff_id,
    p_policy_version,
    v_consent_hash,
    p_source,
    nullif(trim(p_locale), ''),
    jsonb_build_object(
      'evidence_type', 'CHALLENGE_VIDEO',
      'government_id_collected', false,
      'automated_biometrics', false
    )
  );

  insert into public.identity_retention_records (tailor_user_id, tailor_profile_id)
  values (p_tailor_user_id, v_profile_id)
  on conflict (tailor_profile_id) do nothing;

  return query
  select submitted.profile_id, submitted.status
  from public.submit_identity_verification_handoff(
    p_handoff_id,
    p_tailor_user_id,
    p_storage_path
  ) as submitted;
end;
$$;

revoke all on function public.submit_identity_verification_handoff_with_consent(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff_with_consent(uuid, uuid, text, text, text, text)
  to service_role;

-- Keep the compatibility flags consumed by older clients synchronized while
-- marketplace trust review moves from ID evidence to a private challenge video.
drop function if exists public.ops_decide_verification(uuid, text);
drop function if exists public.ops_decide_verification(uuid, text, text);
drop function if exists public.ops_decide_verification(uuid, text, text, text);

create or replace function public.ops_decide_verification(
  p_tailor_user_id uuid,
  p_decision text,
  p_reason text default null,
  p_rejection_code text default null
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rejection_code text := nullif(upper(btrim(coalesce(p_rejection_code, ''))), '');
begin
  if p_decision = 'APPROVE' then
    v_status := 'VERIFIED';
    v_rejection_code := null;
  elsif p_decision = 'REJECT' then
    v_status := 'REJECTED';
    if v_rejection_code is not null and v_rejection_code not in ('INVALID_PROFILE_IMAGE') then
      raise exception 'Invalid verification rejection code: %', v_rejection_code using errcode = '22023';
    end if;
    if v_rejection_code = 'INVALID_PROFILE_IMAGE' and v_reason is null then
      v_reason := 'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.';
    end if;
  else
    raise exception 'Invalid verification decision: %', p_decision using errcode = '22023';
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);

  update public.tailor_profiles
  set
    id_verification_status = v_status,
    id_verification_method = 'CHALLENGE_VIDEO',
    is_verified = (p_decision = 'APPROVE'),
    is_live = (p_decision = 'APPROVE'),
    id_verified_at = case when p_decision = 'APPROVE' then coalesce(id_verified_at, v_now) else null end,
    id_verification_rejection_reason = case when p_decision = 'REJECT' then v_reason else null end,
    id_verification_rejected_at = case when p_decision = 'REJECT' then v_now else null end,
    id_verification_metadata = case
      when p_decision = 'REJECT' then coalesce(id_verification_metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'verification_type', 'CHALLENGE_VIDEO',
        'rejection_reason', v_reason,
        'rejection_code', v_rejection_code,
        'rejected_at', v_now,
        'government_id_collected', false,
        'automated_biometrics', false
      ))
      else (coalesce(id_verification_metadata, '{}'::jsonb) - 'rejection_reason' - 'rejection_code' - 'rejected_at') || jsonb_build_object(
        'verification_type', 'CHALLENGE_VIDEO',
        'government_id_collected', false,
        'automated_biometrics', false
      )
    end,
    updated_at = v_now
  where user_id::text = p_tailor_user_id::text
    and id_verification_status = 'PENDING'
  returning id::uuid, display_name into v_profile_id, v_display_name;

  if v_profile_id is null then
    raise exception 'Tailor verification is no longer pending.' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    null,
    'OPS',
    null,
    'tailor.verification_decided',
    case when p_decision = 'APPROVE' then 'info' else 'warn' end,
    jsonb_build_object(
      'tailor_user_id', p_tailor_user_id,
      'tailor_profile_id', v_profile_id,
      'display_name', v_display_name,
      'decision', p_decision,
      'status', v_status,
      'reason', v_reason,
      'rejection_code', v_rejection_code,
      'verification_type', 'CHALLENGE_VIDEO',
      'decided_at', v_now
    )
  );

  return query select v_profile_id, v_status;
end;
$$;

revoke all on function public.ops_decide_verification(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ops_decide_verification(uuid, text, text, text)
  to service_role;
