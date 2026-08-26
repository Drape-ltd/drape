do $$
declare
  v_guard text;
  v_apply text;
begin
  select pg_get_functiondef('public.guard_terminal_order_update()'::regprocedure)
    into v_guard;
  select pg_get_functiondef('public.apply_reviewed_payout_destination_correction(uuid,text,text)'::regprocedure)
    into v_apply;

  if position('reviewed_payout_destination_correction' in v_guard) = 0
    or position('tailor_paystack_recipient_code_locked' in v_guard) = 0
    or position('tailor_stripe_connect_account_id_locked' in v_guard) = 0
    or position('to_jsonb(new)' in lower(v_guard)) = 0 then
    raise exception 'Terminal-order payout-route field guard is missing.';
  end if;

  if position('set_config(''app.reviewed_payout_destination_correction'', ''on'', true)' in v_apply) = 0
    or position('set_config(''app.reviewed_payout_destination_correction'', ''off'', true)' in v_apply) = 0 then
    raise exception 'Reviewed payout correction does not scope its terminal-order authorization.';
  end if;

  if has_function_privilege('authenticated', 'public.apply_reviewed_payout_destination_correction(uuid,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.apply_reviewed_payout_destination_correction(uuid,text,text)', 'EXECUTE') then
    raise exception 'Reviewed payout correction execute privileges are unsafe.';
  end if;
end;
$$;
