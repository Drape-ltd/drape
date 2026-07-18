drop function if exists public.submit_identity_verification_handoff(uuid, uuid, text);

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
    or p_storage_path !~ ('^id-verification/' || p_tailor_user_id::text || '/selfie_[0-9]+\.jpe?g$')
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
    id_verification_status
  into v_profile
  from tailor_profiles
  where user_id::text = p_tailor_user_id::text
  for update;

  if v_profile.id is null then
    raise exception 'Complete your tailor profile before identity verification.' using errcode = 'P0001';
  end if;

  if v_profile.id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED') then
    raise exception 'Identity verification is already pending or approved.' using errcode = 'P0001';
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
    id_verification_rejection_reason = null,
    id_verification_rejected_at = null,
    id_verification_metadata = coalesce(id_verification_metadata, '{}'::jsonb) - 'rejection_reason' - 'rejection_code' - 'rejected_at',
    updated_at = v_now
  where user_id::text = p_tailor_user_id::text
  returning id into v_profile_id;

  return query
  select v_profile_id, 'PENDING'::text;
end;
$$;

revoke all on function public.submit_identity_verification_handoff(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff(uuid, uuid, text) to service_role;
