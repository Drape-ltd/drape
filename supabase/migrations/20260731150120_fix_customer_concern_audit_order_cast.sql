-- Repair environments where the preceding function body was installed before
-- the audit ledger's UUID order reference was accounted for. On a clean replay
-- the preceding migration already contains the cast and this is a no-op.

do $repair$
declare
  v_signature regprocedure := 'public.create_customer_concern_case(text,text,uuid,text,text,text,text,uuid)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('p_order_id, ''financial_case.opened''' in v_definition) > 0 then
    execute replace(
      v_definition,
      'p_order_id, ''financial_case.opened''',
      'p_order_id::uuid, ''financial_case.opened'''
    );
  end if;
end;
$repair$;
