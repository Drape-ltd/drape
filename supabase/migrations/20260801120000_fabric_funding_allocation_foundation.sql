-- Tailor-sourced fabric funding, section 1.
-- Establishes additive, legacy-safe quote/allocation/pricing contracts. This
-- migration does not opt existing orders into funded fabric or move money.

alter table public.orders
  add column if not exists fabric_funding_policy_version text;

-- Compatibility metadata only. Completed orders keep their commercial
-- behavior; temporarily bypass the terminal-row guard exactly as the base
-- commercial policy migration does.
alter table public.orders disable trigger orders_terminal_guard;

update public.orders
set fabric_funding_policy_version = coalesce(
  fabric_funding_policy_version,
  'legacy-material-add-on-v1'
);

alter table public.orders enable trigger orders_terminal_guard;

alter table public.orders
  alter column fabric_funding_policy_version set default 'legacy-material-add-on-v1',
  alter column fabric_funding_policy_version set not null;

alter table public.order_quotes
  add column if not exists fabric_funding_policy_version text,
  add column if not exists fabric_source_snapshot text,
  add column if not exists tailoring_amount integer,
  add column if not exists fabric_allowance_amount integer,
  add column if not exists fabric_allowance_currency currency,
  add column if not exists fabric_allowance_coverage jsonb,
  add column if not exists fabric_sourcing_assumptions text,
  add column if not exists pricing_version integer;

update public.order_quotes
set fabric_funding_policy_version = coalesce(
      fabric_funding_policy_version,
      'legacy-material-add-on-v1'
    ),
    pricing_version = coalesce(pricing_version, 1);

alter table public.order_quotes
  alter column fabric_funding_policy_version set default 'legacy-material-add-on-v1',
  alter column fabric_funding_policy_version set not null,
  alter column pricing_version set default 1,
  alter column pricing_version set not null;

alter table public.order_quotes
  drop constraint if exists order_quotes_fabric_allocation_check;
alter table public.order_quotes
  add constraint order_quotes_fabric_allocation_check check (
    fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
    or (
      fabric_source_snapshot in ('CUSTOMER_SUPPLIES', 'TAILOR_SOURCES')
      and tailoring_amount is not null
      and tailoring_amount >= 0
      and fabric_allowance_amount is not null
      and fabric_allowance_amount >= 0
      and fabric_allowance_currency = currency::currency
      and tailoring_amount + fabric_allowance_amount = subtotal_amount
      and pricing_version > 0
      and (
        (
          fabric_source_snapshot = 'CUSTOMER_SUPPLIES'
          and fabric_allowance_amount = 0
          and coalesce(fabric_allowance_coverage, '[]'::jsonb) = '[]'::jsonb
        )
        or (
          fabric_source_snapshot = 'TAILOR_SOURCES'
          and fabric_allowance_amount > 0
          and jsonb_typeof(fabric_allowance_coverage) = 'array'
          and jsonb_array_length(fabric_allowance_coverage) > 0
          and char_length(btrim(coalesce(fabric_sourcing_assumptions, ''))) >= 8
        )
      )
    )
  );

create or replace function public.prevent_order_quote_payload_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ORDER_QUOTE_SNAPSHOTS_ARE_APPEND_ONLY';
  end if;

  if row(
    new.order_id, new.version, new.change_kind, new.currency,
    new.subtotal_amount, new.tax_amount, new.platform_fee_amount,
    new.delivery_fee_amount, new.total_amount, new.completion_date,
    new.breakdown, new.assumptions, new.expires_at, new.created_by,
    new.created_by_role, new.created_at,
    new.fabric_funding_policy_version, new.fabric_source_snapshot,
    new.tailoring_amount, new.fabric_allowance_amount,
    new.fabric_allowance_currency, new.fabric_allowance_coverage,
    new.fabric_sourcing_assumptions, new.pricing_version
  ) is distinct from row(
    old.order_id, old.version, old.change_kind, old.currency,
    old.subtotal_amount, old.tax_amount, old.platform_fee_amount,
    old.delivery_fee_amount, old.total_amount, old.completion_date,
    old.breakdown, old.assumptions, old.expires_at, old.created_by,
    old.created_by_role, old.created_at,
    old.fabric_funding_policy_version, old.fabric_source_snapshot,
    old.tailoring_amount, old.fabric_allowance_amount,
    old.fabric_allowance_currency, old.fabric_allowance_coverage,
    old.fabric_sourcing_assumptions, old.pricing_version
  ) then
    raise exception 'ORDER_QUOTE_SNAPSHOT_PAYLOAD_IS_IMMUTABLE';
  end if;

  new.status_updated_at := now();
  return new;
