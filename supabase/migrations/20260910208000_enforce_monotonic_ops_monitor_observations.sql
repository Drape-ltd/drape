-- A delayed Worker retry must never move the authoritative monitor state
-- backwards. Exact replay of the latest observation is idempotent; an older or
-- conflicting observation fails closed before changing incidents or cases.

do $migration$
declare
  v_signature regprocedure := 'public.ingest_ops_health_monitor_state(text,text,text,text,boolean,text,text,integer,integer,text,jsonb,jsonb,timestamptz,text,text,uuid)'::regprocedure;
  v_definition text;
  v_expected text := $needle$  if v_previous.id is null then
    v_transition := case when p_healthy then 'NONE' else 'DEGRADED' end;$needle$;
  v_replacement text := $replacement$  if v_previous.id is not null and p_checked_at = v_previous.checked_at then
    if v_previous.healthy is not distinct from p_healthy
      and v_previous.severity = v_severity
      and v_previous.fingerprint = trim(p_fingerprint)
      and v_previous.http_status = p_http_status
      and v_previous.latency_ms = p_latency_ms
      and v_previous.detail = v_detail
      and v_previous.result_payload = coalesce(p_result_payload, '{}'::jsonb)
    then
      select * into v_incident
      from public.service_incidents
      where incident_key = 'synthetic:' || v_monitor_key || ':' || v_target_id;

      if v_incident.id is not null then
        select * into v_issue
        from public.ops_issues
        where related_entity_type = 'service_incident'
          and related_entity_id = v_incident.id::text;
      end if;

      return jsonb_build_object(
        'stateId', v_previous.id,
        'transition', 'NONE',
        'duplicate', true,
        'incidentId', v_incident.id,
        'caseNumber', v_issue.case_number,
        'checkedAt', v_previous.checked_at
      );
    end if;
    raise exception 'CONFLICTING_MONITOR_OBSERVATION' using errcode = '22023';
  elsif v_previous.id is not null and p_checked_at < v_previous.checked_at then
    raise exception 'STALE_MONITOR_OBSERVATION' using errcode = '22023';
  end if;

  if v_previous.id is null then
    v_transition := case when p_healthy then 'NONE' else 'DEGRADED' end;$replacement$;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null or position(v_expected in v_definition) = 0 then
    raise exception 'Expected monitor transition boundary is unavailable; refusing implicit rewrite.' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_expected, v_replacement);
  execute v_definition;
end;
$migration$;
