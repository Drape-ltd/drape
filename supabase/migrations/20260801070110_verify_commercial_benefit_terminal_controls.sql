-- Structural proof for the controls added after the core Implementation 10
-- reservation/append-only verification. This migration is intentionally read-only.
do $verification$
declare v_constraint text;
begin
  if to_regprocedure('public.lock_order_benefit_for_payment(uuid,uuid,text)') is null then raise exception 'Benefit payment lock RPC is missing.'; end if;
  if to_regprocedure('public.expire_commercial_benefit_reservations(integer)') is null then raise exception 'Benefit expiry RPC is missing.'; end if;
  if to_regprocedure('public.ops_prepare_commercial_campaign(text,text,currency,integer,text,integer,integer,integer,text,text)') is null then raise exception 'Campaign preparation RPC is missing.'; end if;
  if to_regprocedure('public.ops_activate_commercial_campaign(uuid,text)') is null then raise exception 'Campaign activation RPC is missing.'; end if;
  if to_regprocedure('public.ops_create_commercial_grant(uuid,uuid,integer,timestamptz,text,text)') is null then raise exception 'Grant creation RPC is missing.'; end if;
  if to_regclass('public.commercial_tip_reporting') is null or to_regclass('public.commercial_delivery_outcome_reporting') is null then raise exception 'Commercial outcome reporting views are missing.'; end if;
  if not exists(select 1 from cron.job where jobname='expire-commercial-benefits') then raise exception 'Benefit expiry monitor is not scheduled.'; end if;
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint where conname='money_desk_requests_action_type_check' and conrelid='public.money_desk_requests'::regclass;
  if v_constraint is null or position('TIP_PAYOUT' in v_constraint)=0 then raise exception 'Tip payout is not protected by the Money Desk action contract.'; end if;
  if has_function_privilege('authenticated','public.ops_activate_commercial_campaign(uuid,text)','EXECUTE') then raise exception 'Campaign activation leaked to authenticated clients.'; end if;
  raise notice 'Implementation 10 payment locks, expiry, independent campaign controls, tip payout gate, and terminal reporting passed.';
end;
$verification$;
