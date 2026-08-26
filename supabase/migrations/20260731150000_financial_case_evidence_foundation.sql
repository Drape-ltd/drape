-- Drapeon commercial architecture, implementation 3.
-- Adds typed multi-case records and append-only evidence/event packets while
-- preserving the existing one-concern-per-order disputes contract.

create extension if not exists pgcrypto with schema extensions;

create table public.financial_cases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('FC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  idempotency_key text not null unique,
  request_hash text not null,
  order_id text not null references public.orders(id) on delete restrict,
  legacy_dispute_id text unique references public.disputes(id) on delete restrict,
  case_type text not null check (case_type in (
    'CONSULTATION_ATTENDANCE', 'MATERIAL_REQUEST', 'FULFILLMENT_RECONCILIATION',
    'TIMELINE_AMENDMENT', 'QUALITY_CONCERN', 'RETURN', 'REFUND',
    'PAYMENT_FAILURE', 'PAYOUT_FAILURE', 'SAFETY_FRAUD', 'REVIEWED_EXCEPTION'
  )),
  status text not null default 'SUBMITTED' check (status in (
    'SUBMITTED', 'EVIDENCE_PENDING', 'COUNTERPARTY_REVIEW', 'OPS_REVIEW',
    'RESOLVED', 'CANCELLED'
  )),
  opened_by uuid references auth.users(id) on delete set null,
  opened_by_role text not null check (opened_by_role in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM')),
  counterparty_id uuid references auth.users(id) on delete set null,
  reason_code text not null,
  summary text not null check (char_length(summary) between 10 and 2000),
  claim_details jsonb not null default '{}'::jsonb,
  requested_outcome text check (requested_outcome is null or requested_outcome in (
    'EXPLANATION_OR_UPDATE', 'ALTERATION_OR_FIX', 'REMAKE',
    'PARTIAL_REFUND', 'FULL_REFUND', 'OPS_HELP'
  )),
  requested_amount integer check (requested_amount is null or requested_amount > 0),
  requested_currency currency,
  money_movement_blocked boolean not null default true,
  eligibility_status text not null default 'NOT_EVALUATED' check (eligibility_status in (
    'NOT_EVALUATED', 'ELIGIBLE', 'INELIGIBLE', 'OPS_REVIEW'
  )),
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  policy_version text not null,
  correlation_id uuid not null default gen_random_uuid(),
  first_response_due_at timestamptz not null default (now() + interval '24 hours'),
  resolution_due_at timestamptz not null default (now() + interval '72 hours'),
  counterparty_response_requested_at timestamptz,
  counterparty_responded_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_code text,
  resolution_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((requested_amount is null) = (requested_currency is null)),
  check ((status = 'RESOLVED') = (resolved_at is not null))
);

create table public.financial_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.financial_cases(id) on delete restrict,
  event_type text not null check (event_type in (
    'CASE_OPENED', 'EVIDENCE_ADDED', 'COUNTERPARTY_RESPONSE_ADDED',
    'STATUS_CHANGED', 'ELIGIBILITY_RECORDED', 'OPS_NOTE_ADDED',
    'CASE_RESOLVED', 'CASE_CANCELLED'
  )),
  actor_id uuid,
  actor_role text not null check (actor_role in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM')),
  visibility text not null default 'PARTIES' check (visibility in ('PARTIES', 'OPS_ONLY')),
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.financial_case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.financial_cases(id) on delete restrict,
  evidence_type text not null,
  source text not null check (source in (
    'PLATFORM_ORDER', 'PLATFORM_TIMELINE', 'PLATFORM_MESSAGE', 'PAYMENT_PROVIDER',
    'CALL_PROVIDER', 'FULFILLMENT_PROVIDER', 'USER_UPLOAD', 'EMAIL_INGEST',
    'WHATSAPP_SUMMARY', 'OPS_NOTE'
  )),
  evidence_tier text check (evidence_tier is null or evidence_tier in ('A', 'B', 'C', 'D')),
  verification_status text not null default 'CLAIMED' check (verification_status in (
    'CLAIMED', 'CORROBORATED', 'VERIFIED', 'REJECTED'
  )),
  visibility text not null default 'PARTIES' check (visibility in ('PARTIES', 'OPS_ONLY')),
  storage_bucket text,
  storage_object_path text,
  external_reference text,
  source_table text,
  source_record_id text,
  content_sha256 text,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  submitted_by uuid,
  submitted_by_role text not null check (submitted_by_role in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM')),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    (nullif(storage_bucket, '') is not null and nullif(storage_object_path, '') is not null)
    or nullif(external_reference, '') is not null
    or nullif(source_table, '') is not null
  ),
  check (content_sha256 is null or content_sha256 ~ '^[a-fA-F0-9]{64}$')
);

create index financial_cases_order_created_idx on public.financial_cases(order_id, created_at desc);
create index financial_cases_status_due_idx on public.financial_cases(status, first_response_due_at, resolution_due_at);
create index financial_case_events_case_created_idx on public.financial_case_events(case_id, created_at);
create index financial_case_evidence_case_created_idx on public.financial_case_evidence(case_id, created_at);
create index financial_case_evidence_source_idx on public.financial_case_evidence(source, source_record_id);

create or replace function public.prevent_financial_case_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Financial case evidence and events are append-only.';
end;
$$;

create trigger financial_case_events_append_only
  before update or delete on public.financial_case_events
  for each row execute function public.prevent_financial_case_append_only_mutation();

create trigger financial_case_evidence_append_only
  before update or delete on public.financial_case_evidence
  for each row execute function public.prevent_financial_case_append_only_mutation();

create or replace function public.protect_financial_case_claim()
returns trigger
language plpgsql
as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.order_id is distinct from old.order_id
    or new.legacy_dispute_id is distinct from old.legacy_dispute_id
    or new.case_type is distinct from old.case_type
    or new.opened_by is distinct from old.opened_by
    or new.opened_by_role is distinct from old.opened_by_role
    or new.counterparty_id is distinct from old.counterparty_id
    or new.reason_code is distinct from old.reason_code
    or new.summary is distinct from old.summary
    or new.claim_details is distinct from old.claim_details
    or new.requested_outcome is distinct from old.requested_outcome
    or new.requested_amount is distinct from old.requested_amount
    or new.requested_currency is distinct from old.requested_currency
    or new.policy_version is distinct from old.policy_version
    or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Financial case claims are immutable; append evidence or an event instead.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger financial_case_claim_immutable
  before update on public.financial_cases
  for each row execute function public.protect_financial_case_claim();

alter table public.financial_cases enable row level security;
alter table public.financial_case_events enable row level security;
alter table public.financial_case_evidence enable row level security;

create policy "Order parties read financial cases" on public.financial_cases
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = financial_cases.order_id
        and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
    )
  );

