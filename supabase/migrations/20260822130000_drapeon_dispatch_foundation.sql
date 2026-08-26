-- Drapeon Dispatch: authoritative funding, parcel, event, and recovery model.
-- Existing accepted prices and receipts remain immutable. This migration only
-- snapshots their fulfillment allocation into a separately reconciled lane.

create table if not exists public.order_fulfillment_runs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.orders(id_text) on delete restrict,
  policy_version text not null default 'drapeon-dispatch-2026-08-22-v1',
  method public.delivery_method not null,
  status text not null default 'QUOTE_REQUIRED' check (status in (
    'QUOTE_REQUIRED','AWAITING_CUSTOMER_DECISION','AWAITING_SHORTFALL_PAYMENT',
    'READY_TO_BOOK','BOOKED','IN_TRANSIT','DELIVERED','PICKUP_READY','PICKED_UP',
    'CANCELLED','EXCEPTION','RECONCILED'
  )),
  funding_status text not null default 'UNQUOTED' check (funding_status in (
    'UNQUOTED','WITHIN_ALLOWANCE','SHORTFALL_DUE','SHORTFALL_PAID',
    'REFUND_PENDING','READY_TO_RECONCILE','RECONCILED','EXCEPTION'
  )),
  currency public.currency not null,
  captured_allowance_amount integer not null check (captured_allowance_amount >= 0),
  customer_funded_allowance_amount integer not null check (customer_funded_allowance_amount >= 0),
  drapeon_subsidy_amount integer not null default 0 check (drapeon_subsidy_amount >= 0),
  actual_provider_cost_amount integer check (actual_provider_cost_amount is null or actual_provider_cost_amount >= 0),
  allowance_applied_amount integer not null default 0 check (allowance_applied_amount >= 0),
  shortfall_subtotal_amount integer not null default 0 check (shortfall_subtotal_amount >= 0),
  shortfall_tax_amount integer not null default 0 check (shortfall_tax_amount >= 0),
  shortfall_fee_amount integer not null default 0 check (shortfall_fee_amount >= 0),
  shortfall_total_amount integer not null default 0 check (shortfall_total_amount >= 0),
  unused_allowance_amount integer not null default 0 check (unused_allowance_amount >= 0),
  customer_refund_amount integer not null default 0 check (customer_refund_amount >= 0),
  captured_fulfillment_tax_amount integer not null default 0 check (captured_fulfillment_tax_amount >= 0),
  customer_refund_tax_amount integer not null default 0 check (customer_refund_tax_amount >= 0),
  customer_refund_status text not null default 'NOT_REQUIRED' check (customer_refund_status in (
    'NOT_REQUIRED','QUEUED','PROCESSING','PENDING','SUCCEEDED','FAILED'
  )),
  customer_refunded_at timestamptz,
  tax_attribution_status text not null default 'NOT_TAXED' check (tax_attribution_status in (
    'NOT_TAXED','ATTRIBUTED','AMBIGUOUS'
  )),
  subsidy_restored_amount integer not null default 0 check (subsidy_restored_amount >= 0),
  cancellation_fee_amount integer not null default 0 check (cancellation_fee_amount >= 0),
  provider_name text,
  provider_quote_reference text,
  provider_quote_evidence jsonb not null default '[]'::jsonb,
  provider_payment_id uuid references public.order_payments(id) on delete set null,
  commercial_adjustment_id uuid references public.commercial_adjustments(id) on delete set null,
  customer_decision text check (customer_decision is null or customer_decision in (
    'PAY_SHORTFALL','REQUEST_CHEAPER_OPTION','SWITCH_TO_PICKUP','DECLINE_DISPATCH'
  )),
  customer_decision_note text,
  customer_decided_at timestamptz,
  quote_recorded_at timestamptz,
  shortfall_paid_at timestamptz,
  booked_at timestamptz,
  custody_accepted_at timestamptz,
  delivered_at timestamptz,
  reconciled_at timestamptz,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_funded_allowance_amount + drapeon_subsidy_amount = captured_allowance_amount),
  check (shortfall_total_amount = shortfall_subtotal_amount + shortfall_tax_amount + shortfall_fee_amount),
  check (allowance_applied_amount <= captured_allowance_amount),
  check (unused_allowance_amount <= captured_allowance_amount),
  check (jsonb_typeof(provider_quote_evidence) = 'array')
);

