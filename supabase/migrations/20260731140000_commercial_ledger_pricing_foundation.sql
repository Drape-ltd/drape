-- Drapeon commercial architecture, implementation 2.
-- Adds versioned pricing reservations and an immutable balanced ledger without
-- changing the payout policy of existing orders.

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists commercial_policy_version text;

-- This is a metadata-only compatibility backfill. Preserve the runtime terminal
-- guard, but temporarily disable it exactly as the earlier payment foundation
-- migration does for immutable completed orders.
alter table public.orders disable trigger orders_terminal_guard;

update public.orders
set commercial_policy_version = coalesce(commercial_policy_version, 'legacy-single-release-72h');

alter table public.orders enable trigger orders_terminal_guard;

alter table public.orders
  alter column commercial_policy_version set default 'commercial-2026-07-31-v1',
  alter column commercial_policy_version set not null;

alter table public.order_payments
  add column if not exists policy_version text,
  add column if not exists pricing_version integer,
  add column if not exists correlation_id uuid,
  add column if not exists commercial_breakdown jsonb,
  add column if not exists ledger_recorded_at timestamptz;

update public.order_payments
set policy_version = coalesce(policy_version, 'legacy-single-release-72h'),
    pricing_version = coalesce(pricing_version, 1),
    correlation_id = coalesce(correlation_id, gen_random_uuid()),
    commercial_breakdown = coalesce(commercial_breakdown, '{}'::jsonb);

alter table public.order_payments
  alter column policy_version set default 'commercial-2026-07-31-v1',
  alter column policy_version set not null,
  alter column pricing_version set default 1,
  alter column pricing_version set not null,
  alter column correlation_id set default gen_random_uuid(),
  alter column correlation_id set not null,
  alter column commercial_breakdown set default '{}'::jsonb,
  alter column commercial_breakdown set not null;

create table if not exists public.commercial_pricing_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_token uuid not null unique default gen_random_uuid(),
  idempotency_key text not null unique,
  request_hash text not null,
  customer_id uuid references auth.users(id) on delete set null,
  order_id text,
  quote_id uuid,
  purpose text not null,
  policy_version text not null default 'commercial-2026-07-31-v1',
  pricing_version integer not null default 1 check (pricing_version > 0),
  currency currency not null,
  subtotal_amount integer not null check (subtotal_amount >= 0),
  platform_fee_amount integer not null default 0 check (platform_fee_amount >= 0),
  tax_amount integer not null default 0 check (tax_amount >= 0),
  shipping_amount integer not null default 0 check (shipping_amount >= 0),
  total_amount integer not null check (total_amount >= 0),
  tax_jurisdiction text,
  tax_source text not null default 'UNRESOLVED',
  tax_fallback boolean not null default false,
  breakdown jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  correlation_id uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (total_amount = subtotal_amount + platform_fee_amount + tax_amount + shipping_amount),
  check (not tax_fallback)
);

create index if not exists commercial_pricing_reservations_customer_created_idx
  on public.commercial_pricing_reservations (customer_id, created_at desc);
create index if not exists commercial_pricing_reservations_order_created_idx
  on public.commercial_pricing_reservations (order_id, created_at desc);
create index if not exists commercial_pricing_reservations_expiry_idx
  on public.commercial_pricing_reservations (status, expires_at);

alter table public.order_payments
  add column if not exists pricing_reservation_id uuid references public.commercial_pricing_reservations(id) on delete set null;

create index if not exists order_payments_pricing_reservation_idx
  on public.order_payments (pricing_reservation_id);

create table if not exists public.commercial_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_hash text not null,
  transaction_kind text not null check (transaction_kind in ('CAPTURE', 'REFUND', 'REVERSAL', 'ADJUSTMENT', 'OPENING_BALANCE')),
  purpose text not null,
  order_id text,
  payment_id uuid references public.order_payments(id) on delete set null,
  reversal_of_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  policy_version text not null,
  pricing_version integer not null default 1 check (pricing_version > 0),
  correlation_id uuid not null,
  actor_id uuid,
  actor_role text not null default 'SYSTEM' check (actor_role in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM')),
  original_currency currency not null,
  original_amount integer not null check (original_amount > 0),
  settlement_currency currency not null,
  settlement_amount integer not null check (settlement_amount > 0),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  provider_fee_amount integer not null default 0 check (provider_fee_amount >= 0),
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.commercial_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.commercial_ledger_transactions(id) on delete restrict,
  order_id text,
  account_code text not null check (account_code in (
    'CUSTOMER_RECEIVABLE',
    'PROVIDER_CLEARING',
    'PROVIDER_FEE_EXPENSE',
    'TAILOR_ENTITLEMENT',
    'TAILOR_ELIGIBLE',
    'TAILOR_RELEASED',
    'CONSULTATION_ENTITLEMENT',
    'MATERIAL_ADVANCE_LIABILITY',
    'FULFILLMENT_LIABILITY',
    'TAX_LIABILITY',
    'TIP_LIABILITY',
    'DRAPEON_SUBSIDY_EXPENSE',
    'DRAPEON_REVENUE'
  )),
  account_scope text not null,
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  amount integer not null check (amount > 0),
  currency currency not null,
  created_at timestamptz not null default now()
);

