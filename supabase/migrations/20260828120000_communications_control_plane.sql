-- One durable communications control plane for mobile, web, email, push, SMS,
-- Ops, and public service status. Domain systems remain authoritative and emit
-- events; this schema owns consent, audience, inbox, rendering, and delivery.

create table public.communication_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('ORDER','MESSAGE','PAYMENT','PAYOUT','ACCOUNT','SECURITY','SUPPORT','SAFETY','SERVICE_STATUS','PROMOTION','PRODUCT_UPDATE')),
  channel text not null check (channel in ('IN_APP','PUSH','EMAIL','SMS')),
  enabled boolean not null,
  source text not null default 'ACCOUNT_SETTINGS' check (source in ('ACCOUNT_SETTINGS','ONBOARDING','LEGACY_MIGRATION','OPS','SYSTEM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, channel),
  check (channel <> 'IN_APP' or enabled)
);

create table public.communication_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose = 'MARKETING'),
  channel text not null check (channel in ('PUSH','EMAIL','SMS')),
  status text not null check (status in ('GRANTED','REVOKED')),
  source text not null check (source in ('ACCOUNT_SETTINGS','ONBOARDING','CHECKOUT','CAMPAIGN','OPS','SYSTEM')),
  policy_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index communication_consents_current_idx
  on public.communication_consents (user_id, purpose, channel, created_at desc);

create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique check (template_key ~ '^[A-Z0-9_]{3,120}$'),
  category text not null check (category in ('ORDER','MESSAGE','PAYMENT','PAYOUT','ACCOUNT','SECURITY','SUPPORT','SAFETY','SERVICE_STATUS','PROMOTION','PRODUCT_UPDATE')),
  purpose text not null check (purpose in ('TRANSACTIONAL','OPERATIONAL','MARKETING')),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.communication_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.communication_templates(id) on delete restrict,
  version integer not null check (version > 0),
  locale text not null default 'en',
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','RETIRED')),
  subject_template text,
  title_template text not null,
  body_template text not null,
  channel_content jsonb not null default '{}'::jsonb,
  variable_schema jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, version, locale),
  check (status <> 'PUBLISHED' or published_at is not null)
);

create unique index communication_template_one_published_locale_idx
  on public.communication_template_versions (template_id, locale)
  where status = 'PUBLISHED';

create table public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('PSA','SERVICE_STATUS','PRODUCT_UPDATE','PROMOTION')),
  category text not null check (category in ('SERVICE_STATUS','PROMOTION','PRODUCT_UPDATE','SAFETY','SUPPORT','ACCOUNT')),
  purpose text not null check (purpose in ('TRANSACTIONAL','OPERATIONAL','MARKETING')),
  severity text not null default 'NOTICE' check (severity in ('INFO','NOTICE','WARNING','CRITICAL')),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','SENDING','COMPLETED','PAUSED','CANCELLED','FAILED')),
  template_version_id uuid not null references public.communication_template_versions(id) on delete restrict,
  commercial_campaign_id uuid references public.commercial_campaigns(id) on delete restrict,
  audience_definition jsonb not null default '{}'::jsonb,
  channel_policy jsonb not null default '{}'::jsonb,
  destination jsonb not null default '{}'::jsonb,
  acknowledgement_required boolean not null default false,
  risk_level text not null default 'LOW' check (risk_level in ('LOW','MEDIUM','HIGH','CRITICAL')),
  scheduled_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or scheduled_at is null or expires_at > scheduled_at),
  check (kind <> 'PROMOTION' or (purpose = 'MARKETING' and commercial_campaign_id is not null))
);

create table public.communication_campaign_approvals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.communication_campaigns(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('APPROVE','REJECT')),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, reviewer_id)
);

create table public.communication_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.communication_campaigns(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  audience_snapshot jsonb not null default '{}'::jsonb,
  consent_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','QUEUED','SENDING','DELIVERED','PARTIAL','SKIPPED','FAILED','DEAD')),
  channel_outcomes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create table public.communication_inbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('ORDER','MESSAGE','PAYMENT','PAYOUT','ACCOUNT','SECURITY','SUPPORT','SAFETY','SERVICE_STATUS','PROMOTION','PRODUCT_UPDATE')),
  purpose text not null check (purpose in ('TRANSACTIONAL','OPERATIONAL','MARKETING')),
  severity text not null default 'NOTICE' check (severity in ('INFO','NOTICE','WARNING','CRITICAL')),
  title text not null,
  body text not null,
  destination_key text not null,
  destination_params jsonb not null default '{}'::jsonb,
  media jsonb not null default '[]'::jsonb,
  source_event_id uuid,
  campaign_id uuid references public.communication_campaigns(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  acknowledgement_required boolean not null default false,
  deduplication_key text,
  read_at timestamptz,
  acknowledged_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(destination_params) = 'object'),
  check (jsonb_typeof(media) = 'array')
);

