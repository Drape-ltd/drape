-- Persist identity verification rejection context for tailor-facing retake guidance.
-- Also exposes handoff session status to the owning authenticated user so the
-- desktop QR card can react when the phone opens the handoff.

alter table public.tailor_profiles
  add column if not exists id_verification_rejection_reason text,
  add column if not exists id_verification_rejected_at timestamptz,
  add column if not exists id_verification_metadata jsonb not null default '{}'::jsonb;

alter table public.tailor_profiles
  drop constraint if exists tailor_profiles_id_verification_metadata_object_check;

alter table public.tailor_profiles
  add constraint tailor_profiles_id_verification_metadata_object_check
  check (jsonb_typeof(id_verification_metadata) = 'object');

comment on column public.tailor_profiles.id_verification_rejection_reason is
  'Tailor-facing trust review note explaining why the latest identity selfie was rejected.';
comment on column public.tailor_profiles.id_verification_metadata is
  'Non-sensitive identity verification metadata safe for account setup UI context.';

grant select on table public.identity_verification_handoffs to authenticated;

drop policy if exists "identity handoffs: owner can read status" on public.identity_verification_handoffs;
create policy "identity handoffs: owner can read status"
  on public.identity_verification_handoffs
  for select
  to authenticated
  using (tailor_user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.identity_verification_handoffs;
exception
  when duplicate_object then null;
end $$;

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
    id_verification_rejection_reason = null,
    id_verification_rejected_at = null,
    id_verification_metadata = coalesce(id_verification_metadata, '{}'::jsonb) - 'rejection_reason' - 'rejected_at',
    updated_at = v_now
  where user_id = p_tailor_user_id
  returning id into v_profile_id;

  return query
  select v_profile_id, 'PENDING'::text;
end;
$$;

revoke all on function public.submit_identity_verification_handoff(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff(uuid, uuid, text) to service_role;

drop function if exists public.ops_decide_verification(uuid, text);

create or replace function public.ops_decide_verification(
  p_tailor_user_id uuid,
  p_decision text,
  p_reason text default null
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
    id_verified_at = case when p_decision = 'APPROVE' then coalesce(id_verified_at, v_now) else null end,
    id_verification_rejection_reason = case when p_decision = 'REJECT' then v_reason else null end,
    id_verification_rejected_at = case when p_decision = 'REJECT' then v_now else null end,
    id_verification_metadata = case
      when p_decision = 'REJECT' then coalesce(id_verification_metadata, '{}'::jsonb) || jsonb_build_object(
        'rejection_reason', v_reason,
        'rejected_at', v_now
      )
      else coalesce(id_verification_metadata, '{}'::jsonb) - 'rejection_reason' - 'rejected_at'
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
      'decided_at', v_now
    )
  );

  return query
  select v_profile_id, v_status;
end;
$$;

revoke all on function public.ops_decide_verification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ops_decide_verification(uuid, text, text) to service_role;
