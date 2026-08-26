-- Fabric funding policy v2.
-- Existing v1 orders and their Money Desk release workflow remain untouched.
-- V2 binds the customer decision to one exact candidate and automatically
-- consumes only the approved material allocation after provider confirmation.

alter table public.order_fabric_funding_allocations
  drop constraint if exists order_fabric_funding_allocations_policy_version_check;
alter table public.order_fabric_funding_allocations
  add constraint order_fabric_funding_allocations_policy_version_check check (
    policy_version in ('fabric-funding-2026-08-01-v1', 'fabric-funding-2026-08-21-v2')
  );

alter table public.order_quotes drop constraint if exists order_quotes_fabric_allocation_check;
alter table public.order_quotes add constraint order_quotes_fabric_allocation_check check (
  fabric_funding_policy_version not in ('fabric-funding-2026-08-01-v1', 'fabric-funding-2026-08-21-v2')
  or (
    fabric_source_snapshot in ('CUSTOMER_SUPPLIES', 'TAILOR_SOURCES')
    and tailoring_amount is not null and tailoring_amount >= 0
    and fabric_allowance_amount is not null and fabric_allowance_amount >= 0
    and fabric_allowance_currency = currency::currency
    and tailoring_amount + fabric_allowance_amount = subtotal_amount
    and pricing_version > 0
    and (
      (fabric_source_snapshot = 'CUSTOMER_SUPPLIES' and fabric_allowance_amount = 0 and coalesce(fabric_allowance_coverage, '[]'::jsonb) = '[]'::jsonb)
      or (fabric_source_snapshot = 'TAILOR_SOURCES' and fabric_allowance_amount > 0 and jsonb_typeof(fabric_allowance_coverage) = 'array' and jsonb_array_length(fabric_allowance_coverage) > 0 and char_length(btrim(coalesce(fabric_sourcing_assumptions, ''))) >= 8)
    )
  )
);

alter table public.commercial_pricing_reservations drop constraint if exists commercial_pricing_fabric_allocation_check;
alter table public.commercial_pricing_reservations add constraint commercial_pricing_fabric_allocation_check check (
  fabric_funding_policy_version not in ('fabric-funding-2026-08-01-v1', 'fabric-funding-2026-08-21-v2')
  or (
    fabric_source_snapshot in ('CUSTOMER_SUPPLIES', 'TAILOR_SOURCES')
    and tailoring_amount is not null and tailoring_amount >= 0
    and fabric_allowance_amount is not null and fabric_allowance_amount >= 0
    and tailoring_amount + fabric_allowance_amount = subtotal_amount
    and (
      (fabric_source_snapshot = 'CUSTOMER_SUPPLIES' and fabric_allowance_amount = 0)
      or (fabric_source_snapshot = 'TAILOR_SOURCES' and fabric_allowance_amount > 0 and jsonb_typeof(fabric_allowance_coverage) = 'array' and jsonb_array_length(fabric_allowance_coverage) > 0 and char_length(btrim(coalesce(fabric_sourcing_assumptions, ''))) >= 8)
    )
  )
);

-- The v1 functions remain authoritative for captured v1 orders. Extend their
-- immutable quote, acceptance, and checkout contracts to accept the explicitly
-- versioned v2 policy for newly-created orders without rewriting v1 rows.
do $$
declare
  v_name text;
  v_oid oid;
  v_before text;
  v_after text;
begin
  foreach v_name in array array[
    'create_funded_order_quote_snapshot',
    'lock_fabric_allocation_on_quote_acceptance',
    'create_funded_commercial_pricing_reservation'
  ] loop
    select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name
    order by p.oid desc
    limit 1;
    if v_oid is null then raise exception 'FABRIC_V2_DEPENDENCY_MISSING:%', v_name; end if;
    v_before := pg_get_functiondef(v_oid);
    v_after := replace(
      v_before,
      '<> ''fabric-funding-2026-08-01-v1''',
      'not in (''fabric-funding-2026-08-01-v1'',''fabric-funding-2026-08-21-v2'')'
    );
    if v_after = v_before then raise exception 'FABRIC_V2_POLICY_GUARD_NOT_FOUND:%', v_name; end if;
    execute v_after;
  end loop;
end $$;

