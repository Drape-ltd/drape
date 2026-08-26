-- Rollback-only proof for Implementation 9 case, negotiation, and restoration invariants.
do $verification$
declare
  v_order public.orders%rowtype;
  v_customer uuid;
  v_tailor uuid;
  v_key text := 'verify-return:'||gen_random_uuid()::text;
  v_open jsonb;
  v_duplicate jsonb;
  v_return public.order_return_requests%rowtype;
  v_proposal jsonb;
  v_proposal_id uuid;
  v_decision jsonb;
  v_refund jsonb;
begin
  begin
    select o.* into v_order from public.orders o
    where o.customer_id is not null and o.tailor_id is not null
      and exists(select 1 from auth.users u where u.id::text=o.customer_id::text)
      and exists(select 1 from auth.users u where u.id::text=o.tailor_id::text)
    order by o.created_at limit 1;
    if v_order.id is null then raise exception 'Implementation 9 verification requires one order with two live parties.'; end if;
    v_customer:=v_order.customer_id::uuid; v_tailor:=v_order.tailor_id::uuid;
    v_open:=public.create_order_return_request(v_order.id::text,v_customer,'NOT_RECEIVED','PARTIAL_REFUND','Verification return request with a protected refund discussion.',100,coalesce(v_order.currency,v_order.quoted_currency::currency,'USD'::currency),v_key);
    v_duplicate:=public.create_order_return_request(v_order.id::text,v_customer,'NOT_RECEIVED','PARTIAL_REFUND','Verification return request with a protected refund discussion.',100,coalesce(v_order.currency,v_order.quoted_currency::currency,'USD'::currency),v_key);
    if not (v_duplicate->>'existing')::boolean or v_duplicate->>'id'<>v_open->>'id' then raise exception 'Return request idempotency failed.'; end if;
    begin
      perform public.create_order_return_request(v_order.id::text,v_customer,'WRONG_ITEM','PARTIAL_REFUND','A different claim must not reuse the same idempotency key.',100,coalesce(v_order.currency,v_order.quoted_currency::currency,'USD'::currency),v_key);
      raise exception 'Return request hash mismatch was accepted.';
    exception when others then if sqlerrm not like 'Idempotency key was reused%' then raise; end if; end;
    select * into v_return from public.order_return_requests where id=(v_open->>'id')::uuid;
    begin update public.financial_cases set summary='Mutation must fail.' where id=v_return.financial_case_id; raise exception 'Return claim mutation was accepted.';
    exception when others then if sqlerrm not like 'Financial case claims are immutable%' then raise; end if; end;
    v_proposal:=public.propose_order_resolution(v_return.id,v_tailor,'PARTIAL_REFUND',100,v_return.currency,false,null,'Refund after delivery evidence reconciliation.',v_key||':proposal');
    v_proposal_id:=(v_proposal->>'id')::uuid;
    begin perform public.decide_order_resolution(v_proposal_id,v_tailor,'ACCEPTED',null,v_key||':self'); raise exception 'Proposer decided their own proposal.';
    exception when others then if sqlerrm not like 'The proposer cannot decide%' then raise; end if; end;
    v_decision:=public.decide_order_resolution(v_proposal_id,v_customer,'ACCEPTED','Accepted in workflow verification.',v_key||':decision');
    if v_decision->>'status'<>'REFUND_PENDING' then raise exception 'Accepted refund proposal did not enter refund pending.'; end if;
    begin perform public.prepare_order_refund_resolution(v_return.id,v_proposal_id,80,10,5,4,0,0,0,0); raise exception 'Unbalanced refund restoration was accepted.';
    exception when others then if sqlerrm not like 'Refund restoration must equal%' then raise; end if; end;
    v_refund:=public.prepare_order_refund_resolution(v_return.id,v_proposal_id,80,10,5,5,0,25,0,0);
    if (v_refund->>'amount')::integer<>100 or v_refund->>'status'<>'MONEY_DESK_REQUIRED' then raise exception 'Exact refund restoration was not prepared for Money Desk.'; end if;
    begin update public.order_resolution_decisions set note='Mutation must fail.' where proposal_id=v_proposal_id; raise exception 'Resolution decision mutation was accepted.';
    exception when others then if sqlerrm not like 'Resolution proposals and decisions are append-only%' then raise; end if; end;
    raise exception 'ROLLBACK_IMPLEMENTATION_9_PROOF';
  exception when others then
    if sqlerrm<>'ROLLBACK_IMPLEMENTATION_9_PROOF' then raise; end if;
  end;
  raise notice 'Implementation 9 idempotency, immutable claims, counterpart-only decisions, exact restoration, and Money Desk gating passed; synthetic rows rolled back.';
end;
$verification$;