create unique index communication_inbox_dedup_idx
  on public.communication_inbox (recipient_id, deduplication_key)
  where deduplication_key is not null;
create index communication_inbox_recipient_unread_idx
  on public.communication_inbox (recipient_id, created_at desc)
  where read_at is null;

create table public.communication_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  address_hash text,
  purpose text not null check (purpose in ('TRANSACTIONAL','OPERATIONAL','MARKETING','ALL_OPTIONAL')),
  channel text not null check (channel in ('PUSH','EMAIL','SMS')),
  reason text not null check (reason in ('USER_REQUEST','HARD_BOUNCE','COMPLAINT','INVALID_DESTINATION','STOP','OPS','PROVIDER')),
  provider_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  check (user_id is not null or address_hash is not null)
);

create index communication_suppressions_lookup_idx
  on public.communication_suppressions (user_id, channel, purpose)
  where active;

create table public.communication_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  channel text not null check (channel in ('PUSH','EMAIL','SMS','STATUS')),
  signature_verified boolean not null,
  payload_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','QUEUED','PROCESSING','PROCESSED','RETRY','DEAD','IGNORED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  processed_at timestamptz,
  last_error text,
  correlation_id uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index communication_provider_events_worker_idx
  on public.communication_provider_events (status, next_attempt_at, received_at)
  where status in ('RECEIVED','QUEUED','RETRY');

create table public.service_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_key text not null unique,
  title text not null,
  summary text not null,
  severity text not null check (severity in ('INFO','NOTICE','WARNING','CRITICAL')),
  status text not null check (status in ('INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED')),
  affected_services text[] not null default '{}',
  public_visible boolean not null default false,
  acknowledgement_required boolean not null default false,
  destination jsonb not null default '{}'::jsonb,
  source text not null check (source in ('DRAPEON_OPS','CLOUDFLARE','SUPABASE','SENTRY','PROVIDER')),
  source_reference text,
  started_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'RESOLVED') = (resolved_at is not null))
);

create or replace function public.touch_communication_row_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger communication_preferences_touch before update on public.communication_preferences
for each row execute function public.touch_communication_row_updated_at();
create trigger communication_campaigns_touch before update on public.communication_campaigns
for each row execute function public.touch_communication_row_updated_at();
create trigger communication_campaign_recipients_touch before update on public.communication_campaign_recipients
for each row execute function public.touch_communication_row_updated_at();
create trigger service_incidents_touch before update on public.service_incidents
for each row execute function public.touch_communication_row_updated_at();

alter table public.communication_preferences enable row level security;
alter table public.communication_consents enable row level security;
alter table public.communication_templates enable row level security;
alter table public.communication_template_versions enable row level security;
alter table public.communication_campaigns enable row level security;
alter table public.communication_campaign_approvals enable row level security;
alter table public.communication_campaign_recipients enable row level security;
alter table public.communication_inbox enable row level security;
alter table public.communication_suppressions enable row level security;
alter table public.communication_provider_events enable row level security;
alter table public.service_incidents enable row level security;

create policy communication_preferences_own_read on public.communication_preferences
for select to authenticated using (user_id = auth.uid());
create policy communication_consents_own_read on public.communication_consents
for select to authenticated using (user_id = auth.uid());
create policy communication_inbox_own_read on public.communication_inbox
for select to authenticated using (recipient_id = auth.uid());
create policy service_incidents_public_read on public.service_incidents
for select to anon, authenticated using (public_visible);

revoke all on public.communication_preferences, public.communication_consents,
  public.communication_templates, public.communication_template_versions,
  public.communication_campaigns, public.communication_campaign_approvals,
  public.communication_campaign_recipients, public.communication_inbox,
  public.communication_suppressions, public.communication_provider_events,
  public.service_incidents from anon, authenticated;
grant select on public.communication_preferences, public.communication_consents,
  public.communication_inbox to authenticated;
grant select on public.service_incidents to anon, authenticated;
grant all on public.communication_preferences, public.communication_consents,
  public.communication_templates, public.communication_template_versions,
  public.communication_campaigns, public.communication_campaign_approvals,
  public.communication_campaign_recipients, public.communication_inbox,
  public.communication_suppressions, public.communication_provider_events,
  public.service_incidents to service_role;

