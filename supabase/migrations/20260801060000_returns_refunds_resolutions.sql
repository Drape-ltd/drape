-- Drapeon commercial architecture, implementation 9.

create table public.order_return_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('RET-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  financial_case_id uuid not null unique references public.financial_cases(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  requester_id uuid not null references auth.users(id) on delete restrict,
  requester_role text not null check(requester_role in ('CUSTOMER','TAILOR')),
  counterparty_id uuid not null references auth.users(id) on delete restrict,
  reason_code text not null check(reason_code in ('CHANGE_OF_MIND','NOT_AS_DESCRIBED','DAMAGED_IN_TRANSIT','WRONG_ITEM','QUALITY_WORKMANSHIP','FIT_MEASUREMENT','LATE_DELIVERY','NOT_RECEIVED')),
  requested_remedy text not null check(requested_remedy in ('EXPLANATION','ALTERATION','REMAKE','PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND')),
  summary text not null check(char_length(summary) between 10 and 2000),
  requested_amount integer check(requested_amount is null or requested_amount>0),
  currency currency,
  eligibility_status text not null check(eligibility_status in ('ELIGIBLE','INELIGIBLE','OPS_REVIEW')),
  eligibility_reason text not null,
  return_required boolean not null,
  status text not null default 'COUNTERPARTY_REVIEW' check(status in ('COUNTERPARTY_REVIEW','NEGOTIATING','AGREED','RETURN_AUTHORIZED','IN_TRANSIT','RECEIVED','OPS_REVIEW','REFUND_PENDING','RESOLVED','DECLINED','CANCELLED')),
  policy_version text not null default 'returns-2026-08-01-v1',
  correlation_id uuid not null default gen_random_uuid(),
  response_due_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((requested_amount is null)=(currency is null))
);

