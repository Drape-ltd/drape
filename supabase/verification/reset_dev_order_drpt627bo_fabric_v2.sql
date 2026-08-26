-- DEV ONLY: audited policy-v2 reset for #DRPT627BO.
-- This script is intentionally not a migration and must never run in production.
begin;

do $$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_allocation public.order_fabric_funding_allocations%rowtype;
  v_payment public.order_payments%rowtype;
begin
  select * into v_order from public.orders
  where id='668d3d73-84fa-4d9a-a2f7-213aecd4a953' and upper(reference)='DRPT627BO'
  for update;
  if v_order.id is null then raise exception 'DEV_RESET_ORDER_MISMATCH'; end if;
  if v_order.stage::text<>'DESIGNING' then raise exception 'DEV_RESET_STAGE_MUST_BE_DESIGNING:%',v_order.stage; end if;
  if v_order.fabric_source::text<>'TAILOR_SOURCES' then raise exception 'DEV_RESET_TAILOR_SOURCE_REQUIRED'; end if;

  select * into v_quote from public.order_quotes where order_id=v_order.id and status='ACCEPTED' order by version desc limit 1;
  if v_quote.id is null then raise exception 'DEV_RESET_ACCEPTED_QUOTE_REQUIRED'; end if;
  -- Commercial amounts are stored in minor units. This accepted quote's
  -- NGN 195,000 seller allocation is NGN 145,000 tailoring plus NGN 50,000 fabric.
  if v_quote.tailoring_amount<>14500000 or v_quote.fabric_allowance_amount<>5000000
     or v_quote.tailoring_amount+v_quote.fabric_allowance_amount<>19500000 then
    raise exception 'DEV_RESET_QUOTE_ALLOCATION_MISMATCH:%:%',v_quote.tailoring_amount,v_quote.fabric_allowance_amount;
  end if;

  select * into v_payment from public.order_payments where order_id=v_order.id and phase='INITIAL_ORDER' and status in ('SUCCEEDED','PARTIAL_REFUND') and ledger_recorded_at is not null order by confirmed_at desc nulls last limit 1;
  if v_payment.id is null then raise exception 'DEV_RESET_LEDGER_RECORDED_PAYMENT_REQUIRED'; end if;

  select * into v_allocation from public.order_fabric_funding_allocations where order_id=v_order.id for update;
  if v_allocation.id is null then raise exception 'DEV_RESET_ALLOCATION_REQUIRED'; end if;
  if v_allocation.released_amount<>0 then raise exception 'DEV_RESET_PRIOR_FABRIC_RELEASE_EXISTS:%',v_allocation.released_amount; end if;
  if exists(select 1 from public.order_material_advances where order_id=v_order.id and provider_release_status='SUCCEEDED') then raise exception 'DEV_RESET_PRIOR_PROVIDER_RELEASE_EXISTS'; end if;
  if exists(select 1 from public.order_fabric_candidates where order_id=v_order.id and provider_status='SUCCEEDED') then raise exception 'DEV_RESET_PRIOR_V2_RELEASE_EXISTS'; end if;

  alter table public.order_quotes disable trigger trg_prevent_order_quote_payload_mutation;
  alter table public.order_fabric_funding_allocations disable trigger fabric_funding_allocation_identity_immutable;
  update public.orders set fabric_funding_policy_version='fabric-funding-2026-08-21-v2',stage='DESIGNING',stage_updated_at=now(),updated_at=now() where id=v_order.id;
  update public.order_quotes set fabric_funding_policy_version='fabric-funding-2026-08-21-v2' where id=v_quote.id;
  update public.order_fabric_funding_allocations set policy_version='fabric-funding-2026-08-21-v2',status='FUNDED',funded_amount=base_allowance_amount,paid_adjustment_amount=0,released_amount=0,refunded_amount=0,reconciled_spend_amount=null,reconciled_at=null,updated_at=now() where id=v_allocation.id;
  alter table public.order_quotes enable trigger trg_prevent_order_quote_payload_mutation;
  alter table public.order_fabric_funding_allocations enable trigger fabric_funding_allocation_identity_immutable;

  update public.custom_order_details set fabric_approval_required=true,fabric_approval_status='PENDING_TAILOR_UPLOAD',fabric_approval_requested_at=null,fabric_approved_at=null,fabric_changes_requested_at=null,fabric_marked_unsuitable_at=null,updated_at=now() where order_id=v_order.id;
  update public.order_fabric_candidates set status='SUPERSEDED' where order_id=v_order.id and status<>'SUPERSEDED';
  insert into public.order_fabric_events(order_id,event_type,actor_role,payload,correlation_id)
  values(v_order.id,'DEV_POLICY_V2_RESET','OPS',jsonb_build_object('reference','DRPT627BO','previousPolicy',v_order.fabric_funding_policy_version,'newPolicy','fabric-funding-2026-08-21-v2','acceptedQuoteId',v_quote.id,'paymentId',v_payment.id,'sellerAllocationAmount',v_allocation.tailoring_amount+v_allocation.base_allowance_amount,'tailoringSettlementAmount',v_allocation.tailoring_amount,'fabricAllowanceAmount',v_allocation.base_allowance_amount,'priorApprovalSuperseded',true,'historyDeleted',false),v_allocation.correlation_id);
  insert into public.audit_logs(actor_role,order_id,event,severity,payload)
  values('OPS',v_order.id::uuid,'fabric.policy_v2.dev_reset','info',jsonb_build_object('reference','DRPT627BO','quoteId',v_quote.id,'allocationId',v_allocation.id,'paymentId',v_payment.id,'noPriorRelease',true,'historyPreserved',true));
  insert into public.order_stage_updates(order_id,stage,note)
  values(v_order.id,v_order.stage,'DEV dry run: the previous fabric approval was superseded without deleting history. The tailor must find and submit an exact policy-v2 fabric candidate.');
end $$;

commit;
