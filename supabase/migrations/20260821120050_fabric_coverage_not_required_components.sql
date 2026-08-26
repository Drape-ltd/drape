-- Quote coverage defines which material categories may use the protected allowance.
-- It does not require a separate funded purchase for every selected category.
-- Only explicitly submitted candidates participate in the Cutting gate; a new
-- tailor-sourced order still requires one primary FABRIC candidate by default.

create or replace function public.get_order_fabric_cutting_blockers_v2(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
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
    elsif v_handoff.status in ('RECEIVED_WITH_ISSUE','REPLACEMENT_REQUIRED') then
      return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_ISSUE_UNRESOLVED','message','Resolve the reported fabric issue before cutting.','recoveryAction','RESOLVE_FABRIC_ISSUE'));
    else
      if v_handoff.status not in ('RECEIVED_SUITABLE','CONTINUE_AUTHORIZED') then return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_RECEIPT_REQUIRED','message','Confirm that the customer fabric was received and suitable.','recoveryAction','CONFIRM_FABRIC_RECEIPT')); end if;
      if jsonb_array_length(v_handoff.received_media)=0 then return jsonb_build_array(jsonb_build_object('code','CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED','message','Upload fresh proof of the received customer fabric.','recoveryAction','CONFIRM_FABRIC_RECEIPT')); end if;
      return '[]'::jsonb;
    end if;
  end if;
  select * into v_allocation from public.order_fabric_funding_allocations where order_id=p_order_id;
  if v_allocation.id is null then return jsonb_build_array(jsonb_build_object('code','FABRIC_CANDIDATE_REQUIRED','componentCode','FABRIC','message','The protected material allocation is not ready.','recoveryAction','SUBMIT_FABRIC_CANDIDATE')); end if;

  if jsonb_array_length(v_components)=0 then
    select coalesce(jsonb_agg(component_code order by component_code), '[]'::jsonb)
      into v_components
      from (
        select distinct component_code
        from public.order_fabric_candidates
        where order_id=p_order_id and status not in ('DECLINED','SUPERSEDED')
      ) explicit_components;
    if jsonb_array_length(v_components)=0 then v_components:='["FABRIC"]'::jsonb; end if;
  end if;

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
end
$$;

comment on function public.get_order_fabric_cutting_blockers_v2(text) is
  'Returns the first actionable blocker for explicitly submitted fabric candidates; quote coverage is eligibility, not a required-component list.';
