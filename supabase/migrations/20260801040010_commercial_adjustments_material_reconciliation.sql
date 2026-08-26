-- Implementation 7: normalized post-acceptance amendments and material-value
-- reconciliation. Original accepted terms remain on the order/receipt; changes
-- are append-only proposals plus decisions.

create table if not exists public.commercial_adjustments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('ADJ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  idempotency_key text not null unique,
  request_hash text not null,
  order_id text not null references public.orders(id) on delete restrict,
  customer_id text not null,
  tailor_id text,
  financial_case_id uuid unique references public.financial_cases(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in (
    'SCOPE', 'MATERIAL', 'RUSH_WORK', 'FIT_REVISION', 'FULFILLMENT',
    'CUSTOMS', 'CORRECTION', 'DEADLINE_EXTENSION', 'OTHER_REVIEWED'
  )),
  status text not null default 'PROPOSED' check (status in (
    'PROPOSED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'PAYMENT_PENDING',
    'PAID', 'OPS_REVIEW', 'COMPLETED'
  )),
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_by_role text not null check (proposed_by_role in ('CUSTOMER', 'TAILOR', 'OPS')),
  counterparty_id uuid references auth.users(id) on delete set null,
  summary text not null check (char_length(summary) between 10 and 500),
  reason text not null check (char_length(reason) between 10 and 1000),
  responsibility text not null check (responsibility in ('CUSTOMER', 'TAILOR', 'DRAPEON', 'SHARED', 'UNRESOLVED')),
  amount_delta integer not null default 0,
  currency currency not null,
  original_deadline timestamptz,
  proposed_deadline timestamptz,
  evidence_ids uuid[] not null default '{}'::uuid[],
  requires_payment boolean not null default false,
  payment_id uuid unique references public.order_payments(id) on delete restrict,
  policy_version text not null,
  adjustment_version integer not null default 1 check (adjustment_version = 1),
  correlation_id uuid not null default gen_random_uuid(),
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (adjustment_type <> 'DEADLINE_EXTENSION' or proposed_deadline is not null),
  check (not (responsibility = 'TAILOR' and amount_delta > 0)),
  check (requires_payment = (amount_delta > 0 and responsibility = 'CUSTOMER'))
);

create unique index if not exists commercial_adjustments_one_open_idx
  on public.commercial_adjustments(order_id)
  where status in ('PROPOSED', 'PAYMENT_PENDING', 'OPS_REVIEW');
create index if not exists commercial_adjustments_order_created_idx
  on public.commercial_adjustments(order_id, created_at desc);
create index if not exists commercial_adjustments_status_created_idx
  on public.commercial_adjustments(status, created_at desc);

