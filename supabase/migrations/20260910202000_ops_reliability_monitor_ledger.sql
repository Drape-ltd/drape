-- Durable Drapeon-owned synthetic monitor state and incident projection.
-- Cloudflare KV may mirror the latest check for a cheap health endpoint, but
-- this database ledger is authoritative for transitions, Ops cases, and Slack
-- correlation. One database project is bound to exactly one environment.

alter table public.service_incidents
  add column if not exists environment text not null default 'UNKNOWN',
  add column if not exists provenance text not null default 'UNKNOWN',
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists last_observed_at timestamptz,
  add column if not exists runbook_url text;

update public.service_incidents
set environment = public.current_ops_environment(),
    provenance = case when public.current_ops_environment() = 'DEVELOPMENT' then 'QA' else 'REAL' end
where environment = 'UNKNOWN'
  and public.current_ops_environment() in ('DEVELOPMENT', 'PRODUCTION');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_incidents_environment_valid'
      and conrelid = 'public.service_incidents'::regclass
  ) then
    alter table public.service_incidents add constraint service_incidents_environment_valid
      check (environment in ('UNKNOWN', 'DEVELOPMENT', 'PRODUCTION'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_incidents_provenance_valid'
      and conrelid = 'public.service_incidents'::regclass
  ) then
    alter table public.service_incidents add constraint service_incidents_provenance_valid
      check (provenance in ('UNKNOWN', 'REAL', 'STAFF', 'REVIEWER', 'CANARY', 'QA', 'SHOWCASE'));
  end if;
end;
$$;

create table if not exists public.ops_monitor_state (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('DEVELOPMENT', 'PRODUCTION')),
  monitor_key text not null,
  target_id text not null,
  target_name text not null,
  healthy boolean not null,
  severity text not null check (severity in ('OK', 'WARNING', 'CRITICAL')),
  fingerprint text not null,
  http_status integer not null default 0,
  latency_ms integer not null default 0,
  detail text not null,
  result_payload jsonb not null default '{}'::jsonb,
  slack_delivery jsonb,
  checked_at timestamptz not null,
  last_transition_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_monitor_state_payload_size check (octet_length(result_payload::text) <= 65536),
  unique (environment, monitor_key, target_id)
);

create index if not exists ops_monitor_state_freshness_idx
  on public.ops_monitor_state (environment, checked_at desc);

drop trigger if exists trg_ops_monitor_state_updated_at on public.ops_monitor_state;
create trigger trg_ops_monitor_state_updated_at
before update on public.ops_monitor_state
for each row execute function public.set_updated_at();

alter table public.ops_monitor_state enable row level security;
revoke all on public.ops_monitor_state from public, anon, authenticated;
grant select, insert, update on public.ops_monitor_state to service_role;

