-- Repair the already-installed development function for the legacy disputes
-- table, whose updated_at column is required but has no database default.

do $repair$
declare
  v_signature regprocedure := 'public.create_customer_concern_case(text,text,uuid,text,text,text,text,uuid)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('insert into public.disputes (order_id, customer_id, reason, description)' in v_definition) > 0 then
    v_definition := replace(
      v_definition,
      'insert into public.disputes (order_id, customer_id, reason, description)',
      'insert into public.disputes (order_id, customer_id, reason, description, created_at, updated_at)'
    );
    v_definition := replace(
      v_definition,
      'values (p_order_id, p_customer_id, p_reason_code, trim(p_description))',
      'values (p_order_id, p_customer_id, p_reason_code, trim(p_description), now(), now())'
    );
    execute v_definition;
  end if;
end;
$repair$;