create table public.order_resolution_proposals (
  id uuid primary key default gen_random_uuid(), return_request_id uuid not null references public.order_return_requests(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict, version integer not null,
  idempotency_key text not null unique, request_hash text not null,
  proposed_by uuid references auth.users(id) on delete set null, proposed_by_role text not null check(proposed_by_role in ('CUSTOMER','TAILOR','OPS')),
  remedy text not null check(remedy in ('EXPLANATION','ALTERATION','REMAKE','PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND','REJECTED')),
  amount integer check(amount is null or amount>0), currency currency, return_required boolean not null,
  return_shipping_responsibility text check(return_shipping_responsibility is null or return_shipping_responsibility in ('CUSTOMER','TAILOR','DRAPEON','UNRESOLVED')),
  note text not null check(char_length(note) between 3 and 1000), status text not null default 'OPEN' check(status in ('OPEN','ACCEPTED','DECLINED','SUPERSEDED','CANCELLED')),
  correlation_id uuid not null, created_at timestamptz not null default now(), unique(return_request_id,version), check((amount is null)=(currency is null))
);
create table public.order_resolution_decisions (
  id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.order_resolution_proposals(id) on delete restrict,
  idempotency_key text not null unique, request_hash text not null,
  return_request_id uuid not null references public.order_return_requests(id) on delete restrict, decision text not null check(decision in ('ACCEPTED','DECLINED')),
  decided_by uuid not null references auth.users(id) on delete restrict, decided_by_role text not null check(decided_by_role in ('CUSTOMER','TAILOR')),
  note text, correlation_id uuid not null, created_at timestamptz not null default now(), unique(proposal_id,decided_by)
);
create table public.order_return_shipments (
  id uuid primary key default gen_random_uuid(), return_request_id uuid not null unique references public.order_return_requests(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict, provider text, tracking_number text, label_storage_bucket text, label_storage_path text,
  status text not null default 'LABEL_PENDING' check(status in ('LABEL_PENDING','AUTHORIZED','CARRIER_ACCEPTED','IN_TRANSIT','DELIVERED','RECEIVED','LOST','CANCELLED')),
  shipping_paid_by text check(shipping_paid_by is null or shipping_paid_by in ('CUSTOMER','TAILOR','DRAPEON')),
  authorized_at timestamptz, carrier_accepted_at timestamptz, delivered_at timestamptz, received_at timestamptz,
  correlation_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.order_return_shipment_events (
  id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.order_return_shipments(id) on delete restrict,
  return_request_id uuid not null references public.order_return_requests(id) on delete restrict,
  status text not null check(status in ('LABEL_PENDING','AUTHORIZED','CARRIER_ACCEPTED','IN_TRANSIT','DELIVERED','RECEIVED','LOST','CANCELLED')),
  provider_event_id text, evidence_source text not null check(evidence_source in ('OPS','FULFILLMENT_PROVIDER','CUSTOMER','TAILOR')),
  evidence_reference text, actor_id uuid, actor_role text not null check(actor_role in ('CUSTOMER','TAILOR','OPS','SYSTEM')),
  payload jsonb not null default '{}'::jsonb, correlation_id uuid not null, created_at timestamptz not null default now(),
  unique(provider_event_id)
);
create table public.order_refund_resolutions (
  id uuid primary key default gen_random_uuid(), reference text not null unique default ('RFD-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  return_request_id uuid unique references public.order_return_requests(id) on delete restrict, financial_case_id uuid not null references public.financial_cases(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict, proposal_id uuid references public.order_resolution_proposals(id) on delete restrict,
  amount integer not null check(amount>0), currency currency not null,
  tailor_work_amount integer not null default 0 check(tailor_work_amount>=0), platform_fee_amount integer not null default 0 check(platform_fee_amount>=0), tax_amount integer not null default 0 check(tax_amount>=0), fulfillment_amount integer not null default 0 check(fulfillment_amount>=0), consultation_amount integer not null default 0 check(consultation_amount>=0), promotion_amount integer not null default 0 check(promotion_amount>=0), drapeon_funded_amount integer not null default 0 check(drapeon_funded_amount>=0),
  released_tailor_recovery_amount integer not null default 0 check(released_tailor_recovery_amount>=0),
  status text not null default 'MONEY_DESK_REQUIRED' check(status in ('MONEY_DESK_REQUIRED','APPROVAL_PENDING','APPROVED','PROCESSING','SUCCEEDED','FAILED','BLOCKED')),
  money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict, provider_reference text, failure_summary text,
  policy_version text not null default 'returns-2026-08-01-v1', correlation_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(amount=tailor_work_amount+platform_fee_amount+tax_amount+fulfillment_amount+consultation_amount)
);

create index order_return_requests_order_idx on public.order_return_requests(order_id,created_at desc);
create index order_return_requests_queue_idx on public.order_return_requests(status,response_due_at);
create index order_resolution_proposals_request_idx on public.order_resolution_proposals(return_request_id,version);

create or replace function public.prevent_resolution_append_only_mutation() returns trigger language plpgsql as $$ begin raise exception 'Resolution proposals and decisions are append-only.'; end $$;
create trigger resolution_decisions_append_only before update or delete on public.order_resolution_decisions for each row execute function public.prevent_resolution_append_only_mutation();
create trigger return_shipment_events_append_only before update or delete on public.order_return_shipment_events for each row execute function public.prevent_resolution_append_only_mutation();

create or replace function public.protect_resolution_proposal_claim() returns trigger language plpgsql as $$
begin
  if new.return_request_id is distinct from old.return_request_id or new.order_id is distinct from old.order_id
    or new.version is distinct from old.version or new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash or new.proposed_by is distinct from old.proposed_by
    or new.proposed_by_role is distinct from old.proposed_by_role or new.remedy is distinct from old.remedy
    or new.amount is distinct from old.amount or new.currency is distinct from old.currency
    or new.return_required is distinct from old.return_required
    or new.return_shipping_responsibility is distinct from old.return_shipping_responsibility
    or new.note is distinct from old.note or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Resolution proposal claims are immutable; append a new proposal instead.';
  end if;
  return new;
end $$;
create trigger resolution_proposal_claim_immutable before update on public.order_resolution_proposals for each row execute function public.protect_resolution_proposal_claim();

create or replace function public.create_order_return_request(p_order_id text,p_actor_id uuid,p_reason_code text,p_requested_remedy text,p_summary text,p_requested_amount integer,p_currency currency,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare o public.orders%rowtype; r public.order_return_requests%rowtype; fc public.financial_cases%rowtype; actor_role text; counterparty uuid; eligibility text; eligibility_reason text; return_required boolean; delivered_at timestamptz; req_hash text; existing_hash text;
begin
  select * into o from public.orders where id=p_order_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.customer_id::text=p_actor_id::text then actor_role:='CUSTOMER';counterparty:=o.tailor_id::uuid; elsif o.tailor_id::text=p_actor_id::text then actor_role:='TAILOR';counterparty:=o.customer_id::uuid; else raise exception 'Order access denied.'; end if;
  if p_reason_code not in ('CHANGE_OF_MIND','NOT_AS_DESCRIBED','DAMAGED_IN_TRANSIT','WRONG_ITEM','QUALITY_WORKMANSHIP','FIT_MEASUREMENT','LATE_DELIVERY','NOT_RECEIVED') then raise exception 'Invalid return reason.'; end if;
  if p_requested_remedy not in ('EXPLANATION','ALTERATION','REMAKE','PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND') then raise exception 'Invalid remedy.'; end if;
  if char_length(trim(coalesce(p_summary,''))) not between 10 and 2000 then raise exception 'Summary must be 10 to 2000 characters.'; end if;
  if p_requested_remedy in ('PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND') and actor_role<>'CUSTOMER' then raise exception 'Only the customer can request a customer refund.'; end if;
  delivered_at:=coalesce(o.customer_handoff_confirmed_at,o.handoff_completed_at);
  if p_reason_code='NOT_RECEIVED' then eligibility:='OPS_REVIEW';eligibility_reason:='Delivery evidence must be reconciled.';return_required:=false;
  elsif o.order_kind='CUSTOM' and p_reason_code='CHANGE_OF_MIND' then eligibility:='INELIGIBLE';eligibility_reason:='Made-to-order work is not eligible for change-of-mind return unless law requires it.';return_required:=false;
  elsif delivered_at is null or delivered_at<now()-interval '14 days' then eligibility:='OPS_REVIEW';eligibility_reason:='Delivery time, evidence, and applicable law require review.';return_required:=p_reason_code<>'FIT_MEASUREMENT';
  elsif p_reason_code='FIT_MEASUREMENT' then eligibility:='OPS_REVIEW';eligibility_reason:='Fit responsibility and alteration feasibility require review.';return_required:=false;
  else eligibility:='ELIGIBLE';eligibility_reason:='Request is inside the protection window and requires evidence and counterpart review.';return_required:=true; end if;
  req_hash:=encode(digest(concat_ws('|',p_order_id,p_actor_id,p_reason_code,p_requested_remedy,trim(p_summary),coalesce(p_requested_amount,0),coalesce(p_currency::text,'')),'sha256'),'hex');
  select rr.* into r from public.order_return_requests rr join public.financial_cases f on f.id=rr.financial_case_id where f.idempotency_key=p_idempotency_key;
  if r.id is not null then select request_hash into existing_hash from public.financial_cases where id=r.financial_case_id; if existing_hash<>req_hash then raise exception 'Idempotency key was reused with different return details.'; end if; return jsonb_build_object('id',r.id,'reference',r.reference,'status',r.status,'existing',true); end if;
  insert into public.financial_cases(idempotency_key,request_hash,order_id,case_type,status,opened_by,opened_by_role,counterparty_id,reason_code,summary,claim_details,requested_outcome,requested_amount,requested_currency,money_movement_blocked,eligibility_status,eligibility_snapshot,policy_version,counterparty_response_requested_at)
  values(p_idempotency_key,req_hash,p_order_id,'RETURN','COUNTERPARTY_REVIEW',p_actor_id,actor_role,counterparty,p_reason_code,trim(p_summary),jsonb_build_object('requested_remedy',p_requested_remedy,'return_required',return_required),case when p_requested_remedy in ('PARTIAL_REFUND','FULL_REFUND') then p_requested_remedy else 'OPS_HELP' end,p_requested_amount,p_currency,true,eligibility,jsonb_build_object('reason',eligibility_reason,'evaluated_at',now()),'returns-2026-08-01-v1',now()) returning * into fc;
  insert into public.order_return_requests(financial_case_id,order_id,requester_id,requester_role,counterparty_id,reason_code,requested_remedy,summary,requested_amount,currency,eligibility_status,eligibility_reason,return_required,status,correlation_id)
  values(fc.id,p_order_id,p_actor_id,actor_role,counterparty,p_reason_code,p_requested_remedy,trim(p_summary),p_requested_amount,p_currency,eligibility,eligibility_reason,return_required,case when eligibility='INELIGIBLE' then 'OPS_REVIEW' else 'COUNTERPARTY_REVIEW' end,fc.correlation_id) returning * into r;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id) values(fc.id,'CASE_OPENED',p_actor_id,actor_role,jsonb_build_object('return_request_id',r.id,'reason_code',p_reason_code,'requested_remedy',p_requested_remedy,'eligibility_status',eligibility),fc.correlation_id);
  return jsonb_build_object('id',r.id,'reference',r.reference,'financialCaseId',fc.id,'status',r.status,'eligibilityStatus',eligibility,'existing',false);
end $$;

create or replace function public.propose_order_resolution(
  p_return_request_id uuid,p_actor_id uuid,p_remedy text,p_amount integer,p_currency currency,
  p_return_required boolean,p_shipping_responsibility text,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare rr public.order_return_requests%rowtype; o public.orders%rowtype; p public.order_resolution_proposals%rowtype;
 actor_role text; next_version integer; req_hash text;
begin
  select * into rr from public.order_return_requests where id=p_return_request_id for update;
  if rr.id is null then raise exception 'Return request not found.'; end if;
  select * into o from public.orders where id=rr.order_id;
  if o.customer_id::text=p_actor_id::text then actor_role:='CUSTOMER'; elsif o.tailor_id::text=p_actor_id::text then actor_role:='TAILOR'; else raise exception 'Order access denied.'; end if;
  if rr.status in ('RESOLVED','DECLINED','CANCELLED') then raise exception 'This return request is closed.'; end if;
  if p_remedy not in ('EXPLANATION','ALTERATION','REMAKE','PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND','REJECTED') then raise exception 'Invalid remedy.'; end if;
  if p_remedy in ('PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND') and actor_role='CUSTOMER' and rr.requester_role='TAILOR' then raise exception 'A tailor-started request cannot authorize a customer refund without customer review.'; end if;
  if char_length(trim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'Proposal note must be 3 to 1000 characters.'; end if;
  if (p_amount is null)<>(p_currency is null) or p_amount is not null and p_amount<=0 then raise exception 'Proposal amount and currency must be valid together.'; end if;
  if p_shipping_responsibility is not null and p_shipping_responsibility not in ('CUSTOMER','TAILOR','DRAPEON','UNRESOLVED') then raise exception 'Invalid shipping responsibility.'; end if;
  req_hash:=encode(digest(concat_ws('|',p_return_request_id,p_actor_id,p_remedy,coalesce(p_amount,0),coalesce(p_currency::text,''),p_return_required,coalesce(p_shipping_responsibility,''),trim(p_note)),'sha256'),'hex');
  select * into p from public.order_resolution_proposals where idempotency_key=p_idempotency_key;
  if p.id is not null then if p.request_hash<>req_hash then raise exception 'Idempotency key was reused with different proposal details.'; end if; return jsonb_build_object('id',p.id,'status',p.status,'existing',true); end if;
  update public.order_resolution_proposals set status='SUPERSEDED' where return_request_id=rr.id and status='OPEN';
  select coalesce(max(version),0)+1 into next_version from public.order_resolution_proposals where return_request_id=rr.id;
  insert into public.order_resolution_proposals(return_request_id,order_id,version,idempotency_key,request_hash,proposed_by,proposed_by_role,remedy,amount,currency,return_required,return_shipping_responsibility,note,correlation_id)
  values(rr.id,rr.order_id,next_version,p_idempotency_key,req_hash,p_actor_id,actor_role,p_remedy,p_amount,p_currency,p_return_required,p_shipping_responsibility,trim(p_note),rr.correlation_id) returning * into p;
  update public.order_return_requests set status='NEGOTIATING',updated_at=now(),response_due_at=now()+interval '24 hours' where id=rr.id;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id) values(rr.financial_case_id,'STATUS_CHANGED',p_actor_id,actor_role,jsonb_build_object('return_request_id',rr.id,'proposal_id',p.id,'proposal_version',next_version,'remedy',p_remedy,'status','NEGOTIATING'),rr.correlation_id);
  return jsonb_build_object('id',p.id,'version',next_version,'status',p.status,'existing',false);
end $$;

create or replace function public.decide_order_resolution(
  p_proposal_id uuid,p_actor_id uuid,p_decision text,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare p public.order_resolution_proposals%rowtype; rr public.order_return_requests%rowtype; o public.orders%rowtype; d public.order_resolution_decisions%rowtype; actor_role text; req_hash text; next_status text;
begin
  select * into p from public.order_resolution_proposals where id=p_proposal_id for update;
  if p.id is null then raise exception 'Resolution proposal not found.'; end if;
  select * into rr from public.order_return_requests where id=p.return_request_id for update;
  select * into o from public.orders where id=p.order_id;
  if o.customer_id::text=p_actor_id::text then actor_role:='CUSTOMER'; elsif o.tailor_id::text=p_actor_id::text then actor_role:='TAILOR'; else raise exception 'Order access denied.'; end if;
  if p.proposed_by=p_actor_id then raise exception 'The proposer cannot decide their own proposal.'; end if;
  if p.status<>'OPEN' then raise exception 'This proposal is no longer open.'; end if;
  if p_decision not in ('ACCEPTED','DECLINED') then raise exception 'Invalid decision.'; end if;
  req_hash:=encode(digest(concat_ws('|',p_proposal_id,p_actor_id,p_decision,trim(coalesce(p_note,''))),'sha256'),'hex');
  select * into d from public.order_resolution_decisions where idempotency_key=p_idempotency_key;
  if d.id is not null then if d.request_hash<>req_hash then raise exception 'Idempotency key was reused with different decision details.'; end if; return jsonb_build_object('id',d.id,'status',p.status,'existing',true); end if;
  insert into public.order_resolution_decisions(proposal_id,idempotency_key,request_hash,return_request_id,decision,decided_by,decided_by_role,note,correlation_id)
  values(p.id,p_idempotency_key,req_hash,rr.id,p_decision,p_actor_id,actor_role,nullif(trim(coalesce(p_note,'')),''),rr.correlation_id) returning * into d;
  update public.order_resolution_proposals set status=p_decision where id=p.id;
  next_status:=case when p_decision='DECLINED' then 'NEGOTIATING' when p.return_required then 'RETURN_AUTHORIZED' when p.remedy in ('PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND') then 'REFUND_PENDING' else 'AGREED' end;
  update public.order_return_requests set status=next_status,updated_at=now(),response_due_at=now()+interval '24 hours' where id=rr.id;
  update public.financial_cases set status=case when p_decision='DECLINED' then 'COUNTERPARTY_REVIEW' else 'OPS_REVIEW' end,counterparty_responded_at=now() where id=rr.financial_case_id;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id) values(rr.financial_case_id,'STATUS_CHANGED',p_actor_id,actor_role,jsonb_build_object('return_request_id',rr.id,'proposal_id',p.id,'decision',p_decision,'return_status',next_status),rr.correlation_id);
  return jsonb_build_object('id',d.id,'returnRequestId',rr.id,'status',next_status,'existing',false);
end $$;

create or replace function public.record_order_return_shipment_event(
  p_return_request_id uuid,p_status text,p_provider text,p_tracking_number text,p_label_bucket text,p_label_path text,
  p_shipping_paid_by text,p_provider_event_id text,p_evidence_source text,p_evidence_reference text,p_actor_id uuid,p_actor_role text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare rr public.order_return_requests%rowtype; s public.order_return_shipments%rowtype; e public.order_return_shipment_events%rowtype;
begin
  select * into rr from public.order_return_requests where id=p_return_request_id for update;
  if rr.id is null then raise exception 'Return request not found.'; end if;
  if p_status not in ('LABEL_PENDING','AUTHORIZED','CARRIER_ACCEPTED','IN_TRANSIT','DELIVERED','RECEIVED','LOST','CANCELLED') then raise exception 'Invalid return shipment status.'; end if;
  if p_provider_event_id is not null then select * into e from public.order_return_shipment_events where provider_event_id=p_provider_event_id; if e.id is not null then return jsonb_build_object('id',e.id,'existing',true); end if; end if;
  insert into public.order_return_shipments(return_request_id,order_id,provider,tracking_number,label_storage_bucket,label_storage_path,status,shipping_paid_by,authorized_at,carrier_accepted_at,delivered_at,received_at,correlation_id)
  values(rr.id,rr.order_id,p_provider,p_tracking_number,p_label_bucket,p_label_path,p_status,p_shipping_paid_by,case when p_status in ('AUTHORIZED','CARRIER_ACCEPTED','IN_TRANSIT','DELIVERED','RECEIVED') then now() end,case when p_status in ('CARRIER_ACCEPTED','IN_TRANSIT','DELIVERED','RECEIVED') then now() end,case when p_status in ('DELIVERED','RECEIVED') then now() end,case when p_status='RECEIVED' then now() end,rr.correlation_id)
  on conflict(return_request_id) do update set provider=coalesce(excluded.provider,order_return_shipments.provider),tracking_number=coalesce(excluded.tracking_number,order_return_shipments.tracking_number),label_storage_bucket=coalesce(excluded.label_storage_bucket,order_return_shipments.label_storage_bucket),label_storage_path=coalesce(excluded.label_storage_path,order_return_shipments.label_storage_path),status=excluded.status,shipping_paid_by=coalesce(excluded.shipping_paid_by,order_return_shipments.shipping_paid_by),authorized_at=coalesce(order_return_shipments.authorized_at,excluded.authorized_at),carrier_accepted_at=coalesce(order_return_shipments.carrier_accepted_at,excluded.carrier_accepted_at),delivered_at=coalesce(order_return_shipments.delivered_at,excluded.delivered_at),received_at=coalesce(order_return_shipments.received_at,excluded.received_at),updated_at=now() returning * into s;
  insert into public.order_return_shipment_events(shipment_id,return_request_id,status,provider_event_id,evidence_source,evidence_reference,actor_id,actor_role,payload,correlation_id)
  values(s.id,rr.id,p_status,p_provider_event_id,p_evidence_source,p_evidence_reference,p_actor_id,p_actor_role,coalesce(p_payload,'{}'::jsonb),rr.correlation_id) returning * into e;
  update public.order_return_requests set status=case when p_status='RECEIVED' then 'RECEIVED' when p_status in ('CARRIER_ACCEPTED','IN_TRANSIT','DELIVERED') then 'IN_TRANSIT' else status end,updated_at=now() where id=rr.id;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id) values(rr.financial_case_id,'EVIDENCE_ADDED',p_actor_id,p_actor_role,jsonb_build_object('return_request_id',rr.id,'shipment_event_id',e.id,'shipment_status',p_status,'evidence_source',p_evidence_source),rr.correlation_id);
  return jsonb_build_object('id',e.id,'shipmentId',s.id,'status',p_status,'existing',false);
end $$;

create or replace function public.prepare_order_refund_resolution(
  p_return_request_id uuid,p_proposal_id uuid,p_tailor_work integer,p_platform_fee integer,p_tax integer,p_fulfillment integer,p_consultation integer,p_promotion integer,p_drapeon_funded integer,p_released_tailor_recovery integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare rr public.order_return_requests%rowtype; p public.order_resolution_proposals%rowtype; s public.order_return_shipments%rowtype; r public.order_refund_resolutions%rowtype; total integer;
begin
  select * into rr from public.order_return_requests where id=p_return_request_id for update;
  select * into p from public.order_resolution_proposals where id=p_proposal_id and return_request_id=p_return_request_id;
  if rr.id is null or p.id is null or p.status<>'ACCEPTED' or p.remedy not in ('PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND') then raise exception 'An accepted refund proposal is required.'; end if;
  if p.return_required then select * into s from public.order_return_shipments where return_request_id=rr.id; if s.status is distinct from 'RECEIVED' then raise exception 'Required return must be received before refund preparation.'; end if; end if;
  if least(p_tailor_work,p_platform_fee,p_tax,p_fulfillment,p_consultation,p_promotion,p_drapeon_funded,p_released_tailor_recovery)<0 then raise exception 'Refund restoration amounts cannot be negative.'; end if;
  total:=p_tailor_work+p_platform_fee+p_tax+p_fulfillment+p_consultation;
  if p.amount is null or total<>p.amount then raise exception 'Refund restoration must equal the accepted proposal amount.'; end if;
  if p_released_tailor_recovery>p_drapeon_funded then raise exception 'Released tailor money cannot be silently reversed; fund the customer refund and open a separate recovery action.'; end if;
  insert into public.order_refund_resolutions(return_request_id,financial_case_id,order_id,proposal_id,amount,currency,tailor_work_amount,platform_fee_amount,tax_amount,fulfillment_amount,consultation_amount,promotion_amount,drapeon_funded_amount,released_tailor_recovery_amount,correlation_id)
  values(rr.id,rr.financial_case_id,rr.order_id,p.id,total,p.currency,p_tailor_work,p_platform_fee,p_tax,p_fulfillment,p_consultation,p_promotion,p_drapeon_funded,p_released_tailor_recovery,rr.correlation_id)
  on conflict(return_request_id) do nothing returning * into r;
  if r.id is null then select * into r from public.order_refund_resolutions where return_request_id=rr.id; end if;
  update public.order_return_requests set status='REFUND_PENDING',updated_at=now() where id=rr.id;
  return jsonb_build_object('id',r.id,'reference',r.reference,'amount',r.amount,'currency',r.currency,'status',r.status,'recoveryRequired',r.released_tailor_recovery_amount>0);
end $$;

alter table public.order_return_requests enable row level security; alter table public.order_resolution_proposals enable row level security; alter table public.order_resolution_decisions enable row level security; alter table public.order_return_shipments enable row level security; alter table public.order_return_shipment_events enable row level security; alter table public.order_refund_resolutions enable row level security;
create policy return_parties_read on public.order_return_requests for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy proposal_parties_read on public.order_resolution_proposals for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy decision_parties_read on public.order_resolution_decisions for select to authenticated using(exists(select 1 from public.order_return_requests r join public.orders o on o.id=r.order_id where r.id=return_request_id and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy return_shipment_parties_read on public.order_return_shipments for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy return_shipment_event_parties_read on public.order_return_shipment_events for select to authenticated using(exists(select 1 from public.order_return_requests r join public.orders o on o.id=r.order_id where r.id=return_request_id and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
create policy refund_resolution_parties_read on public.order_refund_resolutions for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (auth.uid()::text=o.customer_id::text or auth.uid()::text=o.tailor_id::text)));
revoke all on public.order_return_requests,public.order_resolution_proposals,public.order_resolution_decisions,public.order_return_shipments,public.order_return_shipment_events,public.order_refund_resolutions from anon,authenticated;
grant select on public.order_return_requests,public.order_resolution_proposals,public.order_resolution_decisions,public.order_return_shipments,public.order_return_shipment_events,public.order_refund_resolutions to authenticated;
grant all on public.order_return_requests,public.order_resolution_proposals,public.order_resolution_decisions,public.order_return_shipments,public.order_return_shipment_events,public.order_refund_resolutions to service_role;
revoke all on function public.create_order_return_request(text,uuid,text,text,text,integer,currency,text) from public,anon,authenticated; grant execute on function public.create_order_return_request(text,uuid,text,text,text,integer,currency,text) to service_role;
revoke all on function public.propose_order_resolution(uuid,uuid,text,integer,currency,boolean,text,text,text), public.decide_order_resolution(uuid,uuid,text,text,text), public.record_order_return_shipment_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb), public.prepare_order_refund_resolution(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.propose_order_resolution(uuid,uuid,text,integer,currency,boolean,text,text,text), public.decide_order_resolution(uuid,uuid,text,text,text), public.record_order_return_shipment_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb), public.prepare_order_refund_resolution(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer) to service_role;
