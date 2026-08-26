-- Repair enum guards introduced by the funded-fabric release migrations.
-- Comparing an enum through coalesce(..., '') attempts to cast the empty
-- string to fabric_source and fails before the intended business error can run.

create or replace function public.create_funded_fabric_release_claim(
  p_order_id text,
  p_tailor_id uuid,
  p_title text,
  p_description text,
  p_amount integer,
  p_currency currency,
  p_estimate_storage_bucket text,
  p_estimate_storage_path text,
  p_estimate_photo_url text,
  p_idempotency_key text
)
returns public.order_material_advances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_detail public.custom_order_details%rowtype;
  v_evidence public.order_production_evidence%rowtype;
  v_existing public.order_material_advances%rowtype;
  v_claim public.order_material_advances%rowtype;
  v_remaining integer;
begin
  if p_amount <= 0 then raise exception 'FABRIC_RELEASE_AMOUNT_INVALID'; end if;
  if btrim(coalesce(p_estimate_storage_bucket, '')) <> 'commercial-evidence'
    or char_length(btrim(coalesce(p_estimate_storage_path, ''))) < 3 then
    raise exception 'PRIVATE_SUPPLIER_ESTIMATE_REQUIRED';
  end if;

  select * into v_existing from public.order_material_advances
  where idempotency_key = nullif(btrim(p_idempotency_key), '');
  if v_existing.id is not null then return v_existing; end if;

  select * into v_order from public.orders where id::text = p_order_id::text for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.tailor_id::text <> p_tailor_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_order.fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1' then raise exception 'LEGACY_MATERIAL_ADVANCE_REQUIRED'; end if;
  if v_order.fabric_source is distinct from 'TAILOR_SOURCES'::public.fabric_source then raise exception 'TAILOR_SOURCED_FABRIC_REQUIRED'; end if;
  if v_order.escrow_released is true then raise exception 'ORDER_FUNDS_ALREADY_RELEASED'; end if;

  select * into v_allocation from public.order_fabric_funding_allocations
  where order_id = p_order_id for update;
  if v_allocation.id is null or v_allocation.fabric_source <> 'TAILOR_SOURCES' then raise exception 'FABRIC_FUNDING_ALLOCATION_NOT_FOUND'; end if;
  if v_allocation.status not in ('FUNDED', 'PARTIALLY_RELEASED') then raise exception 'FABRIC_ALLOWANCE_NOT_FUNDED'; end if;
  if v_allocation.currency <> p_currency then raise exception 'CURRENCY_MISMATCH'; end if;
  v_remaining := v_allocation.funded_amount - v_allocation.released_amount - v_allocation.refunded_amount;
  if p_amount > v_remaining then raise exception 'FABRIC_RELEASE_EXCEEDS_ALLOWANCE:%', v_remaining; end if;

  select * into v_detail from public.custom_order_details where order_id = p_order_id;
  if v_detail.fabric_approval_required is not true or v_detail.fabric_approval_status <> 'APPROVED' then
    raise exception 'APPROVED_FABRIC_REQUIRED';
  end if;
  select * into v_evidence from public.order_production_evidence
  where order_id = p_order_id and stage_key = 'FABRIC'
    and coalesce(metadata->>'evidence_purpose', '') = 'FABRIC_APPROVAL'
    and cardinality(photo_urls) > 0
  order by created_at desc limit 1;
  if v_evidence.id is null then raise exception 'APPROVED_FABRIC_EVIDENCE_REQUIRED'; end if;

  insert into public.order_material_advances(
    order_id, customer_id, tailor_id, requested_by, title, description,
    amount, currency, status, release_status, estimate_photo_url,
    estimate_storage_bucket, estimate_storage_path, funding_source,
    fabric_allocation_id, fabric_approval_evidence_id, correlation_id,
    idempotency_key
  ) values (
    v_order.id, v_order.customer_id::uuid, v_order.tailor_id::uuid, p_tailor_id,
    btrim(p_title), btrim(p_description), p_amount, p_currency, 'REQUESTED',
    'NOT_REQUESTED', nullif(btrim(coalesce(p_estimate_photo_url, '')), ''),
    btrim(p_estimate_storage_bucket), btrim(p_estimate_storage_path),
    'FUNDED_FABRIC_ALLOWANCE', v_allocation.id, v_evidence.id,
    v_allocation.correlation_id, nullif(btrim(p_idempotency_key), '')
  ) returning * into v_claim;
  return v_claim;
end;
$$;

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
      or v_order.fabric_source is distinct from 'TAILOR_SOURCES'::public.fabric_source then raise exception 'FUNDED_FABRIC_ORDER_REQUIRED'; end if;
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