create policy "Order parties read visible financial case events" on public.financial_case_events
  for select to authenticated using (
    visibility = 'PARTIES'
    and exists (
      select 1
      from public.financial_cases fc
      join public.orders o on o.id = fc.order_id
      where fc.id = financial_case_events.case_id
        and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
    )
  );

create policy "Order parties read visible financial case evidence" on public.financial_case_evidence
  for select to authenticated using (
    visibility = 'PARTIES'
    and exists (
      select 1
      from public.financial_cases fc
      join public.orders o on o.id = fc.order_id
      where fc.id = financial_case_evidence.case_id
        and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
    )
  );

revoke all on public.financial_cases from anon, authenticated;
revoke all on public.financial_case_events from anon, authenticated;
revoke all on public.financial_case_evidence from anon, authenticated;
grant select on public.financial_cases to authenticated;
grant select on public.financial_case_events to authenticated;
grant select on public.financial_case_evidence to authenticated;
grant select, insert, update on public.financial_cases to service_role;
grant select, insert on public.financial_case_events to service_role;
grant select, insert on public.financial_case_evidence to service_role;

-- Concern creation is an atomic server operation. Authenticated clients keep
-- read access through the existing policies but cannot bypass the canonical
-- case packet by writing the compatibility table directly.
drop policy if exists "Customer opens dispute" on public.disputes;
revoke insert, update, delete on public.disputes from authenticated;

