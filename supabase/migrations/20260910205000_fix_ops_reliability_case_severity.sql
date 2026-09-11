-- Forward-only correction: service_incidents supports WARNING while the
-- legacy ops_issues severity contract uses HIGH for the equivalent actionable
-- case. Preserve WARNING on the incident and project it to HIGH on the case.

do $migration$
declare
  v_signature regprocedure := 'public.ingest_ops_health_monitor_state(text,text,text,text,boolean,text,text,integer,integer,text,jsonb,jsonb,timestamptz,text,text,uuid)'::regprocedure;
  v_definition text;
  v_expected text := 'case when v_severity = ''CRITICAL'' then ''CRITICAL'' else ''WARNING'' end';
  v_replacement text := 'case when v_severity = ''CRITICAL'' then ''CRITICAL'' else ''HIGH'' end';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null or position(v_expected in v_definition) = 0 then
    raise exception 'Expected reliability case severity projection is unavailable; refusing implicit rewrite.' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_expected, v_replacement);
  execute v_definition;
end;
$migration$;
