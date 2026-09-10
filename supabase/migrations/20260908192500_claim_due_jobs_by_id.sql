-- Allow Ops and DEV verification to replay an exact known queue job without
-- claiming unrelated work that happens to share its job type.

create or replace function public.claim_due_jobs_by_id(
  p_worker_id text,
  p_job_ids uuid[]
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

  if p_job_ids is null or cardinality(p_job_ids) = 0 then
    return;
  end if;

  return query
  with selected as (
    select id
      from public.job_queue
     where id = any(p_job_ids)
       and attempt_count < max_attempts
       and (
         (status in ('PENDING', 'RETRYABLE') and run_at <= now())
         or (status = 'PROCESSING' and locked_at < now() - interval '15 minutes')
       )
     order by priority asc, run_at asc, created_at asc
     limit 25
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

revoke all on function public.claim_due_jobs_by_id(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_due_jobs_by_id(text, uuid[]) to service_role;

comment on function public.claim_due_jobs_by_id(text, uuid[]) is
  'Claims only explicitly identified due jobs so targeted recovery cannot consume unrelated queue work.';
