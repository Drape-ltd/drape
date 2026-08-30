-- Legacy development environments expose some user/profile references through
-- text compatibility columns. Keep terminal deletion safe across both those
-- environments and current UUID-backed schemas by comparing canonical text.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.anonymize_account_for_deletion(uuid)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'anonymize_account_for_deletion(uuid) is missing';
  end if;

  v_definition := replace(v_definition, 'where user_id = p_user_id;', 'where user_id::text = p_user_id::text;');
  v_definition := replace(v_definition, 'where id = p_user_id;', 'where id::text = p_user_id::text;');
  v_definition := replace(v_definition, 'where customer_id = p_user_id;', 'where customer_id::text = p_user_id::text;');
  v_definition := replace(v_definition, 'order_record.customer_id = p_user_id;', 'order_record.customer_id::text = p_user_id::text;');

  execute v_definition;
end;
$$;
