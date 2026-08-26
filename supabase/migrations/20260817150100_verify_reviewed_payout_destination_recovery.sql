-- Structural proof for reviewed payout-destination recovery.
do $$
declare
  v_security_definer boolean;
begin
  if to_regclass('public.payout_destination_corrections') is null then
    raise exception 'payout_destination_corrections table is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payout_destination_corrections'::regclass
      and tgname = 'payout_destination_corrections_append_only'
      and not tgisinternal
  ) then
    raise exception 'payout destination corrections are not append-only';
  end if;

  select p.prosecdef into v_security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_reviewed_payout_destination_correction'
    and pg_get_function_identity_arguments(p.oid) = 'p_money_desk_request_id uuid, p_actor_email text, p_actor_role text';
  if not coalesce(v_security_definer, false) then
    raise exception 'reviewed destination correction must be security definer';
  end if;

  if has_table_privilege('authenticated', 'public.payout_destination_corrections', 'INSERT')
    or has_function_privilege('authenticated', 'public.apply_reviewed_payout_destination_correction(uuid,text,text)', 'EXECUTE') then
    raise exception 'authenticated clients can mutate reviewed payout recovery state';
  end if;

  if not has_function_privilege('service_role', 'public.apply_reviewed_payout_destination_correction(uuid,text,text)', 'EXECUTE') then
    raise exception 'service role cannot execute reviewed payout recovery';
  end if;
end;
$$;
