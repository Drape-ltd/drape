-- Drape launch-scale foundation: durable domain events and retryable jobs.
--
-- Edge Functions should record important side effects here instead of relying
-- only on EdgeRuntime.waitUntil. The worker claims jobs with SKIP LOCKED so
-- multiple workers can run horizontally without double-processing.

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text,
  idempotency_key text not null unique,
  actor_id uuid,
  actor_role text,
  order_id uuid,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'RECORDED' check (status in ('RECORDED', 'SUPERSEDED')),
  created_at timestamptz not null default now()
);

create table if not exists public.job_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.domain_events(id) on delete set null,
  job_type text not null,
  status text not null default 'PENDING' check (
    status in ('PENDING', 'PROCESSING', 'RETRYABLE', 'SUCCEEDED', 'FAILED', 'DEAD')
  ),
  priority integer not null default 100,
  run_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  last_error text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_queue(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  worker_id text,
  status text not null check (status in ('SUCCEEDED', 'FAILED', 'DEAD')),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer
);

create index if not exists domain_events_event_type_created_idx
  on public.domain_events (event_type, created_at desc);

create index if not exists domain_events_order_created_idx
  on public.domain_events (order_id, created_at desc)
  where order_id is not null;

create index if not exists job_queue_due_idx
  on public.job_queue (status, run_at, priority, created_at)
  where status in ('PENDING', 'RETRYABLE', 'PROCESSING');

create index if not exists job_queue_type_status_idx
  on public.job_queue (job_type, status, created_at desc);

create unique index if not exists job_queue_dedupe_unique_idx
  on public.job_queue (job_type, dedupe_key)
  where dedupe_key is not null;

create index if not exists job_attempts_job_created_idx
  on public.job_attempts (job_id, started_at desc);

create or replace function public.set_job_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_job_queue_updated_at on public.job_queue;
create trigger trg_job_queue_updated_at
before update on public.job_queue
for each row
execute function public.set_job_queue_updated_at();

alter table public.domain_events enable row level security;
alter table public.job_queue enable row level security;
alter table public.job_attempts enable row level security;

grant select, insert, update, delete on table public.domain_events to service_role;
grant select, insert, update, delete on table public.job_queue to service_role;
grant select, insert, update, delete on table public.job_attempts to service_role;

