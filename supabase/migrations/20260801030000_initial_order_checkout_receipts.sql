-- Implementation 6: immutable initial-order checkout receipts.
-- A receipt is issued only after a provider-confirmed capture has a consumed
-- pricing reservation and balanced commercial ledger transaction.

create sequence if not exists public.commercial_receipt_number_seq;

create table if not exists public.commercial_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  receipt_version integer not null default 1 check (receipt_version = 1),
  order_id text not null references public.orders(id) on delete restrict,
  order_reference text not null,
  payment_id uuid not null unique references public.order_payments(id) on delete restrict,
  pricing_reservation_id uuid not null references public.commercial_pricing_reservations(id) on delete restrict,
  ledger_transaction_id uuid not null unique references public.commercial_ledger_transactions(id) on delete restrict,
  quote_id uuid null references public.order_quotes(id) on delete restrict,
  customer_id text not null,
  tailor_id text null,
  purpose text not null check (purpose = 'INITIAL_ORDER'),
  provider payment_provider not null,
  provider_reference text not null,
  currency currency not null,
  subtotal_amount integer not null check (subtotal_amount >= 0),
  consultation_credit_amount integer not null default 0 check (consultation_credit_amount >= 0),
  promotion_amount integer not null default 0 check (promotion_amount >= 0),
  platform_fee_amount integer not null default 0 check (platform_fee_amount >= 0),
  tax_amount integer not null default 0 check (tax_amount >= 0),
  shipping_amount integer not null default 0 check (shipping_amount >= 0),
  total_amount integer not null check (total_amount > 0),
  tax_jurisdiction text null,
  tax_source text not null,
  merchant_label text not null default 'Drapeon',
  protected_tailor_amount integer not null check (protected_tailor_amount >= 0),
  policy_version text not null,
  pricing_version integer not null check (pricing_version > 0),
  correlation_id uuid not null,
  paid_at timestamptz not null,
  issued_at timestamptz not null default now(),
  constraint commercial_receipt_exact_total check (
    total_amount = subtotal_amount + platform_fee_amount + tax_amount + shipping_amount
  ),
  constraint commercial_receipt_credit_bounds check (
    consultation_credit_amount + promotion_amount <= subtotal_amount
  )
);

create index if not exists commercial_receipts_customer_issued_idx
  on public.commercial_receipts (customer_id, issued_at desc);
create index if not exists commercial_receipts_order_issued_idx
  on public.commercial_receipts (order_id, issued_at desc);
create index if not exists commercial_receipts_tailor_issued_idx
  on public.commercial_receipts (tailor_id, issued_at desc);

create or replace function public.prevent_commercial_receipt_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Commercial receipts are immutable. Refunds and corrections require linked ledger entries.';
end;
$$;

drop trigger if exists commercial_receipt_immutable on public.commercial_receipts;
create trigger commercial_receipt_immutable
  before update or delete on public.commercial_receipts
  for each row execute function public.prevent_commercial_receipt_mutation();

create or replace function public.issue_initial_order_receipt(p_payment_id uuid)
returns public.commercial_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.order_payments%rowtype;
  v_reservation public.commercial_pricing_reservations%rowtype;
  v_order public.orders%rowtype;
  v_ledger public.commercial_ledger_transactions%rowtype;
  v_receipt public.commercial_receipts%rowtype;
  v_receipt_number text;
  v_consultation_credit integer := 0;
  v_promotion integer := 0;
begin
  select * into v_receipt
  from public.commercial_receipts
  where payment_id = p_payment_id;
  if v_receipt.id is not null then return v_receipt; end if;

  select * into v_payment
  from public.order_payments
  where id = p_payment_id
  for update;
  if v_payment.id is null then raise exception 'Payment was not found.'; end if;
  if v_payment.phase::text <> 'INITIAL_ORDER' or v_payment.status::text not in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED') then
    raise exception 'Only a captured initial-order payment can issue a receipt.';
  end if;
  if v_payment.pricing_reservation_id is null or v_payment.ledger_recorded_at is null then
    raise exception 'The captured payment is missing its pricing reservation or ledger outcome.';
  end if;

  select * into v_reservation
  from public.commercial_pricing_reservations
  where id = v_payment.pricing_reservation_id;
  if v_reservation.id is null or v_reservation.status <> 'CONSUMED' then
    raise exception 'The payment pricing reservation was not consumed.';
  end if;
  if v_reservation.total_amount <> v_payment.amount or v_reservation.currency <> v_payment.currency then
    raise exception 'The captured payment does not match its pricing reservation.';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id;
  if v_order.id is null then raise exception 'The receipt order was not found.'; end if;

  select * into v_ledger
  from public.commercial_ledger_transactions
  where payment_id = v_payment.id and transaction_kind = 'CAPTURE';
  if v_ledger.id is null then raise exception 'The captured payment ledger transaction was not found.'; end if;

  v_consultation_credit := greatest(coalesce((v_reservation.breakdown ->> 'consultationCreditAmount')::integer, 0), 0);
  v_promotion := greatest(coalesce((v_reservation.breakdown ->> 'promotionAmount')::integer, 0), 0);
  v_receipt_number := 'DRP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.commercial_receipt_number_seq')::text, 8, '0');

  insert into public.commercial_receipts (
    receipt_number, order_id, order_reference, payment_id, pricing_reservation_id,
    ledger_transaction_id, quote_id, customer_id, tailor_id, purpose, provider,
    provider_reference, currency, subtotal_amount, consultation_credit_amount,
    promotion_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount,
    tax_jurisdiction, tax_source, protected_tailor_amount, policy_version,
    pricing_version, correlation_id, paid_at
  ) values (
    v_receipt_number, v_order.id, coalesce(nullif(v_order.reference, ''), v_order.id),
    v_payment.id, v_reservation.id, v_ledger.id, v_reservation.quote_id,
    v_order.customer_id, v_order.tailor_id, 'INITIAL_ORDER', v_payment.provider,
    v_payment.provider_payment_id, v_reservation.currency, v_reservation.subtotal_amount,
    v_consultation_credit, v_promotion, v_reservation.platform_fee_amount,
    v_reservation.tax_amount, v_reservation.shipping_amount, v_reservation.total_amount,
    v_reservation.tax_jurisdiction, v_reservation.tax_source,
    v_reservation.subtotal_amount, v_payment.policy_version, v_payment.pricing_version,
    v_payment.correlation_id, coalesce(v_payment.confirmed_at, now())
  )
  on conflict (payment_id) do nothing;

  select * into v_receipt from public.commercial_receipts where payment_id = p_payment_id;
  return v_receipt;
end;
$$;

alter table public.commercial_receipts enable row level security;

revoke all on table public.commercial_receipts from anon, authenticated;
revoke all on sequence public.commercial_receipt_number_seq from anon, authenticated;
revoke all on function public.issue_initial_order_receipt(uuid) from public, anon, authenticated;

grant select on table public.commercial_receipts to authenticated;
grant select, insert on table public.commercial_receipts to service_role;
grant usage, select on sequence public.commercial_receipt_number_seq to service_role;
grant execute on function public.issue_initial_order_receipt(uuid) to service_role;

drop policy if exists "commercial receipts: order parties can view" on public.commercial_receipts;
create policy "commercial receipts: order parties can view"
  on public.commercial_receipts for select to authenticated
  using (customer_id = auth.uid()::text or tailor_id = auth.uid()::text);

comment on table public.commercial_receipts is 'Immutable capture-time customer receipts. Refunds and corrections remain separate ledger transactions.';