create index if not exists commercial_ledger_transactions_order_created_idx
  on public.commercial_ledger_transactions (order_id, created_at desc);
create index if not exists commercial_ledger_transactions_payment_idx
  on public.commercial_ledger_transactions (payment_id, created_at desc);
create index if not exists commercial_ledger_entries_account_idx
  on public.commercial_ledger_entries (account_code, account_scope, currency, created_at desc);
create index if not exists commercial_ledger_entries_order_idx
  on public.commercial_ledger_entries (order_id, created_at desc);

create or replace function public.prevent_commercial_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Commercial ledger rows are immutable. Post a reversing transaction instead.';
end;
$$;

drop trigger if exists commercial_ledger_transactions_immutable on public.commercial_ledger_transactions;
create trigger commercial_ledger_transactions_immutable
  before update or delete on public.commercial_ledger_transactions
  for each row execute function public.prevent_commercial_ledger_mutation();

drop trigger if exists commercial_ledger_entries_immutable on public.commercial_ledger_entries;
create trigger commercial_ledger_entries_immutable
  before update or delete on public.commercial_ledger_entries
  for each row execute function public.prevent_commercial_ledger_mutation();

create or replace function public.assert_commercial_ledger_transaction_balanced()
returns trigger
language plpgsql
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, new.id);
  v_entry_count integer;
  v_unbalanced_count integer;
begin
  select count(*) into v_entry_count
  from public.commercial_ledger_entries
  where transaction_id = v_transaction_id;

  select count(*) into v_unbalanced_count
  from (
    select currency
    from public.commercial_ledger_entries
    where transaction_id = v_transaction_id
    group by currency
    having sum(case when direction = 'DEBIT' then amount else -amount end) <> 0
  ) unbalanced;

  if v_entry_count < 2 or v_unbalanced_count > 0 then
    raise exception 'Commercial ledger transaction % is not balanced.', v_transaction_id;
  end if;

  return null;
end;
$$;

drop trigger if exists commercial_ledger_entries_balance_guard on public.commercial_ledger_entries;
create constraint trigger commercial_ledger_entries_balance_guard
  after insert on public.commercial_ledger_entries
  deferrable initially deferred
  for each row execute function public.assert_commercial_ledger_transaction_balanced();

create or replace function public.prevent_pricing_snapshot_mutation()
returns trigger
language plpgsql
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
    or new.correlation_id is distinct from old.correlation_id
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'Commercial pricing snapshots are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_pricing_snapshot_immutable on public.commercial_pricing_reservations;
create trigger commercial_pricing_snapshot_immutable
  before update on public.commercial_pricing_reservations
  for each row execute function public.prevent_pricing_snapshot_mutation();

