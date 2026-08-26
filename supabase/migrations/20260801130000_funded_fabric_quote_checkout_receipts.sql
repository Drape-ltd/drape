-- Tailor-sourced fabric funding, section 2.
-- Fresh funded-policy orders receive immutable split quotes, accepted
-- allocations, split pricing reservations, funded balances, and receipts.

create or replace function public.create_funded_order_quote_snapshot(
  p_order_id text,
  p_tailor_id uuid,
  p_expected_quote_id uuid,
  p_expected_quote_version integer,
  p_revision_request_id uuid,
  p_change_kind text,
  p_currency text,
  p_subtotal_amount integer,
  p_tax_amount integer,
  p_platform_fee_amount integer,
  p_delivery_fee_amount integer,
  p_total_amount integer,
  p_completion_date timestamptz,
  p_breakdown text,
  p_assumptions text,
  p_expires_at timestamptz,
  p_fabric_funding_policy_version text,
  p_fabric_source_snapshot text,
  p_tailoring_amount integer,
  p_fabric_allowance_amount integer,
  p_fabric_allowance_coverage jsonb,
  p_fabric_sourcing_assumptions text,
  p_pricing_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_current_quote public.order_quotes%rowtype;
  v_quote public.order_quotes%rowtype;
  v_revision public.quote_revision_requests%rowtype;
  v_version integer;
  v_event_id uuid;
  v_event_type text;
begin
  select * into v_order from public.orders
  where id::text = p_order_id and tailor_id::text = p_tailor_id::text for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if coalesce(v_order.order_kind::text, 'CUSTOM') <> 'CUSTOM' then raise exception 'QUOTE_NEGOTIATION_CUSTOM_ONLY'; end if;
  if v_order.stage::text not in ('PENDING_QUOTE','CONSULTATION','QUOTE_SENT') then raise exception 'PAID_ORDER_CANNOT_BE_REQUOTED'; end if;
  if v_order.fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
    or p_fabric_funding_policy_version <> v_order.fabric_funding_policy_version then
    raise exception 'FABRIC_FUNDING_POLICY_MISMATCH';
  end if;
  if p_fabric_source_snapshot <> v_order.fabric_source::text then raise exception 'FABRIC_SOURCE_CHANGED'; end if;
  if p_tailoring_amount < 0 or p_fabric_allowance_amount < 0
    or p_tailoring_amount + p_fabric_allowance_amount <> p_subtotal_amount then
    raise exception 'FABRIC_ALLOCATION_TOTAL_MISMATCH';
  end if;
  if p_fabric_source_snapshot = 'CUSTOMER_SUPPLIES' and
    (p_fabric_allowance_amount <> 0 or coalesce(p_fabric_allowance_coverage, '[]'::jsonb) <> '[]'::jsonb) then
    raise exception 'CUSTOMER_SUPPLIED_FABRIC_ALLOWANCE_NOT_ZERO';
  end if;
  if p_fabric_source_snapshot = 'TAILOR_SOURCES' and
    (p_fabric_allowance_amount <= 0 or jsonb_typeof(p_fabric_allowance_coverage) <> 'array'
      or jsonb_array_length(p_fabric_allowance_coverage) = 0
      or char_length(btrim(coalesce(p_fabric_sourcing_assumptions,''))) < 8) then
    raise exception 'TAILOR_SOURCED_FABRIC_ALLOCATION_REQUIRED';
  end if;
  if p_change_kind not in ('INITIAL','CUSTOMER_REVISION','TAILOR_CORRECTION','UNCHANGED_RENEWAL') then
    raise exception 'INVALID_QUOTE_CHANGE_KIND';
  end if;

  select * into v_current_quote from public.order_quotes
  where order_id::text = p_order_id and status = 'ACTIVE' for update;
  if v_current_quote.id is null then
    if p_expected_quote_id is not null or p_expected_quote_version is not null
      or v_order.stage::text not in ('PENDING_QUOTE','CONSULTATION') then raise exception 'QUOTE_VERSION_CHANGED'; end if;
  elsif v_current_quote.id is distinct from p_expected_quote_id
    or v_current_quote.version is distinct from p_expected_quote_version
    or v_order.active_quote_id is distinct from v_current_quote.id
    or v_order.active_quote_version is distinct from v_current_quote.version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  if p_change_kind = 'CUSTOMER_REVISION' then
    select * into v_revision from public.quote_revision_requests
    where id = p_revision_request_id and order_id::text = p_order_id
      and source_quote_id = v_current_quote.id and source_quote_version = v_current_quote.version
      and status = 'OPEN' for update;
    if v_revision.id is null then raise exception 'QUOTE_REVISION_NOT_OPEN'; end if;
  elsif p_revision_request_id is not null then
    raise exception 'REVISION_REQUEST_NOT_ALLOWED_FOR_CHANGE_KIND';
  end if;

  select coalesce(max(version),0) + 1 into v_version from public.order_quotes where order_id::text = p_order_id;
  if v_current_quote.id is not null then update public.order_quotes set status = 'SUPERSEDED' where id = v_current_quote.id; end if;

  insert into public.order_quotes (
    order_id, version, change_kind, currency, subtotal_amount, tax_amount,
    platform_fee_amount, delivery_fee_amount, total_amount, completion_date,
    breakdown, assumptions, expires_at, created_by, created_by_role,
    fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount,
    fabric_allowance_amount, fabric_allowance_currency, fabric_allowance_coverage,
    fabric_sourcing_assumptions, pricing_version
  ) values (
    v_order.id, v_version, p_change_kind, upper(btrim(p_currency)), p_subtotal_amount,
    p_tax_amount, p_platform_fee_amount, p_delivery_fee_amount, p_total_amount,
    p_completion_date, nullif(btrim(coalesce(p_breakdown,'')),''),
    nullif(btrim(coalesce(p_assumptions,'')),''), p_expires_at, p_tailor_id, 'TAILOR',
    p_fabric_funding_policy_version, p_fabric_source_snapshot, p_tailoring_amount,
    p_fabric_allowance_amount, upper(btrim(p_currency))::currency,
    coalesce(p_fabric_allowance_coverage,'[]'::jsonb),
    nullif(btrim(coalesce(p_fabric_sourcing_assumptions,'')),''), p_pricing_version
  ) returning * into v_quote;

  update public.orders set
    stage = 'QUOTE_SENT', quoted_amount = p_total_amount, fulfillment_fee = p_delivery_fee_amount,
    currency = upper(btrim(p_currency))::currency, quoted_currency = upper(btrim(p_currency)),
    source_currency = upper(btrim(p_currency))::currency, source_amount = p_subtotal_amount,
    fx_rate = 1, fx_rate_timestamp = now(), subtotal_amount = p_subtotal_amount,
    platform_fee_amount = p_platform_fee_amount, tax_amount = p_tax_amount,
    shipping_amount = p_delivery_fee_amount, total_amount = p_total_amount,
    quoted_completion_date = p_completion_date,
    quote_note = nullif(btrim(coalesce(p_assumptions,'')),''), quote_expires_at = p_expires_at,
    active_quote_id = v_quote.id, active_quote_version = v_quote.version,
    stage_updated_at = now(), updated_at = now()
  where id::text = p_order_id;

  if v_revision.id is not null then
    update public.quote_revision_requests set status = 'REVISED', responded_by = p_tailor_id,
      response_note = nullif(btrim(coalesce(p_assumptions,'')),''), responded_at = now()
    where id = v_revision.id;
  end if;
  v_event_type := case when p_change_kind = 'INITIAL' then 'QUOTE_SENT'
    when p_change_kind = 'UNCHANGED_RENEWAL' then 'QUOTE_RENEWED' else 'QUOTE_REVISED' end;
  v_event_id := public.record_order_event(
    p_order_id, v_event_type, p_tailor_id, 'TAILOR',
    case when v_version = 1 then 'Quote sent' else 'Revised quote sent' end,
    lower(v_event_type) || ':' || v_quote.id::text,
    nullif(btrim(coalesce(p_assumptions,'')),''), v_quote.id, v_quote.version, v_revision.id,
    jsonb_build_object('currency',v_quote.currency,'totalAmount',v_quote.total_amount,
      'tailoringAmount',v_quote.tailoring_amount,'fabricAllowanceAmount',v_quote.fabric_allowance_amount,
      'fabricAllowanceCoverage',v_quote.fabric_allowance_coverage,'completionDate',v_quote.completion_date,
      'changeKind',v_quote.change_kind,'fabricFundingPolicyVersion',v_quote.fabric_funding_policy_version)
  );
  return jsonb_build_object('quoteId',v_quote.id,'quoteVersion',v_quote.version,
    'revisionRequestId',v_revision.id,'eventId',v_event_id,'status',v_quote.status);
end;
$$;

revoke all on function public.create_funded_order_quote_snapshot(text,uuid,uuid,integer,uuid,text,text,integer,integer,integer,integer,integer,timestamptz,text,text,timestamptz,text,text,integer,integer,jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.create_funded_order_quote_snapshot(text,uuid,uuid,integer,uuid,text,text,integer,integer,integer,integer,integer,timestamptz,text,text,timestamptz,text,text,integer,integer,jsonb,text,integer) to service_role;

create or replace function public.lock_fabric_allocation_on_quote_acceptance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype;
begin
  if new.status <> 'ACCEPTED' or old.status = 'ACCEPTED'
    or new.fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1' then return new; end if;
  select * into v_order from public.orders where id = new.order_id;
  if v_order.fabric_funding_policy_version <> new.fabric_funding_policy_version then raise exception 'FABRIC_FUNDING_POLICY_MISMATCH'; end if;
  insert into public.order_fabric_funding_allocations (
    order_id, quote_id, quote_version, customer_id, tailor_id, fabric_source, currency,
    seller_subtotal_amount, tailoring_amount, base_allowance_amount, coverage,
    sourcing_assumptions, policy_version, pricing_version
  ) values (
    new.order_id, new.id, new.version, v_order.customer_id, v_order.tailor_id,
    new.fabric_source_snapshot, new.currency::currency, new.subtotal_amount,
    new.tailoring_amount, new.fabric_allowance_amount, new.fabric_allowance_coverage,
    new.fabric_sourcing_assumptions, new.fabric_funding_policy_version, new.pricing_version
  ) on conflict (order_id) do nothing;
  if not exists (select 1 from public.order_fabric_funding_allocations where order_id = new.order_id and quote_id = new.id) then
    raise exception 'ACCEPTED_FABRIC_ALLOCATION_CONFLICT';
  end if;
  return new;
end;
$$;
drop trigger if exists lock_fabric_allocation_on_quote_acceptance on public.order_quotes;
create trigger lock_fabric_allocation_on_quote_acceptance after update of status on public.order_quotes
for each row execute function public.lock_fabric_allocation_on_quote_acceptance();

create or replace function public.create_funded_commercial_pricing_reservation(
  p_idempotency_key text, p_customer_id uuid, p_order_id text, p_quote_id uuid,
  p_purpose text, p_currency currency, p_subtotal_amount integer,
  p_platform_fee_amount integer, p_tax_amount integer, p_shipping_amount integer,
  p_total_amount integer, p_tax_jurisdiction text, p_tax_source text,
  p_tax_fallback boolean, p_breakdown jsonb, p_correlation_id uuid,
  p_fabric_funding_policy_version text, p_fabric_source_snapshot text,
  p_tailoring_amount integer, p_fabric_allowance_amount integer,
  p_fabric_allowance_coverage jsonb, p_fabric_sourcing_assumptions text,
  p_expires_at timestamptz default now() + interval '15 minutes'
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_request_hash text; v_row public.commercial_pricing_reservations%rowtype; v_quote public.order_quotes%rowtype;
begin
  select * into v_quote from public.order_quotes where id = p_quote_id and order_id::text = p_order_id and status = 'ACCEPTED';
  if v_quote.id is null then raise exception 'ACCEPTED_FUNDED_QUOTE_REQUIRED'; end if;
  if p_fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
    or v_quote.fabric_funding_policy_version <> p_fabric_funding_policy_version
    or v_quote.fabric_source_snapshot <> p_fabric_source_snapshot
    or v_quote.tailoring_amount <> p_tailoring_amount
    or v_quote.fabric_allowance_amount <> p_fabric_allowance_amount
    or v_quote.fabric_allowance_coverage is distinct from p_fabric_allowance_coverage
    or v_quote.fabric_sourcing_assumptions is distinct from p_fabric_sourcing_assumptions then
    raise exception 'FUNDED_PRICING_QUOTE_MISMATCH';
  end if;
  if p_total_amount <> p_subtotal_amount + p_platform_fee_amount + p_tax_amount + p_shipping_amount then raise exception 'Pricing total does not equal its locked components.'; end if;
  if coalesce(p_tax_fallback,false) then raise exception 'A fallback tax result cannot be reserved for checkout.'; end if;
  v_request_hash := encode(digest(concat_ws('|',p_customer_id::text,p_order_id,p_quote_id::text,p_purpose,
    p_currency::text,p_subtotal_amount,p_platform_fee_amount,p_tax_amount,p_shipping_amount,p_total_amount,
    coalesce(p_tax_jurisdiction,''),p_tax_source,p_tax_fallback::text,coalesce(p_breakdown,'{}'::jsonb)::text,
    p_fabric_funding_policy_version,p_fabric_source_snapshot,p_tailoring_amount,p_fabric_allowance_amount,
    p_fabric_allowance_coverage::text,p_fabric_sourcing_assumptions), 'sha256'),'hex');
  insert into public.commercial_pricing_reservations (
    idempotency_key,request_hash,customer_id,order_id,quote_id,purpose,currency,
    subtotal_amount,platform_fee_amount,tax_amount,shipping_amount,total_amount,
    tax_jurisdiction,tax_source,tax_fallback,breakdown,correlation_id,expires_at,
    fabric_funding_policy_version,fabric_source_snapshot,tailoring_amount,
    fabric_allowance_amount,fabric_allowance_coverage,fabric_sourcing_assumptions
  ) values (
    p_idempotency_key,v_request_hash,p_customer_id,p_order_id,p_quote_id,p_purpose,p_currency,
    p_subtotal_amount,p_platform_fee_amount,p_tax_amount,p_shipping_amount,p_total_amount,
    p_tax_jurisdiction,p_tax_source,false,coalesce(p_breakdown,'{}'::jsonb),p_correlation_id,p_expires_at,
    p_fabric_funding_policy_version,p_fabric_source_snapshot,p_tailoring_amount,
    p_fabric_allowance_amount,p_fabric_allowance_coverage,p_fabric_sourcing_assumptions
  ) on conflict (idempotency_key) do nothing;
  select * into v_row from public.commercial_pricing_reservations where idempotency_key = p_idempotency_key;
  if v_row.request_hash <> v_request_hash then raise exception 'Pricing idempotency key was reused with different values.'; end if;
  return jsonb_build_object('id',v_row.id,'reservationToken',v_row.reservation_token,'expiresAt',v_row.expires_at,
    'correlationId',v_row.correlation_id,'pricingVersion',v_row.pricing_version,'policyVersion',v_row.policy_version);
end;
$$;
revoke all on function public.create_funded_commercial_pricing_reservation(text,uuid,text,uuid,text,currency,integer,integer,integer,integer,integer,text,text,boolean,jsonb,uuid,text,text,integer,integer,jsonb,text,timestamptz) from public, anon, authenticated;
grant execute on function public.create_funded_commercial_pricing_reservation(text,uuid,text,uuid,text,currency,integer,integer,integer,integer,integer,text,text,boolean,jsonb,uuid,text,text,integer,integer,jsonb,text,timestamptz) to service_role;

create or replace function public.fund_order_fabric_allocation_for_payment(p_payment_id uuid)
returns public.order_fabric_funding_allocations language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payment public.order_payments%rowtype; v_allocation public.order_fabric_funding_allocations%rowtype; v_liability integer;
begin
  select * into v_payment from public.order_payments where id = p_payment_id and phase::text = 'INITIAL_ORDER' and status::text in ('SUCCEEDED','PARTIAL_REFUND','REFUNDED');
  if v_payment.id is null or v_payment.ledger_recorded_at is null then raise exception 'PROVIDER_CONFIRMED_LEDGER_PAYMENT_REQUIRED'; end if;
  select * into v_allocation from public.order_fabric_funding_allocations where order_id = v_payment.order_id::text for update;
  if v_allocation.id is null then raise exception 'FABRIC_FUNDING_ALLOCATION_NOT_FOUND'; end if;
  select coalesce(sum(case when e.direction='CREDIT' then e.amount else -e.amount end),0)::integer into v_liability
  from public.commercial_ledger_entries e join public.commercial_ledger_transactions t on t.id=e.transaction_id
  where t.payment_id=v_payment.id and t.transaction_kind='CAPTURE' and e.account_code='MATERIAL_ADVANCE_LIABILITY';
  if v_liability <> v_allocation.base_allowance_amount then raise exception 'FABRIC_LIABILITY_LEDGER_MISMATCH'; end if;
  update public.order_fabric_funding_allocations set funded_amount=base_allowance_amount,
    funded_at=coalesce(funded_at,v_payment.confirmed_at,now()), status=case when base_allowance_amount=0 then 'RECONCILED' else 'FUNDED' end
  where id=v_allocation.id returning * into v_allocation;
  return v_allocation;
end;
$$;
revoke all on function public.fund_order_fabric_allocation_for_payment(uuid) from public, anon, authenticated;
grant execute on function public.fund_order_fabric_allocation_for_payment(uuid) to service_role;

alter table public.commercial_receipts
  add column if not exists fabric_funding_policy_version text,
  add column if not exists fabric_source_snapshot text,
  add column if not exists tailoring_amount integer,
  add column if not exists fabric_allowance_amount integer,
  add column if not exists fabric_allowance_coverage jsonb,
  add column if not exists fabric_sourcing_assumptions text;

create or replace function public.issue_initial_order_receipt(p_payment_id uuid)
returns public.commercial_receipts language plpgsql security definer set search_path = public as $$
declare v_payment public.order_payments%rowtype; v_reservation public.commercial_pricing_reservations%rowtype;
  v_order public.orders%rowtype; v_ledger public.commercial_ledger_transactions%rowtype;
  v_receipt public.commercial_receipts%rowtype; v_receipt_number text; v_consultation_credit integer:=0; v_promotion integer:=0;
begin
  select * into v_receipt from public.commercial_receipts where payment_id=p_payment_id;
  if v_receipt.id is not null then return v_receipt; end if;
  select * into v_payment from public.order_payments where id=p_payment_id for update;
  if v_payment.id is null or v_payment.phase::text <> 'INITIAL_ORDER' or v_payment.status::text not in ('SUCCEEDED','PARTIAL_REFUND','REFUNDED') then raise exception 'Only a captured initial-order payment can issue a receipt.'; end if;
  if v_payment.pricing_reservation_id is null or v_payment.ledger_recorded_at is null then raise exception 'The captured payment is missing its pricing reservation or ledger outcome.'; end if;
  select * into v_reservation from public.commercial_pricing_reservations where id=v_payment.pricing_reservation_id;
  if v_reservation.id is null or v_reservation.status <> 'CONSUMED' or v_reservation.total_amount <> v_payment.amount or v_reservation.currency <> v_payment.currency then raise exception 'The captured payment does not match its consumed pricing reservation.'; end if;
  select * into v_order from public.orders where id::text=v_payment.order_id::text;
  select * into v_ledger from public.commercial_ledger_transactions where payment_id=v_payment.id and transaction_kind='CAPTURE';
  if v_order.id is null or v_ledger.id is null then raise exception 'Receipt authority records are missing.'; end if;
  v_consultation_credit:=greatest(coalesce((v_reservation.breakdown->>'consultationCreditAmount')::integer,0),0);
  v_promotion:=greatest(coalesce((v_reservation.breakdown->>'promotionAmount')::integer,0),0);
  v_receipt_number:='DRP-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.commercial_receipt_number_seq')::text,8,'0');
  insert into public.commercial_receipts (
    receipt_number,order_id,order_reference,payment_id,pricing_reservation_id,ledger_transaction_id,
    quote_id,customer_id,tailor_id,purpose,provider,provider_reference,currency,subtotal_amount,
    consultation_credit_amount,promotion_amount,platform_fee_amount,tax_amount,shipping_amount,total_amount,
    tax_jurisdiction,tax_source,protected_tailor_amount,policy_version,pricing_version,correlation_id,paid_at,
    fabric_funding_policy_version,fabric_source_snapshot,tailoring_amount,fabric_allowance_amount,
    fabric_allowance_coverage,fabric_sourcing_assumptions
  ) values (
    v_receipt_number,v_order.id::text,coalesce(nullif(v_order.reference,''),v_order.id::text),v_payment.id,v_reservation.id,v_ledger.id,
    v_reservation.quote_id,v_order.customer_id,v_order.tailor_id,'INITIAL_ORDER',v_payment.provider,v_payment.provider_payment_id,
    v_reservation.currency,v_reservation.subtotal_amount,v_consultation_credit,v_promotion,v_reservation.platform_fee_amount,
    v_reservation.tax_amount,v_reservation.shipping_amount,v_reservation.total_amount,v_reservation.tax_jurisdiction,
    v_reservation.tax_source,coalesce(v_reservation.tailoring_amount,v_reservation.subtotal_amount),v_payment.policy_version,
    v_payment.pricing_version,v_payment.correlation_id,coalesce(v_payment.confirmed_at,now()),v_reservation.fabric_funding_policy_version,
    v_reservation.fabric_source_snapshot,v_reservation.tailoring_amount,v_reservation.fabric_allowance_amount,
    v_reservation.fabric_allowance_coverage,v_reservation.fabric_sourcing_assumptions
  ) on conflict(payment_id) do nothing;
  select * into v_receipt from public.commercial_receipts where payment_id=p_payment_id;
  return v_receipt;
end;
$$;

comment on function public.create_funded_order_quote_snapshot is 'Creates immutable split quotes for fresh funded-fabric custom orders only.';
comment on function public.fund_order_fabric_allocation_for_payment is 'Marks the accepted fabric allowance funded only after provider confirmation and a matching ledger liability.';
