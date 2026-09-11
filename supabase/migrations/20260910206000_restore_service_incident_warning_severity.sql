-- Forward-only correction to the prior narrow rewrite: service_incidents owns
-- the WARNING enum, while its linked ops_issues case projects that state to
-- HIGH. Restore only the local incident-severity assignment.

do $migration$
declare
  v_signature regprocedure := 'public.ingest_ops_health_monitor_state(text,text,text,text,boolean,text,text,integer,integer,text,jsonb,jsonb,timestamptz,text,text,uuid)'::regprocedure;
  v_definition text;
  v_expected text := 'v_incident_severity := case when v_severity = ''CRITICAL'' then ''CRITICAL'' else ''HIGH'' end;';
  v_replacement text := 'v_incident_severity := case when v_severity = ''CRITICAL'' then ''CRITICAL'' else ''WARNING'' end;';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null or position(v_expected in v_definition) = 0 then
    raise exception 'Expected incident severity assignment is unavailable; refusing implicit rewrite.' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_expected, v_replacement);
  execute v_definition;
end;
$migration$;
