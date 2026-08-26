do $$
declare
  v_provider_event_id text := 'verify_async_webhook_' || replace(gen_random_uuid()::text, '-', '');
  v_payload jsonb := '{"event":"charge.success","data":{"reference":"verify-only"}}'::jsonb;
  v_hash text;
  v_first jsonb;
  v_second jsonb;
  v_webhook_id uuid;
  v_domain_event_id uuid;
  v_job_count integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_webhook_events'
      and column_name = 'processing_status'
  ) then
    raise exception 'payment webhook processing status was not installed';
  end if;

  if to_regprocedure('public.enqueue_verified_payment_webhook(public.payment_provider,text,text,jsonb,text,integer)') is null then
    raise exception 'enqueue_verified_payment_webhook was not installed';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.enqueue_verified_payment_webhook(public.payment_provider,text,text,jsonb,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not execute enqueue_verified_payment_webhook';
  end if;

  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_first := public.enqueue_verified_payment_webhook(
    'PAYSTACK'::public.payment_provider,
    v_provider_event_id,
    'charge.success',
    v_payload,
    v_hash,
    3
  );
  v_second := public.enqueue_verified_payment_webhook(
    'PAYSTACK'::public.payment_provider,
    v_provider_event_id,
    'charge.success',
    v_payload,
    v_hash,
    3
  );

  v_webhook_id := (v_first ->> 'webhookEventId')::uuid;
  v_domain_event_id := (v_first ->> 'domainEventId')::uuid;
  if coalesce((v_first ->> 'duplicate')::boolean, true) then
    raise exception 'first verified webhook intake was incorrectly marked duplicate';
  end if;
  if not coalesce((v_second ->> 'duplicate')::boolean, false) then
    raise exception 'second verified webhook intake was not deduplicated';
  end if;
  if (v_second ->> 'webhookEventId')::uuid <> v_webhook_id then
    raise exception 'duplicate webhook did not resolve to the original inbox row';
  end if;

  select count(*) into v_job_count
  from public.job_queue
  where event_id = v_domain_event_id
    and job_type = 'PROCESS_PAYMENT_WEBHOOK';
  if v_job_count <> 1 then
    raise exception 'verified webhook should create exactly one processing job, got %', v_job_count;
  end if;

  if not exists (
    select 1 from public.payment_webhook_events
    where id = v_webhook_id
      and signature_valid
      and processing_status = 'QUEUED'
      and receive_count = 2
      and payload_sha256 = v_hash
  ) then
    raise exception 'verified webhook inbox row did not preserve queue and deduplication state';
  end if;

  -- The queue FK intentionally uses ON DELETE SET NULL so production jobs are
  -- not lost when an event is removed. Verification jobs therefore need an
  -- explicit cleanup before their synthetic event is deleted.
  delete from public.job_queue
  where event_id = v_domain_event_id
    and job_type = 'PROCESS_PAYMENT_WEBHOOK';
  delete from public.domain_events where id = v_domain_event_id;
  delete from public.payment_webhook_events where id = v_webhook_id;
end;
$$;
