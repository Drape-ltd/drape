-- Tailor verification shadow-review queues.
-- Approved tailors keep vetted live storefront/payout data until ops approves
-- sensitive public-profile or payout destination changes.

create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references auth.users(id) on delete cascade,
  tailor_profile_id text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED')),
  requested_changes jsonb not null default '{}'::jsonb,
  field_statuses jsonb not null default '{}'::jsonb,
  rejection_code text,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_change_requests_requested_changes_object_check
    check (jsonb_typeof(requested_changes) = 'object'),
  constraint profile_change_requests_field_statuses_object_check
    check (jsonb_typeof(field_statuses) = 'object'),
  constraint profile_change_requests_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists profile_change_requests_one_pending_per_tailor_idx
  on public.profile_change_requests (tailor_user_id)
  where status = 'PENDING';

create index if not exists profile_change_requests_profile_status_idx
  on public.profile_change_requests (tailor_profile_id, status, updated_at desc);

alter table public.profile_change_requests enable row level security;
revoke all on public.profile_change_requests from public, anon, authenticated;
grant select on public.profile_change_requests to authenticated;
grant all on public.profile_change_requests to service_role;

drop policy if exists "profile change requests: owner can read" on public.profile_change_requests;
create policy "profile change requests: owner can read"
  on public.profile_change_requests
  for select
  to authenticated
  using (tailor_user_id = auth.uid());

drop trigger if exists profile_change_requests_updated_at on public.profile_change_requests;
create trigger profile_change_requests_updated_at
before update on public.profile_change_requests
for each row execute function public.handle_updated_at();

create table if not exists public.payout_change_requests (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references auth.users(id) on delete cascade,
  tailor_profile_id text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  current_destination jsonb not null default '{}'::jsonb,
  requested_destination jsonb not null default '{}'::jsonb,
  rejection_code text,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_change_requests_current_destination_object_check
    check (jsonb_typeof(current_destination) = 'object'),
  constraint payout_change_requests_requested_destination_object_check
    check (jsonb_typeof(requested_destination) = 'object'),
  constraint payout_change_requests_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists payout_change_requests_one_pending_per_tailor_idx
  on public.payout_change_requests (tailor_user_id)
  where status = 'PENDING';

create index if not exists payout_change_requests_profile_status_idx
  on public.payout_change_requests (tailor_profile_id, status, updated_at desc);

alter table public.payout_change_requests enable row level security;
revoke all on public.payout_change_requests from public, anon, authenticated;
grant select on public.payout_change_requests to authenticated;
grant all on public.payout_change_requests to service_role;

drop policy if exists "payout change requests: owner can read" on public.payout_change_requests;
create policy "payout change requests: owner can read"
  on public.payout_change_requests
  for select
  to authenticated
  using (tailor_user_id = auth.uid());

drop trigger if exists payout_change_requests_updated_at on public.payout_change_requests;
create trigger payout_change_requests_updated_at
before update on public.payout_change_requests
for each row execute function public.handle_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.profile_change_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payout_change_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create or replace function public.prevent_locked_identity_field_edits()
returns trigger
language plpgsql
as $$
declare
  trusted boolean := coalesce(current_setting('drape.identity_verification_trusted_write', true), '') = 'true';
  status text := coalesce(old.id_verification_status, '');
begin
  if trusted then
    return new;
  end if;

  if status in ('PENDING', 'VERIFIED', 'APPROVED') and (
    new.avatar_url is distinct from old.avatar_url
    or new.id_document_url is distinct from old.id_document_url
    or new.id_selfie_document_url is distinct from old.id_selfie_document_url
    or new.id_verification_status is distinct from old.id_verification_status
    or new.id_verified_at is distinct from old.id_verified_at
    or new.id_verification_method is distinct from old.id_verification_method
    or new.id_verification_handoff_id is distinct from old.id_verification_handoff_id
    or new.id_verification_rejection_reason is distinct from old.id_verification_rejection_reason
    or new.id_verification_rejected_at is distinct from old.id_verification_rejected_at
    or new.id_verification_metadata is distinct from old.id_verification_metadata
  ) then
    raise exception 'Identity verification fields are locked while verification is pending or approved.' using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED') and (
    new.display_name is distinct from old.display_name
    or new.bio is distinct from old.bio
    or new.location is distinct from old.location
    or new.languages is distinct from old.languages
    or new.specialty_tags is distinct from old.specialty_tags
    or new.currency is distinct from old.currency
  ) then
    raise exception 'Approved public profile fields must go through profile change review.' using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED') and (
    exists (
      select 1
      from unnest(coalesce(new.portfolio_photo_urls, '{}'::text[])) as pending_url
      where not pending_url = any(coalesce(old.portfolio_photo_urls, '{}'::text[]))
    )
    or exists (
      select 1
      from unnest(coalesce(new.portfolio_video_urls, '{}'::text[])) as pending_url
      where not pending_url = any(coalesce(old.portfolio_video_urls, '{}'::text[]))
    )
  ) then
    raise exception 'Approved portfolio media additions or replacements must go through profile change review.' using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED') and (
    new.payout_currency is distinct from old.payout_currency
    or new.payout_provider is distinct from old.payout_provider
    or new.payout_account_type is distinct from old.payout_account_type
    or new.payout_account_verified is distinct from old.payout_account_verified
    or new.payout_account_verified_at is distinct from old.payout_account_verified_at
    or new.payout_reverification_required is distinct from old.payout_reverification_required
    or new.payout_bank_name is distinct from old.payout_bank_name
    or new.payout_bank_code is distinct from old.payout_bank_code
    or new.payout_account_name is distinct from old.payout_account_name
    or new.payout_account_masked is distinct from old.payout_account_masked
    or new.payout_country_code is distinct from old.payout_country_code
    or new.paystack_recipient_code is distinct from old.paystack_recipient_code
    or new.paystack_account_id is distinct from old.paystack_account_id
    or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id
    or new.stripe_account_id is distinct from old.stripe_account_id
    or new.manual_bank_entry is distinct from old.manual_bank_entry
    or new.manual_bank_name is distinct from old.manual_bank_name
    or new.manual_bank_country_code is distinct from old.manual_bank_country_code
    or new.manual_bank_country_name is distinct from old.manual_bank_country_name
    or new.manual_bank_swift_bic is distinct from old.manual_bank_swift_bic
    or new.manual_bank_account_number is distinct from old.manual_bank_account_number
    or new.manual_bank_account_name is distinct from old.manual_bank_account_name
    or new.manual_bank_verification_status is distinct from old.manual_bank_verification_status
  ) then
    raise exception 'Approved payout destination fields must go through payout change review.' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_prevent_locked_identity_field_edits on public.tailor_profiles;
create trigger trg_prevent_locked_identity_field_edits
before update on public.tailor_profiles
for each row
execute function public.prevent_locked_identity_field_edits();

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

-- Keep the live selfie handoff RPC lint-safe on projects where tailor_profiles.user_id
-- is text while handoff/user parameters are uuid.
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