create or replace function public.set_my_communication_preference(
  p_category text,
  p_channel text,
  p_enabled boolean,
  p_source text default 'ACCOUNT_SETTINGS'
) returns public.communication_preferences
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_row public.communication_preferences;
  v_marketing boolean := p_category in ('PROMOTION','PRODUCT_UPDATE');
  v_consented boolean := false;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_category not in ('ORDER','MESSAGE','PAYMENT','PAYOUT','ACCOUNT','SECURITY','SUPPORT','SAFETY','SERVICE_STATUS','PROMOTION','PRODUCT_UPDATE') then raise exception 'INVALID_CATEGORY'; end if;
  if p_channel not in ('IN_APP','PUSH','EMAIL','SMS') then raise exception 'INVALID_CHANNEL'; end if;
  if p_channel = 'IN_APP' and not p_enabled then raise exception 'INBOX_REQUIRED'; end if;
  if not p_enabled and p_category in ('PAYMENT','PAYOUT','ACCOUNT','SECURITY','SUPPORT','SAFETY','SERVICE_STATUS') then raise exception 'MANDATORY_COMMUNICATION'; end if;

  if v_marketing and p_enabled and p_channel <> 'IN_APP' then
    select coalesce((
      select status = 'GRANTED' from public.communication_consents
      where user_id = v_user and purpose = 'MARKETING' and channel = p_channel
      order by created_at desc limit 1
    ), false) into v_consented;
    if not v_consented then raise exception 'MARKETING_CONSENT_REQUIRED'; end if;
  end if;

  insert into public.communication_preferences(user_id, category, channel, enabled, source)
  values (v_user, p_category, p_channel, p_enabled, p_source)
  on conflict (user_id, category, channel) do update
    set enabled = excluded.enabled, source = excluded.source, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_my_marketing_consent(
  p_channel text,
  p_granted boolean,
  p_policy_version text,
  p_source text default 'ACCOUNT_SETTINGS',
  p_evidence jsonb default '{}'::jsonb
) returns public.communication_consents
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_row public.communication_consents;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_channel not in ('PUSH','EMAIL','SMS') then raise exception 'INVALID_MARKETING_CHANNEL'; end if;
  if nullif(trim(p_policy_version), '') is null then raise exception 'POLICY_VERSION_REQUIRED'; end if;

  insert into public.communication_consents(user_id, purpose, channel, status, source, policy_version, evidence)
  values (v_user, 'MARKETING', p_channel, case when p_granted then 'GRANTED' else 'REVOKED' end, p_source, p_policy_version, coalesce(p_evidence, '{}'::jsonb))
  returning * into v_row;

  insert into public.communication_preferences(user_id, category, channel, enabled, source)
  select v_user, category, p_channel, p_granted, p_source
  from (values ('PROMOTION'), ('PRODUCT_UPDATE')) as x(category)
  on conflict (user_id, category, channel) do update
    set enabled = excluded.enabled, source = excluded.source, updated_at = now();

  return v_row;
end;
$$;

create or replace function public.mark_my_communication_inbox(
  p_inbox_id uuid,
  p_action text
) returns public.communication_inbox
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_row public.communication_inbox;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('READ','UNREAD','ACKNOWLEDGED') then raise exception 'INVALID_INBOX_ACTION'; end if;

  update public.communication_inbox
  set read_at = case when p_action = 'UNREAD' then null else coalesce(read_at, now()) end,
      acknowledged_at = case when p_action = 'ACKNOWLEDGED' then coalesce(acknowledged_at, now()) else acknowledged_at end
  where id = p_inbox_id and recipient_id = v_user
  returning * into v_row;
  if v_row.id is null then raise exception 'INBOX_ITEM_NOT_FOUND'; end if;
  return v_row;
end;
$$;

revoke all on function public.set_my_communication_preference(text,text,boolean,text) from public;
revoke all on function public.set_my_marketing_consent(text,boolean,text,text,jsonb) from public;
revoke all on function public.mark_my_communication_inbox(uuid,text) from public;
grant execute on function public.set_my_communication_preference(text,text,boolean,text) to authenticated;
grant execute on function public.set_my_marketing_consent(text,boolean,text,text,jsonb) to authenticated;
grant execute on function public.mark_my_communication_inbox(uuid,text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.communication_inbox;
exception when duplicate_object then null;
end $$;

comment on table public.communication_inbox is 'Durable user-visible communications. destination_params must contain identifiers, never signed URLs or secrets.';
comment on table public.communication_provider_events is 'Verified, deduplicated callback inbox. Payload must be redacted before persistence.';
