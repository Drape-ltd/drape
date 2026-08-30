-- Operational workflow for the communications control plane. This migration
-- intentionally extends the foundation rather than rewriting its captured
-- contract.

alter table public.communication_campaigns
  add column if not exists required_approvals integer not null default 1 check (required_approvals between 1 and 2),
  add column if not exists created_by_email text,
  add column if not exists last_error text,
  add column if not exists recipient_count integer not null default 0 check (recipient_count >= 0),
  add column if not exists delivered_count integer not null default 0 check (delivered_count >= 0),
  add column if not exists failed_count integer not null default 0 check (failed_count >= 0),
  add column if not exists skipped_count integer not null default 0 check (skipped_count >= 0);

alter table public.communication_campaign_approvals
  alter column reviewer_id drop not null,
  add column if not exists reviewer_email text;

create unique index if not exists communication_campaign_approvals_campaign_reviewer_email_key
  on public.communication_campaign_approvals (campaign_id, lower(reviewer_email))
  where reviewer_email is not null;

alter table public.communication_campaign_recipients
  add column if not exists channels text[] not null default array['IN_APP']::text[],
  add column if not exists queued_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.communication_campaign_recipients
  drop constraint if exists communication_campaign_recipients_channels_check;
alter table public.communication_campaign_recipients
  add constraint communication_campaign_recipients_channels_check
  check (channels <@ array['IN_APP','PUSH','EMAIL','SMS']::text[] and 'IN_APP' = any(channels));

create or replace function public.require_communications_service_role()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Communications control-plane access requires service role';
  end if;
end;
$$;

create or replace function public.refresh_communication_campaign_status(p_campaign_id uuid)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.communication_campaigns;
  v_total integer;
  v_delivered integer;
  v_failed integer;
  v_skipped integer;
  v_active integer;
begin
  perform public.require_communications_service_role();

  select count(*),
    count(*) filter (where status in ('DELIVERED','PARTIAL')),
    count(*) filter (where status in ('FAILED','DEAD')),
    count(*) filter (where status = 'SKIPPED'),
    count(*) filter (where status in ('PENDING','QUEUED','SENDING'))
  into v_total, v_delivered, v_failed, v_skipped, v_active
  from public.communication_campaign_recipients
  where campaign_id = p_campaign_id;

  update public.communication_campaigns
  set recipient_count = v_total,
      delivered_count = v_delivered,
      failed_count = v_failed,
      skipped_count = v_skipped,
      status = case
        when status in ('CANCELLED','PAUSED') then status
        when v_total = 0 then 'FAILED'
        when v_active = 0 and v_failed = v_total then 'FAILED'
        when v_active = 0 then 'COMPLETED'
        when scheduled_at is not null and scheduled_at > now() then 'SCHEDULED'
        else 'SENDING'
      end,
      completed_at = case when v_active = 0 then coalesce(completed_at, now()) else null end,
      last_error = case when v_total = 0 then 'No eligible recipients were found in the explicit audience.' else last_error end
  where id = p_campaign_id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.ops_create_communication_campaign(
  p_name text,
  p_kind text,
  p_category text,
  p_purpose text,
  p_severity text,
  p_subject text,
  p_title text,
  p_body text,
  p_audience_definition jsonb,
  p_channel_policy jsonb,
  p_destination jsonb,
  p_acknowledgement_required boolean,
  p_risk_level text,
  p_scheduled_at timestamptz,
  p_expires_at timestamptz,
  p_actor_id uuid,
  p_actor_email text,
  p_commercial_campaign_id uuid default null
)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_template_version_id uuid;
  v_campaign public.communication_campaigns;
  v_template_key text;
  v_required integer;
  v_user_ids jsonb := coalesce(p_audience_definition->'user_ids', '[]'::jsonb);
  v_roles jsonb := coalesce(p_audience_definition->'roles', '[]'::jsonb);
  v_unknown_channels text[];