create table if not exists public.order_fabric_candidates (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id_text) on delete restrict,
  allocation_id uuid not null references public.order_fabric_funding_allocations(id) on delete restrict,
  customer_id text not null,
  tailor_id text not null,
  component_code text not null check (component_code in ('FABRIC','LINING','EMBROIDERY','TRIMS','NOTIONS','OTHER_AGREED_MATERIAL')),
  candidate_version integer not null check (candidate_version > 0),
  supplier_cost_amount integer not null check (supplier_cost_amount > 0),
  currency currency not null,
  allowance_applied_amount integer not null default 0 check (allowance_applied_amount >= 0),
  shortfall_subtotal_amount integer not null default 0 check (shortfall_subtotal_amount >= 0),
  shortfall_tax_amount integer not null default 0 check (shortfall_tax_amount >= 0),
  shortfall_fee_amount integer not null default 0 check (shortfall_fee_amount >= 0),
  estimate_storage_bucket text not null default 'commercial-evidence' check (estimate_storage_bucket = 'commercial-evidence'),
  estimate_storage_path text not null check (char_length(btrim(estimate_storage_path)) >= 3 and estimate_storage_path !~* '^https?://'),
  customer_media jsonb not null check (jsonb_typeof(customer_media) = 'array' and jsonb_array_length(customer_media) between 1 and 6),
  availability_note text not null check (char_length(btrim(availability_note)) >= 5),
  quantity_specification text not null check (char_length(btrim(quantity_specification)) >= 5),
  deadline_impact text not null check (deadline_impact in ('NONE','MAY_DELAY','DELAYS_ORDER')),
  deadline_impact_note text,
  status text not null default 'AWAITING_CUSTOMER_DECISION' check (status in (
    'DRAFT','AWAITING_CUSTOMER_DECISION','CHANGES_REQUESTED','DECLINED',
    'AWAITING_SHORTFALL_PAYMENT','RELEASE_QUEUED','RELEASE_PROCESSING',
    'RELEASE_SUCCEEDED','RELEASE_BLOCKED','AWAITING_RECEIPT','RECONCILED',
    'EXCEPTION','SUPERSEDED'
  )),
  customer_decision text check (customer_decision is null or customer_decision in ('APPROVE','REQUEST_CHANGES','DECLINE')),
  customer_reason_code text check (customer_reason_code is null or customer_reason_code in ('TOO_EXPENSIVE','WRONG_COLOR','WRONG_TEXTURE_OR_WEIGHT','WRONG_QUALITY','INSUFFICIENT_QUANTITY','DEADLINE_IMPACT','NO_LONGER_NEEDED','OTHER')),
  customer_note text,
  customer_decided_at timestamptz,
  shortfall_payment_id uuid references public.order_payments(id) on delete restrict,
  shortfall_paid_at timestamptz,
  payout_id text,
  provider text check (provider is null or provider in ('PAYSTACK','STRIPE')),
  provider_reference text,
  provider_status text check (provider_status is null or provider_status in ('QUEUED','PROCESSING','SUCCEEDED','FAILED','AMBIGUOUS','REVERSED')),
  provider_response jsonb not null default '{}'::jsonb,
  release_queued_at timestamptz,
  release_confirmed_at timestamptz,
  receipt_storage_bucket text check (receipt_storage_bucket is null or receipt_storage_bucket = 'commercial-evidence'),
  receipt_storage_path text,
  acquired_media jsonb not null default '[]'::jsonb check (jsonb_typeof(acquired_media) = 'array' and jsonb_array_length(acquired_media) <= 6),
  actual_spend_amount integer check (actual_spend_amount is null or actual_spend_amount >= 0),
  reconciliation_status text check (reconciliation_status is null or reconciliation_status in ('PENDING','EXACT','UNUSED_VALUE','OVERAGE','MISSING_PROOF','CONFLICTING_EVIDENCE','RESOLVED')),
  reconciliation_resolution text,
  reconciled_at timestamptz,
  ops_issue_id uuid,
  policy_version text not null check (policy_version = 'fabric-funding-2026-08-21-v2'),
  correlation_id uuid not null,
  idempotency_key text not null unique,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, component_code, candidate_version),
  check (allowance_applied_amount + shortfall_subtotal_amount = supplier_cost_amount),
  check (deadline_impact = 'NONE' or char_length(btrim(coalesce(deadline_impact_note, ''))) >= 8),
  check (shortfall_subtotal_amount > 0 or (shortfall_tax_amount = 0 and shortfall_fee_amount = 0))
);

create unique index if not exists order_fabric_candidates_one_active_component_idx
  on public.order_fabric_candidates(order_id, component_code)
  where status not in ('DECLINED','SUPERSEDED','RECONCILED');
create index if not exists order_fabric_candidates_participant_idx
  on public.order_fabric_candidates(customer_id, tailor_id, updated_at desc);
create index if not exists order_fabric_candidates_release_idx
  on public.order_fabric_candidates(status, release_queued_at)
  where status in ('RELEASE_QUEUED','RELEASE_PROCESSING','RELEASE_BLOCKED');

alter table public.payouts add column if not exists fabric_candidate_id uuid references public.order_fabric_candidates(id) on delete restrict;
create unique index if not exists payouts_fabric_candidate_idx on public.payouts(fabric_candidate_id) where fabric_candidate_id is not null;
alter table public.order_payments add column if not exists fabric_candidate_id uuid references public.order_fabric_candidates(id) on delete restrict;
create unique index if not exists order_payments_fabric_candidate_active_idx on public.order_payments(fabric_candidate_id) where fabric_candidate_id is not null and status in ('INITIATED','PENDING','SUCCEEDED');

create table if not exists public.order_fabric_handoffs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.orders(id_text) on delete restrict,
  customer_id text not null,
  tailor_id text not null,
  mode text not null check (mode in ('CUSTOMER_SHIPS_TO_TAILOR','CUSTOMER_DROPS_OFF_LOCALLY','TAILOR_PICKS_UP_LOCALLY','BRINGS_TO_CONSULTATION')),
  status text not null default 'AWAITING_HANDOFF' check (status in ('AWAITING_HANDOFF','SCHEDULED','IN_TRANSIT','RECEIVED_SUITABLE','RECEIVED_WITH_ISSUE','REPLACEMENT_REQUIRED','TAILOR_REPLACEMENT_PROPOSED','CONTINUE_AUTHORIZED')),
  carrier text,
  tracking_number text,
  tracking_url text,
  scheduled_at timestamptz,
  timezone text,
  handoff_location text,
  received_media jsonb not null default '[]'::jsonb check (jsonb_typeof(received_media) = 'array' and jsonb_array_length(received_media) <= 6),
  suitability_note text,
  issue_note text,
  issue_outcome text check (issue_outcome is null or issue_outcome in ('CUSTOMER_PROVIDES_REPLACEMENT','TAILOR_SOURCES_REPLACEMENT','CONTINUE_WITH_CURRENT_FABRIC')),
  received_at timestamptz,
  resolved_at timestamptz,
  policy_version text not null default 'fabric-funding-2026-08-21-v2' check (policy_version = 'fabric-funding-2026-08-21-v2'),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode <> 'CUSTOMER_SHIPS_TO_TAILOR' or status = 'AWAITING_HANDOFF' or (char_length(btrim(coalesce(carrier,''))) >= 2 and char_length(btrim(coalesce(tracking_number,''))) >= 3)),
  check (mode = 'CUSTOMER_SHIPS_TO_TAILOR' or status = 'AWAITING_HANDOFF' or scheduled_at is not null)
);

create table if not exists public.order_fabric_events (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id_text) on delete restrict,
  candidate_id uuid references public.order_fabric_candidates(id) on delete restrict,
  handoff_id uuid references public.order_fabric_handoffs(id) on delete restrict,
  event_type text not null,
  actor_id text,
  actor_role text not null check (actor_role in ('CUSTOMER','TAILOR','OPS','SYSTEM')),
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_fabric_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'FABRIC_EVENTS_ARE_APPEND_ONLY'; end $$;
drop trigger if exists order_fabric_events_append_only on public.order_fabric_events;
create trigger order_fabric_events_append_only before update or delete on public.order_fabric_events for each row execute function public.prevent_fabric_event_mutation();

