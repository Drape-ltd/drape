-- Tailor-sourced fabric funding, section 4.
-- Costs above the funded allowance become a linked commercial adjustment.
-- The release claim is created only after provider-confirmed payment.

create table if not exists public.fabric_release_adjustment_links (
  adjustment_id uuid primary key references public.commercial_adjustments(id) on delete restrict,
  allocation_id uuid not null references public.order_fabric_funding_allocations(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  requested_release_amount integer not null check (requested_release_amount > 0),
  remaining_allowance_snapshot integer not null check (remaining_allowance_snapshot >= 0),
  shortfall_amount integer not null check (shortfall_amount > 0),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 1000),
  estimate_storage_bucket text not null check (estimate_storage_bucket = 'commercial-evidence'),
  estimate_storage_path text not null check (char_length(btrim(estimate_storage_path)) >= 3),
  material_advance_id uuid unique references public.order_material_advances(id) on delete restrict,
  correlation_id uuid not null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  check (requested_release_amount = remaining_allowance_snapshot + shortfall_amount)
);

alter table public.fabric_release_adjustment_links enable row level security;
create policy "fabric adjustment links: participants can view"
  on public.fabric_release_adjustment_links for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = fabric_release_adjustment_links.order_id
      and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
  ));
grant select on public.fabric_release_adjustment_links to authenticated;
grant select, insert, update on public.fabric_release_adjustment_links to service_role;

create or replace function public.create_fabric_release_commercial_adjustment(
  p_order_id text,
  p_tailor_id uuid,
  p_title text,
  p_description text,
  p_requested_release_amount integer,
  p_currency currency,
  p_estimate_storage_bucket text,
  p_estimate_storage_path text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_remaining integer;
  v_shortfall integer;
  v_customer_charge integer;
  v_result jsonb;
  v_adjustment_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.tailor_id::text <> p_tailor_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_order.fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
    or v_order.fabric_source is distinct from 'TAILOR_SOURCES'::public.fabric_source then
    raise exception 'FUNDED_TAILOR_FABRIC_REQUIRED';
  end if;
  if v_order.escrow_released is true then raise exception 'ORDER_FUNDS_ALREADY_RELEASED'; end if;
  if btrim(coalesce(p_estimate_storage_bucket, '')) <> 'commercial-evidence'
    or char_length(btrim(coalesce(p_estimate_storage_path, ''))) < 3 then
    raise exception 'PRIVATE_SUPPLIER_ESTIMATE_REQUIRED';
  end if;

  select * into v_allocation from public.order_fabric_funding_allocations
  where order_id = p_order_id for update;
  if v_allocation.id is null or v_allocation.status not in ('FUNDED', 'PARTIALLY_RELEASED') then
    raise exception 'FABRIC_ALLOWANCE_NOT_FUNDED';
  end if;
  if v_allocation.currency <> p_currency then raise exception 'CURRENCY_MISMATCH'; end if;
  v_remaining := v_allocation.funded_amount - v_allocation.released_amount - v_allocation.refunded_amount;
  if p_requested_release_amount <= v_remaining then raise exception 'FUNDED_RELEASE_DOES_NOT_REQUIRE_ADJUSTMENT'; end if;
  v_shortfall := p_requested_release_amount - v_remaining;
  -- amount_delta is customer total; the allocation receives only the material shortfall.
  v_customer_charge := ceil(v_shortfall::numeric * (10000 + greatest(coalesce(v_order.tax_rate_bps, 0), 0)) / 10000)::integer;

  v_result := public.create_commercial_adjustment(
    p_idempotency_key, p_order_id, p_tailor_id, 'TAILOR', 'MATERIAL',
    'Additional approved fabric funding',
    btrim(p_description), 'CUSTOMER', v_customer_charge, p_currency, null, '{}'::uuid[],
    v_allocation.correlation_id
  );
  v_adjustment_id := (v_result->>'adjustmentId')::uuid;

  insert into public.fabric_release_adjustment_links(
    adjustment_id, allocation_id, order_id, requested_release_amount,
    remaining_allowance_snapshot, shortfall_amount, title, description,
    estimate_storage_bucket, estimate_storage_path, correlation_id
  ) values (
    v_adjustment_id, v_allocation.id, p_order_id, p_requested_release_amount,
    v_remaining, v_shortfall, btrim(p_title), btrim(p_description),
    p_estimate_storage_bucket, p_estimate_storage_path, v_allocation.correlation_id
  ) on conflict (adjustment_id) do nothing;

  return v_result || jsonb_build_object(
    'requestedReleaseAmount', p_requested_release_amount,
    'remainingAllowanceAmount', v_remaining,
    'shortfallAmount', v_shortfall,
    'customerChargeAmount', v_customer_charge
  );
end;
$$;

create or replace function public.activate_paid_fabric_release_adjustment(p_adjustment_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_link public.fabric_release_adjustment_links%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_claim public.order_material_advances%rowtype;
begin
  select * into v_adjustment from public.commercial_adjustments where id = p_adjustment_id for update;
  select * into v_link from public.fabric_release_adjustment_links where adjustment_id = p_adjustment_id for update;
  if v_link.adjustment_id is null then return jsonb_build_object('linked', false); end if;
  if v_link.material_advance_id is not null then
    return jsonb_build_object('linked', true, 'materialAdvanceId', v_link.material_advance_id, 'duplicate', true);
  end if;
  if v_adjustment.status <> 'PAID' or v_adjustment.payment_id is null then raise exception 'PROVIDER_CONFIRMED_ADJUSTMENT_REQUIRED'; end if;
  select * into v_allocation from public.order_fabric_funding_allocations where id = v_link.allocation_id for update;
  if v_allocation.id is null or v_allocation.currency <> v_adjustment.currency then raise exception 'FABRIC_ALLOCATION_MISMATCH'; end if;

  update public.order_fabric_funding_allocations set
    paid_adjustment_amount = paid_adjustment_amount + v_link.shortfall_amount,
    funded_amount = funded_amount + v_link.shortfall_amount,
    status = case when released_amount > 0 then 'PARTIALLY_RELEASED' else 'FUNDED' end
  where id = v_allocation.id;

  select * into v_claim from public.create_funded_fabric_release_claim(
    v_link.order_id, v_adjustment.tailor_id::uuid, v_link.title, v_link.description,
    v_link.requested_release_amount, v_adjustment.currency,
    v_link.estimate_storage_bucket, v_link.estimate_storage_path, null,
    'fabric-adjustment-claim:' || p_adjustment_id::text
  );
  update public.fabric_release_adjustment_links
    set material_advance_id = v_claim.id, activated_at = now()
    where adjustment_id = p_adjustment_id;
  return jsonb_build_object('linked', true, 'materialAdvanceId', v_claim.id, 'duplicate', false);
end;
$$;

revoke all on function public.create_fabric_release_commercial_adjustment(text,uuid,text,text,integer,currency,text,text,text) from public, anon, authenticated;
revoke all on function public.activate_paid_fabric_release_adjustment(uuid) from public, anon, authenticated;
grant execute on function public.create_fabric_release_commercial_adjustment(text,uuid,text,text,integer,currency,text,text,text) to service_role;
grant execute on function public.activate_paid_fabric_release_adjustment(uuid) to service_role;

comment on table public.fabric_release_adjustment_links is
  'Immutable correlation bridge from an over-allowance supplier request through adjustment payment to the funded release claim.';
