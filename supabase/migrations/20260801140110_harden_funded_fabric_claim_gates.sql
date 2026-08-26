-- Database-authoritative guards for funded fabric claims.

alter table public.order_material_advances
  drop constraint if exists order_material_advances_funded_terminal_check,
  add constraint order_material_advances_funded_terminal_check check (
    funding_source <> 'FUNDED_FABRIC_ALLOWANCE'
    or release_status <> 'RELEASED'
    or (
      status = 'RELEASED'
      and provider_release_status = 'SUCCEEDED'
      and provider_release_confirmed_at is not null
      and released_at is not null
      and payout_id is not null
      and money_desk_request_id is not null
    )
  );

create or replace function public.guard_funded_fabric_claim()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype; v_allocation public.order_fabric_funding_allocations%rowtype;
begin
  if new.funding_source <> 'FUNDED_FABRIC_ALLOWANCE' then return new; end if;
  if tg_op = 'UPDATE' and row(
    new.order_id,new.customer_id,new.tailor_id,new.requested_by,new.amount,new.currency,
    new.fabric_allocation_id,new.fabric_approval_evidence_id,new.correlation_id,new.idempotency_key
  ) is distinct from row(
    old.order_id,old.customer_id,old.tailor_id,old.requested_by,old.amount,old.currency,
    old.fabric_allocation_id,old.fabric_approval_evidence_id,old.correlation_id,old.idempotency_key
  ) then raise exception 'FUNDED_FABRIC_CLAIM_IDENTITY_IS_IMMUTABLE'; end if;

  if tg_op = 'INSERT' then
    select * into v_order from public.orders where id=new.order_id;
    select * into v_allocation from public.order_fabric_funding_allocations where id=new.fabric_allocation_id;
    if v_order.id is null or v_order.fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
      or coalesce(v_order.fabric_source,'') <> 'TAILOR_SOURCES' then raise exception 'FUNDED_FABRIC_ORDER_REQUIRED'; end if;
    if v_order.stage::text not in ('CONFIRMED','DESIGNING','SOURCING','CUTTING','SEWING','FINISHING','READY_FOR_COLLECTION','READY_FOR_DRAPE_DISPATCH')
      or v_order.escrow_released is true then raise exception 'ORDER_NOT_ACTIVE'; end if;
    if exists(select 1 from public.disputes d where d.order_id=new.order_id and d.status::text in ('OPEN','UNDER_REVIEW')) then raise exception 'ORDER_IN_DISPUTE'; end if;
    if exists(select 1 from public.order_material_advances a where a.order_id=new.order_id and a.release_status='RELEASED'
      and (a.reconciled_at is null or a.reconciliation_status in ('OPS_REVIEW','UNUSED_VALUE','OVERAGE'))) then raise exception 'MATERIAL_ADVANCE_RECONCILIATION_REQUIRED'; end if;
    if v_allocation.id is null or v_allocation.order_id <> new.order_id or v_allocation.currency <> new.currency
      or v_allocation.status not in ('FUNDED','PARTIALLY_RELEASED')
      or new.amount > v_allocation.funded_amount-v_allocation.released_amount-v_allocation.refunded_amount then
      raise exception 'FABRIC_ALLOWANCE_NOT_AVAILABLE';
    end if;
    if not exists(select 1 from public.order_production_evidence e where e.id=new.fabric_approval_evidence_id
      and e.order_id=new.order_id and e.stage_key='FABRIC' and coalesce(e.metadata->>'evidence_purpose','')='FABRIC_APPROVAL'
      and cardinality(e.photo_urls)>0) then raise exception 'APPROVED_FABRIC_EVIDENCE_REQUIRED'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists funded_fabric_claim_guard on public.order_material_advances;
create trigger funded_fabric_claim_guard before insert or update on public.order_material_advances
for each row execute function public.guard_funded_fabric_claim();