begin
  perform public.require_communications_service_role();

  if nullif(trim(p_name), '') is null or nullif(trim(p_title), '') is null or nullif(trim(p_body), '') is null then
    raise exception 'Name, title, and body are required';
  end if;
  if nullif(trim(p_actor_email), '') is null then
    raise exception 'The campaign creator email is required for independent approval';
  end if;
  if jsonb_typeof(v_user_ids) <> 'array' or jsonb_typeof(v_roles) <> 'array'
     or (jsonb_array_length(v_user_ids) = 0 and jsonb_array_length(v_roles) = 0) then
    raise exception 'An explicit audience of user_ids or roles is required';
  end if;
  if p_kind = 'PROMOTION' and (p_purpose <> 'MARKETING' or p_commercial_campaign_id is null) then
    raise exception 'Promotions require MARKETING purpose and an approved commercial campaign';
  end if;
  if p_kind = 'PROMOTION' and not exists (
    select 1 from public.commercial_campaigns cc
    where cc.id = p_commercial_campaign_id and cc.status = 'ACTIVE'
  ) then
    raise exception 'Promotions require an active, reviewed commercial campaign';
  end if;
  if jsonb_typeof(coalesce(p_channel_policy->'channels', '[]'::jsonb)) <> 'array' then
    raise exception 'Communication channels must be an array';
  end if;
  select coalesce(array_agg(value), array[]::text[])
  into v_unknown_channels
  from jsonb_array_elements_text(coalesce(p_channel_policy->'channels', '["IN_APP"]'::jsonb))
  where value not in ('IN_APP','PUSH','EMAIL','SMS');
  if cardinality(v_unknown_channels) > 0 then
    raise exception 'Unsupported communication channels: %', array_to_string(v_unknown_channels, ', ');
  end if;
  if p_expires_at is not null and p_expires_at <= coalesce(p_scheduled_at, now()) then
    raise exception 'Expiry must be after the scheduled delivery time';
  end if;

  v_required := case
    when p_kind = 'PROMOTION'
      or p_risk_level in ('HIGH','CRITICAL')
      or p_severity = 'CRITICAL'
      or jsonb_array_length(v_roles) > 0
    then 2 else 1 end;
  v_template_key := 'OPS_CAMPAIGN_' || upper(replace(gen_random_uuid()::text, '-', ''));

  insert into public.communication_templates(template_key, category, purpose, description)
  values (v_template_key, p_category, p_purpose, 'Immutable Ops-authored campaign template')
  returning id into v_template_id;

  insert into public.communication_template_versions(
    template_id, version, locale, status, subject_template, title_template,
    body_template, channel_content, variable_schema, created_by, published_by, published_at
  ) values (
    v_template_id, 1, 'en', 'PUBLISHED', nullif(trim(p_subject), ''), trim(p_title),
    trim(p_body), '{}'::jsonb, '{}'::jsonb, p_actor_id, p_actor_id, now()
  ) returning id into v_template_version_id;

  insert into public.communication_campaigns(
    name, kind, category, purpose, severity, status, template_version_id,
    commercial_campaign_id, audience_definition, channel_policy, destination,
    acknowledgement_required, risk_level, scheduled_at, expires_at, created_by,
    created_by_email, required_approvals
  ) values (
    trim(p_name), p_kind, p_category, p_purpose, p_severity, 'PENDING_APPROVAL',
    v_template_version_id, p_commercial_campaign_id, p_audience_definition,
    p_channel_policy, p_destination, coalesce(p_acknowledgement_required, false),
    p_risk_level, p_scheduled_at, p_expires_at, p_actor_id, lower(trim(p_actor_email)), v_required
  ) returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.ops_review_communication_campaign(
  p_campaign_id uuid,
  p_decision text,
  p_reason text,
  p_reviewer_id uuid,
  p_reviewer_email text
)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.communication_campaigns;
  v_approvals integer;