create or replace function public.enqueue_domain_event(
  p_event_type text,
  p_aggregate_type text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_aggregate_id text default null,
  p_actor_id uuid default null,
  p_actor_role text default null,
  p_order_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_jobs text[] default array[]::text[],
  p_priority integer default 100,
  p_max_attempts integer default 5,
  p_run_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_job_type text;
  v_dedupe_key text;
begin
  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'event_type is required';
  end if;

  if p_aggregate_type is null or btrim(p_aggregate_type) = '' then
    raise exception 'aggregate_type is required';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required';
  end if;

  insert into public.domain_events (
    event_type,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    actor_id,
    actor_role,
    order_id,
    payload,
    metadata
  )
  values (
    btrim(p_event_type),
    btrim(p_aggregate_type),
    nullif(btrim(coalesce(p_aggregate_id, '')), ''),
    btrim(p_idempotency_key),
    p_actor_id,
    nullif(btrim(coalesce(p_actor_role, '')), ''),
    p_order_id,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do update
    set metadata = public.domain_events.metadata || excluded.metadata
  returning id into v_event_id;

  foreach v_job_type in array coalesce(p_jobs, array[]::text[]) loop
    v_job_type := nullif(btrim(v_job_type), '');
    if v_job_type is null then
      continue;
    end if;

    v_dedupe_key := btrim(p_idempotency_key) || ':' || v_job_type;

    insert into public.job_queue (
      event_id,
      job_type,
      priority,
      run_at,
      max_attempts,
      dedupe_key,
      payload
    )
    values (
      v_event_id,
      v_job_type,
      coalesce(p_priority, 100),
      coalesce(p_run_at, now()),
      greatest(1, coalesce(p_max_attempts, 5)),
      v_dedupe_key,
      coalesce(p_payload, '{}'::jsonb)
    )
    on conflict do nothing;
  end loop;

  return v_event_id;
end;
$$;

revoke all on function public.enqueue_domain_event(
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  text,
  uuid,
  jsonb,
  text[],
  integer,
  integer,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_domain_event(
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  text,
  uuid,
  jsonb,
  text[],
  integer,
  integer,
  timestamptz
) to service_role;

create or replace function public.claim_due_jobs(
  p_worker_id text,
  p_limit integer default 10
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

  return query
  with selected as (
    select id
    from public.job_queue
    where (
      status in ('PENDING', 'RETRYABLE')
      and run_at <= now()
    )
    or (
      status = 'PROCESSING'
      and locked_at < now() - interval '15 minutes'
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

revoke all on function public.claim_due_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(text, integer) to service_role;

create or replace function public.finish_job(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text default null,
  p_retry_delay_seconds integer default null,
  p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.job_queue%rowtype;
  v_next_status text;
  v_retry_delay integer;
begin
  select *
    into v_job
    from public.job_queue
   where id = p_job_id
     and status = 'PROCESSING'
     and locked_by = p_worker_id
   for update;

  if not found then
    raise exception 'job is not locked by this worker';
  end if;

  if p_succeeded then
    insert into public.job_attempts (
      job_id,
      attempt_no,
      worker_id,
      status,
      error,
      finished_at,
      duration_ms
    )
    values (
      v_job.id,
      greatest(1, v_job.attempt_count),
      p_worker_id,
      'SUCCEEDED',
      null,
      now(),
      p_duration_ms
    );

    update public.job_queue
       set status = 'SUCCEEDED',
           locked_at = null,
           locked_by = null,
           completed_at = now(),
           last_error = null
     where id = v_job.id;
    return;
  end if;

  v_next_status := case
    when v_job.attempt_count >= v_job.max_attempts then 'DEAD'
    else 'RETRYABLE'
  end;

  insert into public.job_attempts (
    job_id,
    attempt_no,
    worker_id,
    status,
    error,
    finished_at,
    duration_ms
  )
  values (
    v_job.id,
    greatest(1, v_job.attempt_count),
    p_worker_id,
    case when v_next_status = 'DEAD' then 'DEAD' else 'FAILED' end,
    left(coalesce(p_error, 'Unknown job failure'), 4000),
    now(),
    p_duration_ms
  );

  v_retry_delay := coalesce(
    p_retry_delay_seconds,
    least(3600, (30 * power(2, least(greatest(v_job.attempt_count, 1), 6)))::integer)
  );

  update public.job_queue
     set status = v_next_status,
         locked_at = null,
         locked_by = null,
         completed_at = case when v_next_status = 'DEAD' then now() else null end,
         run_at = case
           when v_next_status = 'DEAD' then run_at
           else now() + make_interval(secs => greatest(5, v_retry_delay))
         end,
         last_error = left(coalesce(p_error, 'Unknown job failure'), 4000)
   where id = v_job.id;
end;
$$;

revoke all on function public.finish_job(uuid, text, boolean, text, integer, integer) from public, anon, authenticated;
grant execute on function public.finish_job(uuid, text, boolean, text, integer, integer) to service_role;

create or replace function public.get_job_queue_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  status_counts jsonb;
  oldest_pending timestamptz;
  oldest_processing timestamptz;
  dead_count integer;
  retryable_count integer;
begin
  select coalesce(jsonb_object_agg(status, count), '{}'::jsonb)
    into status_counts
    from (
      select status, count(*)::integer
      from public.job_queue
      group by status
    ) counts;

  select min(created_at)
    into oldest_pending
    from public.job_queue
   where status in ('PENDING', 'RETRYABLE');

  select min(locked_at)
    into oldest_processing
    from public.job_queue
   where status = 'PROCESSING';

  select count(*)::integer
    into dead_count
    from public.job_queue
   where status = 'DEAD';

  select count(*)::integer
    into retryable_count
    from public.job_queue
   where status = 'RETRYABLE';

  return jsonb_build_object(
    'statusCounts', status_counts,
    'oldestPendingAt', oldest_pending,
    'oldestProcessingAt', oldest_processing,
    'deadCount', coalesce(dead_count, 0),
    'retryableCount', coalesce(retryable_count, 0)
  );
end;
$$;

revoke all on function public.get_job_queue_health() from public, anon, authenticated;
grant execute on function public.get_job_queue_health() to service_role;
