-- Resolve the reviewed terminal RPC explicitly on projects whose order row
-- identifier is text while the stable finalize_order_terminal contract is UUID.

do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text)'
  );
  v_definition text;
  v_patched text;
begin
  if v_function is null then
    raise exception 'Cancellation refund finalizer is missing.' using errcode = '55000';
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  v_patched := replace(
    v_definition,
    E'    v_order.id,\n    ''REFUNDED'',\n    null,',
    E'    v_order.id::uuid,\n    ''REFUNDED''::text,\n    null::text,'
  );
  v_patched := replace(
    v_patched,
    E'    ''ops.order_cancellation_refund_completed'',\n    v_note,',
    E'    ''ops.order_cancellation_refund_completed''::text,\n    v_note,'
  );
  v_patched := replace(
    v_patched,
    E'    null,\n    false,\n    true,\n    true,\n    false\n  );',
    E'    null::text,\n    false,\n    true,\n    true,\n    false\n  );'
  );

  if v_patched = v_definition or position('v_order.id::uuid' in v_patched) = 0 then
    raise exception 'Cancellation terminal RPC call was not patched.' using errcode = '55000';
  end if;

  execute v_patched;
end;
$$;

comment on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) is
  'Idempotently closes an approved cancellation after all claims are refunded; cross-lineage identifiers and terminal RPC arguments are explicit.';
