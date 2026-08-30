-- Keep terminal deletion compatible with legacy environments where a tailor
-- profile identifier is exposed through a text compatibility contract.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.anonymize_account_for_deletion(uuid)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'anonymize_account_for_deletion(uuid) is missing';
  end if;

  v_definition := replace(
    v_definition,
    'v_tailor_profile_ids uuid[] := ''{}''::uuid[];',
    'v_tailor_profile_ids text[] := ''{}''::text[];'
  );
  v_definition := replace(
    v_definition,
    'select coalesce(array_agg(id), ''{}''::uuid[])',
    'select coalesce(array_agg(id::text), ''{}''::text[])'
  );
  v_definition := replace(
    v_definition,
    'where tailor_profile_id = any(v_tailor_profile_ids);',
    'where tailor_profile_id::text = any(v_tailor_profile_ids);'
  );
  v_definition := replace(v_definition, 'where user_id = p_user_id;', 'where user_id::text = p_user_id::text;');
  v_definition := replace(v_definition, 'where id = p_user_id;', 'where id::text = p_user_id::text;');
  v_definition := replace(v_definition, 'where customer_id = p_user_id;', 'where customer_id::text = p_user_id::text;');
  v_definition := replace(v_definition, 'order_record.customer_id = p_user_id;', 'order_record.customer_id::text = p_user_id::text;');

  execute v_definition;
end;
$$;