begin
  perform public.require_communications_service_role();
  select * into v_campaign from public.communication_campaigns where id = p_campaign_id for update;
  if v_campaign.id is null then raise exception 'Campaign not found'; end if;
  if v_campaign.status not in ('PENDING_APPROVAL','APPROVED') then raise exception 'Campaign is not awaiting review'; end if;
  if lower(trim(coalesce(p_reviewer_email, ''))) = lower(trim(coalesce(v_campaign.created_by_email, '')))
     or (p_reviewer_id is not null and p_reviewer_id = v_campaign.created_by) then
    raise exception 'The campaign creator cannot approve their own campaign';
  end if;
  if p_decision not in ('APPROVE','REJECT') or nullif(trim(p_reason), '') is null then
    raise exception 'A review decision and reason are required';
  end if;
  if nullif(trim(p_reviewer_email), '') is null then
    raise exception 'Reviewer email is required for the independent approval trail';
  end if;

  insert into public.communication_campaign_approvals(campaign_id, reviewer_id, reviewer_email, decision, reason)
  values (p_campaign_id, p_reviewer_id, lower(trim(p_reviewer_email)), p_decision, trim(p_reason));

  if p_decision = 'REJECT' then
    update public.communication_campaigns set status = 'CANCELLED', completed_at = now(), last_error = trim(p_reason)
    where id = p_campaign_id returning * into v_campaign;
    return v_campaign;
  end if;

  select count(*) into v_approvals from public.communication_campaign_approvals
  where campaign_id = p_campaign_id and decision = 'APPROVE';
  if v_approvals >= v_campaign.required_approvals then
    update public.communication_campaigns
    set status = case when scheduled_at is not null and scheduled_at > now() then 'SCHEDULED' else 'APPROVED' end,
        approved_at = now()
    where id = p_campaign_id returning * into v_campaign;
  else
    select * into v_campaign from public.communication_campaigns where id = p_campaign_id;
  end if;
  return v_campaign;
end;
$$;