create or replace function public.create_commercial_pricing_reservation(
  p_idempotency_key text,
  p_customer_id uuid,
  p_order_id text,
  p_quote_id uuid,
  p_purpose text,
  p_currency currency,
  p_subtotal_amount integer,
  p_platform_fee_amount integer,
  p_tax_amount integer,
  p_shipping_amount integer,
  p_total_amount integer,
  p_tax_jurisdiction text,
  p_tax_source text,
  p_tax_fallback boolean,
  p_breakdown jsonb default '{}'::jsonb,
  p_correlation_id uuid default gen_random_uuid(),
  p_expires_at timestamptz default now() + interval '15 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request_hash text;
  v_row public.commercial_pricing_reservations%rowtype;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception 'Pricing reservation idempotency key is required.';
  end if;
  if p_subtotal_amount < 0 or p_platform_fee_amount < 0 or p_tax_amount < 0 or p_shipping_amount < 0 then
    raise exception 'Pricing amounts must be non-negative minor units.';
  end if;
  if p_total_amount <> p_subtotal_amount + p_platform_fee_amount + p_tax_amount + p_shipping_amount then
    raise exception 'Pricing total does not equal its locked components.';
  end if;
  if coalesce(p_tax_fallback, false) then
    raise exception 'A fallback tax result cannot be reserved for checkout.';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 minutes' then
    raise exception 'Pricing reservation expiry must be within 30 minutes.';
  end if;

  v_request_hash := encode(digest(concat_ws('|',
    p_customer_id::text, coalesce(p_order_id, ''), coalesce(p_quote_id::text, ''), p_purpose,
    p_currency::text, p_subtotal_amount::text, p_platform_fee_amount::text,
    p_tax_amount::text, p_shipping_amount::text, p_total_amount::text,
    coalesce(p_tax_jurisdiction, ''), p_tax_source, p_tax_fallback::text,
    coalesce(p_breakdown, '{}'::jsonb)::text
  ), 'sha256'), 'hex');

  insert into public.commercial_pricing_reservations (
    idempotency_key, request_hash, customer_id, order_id, quote_id, purpose, currency,
    subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount,
    tax_jurisdiction, tax_source, tax_fallback, breakdown, correlation_id, expires_at
  ) values (
    p_idempotency_key, v_request_hash, p_customer_id, p_order_id, p_quote_id, p_purpose, p_currency,
    p_subtotal_amount, p_platform_fee_amount, p_tax_amount, p_shipping_amount, p_total_amount,
    p_tax_jurisdiction, p_tax_source, coalesce(p_tax_fallback, false), coalesce(p_breakdown, '{}'::jsonb),
    p_correlation_id, p_expires_at
  )
  on conflict (idempotency_key) do nothing;

  select * into v_row
  from public.commercial_pricing_reservations
  where idempotency_key = p_idempotency_key;

  if v_row.request_hash <> v_request_hash then
    raise exception 'Pricing idempotency key was reused with different values.';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'reservationToken', v_row.reservation_token,
    'expiresAt', v_row.expires_at,
    'correlationId', v_row.correlation_id,
    'pricingVersion', v_row.pricing_version,
    'policyVersion', v_row.policy_version
  );
end;
$$;

