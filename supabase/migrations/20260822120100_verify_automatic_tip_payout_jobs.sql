do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'process-tip-payouts'
      and schedule = '* * * * *'
      and command like '%PROCESS_TIP_PAYOUT%'
  ) then
    raise exception 'automatic tip payout worker schedule is missing';
  end if;

  if exists (
    select 1
    from public.order_tips tip
    where tip.status = 'PAYOUT_PENDING'
      and not exists (
        select 1
        from public.job_queue job
        where job.job_type = 'PROCESS_TIP_PAYOUT'
          and job.payload ->> 'tipId' = tip.id::text
      )
  ) then
    raise exception 'captured tip is missing its automatic payout job';
  end if;
end $$;
