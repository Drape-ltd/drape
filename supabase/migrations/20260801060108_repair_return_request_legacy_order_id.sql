-- Production originally used UUID order primary keys while newer workflow RPCs
-- expose text IDs. Resolve through the generated compatibility key so the same
-- function works for both legacy production and clean text-ID installations.
create or replace function public.create_order_return_request(p_order_id text,p_actor_id uuid,p_reason_code text,p_requested_remedy text,p_summary text,p_requested_amount integer,p_currency currency,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare o public.orders%rowtype; r public.order_return_requests%rowtype; fc public.financial_cases%rowtype; actor_role text; counterparty uuid; eligibility text; eligibility_reason text; return_required boolean; delivered_at timestamptz; req_hash text; existing_hash text;
begin
  select * into o from public.orders where id::text=p_order_id::text for update;
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
