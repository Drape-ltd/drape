-- Tailor-sourced fabric funding, section 3.
-- A fresh-policy material request is a claim against an already captured
-- fabric liability. It never creates a second customer payment.

alter table public.order_material_advances
  add column if not exists funding_source text not null default 'LEGACY_SEPARATE_PAYMENT',
  add column if not exists fabric_allocation_id uuid references public.order_fabric_funding_allocations(id) on delete restrict,
  add column if not exists fabric_approval_evidence_id uuid references public.order_production_evidence(id) on delete restrict,
  add column if not exists money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  add column if not exists payout_id text references public.payouts(id_text) on delete restrict,
  add column if not exists provider_release_status text not null default 'NOT_REQUESTED',
  add column if not exists provider_release_confirmed_at timestamptz,
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists idempotency_key text;

alter table public.order_material_advances
  drop constraint if exists order_material_advances_funding_source_check,
  add constraint order_material_advances_funding_source_check check (
    funding_source in ('LEGACY_SEPARATE_PAYMENT', 'FUNDED_FABRIC_ALLOWANCE')
  ),
  drop constraint if exists order_material_advances_provider_release_status_check,
  add constraint order_material_advances_provider_release_status_check check (
    provider_release_status in ('NOT_REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')
  ),
  drop constraint if exists order_material_advances_funded_claim_check,
  add constraint order_material_advances_funded_claim_check check (
    funding_source <> 'FUNDED_FABRIC_ALLOWANCE'
    or (
      fabric_allocation_id is not null
      and fabric_approval_evidence_id is not null
      and payment_id is null
      and provider_payment_id is null
      and provider_checkout_url is null
    )
  );

create unique index if not exists order_material_advances_idempotency_idx
  on public.order_material_advances(idempotency_key)
  where idempotency_key is not null;
create unique index if not exists order_material_advances_payout_idx
  on public.order_material_advances(payout_id)
  where payout_id is not null;

alter table public.payouts
  add column if not exists material_advance_id uuid references public.order_material_advances(id) on delete restrict;
create unique index if not exists payouts_material_advance_idx
  on public.payouts(material_advance_id)
  where material_advance_id is not null;

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
  if coalesce(v_order.fabric_source, '') <> 'TAILOR_SOURCES' then raise exception 'TAILOR_SOURCED_FABRIC_REQUIRED'; end if;
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

create or replace function public.approve_funded_fabric_release_claim(
  p_advance_id uuid,
  p_customer_id uuid,
  p_note text default null
)
returns public.order_material_advances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_claim public.order_material_advances%rowtype;
begin
  select * into v_claim from public.order_material_advances where id = p_advance_id for update;
  if v_claim.id is null then raise exception 'MATERIAL_ADVANCE_NOT_FOUND'; end if;
  if v_claim.customer_id <> p_customer_id then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_claim.funding_source <> 'FUNDED_FABRIC_ALLOWANCE' then raise exception 'LEGACY_MATERIAL_ADVANCE_REQUIRED'; end if;
  if v_claim.status <> 'REQUESTED' then raise exception 'MATERIAL_ADVANCE_NOT_OPEN'; end if;
  update public.order_material_advances set
    status = 'OPS_REVIEW', release_status = 'OPS_REVIEW',
    customer_response_note = nullif(btrim(coalesce(p_note, '')), ''),
    customer_response_reason = null, customer_approved_at = now(),
    release_requested_at = now()
  where id = v_claim.id returning * into v_claim;
  return v_claim;
end;
$$;

create or replace function public.link_funded_fabric_money_desk_request(
  p_advance_id uuid,
  p_money_desk_request_id uuid
)
returns public.order_material_advances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_claim public.order_material_advances%rowtype; v_request public.money_desk_requests%rowtype;
begin
  select * into v_claim from public.order_material_advances where id = p_advance_id for update;
  select * into v_request from public.money_desk_requests where id = p_money_desk_request_id;
  if v_claim.id is null or v_request.id is null then raise exception 'RELEASE_AUTHORITY_NOT_FOUND'; end if;
  if v_claim.funding_source <> 'FUNDED_FABRIC_ALLOWANCE' or v_claim.status <> 'OPS_REVIEW' then raise exception 'FUNDED_RELEASE_NOT_READY'; end if;
  if v_request.action_type <> 'MATERIAL_ADVANCE_RELEASE'
    or v_request.target_id <> v_claim.id::text
    or v_request.order_id <> v_claim.order_id::text
    or v_request.amount <> v_claim.amount
    or v_request.currency::text <> v_claim.currency::text then
    raise exception 'MONEY_DESK_REQUEST_MISMATCH';
  end if;
  update public.order_material_advances set money_desk_request_id = v_request.id
  where id = v_claim.id returning * into v_claim;
  return v_claim;
end;
$$;

create or replace function public.record_funded_fabric_provider_outcome(
  p_advance_id uuid,
  p_payout_id text,
  p_provider_reference text,
  p_outcome text,
  p_provider_response jsonb default '{}'::jsonb
)
returns public.order_material_advances
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_claim public.order_material_advances%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_transaction_id uuid;
  v_hash text;
