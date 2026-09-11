-- The legacy disputes identifier differs across historical project lineages.
-- Compare through the stable text representation so the async cancellation
-- finalizer compiles and behaves identically whether disputes.id is UUID or
-- text. The already-applied function migration remains immutable.

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
    'where id = p_dispute_id for update',
    'where id::text = p_dispute_id::text for update'
  );

  if v_patched = v_definition then
    raise exception 'Cancellation dispute identifier predicate was not found.' using errcode = '55000';
  end if;

  execute v_patched;
end;
$$;

comment on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) is
  'Idempotently closes an approved cancellation after all claims are refunded; legacy dispute identifiers compare through text.';
