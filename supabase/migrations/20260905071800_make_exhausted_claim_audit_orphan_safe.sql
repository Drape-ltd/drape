-- The durable job payload/event retains the original recipient context. Dead
-- outcome rows must remain recordable after a test or customer user is deleted.

create or replace function public.claim_due_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_job_types text[] default null
)
returns setof public.job_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker_id is required';
  end if;

  with exhausted as (
    update public.job_queue
       set status = 'DEAD',
           locked_at = null,
           locked_by = null,
           completed_at = now(),
           last_error = coalesce(last_error, 'Worker claim expired after the maximum attempts.')
     where status = 'PROCESSING'
       and locked_at < now() - interval '15 minutes'
       and attempt_count >= max_attempts
       and (
         p_job_types is null
         or cardinality(p_job_types) = 0
         or job_type = any(p_job_types)
       )
    returning *
  ), recorded_attempts as (
    insert into public.job_attempts (
      job_id, attempt_no, worker_id, status, error, finished_at
    )
    select
      id, greatest(1, attempt_count), coalesce(locked_by, p_worker_id),
      'DEAD', 'Worker claim expired after the maximum attempts.', now()
    from exhausted
    returning job_id
  )
  insert into public.notification_delivery_outcomes (
    event_id, job_id, channel, recipient_user_id, order_id, status, reason, metadata
  )
  select
    exhausted.event_id,
    exhausted.id,
    case
      when exhausted.job_type = 'SEND_PUSH' then 'PUSH'
      when exhausted.job_type = 'SEND_SMS' then 'SMS'
      else 'EMAIL'
    end,
    null,
    coalesce(
      nullif(exhausted.payload ->> 'orderId', '')::uuid,
      nullif(exhausted.payload #>> '{order,id}', '')::uuid
    ),
    'DEAD',
    'WORKER_CLAIM_EXHAUSTED',
    jsonb_build_object('attempt_count', exhausted.attempt_count)
  from exhausted
  where exhausted.job_type in (
    'SEND_PUSH', 'SEND_SMS', 'SEND_ACCOUNT_EVENT_EMAIL',
    'SEND_ORDER_EVENT_EMAIL', 'SEND_ORDER_CONFIRMATION_EMAILS',
    'SEND_OPS_VERIFICATION_EMAIL'
  )
  on conflict (job_id) do update set
    status = 'DEAD',
    reason = 'WORKER_CLAIM_EXHAUSTED',
    metadata = public.notification_delivery_outcomes.metadata || excluded.metadata,
    terminal_at = now();

  return query
  with selected as (
    select id
    from public.job_queue
    where attempt_count < max_attempts
      and (
        (status in ('PENDING', 'RETRYABLE') and run_at <= now())
        or (status = 'PROCESSING' and locked_at < now() - interval '15 minutes')
      )
      and (
        p_job_types is null
        or cardinality(p_job_types) = 0
        or job_type = any(p_job_types)
      )
    order by priority asc, run_at asc, created_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update skip locked
  )
  update public.job_queue jobs
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = btrim(p_worker_id),
         attempt_count = jobs.attempt_count + 1,
         last_error = null
    from selected
   where jobs.id = selected.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_due_jobs(text, integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(text, integer, text[]) to service_role;
