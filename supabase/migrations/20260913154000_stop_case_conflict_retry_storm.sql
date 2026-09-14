-- CASE_VERSION_CONFLICT is an expected optimistic-concurrency outcome, not a
-- PostgreSQL serialization failure. SQLSTATE 40001 can be retried by database
-- clients and caused a single stale Ops action to loop inside PostgREST. Keep
-- the message contract, but use a non-retryable application exception code.

do $migration$
declare
  function_oid regprocedure := 'public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid)'::regprocedure;
  current_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(function_oid)
  into current_definition;

  if position('CASE_VERSION_CONFLICT:%' in current_definition) = 0 then
    raise exception 'Expected case version conflict guard was not found.';
  end if;

  updated_definition := replace(
    current_definition,
    'raise exception ''CASE_VERSION_CONFLICT:%'', v_issue.record_version using errcode = ''40001'';',
    'raise exception ''CASE_VERSION_CONFLICT:%'', v_issue.record_version using errcode = ''P0001'';'
  );

  if updated_definition = current_definition then
    raise exception 'Case version conflict SQLSTATE was not updated.';
  end if;

  execute updated_definition;
end;
$migration$;

comment on function public.perform_ops_case_collaboration_action(uuid,text,text,bigint,text,uuid,text,text,uuid) is
  'Policy-authorized Ops collaboration action. Version conflicts use non-retryable P0001 with CASE_VERSION_CONFLICT prefix.';