create or replace function public.create_customer_concern_case(
  p_idempotency_key text,
  p_order_id text,
  p_customer_id uuid,
  p_reason_code text,
  p_description text,
  p_requested_outcome text,
  p_case_type text,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_dispute_id text;
  v_case public.financial_cases%rowtype;
  v_request_hash text;
  v_existing_hash text;
begin
  if nullif(trim(p_idempotency_key), '') is null then raise exception 'Case idempotency key is required.'; end if;
  if p_reason_code not in ('NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'FIT_OR_MEASUREMENT_ISSUE', 'TAILOR_UNRESPONSIVE', 'WRONG_ITEM', 'OFF_PLATFORM_OR_TRUST_ISSUE', 'OTHER') then
    raise exception 'Invalid concern reason.';
  end if;
  if p_requested_outcome not in ('EXPLANATION_OR_UPDATE', 'ALTERATION_OR_FIX', 'REMAKE', 'PARTIAL_REFUND', 'FULL_REFUND', 'OPS_HELP') then
    raise exception 'Invalid requested outcome.';
  end if;
  if p_case_type not in ('FULFILLMENT_RECONCILIATION', 'QUALITY_CONCERN', 'SAFETY_FRAUD') then
    raise exception 'Invalid concern case type.';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 10 and 2000 then
    raise exception 'Concern description must be 10 to 2000 characters.';
  end if;

  v_request_hash := encode(digest(concat_ws('|', p_order_id::text, p_customer_id::text,
    p_reason_code, trim(p_description), p_requested_outcome, p_case_type), 'sha256'), 'hex');

  select request_hash into v_existing_hash
  from public.financial_cases
  where idempotency_key = p_idempotency_key;
  if v_existing_hash is not null then
    if v_existing_hash <> v_request_hash then raise exception 'Case idempotency key was reused with different values.'; end if;
    select * into v_case from public.financial_cases where idempotency_key = p_idempotency_key;
    return jsonb_build_object('caseId', v_case.id, 'caseReference', v_case.reference,
      'legacyDisputeId', v_case.legacy_dispute_id, 'status', v_case.status,
      'correlationId', v_case.correlation_id, 'duplicate', true);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;
  if v_order.customer_id::text is distinct from p_customer_id::text then raise exception 'Only the order customer can raise this concern.'; end if;
  if v_order.stage::text not in ('CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION') then
    raise exception 'This order cannot open a concern from its current stage.';
  end if;
  if exists (select 1 from public.disputes where order_id = p_order_id) then raise exception 'A concern already exists for this order.'; end if;

  insert into public.disputes (order_id, customer_id, reason, description, created_at, updated_at)
  values (p_order_id, p_customer_id, p_reason_code, trim(p_description), now(), now())
  returning id into v_dispute_id;

  insert into public.financial_cases (
    idempotency_key, request_hash, order_id, legacy_dispute_id, case_type, status,
    opened_by, opened_by_role, counterparty_id, reason_code, summary, claim_details,
    requested_outcome, money_movement_blocked, policy_version, correlation_id,
    counterparty_response_requested_at
  ) values (
    p_idempotency_key, v_request_hash, p_order_id, v_dispute_id, p_case_type, 'COUNTERPARTY_REVIEW',
    p_customer_id, 'CUSTOMER', v_order.tailor_id::uuid, p_reason_code, trim(p_description),
    jsonb_build_object('fromStage', v_order.stage, 'openedAt', now()),
    p_requested_outcome, true, v_order.commercial_policy_version, p_correlation_id, now()
  ) returning * into v_case;

  insert into public.financial_case_events (
    case_id, event_type, actor_id, actor_role, visibility, payload, correlation_id
  ) values (
    v_case.id, 'CASE_OPENED', p_customer_id, 'CUSTOMER', 'PARTIES',
    jsonb_build_object('reasonCode', p_reason_code, 'requestedOutcome', p_requested_outcome,
      'caseType', p_case_type, 'fromStage', v_order.stage), p_correlation_id
  );

  insert into public.financial_case_evidence (
    case_id, evidence_type, source, evidence_tier, verification_status, visibility,
    source_table, source_record_id, metadata, submitted_by, submitted_by_role
  ) values
    (v_case.id, 'ORDER_STATE_AT_OPEN', 'PLATFORM_ORDER', null, 'CORROBORATED', 'PARTIES',
      'orders', p_order_id::text,
      jsonb_build_object('stage', v_order.stage, 'policyVersion', v_order.commercial_policy_version,
        'activeQuoteId', v_order.active_quote_id, 'capturedAt', now()), p_customer_id, 'CUSTOMER'),
    (v_case.id, 'ORDER_TIMELINE_THROUGH_OPEN', 'PLATFORM_TIMELINE', null, 'CORROBORATED', 'PARTIES',
      'order_stage_updates', null, jsonb_build_object('orderId', p_order_id, 'cutoffAt', now()), p_customer_id, 'CUSTOMER'),
    (v_case.id, 'ORDER_MESSAGES_THROUGH_OPEN', 'PLATFORM_MESSAGE', 'D', 'CLAIMED', 'PARTIES',
      'messages', null, jsonb_build_object('orderId', p_order_id, 'cutoffAt', now()), p_customer_id, 'CUSTOMER');

  update public.orders
  set stage = 'IN_DISPUTE', stage_updated_at = now(), auto_release_at = null
  where id = p_order_id;

  insert into public.order_stage_updates (order_id, stage, note)
  values (p_order_id, 'IN_DISPUTE', 'Customer raised a concern for Drapeon review.');

  insert into public.audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (p_customer_id, 'CUSTOMER', p_order_id::uuid, 'financial_case.opened', 'warn',
    jsonb_build_object('case_id', v_case.id, 'case_reference', v_case.reference,
      'legacy_dispute_id', v_dispute_id, 'reason_code', p_reason_code,
      'requested_outcome', p_requested_outcome, 'correlation_id', p_correlation_id));

  return jsonb_build_object('caseId', v_case.id, 'caseReference', v_case.reference,
    'legacyDisputeId', v_dispute_id, 'status', v_case.status,
    'correlationId', v_case.correlation_id, 'duplicate', false);
end;
$$;

revoke all on function public.create_customer_concern_case(text, text, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_customer_concern_case(text, text, uuid, text, text, text, text, uuid) to service_role;

create or replace function public.append_financial_case_evidence(
  p_case_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_evidence_type text,
  p_source text,
  p_storage_bucket text default null,
  p_storage_object_path text default null,
  p_external_reference text default null,
  p_source_table text default null,
  p_source_record_id text default null,
  p_content_sha256 text default null,
  p_mime_type text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_visibility text default 'PARTIES',
  p_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_case public.financial_cases%rowtype;
  v_order public.orders%rowtype;
  v_evidence_id uuid;
begin
  select * into v_case from public.financial_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'Financial case was not found.'; end if;

  select * into v_order from public.orders where id = v_case.order_id;
  if p_actor_role not in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM') then raise exception 'Invalid evidence actor role.'; end if;
  if p_actor_role = 'CUSTOMER' and p_actor_id::text is distinct from v_order.customer_id::text then raise exception 'Customer is not a party to this case.'; end if;
  if p_actor_role = 'TAILOR' and p_actor_id::text is distinct from v_order.tailor_id::text then raise exception 'Tailor is not a party to this case.'; end if;
  if p_source not in ('USER_UPLOAD', 'EMAIL_INGEST', 'WHATSAPP_SUMMARY', 'OPS_NOTE', 'PAYMENT_PROVIDER', 'CALL_PROVIDER', 'FULFILLMENT_PROVIDER', 'PLATFORM_ORDER', 'PLATFORM_TIMELINE', 'PLATFORM_MESSAGE') then
    raise exception 'Invalid evidence source.';
  end if;
  if p_actor_role in ('CUSTOMER', 'TAILOR') and p_source <> 'USER_UPLOAD' then
    raise exception 'Order parties may only append user-uploaded evidence.';
  end if;
  if p_visibility not in ('PARTIES', 'OPS_ONLY') then raise exception 'Invalid evidence visibility.'; end if;
  if nullif(trim(coalesce(p_storage_bucket, '')), '') is null
    and nullif(trim(coalesce(p_external_reference, '')), '') is null
    and nullif(trim(coalesce(p_source_table, '')), '') is null then
    raise exception 'Evidence requires a private storage object or source reference.';
  end if;
  if p_storage_bucket is not null and nullif(trim(coalesce(p_storage_object_path, '')), '') is null then
    raise exception 'A storage object path is required with a storage bucket.';
  end if;

  insert into public.financial_case_evidence (
    case_id, evidence_type, source, evidence_tier, verification_status, visibility,
    storage_bucket, storage_object_path, external_reference, source_table,
    source_record_id, content_sha256, mime_type, metadata, submitted_by,
    submitted_by_role
  ) values (
    p_case_id, trim(p_evidence_type), p_source, 'D', 'CLAIMED', p_visibility,
    nullif(trim(coalesce(p_storage_bucket, '')), ''),
    nullif(trim(coalesce(p_storage_object_path, '')), ''),
    nullif(trim(coalesce(p_external_reference, '')), ''),
    nullif(trim(coalesce(p_source_table, '')), ''),
    nullif(trim(coalesce(p_source_record_id, '')), ''),
    lower(nullif(trim(coalesce(p_content_sha256, '')), '')),
    nullif(trim(coalesce(p_mime_type, '')), ''), coalesce(p_metadata, '{}'::jsonb),
    p_actor_id, p_actor_role
  ) returning id into v_evidence_id;

  insert into public.financial_case_events (
    case_id, event_type, actor_id, actor_role, visibility, payload, correlation_id
  ) values (
    p_case_id, 'EVIDENCE_ADDED', p_actor_id, p_actor_role, p_visibility,
    jsonb_build_object('evidenceId', v_evidence_id, 'evidenceType', trim(p_evidence_type), 'source', p_source),
    p_correlation_id
  );

  return v_evidence_id;
end;
$$;

revoke all on function public.append_financial_case_evidence(uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.append_financial_case_evidence(uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, text, uuid) to service_role;

create or replace function public.sync_financial_case_from_legacy_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.financial_cases%rowtype;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into v_case from public.financial_cases where legacy_dispute_id = new.id for update;
  if v_case.id is null then return new; end if;

  if new.status in ('RESOLVED_REFUNDED', 'RESOLVED_RELEASED') then
    update public.financial_cases
    set status = 'RESOLVED', money_movement_blocked = false,
      resolved_at = coalesce(new.resolved_at, now()), resolved_by = nullif(new.resolved_by::text, '')::uuid,
      resolution_code = new.status::text, resolution_summary = new.resolution
    where id = v_case.id;

    insert into public.financial_case_events (
      case_id, event_type, actor_id, actor_role, visibility, payload, correlation_id
    ) values (
      v_case.id, 'CASE_RESOLVED', new.resolved_by, 'OPS', 'PARTIES',
      jsonb_build_object('legacyDisputeStatus', new.status, 'resolution', new.resolution),
      v_case.correlation_id
    );
  elsif new.status = 'UNDER_REVIEW' then
    update public.financial_cases set status = 'OPS_REVIEW' where id = v_case.id;
    insert into public.financial_case_events (
      case_id, event_type, actor_id, actor_role, visibility, payload, correlation_id
    ) values (
      v_case.id, 'STATUS_CHANGED', null, 'OPS', 'PARTIES',
      jsonb_build_object('from', v_case.status, 'to', 'OPS_REVIEW'), v_case.correlation_id
    );
  end if;
  return new;
end;
$$;

create trigger disputes_sync_financial_case
  after update of status on public.disputes
  for each row execute function public.sync_financial_case_from_legacy_dispute();

-- Existing concern records remain valid and become visible in the canonical
-- case layer without copying legacy public media URLs into the secure packet.
insert into public.financial_cases (
  idempotency_key, request_hash, order_id, legacy_dispute_id, case_type, status,
  opened_by, opened_by_role, counterparty_id, reason_code, summary, claim_details,
  requested_outcome, money_movement_blocked, policy_version, correlation_id,
  first_response_due_at, resolution_due_at, resolved_at, resolved_by,
  resolution_code, resolution_summary, created_at, updated_at
)
select
  'legacy-dispute:' || d.id::text,
  encode(extensions.digest(d.id::text, 'sha256'), 'hex'),
  d.order_id,
  d.id,
  case when lower(d.reason) like '%deliver%' or lower(d.reason) like '%receiv%' then 'FULFILLMENT_RECONCILIATION'
       when lower(d.reason) like '%trust%' or lower(d.reason) like '%platform%' then 'SAFETY_FRAUD'
       else 'QUALITY_CONCERN' end,
  case when d.status in ('OPEN', 'UNDER_REVIEW') then 'OPS_REVIEW' else 'RESOLVED' end,
  d.customer_id::uuid,
  'CUSTOMER',
  o.tailor_id::uuid,
  coalesce(nullif(trim(d.reason), ''), 'OTHER'),
  case when char_length(trim(d.description)) >= 10 then left(trim(d.description), 2000)
       else 'Legacy concern imported for financial case review.' end,
  jsonb_build_object('legacyImported', true, 'legacyEvidenceCount', cardinality(coalesce(d.evidence_urls, '{}'::text[]))),
  null,
  d.status in ('OPEN', 'UNDER_REVIEW'),
  o.commercial_policy_version,
  gen_random_uuid(),
  d.created_at + interval '24 hours',
  d.created_at + interval '72 hours',
  case when d.status in ('OPEN', 'UNDER_REVIEW') then null else coalesce(d.resolved_at, d.updated_at) end,
  nullif(d.resolved_by::text, '')::uuid,
  case when d.status in ('OPEN', 'UNDER_REVIEW') then null else d.status::text end,
  d.resolution,
  d.created_at,
  d.updated_at
from public.disputes d
join public.orders o on o.id = d.order_id
on conflict (legacy_dispute_id) do nothing;

insert into public.financial_case_events (
  case_id, event_type, actor_id, actor_role, visibility, payload, correlation_id, created_at
)
select fc.id, 'CASE_OPENED', fc.opened_by, fc.opened_by_role, 'PARTIES',
  jsonb_build_object('legacyImported', true, 'reasonCode', fc.reason_code),
  fc.correlation_id, fc.created_at
from public.financial_cases fc
where fc.idempotency_key like 'legacy-dispute:%'
  and not exists (select 1 from public.financial_case_events e where e.case_id = fc.id);

comment on table public.financial_cases is 'Canonical typed financial and resolution cases; multiple cases may relate to one order.';
comment on table public.financial_case_events is 'Append-only authenticated case history. Email and WhatsApp cannot authorize state changes.';
comment on table public.financial_case_evidence is 'Append-only secure evidence descriptors; media uses private storage paths or provider references, never permanent public URLs.';
