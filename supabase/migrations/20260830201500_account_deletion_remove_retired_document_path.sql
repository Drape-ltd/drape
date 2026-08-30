-- The legacy tailor_profiles.id_document_path column no longer exists in
-- current schemas. Remove its compatibility cleanup from the terminal
-- anonymizer so the function can be validated and executed normally.

do $$
declare
  v_definition text;
  v_legacy_block text := $legacy$
  -- Some upgraded projects briefly retained both the legacy path column and
  -- its current URL replacement. Clear the compatibility field when present
  -- without making fresh schemas depend on a retired column.
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
$legacy$;
begin
  select pg_get_functiondef(
    'public.anonymize_account_for_deletion(uuid)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'anonymize_account_for_deletion(uuid) is missing';
  end if;

  if position(v_legacy_block in v_definition) = 0 then
    -- Clean environments never received the legacy block.
    return;
  end if;

  execute replace(v_definition, v_legacy_block, E'\n');
end;
$$;
