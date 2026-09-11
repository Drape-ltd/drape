-- The cancellation finalizer records named workforce identity in the immutable
-- Money Desk and Ops audit rows. `disputes.resolved_by` is instead a legacy UUID
-- foreign key to `users(id)`, so an operator email must never be written there.
-- Keep the legacy field null and preserve the named actor in the canonical audit.

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
    E'      resolved_by = nullif(trim(coalesce(p_actor_email, \'\')), \'\'),',
    E'      resolved_by = null,'
  );

  if v_patched = v_definition
     or position('resolved_by = nullif(trim(coalesce(p_actor_email' in v_patched) > 0
     or position('resolved_by = null,' in v_patched) = 0 then
    raise exception 'Cancellation dispute resolver was not patched.' using errcode = '55000';
  end if;

  execute v_patched;
end;
$$;

comment on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) is
  'Idempotently closes approved cancellation refunds; named workforce identity is retained in Money Desk and Ops audit evidence, not the legacy user UUID field.';