end;
$$;

create table if not exists public.order_fabric_funding_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.orders(id) on delete restrict,
  quote_id uuid not null unique references public.order_quotes(id) on delete restrict,
  quote_version integer not null check (quote_version > 0),
  customer_id text not null,
  tailor_id text not null,
  fabric_source text not null check (fabric_source in ('CUSTOMER_SUPPLIES', 'TAILOR_SOURCES')),
  currency currency not null,
  seller_subtotal_amount integer not null check (seller_subtotal_amount >= 0),
  tailoring_amount integer not null check (tailoring_amount >= 0),
  base_allowance_amount integer not null check (base_allowance_amount >= 0),
  paid_adjustment_amount integer not null default 0 check (paid_adjustment_amount >= 0),
  funded_amount integer not null default 0 check (funded_amount >= 0),
  released_amount integer not null default 0 check (released_amount >= 0),
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  reconciled_spend_amount integer check (reconciled_spend_amount is null or reconciled_spend_amount >= 0),
  coverage jsonb not null default '[]'::jsonb,
  sourcing_assumptions text,
  status text not null default 'ACCEPTED_AWAITING_PAYMENT' check (status in (
    'ACCEPTED_AWAITING_PAYMENT',
    'FUNDED',
    'PARTIALLY_RELEASED',
    'FULLY_RELEASED',
    'RECONCILIATION_REQUIRED',
    'RECONCILED',
    'CANCELLED'
  )),
  policy_version text not null check (policy_version = 'fabric-funding-2026-08-01-v1'),
  pricing_version integer not null check (pricing_version > 0),
  correlation_id uuid not null default gen_random_uuid(),
  locked_at timestamptz not null default now(),
  funded_at timestamptz,
  reconciled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (tailoring_amount + base_allowance_amount = seller_subtotal_amount),
  check (
    (fabric_source = 'CUSTOMER_SUPPLIES' and base_allowance_amount = 0 and coverage = '[]'::jsonb)
    or (
      fabric_source = 'TAILOR_SOURCES'
      and base_allowance_amount > 0
      and jsonb_typeof(coverage) = 'array'
      and jsonb_array_length(coverage) > 0
      and char_length(btrim(coalesce(sourcing_assumptions, ''))) >= 8
    )
  ),
  check (funded_amount <= base_allowance_amount + paid_adjustment_amount),
  check (released_amount + refunded_amount <= funded_amount)
);

create index if not exists order_fabric_funding_allocations_status_idx
  on public.order_fabric_funding_allocations(status, updated_at);
create index if not exists order_fabric_funding_allocations_tailor_idx
  on public.order_fabric_funding_allocations(tailor_id, updated_at desc);

alter table public.order_fabric_funding_allocations enable row level security;

drop policy if exists "fabric allocations: participants can view"
  on public.order_fabric_funding_allocations;
create policy "fabric allocations: participants can view"
  on public.order_fabric_funding_allocations
  for select
  to authenticated
  using (
    customer_id = auth.uid()::text
    or tailor_id = auth.uid()::text
  );

grant select on public.order_fabric_funding_allocations to authenticated;
grant select, insert, update, delete on public.order_fabric_funding_allocations to service_role;

create or replace function public.protect_fabric_funding_allocation_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.order_id is distinct from old.order_id
    or new.quote_id is distinct from old.quote_id
    or new.quote_version is distinct from old.quote_version
    or new.customer_id is distinct from old.customer_id
    or new.tailor_id is distinct from old.tailor_id
    or new.fabric_source is distinct from old.fabric_source
    or new.currency is distinct from old.currency
    or new.seller_subtotal_amount is distinct from old.seller_subtotal_amount
    or new.tailoring_amount is distinct from old.tailoring_amount
    or new.base_allowance_amount is distinct from old.base_allowance_amount
    or new.coverage is distinct from old.coverage
    or new.sourcing_assumptions is distinct from old.sourcing_assumptions
    or new.policy_version is distinct from old.policy_version
    or new.pricing_version is distinct from old.pricing_version
    or new.correlation_id is distinct from old.correlation_id
    or new.locked_at is distinct from old.locked_at
  then
    raise exception 'FABRIC_FUNDING_ALLOCATION_IDENTITY_IS_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fabric_funding_allocation_identity_immutable
  on public.order_fabric_funding_allocations;