create or replace function public.ops_publish_communication_campaign(
  p_campaign_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.communication_campaigns;
  v_user record;
  v_channels text[];
  v_requested text[];
  v_channel text;
  v_allowed boolean;
  v_pref boolean;
  v_consent text;
  v_recipient_id uuid;
begin
  perform public.require_communications_service_role();
  select * into v_campaign from public.communication_campaigns where id = p_campaign_id for update;
  if v_campaign.id is null then raise exception 'Campaign not found'; end if;
  if v_campaign.status not in ('APPROVED','SCHEDULED') then raise exception 'Campaign requires all independent approvals before publishing'; end if;
  if v_campaign.expires_at is not null and v_campaign.expires_at <= now() then raise exception 'Campaign has expired'; end if;
  if exists (select 1 from public.communication_campaign_recipients where campaign_id = p_campaign_id) then
    raise exception 'Campaign audience has already been frozen';
  end if;

  select coalesce(array_agg(distinct value), array[]::text[])
  into v_requested
  from jsonb_array_elements_text(coalesce(v_campaign.channel_policy->'channels', '["IN_APP"]'::jsonb));
  v_requested := array_append(array_remove(v_requested, 'IN_APP'), 'IN_APP');
  if v_campaign.purpose <> 'MARKETING' and (v_campaign.severity in ('WARNING','CRITICAL') or v_campaign.acknowledgement_required) then
    v_requested := array(select distinct unnest(v_requested || array['PUSH','EMAIL']::text[]));
  end if;

  for v_user in
    select u.id, u.email, u.phone,
      upper(coalesce(u.raw_user_meta_data->>'role', u.raw_app_meta_data->>'role', 'CUSTOMER')) as role
    from auth.users u
    where (
      (v_campaign.audience_definition ? 'user_ids' and u.id::text in (
        select value from jsonb_array_elements_text(v_campaign.audience_definition->'user_ids')
      ))
      or
      (v_campaign.audience_definition ? 'roles' and upper(coalesce(u.raw_user_meta_data->>'role', u.raw_app_meta_data->>'role', 'CUSTOMER')) in (
        select upper(value) from jsonb_array_elements_text(v_campaign.audience_definition->'roles')
      ))
    )
  loop
    v_channels := array['IN_APP']::text[];
    foreach v_channel in array v_requested loop
      if v_channel = 'IN_APP' then continue; end if;
      v_allowed := true;

      select cp.enabled into v_pref
      from public.communication_preferences cp
      where cp.user_id = v_user.id and cp.category = v_campaign.category and cp.channel = v_channel;
      if v_pref is false then v_allowed := false; end if;

      if v_campaign.purpose = 'MARKETING' then
        select cc.status into v_consent
        from public.communication_consents cc
        where cc.user_id = v_user.id and cc.purpose = 'MARKETING' and cc.channel = v_channel
        order by cc.created_at desc limit 1;
        if v_consent is distinct from 'GRANTED' then v_allowed := false; end if;
      end if;

      if exists (
        select 1 from public.communication_suppressions cs
        where cs.user_id = v_user.id and cs.channel = v_channel and cs.active
          and cs.purpose in (v_campaign.purpose, 'ALL_OPTIONAL')
      ) then v_allowed := false; end if;
      if v_channel = 'EMAIL' and v_user.email is null then v_allowed := false; end if;
      if v_channel = 'SMS' and v_user.phone is null then v_allowed := false; end if;

      if v_allowed and not (v_channel = any(v_channels)) then v_channels := array_append(v_channels, v_channel); end if;
    end loop;

    insert into public.communication_campaign_recipients(
      campaign_id, user_id, audience_snapshot, consent_snapshot, channels, status, queued_at
    ) values (
      p_campaign_id, v_user.id,
      jsonb_build_object('email', v_user.email, 'phone', v_user.phone, 'role', v_user.role),
      jsonb_build_object('purpose', v_campaign.purpose, 'channels', to_jsonb(v_channels), 'captured_at', now()),
      v_channels, 'QUEUED', now()
    ) returning id into v_recipient_id;

    perform public.enqueue_domain_event(
      'COMMUNICATION_CAMPAIGN_RECIPIENT_QUEUED', 'COMMUNICATION_CAMPAIGN_RECIPIENT',
      'communication-recipient:' || v_recipient_id::text,
      jsonb_build_object('recipientId', v_recipient_id), v_recipient_id::text,
      p_actor_id, 'OPS', null,
      jsonb_build_object('campaign_id', p_campaign_id, 'actor_email', p_actor_email),
      array['SEND_COMMUNICATION_CAMPAIGN']::text[],
      case when v_campaign.severity = 'CRITICAL' then 10 else 60 end,
      6,
      greatest(coalesce(v_campaign.scheduled_at, now()), now())
    );
  end loop;

  update public.communication_campaigns
  set status = case when scheduled_at is not null and scheduled_at > now() then 'SCHEDULED' else 'SENDING' end,
      started_at = case when scheduled_at is null or scheduled_at <= now() then coalesce(started_at, now()) else started_at end
  where id = p_campaign_id returning * into v_campaign;
  return public.refresh_communication_campaign_status(p_campaign_id);
end;
$$;

create or replace function public.record_communication_recipient_channel_outcome(
  p_recipient_id uuid,
  p_channel text,
  p_status text,
  p_reason text default null,
  p_provider text default null,
  p_provider_reference text default null,
  p_terminal boolean default true
)
returns public.communication_campaign_recipients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient public.communication_campaign_recipients;
  v_channel text := upper(trim(coalesce(p_channel, '')));
  v_status text := upper(trim(coalesce(p_status, '')));
  v_outcome jsonb;
begin
  perform public.require_communications_service_role();
  if v_channel not in ('IN_APP','PUSH','EMAIL','SMS') then
    raise exception 'Unsupported communication channel';
  end if;
  if v_status not in ('DELIVERED','SENT','SKIPPED','FAILED') then
    raise exception 'Unsupported communication channel outcome';
  end if;

  v_outcome := jsonb_strip_nulls(jsonb_build_object(
    'status', v_status,
    'reason', nullif(trim(p_reason), ''),
    'provider', nullif(trim(p_provider), ''),
    'provider_reference', nullif(trim(p_provider_reference), ''),
    'terminal', coalesce(p_terminal, true),
    'recorded_at', now()
  ));

  update public.communication_campaign_recipients
  set channel_outcomes = jsonb_set(coalesce(channel_outcomes, '{}'::jsonb), array[v_channel], v_outcome, true),
      updated_at = now()
  where id = p_recipient_id
  returning * into v_recipient;
  if v_recipient.id is null then raise exception 'Communication recipient not found'; end if;
  return v_recipient;
end;
$$;

create or replace function public.ops_cancel_communication_campaign(
  p_campaign_id uuid,
  p_reason text
)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare v_campaign public.communication_campaigns;
begin
  perform public.require_communications_service_role();
  if nullif(trim(p_reason), '') is null then raise exception 'Cancellation reason is required'; end if;
  update public.communication_campaigns
  set status = 'CANCELLED', completed_at = now(), last_error = trim(p_reason)
  where id = p_campaign_id and status not in ('COMPLETED','CANCELLED')
  returning * into v_campaign;
  if v_campaign.id is null then raise exception 'Campaign is already terminal or does not exist'; end if;
  update public.communication_campaign_recipients
  set status = 'SKIPPED', completed_at = now(), updated_at = now()
  where campaign_id = p_campaign_id and status in ('PENDING','QUEUED');
  return v_campaign;
end;
$$;

create or replace function public.ops_upsert_service_incident(
  p_incident_key text,
  p_title text,
  p_summary text,
  p_severity text,
  p_status text,
  p_affected_services text[],
  p_public_visible boolean,
  p_acknowledgement_required boolean,
  p_destination jsonb,
  p_source text,
  p_source_reference text,
  p_started_at timestamptz
)
returns public.service_incidents
language plpgsql
security definer
set search_path = public
as $$
declare v_incident public.service_incidents;
begin
  perform public.require_communications_service_role();
  insert into public.service_incidents(
    incident_key,title,summary,severity,status,affected_services,public_visible,
    acknowledgement_required,destination,source,source_reference,started_at,resolved_at
  ) values (
    trim(p_incident_key),trim(p_title),trim(p_summary),p_severity,p_status,
    coalesce(p_affected_services,array[]::text[]),coalesce(p_public_visible,false),
    coalesce(p_acknowledgement_required,false),coalesce(p_destination,'{}'::jsonb),
    p_source,p_source_reference,coalesce(p_started_at,now()),
    case when p_status = 'RESOLVED' then now() else null end
  )
  on conflict (incident_key) do update set
    title=excluded.title,summary=excluded.summary,severity=excluded.severity,status=excluded.status,
    affected_services=excluded.affected_services,public_visible=excluded.public_visible,
    acknowledgement_required=excluded.acknowledgement_required,destination=excluded.destination,
    source=excluded.source,source_reference=excluded.source_reference,
    resolved_at=case when excluded.status='RESOLVED' then coalesce(service_incidents.resolved_at,now()) else null end
  returning * into v_incident;
  return v_incident;
end;
$$;

revoke all on function public.require_communications_service_role() from public, anon, authenticated;
revoke all on function public.refresh_communication_campaign_status(uuid) from public, anon, authenticated;
revoke all on function public.ops_create_communication_campaign(text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,text,timestamptz,timestamptz,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.ops_review_communication_campaign(uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.ops_publish_communication_campaign(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.record_communication_recipient_channel_outcome(uuid,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.ops_cancel_communication_campaign(uuid,text) from public, anon, authenticated;
revoke all on function public.ops_upsert_service_incident(text,text,text,text,text,text[],boolean,boolean,jsonb,text,text,timestamptz) from public, anon, authenticated;

grant execute on function public.require_communications_service_role() to service_role;
grant execute on function public.refresh_communication_campaign_status(uuid) to service_role;
grant execute on function public.ops_create_communication_campaign(text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,text,timestamptz,timestamptz,uuid,text,uuid) to service_role;
grant execute on function public.ops_review_communication_campaign(uuid,text,text,uuid,text) to service_role;
grant execute on function public.ops_publish_communication_campaign(uuid,uuid,text) to service_role;
grant execute on function public.record_communication_recipient_channel_outcome(uuid,text,text,text,text,text,boolean) to service_role;
grant execute on function public.ops_cancel_communication_campaign(uuid,text) to service_role;
grant execute on function public.ops_upsert_service_incident(text,text,text,text,text,text[],boolean,boolean,jsonb,text,text,timestamptz) to service_role;
