create or replace function public.propose_order_resolution(
  p_return_request_id uuid,p_actor_id uuid,p_remedy text,p_amount integer,p_currency currency,
  p_return_required boolean,p_shipping_responsibility text,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare rr public.order_return_requests%rowtype; o public.orders%rowtype; p public.order_resolution_proposals%rowtype; actor_role text; next_version integer; req_hash text;
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
