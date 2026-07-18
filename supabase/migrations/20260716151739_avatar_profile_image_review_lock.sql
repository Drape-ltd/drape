-- Fold public avatar review into the identity verification lifecycle.
-- Users can fix rejected profile images, but pending/approved identity evidence stays locked
-- unless a trusted verification server path opts into the local transaction bypass.

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
    if new.avatar_url is distinct from old.avatar_url
      or new.id_document_url is distinct from old.id_document_url
      or new.id_selfie_document_url is distinct from old.id_selfie_document_url
      or new.id_verification_status is distinct from old.id_verification_status
      or new.id_verified_at is distinct from old.id_verified_at
      or new.id_verification_method is distinct from old.id_verification_method
      or new.id_verification_handoff_id is distinct from old.id_verification_handoff_id
      or new.id_verification_rejection_reason is distinct from old.id_verification_rejection_reason
      or new.id_verification_rejected_at is distinct from old.id_verification_rejected_at
      or new.id_verification_metadata is distinct from old.id_verification_metadata
    then
      raise exception 'Identity verification fields are locked while review is pending or approved.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

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

  update tailor_profiles
  set
    id_verification_status = v_status,
    is_live = (p_decision = 'APPROVE'),
    id_verified_at = case when p_decision = 'APPROVE' then coalesce(id_verified_at, v_now) else null end,
    id_verification_rejection_reason = case when p_decision = 'REJECT' then v_reason else null end,
    id_verification_rejected_at = case when p_decision = 'REJECT' then v_now else null end,
    id_verification_metadata = case
      when p_decision = 'REJECT' then coalesce(id_verification_metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'rejection_reason', v_reason,
        'rejection_code', v_rejection_code,
        'rejected_at', v_now
      ))
      else coalesce(id_verification_metadata, '{}'::jsonb) - 'rejection_reason' - 'rejection_code' - 'rejected_at'
    end
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
    'tailor.verification_decided',
    'info',
    jsonb_build_object(
      'tailor_user_id', p_tailor_user_id,
      'tailor_profile_id', v_profile_id,
      'display_name', v_display_name,
      'decision', p_decision,
      'status', v_status,
      'reason', v_reason,
      'rejection_code', v_rejection_code,
      'decided_at', v_now
    )
  );

  return query
  select v_profile_id, v_status;
end;
$$;

revoke all on function public.ops_decide_verification(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ops_decide_verification(uuid, text, text, text) to service_role;
