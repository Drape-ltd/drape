-- Durable payment webhook inbox/outbox.
-- Signed provider events are persisted and queued atomically before the public
-- endpoint acknowledges them. Existing payment_webhook_events remains the
-- single event ledger and inbox source of truth.

alter table public.payment_webhook_events
  add column if not exists payload_sha256 text,
  add column if not exists processing_status text not null default 'RECEIVED',
  add column if not exists queued_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists last_processing_error text,
  add column if not exists receive_count integer not null default 1,
  add column if not exists last_received_at timestamptz not null default now(),
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_status text,
  add column if not exists reconciliation_result jsonb;

alter table public.payment_webhook_events
  drop constraint if exists payment_webhook_events_processing_status_check;

alter table public.payment_webhook_events
  add constraint payment_webhook_events_processing_status_check
  check (processing_status in ('RECEIVED', 'QUEUED', 'PROCESSING', 'RETRYABLE', 'PROCESSED', 'DEAD'));

alter table public.payment_webhook_events
  drop constraint if exists payment_webhook_events_reconciliation_status_check;

alter table public.payment_webhook_events
  add constraint payment_webhook_events_reconciliation_status_check
  check (
    reconciliation_status is null
    or reconciliation_status in ('PENDING', 'RECONCILING', 'MATCHED', 'MISMATCH', 'RETRYABLE', 'DEAD')
  );

update public.payment_webhook_events
set
  processing_status = case when processed_at is null then 'RECEIVED' else 'PROCESSED' end,
  payload_sha256 = coalesce(payload_sha256, encode(extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex')),
  last_received_at = coalesce(last_received_at, created_at)
where payload_sha256 is null
   or processing_status = 'RECEIVED';

create index if not exists payment_webhook_events_processing_due_idx
  on public.payment_webhook_events (processing_status, created_at)
  where processed_at is null;

create index if not exists payment_webhook_events_reconciliation_due_idx
  on public.payment_webhook_events (reconciliation_status, processed_at)
  where reconciled_at is null and processed_at is not null;

create or replace function public.enqueue_verified_payment_webhook(
  p_provider public.payment_provider,
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_payload_sha256 text,
  p_max_attempts integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_webhook public.payment_webhook_events%rowtype;
  v_inserted boolean := false;
  v_domain_event_id uuid;
  v_job_id uuid;
  v_idempotency_key text;
begin
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then
    raise exception 'provider_event_id is required';
  end if;
  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'event_type is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payment webhook payload must be a JSON object';
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'payload_sha256 must be a lowercase SHA-256 digest';
  end if;

  insert into public.payment_webhook_events (
    provider,
    provider_event_id,
    event_type,
    signature_valid,
    payload,
    payload_sha256,
    processing_status,
    queued_at,
    last_received_at
  ) values (
    p_provider,
    btrim(p_provider_event_id),
    btrim(p_event_type),
    true,
    p_payload,
    p_payload_sha256,
    'QUEUED',
    now(),
    now()
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into v_webhook;

  if found then
    v_inserted := true;
  else
    select * into v_webhook
    from public.payment_webhook_events
    where provider = p_provider
      and provider_event_id = btrim(p_provider_event_id)
    for update;

    if v_webhook.id is null then
      raise exception 'payment webhook event could not be read after conflict';
    end if;
    if v_webhook.payload_sha256 is not null and v_webhook.payload_sha256 <> p_payload_sha256 then
      raise exception 'provider event id was reused with a different payload';
    end if;

    update public.payment_webhook_events
    set
      receive_count = receive_count + 1,
      last_received_at = now(),
      payload_sha256 = coalesce(payload_sha256, p_payload_sha256),
      processing_status = case
        when processed_at is not null then 'PROCESSED'
        when processing_status = 'DEAD' then 'RETRYABLE'
        else processing_status
      end,
      last_processing_error = case when processing_status = 'DEAD' then null else last_processing_error end
    where id = v_webhook.id
    returning * into v_webhook;
  end if;

  v_idempotency_key := 'payment-webhook:' || lower(p_provider::text) || ':' || btrim(p_provider_event_id);
  v_domain_event_id := public.enqueue_domain_event(
    p_event_type => 'payment.webhook.received',
    p_aggregate_type => 'payment_webhook_event',
    p_idempotency_key => v_idempotency_key,
    p_payload => jsonb_build_object(
      'webhookEventId', v_webhook.id,
      'provider', p_provider::text,
      'providerEventId', btrim(p_provider_event_id),
      'eventType', btrim(p_event_type)
    ),
    p_aggregate_id => v_webhook.id::text,
    p_actor_role => 'SYSTEM',
    p_metadata => jsonb_build_object('payloadSha256', p_payload_sha256),
    p_jobs => array['PROCESS_PAYMENT_WEBHOOK']::text[],
    p_priority => 15,
    p_max_attempts => greatest(1, coalesce(p_max_attempts, 12)),
    p_run_at => now()
  );

  select id into v_job_id
  from public.job_queue
  where event_id = v_domain_event_id
    and job_type = 'PROCESS_PAYMENT_WEBHOOK'
  order by created_at desc
  limit 1
  for update;

  if v_webhook.processed_at is null and v_job_id is not null then
    update public.job_queue
    set
      status = case when status in ('DEAD', 'FAILED') then 'RETRYABLE' else status end,
      run_at = case when status in ('DEAD', 'FAILED', 'RETRYABLE') then now() else run_at end,
      last_error = case when status in ('DEAD', 'FAILED') then null else last_error end,
      updated_at = now()
    where id = v_job_id;
  end if;

  return jsonb_build_object(
    'webhookEventId', v_webhook.id,
    'domainEventId', v_domain_event_id,
    'jobId', v_job_id,
    'duplicate', not v_inserted,
    'alreadyProcessed', v_webhook.processed_at is not null,
    'processingStatus', v_webhook.processing_status
  );
end;
$$;

revoke all on function public.enqueue_verified_payment_webhook(
  public.payment_provider,
  text,
  text,
  jsonb,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.enqueue_verified_payment_webhook(
  public.payment_provider,
  text,
  text,
  jsonb,
  text,
  integer
) to service_role;
