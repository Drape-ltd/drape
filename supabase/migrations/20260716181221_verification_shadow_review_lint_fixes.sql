-- Lint-safe overrides for verification shadow review functions applied after
-- 20260716174001 reached dev with profile ids typed as text.

create or replace function public.ops_decide_profile_change_request(
  p_request_id uuid,
  p_decision text,
  p_field_statuses jsonb default '{}'::jsonb,
  p_rejection_code text default null,
  p_reason text default null,
  p_reviewed_by text default null
)
returns table (
  id uuid,
  status text,
  tailor_user_id uuid,
  tailor_profile_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.profile_change_requests%rowtype;
  changes jsonb;
  v_field_statuses jsonb := coalesce(p_field_statuses, '{}'::jsonb);
  final_status text;
  approved_count integer := 0;
  rejected_count integer := 0;
begin
  if upper(trim(coalesce(p_decision, ''))) not in ('APPROVE', 'REJECT') then
    raise exception 'Invalid profile change decision.' using errcode = '22023';
  end if;

  select * into req
  from public.profile_change_requests
  where profile_change_requests.id = p_request_id
  for update;

  if not found then
    raise exception 'Profile change request not found.' using errcode = 'P0001';
  end if;

  if req.status <> 'PENDING' then
    raise exception 'Profile change request is no longer pending.' using errcode = 'P0001';
  end if;

  perform 1
  from public.tailor_profiles
  where tailor_profiles.id = req.tailor_profile_id
  for update;

  if not found then
    raise exception 'Tailor profile not found.' using errcode = 'P0001';
  end if;

  changes := req.requested_changes;

  if upper(trim(p_decision)) = 'APPROVE' then
    select count(*) into approved_count
    from jsonb_object_keys(changes) as key
    where coalesce(upper(v_field_statuses ->> key), 'APPROVED') = 'APPROVED';

    select count(*) into rejected_count
    from jsonb_object_keys(changes) as key
    where upper(v_field_statuses ->> key) = 'REJECTED';

    perform set_config('drape.identity_verification_trusted_write', 'true', true);

    update public.tailor_profiles
    set
      avatar_url = case when changes ? 'avatar_url' and coalesce(upper(v_field_statuses ->> 'avatar_url'), 'APPROVED') = 'APPROVED' then nullif(changes ->> 'avatar_url', '') else avatar_url end,
      display_name = case when changes ? 'display_name' and coalesce(upper(v_field_statuses ->> 'display_name'), 'APPROVED') = 'APPROVED' then nullif(changes ->> 'display_name', '') else display_name end,
      bio = case when changes ? 'bio' and coalesce(upper(v_field_statuses ->> 'bio'), 'APPROVED') = 'APPROVED' then nullif(changes ->> 'bio', '') else bio end,
      location = case when changes ? 'location' and coalesce(upper(v_field_statuses ->> 'location'), 'APPROVED') = 'APPROVED' then nullif(changes ->> 'location', '') else location end,
      currency = case when changes ? 'currency' and coalesce(upper(v_field_statuses ->> 'currency'), 'APPROVED') = 'APPROVED' then nullif(changes ->> 'currency', '')::currency else currency end,
      price_range_min = case when changes ? 'price_range_min' and coalesce(upper(v_field_statuses ->> 'price_range_min'), 'APPROVED') = 'APPROVED' then (changes ->> 'price_range_min')::integer else price_range_min end,
      price_range_max = case when changes ? 'price_range_max' and coalesce(upper(v_field_statuses ->> 'price_range_max'), 'APPROVED') = 'APPROVED' then (changes ->> 'price_range_max')::integer else price_range_max end,
      languages = case
        when changes ? 'languages' and coalesce(upper(v_field_statuses ->> 'languages'), 'APPROVED') = 'APPROVED'
          then array(select jsonb_array_elements_text(coalesce(changes -> 'languages', '[]'::jsonb)))
        else languages
      end,
      specialty_tags = case
        when changes ? 'specialty_tags' and coalesce(upper(v_field_statuses ->> 'specialty_tags'), 'APPROVED') = 'APPROVED'
          then array(select jsonb_array_elements_text(coalesce(changes -> 'specialty_tags', '[]'::jsonb)))
        else specialty_tags
      end,
      portfolio_photo_urls = case
        when changes ? 'portfolio_photo_urls' and coalesce(upper(v_field_statuses ->> 'portfolio_photo_urls'), 'APPROVED') = 'APPROVED'
          then array(select jsonb_array_elements_text(coalesce(changes -> 'portfolio_photo_urls', '[]'::jsonb)))
        else portfolio_photo_urls
      end,
      portfolio_video_urls = case
        when changes ? 'portfolio_video_urls' and coalesce(upper(v_field_statuses ->> 'portfolio_video_urls'), 'APPROVED') = 'APPROVED'
          then array(select jsonb_array_elements_text(coalesce(changes -> 'portfolio_video_urls', '[]'::jsonb)))
        else portfolio_video_urls
      end,
      updated_at = now()
    where tailor_profiles.id = req.tailor_profile_id;

    if changes ? 'portfolio_item_upserts'
      and coalesce(upper(v_field_statuses ->> 'portfolio_item_upserts'), 'APPROVED') = 'APPROVED' then
      insert into public.portfolio_items (
        id,
        tailor_profile_id,
        image_url,
        title,
        description,
        category,
        sort_order
      )
      select
        coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid()),
        req.tailor_profile_id,
        nullif(item ->> 'image_url', ''),
        nullif(item ->> 'title', ''),
        nullif(item ->> 'description', ''),
        nullif(item ->> 'category', ''),
        coalesce(nullif(item ->> 'sort_order', '')::integer, 0)
      from jsonb_array_elements(coalesce(changes -> 'portfolio_item_upserts', '[]'::jsonb)) as item
      where nullif(item ->> 'image_url', '') is not null
        and nullif(item ->> 'title', '') is not null
      on conflict on constraint portfolio_items_pkey do update
        set image_url = excluded.image_url,
            title = excluded.title,
            description = excluded.description,
            category = excluded.category,
            sort_order = excluded.sort_order
        where public.portfolio_items.tailor_profile_id = req.tailor_profile_id;

      update public.tailor_profiles
      set portfolio_photo_urls = coalesce((
            select array_agg(image_url order by sort_order asc, created_at asc)
            from public.portfolio_items
            where public.portfolio_items.tailor_profile_id = req.tailor_profile_id
          ), '{}'::text[]),
          updated_at = now()
      where tailor_profiles.id = req.tailor_profile_id;
    end if;

    final_status := case
      when approved_count > 0 and rejected_count > 0 then 'PARTIALLY_APPROVED'
      when approved_count > 0 then 'APPROVED'
      else 'REJECTED'
    end;
  else
    final_status := 'REJECTED';
  end if;

  update public.profile_change_requests
  set status = final_status,
      field_statuses = v_field_statuses,
      rejection_code = p_rejection_code,
      rejection_reason = p_reason,
      reviewed_at = now(),
      reviewed_by = p_reviewed_by,
      updated_at = now()
  where profile_change_requests.id = req.id;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    null,
    'OPS',
    'tailor_profile_change.decision',
    'info',
    jsonb_build_object(
      'request_id', req.id,
      'tailor_user_id', req.tailor_user_id,
      'tailor_profile_id', req.tailor_profile_id,
      'decision', p_decision,
      'status', final_status,
      'rejection_code', p_rejection_code
    )
  );

  return query select req.id, final_status, req.tailor_user_id, req.tailor_profile_id;
