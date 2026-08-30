-- A small set of upgraded environments retained the retired
-- tailor_profiles.id_document_path column alongside id_document_url. The
-- terminal deletion RPC must remove both without making clean schemas depend
-- on the legacy column.

do $$
declare
  v_definition text;
  v_marker text := $marker$
  get diagnostics v_tailor_profiles = row_count;
$marker$;
  v_replacement text := $replacement$
  get diagnostics v_tailor_profiles = row_count;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tailor_profiles'
      and column_name = 'id_document_path'
  ) then
    execute 'update public.tailor_profiles set id_document_path = null where user_id::text = $1'
      using p_user_id::text;
  end if;
$replacement$;
begin
  select pg_get_functiondef('public.anonymize_account_for_deletion(uuid)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'anonymize_account_for_deletion(uuid) is missing';
  end if;

  if position('id_document_path = null' in v_definition) = 0 then
    v_definition := replace(v_definition, v_marker, v_replacement);
  end if;

  if position('id_document_path = null' in v_definition) = 0 then
    raise exception 'Could not add legacy document-path cleanup to account deletion';
  end if;

  execute v_definition;
end;
$$;