create table if not exists public.commercial_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.commercial_adjustments(id) on delete restrict,
  event_type text not null check (event_type in (
    'PROPOSED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'PAYMENT_PREPARED',
    'PAYMENT_CONFIRMED', 'OPS_REVIEW_REQUESTED', 'COMPLETED', 'NOTE_ADDED'
  )),
  actor_id uuid,
  actor_role text not null check (actor_role in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM')),
  visibility text not null default 'PARTIES' check (visibility in ('PARTIES', 'OPS_ONLY')),
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists commercial_adjustment_events_created_idx
  on public.commercial_adjustment_events(adjustment_id, created_at);

create or replace function public.prevent_commercial_adjustment_event_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Commercial adjustment events are append-only.';
end;
$$;

drop trigger if exists commercial_adjustment_events_append_only on public.commercial_adjustment_events;
create trigger commercial_adjustment_events_append_only
  before update or delete on public.commercial_adjustment_events
  for each row execute function public.prevent_commercial_adjustment_event_mutation();

create or replace function public.protect_commercial_adjustment_claim()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.order_id is distinct from old.order_id
    or new.customer_id is distinct from old.customer_id
    or new.tailor_id is distinct from old.tailor_id
    or new.financial_case_id is distinct from old.financial_case_id
    or new.adjustment_type is distinct from old.adjustment_type
    or new.proposed_by is distinct from old.proposed_by
    or new.proposed_by_role is distinct from old.proposed_by_role
    or new.counterparty_id is distinct from old.counterparty_id
    or new.summary is distinct from old.summary
    or new.reason is distinct from old.reason
    or new.responsibility is distinct from old.responsibility
    or new.amount_delta is distinct from old.amount_delta
    or new.currency is distinct from old.currency
    or new.original_deadline is distinct from old.original_deadline
    or new.proposed_deadline is distinct from old.proposed_deadline
    or new.evidence_ids is distinct from old.evidence_ids
    or new.requires_payment is distinct from old.requires_payment
    or new.policy_version is distinct from old.policy_version
    or new.adjustment_version is distinct from old.adjustment_version
    or new.correlation_id is distinct from old.correlation_id
    or new.proposed_at is distinct from old.proposed_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Commercial adjustment claims are immutable; append a decision or event.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists commercial_adjustment_claim_immutable on public.commercial_adjustments;
create trigger commercial_adjustment_claim_immutable
  before update on public.commercial_adjustments
  for each row execute function public.protect_commercial_adjustment_claim();

alter table public.order_material_advances
  add column if not exists estimate_storage_bucket text,
  add column if not exists estimate_storage_path text,
  add column if not exists receipt_storage_bucket text,
  add column if not exists receipt_storage_path text,
  add column if not exists actual_spent_amount integer check (actual_spent_amount is null or actual_spent_amount >= 0),
  add column if not exists reconciliation_status text not null default 'PENDING' check (
    reconciliation_status in ('PENDING', 'EXACT', 'UNUSED_VALUE', 'OVERAGE', 'OPS_REVIEW', 'RESOLVED')
  ),
  add column if not exists reconciliation_delta integer,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_case_id uuid references public.financial_cases(id) on delete restrict,
  add column if not exists reconciliation_correlation_id uuid;

create or replace function public.create_commercial_adjustment(
  p_idempotency_key text,
  p_order_id text,
  p_actor_id uuid,
  p_actor_role text,
  p_adjustment_type text,
  p_summary text,
  p_reason text,
  p_responsibility text,
  p_amount_delta integer,
  p_currency currency,
  p_proposed_deadline timestamptz default null,
  p_evidence_ids uuid[] default '{}'::uuid[],
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_row public.commercial_adjustments%rowtype;
  v_case public.financial_cases%rowtype;
  v_hash text;
  v_existing_hash text;
  v_counterparty uuid;
  v_requires_payment boolean;
  v_case_type text;
begin
  if nullif(trim(p_idempotency_key), '') is null then raise exception 'Adjustment idempotency key is required.'; end if;
  if p_actor_role not in ('CUSTOMER', 'TAILOR', 'OPS') then raise exception 'Invalid adjustment actor role.'; end if;
  if p_adjustment_type not in ('SCOPE','MATERIAL','RUSH_WORK','FIT_REVISION','FULFILLMENT','CUSTOMS','CORRECTION','DEADLINE_EXTENSION','OTHER_REVIEWED') then raise exception 'Invalid adjustment type.'; end if;
  if p_responsibility not in ('CUSTOMER','TAILOR','DRAPEON','SHARED','UNRESOLVED') then raise exception 'Invalid responsibility.'; end if;
  if char_length(trim(coalesce(p_summary, ''))) not between 10 and 500 then raise exception 'Adjustment summary must be 10 to 500 characters.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 10 and 1000 then raise exception 'Adjustment reason must be 10 to 1000 characters.'; end if;
  if p_adjustment_type = 'DEADLINE_EXTENSION' and p_proposed_deadline is null then raise exception 'Deadline extension requires a proposed deadline.'; end if;
  if p_responsibility = 'TAILOR' and p_amount_delta > 0 then raise exception 'Tailor-caused correction cannot charge the customer.'; end if;

  v_hash := encode(digest(concat_ws('|', p_order_id, p_actor_id::text, p_actor_role,
    p_adjustment_type, trim(p_summary), trim(p_reason), p_responsibility,
    p_amount_delta::text, p_currency::text, coalesce(p_proposed_deadline::text, ''),
    coalesce(p_evidence_ids::text, '{}')), 'sha256'), 'hex');
  select request_hash into v_existing_hash from public.commercial_adjustments where idempotency_key = p_idempotency_key;
  if v_existing_hash is not null then
    if v_existing_hash <> v_hash then raise exception 'Adjustment idempotency key was reused with different values.'; end if;
    select * into v_row from public.commercial_adjustments where idempotency_key = p_idempotency_key;
    return jsonb_build_object('adjustmentId', v_row.id, 'reference', v_row.reference, 'status', v_row.status, 'correlationId', v_row.correlation_id, 'duplicate', true);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;
  if v_order.commercial_policy_version <> 'commercial-2026-07-31-v1' then raise exception 'This order uses a legacy commercial policy.'; end if;
  if v_order.stage::text not in ('CONFIRMED','DESIGNING','SOURCING','CUTTING','SEWING','FINISHING','READY_FOR_COLLECTION','READY_FOR_DRAPE_DISPATCH','OUT_FOR_DELIVERY','SHIPPED') then raise exception 'This order cannot open an adjustment from its current stage.'; end if;
  if p_actor_role = 'CUSTOMER' and v_order.customer_id::text <> p_actor_id::text then raise exception 'Only the order customer can propose this adjustment.'; end if;
  if p_actor_role = 'TAILOR' and v_order.tailor_id::text <> p_actor_id::text then raise exception 'Only the assigned tailor can propose this adjustment.'; end if;
  if exists (select 1 from public.commercial_adjustments where order_id = p_order_id and status in ('PROPOSED','PAYMENT_PENDING','OPS_REVIEW')) then raise exception 'An adjustment is already open for this order.'; end if;
  if p_adjustment_type = 'DEADLINE_EXTENSION' and v_order.deadline is not null and p_proposed_deadline <= v_order.deadline then raise exception 'An extension must move the deadline later.'; end if;

  v_counterparty := case when p_actor_role = 'CUSTOMER' then v_order.tailor_id::uuid else v_order.customer_id::uuid end;
  v_requires_payment := p_amount_delta > 0 and p_responsibility = 'CUSTOMER';
  v_case_type := case when p_adjustment_type in ('FULFILLMENT','CUSTOMS') then 'FULFILLMENT_RECONCILIATION' else 'TIMELINE_AMENDMENT' end;

  insert into public.financial_cases (
    idempotency_key, request_hash, order_id, case_type, status, opened_by, opened_by_role,
    counterparty_id, reason_code, summary, claim_details, requested_outcome,
    requested_amount, requested_currency, money_movement_blocked, policy_version,
    correlation_id, counterparty_response_requested_at
  ) values (
    'adjustment-case:' || p_idempotency_key, v_hash, p_order_id, v_case_type, 'COUNTERPARTY_REVIEW',
    p_actor_id, p_actor_role, v_counterparty, p_adjustment_type, trim(p_summary),
    jsonb_build_object('reason', trim(p_reason), 'responsibility', p_responsibility,
      'amountDelta', p_amount_delta, 'originalDeadline', v_order.deadline,
      'proposedDeadline', p_proposed_deadline, 'fromStage', v_order.stage),
    'OPS_HELP', case when p_amount_delta > 0 then p_amount_delta else null end,
    case when p_amount_delta > 0 then p_currency else null end, v_requires_payment,
    v_order.commercial_policy_version, p_correlation_id, now()
  ) returning * into v_case;

  insert into public.commercial_adjustments (
    idempotency_key, request_hash, order_id, customer_id, tailor_id, financial_case_id,
    adjustment_type, proposed_by, proposed_by_role, counterparty_id, summary, reason,
    responsibility, amount_delta, currency, original_deadline, proposed_deadline,
    evidence_ids, requires_payment, policy_version, correlation_id
  ) values (
    p_idempotency_key, v_hash, p_order_id, v_order.customer_id::text, v_order.tailor_id::text,
    v_case.id, p_adjustment_type, p_actor_id, p_actor_role, v_counterparty,
    trim(p_summary), trim(p_reason), p_responsibility, p_amount_delta, p_currency,
    v_order.deadline, p_proposed_deadline, coalesce(p_evidence_ids, '{}'::uuid[]),
    v_requires_payment, v_order.commercial_policy_version, p_correlation_id
  ) returning * into v_row;

  insert into public.commercial_adjustment_events(adjustment_id,event_type,actor_id,actor_role,payload,correlation_id)
  values (v_row.id,'PROPOSED',p_actor_id,p_actor_role,
    jsonb_build_object('type',p_adjustment_type,'amountDelta',p_amount_delta,'currency',p_currency,
      'proposedDeadline',p_proposed_deadline,'responsibility',p_responsibility),p_correlation_id);
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
  values (v_case.id,'CASE_OPENED',p_actor_id,p_actor_role,
    jsonb_build_object('adjustmentId',v_row.id,'adjustmentType',p_adjustment_type),p_correlation_id);

  return jsonb_build_object('adjustmentId',v_row.id,'reference',v_row.reference,'caseId',v_case.id,
    'caseReference',v_case.reference,'status',v_row.status,'correlationId',v_row.correlation_id,'duplicate',false);
end;
$$;

create or replace function public.respond_commercial_adjustment(
  p_adjustment_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_decision text,
  p_note text default null
)
returns public.commercial_adjustments
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.commercial_adjustments%rowtype;
  v_next_status text;
begin
  if p_decision not in ('ACCEPTED','DECLINED','CANCELLED') then raise exception 'Invalid adjustment decision.'; end if;
  select * into v_row from public.commercial_adjustments where id = p_adjustment_id for update;
  if v_row.id is null then raise exception 'Adjustment was not found.'; end if;
  if v_row.status <> 'PROPOSED' then raise exception 'Adjustment is no longer awaiting a decision.'; end if;
  if p_decision = 'CANCELLED' then
    if v_row.proposed_by::text <> p_actor_id::text then raise exception 'Only the proposer can cancel this adjustment.'; end if;
  elsif v_row.counterparty_id::text <> p_actor_id::text then
    raise exception 'Only the counterpart can decide this adjustment.';
  end if;
  if p_actor_role not in ('CUSTOMER','TAILOR','OPS') then raise exception 'Invalid adjustment actor role.'; end if;

  v_next_status := case when p_decision = 'ACCEPTED' and v_row.requires_payment then 'PAYMENT_PENDING' else p_decision end;
  update public.commercial_adjustments
  set status = v_next_status, decided_at = now(), decided_by = p_actor_id
  where id = v_row.id returning * into v_row;

  if p_decision = 'ACCEPTED' and v_row.proposed_deadline is not null then
    update public.orders set deadline = v_row.proposed_deadline where id = v_row.order_id;
  end if;

  insert into public.commercial_adjustment_events(adjustment_id,event_type,actor_id,actor_role,payload,correlation_id)
  values (v_row.id,p_decision,p_actor_id,p_actor_role,
    jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'nextStatus',v_next_status),v_row.correlation_id);
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
  values (v_row.financial_case_id,'COUNTERPARTY_RESPONSE_ADDED',p_actor_id,p_actor_role,
    jsonb_build_object('decision',p_decision,'note',nullif(trim(coalesce(p_note,'')),'')),v_row.correlation_id);

  update public.financial_cases
  set status = case when v_next_status = 'PAYMENT_PENDING' then 'OPS_REVIEW' else 'RESOLVED' end,
      counterparty_responded_at = now(),
      resolved_at = case when v_next_status = 'PAYMENT_PENDING' then null else now() end,
      resolved_by = case when v_next_status = 'PAYMENT_PENDING' then null else p_actor_id end,
      resolution_code = case when v_next_status = 'PAYMENT_PENDING' then null else p_decision end,
      resolution_summary = case when v_next_status = 'PAYMENT_PENDING' then null else coalesce(nullif(trim(coalesce(p_note,'')),''), p_decision) end,
      money_movement_blocked = v_next_status = 'PAYMENT_PENDING'
  where id = v_row.financial_case_id;

  return v_row;
end;
$$;

create or replace function public.reconcile_material_advance(
  p_advance_id uuid,
  p_tailor_id uuid,
  p_actual_spent_amount integer,
  p_receipt_storage_bucket text,
  p_receipt_storage_path text,
  p_receipt_url text default null,
  p_note text default null,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_advance public.order_material_advances%rowtype;
  v_delta integer;
  v_outcome text;
  v_case public.financial_cases%rowtype;
begin
  if p_actual_spent_amount < 0 then raise exception 'Actual material spend cannot be negative.'; end if;
  if nullif(trim(coalesce(p_receipt_storage_bucket,'')),'') is null or nullif(trim(coalesce(p_receipt_storage_path,'')),'') is null then raise exception 'Private receipt storage coordinates are required.'; end if;
  select * into v_advance from public.order_material_advances where id = p_advance_id for update;
  if v_advance.id is null then raise exception 'Material advance was not found.'; end if;
  if v_advance.tailor_id::text <> p_tailor_id::text then raise exception 'Only the assigned tailor can reconcile this advance.'; end if;
  if v_advance.release_status <> 'RELEASED' or v_advance.released_at is null then raise exception 'Material advance must be released before final reconciliation.'; end if;
  if v_advance.reconciled_at is not null then
    if v_advance.actual_spent_amount <> p_actual_spent_amount or v_advance.receipt_storage_path <> p_receipt_storage_path then raise exception 'Material reconciliation was already submitted with different values.'; end if;
    return jsonb_build_object('advanceId',v_advance.id,'outcome',v_advance.reconciliation_status,'deltaAmount',v_advance.reconciliation_delta,'duplicate',true);
  end if;

  v_delta := p_actual_spent_amount - v_advance.amount;
  v_outcome := case when v_delta = 0 then 'EXACT' when v_delta < 0 then 'UNUSED_VALUE' else 'OVERAGE' end;
  update public.order_material_advances
  set receipt_storage_bucket = trim(p_receipt_storage_bucket), receipt_storage_path = trim(p_receipt_storage_path),
      receipt_url = coalesce(nullif(trim(coalesce(p_receipt_url,'')),''), receipt_url),
      receipt_note = nullif(trim(coalesce(p_note,'')),''), receipt_uploaded_at = now(),
      actual_spent_amount = p_actual_spent_amount, reconciliation_delta = v_delta,
      reconciliation_status = case when v_delta = 0 then 'EXACT' else 'OPS_REVIEW' end,
      reconciled_at = now(), reconciliation_correlation_id = p_correlation_id
  where id = v_advance.id;

  if v_delta <> 0 then
    insert into public.financial_cases (
      idempotency_key,request_hash,order_id,case_type,status,opened_by,opened_by_role,
      counterparty_id,reason_code,summary,claim_details,requested_outcome,requested_amount,
      requested_currency,money_movement_blocked,policy_version,correlation_id
    ) values (
      'material-reconciliation:' || v_advance.id::text,
      encode(digest(concat_ws('|',v_advance.id::text,p_actual_spent_amount::text,p_receipt_storage_path),'sha256'),'hex'),
      v_advance.order_id::text,'MATERIAL_REQUEST','OPS_REVIEW',p_tailor_id,'TAILOR',v_advance.customer_id,
      v_outcome,case when v_delta < 0 then 'Material purchase left unused customer-approved value.' else 'Final material receipt exceeds the customer-approved advance.' end,
      jsonb_build_object('advanceId',v_advance.id,'approvedAmount',v_advance.amount,'actualAmount',p_actual_spent_amount,'deltaAmount',v_delta,'receiptPath',p_receipt_storage_path),
      'OPS_HELP',abs(v_delta),v_advance.currency,true,'commercial-2026-07-31-v1',p_correlation_id
    ) returning * into v_case;
    update public.order_material_advances set reconciliation_case_id = v_case.id where id = v_advance.id;
    insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
    values (v_case.id,'CASE_OPENED',p_tailor_id,'TAILOR',jsonb_build_object('outcome',v_outcome,'deltaAmount',v_delta),p_correlation_id);
  end if;

  return jsonb_build_object('advanceId',v_advance.id,'outcome',v_outcome,'deltaAmount',v_delta,'caseId',v_case.id,'duplicate',false);
end;
$$;

create or replace function public.record_material_advance_release_ledger(
  p_advance_id uuid,
  p_provider_reference text,
  p_actor_id uuid default null,
  p_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_advance public.order_material_advances%rowtype;
  v_transaction_id uuid;
  v_hash text;
begin
  select * into v_advance from public.order_material_advances where id = p_advance_id for update;
  if v_advance.id is null then raise exception 'Material advance was not found.'; end if;
  if v_advance.release_status <> 'RELEASED' or v_advance.released_at is null then raise exception 'Material advance release is not provider-confirmed.'; end if;
  if v_advance.payment_id is null then raise exception 'Material advance payment record is missing.'; end if;
  v_hash := encode(digest(concat_ws('|',v_advance.id::text,v_advance.amount::text,v_advance.currency::text,coalesce(p_provider_reference,'')),'sha256'),'hex');

  select id into v_transaction_id from public.commercial_ledger_transactions
  where idempotency_key = 'material-release:' || v_advance.id::text;
  if v_transaction_id is not null then return v_transaction_id; end if;

  insert into public.commercial_ledger_transactions(
    idempotency_key,request_hash,transaction_kind,purpose,order_id,payment_id,
    policy_version,pricing_version,correlation_id,actor_id,actor_role,
    original_currency,original_amount,settlement_currency,settlement_amount,
    provider_reference,metadata
  ) values (
    'material-release:' || v_advance.id::text,v_hash,'ADJUSTMENT','MATERIAL_ADVANCE',
    v_advance.order_id::text,v_advance.payment_id,'commercial-2026-07-31-v1',1,
    p_correlation_id,p_actor_id,case when p_actor_id is null then 'SYSTEM' else 'OPS' end,
    v_advance.currency,v_advance.amount,v_advance.currency,v_advance.amount,
    p_provider_reference,jsonb_build_object('advanceId',v_advance.id,'releaseStatus',v_advance.release_status)
  ) returning id into v_transaction_id;

  insert into public.commercial_ledger_entries(transaction_id,order_id,account_code,account_scope,direction,amount,currency)
  values
    (v_transaction_id,v_advance.order_id::text,'MATERIAL_ADVANCE_LIABILITY','order','DEBIT',v_advance.amount,v_advance.currency),
    (v_transaction_id,v_advance.order_id::text,'TAILOR_RELEASED','material-advance','CREDIT',v_advance.amount,v_advance.currency);
  return v_transaction_id;
end;
$$;

alter table public.commercial_adjustments enable row level security;
alter table public.commercial_adjustment_events enable row level security;

drop policy if exists "Order parties read commercial adjustments" on public.commercial_adjustments;
create policy "Order parties read commercial adjustments" on public.commercial_adjustments
  for select to authenticated using (customer_id = auth.uid()::text or tailor_id = auth.uid()::text);
drop policy if exists "Order parties read commercial adjustment events" on public.commercial_adjustment_events;
create policy "Order parties read commercial adjustment events" on public.commercial_adjustment_events
  for select to authenticated using (
    visibility = 'PARTIES' and exists (
      select 1 from public.commercial_adjustments a where a.id = commercial_adjustment_events.adjustment_id
        and (a.customer_id = auth.uid()::text or a.tailor_id = auth.uid()::text)
    )
  );

revoke all on public.commercial_adjustments from anon, authenticated;
revoke all on public.commercial_adjustment_events from anon, authenticated;
grant select on public.commercial_adjustments to authenticated;
grant select on public.commercial_adjustment_events to authenticated;
grant select,insert,update on public.commercial_adjustments to service_role;
grant select,insert on public.commercial_adjustment_events to service_role;
revoke all on function public.create_commercial_adjustment(text,text,uuid,text,text,text,text,text,integer,currency,timestamptz,uuid[],uuid) from public,anon,authenticated;
revoke all on function public.respond_commercial_adjustment(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.reconcile_material_advance(uuid,uuid,integer,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.record_material_advance_release_ledger(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_commercial_adjustment(text,text,uuid,text,text,text,text,text,integer,currency,timestamptz,uuid[],uuid) to service_role;
grant execute on function public.respond_commercial_adjustment(uuid,uuid,text,text,text) to service_role;
grant execute on function public.reconcile_material_advance(uuid,uuid,integer,text,text,text,text,uuid) to service_role;
grant execute on function public.record_material_advance_release_ledger(uuid,text,uuid,uuid) to service_role;

comment on table public.commercial_adjustments is 'Immutable post-acceptance proposal snapshots; decisions and outcomes are appended as events.';
comment on column public.order_material_advances.reconciliation_delta is 'Actual spend minus approved and released advance; negative means unused customer-approved value.';
