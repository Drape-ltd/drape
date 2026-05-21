-- Provider health/circuit-breaker foundation.
-- Payment, payout, SMS, shipping, and CRM integrations should record provider
-- failures here before launch-scale traffic hides repeated downstream issues.

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
