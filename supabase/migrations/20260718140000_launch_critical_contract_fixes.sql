-- Forward fixes for routines introduced by the launch-critical negotiation and
-- identity migrations. The development schema stores marketplace IDs as text,
-- while auth identities and quote IDs remain UUIDs.

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
    raise exception 'Invalid identity consent source.' using errcode = '22023';
  end if;

  select id
    into v_profile_id
  from public.tailor_profiles
  where user_id::text = p_tailor_user_id::text
  for update;

  if v_profile_id is null then
    raise exception 'Complete your tailor profile before identity verification.' using errcode = 'P0001';
  end if;

  select consent_copy
    into v_consent_copy
  from public.identity_consent_policies
  where policy_version = p_policy_version
    and is_active = true
    and effective_at <= now()
    and retired_at is null;

  if v_consent_copy is null then
    raise exception 'Identity consent policy is unavailable. Refresh setup and try again.' using errcode = 'P0001';
  end if;

  v_consent_hash := encode(digest(convert_to(v_consent_copy, 'UTF8'), 'sha256'), 'hex');

  insert into public.identity_verification_consents (
    tailor_user_id,
    tailor_profile_id,
    handoff_id,
    policy_version,
    consent_text_hash,
    source,
    locale
  )
  values (
    p_tailor_user_id,
    v_profile_id,
    p_handoff_id,
    p_policy_version,
    v_consent_hash,
    p_source,
    nullif(trim(p_locale), '')
  );

  insert into public.identity_retention_records (
    tailor_user_id,
    tailor_profile_id
  )
  values (
    p_tailor_user_id,
    v_profile_id
  )
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

create or replace function public.decline_order_after_quote_revision(
  p_order_id text,
  p_tailor_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer,
  p_revision_request_id uuid,
  p_response_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_revision public.quote_revision_requests%rowtype;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
    and tailor_id::text = p_tailor_id::text
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.stage::text <> 'QUOTE_SENT' then
    raise exception 'QUOTE_NEGOTIATION_NOT_AVAILABLE';
  end if;
  if v_order.active_quote_id is distinct from p_quote_id
     or v_order.active_quote_version is distinct from p_expected_quote_version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  select *
    into v_quote
  from public.order_quotes
  where id = p_quote_id
    and order_id::text = p_order_id
    and version = p_expected_quote_version
    and status = 'ACTIVE'
  for update;

  select *
    into v_revision
  from public.quote_revision_requests
  where id = p_revision_request_id
    and order_id::text = p_order_id
    and source_quote_id = p_quote_id
    and source_quote_version = p_expected_quote_version
    and status = 'OPEN'
  for update;

  if v_quote.id is null or v_revision.id is null then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  perform *
  from public.finalize_order_terminal(
    v_order.id::uuid,
    'DECLINED',
    p_tailor_id::text,
    'TAILOR',
    'order.stage_changed',
    coalesce(nullif(trim(p_response_note), ''), 'Tailor declined after reviewing the quote change request.'),
    jsonb_build_object(
      'action', 'decline-after-revision',
      'from_stage', v_order.stage::text,
      'to_stage', 'DECLINED',
      'quote_id', p_quote_id,
      'quote_version', p_expected_quote_version,
      'revision_request_id', p_revision_request_id
    ),
    array['QUOTE_SENT']::text[]
  );

  update public.order_quotes
  set status = 'DECLINED'
  where id = p_quote_id;

  update public.quote_revision_requests
  set status = 'ORDER_DECLINED',
      responded_by = p_tailor_id,
      response_note = nullif(trim(p_response_note), ''),
      responded_at = now(),
      updated_at = now()
  where id = p_revision_request_id;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_DECLINED',
    p_tailor_id,
    'TAILOR',
    'Quote declined',
    'quote-declined:' || p_quote_id::text,
    nullif(trim(p_response_note), ''),
    p_quote_id,
    p_expected_quote_version,
    p_revision_request_id,
    jsonb_build_object('source', 'QUOTE_NEGOTIATION')
  );

  return jsonb_build_object(
    'quoteId', p_quote_id,
    'quoteVersion', p_expected_quote_version,
    'revisionRequestId', p_revision_request_id,
    'eventId', v_event_id,
    'stage', 'DECLINED'
  );
end;
$$;

revoke all on function public.submit_identity_verification_handoff_with_consent(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff_with_consent(uuid, uuid, text, text, text, text)
  to service_role;

revoke all on function public.decline_order_after_quote_revision(text, uuid, uuid, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decline_order_after_quote_revision(text, uuid, uuid, integer, uuid, text)
  to service_role;
