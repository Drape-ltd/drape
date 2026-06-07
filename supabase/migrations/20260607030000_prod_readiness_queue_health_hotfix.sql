-- Production readiness hotfix.
--
-- Prod intentionally has not received the full post-April migration backlog yet,
-- but the currently deployed Edge workers require these durable queue/provider
-- health contracts. Keep this migration narrow and idempotent so it can be
-- applied without pulling unrelated launch backlog into production.

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

drop function if exists public.claim_due_jobs(text, integer);

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

  return query
  with selected as (
    select id
    from public.job_queue
    where (
      (
        status in ('PENDING', 'RETRYABLE')
        and run_at <= now()
      )
      or (
        status = 'PROCESSING'
        and locked_at < now() - interval '15 minutes'
      )
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

create table if not exists public.provider_health (
  provider text not null,
  operation text not null default 'GENERAL',
  status text not null default 'OK' check (status in ('OK', 'DEGRADED', 'OPEN')),
  failure_count integer not null default 0 check (failure_count >= 0),
  circuit_open_until timestamptz,
  last_error text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, operation)
);

create index if not exists provider_health_status_idx
  on public.provider_health (status, circuit_open_until, updated_at desc);

create or replace function public.set_provider_health_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_provider_health_updated_at on public.provider_health;
create trigger trg_provider_health_updated_at
before update on public.provider_health
for each row
execute function public.set_provider_health_updated_at();

alter table public.provider_health enable row level security;
grant select, insert, update, delete on table public.provider_health to service_role;

create or replace function public.record_provider_health(
  p_provider text,
  p_operation text,
  p_succeeded boolean,
  p_error text default null,
  p_open_after_failures integer default 3,
  p_open_seconds integer default 300,
  p_metadata jsonb default '{}'::jsonb
)
returns public.provider_health
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider text := upper(nullif(btrim(coalesce(p_provider, '')), ''));
  v_operation text := upper(coalesce(nullif(btrim(coalesce(p_operation, '')), ''), 'GENERAL'));
  v_existing public.provider_health%rowtype;
  v_failure_count integer;
  v_status text;
  v_open_until timestamptz;
  v_result public.provider_health%rowtype;
begin
  if v_provider is null then
    raise exception 'provider is required';
  end if;

  select *
    into v_existing
    from public.provider_health
   where provider = v_provider
     and operation = v_operation
   for update;

  if p_succeeded then
    insert into public.provider_health (
      provider,
      operation,
      status,
      failure_count,
      circuit_open_until,
      last_error,
      last_success_at,
      metadata
    )
    values (
      v_provider,
      v_operation,
      'OK',
      0,
      null,
      null,
      now(),
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (provider, operation) do update
      set status = 'OK',
          failure_count = 0,
          circuit_open_until = null,
          last_error = null,
          last_success_at = now(),
          metadata = public.provider_health.metadata || excluded.metadata
    returning * into v_result;
    return v_result;
  end if;

  v_failure_count := coalesce(v_existing.failure_count, 0) + 1;
  v_status := case
    when v_failure_count >= greatest(1, coalesce(p_open_after_failures, 3)) then 'OPEN'
    else 'DEGRADED'
  end;
  v_open_until := case
    when v_status = 'OPEN' then now() + make_interval(secs => greatest(30, coalesce(p_open_seconds, 300)))
    else null
  end;

  insert into public.provider_health (
    provider,
    operation,
    status,
    failure_count,
    circuit_open_until,
    last_error,
    last_failure_at,
    metadata
  )
  values (
    v_provider,
    v_operation,
    v_status,
    v_failure_count,
    v_open_until,
    left(coalesce(p_error, 'Provider failure'), 4000),
    now(),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, operation) do update
    set status = excluded.status,
        failure_count = excluded.failure_count,
        circuit_open_until = excluded.circuit_open_until,
        last_error = excluded.last_error,
        last_failure_at = now(),
        metadata = public.provider_health.metadata || excluded.metadata
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.record_provider_health(text, text, boolean, text, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_provider_health(text, text, boolean, text, integer, integer, jsonb)
  to service_role;

create or replace function public.get_provider_circuit(
  p_provider text,
  p_operation text default 'GENERAL'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider text := upper(nullif(btrim(coalesce(p_provider, '')), ''));
  v_operation text := upper(coalesce(nullif(btrim(coalesce(p_operation, '')), ''), 'GENERAL'));
  v_row public.provider_health%rowtype;
  v_open boolean := false;
begin
  if v_provider is null then
    return jsonb_build_object('open', false, 'reason', 'provider_missing');
  end if;

  select *
    into v_row
    from public.provider_health
   where provider = v_provider
     and operation = v_operation;

  if not found then
    return jsonb_build_object('open', false, 'provider', v_provider, 'operation', v_operation, 'status', 'OK');
  end if;

  v_open := v_row.status = 'OPEN' and coalesce(v_row.circuit_open_until, now()) > now();

  return jsonb_build_object(
    'open', v_open,
    'provider', v_row.provider,
    'operation', v_row.operation,
    'status', case when v_open then v_row.status else case when v_row.status = 'OPEN' then 'DEGRADED' else v_row.status end end,
    'failureCount', v_row.failure_count,
    'circuitOpenUntil', v_row.circuit_open_until,
    'lastError', v_row.last_error,
    'lastSuccessAt', v_row.last_success_at,
    'lastFailureAt', v_row.last_failure_at
  );
end;
$$;

revoke all on function public.get_provider_circuit(text, text) from public, anon, authenticated;
grant execute on function public.get_provider_circuit(text, text) to service_role;

create or replace function public.get_provider_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'provider', provider,
          'operation', operation,
          'status', status,
          'failureCount', failure_count,
          'circuitOpenUntil', circuit_open_until,
          'lastError', last_error,
          'lastSuccessAt', last_success_at,
          'lastFailureAt', last_failure_at,
          'updatedAt', updated_at
        )
        order by provider, operation
      )
      from public.provider_health
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_provider_health() from public, anon, authenticated;
grant execute on function public.get_provider_health() to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'process-job-queue';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'process-notification-jobs';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'process-ops-jobs';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-notification-jobs',
    '* * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":40,"jobTypes":["SEND_PUSH","SEND_SMS","SEND_ORDER_EVENT_EMAIL","SEND_ORDER_CONFIRMATION_EMAILS"]}'::jsonb, 300000);$job$
  );

  perform cron.schedule(
    'process-ops-jobs',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-job-queue', '{"limit":20,"jobTypes":["CREATE_OPS_ISSUE"]}'::jsonb, 300000);$job$
  );