create trigger fabric_funding_allocation_identity_immutable
  before update on public.order_fabric_funding_allocations
  for each row execute function public.protect_fabric_funding_allocation_identity();

alter table public.commercial_pricing_reservations
  add column if not exists fabric_funding_policy_version text,
  add column if not exists fabric_source_snapshot text,
  add column if not exists tailoring_amount integer,
  add column if not exists fabric_allowance_amount integer,
  add column if not exists fabric_allowance_coverage jsonb,
  add column if not exists fabric_sourcing_assumptions text;

update public.commercial_pricing_reservations
set fabric_funding_policy_version = coalesce(
  fabric_funding_policy_version,
  'legacy-material-add-on-v1'
);

alter table public.commercial_pricing_reservations
  alter column fabric_funding_policy_version set default 'legacy-material-add-on-v1',
  alter column fabric_funding_policy_version set not null;

alter table public.commercial_pricing_reservations
  drop constraint if exists commercial_pricing_fabric_allocation_check;
alter table public.commercial_pricing_reservations
  add constraint commercial_pricing_fabric_allocation_check check (
    fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
    or (
      fabric_source_snapshot in ('CUSTOMER_SUPPLIES', 'TAILOR_SOURCES')
      and tailoring_amount is not null
      and tailoring_amount >= 0
      and fabric_allowance_amount is not null
      and fabric_allowance_amount >= 0
      and tailoring_amount + fabric_allowance_amount = subtotal_amount
      and (
        (fabric_source_snapshot = 'CUSTOMER_SUPPLIES' and fabric_allowance_amount = 0)
        or (
          fabric_source_snapshot = 'TAILOR_SOURCES'
          and fabric_allowance_amount > 0
          and jsonb_typeof(fabric_allowance_coverage) = 'array'
          and jsonb_array_length(fabric_allowance_coverage) > 0
          and char_length(btrim(coalesce(fabric_sourcing_assumptions, ''))) >= 8
        )
      )
    )
  );

create or replace function public.prevent_pricing_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.customer_id is distinct from old.customer_id
    or (old.order_id is not null and new.order_id is distinct from old.order_id)
    or new.quote_id is distinct from old.quote_id
    or new.purpose is distinct from old.purpose
    or new.policy_version is distinct from old.policy_version
    or new.pricing_version is distinct from old.pricing_version
    or new.currency is distinct from old.currency
    or new.subtotal_amount is distinct from old.subtotal_amount
    or new.platform_fee_amount is distinct from old.platform_fee_amount
    or new.tax_amount is distinct from old.tax_amount
    or new.shipping_amount is distinct from old.shipping_amount
    or new.total_amount is distinct from old.total_amount
    or new.tax_jurisdiction is distinct from old.tax_jurisdiction
    or new.tax_source is distinct from old.tax_source
    or new.tax_fallback is distinct from old.tax_fallback
    or new.breakdown is distinct from old.breakdown
    or new.fabric_funding_policy_version is distinct from old.fabric_funding_policy_version
    or new.fabric_source_snapshot is distinct from old.fabric_source_snapshot
    or new.tailoring_amount is distinct from old.tailoring_amount
    or new.fabric_allowance_amount is distinct from old.fabric_allowance_amount
    or new.fabric_allowance_coverage is distinct from old.fabric_allowance_coverage
    or new.fabric_sourcing_assumptions is distinct from old.fabric_sourcing_assumptions
    or new.correlation_id is distinct from old.correlation_id
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'Commercial pricing snapshots are immutable.';
  end if;
  return new;
end;
$$;

comment on column public.orders.fabric_funding_policy_version is
  'Legacy-safe opt-in boundary for protected fabric allowance behavior.';
comment on table public.order_fabric_funding_allocations is
  'Locked accepted-quote allocation and funded/released/refunded fabric liability balances.';
