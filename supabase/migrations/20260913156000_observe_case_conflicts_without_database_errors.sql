-- A stale Ops screen is an expected optimistic-concurrency outcome. Record it
-- in bounded minute buckets and return a structured result instead of raising
-- a PostgreSQL error. Production readiness can then alert only on an abnormal
-- burst without filling the database error log or triggering client retries.

create table if not exists public.ops_case_conflict_windows (
  environment text not null check (environment in ('DEVELOPMENT', 'PRODUCTION')),
  bucket_started_at timestamptz not null,
  conflict_count bigint not null default 0 check (conflict_count >= 0),
  last_issue_id uuid,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, bucket_started_at)
);

alter table public.ops_case_conflict_windows enable row level security;
revoke all on table public.ops_case_conflict_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_case_conflict_windows to service_role;

do $migration$
declare
  function_oid regprocedure := 'public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid)'::regprocedure;
  current_definition text;
  updated_definition text;
  replacement text := $replacement$
insert into public.ops_case_conflict_windows (
  environment, bucket_started_at, conflict_count, last_issue_id,
  last_observed_at, created_at, updated_at
) values (
  v_environment, date_trunc('minute', v_now), 1, v_issue.id,
  v_now, v_now, v_now
)
on conflict (environment, bucket_started_at) do update
set conflict_count = public.ops_case_conflict_windows.conflict_count + 1,
    last_issue_id = excluded.last_issue_id,
    last_observed_at = excluded.last_observed_at,
    updated_at = excluded.updated_at;

delete from public.ops_case_conflict_windows
where bucket_started_at < v_now - interval '7 days';

return jsonb_build_object(
  'conflict', true,
  'caseStatus', v_issue.canonical_status,
  'recordVersion', v_issue.record_version,
  'correlationId', p_correlation_id
);$replacement$;
begin
  select pg_get_functiondef(function_oid)
  into current_definition;

  updated_definition := replace(
    current_definition,
    'raise exception ''CASE_VERSION_CONFLICT:%'', v_issue.record_version using errcode = ''P0001'';',
    replacement
  );

  if updated_definition = current_definition then
    raise exception 'Non-retryable case conflict guard was not found.';
  end if;

  execute updated_definition;
end;
$migration$;

create or replace function public.get_ops_case_conflict_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recent as (
    select coalesce(sum(conflict_count), 0)::bigint as conflict_count
    from public.ops_case_conflict_windows
    where environment = public.current_ops_environment()
      and bucket_started_at >= date_trunc('minute', now()) - interval '4 minutes'
  )
  select jsonb_build_object(
    'conflictCount', recent.conflict_count,
    'threshold', 20,
    'windowMinutes', 5,
    'burstDetected', recent.conflict_count >= 20
  )
  from recent;
$$;

revoke all on function public.get_ops_case_conflict_health() from public, anon, authenticated;
grant execute on function public.get_ops_case_conflict_health() to service_role;

comment on table public.ops_case_conflict_windows is
  'Bounded minute buckets for expected Ops optimistic-concurrency conflicts; no request payload or operator identity is retained.';
comment on function public.get_ops_case_conflict_health() is
  'Reports a five-minute Ops stale-version burst threshold for production readiness and deduplicated Slack transition alerts.';
comment on function public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid) is
  'Policy-authorized Ops collaboration action. Expected version conflicts return a structured result and increment a bounded health bucket without raising a database error.';
