-- Tailor-sourced fabric funding, section 5.
-- A final receipt and a separate acquired-fabric proof close the release.
-- Funded fabric is excluded from tailor settlement so it cannot be paid twice.

alter table public.order_material_advances
  add column if not exists acquired_storage_bucket text,
  add column if not exists acquired_storage_path text,
  add column if not exists acquired_uploaded_at timestamptz,
  add column if not exists reconciliation_outcome text check (reconciliation_outcome in ('EXACT','UNUSED_VALUE','OVERAGE')),
  add column if not exists customer_refund_amount integer not null default 0 check (customer_refund_amount >= 0),
  add column if not exists protected_allowance_refund_amount integer not null default 0 check (protected_allowance_refund_amount >= 0),
  add column if not exists settlement_recovery_amount integer not null default 0 check (settlement_recovery_amount >= 0),
  add column if not exists unapproved_overage_amount integer not null default 0 check (unapproved_overage_amount >= 0),
  add column if not exists reconciliation_resolution text check (reconciliation_resolution in ('EXACT','CUSTOMER_REFUNDED','TAILOR_ABSORBS','CUSTOMER_ADJUSTMENT_PAID')),
  add column if not exists reconciliation_resolved_at timestamptz,
  add column if not exists reconciliation_money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  add column if not exists refund_provider_started_at timestamptz,
  add column if not exists refund_provider_completed_at timestamptz,
  add column if not exists refund_provider_reference text;

alter table public.order_settlement_plans
  add column if not exists seller_subtotal_amount integer,
  add column if not exists excluded_fabric_allowance_amount integer not null default 0 check (excluded_fabric_allowance_amount >= 0),
  add column if not exists material_recovery_offset_amount integer not null default 0 check (material_recovery_offset_amount >= 0);

alter table public.order_fabric_funding_allocations
  add column if not exists recovered_amount integer not null default 0 check (recovered_amount >= 0);