create or replace function public.consume_commercial_pricing_reservation(
  p_reservation_token uuid,
  p_customer_id uuid,
  p_order_id text
)
returns public.commercial_pricing_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.commercial_pricing_reservations%rowtype;
begin
  select * into v_row
  from public.commercial_pricing_reservations
  where reservation_token = p_reservation_token
  for update;

  if v_row.id is null then raise exception 'Pricing reservation was not found.'; end if;
  if v_row.customer_id is distinct from p_customer_id then raise exception 'Pricing reservation owner mismatch.'; end if;
  if v_row.status = 'CONSUMED' and v_row.order_id = p_order_id then return v_row; end if;
  if v_row.status <> 'ACTIVE' then raise exception 'Pricing reservation is not active.'; end if;
  if v_row.expires_at <= now() then raise exception 'Pricing reservation expired.'; end if;

  update public.commercial_pricing_reservations
  set status = 'CONSUMED', order_id = coalesce(order_id, p_order_id), consumed_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.post_commercial_ledger_transaction(
  p_idempotency_key text,
  p_transaction_kind text,
  p_purpose text,
  p_order_id text,
  p_payment_id uuid,
  p_policy_version text,
  p_pricing_version integer,
  p_correlation_id uuid,
  p_provider_reference text,
  p_entries jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_reversal_of_transaction_id uuid default null,
  p_actor_id uuid default null,
  p_actor_role text default 'SYSTEM',
  p_original_currency currency default null,
  p_original_amount integer default null,
  p_settlement_currency currency default null,
  p_settlement_amount integer default null,
  p_fx_rate numeric default 1,
  p_provider_fee_amount integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request_hash text;
  v_transaction_id uuid;
  v_existing_hash text;
  v_entry jsonb;
  v_debits bigint;
  v_credits bigint;
  v_original_currency currency;
  v_original_amount integer;
  v_settlement_currency currency;
  v_settlement_amount integer;
begin
  if nullif(trim(p_idempotency_key), '') is null then raise exception 'Ledger idempotency key is required.'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception 'Ledger transaction requires at least two entries.';
  end if;

  select coalesce(sum((entry->>'amount')::bigint) filter (where entry->>'direction' = 'DEBIT'), 0),
         coalesce(sum((entry->>'amount')::bigint) filter (where entry->>'direction' = 'CREDIT'), 0)
    into v_debits, v_credits
  from jsonb_array_elements(p_entries) entry;

  if v_debits <= 0 or v_debits <> v_credits then
    raise exception 'Ledger transaction is unbalanced: % debit, % credit.', v_debits, v_credits;
  end if;
  if p_actor_role not in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM') then raise exception 'Invalid ledger actor role.'; end if;
  if coalesce(p_fx_rate, 0) <= 0 then raise exception 'Ledger FX rate must be positive.'; end if;
  if coalesce(p_provider_fee_amount, 0) < 0 then raise exception 'Provider fee amount cannot be negative.'; end if;

  v_original_currency := coalesce(p_original_currency, (p_entries->0->>'currency')::currency);
  v_original_amount := coalesce(p_original_amount, v_debits::integer);
  v_settlement_currency := coalesce(p_settlement_currency, v_original_currency);
  v_settlement_amount := coalesce(p_settlement_amount, v_original_amount);
  if v_original_amount <= 0 or v_settlement_amount <= 0 then
    raise exception 'Ledger original and settlement amounts must be positive.';
  end if;

  v_request_hash := encode(digest(concat_ws('|', p_transaction_kind, p_purpose,
    coalesce(p_order_id, ''), coalesce(p_payment_id::text, ''), p_policy_version,
    p_pricing_version::text, coalesce(p_provider_reference, ''), p_entries::text,
    coalesce(p_metadata, '{}'::jsonb)::text, coalesce(p_reversal_of_transaction_id::text, ''),
    coalesce(p_actor_id::text, ''), p_actor_role, v_original_currency::text,
    v_original_amount::text, v_settlement_currency::text, v_settlement_amount::text,
    p_fx_rate::text, coalesce(p_provider_fee_amount, 0)::text
  ), 'sha256'), 'hex');

  insert into public.commercial_ledger_transactions (
    idempotency_key, request_hash, transaction_kind, purpose, order_id, payment_id,
    reversal_of_transaction_id, policy_version, pricing_version, correlation_id,
    actor_id, actor_role, original_currency, original_amount, settlement_currency,
    settlement_amount, fx_rate, provider_fee_amount, provider_reference, metadata
  ) values (
    p_idempotency_key, v_request_hash, p_transaction_kind, p_purpose, p_order_id, p_payment_id,
    p_reversal_of_transaction_id, p_policy_version, p_pricing_version, p_correlation_id,
    p_actor_id, p_actor_role, v_original_currency, v_original_amount, v_settlement_currency,
    v_settlement_amount, p_fx_rate, coalesce(p_provider_fee_amount, 0), p_provider_reference,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id, request_hash into v_transaction_id, v_existing_hash
    from public.commercial_ledger_transactions
    where idempotency_key = p_idempotency_key;
    if v_existing_hash <> v_request_hash then
      raise exception 'Ledger idempotency key was reused with different values.';
    end if;
    return v_transaction_id;
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    if (v_entry->>'amount')::integer <= 0 then raise exception 'Ledger entry amount must be positive.'; end if;
    insert into public.commercial_ledger_entries (
      transaction_id, order_id, account_code, account_scope, direction, amount, currency
    ) values (
      v_transaction_id,
      p_order_id,
      v_entry->>'accountCode',
      coalesce(nullif(v_entry->>'accountScope', ''), 'default'),
      v_entry->>'direction',
      (v_entry->>'amount')::integer,
      (v_entry->>'currency')::currency
    );
  end loop;

  return v_transaction_id;
end;
$$;

alter table public.commercial_pricing_reservations enable row level security;
alter table public.commercial_ledger_transactions enable row level security;
alter table public.commercial_ledger_entries enable row level security;

revoke all on table public.commercial_pricing_reservations from anon, authenticated;
revoke all on table public.commercial_ledger_transactions from anon, authenticated;
revoke all on table public.commercial_ledger_entries from anon, authenticated;
revoke all on function public.create_commercial_pricing_reservation(text, uuid, text, uuid, text, currency, integer, integer, integer, integer, integer, text, text, boolean, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_commercial_pricing_reservation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.post_commercial_ledger_transaction(text, text, text, text, uuid, text, integer, uuid, text, jsonb, jsonb, uuid, uuid, text, currency, integer, currency, integer, numeric, integer) from public, anon, authenticated;

grant select, insert, update on table public.commercial_pricing_reservations to service_role;
grant select, insert on table public.commercial_ledger_transactions to service_role;
grant select, insert on table public.commercial_ledger_entries to service_role;
grant execute on function public.create_commercial_pricing_reservation(text, uuid, text, uuid, text, currency, integer, integer, integer, integer, integer, text, text, boolean, jsonb, uuid, timestamptz) to service_role;
grant execute on function public.consume_commercial_pricing_reservation(uuid, uuid, text) to service_role;
grant execute on function public.post_commercial_ledger_transaction(text, text, text, text, uuid, text, integer, uuid, text, jsonb, jsonb, uuid, uuid, text, currency, integer, currency, integer, numeric, integer) to service_role;

comment on table public.commercial_pricing_reservations is 'Immutable, short-lived pricing and tax snapshots. Status and consumption timestamps are the only mutable fields.';
comment on table public.commercial_ledger_transactions is 'Immutable commercial journal headers. Corrections require reversing transactions.';
comment on table public.commercial_ledger_entries is 'Balanced debit and credit entries in minor units, isolated per currency.';