create or replace function public.protect_fabric_candidate_identity() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if row(new.order_id,new.allocation_id,new.customer_id,new.tailor_id,new.component_code,new.candidate_version,new.supplier_cost_amount,new.currency,new.allowance_applied_amount,new.shortfall_subtotal_amount,new.shortfall_tax_amount,new.shortfall_fee_amount,new.estimate_storage_bucket,new.estimate_storage_path,new.customer_media,new.availability_note,new.quantity_specification,new.deadline_impact,new.deadline_impact_note,new.policy_version,new.correlation_id,new.idempotency_key,new.submitted_at)
    is distinct from row(old.order_id,old.allocation_id,old.customer_id,old.tailor_id,old.component_code,old.candidate_version,old.supplier_cost_amount,old.currency,old.allowance_applied_amount,old.shortfall_subtotal_amount,old.shortfall_tax_amount,old.shortfall_fee_amount,old.estimate_storage_bucket,old.estimate_storage_path,old.customer_media,old.availability_note,old.quantity_specification,old.deadline_impact,old.deadline_impact_note,old.policy_version,old.correlation_id,old.idempotency_key,old.submitted_at)
  then raise exception 'FABRIC_CANDIDATE_IDENTITY_IS_IMMUTABLE'; end if;
  new.updated_at=now(); return new;
end $$;
drop trigger if exists order_fabric_candidate_identity on public.order_fabric_candidates;
create trigger order_fabric_candidate_identity before update on public.order_fabric_candidates for each row execute function public.protect_fabric_candidate_identity();

alter table public.order_fabric_candidates enable row level security;
alter table public.order_fabric_handoffs enable row level security;
alter table public.order_fabric_events enable row level security;
create policy "fabric candidates participants view" on public.order_fabric_candidates for select to authenticated using (customer_id=auth.uid()::text or tailor_id=auth.uid()::text);
create policy "fabric handoffs participants view" on public.order_fabric_handoffs for select to authenticated using (customer_id=auth.uid()::text or tailor_id=auth.uid()::text);
create policy "fabric events participants view" on public.order_fabric_events for select to authenticated using (exists(select 1 from public.orders o where o.id::text=order_id::text and (o.customer_id::text=auth.uid()::text or o.tailor_id::text=auth.uid()::text)));
grant select on public.order_fabric_candidates,public.order_fabric_handoffs,public.order_fabric_events to authenticated;
grant select,insert,update,delete on public.order_fabric_candidates,public.order_fabric_handoffs to service_role;
grant select,insert on public.order_fabric_events to service_role;