begin
  select * into v_claim from public.order_material_advances where id = p_advance_id for update;
  if v_claim.id is null or v_claim.funding_source <> 'FUNDED_FABRIC_ALLOWANCE' then raise exception 'FUNDED_RELEASE_NOT_FOUND'; end if;
  if v_claim.provider_release_status = 'SUCCEEDED' and upper(p_outcome) = 'SUCCEEDED' then return v_claim; end if;
  select * into v_request from public.money_desk_requests where id = v_claim.money_desk_request_id;
  if v_request.id is null or v_request.status not in ('APPROVED', 'EXECUTING', 'SUCCEEDED') then raise exception 'APPROVED_MONEY_DESK_REQUEST_REQUIRED'; end if;
  if v_request.amount <> v_claim.amount or v_request.currency::text <> v_claim.currency::text then raise exception 'MONEY_DESK_AMOUNT_MISMATCH'; end if;

  if upper(p_outcome) <> 'SUCCEEDED' then
    update public.order_material_advances set status = 'BLOCKED', release_status = 'BLOCKED',
      provider_release_status = case when upper(p_outcome) = 'REVERSED' then 'REVERSED' else 'FAILED' end,
      provider_release_id = nullif(btrim(coalesce(p_provider_reference, '')), ''),
      provider_release_response = coalesce(p_provider_response, '{}'::jsonb), blocked_at = now()
    where id = v_claim.id returning * into v_claim;
    return v_claim;
  end if;

  select * into v_allocation from public.order_fabric_funding_allocations where id = v_claim.fabric_allocation_id for update;
  if v_allocation.id is null or v_claim.amount > v_allocation.funded_amount - v_allocation.released_amount - v_allocation.refunded_amount then
    raise exception 'FABRIC_ALLOWANCE_BALANCE_CHANGED';
  end if;
  v_hash := encode(digest(concat_ws('|', v_claim.id::text, v_claim.amount::text, v_claim.currency::text, p_provider_reference), 'sha256'), 'hex');
  insert into public.commercial_ledger_transactions(
    idempotency_key, request_hash, transaction_kind, purpose, order_id,
    policy_version, pricing_version, correlation_id, actor_role,
    original_currency, original_amount, settlement_currency, settlement_amount,
    provider_reference, metadata
  ) values (
    'funded-fabric-release:' || v_claim.id::text, v_hash, 'ADJUSTMENT', 'MATERIAL_ADVANCE', v_claim.order_id::text,
    'fabric-funding-2026-08-01-v1', v_allocation.pricing_version, v_claim.correlation_id, 'SYSTEM',
    v_claim.currency, v_claim.amount, v_claim.currency, v_claim.amount,
    p_provider_reference, jsonb_build_object('advanceId', v_claim.id, 'allocationId', v_allocation.id, 'payoutId', p_payout_id)
  ) on conflict (idempotency_key) do nothing returning id into v_transaction_id;
  if v_transaction_id is not null then
    insert into public.commercial_ledger_entries(transaction_id, order_id, account_code, account_scope, direction, amount, currency)
    values
      (v_transaction_id, v_claim.order_id::text, 'MATERIAL_ADVANCE_LIABILITY', 'order-fabric-allowance', 'DEBIT', v_claim.amount, v_claim.currency),
      (v_transaction_id, v_claim.order_id::text, 'TAILOR_RELEASED', 'material-advance', 'CREDIT', v_claim.amount, v_claim.currency);
    update public.order_fabric_funding_allocations set
      released_amount = released_amount + v_claim.amount,
      status = case when released_amount + v_claim.amount = funded_amount - refunded_amount then 'FULLY_RELEASED' else 'PARTIALLY_RELEASED' end
    where id = v_allocation.id;
  end if;
  update public.order_material_advances set status = 'RELEASED', release_status = 'RELEASED',
    provider_release_status = 'SUCCEEDED', provider_release_id = p_provider_reference,
    provider_release_response = coalesce(p_provider_response, '{}'::jsonb), payout_id = p_payout_id,
    provider_release_confirmed_at = now(), released_at = now(), release_blocked_reason = null
  where id = v_claim.id returning * into v_claim;
  return v_claim;
end;
$$;

revoke all on function public.create_funded_fabric_release_claim(text,uuid,text,text,integer,currency,text,text,text,text) from public, anon, authenticated;
revoke all on function public.approve_funded_fabric_release_claim(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.link_funded_fabric_money_desk_request(uuid,uuid) from public, anon, authenticated;
revoke all on function public.record_funded_fabric_provider_outcome(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_funded_fabric_release_claim(text,uuid,text,text,integer,currency,text,text,text,text) to service_role;
grant execute on function public.approve_funded_fabric_release_claim(uuid,uuid,text) to service_role;
grant execute on function public.link_funded_fabric_money_desk_request(uuid,uuid) to service_role;
grant execute on function public.record_funded_fabric_provider_outcome(uuid,text,text,text,jsonb) to service_role;

comment on column public.order_material_advances.funding_source is 'Legacy claims charge separately; funded claims consume the captured fabric liability.';
comment on function public.record_funded_fabric_provider_outcome is 'Atomically records provider-confirmed release, allocation consumption, and the balanced commercial ledger movement.';