create table if not exists public.order_fulfillment_parcels (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.order_fulfillment_runs(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  parcel_number integer not null default 1 check (parcel_number > 0),
  status text not null default 'PLANNED' check (status in (
    'PLANNED','BOOKED','CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT',
    'OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','DELIVERED','PICKUP_READY','PICKED_UP',
    'RETURNING','RETURNED','CANCELLED','EXCEPTION'
  )),
  provider_name text,
  service_level text,
  provider_reference text,
  tracking_number text,
  tracking_url text,
  contact_name text,
  contact_phone text,
  eta_at timestamptz,
  eta_timezone text,
  last_location jsonb,
  last_status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, parcel_number),
  unique (provider_name, provider_reference)
);

create table if not exists public.order_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.order_fulfillment_runs(id) on delete restrict,
  parcel_id uuid references public.order_fulfillment_parcels(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  event_type text not null check (event_type in (
    'QUOTE_RECORDED','CHEAPER_OPTION_REQUESTED','DISPATCH_OPTION_DECLINED','SHORTFALL_REQUESTED','SHORTFALL_PAID',
    'PICKUP_SELECTED','BOOKED','CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT',
    'OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','DELIVERED','PICKUP_READY','PICKED_UP',
    'RETURNING','RETURNED','CANCELLED','REFUND_COMPLETED','EXCEPTION_RECORDED','RECONCILED'
  )),
  source text not null check (source in ('OPS','PROVIDER','CUSTOMER','TAILOR','SYSTEM')),
  actor_id uuid,
  actor_role text not null check (actor_role in ('CUSTOMER','TAILOR','OPS','SYSTEM')),
  provider_event_id text,
  idempotency_key text not null unique,
  customer_note text,
  evidence_media jsonb not null default '[]'::jsonb,
  location jsonb,
  eta_at timestamptz,
  eta_timezone text,
  occurred_at timestamptz not null,
  correlation_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(evidence_media) = 'array')
);

create unique index if not exists order_fulfillment_provider_event_unique
  on public.order_fulfillment_events (source, provider_event_id)
  where provider_event_id is not null;
create index if not exists order_fulfillment_events_order_time_idx
  on public.order_fulfillment_events (order_id, occurred_at desc);
create index if not exists order_fulfillment_runs_queue_idx
  on public.order_fulfillment_runs (status, updated_at);

create table if not exists public.order_fulfillment_internal_notes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.order_fulfillment_runs(id) on delete restrict,
  event_id uuid references public.order_fulfillment_events(id) on delete restrict,
  actor_id uuid,
  note text not null check (char_length(trim(note)) between 2 and 4000),
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_fulfillment_event_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Dispatch events and internal notes are append-only.';
end;
$$;

