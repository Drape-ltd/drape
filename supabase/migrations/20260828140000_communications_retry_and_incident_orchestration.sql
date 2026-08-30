-- Durable recovery and incident orchestration for the communications control plane.
-- Paused campaigns do not consume worker retries, failed recipients can be replayed
-- independently, and a service incident can own one auditable customer campaign.

alter table public.service_incidents
  add column if not exists communication_campaign_id uuid
    references public.communication_campaigns(id) on delete set null;

create index if not exists service_incidents_communication_campaign_idx
  on public.service_incidents (communication_campaign_id)
  where communication_campaign_id is not null;

create or replace function public.enqueue_communication_recipient_job(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient public.communication_campaign_recipients;
  v_campaign public.communication_campaigns;
  v_event_id uuid;
begin
  perform public.require_communications_service_role();

  select * into v_recipient
  from public.communication_campaign_recipients
  where id = p_recipient_id;
  if v_recipient.id is null then raise exception 'Communication recipient not found'; end if;

  select * into v_campaign
  from public.communication_campaigns
  where id = v_recipient.campaign_id;
  if v_campaign.id is null then raise exception 'Communication campaign not found'; end if;

  v_event_id := public.enqueue_domain_event(
    p_event_type := 'COMMUNICATION_CAMPAIGN_RECIPIENT_QUEUED',
    p_aggregate_type := 'COMMUNICATION_CAMPAIGN_RECIPIENT',
    p_idempotency_key := 'communication-recipient:' || p_recipient_id::text || ':' || gen_random_uuid()::text,
    p_payload := jsonb_build_object('recipientId', p_recipient_id),
    p_aggregate_id := p_recipient_id::text,
    p_actor_id := p_actor_id,
    p_actor_role := 'OPS',
    p_order_id := null,
    p_metadata := jsonb_build_object(
      'campaign_id', v_campaign.id,
      'actor_email', lower(trim(coalesce(p_actor_email, 'system@drapeon.co'))),
      'reason', trim(coalesce(p_reason, 'OPS_RETRY'))
    ),
    p_jobs := array['SEND_COMMUNICATION_CAMPAIGN']::text[],
    p_priority := case when v_campaign.severity = 'CRITICAL' then 10 else 60 end,
    p_max_attempts := 6,
    p_run_at := greatest(coalesce(v_campaign.scheduled_at, now()), now())
  );

  return v_event_id;
end;
$$;

create or replace function public.ops_pause_communication_campaign(
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
  if nullif(trim(p_reason), '') is null then raise exception 'A pause reason is required'; end if;

  update public.communication_campaigns
  set status = 'PAUSED', last_error = trim(p_reason), completed_at = null
  where id = p_campaign_id and status in ('SCHEDULED','SENDING')
  returning * into v_campaign;
  if v_campaign.id is null then raise exception 'Only a scheduled or sending campaign can be paused'; end if;

  update public.job_queue j
  set run_at = now() + interval '100 years',
      last_error = 'CAMPAIGN_PAUSED: ' || trim(p_reason),
      updated_at = now()
  where j.job_type = 'SEND_COMMUNICATION_CAMPAIGN'
    and j.status in ('PENDING','RETRYABLE')
    and exists (
      select 1 from public.communication_campaign_recipients r
      where r.campaign_id = p_campaign_id
        and r.id::text = j.payload->>'recipientId'
    );

  return v_campaign;
end;
$$;

create or replace function public.ops_resume_communication_campaign(
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
  v_recipient record;
begin
  perform public.require_communications_service_role();

  update public.communication_campaigns
  set status = case when scheduled_at is not null and scheduled_at > now() then 'SCHEDULED' else 'SENDING' end,
      started_at = case when scheduled_at is null or scheduled_at <= now() then coalesce(started_at, now()) else started_at end,
      completed_at = null,
      last_error = null
  where id = p_campaign_id and status = 'PAUSED'
  returning * into v_campaign;
  if v_campaign.id is null then raise exception 'Only a paused campaign can be resumed'; end if;
  if v_campaign.expires_at is not null and v_campaign.expires_at <= now() then
    raise exception 'This campaign has expired and cannot be resumed';
  end if;

  for v_recipient in
    update public.communication_campaign_recipients
    set status = 'QUEUED', queued_at = now(), completed_at = null
    where campaign_id = p_campaign_id and status in ('PENDING','QUEUED','SENDING')
    returning id
  loop
    perform public.enqueue_communication_recipient_job(
      v_recipient.id, p_actor_id, p_actor_email, 'CAMPAIGN_RESUMED'
    );
  end loop;

  return public.refresh_communication_campaign_status(p_campaign_id);
end;
$$;

create or replace function public.ops_retry_communication_recipient(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_reason text
)
returns public.communication_campaign_recipients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient public.communication_campaign_recipients;
  v_campaign public.communication_campaigns;
  v_outcomes jsonb;
begin
  perform public.require_communications_service_role();
  if nullif(trim(p_reason), '') is null then raise exception 'A retry reason is required'; end if;

  select * into v_recipient from public.communication_campaign_recipients
  where id = p_recipient_id for update;
  if v_recipient.id is null then raise exception 'Communication recipient not found'; end if;
  if v_recipient.status not in ('FAILED','PARTIAL','DEAD') then
    raise exception 'Only a failed, partial, or dead recipient can be retried';
  end if;

  select * into v_campaign from public.communication_campaigns
  where id = v_recipient.campaign_id for update;
  if v_campaign.status in ('CANCELLED','PAUSED') then
    raise exception 'Resume the campaign before retrying this recipient';
  end if;
  if v_campaign.expires_at is not null and v_campaign.expires_at <= now() then
    raise exception 'This campaign has expired and cannot be retried';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_outcomes
  from jsonb_each(coalesce(v_recipient.channel_outcomes, '{}'::jsonb))
  where coalesce(value->>'status', '') not in ('FAILED','DEAD');

  update public.communication_campaign_recipients
  set status = 'QUEUED',
      channel_outcomes = coalesce(v_outcomes, '{}'::jsonb),
      queued_at = now(),
      completed_at = null
  where id = p_recipient_id
  returning * into v_recipient;

  update public.communication_campaigns
  set status = 'SENDING', completed_at = null, last_error = null
  where id = v_recipient.campaign_id;

  perform public.enqueue_communication_recipient_job(
    p_recipient_id, p_actor_id, p_actor_email, trim(p_reason)
  );
  return v_recipient;
end;
$$;

create or replace function public.ops_create_incident_communication_campaign(
  p_incident_id uuid,
  p_audience_definition jsonb,
  p_channel_policy jsonb,
  p_actor_id uuid,
  p_actor_email text,
  p_scheduled_at timestamptz default null,
  p_expires_at timestamptz default null
)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.service_incidents;
  v_campaign public.communication_campaigns;
  v_risk text;
begin
  perform public.require_communications_service_role();
  select * into v_incident from public.service_incidents
  where id = p_incident_id for update;
  if v_incident.id is null then raise exception 'Service incident not found'; end if;
  if not v_incident.public_visible then raise exception 'Only a public incident can create a customer campaign'; end if;
  if v_incident.communication_campaign_id is not null then
    select * into v_campaign from public.communication_campaigns
    where id = v_incident.communication_campaign_id;
    if v_campaign.id is not null then return v_campaign; end if;
  end if;

  v_risk := case v_incident.severity
    when 'CRITICAL' then 'CRITICAL'
    when 'WARNING' then 'HIGH'
    when 'NOTICE' then 'MEDIUM'
    else 'LOW'
  end;

  v_campaign := public.ops_create_communication_campaign(
    p_name := 'Incident: ' || v_incident.title,
    p_kind := 'SERVICE_STATUS',
    p_category := 'SERVICE_STATUS',
    p_purpose := 'OPERATIONAL',
    p_severity := v_incident.severity,
    p_subject := v_incident.title,
    p_title := v_incident.title,
    p_body := v_incident.summary,
    p_audience_definition := p_audience_definition,
    p_channel_policy := p_channel_policy,
    p_destination := v_incident.destination || jsonb_build_object(
      'incidentId', v_incident.id,
      'destinationKey', coalesce(v_incident.destination->>'destinationKey', 'SERVICE_STATUS')
    ),
    p_acknowledgement_required := v_incident.acknowledgement_required,
    p_risk_level := v_risk,
    p_scheduled_at := p_scheduled_at,
    p_expires_at := p_expires_at,
    p_actor_id := p_actor_id,
    p_actor_email := p_actor_email,
    p_commercial_campaign_id := null
  );

  update public.service_incidents
  set communication_campaign_id = v_campaign.id
  where id = p_incident_id;
  return v_campaign;
end;
$$;

revoke all on function public.enqueue_communication_recipient_job(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.ops_pause_communication_campaign(uuid,text) from public, anon, authenticated;
revoke all on function public.ops_resume_communication_campaign(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.ops_retry_communication_recipient(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.ops_create_incident_communication_campaign(uuid,jsonb,jsonb,uuid,text,timestamptz,timestamptz) from public, anon, authenticated;

grant execute on function public.enqueue_communication_recipient_job(uuid,uuid,text,text) to service_role;
grant execute on function public.ops_pause_communication_campaign(uuid,text) to service_role;
grant execute on function public.ops_resume_communication_campaign(uuid,uuid,text) to service_role;
grant execute on function public.ops_retry_communication_recipient(uuid,uuid,text,text) to service_role;
grant execute on function public.ops_create_incident_communication_campaign(uuid,jsonb,jsonb,uuid,text,timestamptz,timestamptz) to service_role;