end $$;

revoke all on function public.ops_decide_profile_change_request(uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.ops_decide_profile_change_request(uuid, text, jsonb, text, text, text) to service_role;

create or replace function public.ops_decide_payout_change_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_code text default null,
  p_reason text default null,
  p_reviewed_by text default null
)
returns table (
  id uuid,
  status text,
  tailor_user_id uuid,
  tailor_profile_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.payout_change_requests%rowtype;
  dest jsonb;
  final_status text;
begin
  if upper(trim(coalesce(p_decision, ''))) not in ('APPROVE', 'REJECT') then
    raise exception 'Invalid payout change decision.' using errcode = '22023';
  end if;

  select * into req
  from public.payout_change_requests
  where payout_change_requests.id = p_request_id
  for update;

  if not found then
    raise exception 'Payout change request not found.' using errcode = 'P0001';
  end if;

  if req.status <> 'PENDING' then
    raise exception 'Payout change request is no longer pending.' using errcode = 'P0001';
  end if;

  perform 1
  from public.tailor_profiles
  where tailor_profiles.id = req.tailor_profile_id
  for update;

  if not found then
    raise exception 'Tailor profile not found.' using errcode = 'P0001';
  end if;

  if upper(trim(p_decision)) = 'APPROVE' then
    dest := req.requested_destination;
    perform set_config('drape.identity_verification_trusted_write', 'true', true);

    update public.tailor_profiles
    set
      payout_currency = coalesce(nullif(dest ->> 'payout_currency', '')::currency, payout_currency),
      payout_provider = coalesce(nullif(dest ->> 'payout_provider', '')::payment_provider, payout_provider),
      payout_account_type = case
        when nullif(dest ->> 'payout_account_type', '') is null then null
        else (dest ->> 'payout_account_type')::payout_account_type
      end,
      payout_account_verified = coalesce((dest ->> 'payout_account_verified')::boolean, false),
      payout_account_verified_at = case
        when (dest ->> 'payout_account_verified')::boolean is true then now()
        else null
      end,
      payout_reverification_required = coalesce((dest ->> 'payout_reverification_required')::boolean, true),
      payout_bank_name = nullif(dest ->> 'payout_bank_name', ''),
      payout_bank_code = nullif(dest ->> 'payout_bank_code', ''),
      payout_account_name = nullif(dest ->> 'payout_account_name', ''),
      payout_account_masked = nullif(dest ->> 'payout_account_masked', ''),
      payout_country_code = nullif(dest ->> 'payout_country_code', ''),
      paystack_recipient_code = nullif(dest ->> 'paystack_recipient_code', ''),
      paystack_account_id = nullif(dest ->> 'paystack_account_id', ''),
      stripe_connect_account_id = nullif(dest ->> 'stripe_connect_account_id', ''),
      stripe_account_id = nullif(dest ->> 'stripe_account_id', ''),
      manual_bank_entry = coalesce((dest ->> 'manual_bank_entry')::boolean, false),
      manual_bank_name = nullif(dest ->> 'manual_bank_name', ''),
      manual_bank_country_code = nullif(dest ->> 'manual_bank_country_code', ''),
      manual_bank_country_name = nullif(dest ->> 'manual_bank_country_name', ''),
      manual_bank_swift_bic = nullif(dest ->> 'manual_bank_swift_bic', ''),
      manual_bank_account_number = nullif(dest ->> 'manual_bank_account_number', ''),
      manual_bank_account_name = nullif(dest ->> 'manual_bank_account_name', ''),
      manual_bank_verification_status = nullif(dest ->> 'manual_bank_verification_status', ''),
      manual_bank_submitted_at = case when nullif(dest ->> 'manual_bank_verification_status', '') is not null then now() else null end,
      manual_bank_verified_at = null,
      manual_bank_verified_by = null,
      payout_account_change_count = coalesce(payout_account_change_count, 0) + 1,
      payout_account_last_changed_at = now(),
      payout_account_change_locked_until = now() + interval '7 days',
      payout_destination_hold_until = now() + interval '72 hours',
      updated_at = now()
    where tailor_profiles.id = req.tailor_profile_id;

    final_status := 'APPROVED';
  else
    final_status := 'REJECTED';
  end if;

  update public.payout_change_requests
  set status = final_status,
      rejection_code = p_rejection_code,
      rejection_reason = p_reason,
      reviewed_at = now(),
      reviewed_by = p_reviewed_by,
      updated_at = now()
  where payout_change_requests.id = req.id;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    null,
    'OPS',
    'tailor_payout_change.decision',
    'warn',
    jsonb_build_object(
      'request_id', req.id,
      'tailor_user_id', req.tailor_user_id,
      'tailor_profile_id', req.tailor_profile_id,
      'decision', p_decision,
      'status', final_status,
      'rejection_code', p_rejection_code
    )
  );

  return query select req.id, final_status, req.tailor_user_id, req.tailor_profile_id;
end $$;

revoke all on function public.ops_decide_payout_change_request(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ops_decide_payout_change_request(uuid, text, text, text, text) to service_role;

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
    id_verification_status,
    payout_account_verified,
    payout_reverification_required,
    paystack_recipient_code,
    stripe_connect_account_id,
    manual_bank_entry,
    manual_bank_verification_status
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