end $$;

create or replace function public.get_drape_service_health()
returns jsonb
language plpgsql
security definer
set search_path = public, util, extensions
as $$
declare
  cron_available boolean := to_regclass('cron.job') is not null;
  vault_available boolean := to_regclass('vault.decrypted_secrets') is not null;
  jobs jsonb := '[]'::jsonb;
  project_url_configured boolean := false;
  service_role_configured boolean := false;
begin
  if cron_available then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'jobname', jobname,
          'schedule', schedule,
          'active', active
        )
        order by jobname
      ),
      '[]'::jsonb
    )
    into jobs
    from cron.job
    where jobname in (
      'expire-pending-payments',
      'expire-quotes',
      'auto-release',
      'release-order-payouts',
      'escalate-production-stalls',
      'send-consultation-reminders',
      'process-notification-jobs',
      'process-ops-jobs'
    );
  end if;

  if vault_available then
    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'project_url'
      )
    $sql$
    into project_url_configured;

    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    $sql$
    into service_role_configured;
  end if;

  return jsonb_build_object(
    'cronAvailable', cron_available,
    'vaultAvailable', vault_available,
    'vaultProjectUrlConfigured', project_url_configured,
    'vaultServiceRoleConfigured', service_role_configured,
    'jobs', jobs
  );
end;
$$;

revoke all on function public.get_drape_service_health() from public, anon, authenticated;
grant execute on function public.get_drape_service_health() to service_role;