-- Candidate, handoff, and event rows are the authoritative counterpart state.
-- Publish them idempotently so mobile and web update without a forced reload.
do $$
declare v_table text;
begin
  foreach v_table in array array['order_fabric_candidates','order_fabric_handoffs','order_fabric_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

create or replace function public.submit_fabric_candidate_v2(
  p_order_id text,p_tailor_id uuid,p_component_code text,p_supplier_cost_amount integer,p_currency currency,
  p_estimate_storage_path text,p_customer_media jsonb,p_availability_note text,p_quantity_specification text,
  p_deadline_impact text,p_deadline_impact_note text,p_correlation_id uuid,p_idempotency_key text
) returns public.order_fabric_candidates language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders%rowtype; v_allocation public.order_fabric_funding_allocations%rowtype; v_candidate public.order_fabric_candidates%rowtype; v_handoff public.order_fabric_handoffs%rowtype; v_version integer; v_remaining integer; v_allowance integer; v_shortfall integer; v_shortfall_tax integer; v_is_customer_replacement boolean := false;
begin
  select * into v_candidate from public.order_fabric_candidates where idempotency_key=p_idempotency_key; if v_candidate.id is not null then return v_candidate; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.tailor_id::text<>p_tailor_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_order.fabric_funding_policy_version<>'fabric-funding-2026-08-21-v2' then raise exception 'FABRIC_POLICY_V2_REQUIRED'; end if;
  if v_order.fabric_source::text='CUSTOMER_SUPPLIES' then
    select * into v_handoff from public.order_fabric_handoffs where order_id=p_order_id;
    v_is_customer_replacement:=v_handoff.status='TAILOR_REPLACEMENT_PROPOSED' and v_handoff.issue_outcome='TAILOR_SOURCES_REPLACEMENT';
  end if;
  if v_order.fabric_source::text<>'TAILOR_SOURCES' and not v_is_customer_replacement then raise exception 'FABRIC_POLICY_V2_TAILOR_SOURCE_REQUIRED'; end if;
  if v_is_customer_replacement and p_component_code<>'FABRIC' then raise exception 'CUSTOMER_FABRIC_REPLACEMENT_COMPONENT_INVALID'; end if;
  select * into v_allocation from public.order_fabric_funding_allocations where order_id=p_order_id for update;
  if v_allocation.id is null or v_allocation.policy_version<>'fabric-funding-2026-08-21-v2' then raise exception 'FABRIC_ALLOCATION_V2_NOT_FOUND'; end if;
  if v_allocation.currency<>p_currency then raise exception 'CURRENCY_MISMATCH'; end if;
  if not v_is_customer_replacement and not (v_allocation.coverage ? p_component_code) then raise exception 'FABRIC_COMPONENT_NOT_COVERED'; end if;
  update public.order_fabric_candidates set status='SUPERSEDED' where order_id=p_order_id and component_code=p_component_code and status in ('DRAFT','AWAITING_CUSTOMER_DECISION','CHANGES_REQUESTED','DECLINED');
  select coalesce(max(candidate_version),0)+1 into v_version from public.order_fabric_candidates where order_id=p_order_id and component_code=p_component_code;
  -- Reserve allowance per active/reconciled component. Do not let two candidates
  -- independently consume the same protected amount before either release lands.
  v_remaining:=greatest(0,
    v_allocation.funded_amount-v_allocation.refunded_amount-
    coalesce((select sum(c.allowance_applied_amount) from public.order_fabric_candidates c
      where c.order_id=p_order_id and c.status not in ('DECLINED','SUPERSEDED')),0)
  );
  v_allowance:=least(p_supplier_cost_amount,v_remaining);
  v_shortfall:=p_supplier_cost_amount-v_allowance;
  if v_shortfall>0 and coalesce(v_order.tax_fallback,false) then raise exception 'FABRIC_SHORTFALL_TAX_NOT_LOCKED'; end if;
  v_shortfall_tax:=case when v_shortfall>0 then round(v_shortfall*greatest(coalesce(v_order.tax_rate_bps,0),0)::numeric/10000)::integer else 0 end;
  insert into public.order_fabric_candidates(order_id,allocation_id,customer_id,tailor_id,component_code,candidate_version,supplier_cost_amount,currency,allowance_applied_amount,shortfall_subtotal_amount,shortfall_tax_amount,shortfall_fee_amount,estimate_storage_path,customer_media,availability_note,quantity_specification,deadline_impact,deadline_impact_note,policy_version,correlation_id,idempotency_key)
  values(p_order_id,v_allocation.id,v_order.customer_id::text,v_order.tailor_id::text,p_component_code,v_version,p_supplier_cost_amount,p_currency,v_allowance,v_shortfall,v_shortfall_tax,0,p_estimate_storage_path,p_customer_media,btrim(p_availability_note),btrim(p_quantity_specification),p_deadline_impact,nullif(btrim(coalesce(p_deadline_impact_note,'')),''),'fabric-funding-2026-08-21-v2',p_correlation_id,p_idempotency_key) returning * into v_candidate;
  update public.custom_order_details set fabric_approval_status='PENDING_CUSTOMER_APPROVAL',fabric_approval_requested_at=now(),updated_at=now() where order_id=p_order_id;
  insert into public.order_fabric_events(order_id,candidate_id,event_type,actor_id,actor_role,payload,correlation_id) values(p_order_id,v_candidate.id,'CANDIDATE_SUBMITTED',p_tailor_id::text,'TAILOR',jsonb_build_object('componentCode',p_component_code,'supplierCostAmount',p_supplier_cost_amount,'currency',p_currency,'allowanceAppliedAmount',v_allowance,'shortfallSubtotalAmount',v_shortfall,'shortfallTaxAmount',v_shortfall_tax,'shortfallFeeAmount',0),p_correlation_id);
  return v_candidate;
end $$;

create or replace function public.decide_fabric_candidate_v2(p_candidate_id uuid,p_customer_id uuid,p_decision text,p_reason_code text default null,p_note text default null)
returns public.order_fabric_candidates language plpgsql security definer set search_path=public,pg_temp as $$
declare v_candidate public.order_fabric_candidates%rowtype;
begin
  select * into v_candidate from public.order_fabric_candidates where id=p_candidate_id for update;
  if v_candidate.id is null then raise exception 'FABRIC_CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.customer_id<>p_customer_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_candidate.status<>'AWAITING_CUSTOMER_DECISION' then
    if v_candidate.customer_decision=p_decision then return v_candidate; end if;
    raise exception 'FABRIC_CANDIDATE_DECISION_CLOSED';
  end if;
  if p_decision not in ('APPROVE','REQUEST_CHANGES','DECLINE') then raise exception 'FABRIC_DECISION_INVALID'; end if;
  if p_decision in ('REQUEST_CHANGES','DECLINE') and p_reason_code is null then raise exception 'FABRIC_DECISION_REASON_REQUIRED'; end if;
  update public.order_fabric_candidates set customer_decision=p_decision,customer_reason_code=p_reason_code,customer_note=nullif(btrim(coalesce(p_note,'')),''),customer_decided_at=now(),status=case when p_decision='APPROVE' and shortfall_subtotal_amount>0 then 'AWAITING_SHORTFALL_PAYMENT' when p_decision='APPROVE' then 'RELEASE_QUEUED' when p_decision='REQUEST_CHANGES' then 'CHANGES_REQUESTED' else 'DECLINED' end,release_queued_at=case when p_decision='APPROVE' and shortfall_subtotal_amount=0 then now() else null end where id=p_candidate_id returning * into v_candidate;
  update public.custom_order_details set fabric_approval_status=case when p_decision='APPROVE' then 'APPROVED' when p_decision='REQUEST_CHANGES' then 'CHANGES_REQUESTED' else 'UNSUITABLE' end,fabric_approved_at=case when p_decision='APPROVE' then now() else null end,fabric_changes_requested_at=case when p_decision='REQUEST_CHANGES' then now() else null end,fabric_marked_unsuitable_at=case when p_decision='DECLINE' then now() else null end,updated_at=now() where order_id=v_candidate.order_id;
  insert into public.order_fabric_events(order_id,candidate_id,event_type,actor_id,actor_role,payload,correlation_id) values(v_candidate.order_id,v_candidate.id,'CUSTOMER_'||p_decision,p_customer_id::text,'CUSTOMER',jsonb_build_object('reasonCode',p_reason_code,'note',p_note,'authorizedAmount',v_candidate.supplier_cost_amount,'currency',v_candidate.currency),v_candidate.correlation_id);
  return v_candidate;
end $$;

create or replace function public.mark_fabric_candidate_shortfall_paid_v2(p_candidate_id uuid,p_payment_id uuid)
returns public.order_fabric_candidates language plpgsql security definer set search_path=public,pg_temp as $$
declare v_candidate public.order_fabric_candidates%rowtype; v_payment public.order_payments%rowtype;
begin
  select * into v_candidate from public.order_fabric_candidates where id=p_candidate_id for update;
  if v_candidate.status='RELEASE_QUEUED' and v_candidate.shortfall_payment_id=p_payment_id then return v_candidate; end if;
  if v_candidate.status<>'AWAITING_SHORTFALL_PAYMENT' then raise exception 'FABRIC_SHORTFALL_NOT_DUE'; end if;
  select * into v_payment from public.order_payments where id=p_payment_id and order_id=v_candidate.order_id and status='SUCCEEDED' and ledger_recorded_at is not null;
  if v_payment.id is null then raise exception 'TERMINAL_LEDGER_RECORDED_SHORTFALL_PAYMENT_REQUIRED'; end if;
  if v_payment.currency<>v_candidate.currency or v_payment.amount<v_candidate.shortfall_subtotal_amount+v_candidate.shortfall_tax_amount+v_candidate.shortfall_fee_amount then raise exception 'FABRIC_SHORTFALL_PAYMENT_MISMATCH'; end if;
  update public.order_fabric_funding_allocations set paid_adjustment_amount=paid_adjustment_amount+v_candidate.shortfall_subtotal_amount,funded_amount=funded_amount+v_candidate.shortfall_subtotal_amount,status='FUNDED' where id=v_candidate.allocation_id;
  update public.order_fabric_candidates set shortfall_payment_id=p_payment_id,shortfall_paid_at=now(),status='RELEASE_QUEUED',release_queued_at=now() where id=p_candidate_id returning * into v_candidate;
  insert into public.order_fabric_events(order_id,candidate_id,event_type,actor_role,payload,correlation_id) values(v_candidate.order_id,v_candidate.id,'SHORTFALL_PAYMENT_CONFIRMED','SYSTEM',jsonb_build_object('paymentId',p_payment_id,'allocationIncrease',v_candidate.shortfall_subtotal_amount,'taxExcluded',v_candidate.shortfall_tax_amount,'feesExcluded',v_candidate.shortfall_fee_amount),v_candidate.correlation_id);
  return v_candidate;
end $$;

create or replace function public.record_fabric_candidate_release_outcome_v2(p_candidate_id uuid,p_payout_id text,p_provider text,p_provider_reference text,p_outcome text,p_provider_response jsonb default '{}'::jsonb)
returns public.order_fabric_candidates language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_candidate public.order_fabric_candidates%rowtype; v_allocation public.order_fabric_funding_allocations%rowtype; v_transaction_id uuid; v_hash text;
begin
  select * into v_candidate from public.order_fabric_candidates where id=p_candidate_id for update;
  if v_candidate.id is null then raise exception 'FABRIC_CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.provider_status='SUCCEEDED' and upper(p_outcome)='SUCCEEDED' then return v_candidate; end if;
  if v_candidate.status not in ('RELEASE_QUEUED','RELEASE_PROCESSING','RELEASE_BLOCKED') then raise exception 'FABRIC_RELEASE_NOT_READY'; end if;
  if upper(p_outcome)<>'SUCCEEDED' then
    update public.order_fabric_candidates set status='RELEASE_BLOCKED',provider=p_provider,provider_status=case when upper(p_outcome)='AMBIGUOUS' then 'AMBIGUOUS' else 'FAILED' end,provider_reference=p_provider_reference,provider_response=coalesce(p_provider_response,'{}'::jsonb),payout_id=p_payout_id where id=p_candidate_id returning * into v_candidate;
    insert into public.order_fabric_events(order_id,candidate_id,event_type,actor_role,payload,correlation_id) values(v_candidate.order_id,v_candidate.id,'RELEASE_BLOCKED','SYSTEM',jsonb_build_object('provider',p_provider,'providerReference',p_provider_reference,'outcome',p_outcome),v_candidate.correlation_id);
    return v_candidate;
  end if;
  select * into v_allocation from public.order_fabric_funding_allocations where id=v_candidate.allocation_id for update;
  if v_candidate.supplier_cost_amount>v_allocation.funded_amount-v_allocation.released_amount-v_allocation.refunded_amount then raise exception 'FABRIC_ALLOWANCE_BALANCE_CHANGED'; end if;
  v_hash:=encode(digest(concat_ws('|',v_candidate.id::text,v_candidate.supplier_cost_amount::text,v_candidate.currency::text,p_provider_reference),'sha256'),'hex');
  insert into public.commercial_ledger_transactions(idempotency_key,request_hash,transaction_kind,purpose,order_id,policy_version,pricing_version,correlation_id,actor_role,original_currency,original_amount,settlement_currency,settlement_amount,provider_reference,metadata)
  values('fabric-candidate-release:'||v_candidate.id::text,v_hash,'ADJUSTMENT','MATERIAL_ADVANCE',v_candidate.order_id,'fabric-funding-2026-08-21-v2',v_allocation.pricing_version,v_candidate.correlation_id,'SYSTEM',v_candidate.currency,v_candidate.supplier_cost_amount,v_candidate.currency,v_candidate.supplier_cost_amount,p_provider_reference,jsonb_build_object('candidateId',v_candidate.id,'allocationId',v_allocation.id,'payoutId',p_payout_id,'provider',p_provider))
  on conflict(idempotency_key) do nothing returning id into v_transaction_id;
  if v_transaction_id is not null then
    insert into public.commercial_ledger_entries(transaction_id,order_id,account_code,account_scope,direction,amount,currency) values(v_transaction_id,v_candidate.order_id,'MATERIAL_ADVANCE_LIABILITY','order-fabric-allowance','DEBIT',v_candidate.supplier_cost_amount,v_candidate.currency),(v_transaction_id,v_candidate.order_id,'TAILOR_RELEASED','fabric-candidate:'||v_candidate.component_code,'CREDIT',v_candidate.supplier_cost_amount,v_candidate.currency);
    update public.order_fabric_funding_allocations set released_amount=released_amount+v_candidate.supplier_cost_amount,status=case when released_amount+v_candidate.supplier_cost_amount=funded_amount-refunded_amount then 'FULLY_RELEASED' else 'PARTIALLY_RELEASED' end where id=v_allocation.id;
  end if;
  update public.order_fabric_candidates set status='AWAITING_RECEIPT',provider=p_provider,provider_status='SUCCEEDED',provider_reference=p_provider_reference,provider_response=coalesce(p_provider_response,'{}'::jsonb),payout_id=p_payout_id,release_confirmed_at=now() where id=p_candidate_id returning * into v_candidate;
  insert into public.order_fabric_events(order_id,candidate_id,event_type,actor_role,payload,correlation_id) values(v_candidate.order_id,v_candidate.id,'RELEASE_SUCCEEDED','SYSTEM',jsonb_build_object('amount',v_candidate.supplier_cost_amount,'currency',v_candidate.currency,'provider',p_provider,'providerReference',p_provider_reference),v_candidate.correlation_id);
  return v_candidate;
end $$;

create or replace function public.reconcile_fabric_candidate_v2(p_candidate_id uuid,p_tailor_id uuid,p_receipt_storage_path text,p_acquired_media jsonb,p_actual_spend_amount integer)
returns public.order_fabric_candidates language plpgsql security definer set search_path=public,pg_temp as $$
declare v_candidate public.order_fabric_candidates%rowtype; v_outcome text;
begin
  select * into v_candidate from public.order_fabric_candidates where id=p_candidate_id for update;
  if v_candidate.id is null or v_candidate.tailor_id<>p_tailor_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_candidate.provider_status<>'SUCCEEDED' or v_candidate.status<>'AWAITING_RECEIPT' then raise exception 'FABRIC_RELEASE_SUCCESS_REQUIRED'; end if;
  if char_length(btrim(coalesce(p_receipt_storage_path,'')))<3 or p_receipt_storage_path~*'^https?://' then raise exception 'PRIVATE_SUPPLIER_RECEIPT_REQUIRED'; end if;
  if jsonb_typeof(p_acquired_media)<>'array' or jsonb_array_length(p_acquired_media)<1 then raise exception 'ACQUIRED_FABRIC_PROOF_REQUIRED'; end if;
  if p_actual_spend_amount=v_candidate.supplier_cost_amount then v_outcome:='EXACT'; elsif p_actual_spend_amount<v_candidate.supplier_cost_amount then v_outcome:='UNUSED_VALUE'; else v_outcome:='OVERAGE'; end if;
  update public.order_fabric_candidates set receipt_storage_bucket='commercial-evidence',receipt_storage_path=p_receipt_storage_path,acquired_media=p_acquired_media,actual_spend_amount=p_actual_spend_amount,reconciliation_status=v_outcome,status=case when v_outcome='EXACT' then 'RECONCILED' else 'EXCEPTION' end,reconciled_at=case when v_outcome='EXACT' then now() else null end where id=p_candidate_id returning * into v_candidate;
  insert into public.order_fabric_events(order_id,candidate_id,event_type,actor_id,actor_role,payload,correlation_id) values(v_candidate.order_id,v_candidate.id,case when v_outcome='EXACT' then 'RECONCILIATION_EXACT' else 'RECONCILIATION_EXCEPTION' end,p_tailor_id::text,'TAILOR',jsonb_build_object('actualSpendAmount',p_actual_spend_amount,'approvedAmount',v_candidate.supplier_cost_amount,'outcome',v_outcome),v_candidate.correlation_id);
  if v_outcome='EXACT' and not exists(select 1 from public.order_fabric_candidates c where c.order_id=v_candidate.order_id and c.id<>v_candidate.id and c.status not in ('RECONCILED','DECLINED','SUPERSEDED')) then update public.order_fabric_funding_allocations set reconciled_spend_amount=(select coalesce(sum(actual_spend_amount),0) from public.order_fabric_candidates where order_id=v_candidate.order_id and status='RECONCILED'),status='RECONCILED',reconciled_at=now() where id=v_candidate.allocation_id; end if;
  return v_candidate;
end $$;

create or replace function public.save_fabric_handoff_v2(
  p_order_id text,p_actor_id uuid,p_mode text,p_status text,p_carrier text default null,
  p_tracking_number text default null,p_tracking_url text default null,p_scheduled_at timestamptz default null,
  p_timezone text default null,p_handoff_location text default null
) returns public.order_fabric_handoffs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.orders%rowtype; v_handoff public.order_fabric_handoffs%rowtype; v_actor_role text;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.fabric_funding_policy_version<>'fabric-funding-2026-08-21-v2' or v_order.fabric_source::text<>'CUSTOMER_SUPPLIES' then raise exception 'CUSTOMER_SUPPLIED_FABRIC_V2_REQUIRED'; end if;
  if v_order.customer_id::text=p_actor_id::text then v_actor_role:='CUSTOMER'; elsif v_order.tailor_id::text=p_actor_id::text then v_actor_role:='TAILOR'; else raise exception 'ORDER_FORBIDDEN'; end if;
  if p_mode not in ('CUSTOMER_SHIPS_TO_TAILOR','CUSTOMER_DROPS_OFF_LOCALLY','TAILOR_PICKS_UP_LOCALLY','BRINGS_TO_CONSULTATION') then raise exception 'FABRIC_HANDOFF_MODE_INVALID'; end if;
  if p_status not in ('AWAITING_HANDOFF','SCHEDULED','IN_TRANSIT') then raise exception 'FABRIC_HANDOFF_STATUS_INVALID'; end if;
  insert into public.order_fabric_handoffs(order_id,customer_id,tailor_id,mode,status,carrier,tracking_number,tracking_url,scheduled_at,timezone,handoff_location)
  values(p_order_id,v_order.customer_id::text,v_order.tailor_id::text,p_mode,p_status,nullif(btrim(coalesce(p_carrier,'')),''),nullif(btrim(coalesce(p_tracking_number,'')),''),nullif(btrim(coalesce(p_tracking_url,'')),''),p_scheduled_at,nullif(btrim(coalesce(p_timezone,'')),''),nullif(btrim(coalesce(p_handoff_location,'')),''))
  on conflict(order_id) do update set mode=excluded.mode,status=excluded.status,carrier=excluded.carrier,tracking_number=excluded.tracking_number,tracking_url=excluded.tracking_url,scheduled_at=excluded.scheduled_at,timezone=excluded.timezone,handoff_location=excluded.handoff_location,updated_at=now()
  returning * into v_handoff;
  insert into public.order_fabric_events(order_id,handoff_id,event_type,actor_id,actor_role,payload,correlation_id) values(p_order_id,v_handoff.id,'HANDOFF_'||p_status,p_actor_id::text,v_actor_role,jsonb_build_object('mode',p_mode,'carrier',p_carrier,'trackingNumber',p_tracking_number,'scheduledAt',p_scheduled_at,'timezone',p_timezone),v_handoff.correlation_id);
  return v_handoff;
end $$;

create or replace function public.confirm_fabric_handoff_receipt_v2(
  p_order_id text,p_tailor_id uuid,p_outcome text,p_received_media jsonb,p_note text
) returns public.order_fabric_handoffs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_handoff public.order_fabric_handoffs%rowtype;
begin
  select * into v_handoff from public.order_fabric_handoffs where order_id=p_order_id for update;
  if v_handoff.id is null then raise exception 'FABRIC_HANDOFF_NOT_FOUND'; end if;
  if v_handoff.tailor_id<>p_tailor_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if p_outcome not in ('RECEIVED_SUITABLE','RECEIVED_WITH_ISSUE') then raise exception 'FABRIC_RECEIPT_OUTCOME_INVALID'; end if;
  if jsonb_typeof(p_received_media)<>'array' or jsonb_array_length(p_received_media)<1 then raise exception 'FRESH_FABRIC_RECEIPT_MEDIA_REQUIRED'; end if;
  if p_outcome='RECEIVED_WITH_ISSUE' and char_length(btrim(coalesce(p_note,'')))<8 then raise exception 'FABRIC_ISSUE_NOTE_REQUIRED'; end if;
  update public.order_fabric_handoffs set status=p_outcome,received_media=p_received_media,suitability_note=case when p_outcome='RECEIVED_SUITABLE' then nullif(btrim(coalesce(p_note,'')),'') else null end,issue_note=case when p_outcome='RECEIVED_WITH_ISSUE' then btrim(p_note) else null end,received_at=now(),updated_at=now() where id=v_handoff.id returning * into v_handoff;
  insert into public.order_fabric_events(order_id,handoff_id,event_type,actor_id,actor_role,payload,correlation_id) values(p_order_id,v_handoff.id,p_outcome,p_tailor_id::text,'TAILOR',jsonb_build_object('note',p_note),v_handoff.correlation_id);
  return v_handoff;
end $$;

create or replace function public.resolve_fabric_handoff_issue_v2(
  p_order_id text,p_customer_id uuid,p_outcome text,p_note text default null
) returns public.order_fabric_handoffs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_handoff public.order_fabric_handoffs%rowtype;
begin
  select * into v_handoff from public.order_fabric_handoffs where order_id=p_order_id for update;
  if v_handoff.id is null or v_handoff.customer_id<>p_customer_id::text then raise exception 'ORDER_FORBIDDEN'; end if;
  if v_handoff.status not in ('RECEIVED_WITH_ISSUE','REPLACEMENT_REQUIRED','TAILOR_REPLACEMENT_PROPOSED') then raise exception 'FABRIC_ISSUE_NOT_OPEN'; end if;
  if p_outcome not in ('CUSTOMER_PROVIDES_REPLACEMENT','TAILOR_SOURCES_REPLACEMENT','CONTINUE_WITH_CURRENT_FABRIC') then raise exception 'FABRIC_ISSUE_OUTCOME_INVALID'; end if;
  update public.order_fabric_handoffs set issue_outcome=p_outcome,status=case when p_outcome='CUSTOMER_PROVIDES_REPLACEMENT' then 'REPLACEMENT_REQUIRED' when p_outcome='TAILOR_SOURCES_REPLACEMENT' then 'TAILOR_REPLACEMENT_PROPOSED' else 'CONTINUE_AUTHORIZED' end,resolved_at=case when p_outcome='CONTINUE_WITH_CURRENT_FABRIC' then now() else null end,updated_at=now() where id=v_handoff.id returning * into v_handoff;
  insert into public.order_fabric_events(order_id,handoff_id,event_type,actor_id,actor_role,payload,correlation_id) values(p_order_id,v_handoff.id,'HANDOFF_ISSUE_DECIDED',p_customer_id::text,'CUSTOMER',jsonb_build_object('outcome',p_outcome,'note',p_note),v_handoff.correlation_id);
  return v_handoff;
end $$;

create or replace function public.get_order_fabric_cutting_blockers_v2(p_order_id text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_candidate public.order_fabric_candidates%rowtype;
  v_handoff public.order_fabric_handoffs%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_component text;
  v_support jsonb := '{}'::jsonb;
  v_measurements jsonb := '{}'::jsonb;
  v_components jsonb := '[]'::jsonb;
begin
  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null then return jsonb_build_array(jsonb_build_object('code','ORDER_NOT_FOUND','message','Order not found.','recoveryAction','OPEN_ORDER')); end if;
  if v_order.fabric_funding_policy_version<>'fabric-funding-2026-08-21-v2' then return '[]'::jsonb; end if;
  v_measurements:=coalesce(v_order.customer_measurements_snapshot,'{}'::jsonb);
  begin
    if nullif(btrim(coalesce(v_order.special_note,'')),'') is not null then v_support:=v_order.special_note::jsonb; end if;
  exception when others then
    v_support:='{}'::jsonb;
  end;
  if coalesce((v_measurements->>'needsConfirmation')::boolean,false) then
    return jsonb_build_array(jsonb_build_object('code','MEASUREMENTS_NOT_READY','message','The requested measurement confirmation must be completed before cutting.','recoveryAction','REVIEW_MEASUREMENTS'));
  end if;
  if coalesce((v_support#>>'{styleAlignment,requiredBeforeCutting}')::boolean,false)
    and coalesce(v_support#>>'{styleAlignment,status}','')<>'APPROVED' then
    return jsonb_build_array(jsonb_build_object('code','STYLE_NOT_APPROVED','message','The style interpretation must be approved before cutting.','recoveryAction','REVIEW_STYLE'));
  end if;
  if v_order.fabric_source::text='CUSTOMER_SUPPLIES' then
    select * into v_handoff from public.order_fabric_handoffs where order_id=p_order_id;
    if v_handoff.id is null then return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_HANDOFF_REQUIRED','message','Arrange how the customer fabric will reach the tailor.','recoveryAction','ARRANGE_FABRIC_HANDOFF')); end if;
    if v_handoff.status='TAILOR_REPLACEMENT_PROPOSED' and v_handoff.issue_outcome='TAILOR_SOURCES_REPLACEMENT' then
      v_components:='["FABRIC"]'::jsonb;
    elsif v_handoff.status in ('RECEIVED_WITH_ISSUE','REPLACEMENT_REQUIRED') then return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_ISSUE_UNRESOLVED','message','Resolve the reported fabric issue before cutting.','recoveryAction','RESOLVE_FABRIC_ISSUE'));
    else
      if v_handoff.status not in ('RECEIVED_SUITABLE','CONTINUE_AUTHORIZED') then return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_RECEIPT_REQUIRED','message','Confirm that the customer fabric was received and suitable.','recoveryAction','CONFIRM_FABRIC_RECEIPT')); end if;
      if jsonb_array_length(v_handoff.received_media)=0 then return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED','message','Upload fresh proof of the received customer fabric.','recoveryAction','CONFIRM_FABRIC_RECEIPT')); end if;
      return '[]'::jsonb;
    end if;
  end if;
  select * into v_allocation from public.order_fabric_funding_allocations where order_id=p_order_id;
  if v_allocation.id is null then return jsonb_build_array(jsonb_build_object('code','FABRIC_CANDIDATE_REQUIRED','message','The protected material allocation is not ready.','recoveryAction','SUBMIT_FABRIC_CANDIDATE')); end if;
  if jsonb_array_length(v_components)=0 then v_components:=v_allocation.coverage; end if;
  for v_component in select jsonb_array_elements_text(v_components) loop
    v_candidate:=null;
    select * into v_candidate from public.order_fabric_candidates
      where order_id=p_order_id and component_code=v_component and status not in ('DECLINED','SUPERSEDED')
      order by candidate_version desc limit 1;
    if v_candidate.id is null or v_candidate.status in ('DRAFT','CHANGES_REQUESTED') then return jsonb_build_array(jsonb_build_object('code','FABRIC_CANDIDATE_REQUIRED','componentCode',v_component,'message','Submit the exact '||lower(replace(v_component,'_',' '))||' and supplier cost for customer review.','recoveryAction','SUBMIT_FABRIC_CANDIDATE')); end if;
    if v_candidate.status='AWAITING_CUSTOMER_DECISION' then return jsonb_build_array(jsonb_build_object('code','FABRIC_CUSTOMER_APPROVAL_REQUIRED','componentCode',v_component,'message','The customer must approve the exact '||lower(replace(v_component,'_',' '))||' and authorize its cost.','recoveryAction','OPEN_FABRIC_DECISION')); end if;
    if v_candidate.status='AWAITING_SHORTFALL_PAYMENT' then return jsonb_build_array(jsonb_build_object('code','FABRIC_SHORTFALL_PAYMENT_REQUIRED','componentCode',v_component,'message','Pay the disclosed '||lower(replace(v_component,'_',' '))||' shortfall before funds can be released.','recoveryAction','PAY_FABRIC_SHORTFALL')); end if;
    if v_candidate.provider_status is distinct from 'SUCCEEDED' then return jsonb_build_array(jsonb_build_object('code','FABRIC_RELEASE_NOT_SUCCESSFUL','componentCode',v_component,'message','The '||lower(replace(v_component,'_',' '))||' release must reach a terminal successful outcome.','recoveryAction','RETRY_OR_REVIEW_RELEASE')); end if;
    if v_candidate.receipt_storage_path is null then return jsonb_build_array(jsonb_build_object('code','FABRIC_RECEIPT_REQUIRED','componentCode',v_component,'message','Upload the final supplier receipt for '||lower(replace(v_component,'_',' '))||'.','recoveryAction','UPLOAD_RECEIPT')); end if;
    if jsonb_array_length(v_candidate.acquired_media)=0 then return jsonb_build_array(jsonb_build_object('code','ACQUIRED_FABRIC_PROOF_REQUIRED','componentCode',v_component,'message','Upload fresh proof of the acquired '||lower(replace(v_component,'_',' '))||'.','recoveryAction','UPLOAD_ACQUIRED_FABRIC_PROOF')); end if;
    if v_candidate.reconciliation_status not in ('EXACT','RESOLVED') then return jsonb_build_array(jsonb_build_object('code','FABRIC_RECONCILIATION_REQUIRED','componentCode',v_component,'message','Finish '||lower(replace(v_component,'_',' '))||' reconciliation before cutting.','recoveryAction','RESOLVE_RECONCILIATION')); end if;
  end loop;
  return '[]'::jsonb;
end $$;

create or replace function public.guard_funded_fabric_cutting() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_blockers jsonb;
begin
  if new.stage::text='CUTTING' and old.stage::text is distinct from 'CUTTING' then
    if new.fabric_funding_policy_version='fabric-funding-2026-08-21-v2' then
      v_blockers:=public.get_order_fabric_cutting_blockers_v2(new.id::text);
      if jsonb_array_length(v_blockers)>0 then raise exception 'FABRIC_CUTTING_BLOCKED:%',v_blockers::text; end if;
    elsif new.fabric_funding_policy_version='fabric-funding-2026-08-01-v1' and new.fabric_source is not distinct from 'TAILOR_SOURCES'::public.fabric_source and not exists(select 1 from public.order_material_advances a where a.order_id=new.id and a.funding_source='FUNDED_FABRIC_ALLOWANCE' and a.release_status='RELEASED' and a.provider_release_status='SUCCEEDED' and a.acquired_storage_bucket='commercial-evidence' and a.acquired_storage_path is not null and a.reconciliation_status in ('EXACT','RESOLVED')) then
      raise exception 'FABRIC_ACQUIRED_AND_RECONCILED_REQUIRED';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.submit_fabric_candidate_v2(text,uuid,text,integer,currency,text,jsonb,text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.decide_fabric_candidate_v2(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.mark_fabric_candidate_shortfall_paid_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_fabric_candidate_release_outcome_v2(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.reconcile_fabric_candidate_v2(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.save_fabric_handoff_v2(text,uuid,text,text,text,text,text,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.confirm_fabric_handoff_receipt_v2(text,uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.resolve_fabric_handoff_issue_v2(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_fabric_candidate_v2(text,uuid,text,integer,currency,text,jsonb,text,text,text,text,uuid,text) to service_role;
grant execute on function public.decide_fabric_candidate_v2(uuid,uuid,text,text,text) to service_role;
grant execute on function public.mark_fabric_candidate_shortfall_paid_v2(uuid,uuid) to service_role;
grant execute on function public.record_fabric_candidate_release_outcome_v2(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.reconcile_fabric_candidate_v2(uuid,uuid,text,jsonb,integer) to service_role;
grant execute on function public.save_fabric_handoff_v2(text,uuid,text,text,text,text,text,timestamptz,text,text) to service_role;
grant execute on function public.confirm_fabric_handoff_receipt_v2(text,uuid,text,jsonb,text) to service_role;
grant execute on function public.resolve_fabric_handoff_issue_v2(text,uuid,text,text) to service_role;
grant execute on function public.get_order_fabric_cutting_blockers_v2(text) to service_role;

comment on table public.order_fabric_candidates is 'Immutable v2 exact material candidate, customer authorization, provider release, and reconciliation record.';
comment on table public.order_fabric_handoffs is 'Customer-supplied fabric custody and suitability state; never creates funding by itself.';
comment on function public.get_order_fabric_cutting_blockers_v2 is 'Returns the first actionable fabric blocker so every client can show a precise recovery path.';