create or replace function public.initialize_order_settlement_plan(p_order_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_order public.orders%rowtype; v_payment public.order_payments%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_plan uuid; v_method text; v_amount integer; v_seller_subtotal integer;
  v_excluded integer:=0; v_currency currency; v_correlation uuid;
  v_allocated integer:=0; v_amounts integer[]; v_codes text[]; v_bps integer[]; i integer;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;
  if v_order.commercial_policy_version <> 'commercial-2026-07-31-v1' then return null; end if;
  select * into v_payment from public.order_payments where order_id=p_order_id and phase='INITIAL_ORDER' and status in ('SUCCEEDED','PARTIAL_REFUND') order by confirmed_at desc nulls last limit 1;
  if v_payment.id is null or v_payment.ledger_recorded_at is null then raise exception 'A ledger-recorded initial payment is required.'; end if;
  v_seller_subtotal:=coalesce((v_payment.commercial_breakdown->>'subtotalAmount')::integer,v_order.subtotal_amount,v_order.source_amount);
  select * into v_allocation from public.order_fabric_funding_allocations where order_id=p_order_id;
  if v_order.fabric_funding_policy_version='fabric-funding-2026-08-01-v1' then
    if v_allocation.id is null or v_allocation.tailoring_amount<=0 then raise exception 'Funded-fabric settlement requires the locked tailoring allocation.'; end if;
    v_amount:=v_allocation.tailoring_amount;
    v_excluded:=v_allocation.base_allowance_amount+v_allocation.paid_adjustment_amount;
  else v_amount:=v_seller_subtotal; end if;
  if coalesce(v_amount,0)<=0 then raise exception 'Tailor entitlement is missing.'; end if;
  v_currency:=v_payment.currency; v_correlation:=v_payment.correlation_id;
  v_method:=case when v_order.delivery_method='LOCAL_COLLECTION' then 'LOCAL_HANDOFF' else 'SHIPPED' end;
  insert into public.order_settlement_plans(order_id,customer_id,tailor_id,source_payment_id,method,currency,entitlement_amount,seller_subtotal_amount,excluded_fabric_allowance_amount,correlation_id)
  values(p_order_id,v_order.customer_id::uuid,v_order.tailor_id::uuid,v_payment.id,v_method,v_currency,v_amount,v_seller_subtotal,v_excluded,v_correlation)
  on conflict(order_id) do nothing returning id into v_plan;
  if v_plan is null then select id into v_plan from public.order_settlement_plans where order_id=p_order_id; return v_plan; end if;
  if v_method='LOCAL_HANDOFF' then v_codes:=array['LOCAL_HANDOFF_80','LOCAL_SETTLED_20']; v_bps:=array[8000,2000]; else v_codes:=array['SHIP_CUSTODY_70','SHIP_DELIVERY_20','SHIP_PROTECTION_10']; v_bps:=array[7000,2000,1000]; end if;
  v_amounts:=array[]::integer[];
  for i in 1..array_length(v_codes,1) loop v_amounts:=array_append(v_amounts,(v_amount::bigint*v_bps[i]/10000)::integer); v_allocated:=v_allocated+v_amounts[i]; end loop;
  v_amounts[1]:=v_amounts[1]+(v_amount-v_allocated);
  for i in 1..array_length(v_codes,1) loop
    insert into public.order_settlement_tranches(plan_id,order_id,code,sequence,basis_points,amount,currency,correlation_id)
    values(v_plan,p_order_id,v_codes[i],i,v_bps[i],v_amounts[i],v_currency,v_correlation);
  end loop;
  insert into public.order_settlement_events(plan_id,event_type,actor_role,payload,correlation_id)
  values(v_plan,'PLAN_CREATED','SYSTEM',jsonb_build_object('method',v_method,'entitlement_amount',v_amount,'seller_subtotal_amount',v_seller_subtotal,'excluded_fabric_allowance_amount',v_excluded,'currency',v_currency),v_correlation);
  return v_plan;
end $$;

-- Repair only plans whose tranches are all still locked. Eligibility already
-- writes ledger rows, so any plan beyond LOCKED remains frozen for Ops review.
update public.order_settlement_plans p set
  seller_subtotal_amount=a.seller_subtotal_amount,
  entitlement_amount=a.tailoring_amount,
  excluded_fabric_allowance_amount=a.base_allowance_amount+a.paid_adjustment_amount,
  updated_at=now()
from public.order_fabric_funding_allocations a
where a.order_id=p.order_id
  and p.entitlement_amount<>a.tailoring_amount
  and not exists(select 1 from public.order_settlement_tranches t where t.plan_id=p.id and t.status<>'LOCKED');

with base as (
  select t.id,t.plan_id,t.sequence,(p.entitlement_amount::bigint*t.basis_points/10000)::integer as base_amount,p.entitlement_amount
  from public.order_settlement_tranches t join public.order_settlement_plans p on p.id=t.plan_id
  join public.order_fabric_funding_allocations a on a.order_id=p.order_id
  where not exists(select 1 from public.order_settlement_tranches x where x.plan_id=p.id and x.status<>'LOCKED')
), totals as (
  select plan_id,sum(base_amount) allocated,max(entitlement_amount) entitlement_amount from base group by plan_id
)
update public.order_settlement_tranches t set amount=b.base_amount+case when b.sequence=1 then totals.entitlement_amount-totals.allocated else 0 end,updated_at=now()
from base b join totals on totals.plan_id=b.plan_id where t.id=b.id;

create or replace function public.reconcile_material_advance_v2(
  p_advance_id uuid,p_tailor_id uuid,p_actual_spent_amount integer,
  p_receipt_storage_bucket text,p_receipt_storage_path text,
  p_acquired_storage_bucket text,p_acquired_storage_path text,
  p_receipt_url text default null,p_note text default null,p_correlation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_advance public.order_material_advances%rowtype; v_allocation public.order_fabric_funding_allocations%rowtype; v_case public.financial_cases%rowtype; v_result jsonb; v_outcome text; v_delta integer; v_protected_refund integer:=0; v_recovery integer:=0; v_customer_refund integer:=0;
begin
  select * into v_advance from public.order_material_advances where id=p_advance_id for update;
  if v_advance.id is null then raise exception 'MATERIAL_ADVANCE_NOT_FOUND'; end if;
  if v_advance.funding_source='FUNDED_FABRIC_ALLOWANCE' and (
    btrim(coalesce(p_acquired_storage_bucket,''))<>'commercial-evidence'
    or char_length(btrim(coalesce(p_acquired_storage_path,'')))<3
  ) then raise exception 'ACQUIRED_FABRIC_PROOF_REQUIRED'; end if;
  if v_advance.reconciled_at is not null then
    if v_advance.actual_spent_amount<>p_actual_spent_amount
      or v_advance.receipt_storage_path<>p_receipt_storage_path
      or coalesce(v_advance.acquired_storage_path,'')<>coalesce(p_acquired_storage_path,'')
    then raise exception 'MATERIAL_RECONCILIATION_ALREADY_SUBMITTED'; end if;
    return jsonb_build_object(
      'advanceId',v_advance.id,'outcome',v_advance.reconciliation_outcome,
      'deltaAmount',v_advance.reconciliation_delta,
      'customerRefundAmount',v_advance.customer_refund_amount,
      'unapprovedOverageAmount',v_advance.unapproved_overage_amount,
      'duplicate',true
    );
  end if;
  v_result:=public.reconcile_material_advance(p_advance_id,p_tailor_id,p_actual_spent_amount,p_receipt_storage_bucket,p_receipt_storage_path,p_receipt_url,p_note,p_correlation_id);
  v_delta:=p_actual_spent_amount-v_advance.amount;
  if v_advance.fabric_allocation_id is not null then
    select * into v_allocation from public.order_fabric_funding_allocations where id=v_advance.fabric_allocation_id for update;
  end if;
  if v_delta<=0 then
    v_recovery:=greatest(-v_delta,0);
    v_protected_refund:=greatest(coalesce(v_allocation.funded_amount,0)-coalesce(v_allocation.released_amount,0)-coalesce(v_allocation.refunded_amount,0),0);
    v_customer_refund:=v_recovery+v_protected_refund;
  end if;
  v_outcome:=case when v_delta>0 then 'OVERAGE' when v_customer_refund>0 then 'UNUSED_VALUE' else 'EXACT' end;
  update public.order_material_advances set
    acquired_storage_bucket=nullif(btrim(coalesce(p_acquired_storage_bucket,'')),''),
    acquired_storage_path=nullif(btrim(coalesce(p_acquired_storage_path,'')),''),
    acquired_uploaded_at=case when nullif(btrim(coalesce(p_acquired_storage_path,'')),'') is not null then now() else null end,
    reconciliation_outcome=v_outcome,
    customer_refund_amount=v_customer_refund,
    protected_allowance_refund_amount=v_protected_refund,
    settlement_recovery_amount=v_recovery,
    unapproved_overage_amount=greatest(v_delta,0),
    reconciliation_resolution=case when v_outcome='EXACT' then 'EXACT' else null end,
    reconciliation_resolved_at=case when v_outcome='EXACT' then now() else null end,
    reconciliation_status=case when v_outcome='EXACT' then 'EXACT' else 'OPS_REVIEW' end
  where id=p_advance_id;
  if v_outcome='UNUSED_VALUE' and v_delta=0 and v_advance.reconciliation_case_id is null then
    insert into public.financial_cases(
      idempotency_key,request_hash,order_id,case_type,status,opened_by,opened_by_role,counterparty_id,
      reason_code,summary,claim_details,requested_outcome,requested_amount,requested_currency,
      money_movement_blocked,policy_version,correlation_id
    ) values(
      'material-reconciliation:'||v_advance.id::text,
      encode(digest(concat_ws('|',v_advance.id::text,p_actual_spent_amount::text,p_receipt_storage_path,v_customer_refund::text),'sha256'),'hex'),
      v_advance.order_id,'MATERIAL_REQUEST','OPS_REVIEW',p_tailor_id,'TAILOR',v_advance.customer_id,
      'UNUSED_VALUE','The final fabric reconciliation left customer-funded value unused.',
      jsonb_build_object('advanceId',v_advance.id,'approvedAmount',v_advance.amount,'actualAmount',p_actual_spent_amount,
        'releasedRecoveryAmount',v_recovery,'protectedAllowanceRefundAmount',v_protected_refund,'receiptPath',p_receipt_storage_path),
      'OPS_HELP',v_customer_refund,v_advance.currency,true,'commercial-2026-07-31-v1',p_correlation_id
    ) returning * into v_case;
    update public.order_material_advances set reconciliation_case_id=v_case.id where id=v_advance.id;
    insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
    values(v_case.id,'CASE_OPENED',p_tailor_id,'TAILOR',jsonb_build_object('outcome',v_outcome,'customerRefundAmount',v_customer_refund),p_correlation_id);
  end if;
  if v_advance.fabric_allocation_id is not null then
    update public.order_fabric_funding_allocations set
      reconciled_spend_amount=coalesce(reconciled_spend_amount,0)+least(p_actual_spent_amount,v_advance.amount),
      status=case when v_outcome='EXACT' and released_amount+refunded_amount>=funded_amount then 'RECONCILED' when v_outcome='EXACT' then status else 'RECONCILIATION_REQUIRED' end,
      reconciled_at=case when v_outcome='EXACT' and released_amount+refunded_amount>=funded_amount then now() else reconciled_at end
    where id=v_advance.fabric_allocation_id;
  end if;
  return v_result||jsonb_build_object('outcome',v_outcome,'customerRefundAmount',v_customer_refund,'protectedAllowanceRefundAmount',v_protected_refund,'settlementRecoveryAmount',v_recovery,'unapprovedOverageAmount',greatest(v_delta,0));
end $$;

create or replace function public.prepare_material_unused_value_refund(
  p_advance_id uuid,p_money_desk_request_id uuid,p_actor_email text
)
returns public.order_material_advances language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_advance public.order_material_advances%rowtype; v_request public.money_desk_requests%rowtype;
  v_plan public.order_settlement_plans%rowtype; v_allocated integer:=0; v_remainder integer;
begin
  select * into v_advance from public.order_material_advances where id=p_advance_id for update;
  if v_advance.id is null or v_advance.reconciliation_outcome<>'UNUSED_VALUE' or v_advance.customer_refund_amount<=0 then
    raise exception 'MATERIAL_UNUSED_VALUE_NOT_OPEN';
  end if;
  select * into v_request from public.money_desk_requests where id=p_money_desk_request_id for update;
  if v_request.id is null or v_request.action_type<>'CUSTOMER_REFUND' or v_request.target_type<>'ORDER_MATERIAL_ADVANCE'
    or v_request.target_id<>p_advance_id::text or v_request.order_id<>v_advance.order_id
    or v_request.amount<>v_advance.customer_refund_amount or v_request.currency<>v_advance.currency
    or v_request.status not in ('APPROVED','EXECUTING','SUCCEEDED')
  then raise exception 'MATERIAL_REFUND_MONEY_DESK_MISMATCH'; end if;
  if v_advance.reconciliation_resolution='CUSTOMER_REFUNDED' then return v_advance; end if;
  if v_advance.reconciliation_money_desk_request_id is not null
    and v_advance.reconciliation_money_desk_request_id<>p_money_desk_request_id
  then raise exception 'MATERIAL_REFUND_ALREADY_LINKED'; end if;

  select * into v_plan from public.order_settlement_plans where order_id=v_advance.order_id for update;
  if v_plan.id is null then
    perform public.initialize_order_settlement_plan(v_advance.order_id::text);
    select * into v_plan from public.order_settlement_plans where order_id=v_advance.order_id for update;
  end if;
  if v_plan.id is null or v_plan.entitlement_amount<=v_advance.settlement_recovery_amount
    or exists(select 1 from public.order_settlement_tranches where plan_id=v_plan.id and status<>'LOCKED')
  then raise exception 'MATERIAL_REFUND_REQUIRES_FROZEN_SETTLEMENT_REVIEW'; end if;

  if v_advance.reconciliation_money_desk_request_id is null then
    update public.order_settlement_plans set
      entitlement_amount=entitlement_amount-v_advance.settlement_recovery_amount,
      material_recovery_offset_amount=material_recovery_offset_amount+v_advance.settlement_recovery_amount,
      updated_at=now()
    where id=v_plan.id returning * into v_plan;
    select coalesce(sum((v_plan.entitlement_amount::bigint*basis_points/10000)::integer),0)
      into v_allocated from public.order_settlement_tranches where plan_id=v_plan.id;
    v_remainder:=v_plan.entitlement_amount-v_allocated;
    update public.order_settlement_tranches set
      amount=(v_plan.entitlement_amount::bigint*basis_points/10000)::integer+case when sequence=1 then v_remainder else 0 end,
      updated_at=now()
    where plan_id=v_plan.id;
    insert into public.order_settlement_events(plan_id,event_type,actor_role,payload,correlation_id)
    values(v_plan.id,'PLAN_ADJUSTED','OPS',jsonb_build_object(
      'reason','MATERIAL_UNUSED_VALUE_REFUND','advanceId',p_advance_id,
      'customerRefundAmount',v_advance.customer_refund_amount,
      'protectedAllowanceRefundAmount',v_advance.protected_allowance_refund_amount,
      'settlementRecoveryAmount',v_advance.settlement_recovery_amount,
      'entitlementAmount',v_plan.entitlement_amount,'actorEmail',lower(btrim(p_actor_email))
    ),v_advance.reconciliation_correlation_id);
    update public.order_material_advances set reconciliation_money_desk_request_id=p_money_desk_request_id
      where id=p_advance_id returning * into v_advance;
  end if;
  return v_advance;
end $$;

create or replace function public.finalize_material_unused_value_refund(
  p_advance_id uuid,p_money_desk_request_id uuid,p_actor_email text
)
returns public.order_material_advances language plpgsql security definer set search_path=public,pg_temp as $$
declare v_advance public.order_material_advances%rowtype; v_request public.money_desk_requests%rowtype;
begin
  select * into v_advance from public.order_material_advances where id=p_advance_id for update;
  select * into v_request from public.money_desk_requests where id=p_money_desk_request_id;
  if v_advance.id is null or v_advance.reconciliation_money_desk_request_id<>p_money_desk_request_id
    or v_request.status<>'SUCCEEDED' or v_advance.refund_provider_completed_at is null
  then raise exception 'MATERIAL_REFUND_NOT_SUCCEEDED'; end if;
  if v_advance.reconciliation_resolution='CUSTOMER_REFUNDED' then return v_advance; end if;
  update public.order_fabric_funding_allocations set
    refunded_amount=refunded_amount+v_advance.protected_allowance_refund_amount,
    recovered_amount=recovered_amount+v_advance.settlement_recovery_amount,
    status='RECONCILED',reconciled_at=now(),
    updated_at=now()
  where id=v_advance.fabric_allocation_id;
  update public.order_material_advances set reconciliation_status='RESOLVED',reconciliation_resolution='CUSTOMER_REFUNDED',
    reconciliation_resolved_at=now() where id=p_advance_id returning * into v_advance;
  update public.financial_cases set status='RESOLVED',money_movement_blocked=false,resolved_at=now(),resolved_by=null,
    resolution_code='CUSTOMER_REFUNDED_UNUSED_MATERIAL',resolution_summary='Unused approved fabric value was refunded through the reviewed Money Desk flow.'
    where id=v_advance.reconciliation_case_id;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
  values(v_advance.reconciliation_case_id,'CASE_RESOLVED',null,'OPS',jsonb_build_object(
    'resolution','CUSTOMER_REFUNDED','customerRefundAmount',v_advance.customer_refund_amount,
    'moneyDeskRequestId',p_money_desk_request_id,'actorEmail',lower(btrim(p_actor_email))
  ),v_advance.reconciliation_correlation_id);
  return v_advance;
end $$;

create or replace function public.resolve_material_overage_as_tailor_absorbed(p_advance_id uuid,p_actor_email text,p_note text)
returns public.order_material_advances language plpgsql security definer set search_path=public,pg_temp as $$
declare v_advance public.order_material_advances%rowtype;
begin
  if char_length(btrim(coalesce(p_note,'')))<10 then raise exception 'A clear Ops resolution note is required.'; end if;
  select * into v_advance from public.order_material_advances where id=p_advance_id for update;
  if v_advance.reconciliation_outcome<>'OVERAGE' or v_advance.reconciliation_status<>'OPS_REVIEW' then raise exception 'MATERIAL_OVERAGE_NOT_OPEN'; end if;
  update public.order_material_advances set reconciliation_status='RESOLVED',reconciliation_resolution='TAILOR_ABSORBS',reconciliation_resolved_at=now() where id=p_advance_id returning * into v_advance;
  update public.financial_cases set status='RESOLVED',money_movement_blocked=false,resolved_at=now(),resolved_by=null,resolution_code='TAILOR_ABSORBS_OVERAGE',resolution_summary=btrim(p_note) where id=v_advance.reconciliation_case_id;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
  values(v_advance.reconciliation_case_id,'CASE_RESOLVED',null,'OPS',jsonb_build_object('resolution','TAILOR_ABSORBS','overageAmount',v_advance.unapproved_overage_amount,'note',btrim(p_note),'actorEmail',lower(btrim(p_actor_email))),v_advance.reconciliation_correlation_id);
  return v_advance;
end $$;

create or replace function public.guard_funded_fabric_cutting()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.stage::text='CUTTING' and old.stage::text is distinct from 'CUTTING'
    and new.fabric_funding_policy_version='fabric-funding-2026-08-01-v1'
    and new.fabric_source is not distinct from 'TAILOR_SOURCES'::public.fabric_source
    and not exists(
      select 1 from public.order_material_advances a where a.order_id=new.id
      and a.funding_source='FUNDED_FABRIC_ALLOWANCE' and a.release_status='RELEASED'
      and a.provider_release_status='SUCCEEDED' and a.acquired_storage_bucket='commercial-evidence'
      and a.acquired_storage_path is not null and a.reconciliation_status in ('EXACT','RESOLVED')
    ) then raise exception 'FABRIC_ACQUIRED_AND_RECONCILED_REQUIRED';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_funded_fabric_cutting on public.orders;
create trigger orders_guard_funded_fabric_cutting before update of stage on public.orders for each row execute function public.guard_funded_fabric_cutting();

revoke all on function public.reconcile_material_advance_v2(uuid,uuid,integer,text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.resolve_material_overage_as_tailor_absorbed(uuid,text,text) from public,anon,authenticated;
revoke all on function public.prepare_material_unused_value_refund(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finalize_material_unused_value_refund(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_material_advance_v2(uuid,uuid,integer,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.resolve_material_overage_as_tailor_absorbed(uuid,text,text) to service_role;
grant execute on function public.prepare_material_unused_value_refund(uuid,uuid,text) to service_role;
grant execute on function public.finalize_material_unused_value_refund(uuid,uuid,text) to service_role;

comment on column public.order_settlement_plans.excluded_fabric_allowance_amount is 'Protected fabric value excluded from tailor settlement to prevent a second payout.';
comment on column public.order_material_advances.acquired_storage_path is 'Private proof that the exact approved fabric was acquired after provider-confirmed release.';
