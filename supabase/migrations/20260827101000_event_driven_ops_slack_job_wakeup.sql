-- Deliver Ops Slack alerts immediately without returning to an empty-polling worker.
-- Durable queue rows remain authoritative; a five-minute sweep recovers missed
-- wakeups and delayed retries.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.wake_ops_slack_job_worker()
returns trigger
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
as $$
begin
  if new.status not in ('PENDING', 'RETRYABLE') or new.run_at > now() then
    return new;
  end if;

  if new.job_type not in ('SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST') then
    return new;
  end if;

  begin
    perform util.invoke_edge_function(
      'process-job-queue',
      jsonb_build_object(
        'limit', 50,
        'jobTypes', jsonb_build_array('SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST')
      ),
      55000
    );
  exception when others then
    -- Never roll back the Ops audit or durable job because Slack is unavailable.
    raise warning 'ops Slack wakeup deferred for job %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.wake_ops_slack_job_worker() from public, anon, authenticated;

drop trigger if exists trg_wake_ops_slack_job_worker on public.job_queue;
create trigger trg_wake_ops_slack_job_worker
after insert on public.job_queue
for each row
when (new.job_type in ('SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST'))
execute function public.wake_ops_slack_job_worker();

create or replace function public.wake_due_ops_slack_jobs()
returns bigint
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.job_queue
    where job_type in ('SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST')
      and (
        (status in ('PENDING', 'RETRYABLE') and run_at <= now())
        or (status = 'PROCESSING' and locked_at < now() - interval '15 minutes')
      )
  ) then
    return null;
  end if;

  return util.invoke_edge_function(
    'process-job-queue',
    '{"limit":50,"jobTypes":["SEND_OPS_SLACK","SEND_OPS_SLACK_DIGEST"]}'::jsonb,
    55000
  );
end;
$$;

revoke all on function public.wake_due_ops_slack_jobs() from public, anon, authenticated;
grant execute on function public.wake_due_ops_slack_jobs() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'process-ops-slack-jobs-recovery';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'process-ops-slack-jobs-recovery',
    '*/5 * * * *',
    $job$select public.wake_due_ops_slack_jobs();$job$
  );
end $$;

-- Wake any durable rows created before this event-driven trigger existed.
select public.wake_due_ops_slack_jobs();