create or replace function public.decide_order_fulfillment_quote(
  p_order_id text,
  p_customer_id uuid,
  p_decision text,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders%rowtype;
  v_run public.order_fulfillment_runs%rowtype;
  v_event public.order_fulfillment_events%rowtype;
  v_event_type text;
begin
  if p_decision not in ('PAY_SHORTFALL','REQUEST_CHEAPER_OPTION','SWITCH_TO_PICKUP','DECLINE_DISPATCH') then
    raise exception 'Invalid dispatch decision.';
  end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'A dispatch decision idempotency key is required.';
  end if;
  select * into v_event from public.order_fulfillment_events where idempotency_key=p_idempotency_key;
  if v_event.id is not null then
    return jsonb_build_object('runId',v_event.run_id,'eventId',v_event.id,'existing',true);
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.customer_id::text <> p_customer_id::text then raise exception 'Only the customer can decide this dispatch quote.'; end if;
  select * into v_run from public.order_fulfillment_runs where order_id=p_order_id for update;
  if v_run.id is null or v_run.status <> 'AWAITING_CUSTOMER_DECISION' then
    raise exception 'This dispatch quote is no longer awaiting a customer decision.';
  end if;

  if p_decision='PAY_SHORTFALL' then
    if v_run.shortfall_total_amount <= 0 then raise exception 'No delivery shortfall is due.'; end if;
    update public.order_fulfillment_runs set
      status='AWAITING_SHORTFALL_PAYMENT', funding_status='SHORTFALL_DUE',
      customer_decision=p_decision,customer_decision_note=nullif(trim(coalesce(p_note,'')),''),
      customer_decided_at=now(),updated_at=now()
    where id=v_run.id returning * into v_run;
    -- Compatibility bridge: the existing provider checkout remains the one
    -- authoritative cross-platform FULFILLMENT payment implementation.
    update public.orders set
      fulfillment_fee=v_run.shortfall_total_amount,
      fulfillment_payment_requested_at=coalesce(fulfillment_payment_requested_at,now()),
      fulfillment_payment_paid_at=null,
      fulfillment_payment_provider=null,
      fulfillment_payment_intent_id=null,
      fulfillment_payment_checkout_url=null
    where id=v_order.id;
    v_event_type:='SHORTFALL_REQUESTED';
  elsif p_decision in ('REQUEST_CHEAPER_OPTION','DECLINE_DISPATCH') then
    update public.order_fulfillment_runs set
      status='QUOTE_REQUIRED',funding_status='UNQUOTED',customer_decision=p_decision,
      customer_decision_note=nullif(trim(coalesce(p_note,'')),''),customer_decided_at=now(),
      actual_provider_cost_amount=null,allowance_applied_amount=0,shortfall_subtotal_amount=0,
      shortfall_tax_amount=0,shortfall_fee_amount=0,shortfall_total_amount=0,
      unused_allowance_amount=0,customer_refund_amount=0,customer_refund_tax_amount=0,
      subsidy_restored_amount=0,
      provider_name=null,provider_quote_reference=null,provider_quote_evidence='[]'::jsonb,
      quote_recorded_at=null,updated_at=now()
    where id=v_run.id returning * into v_run;
    update public.orders set fulfillment_payment_requested_at=null,fulfillment_payment_paid_at=null,
      fulfillment_payment_provider=null,fulfillment_payment_intent_id=null,
      fulfillment_payment_checkout_url=null where id=v_order.id;
    v_event_type:=case
      when p_decision='DECLINE_DISPATCH' then 'DISPATCH_OPTION_DECLINED'
      else 'CHEAPER_OPTION_REQUESTED'
    end;
  else
    if v_run.tax_attribution_status='AMBIGUOUS' and v_run.customer_funded_allowance_amount>0 then
      raise exception 'FULFILLMENT_TAX_ATTRIBUTION_REQUIRED';
    end if;
    update public.order_fulfillment_runs set
      method='LOCAL_COLLECTION',status='PICKUP_READY',funding_status='REFUND_PENDING',
      customer_decision=p_decision,customer_decision_note=nullif(trim(coalesce(p_note,'')),''),
      customer_decided_at=now(),customer_refund_amount=customer_funded_allowance_amount,
      customer_refund_tax_amount=captured_fulfillment_tax_amount,
      customer_refund_status=case when customer_funded_allowance_amount+captured_fulfillment_tax_amount>0 then 'QUEUED' else 'NOT_REQUIRED' end,
      subsidy_restored_amount=drapeon_subsidy_amount,unused_allowance_amount=captured_allowance_amount,
      updated_at=now()
    where id=v_run.id returning * into v_run;
    update public.orders set delivery_method='LOCAL_COLLECTION',fulfillment_fee=0,
      fulfillment_payment_requested_at=null,fulfillment_payment_paid_at=null,
      fulfillment_payment_provider=null,fulfillment_payment_intent_id=null,
      fulfillment_payment_checkout_url=null where id=v_order.id;
    v_event_type:='PICKUP_SELECTED';
  end if;

  insert into public.order_fulfillment_events(
    run_id,order_id,event_type,source,actor_id,actor_role,idempotency_key,
    customer_note,occurred_at,correlation_id,payload
  ) values (
    v_run.id,v_run.order_id,v_event_type,'CUSTOMER',p_customer_id,'CUSTOMER',p_idempotency_key,
    nullif(trim(coalesce(p_note,'')),''),now(),v_run.correlation_id,
    jsonb_build_object('decision',p_decision,'customerDueAmount',v_run.shortfall_total_amount,
      'customerRefundAmount',v_run.customer_refund_amount,
      'customerRefundTaxAmount',v_run.customer_refund_tax_amount,
      'customerRefundTotalAmount',v_run.customer_refund_amount+v_run.customer_refund_tax_amount)
  ) returning * into v_event;
  return jsonb_build_object('runId',v_run.id,'eventId',v_event.id,'status',v_run.status,
    'fundingStatus',v_run.funding_status,'customerDueAmount',v_run.shortfall_total_amount,
    'customerRefundAmount',v_run.customer_refund_amount,
    'customerRefundTaxAmount',v_run.customer_refund_tax_amount,
    'customerRefundTotalAmount',v_run.customer_refund_amount+v_run.customer_refund_tax_amount,
    'existing',false);
end;
$$;
drop trigger if exists order_fulfillment_events_append_only on public.order_fulfillment_events;
create trigger order_fulfillment_events_append_only before update or delete
on public.order_fulfillment_events for each row execute function public.prevent_fulfillment_event_mutation();
drop trigger if exists order_fulfillment_notes_append_only on public.order_fulfillment_internal_notes;
create trigger order_fulfillment_notes_append_only before update or delete
on public.order_fulfillment_internal_notes for each row execute function public.prevent_fulfillment_event_mutation();

create or replace function public.ensure_order_fulfillment_run(p_order_id text)
returns public.order_fulfillment_runs
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders%rowtype;
  v_receipt public.commercial_receipts%rowtype;
  v_reservation public.commercial_pricing_reservations%rowtype;
  v_run public.order_fulfillment_runs%rowtype;
  v_allowance integer;
  v_subsidy integer := 0;
  v_fulfillment_tax integer := 0;
  v_tax_attribution text := 'NOT_TAXED';
  v_tax_snapshot public.tax_decision_snapshots%rowtype;
begin
  select * into v_run from public.order_fulfillment_runs where order_id=p_order_id;
  if v_run.id is not null then return v_run; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  select * into v_receipt from public.commercial_receipts
   where order_id=p_order_id order by issued_at desc limit 1;
  if v_receipt.id is null then raise exception 'A provider-confirmed checkout receipt is required.'; end if;
  select * into v_reservation from public.commercial_pricing_reservations
   where id=v_receipt.pricing_reservation_id;
  if v_receipt.tax_decision_snapshot_id is not null then
    select * into v_tax_snapshot from public.tax_decision_snapshots
     where id=v_receipt.tax_decision_snapshot_id;
  end if;
  v_allowance:=greatest(v_receipt.shipping_amount,0);
  v_subsidy:=least(
    greatest(coalesce((v_reservation.breakdown->>'shippingDiscountAmount')::integer,0),0),
    v_allowance
  );
  if coalesce(v_receipt.tax_amount,0)=0 or coalesce(v_tax_snapshot.shipping_taxable,false)=false then
    v_fulfillment_tax:=0;
    v_tax_attribution:='NOT_TAXED';
  elsif v_tax_snapshot.id is not null
    and v_tax_snapshot.shipping_taxable
    and (v_tax_snapshot.subtotal_amount + v_tax_snapshot.shipping_amount) > 0
    and v_tax_snapshot.shipping_amount = v_allowance then
    v_fulfillment_tax:=round(
      v_receipt.tax_amount::numeric * v_tax_snapshot.shipping_amount::numeric
      / (v_tax_snapshot.subtotal_amount + v_tax_snapshot.shipping_amount)::numeric
    )::integer;
    v_tax_attribution:='ATTRIBUTED';
  else
    v_fulfillment_tax:=0;
    v_tax_attribution:='AMBIGUOUS';
  end if;
  insert into public.order_fulfillment_runs(
    order_id,method,currency,captured_allowance_amount,
    customer_funded_allowance_amount,drapeon_subsidy_amount,
    captured_fulfillment_tax_amount,tax_attribution_status,correlation_id
  ) values (
    v_order.id,v_order.delivery_method,v_receipt.currency,v_allowance,
    v_allowance-v_subsidy,v_subsidy,v_fulfillment_tax,v_tax_attribution,v_receipt.correlation_id
  ) returning * into v_run;
  insert into public.order_fulfillment_parcels(run_id,order_id,parcel_number)
  values(v_run.id,v_order.id,1);
  return v_run;
end;
$$;

create or replace function public.record_order_fulfillment_quote(
  p_order_id text,
  p_provider_name text,
  p_provider_quote_reference text,
  p_actual_provider_cost_amount integer,
  p_shortfall_tax_amount integer,
  p_shortfall_fee_amount integer,
  p_evidence_media jsonb,
  p_customer_note text,
  p_internal_note text,
  p_actor_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_run public.order_fulfillment_runs%rowtype;
  v_event public.order_fulfillment_events%rowtype;
  v_shortfall integer;
  v_unused integer;
  v_customer_unused integer;
  v_subsidy_unused integer;
  v_customer_tax_refund integer;
  v_status text;
begin
  if p_actual_provider_cost_amount < 0 or p_shortfall_tax_amount < 0 or p_shortfall_fee_amount < 0 then
    raise exception 'Dispatch quote amounts cannot be negative.';
  end if;
  if nullif(trim(coalesce(p_provider_name,'')),'') is null then raise exception 'Provider is required.'; end if;
  if jsonb_typeof(coalesce(p_evidence_media,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_evidence_media,'[]'::jsonb))=0 then
    raise exception 'Provider quote proof is required.';
  end if;
  select * into v_event from public.order_fulfillment_events where idempotency_key=p_idempotency_key;
  if v_event.id is not null then return jsonb_build_object('runId',v_event.run_id,'eventId',v_event.id,'existing',true); end if;
  v_run:=public.ensure_order_fulfillment_run(p_order_id);
  select * into v_run from public.order_fulfillment_runs where id=v_run.id for update;
  if v_run.status not in ('QUOTE_REQUIRED','AWAITING_CUSTOMER_DECISION','EXCEPTION') then
    raise exception 'The current dispatch state does not accept another provider quote.';
  end if;
  v_shortfall:=greatest(p_actual_provider_cost_amount-v_run.captured_allowance_amount,0);
  v_unused:=greatest(v_run.captured_allowance_amount-p_actual_provider_cost_amount,0);
  v_customer_unused:=least(v_unused,v_run.customer_funded_allowance_amount);
  v_subsidy_unused:=v_unused-v_customer_unused;
  if v_run.tax_attribution_status='AMBIGUOUS' and v_customer_unused>0 then
    raise exception 'FULFILLMENT_TAX_ATTRIBUTION_REQUIRED';
  end if;
  v_customer_tax_refund:=case
    when v_run.customer_funded_allowance_amount>0 then round(
      v_run.captured_fulfillment_tax_amount::numeric * v_customer_unused::numeric
      / v_run.customer_funded_allowance_amount::numeric
    )::integer
    else 0
  end;
  v_status:=case when v_shortfall>0 then 'AWAITING_CUSTOMER_DECISION' else 'READY_TO_BOOK' end;
  update public.order_fulfillment_runs set
    status=v_status,
    funding_status=case when v_shortfall>0 then 'SHORTFALL_DUE' else 'WITHIN_ALLOWANCE' end,
    actual_provider_cost_amount=p_actual_provider_cost_amount,
    allowance_applied_amount=least(p_actual_provider_cost_amount,captured_allowance_amount),
    shortfall_subtotal_amount=v_shortfall,
    shortfall_tax_amount=case when v_shortfall>0 then p_shortfall_tax_amount else 0 end,
    shortfall_fee_amount=case when v_shortfall>0 then p_shortfall_fee_amount else 0 end,
    shortfall_total_amount=case when v_shortfall>0 then v_shortfall+p_shortfall_tax_amount+p_shortfall_fee_amount else 0 end,
    unused_allowance_amount=v_unused,
    customer_refund_amount=v_customer_unused,
    customer_refund_tax_amount=v_customer_tax_refund,
    customer_refund_status=case when v_customer_unused+v_customer_tax_refund>0 then 'QUEUED' else 'NOT_REQUIRED' end,
    subsidy_restored_amount=v_subsidy_unused,
    provider_name=trim(p_provider_name),
    provider_quote_reference=nullif(trim(coalesce(p_provider_quote_reference,'')),''),
    provider_quote_evidence=coalesce(p_evidence_media,'[]'::jsonb),
    quote_recorded_at=now(), updated_at=now()
  where id=v_run.id returning * into v_run;
  insert into public.order_fulfillment_events(
    run_id,order_id,event_type,source,actor_id,actor_role,idempotency_key,
    customer_note,evidence_media,occurred_at,correlation_id,payload
  ) values (
    v_run.id,v_run.order_id,'QUOTE_RECORDED','OPS',p_actor_id,'OPS',p_idempotency_key,
    nullif(trim(coalesce(p_customer_note,'')),''),coalesce(p_evidence_media,'[]'::jsonb),now(),v_run.correlation_id,
    jsonb_build_object('providerName',v_run.provider_name,'providerQuoteReference',v_run.provider_quote_reference,
      'providerCostAmount',v_run.actual_provider_cost_amount,'capturedAllowanceAmount',v_run.captured_allowance_amount,
      'shortfallSubtotalAmount',v_run.shortfall_subtotal_amount,'shortfallTaxAmount',v_run.shortfall_tax_amount,
      'shortfallFeeAmount',v_run.shortfall_fee_amount,'shortfallTotalAmount',v_run.shortfall_total_amount,
      'unusedAllowanceAmount',v_run.unused_allowance_amount)
  ) returning * into v_event;
  if nullif(trim(coalesce(p_internal_note,'')),'') is not null then
    insert into public.order_fulfillment_internal_notes(run_id,event_id,actor_id,note,correlation_id)
    values(v_run.id,v_event.id,p_actor_id,trim(p_internal_note),v_run.correlation_id);
  end if;
  return jsonb_build_object('runId',v_run.id,'eventId',v_event.id,'status',v_run.status,
    'fundingStatus',v_run.funding_status,'customerDueAmount',v_run.shortfall_total_amount,
    'customerRefundAmount',v_run.customer_refund_amount,
    'customerRefundTaxAmount',v_run.customer_refund_tax_amount,
    'customerRefundTotalAmount',v_run.customer_refund_amount+v_run.customer_refund_tax_amount,
    'existing',false);
end;
$$;

create or replace function public.record_order_fulfillment_event(
  p_order_id text,
  p_parcel_number integer,
  p_event_type text,
  p_source text,
  p_actor_id uuid,
  p_actor_role text,
  p_provider_event_id text,
  p_idempotency_key text,
  p_provider_name text,
  p_service_level text,
  p_provider_reference text,
  p_tracking_number text,
  p_tracking_url text,
  p_contact_name text,
  p_contact_phone text,
  p_customer_note text,
  p_internal_note text,
  p_evidence_media jsonb,
  p_location jsonb,
  p_eta_at timestamptz,
  p_eta_timezone text,
  p_occurred_at timestamptz,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_run public.order_fulfillment_runs%rowtype;
  v_parcel public.order_fulfillment_parcels%rowtype;
  v_event public.order_fulfillment_events%rowtype;
  v_parcel_status text;
  v_run_status text;
  v_order_stage text;
  v_previous_order_stage text;
begin
  if p_event_type not in ('SHORTFALL_PAID','BOOKED','CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','DELIVERED','PICKUP_READY','PICKED_UP','RETURNING','RETURNED','CANCELLED','EXCEPTION_RECORDED','RECONCILED') then
    raise exception 'Invalid dispatch event.';
  end if;
  if p_source not in ('OPS','PROVIDER','CUSTOMER','TAILOR','SYSTEM') or p_actor_role not in ('CUSTOMER','TAILOR','OPS','SYSTEM') then
    raise exception 'Invalid dispatch event source.';
  end if;
  select * into v_event from public.order_fulfillment_events where idempotency_key=p_idempotency_key;
  if v_event.id is not null then return jsonb_build_object('eventId',v_event.id,'runId',v_event.run_id,'existing',true); end if;
  if p_provider_event_id is not null then
    select * into v_event from public.order_fulfillment_events where source=p_source and provider_event_id=p_provider_event_id;
    if v_event.id is not null then return jsonb_build_object('eventId',v_event.id,'runId',v_event.run_id,'existing',true); end if;
  end if;
  v_run:=public.ensure_order_fulfillment_run(p_order_id);
  select * into v_run from public.order_fulfillment_runs where id=v_run.id for update;
  select * into v_parcel from public.order_fulfillment_parcels
    where run_id=v_run.id and parcel_number=greatest(coalesce(p_parcel_number,1),1) for update;
  if v_parcel.id is null then
    insert into public.order_fulfillment_parcels(run_id,order_id,parcel_number)
    values(v_run.id,v_run.order_id,greatest(coalesce(p_parcel_number,1),1)) returning * into v_parcel;
  end if;
  if p_event_type='BOOKED' and v_run.status not in ('READY_TO_BOOK','BOOKED') then raise exception 'Dispatch funding must be ready before booking.'; end if;
  if p_event_type in ('CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','DELIVERED') and v_run.method='LOCAL_COLLECTION' then raise exception 'Carrier delivery events are not valid for local collection.'; end if;
  if p_event_type='DELIVERED' and v_run.custody_accepted_at is null then raise exception 'Trusted custody proof is required before delivery.'; end if;
  if p_event_type in ('CARRIER_ACCEPTED','COLLECTED','DELIVERED','PICKUP_READY','PICKED_UP')
    and (jsonb_typeof(coalesce(p_evidence_media,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_evidence_media,'[]'::jsonb))=0) then
    raise exception 'Dispatch handoff proof is required for this update.';
  end if;
  v_parcel_status:=case when p_event_type='EXCEPTION_RECORDED' then 'EXCEPTION' else p_event_type end;
  v_run_status:=case
    when p_event_type='SHORTFALL_PAID' then 'READY_TO_BOOK'
    when p_event_type='BOOKED' then 'BOOKED'
    when p_event_type in ('CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','RETURNING','RETURNED') then 'IN_TRANSIT'
    when p_event_type='DELIVERED' then 'DELIVERED'
    when p_event_type='PICKUP_READY' then 'PICKUP_READY'
    when p_event_type='PICKED_UP' then 'PICKED_UP'
    when p_event_type='CANCELLED' then 'CANCELLED'
    when p_event_type='EXCEPTION_RECORDED' then 'EXCEPTION'
    when p_event_type='RECONCILED' then 'RECONCILED'
    else v_run.status end;
  update public.order_fulfillment_parcels set
    status=v_parcel_status,provider_name=coalesce(nullif(trim(coalesce(p_provider_name,'')),''),provider_name),
    service_level=coalesce(nullif(trim(coalesce(p_service_level,'')),''),service_level),
    provider_reference=coalesce(nullif(trim(coalesce(p_provider_reference,'')),''),provider_reference),
    tracking_number=coalesce(nullif(trim(coalesce(p_tracking_number,'')),''),tracking_number),
    tracking_url=coalesce(nullif(trim(coalesce(p_tracking_url,'')),''),tracking_url),
    contact_name=coalesce(nullif(trim(coalesce(p_contact_name,'')),''),contact_name),
    contact_phone=coalesce(nullif(trim(coalesce(p_contact_phone,'')),''),contact_phone),
    eta_at=coalesce(p_eta_at,eta_at),eta_timezone=coalesce(nullif(trim(coalesce(p_eta_timezone,'')),''),eta_timezone),
    last_location=coalesce(p_location,last_location),last_status_at=coalesce(p_occurred_at,now()),updated_at=now()
  where id=v_parcel.id returning * into v_parcel;
  update public.order_fulfillment_runs set status=v_run_status,
    funding_status=case when p_event_type='SHORTFALL_PAID' then 'SHORTFALL_PAID' when p_event_type='RECONCILED' then 'RECONCILED' when p_event_type='EXCEPTION_RECORDED' then 'EXCEPTION' else funding_status end,
    provider_name=coalesce(nullif(trim(coalesce(p_provider_name,'')),''),provider_name),
    shortfall_paid_at=case when p_event_type='SHORTFALL_PAID' then coalesce(shortfall_paid_at,p_occurred_at,now()) else shortfall_paid_at end,
    booked_at=case when p_event_type='BOOKED' then coalesce(booked_at,p_occurred_at,now()) else booked_at end,
    custody_accepted_at=case when p_event_type in ('CARRIER_ACCEPTED','COLLECTED') then coalesce(custody_accepted_at,p_occurred_at,now()) else custody_accepted_at end,
    delivered_at=case when p_event_type in ('DELIVERED','PICKED_UP') then coalesce(delivered_at,p_occurred_at,now()) else delivered_at end,
    reconciled_at=case when p_event_type='RECONCILED' then coalesce(reconciled_at,p_occurred_at,now()) else reconciled_at end,
    updated_at=now() where id=v_run.id returning * into v_run;
  insert into public.order_fulfillment_events(run_id,parcel_id,order_id,event_type,source,actor_id,actor_role,provider_event_id,idempotency_key,customer_note,evidence_media,location,eta_at,eta_timezone,occurred_at,correlation_id,payload)
  values(v_run.id,v_parcel.id,v_run.order_id,p_event_type,p_source,p_actor_id,p_actor_role,p_provider_event_id,p_idempotency_key,nullif(trim(coalesce(p_customer_note,'')),''),coalesce(p_evidence_media,'[]'::jsonb),p_location,p_eta_at,nullif(trim(coalesce(p_eta_timezone,'')),''),coalesce(p_occurred_at,now()),v_run.correlation_id,coalesce(p_payload,'{}'::jsonb)) returning * into v_event;
  if nullif(trim(coalesce(p_internal_note,'')),'') is not null then
    insert into public.order_fulfillment_internal_notes(run_id,event_id,actor_id,note,correlation_id)
    values(v_run.id,v_event.id,p_actor_id,trim(p_internal_note),v_run.correlation_id);
  end if;
  v_order_stage:=case
    when p_event_type in ('CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT') and v_run.method='LOCAL_DELIVERY' then 'OUT_FOR_DELIVERY'
    when p_event_type in ('CARRIER_ACCEPTED','COLLECTED','AT_HUB','IN_TRANSIT') and v_run.method='SHIPPING' then 'SHIPPED'
    when p_event_type='OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY'
    when p_event_type='DELIVERED' then 'DELIVERED'
    when p_event_type='PICKUP_READY' then 'READY_FOR_COLLECTION'
    when p_event_type='PICKED_UP' then 'COLLECTED'
    else null end;
  if v_order_stage is not null then
    select stage::text into v_previous_order_stage from public.orders where id=v_run.order_id for update;
    if v_previous_order_stage is distinct from v_order_stage then
      update public.orders set
        stage=v_order_stage::public.order_stage,
        stage_updated_at=coalesce(p_occurred_at,now()),
        carrier=coalesce(nullif(trim(coalesce(p_provider_name,'')),''),carrier),
        tracking_number=coalesce(nullif(trim(coalesce(p_tracking_number,'')),''),tracking_number),
        fulfillment_provider=coalesce(nullif(trim(coalesce(p_provider_name,'')),''),fulfillment_provider),
        fulfillment_reference=coalesce(nullif(trim(coalesce(p_provider_reference,'')),''),fulfillment_reference),
        fulfillment_contact_name=coalesce(nullif(trim(coalesce(p_contact_name,'')),''),fulfillment_contact_name),
        fulfillment_contact_phone=coalesce(nullif(trim(coalesce(p_contact_phone,'')),''),fulfillment_contact_phone),
        updated_at=now()
      where id=v_run.order_id;
      insert into public.order_stage_updates(order_id,stage,note,evidence_media)
      values(
        v_run.order_id,
        v_order_stage::public.order_stage,
        coalesce(nullif(trim(coalesce(p_customer_note,'')),''),'Drapeon Dispatch recorded ' || lower(replace(p_event_type,'_',' ')) || '.'),
        coalesce(p_evidence_media,'[]'::jsonb)
      );
    end if;
  end if;
  return jsonb_build_object('eventId',v_event.id,'runId',v_run.id,'parcelId',v_parcel.id,'status',v_run.status,'existing',false);
end;
$$;

alter table public.order_fulfillment_runs enable row level security;
alter table public.order_fulfillment_parcels enable row level security;
alter table public.order_fulfillment_events enable row level security;
alter table public.order_fulfillment_internal_notes enable row level security;

create policy fulfillment_runs_parties_read on public.order_fulfillment_runs for select to authenticated
using(exists(select 1 from public.orders o where o.id::text=order_id::text and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy fulfillment_parcels_parties_read on public.order_fulfillment_parcels for select to authenticated
using(exists(select 1 from public.orders o where o.id::text=order_id::text and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy fulfillment_events_parties_read on public.order_fulfillment_events for select to authenticated
using(exists(select 1 from public.orders o where o.id::text=order_id::text and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));

revoke all on public.order_fulfillment_runs,public.order_fulfillment_parcels,public.order_fulfillment_events,public.order_fulfillment_internal_notes from anon,authenticated;
grant select on public.order_fulfillment_runs,public.order_fulfillment_parcels,public.order_fulfillment_events to authenticated;
grant all on public.order_fulfillment_runs,public.order_fulfillment_parcels,public.order_fulfillment_events,public.order_fulfillment_internal_notes to service_role;
revoke all on function public.ensure_order_fulfillment_run(text) from public,anon,authenticated;
revoke all on function public.record_order_fulfillment_quote(text,text,text,integer,integer,integer,jsonb,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.decide_order_fulfillment_quote(text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_order_fulfillment_event(text,integer,text,text,uuid,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,timestamptz,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.ensure_order_fulfillment_run(text) to service_role;
grant execute on function public.record_order_fulfillment_quote(text,text,text,integer,integer,integer,jsonb,text,text,uuid,text) to service_role;
grant execute on function public.decide_order_fulfillment_quote(text,uuid,text,text,text) to service_role;
grant execute on function public.record_order_fulfillment_event(text,integer,text,text,uuid,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,timestamptz,text,timestamptz,jsonb) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.order_fulfillment_runs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.order_fulfillment_parcels;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.order_fulfillment_events;
exception when duplicate_object then null; end $$;

comment on table public.order_fulfillment_runs is 'Authoritative Drapeon Dispatch funding and terminal outcome per order.';
comment on table public.order_fulfillment_events is 'Append-only customer-safe Drapeon Dispatch timeline.';
comment on table public.order_fulfillment_internal_notes is 'Private Ops-only context; never exposed through party RLS.';
