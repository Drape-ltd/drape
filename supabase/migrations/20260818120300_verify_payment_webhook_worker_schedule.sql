do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'process-payment-webhooks'
  ) then
    raise exception 'payment webhook worker schedule is missing';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'process-payment-webhooks'
      and command like '%PROCESS_PAYMENT_WEBHOOK%'
      and command like '%RECONCILE_PAYMENT_WEBHOOK%'
  ) then
    raise exception 'payment webhook worker does not cover processing and reconciliation';
  end if;
end;
$$;