create or replace function public.ingest_ops_health_monitor_state(
  p_environment text,
  p_monitor_key text,
  p_target_id text,
  p_target_name text,
  p_healthy boolean,
  p_severity text,
  p_fingerprint text,
  p_http_status integer,
  p_latency_ms integer,
  p_detail text,
  p_result_payload jsonb,
  p_slack_delivery jsonb,
  p_checked_at timestamptz,
  p_source_reference text,
  p_runbook_url text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_monitor_key text := lower(trim(coalesce(p_monitor_key, '')));
  v_target_id text := lower(trim(coalesce(p_target_id, '')));
  v_target_name text := trim(coalesce(p_target_name, ''));
  v_severity text := upper(trim(coalesce(p_severity, '')));
  v_detail text := trim(coalesce(p_detail, ''));
  v_previous public.ops_monitor_state%rowtype;
  v_state public.ops_monitor_state%rowtype;
  v_incident public.service_incidents%rowtype;
  v_issue public.ops_issues%rowtype;
  v_transition text := 'NONE';
  v_incident_severity text;
  v_provenance text;
  v_case_status text;
begin
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION') or public.current_ops_environment() <> v_environment then
    raise exception 'Health monitor environment mismatch.' using errcode = '42501';
  end if;
  if length(v_monitor_key) < 3 or length(v_monitor_key) > 80
    or v_monitor_key !~ '^[a-z0-9][a-z0-9:_-]+$'
    or length(v_target_id) < 3 or length(v_target_id) > 80
    or v_target_id !~ '^[a-z0-9][a-z0-9:_-]+$'
    or length(v_target_name) < 3 or length(v_target_name) > 160
  then
    raise exception 'Bounded monitor and target identifiers are required.' using errcode = '22023';
  end if;
  if v_severity not in ('OK', 'WARNING', 'CRITICAL') or p_healthy is null or p_checked_at is null or p_correlation_id is null then
    raise exception 'Health outcome, timestamp, and correlation ID are required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_fingerprint, ''))) < 2 or length(p_fingerprint) > 200
    or length(v_detail) < 2 or length(v_detail) > 1000
    or p_http_status < 0 or p_http_status > 599
    or p_latency_ms < 0 or p_latency_ms > 120000
    or jsonb_typeof(coalesce(p_result_payload, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_result_payload, '{}'::jsonb)::text) > 65536
  then
    raise exception 'Invalid bounded monitor payload.' using errcode = '22023';
  end if;

  select * into v_previous
  from public.ops_monitor_state
  where environment = v_environment and monitor_key = v_monitor_key and target_id = v_target_id
  for update;

  if v_previous.id is null then
    v_transition := case when p_healthy then 'NONE' else 'DEGRADED' end;
  elsif v_previous.healthy is distinct from p_healthy then
    v_transition := case when p_healthy then 'RECOVERED' else 'DEGRADED' end;
  elsif not p_healthy and v_previous.fingerprint is distinct from trim(p_fingerprint) then
    v_transition := 'CHANGED';
  end if;

  insert into public.ops_monitor_state (
    environment, monitor_key, target_id, target_name, healthy, severity,
    fingerprint, http_status, latency_ms, detail, result_payload,
    slack_delivery, checked_at, last_transition_at
  ) values (
    v_environment, v_monitor_key, v_target_id, v_target_name, p_healthy, v_severity,
    trim(p_fingerprint), p_http_status, p_latency_ms, v_detail,
    coalesce(p_result_payload, '{}'::jsonb), p_slack_delivery, p_checked_at,
    case when v_transition = 'NONE' then p_checked_at else p_checked_at end
  )
  on conflict (environment, monitor_key, target_id) do update set
    target_name = excluded.target_name,
    healthy = excluded.healthy,
    severity = excluded.severity,
    fingerprint = excluded.fingerprint,
    http_status = excluded.http_status,
    latency_ms = excluded.latency_ms,
    detail = excluded.detail,
    result_payload = excluded.result_payload,
    slack_delivery = coalesce(excluded.slack_delivery, public.ops_monitor_state.slack_delivery),
    checked_at = excluded.checked_at,
    last_transition_at = case when v_transition = 'NONE' then public.ops_monitor_state.last_transition_at else excluded.checked_at end
  returning * into v_state;

  if v_transition <> 'NONE' then
    v_incident_severity := case when v_severity = 'CRITICAL' then 'CRITICAL' else 'WARNING' end;
    v_provenance := case when v_environment = 'DEVELOPMENT' then 'QA' else 'REAL' end;
    v_case_status := case when p_healthy then 'RESOLVED' else 'OPEN' end;

    insert into public.service_incidents (
      incident_key, title, summary, severity, status, affected_services,
      public_visible, acknowledgement_required, destination, source,
      source_reference, started_at, resolved_at, environment, provenance,
      correlation_id, last_observed_at, runbook_url
    ) values (
      'synthetic:' || v_monitor_key || ':' || v_target_id,
      v_target_name || case when p_healthy then ' recovered' else ' degraded' end,
      v_detail,
      v_incident_severity,
      case when p_healthy then 'RESOLVED' else 'INVESTIGATING' end,
      array[v_target_id],
      false,
      not p_healthy,
      jsonb_build_object('destinationKey', 'OPS_INCIDENT', 'destinationPath', '/ops/incidents'),
      'DRAPEON_OPS',
      nullif(trim(coalesce(p_source_reference, '')), ''),
      case when p_healthy then coalesce(v_previous.last_transition_at, p_checked_at) else p_checked_at end,
      case when p_healthy then p_checked_at end,
      v_environment,
      v_provenance,
      p_correlation_id,
      p_checked_at,
      nullif(trim(coalesce(p_runbook_url, '')), '')
    )
    on conflict (incident_key) do update set
      title = excluded.title,
      summary = excluded.summary,
      severity = excluded.severity,
      status = excluded.status,
      affected_services = excluded.affected_services,
      acknowledgement_required = excluded.acknowledgement_required,
      source_reference = excluded.source_reference,
      resolved_at = excluded.resolved_at,
      environment = excluded.environment,
      provenance = excluded.provenance,
      correlation_id = excluded.correlation_id,
      last_observed_at = excluded.last_observed_at,
      runbook_url = excluded.runbook_url
    returning * into v_incident;

    insert into public.ops_issues (
      issue_type, severity, status, source, provider, related_entity_type,
      related_entity_id, title, description, recommended_action, dedupe_key,
      metadata, queue_key, owning_team, priority, sensitivity, environment,
      canonical_status, first_response_due_at, active_resolution_due_at,
      sla_policy_version, provenance, correlation_id, resolved_at
    ) values (
      'SERVICE_INCIDENT',
      case when v_severity = 'CRITICAL' then 'CRITICAL' else 'WARNING' end,
      v_case_status,
      'cloudflare-health-monitor',
      v_target_id,
      'service_incident',
      v_incident.id::text,
      v_incident.title,
      v_detail,
      case when p_healthy then 'Confirm the recovery evidence and close the incident review.' else 'Acknowledge the incident, inspect the synthetic failure, and follow the linked runbook.' end,
      'service-incident:' || v_monitor_key || ':' || v_target_id,
      jsonb_build_object(
        'monitorKey', v_monitor_key,
        'targetId', v_target_id,
        'httpStatus', p_http_status,
        'latencyMs', p_latency_ms,
        'fingerprint', trim(p_fingerprint),
        'checkedAt', p_checked_at,
        'runbookUrl', nullif(trim(coalesce(p_runbook_url, '')), '')
      ),
      'reliability',
      'engineering',
      case when v_severity = 'CRITICAL' then 'P0' else 'P1' end,
      'INTERNAL',
      v_environment,
      case when p_healthy then 'RESOLVED' else 'NEW' end,
      p_checked_at + interval '15 minutes',
      p_checked_at + case when v_severity = 'CRITICAL' then interval '1 hour' else interval '4 hours' end,
      'reliability-v1',
      v_provenance,
      p_correlation_id,
      case when p_healthy then p_checked_at end
    )
    on conflict (dedupe_key) do update set
      severity = excluded.severity,
      status = case
        when excluded.canonical_status = 'RESOLVED' then 'RESOLVED'
        when public.ops_issues.canonical_status in ('RESOLVED', 'CLOSED') then 'OPEN'
        else public.ops_issues.status
      end,
      title = excluded.title,
      description = excluded.description,
      recommended_action = excluded.recommended_action,
      metadata = excluded.metadata,
      canonical_status = case
        when excluded.canonical_status = 'RESOLVED' then 'RESOLVED'
        when public.ops_issues.canonical_status in ('RESOLVED', 'CLOSED') then 'NEW'
        else public.ops_issues.canonical_status
      end,
      environment = excluded.environment,
      provenance = excluded.provenance,
      correlation_id = excluded.correlation_id,
      resolved_at = excluded.resolved_at,
      last_seen_at = p_checked_at
    returning * into v_issue;

    insert into public.ops_case_events (
      issue_id, event_type, visibility, sensitivity, actor_label,
      from_status, to_status, summary, payload, idempotency_key,
      correlation_id, occurred_at
    ) values (
      v_issue.id,
      'STATE_TRANSITION',
      'INTERNAL',
      'INTERNAL',
      'cloudflare-health-monitor',
      case when v_previous.id is null then null when v_previous.healthy then 'HEALTHY' else 'DEGRADED' end,
      case when p_healthy then 'HEALTHY' else 'DEGRADED' end,
      case when p_healthy then 'Drapeon-owned synthetic path recovered.' else 'Drapeon-owned synthetic path degraded.' end,
      jsonb_build_object('targetId', v_target_id, 'detail', v_detail, 'httpStatus', p_http_status, 'latencyMs', p_latency_ms),
      'health-transition:' || p_checked_at::text || ':' || v_transition,
      p_correlation_id,
      p_checked_at
    ) on conflict (issue_id, idempotency_key) do nothing;
  else
    select * into v_issue
    from public.ops_issues
    where dedupe_key = 'service-incident:' || v_monitor_key || ':' || v_target_id;
  end if;

  return jsonb_build_object(
    'transition', v_transition,
    'stateId', v_state.id,
    'incidentId', v_incident.id,
    'caseNumber', v_issue.case_number,
    'checkedAt', v_state.checked_at
  );
end;
$$;

revoke all on function public.ingest_ops_health_monitor_state(text,text,text,text,boolean,text,text,integer,integer,text,jsonb,jsonb,timestamptz,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.ingest_ops_health_monitor_state(text,text,text,text,boolean,text,text,integer,integer,text,jsonb,jsonb,timestamptz,text,text,uuid)
  to service_role;

comment on table public.ops_monitor_state is
  'Authoritative latest Drapeon-owned synthetic state. Cloudflare KV is a read-through mirror only.';
