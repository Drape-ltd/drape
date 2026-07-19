-- Additive identity trust foundation. Retention enforcement intentionally stays
-- disabled until counsel and payment providers approve a concrete policy.

alter table public.tailor_profiles
  add column if not exists legal_name text,
  add column if not exists payout_name_match_status text not null default 'NOT_CHECKED',
  add column if not exists payout_name_match_checked_at timestamptz,
  add column if not exists payout_name_match_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tailor_profiles'::regclass
      and conname = 'tailor_profiles_payout_name_match_status_check'
  ) then
    alter table public.tailor_profiles
      add constraint tailor_profiles_payout_name_match_status_check
      check (payout_name_match_status in ('NOT_CHECKED', 'MATCH', 'REVIEW_REQUIRED', 'MISMATCH'));
  end if;
end $$;

create table if not exists public.identity_consent_policies (
  policy_version text primary key,
  purpose text not null,
  consent_copy text not null,
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.identity_consent_policies (
  policy_version,
  purpose,
  consent_copy,
  is_active,
  metadata
)
values (
  'identity-verification-v1',
  'Identity verification, marketplace safety, and fraud prevention',
  'I consent to Drapeon processing my legal name and live identity selfie for account verification, marketplace safety, and fraud prevention. Identity media stays private, is limited to authorized trust review, and is retained or erased under Drapeon''s published privacy and legal obligations.',
  true,
  jsonb_build_object('privacy_url', 'https://drapeon.co/privacy')
)
on conflict (policy_version) do nothing;

do $$
declare
  v_profile_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_profile_id_type
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'tailor_profiles'
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_profile_id_type is null then
    raise exception 'Could not resolve public.tailor_profiles.id type for identity trust migration.';
  end if;

  execute format($table$
    create table if not exists public.identity_verification_consents (
      id uuid primary key default gen_random_uuid(),
      tailor_user_id uuid not null references public.users(id) on delete cascade,
      tailor_profile_id %s not null references public.tailor_profiles(id) on delete cascade,
      handoff_id uuid not null unique references public.identity_verification_handoffs(id) on delete restrict,
      policy_version text not null references public.identity_consent_policies(policy_version) on delete restrict,
      consent_text_hash text not null,
      source text not null check (source in ('MOBILE_SETUP', 'WEB_SETUP', 'MOBILE_HANDOFF', 'WEB_HANDOFF')),
      locale text,
      metadata jsonb not null default '{}'::jsonb,
      consented_at timestamptz not null default now()
    )
  $table$, v_profile_id_type);
end $$;

create index if not exists identity_verification_consents_user_idx
  on public.identity_verification_consents (tailor_user_id, consented_at desc);

create table if not exists public.identity_retention_policies (
  policy_key text not null,
  policy_version text not null,
  retention_interval interval,
  enforcement_enabled boolean not null default false,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (policy_key, policy_version)
);

insert into public.identity_retention_policies (
  policy_key,
  policy_version,
  retention_interval,
  enforcement_enabled,
  metadata
)
values (
  'seller_identity',
  'pending-legal-signoff',
  null,
  false,
  jsonb_build_object('note', 'Duration and enforcement require legal and provider approval.')
)
on conflict (policy_key, policy_version) do nothing;

do $$
declare
  v_profile_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_profile_id_type
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'tailor_profiles'
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  execute format($table$
    create table if not exists public.identity_retention_records (
      id uuid primary key default gen_random_uuid(),
      tailor_user_id uuid not null references public.users(id) on delete cascade,
      tailor_profile_id %s not null unique references public.tailor_profiles(id) on delete cascade,
      policy_key text not null default 'seller_identity',
      policy_version text not null default 'pending-legal-signoff',
      state text not null default 'ACTIVE'
        check (state in ('ACTIVE', 'RESTRICTED_PROCESSING', 'LEGAL_HOLD', 'ERASURE_DUE', 'ERASED')),
      retention_due_at timestamptz,
      restricted_at timestamptz,
      legal_hold_until timestamptz,
      legal_hold_reason text,
      erasure_completed_at timestamptz,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (policy_key, policy_version)
        references public.identity_retention_policies(policy_key, policy_version)
        on delete restrict
    )
  $table$, v_profile_id_type);
end $$;

create index if not exists identity_retention_records_state_due_idx
  on public.identity_retention_records (state, retention_due_at)
  where state <> 'ERASED';

do $$
declare
  v_profile_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_profile_id_type
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'tailor_profiles'
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  execute format($table$
    create table if not exists public.identity_document_access_log (
      id uuid primary key default gen_random_uuid(),
      tailor_user_id uuid not null references public.users(id) on delete cascade,
      tailor_profile_id %s not null references public.tailor_profiles(id) on delete cascade,
      actor_id uuid references public.users(id) on delete restrict,
      actor_identifier text not null,
      actor_role text not null,
      access_reason text not null,
      document_path text not null,
      metadata jsonb not null default '{}'::jsonb,
      accessed_at timestamptz not null default now()
    )
  $table$, v_profile_id_type);
end $$;

create index if not exists identity_document_access_log_profile_idx
  on public.identity_document_access_log (tailor_profile_id, accessed_at desc);

alter table public.identity_consent_policies enable row level security;
alter table public.identity_verification_consents enable row level security;
alter table public.identity_retention_policies enable row level security;
alter table public.identity_retention_records enable row level security;
alter table public.identity_document_access_log enable row level security;

revoke all on public.identity_consent_policies from anon, authenticated;
revoke all on public.identity_verification_consents from anon, authenticated;
revoke all on public.identity_retention_policies from anon, authenticated;
revoke all on public.identity_retention_records from anon, authenticated;
revoke all on public.identity_document_access_log from anon, authenticated;

grant all on public.identity_consent_policies to service_role;
grant all on public.identity_verification_consents to service_role;
grant all on public.identity_retention_policies to service_role;
grant all on public.identity_retention_records to service_role;
grant all on public.identity_document_access_log to service_role;
grant select on public.identity_verification_consents to authenticated;
grant select on public.identity_retention_records to authenticated;

create policy "identity consents: owner can read"
  on public.identity_verification_consents
  for select
  to authenticated
  using (tailor_user_id = auth.uid());

create policy "identity retention: owner can read"
  on public.identity_retention_records
  for select
  to authenticated
  using (tailor_user_id = auth.uid());

create or replace function public.prevent_locked_legal_name_edits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('drape.identity_verification_trusted_write', true), '') = 'true' then
    return new;
  end if;

  if coalesce(old.id_verification_status, '') in ('PENDING', 'VERIFIED', 'APPROVED')
    and new.legal_name is distinct from old.legal_name
  then
    raise exception 'Verified legal name changes require trust review.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_locked_legal_name_edits on public.tailor_profiles;
create trigger trg_prevent_locked_legal_name_edits
before update of legal_name on public.tailor_profiles
for each row execute function public.prevent_locked_legal_name_edits();

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
  where user_id = p_tailor_user_id
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

revoke all on function public.submit_identity_verification_handoff_with_consent(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_identity_verification_handoff_with_consent(uuid, uuid, text, text, text, text)
  to service_role;

comment on table public.identity_document_access_log is
  'Append-only audit trail for authorized access to private identity documents. actor_identifier covers workforce identities that are not marketplace users.';
comment on table public.identity_retention_policies is
  'Retention duration is configuration. Enforcement remains disabled until legal and provider approval.';
