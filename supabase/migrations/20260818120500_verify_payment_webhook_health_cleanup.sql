do $$
declare
  v_health jsonb;
begin
  v_health := public.get_drape_service_health();

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_health -> 'jobs', '[]'::jsonb)) as entry(value)
    where entry.value ->> 'jobname' = 'process-payment-webhooks'
      and coalesce((entry.value ->> 'active')::boolean, false)
  ) then
    raise exception 'active process-payment-webhooks cron is absent from protected readiness';
  end if;

  if exists (
    select 1
    from public.job_queue
    where job_type = 'PROCESS_PAYMENT_WEBHOOK'
      and payload ->> 'provider' = 'PAYSTACK'
      and payload ->> 'providerEventId' like 'verify_async_webhook_%'
  ) then
    raise exception 'synthetic payment webhook verification job was not removed';
  end if;
end;
$$;
