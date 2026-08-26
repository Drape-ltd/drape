-- Durable, signed delivery-provider webhook inbox/outbox.
-- Public endpoints only verify and persist; the job queue performs mutations.

create table if not exists public.delivery_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('SHIPPO','TOPSHIP','SHIPBUBBLE')),
  provider_event_id text not null,
  event_type text not null,
  signature_valid boolean not null default false,
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED','QUEUED','PROCESSING','RETRYABLE','PROCESSED','DEAD')),
  processing_result jsonb,
  queued_at timestamptz,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_processing_error text,
  receive_count integer not null default 1,
  last_received_at timestamptz not null default now(),
  reconciliation_status text check (reconciliation_status is null or reconciliation_status in ('PENDING','RECONCILING','MATCHED','MISMATCH','RETRYABLE','DEAD')),
  reconciliation_result jsonb,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists delivery_webhook_events_processing_due_idx
  on public.delivery_webhook_events(processing_status, created_at)
  where processed_at is null;

alter table public.delivery_webhook_events enable row level security;
revoke all on public.delivery_webhook_events from public, anon, authenticated;
grant all on public.delivery_webhook_events to service_role;

create or replace function public.enqueue_verified_delivery_webhook(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_payload_sha256 text,
  p_max_attempts integer default 12
) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_webhook public.delivery_webhook_events%rowtype;
  v_inserted boolean:=false;
  v_domain_event_id uuid;
  v_job_id uuid;
begin
  if p_provider not in ('SHIPPO','TOPSHIP','SHIPBUBBLE') then raise exception 'Unsupported delivery provider'; end if;
  if nullif(btrim(coalesce(p_provider_event_id,'')),'') is null then raise exception 'provider_event_id is required'; end if;
  if nullif(btrim(coalesce(p_event_type,'')),'') is null then raise exception 'event_type is required'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'payload must be an object'; end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid payload digest'; end if;

  insert into public.delivery_webhook_events(
    provider,provider_event_id,event_type,signature_valid,payload,payload_sha256,
    processing_status,queued_at,last_received_at,reconciliation_status
  ) values (
    p_provider,btrim(p_provider_event_id),btrim(p_event_type),true,p_payload,p_payload_sha256,
    'QUEUED',now(),now(),'PENDING'
  ) on conflict(provider,provider_event_id) do nothing returning * into v_webhook;

  if found then
    v_inserted:=true;
  else
    select * into v_webhook from public.delivery_webhook_events
      where provider=p_provider and provider_event_id=btrim(p_provider_event_id) for update;
    if v_webhook.id is null then raise exception 'delivery webhook could not be read after conflict'; end if;
    if v_webhook.payload_sha256<>p_payload_sha256 then raise exception 'provider event id was reused with a different payload'; end if;
    update public.delivery_webhook_events set
      receive_count=receive_count+1,last_received_at=now(),updated_at=now(),
      processing_status=case when processed_at is not null then 'PROCESSED' when processing_status='DEAD' then 'RETRYABLE' else processing_status end,
      last_processing_error=case when processing_status='DEAD' then null else last_processing_error end
    where id=v_webhook.id returning * into v_webhook;
  end if;

  v_domain_event_id:=public.enqueue_domain_event(
    p_event_type=>'delivery.webhook.received',p_aggregate_type=>'delivery_webhook_event',
    p_idempotency_key=>'delivery-webhook:'||lower(p_provider)||':'||btrim(p_provider_event_id),
    p_payload=>jsonb_build_object('webhookEventId',v_webhook.id,'provider',p_provider,'providerEventId',btrim(p_provider_event_id),'eventType',btrim(p_event_type)),
    p_aggregate_id=>v_webhook.id::text,p_actor_role=>'SYSTEM',
    p_metadata=>jsonb_build_object('payloadSha256',p_payload_sha256),
    p_jobs=>array['PROCESS_DELIVERY_WEBHOOK']::text[],p_priority=>15,
    p_max_attempts=>greatest(1,coalesce(p_max_attempts,12)),p_run_at=>now()
  );
  select id into v_job_id from public.job_queue where event_id=v_domain_event_id and job_type='PROCESS_DELIVERY_WEBHOOK' limit 1;
  if v_webhook.processed_at is null and v_job_id is not null then
    update public.job_queue set
      status=case when status in ('DEAD','FAILED') then 'RETRYABLE' else status end,
      run_at=case when status in ('DEAD','FAILED','RETRYABLE') then now() else run_at end,
      last_error=case when status in ('DEAD','FAILED') then null else last_error end,
      updated_at=now()
    where id=v_job_id;
  end if;
  return jsonb_build_object('webhookEventId',v_webhook.id,'jobId',v_job_id,'duplicate',not v_inserted,
    'alreadyProcessed',v_webhook.processed_at is not null,'processingStatus',v_webhook.processing_status);
end;
$$;

revoke all on function public.enqueue_verified_delivery_webhook(text,text,text,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.enqueue_verified_delivery_webhook(text,text,text,jsonb,text,integer) to service_role;

comment on table public.delivery_webhook_events is 'Signed provider delivery webhook inbox with durable processing and reconciliation outcomes.';
