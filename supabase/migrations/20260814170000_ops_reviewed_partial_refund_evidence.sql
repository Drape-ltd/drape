-- Evidence-first partial refunds for Ops review.
-- Provider execution remains behind the existing Money Desk maker/checker gate.

create or replace function public.prepare_ops_partial_refund_resolution(
  p_order_id text,
  p_ops_issue_id uuid,
  p_actor_email text,
  p_reason_code text,
  p_decision_basis text,
  p_summary text,
  p_amount integer,
  p_currency currency,
  p_tailor_work integer,
  p_platform_fee integer,
  p_tax integer,
  p_fulfillment integer,
  p_consultation integer,
  p_promotion integer,
  p_drapeon_funded integer,
  p_released_tailor_recovery integer,
  p_evidence_source text,
  p_external_reference text,
  p_source_received_at timestamptz,
  p_evidence_visibility text,
  p_storage_bucket text default null,
  p_storage_object_path text default null,
  p_mime_type text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_issue public.ops_issues%rowtype;
  v_case public.financial_cases%rowtype;
  v_resolution public.order_refund_resolutions%rowtype;
  v_request_hash text;
  v_existing_hash text;
  v_refundable integer;
  v_payment_currency text;
  v_cash_total integer;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'A partial-refund idempotency key is required.';
  end if;
  if nullif(trim(coalesce(p_actor_email, '')), '') is null then
    raise exception 'A named Ops identity is required.';
  end if;
  if p_reason_code not in ('TAILOR_INACTIVITY','QUALITY_ADJUSTMENT','LATE_DELIVERY','FULFILLMENT_ISSUE','BILLING_CORRECTION','GOODWILL','OTHER_REVIEWED') then
    raise exception 'Choose a valid partial-refund reason.';
  end if;
  if p_decision_basis not in ('MUTUAL_AGREEMENT','POLICY_ENTITLEMENT','SERVICE_RECOVERY','OPS_EXCEPTION') then
    raise exception 'Choose the reviewed decision basis.';
  end if;
  if p_evidence_source not in ('EMAIL_INGEST','WHATSAPP_SUMMARY','PLATFORM_MESSAGE','CALL_PROVIDER','OPS_NOTE') then
    raise exception 'Choose a supported evidence source.';
  end if;
  if p_evidence_visibility not in ('PARTIES','OPS_ONLY') then
    raise exception 'Choose who may view the source evidence.';
  end if;
  if char_length(trim(coalesce(p_summary, ''))) not between 12 and 2000 then
    raise exception 'The party-safe resolution summary must be 12 to 2000 characters.';
  end if;
  if char_length(trim(coalesce(p_external_reference, ''))) not between 3 and 500 then
    raise exception 'Record a source reference such as an email thread, WhatsApp date, Drapeon message, call, or Ops note.';
  end if;
  if p_source_received_at is null or p_source_received_at > now() + interval '5 minutes' then
    raise exception 'Record when the source evidence was received.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Partial refund amount must be positive.'; end if;
  if least(p_tailor_work,p_platform_fee,p_tax,p_fulfillment,p_consultation,p_promotion,p_drapeon_funded,p_released_tailor_recovery) < 0 then
    raise exception 'Refund restoration amounts cannot be negative.';
  end if;
  v_cash_total := p_tailor_work + p_platform_fee + p_tax + p_fulfillment + p_consultation;
  if v_cash_total <> p_amount then raise exception 'Refund cash lines must equal the partial refund amount exactly.'; end if;
  if p_released_tailor_recovery > p_drapeon_funded then
    raise exception 'Released tailor value requires equal Drapeon funding and a separate recovery action.';
  end if;
  if p_storage_bucket is not null and p_storage_bucket <> 'commercial-evidence' then
    raise exception 'Refund evidence must use the private commercial-evidence bucket.';
  end if;
  if p_storage_bucket is not null and nullif(trim(coalesce(p_storage_object_path, '')), '') is null then
    raise exception 'A private storage path is required with an evidence bucket.';
  end if;
  if p_storage_object_path is not null and p_storage_object_path not like p_order_id || '/ops-refunds/%' then
    raise exception 'Refund evidence must remain inside the order evidence folder.';
  end if;
  if p_mime_type is not null and p_mime_type not in ('image/jpeg','image/png','image/webp') then
    raise exception 'Refund evidence must be a JPEG, PNG, or WebP image.';
  end if;

  select * into v_order from public.orders where id::text = p_order_id::text for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;
  if v_order.stage::text <> 'IN_DISPUTE' then
    raise exception 'A reviewed partial refund requires the order to remain under dispute review.';
  end if;
  if coalesce(v_order.currency::text, v_order.quoted_currency::text) is distinct from p_currency::text then
    raise exception 'Partial refund currency must match the captured order currency.';
  end if;

  select * into v_issue from public.ops_issues where id = p_ops_issue_id for update;
  if v_issue.id is null or v_issue.order_id::text is distinct from p_order_id or v_issue.status = 'RESOLVED' then
    raise exception 'Choose an open Ops issue belonging to this order.';
  end if;

  select coalesce(sum(op.amount - coalesce(op.refunded_amount, 0)), 0), min(op.currency::text)
  into v_refundable, v_payment_currency
  from public.order_payments op
  where op.order_id::text = p_order_id
    and op.phase::text = 'INITIAL_ORDER'
    and op.status::text in ('SUCCEEDED','PARTIAL_REFUND');
  if v_payment_currency is distinct from p_currency::text then raise exception 'Captured payment currency does not match the refund.'; end if;
  if p_amount >= v_refundable then raise exception 'A partial refund must be below the remaining refundable balance.'; end if;

  v_request_hash := encode(digest(concat_ws('|', p_order_id, p_ops_issue_id::text, lower(trim(p_actor_email)),
    p_reason_code, p_decision_basis, trim(p_summary), p_amount::text, p_currency::text,
    p_tailor_work::text, p_platform_fee::text, p_tax::text, p_fulfillment::text,
    p_consultation::text, p_promotion::text, p_drapeon_funded::text,
    p_released_tailor_recovery::text, p_evidence_source, trim(p_external_reference),
    p_source_received_at::text, p_evidence_visibility,
    coalesce(p_storage_bucket, ''), coalesce(p_storage_object_path, ''), coalesce(p_mime_type, '')), 'sha256'), 'hex');

  select request_hash into v_existing_hash from public.financial_cases where idempotency_key = p_idempotency_key;
  if v_existing_hash is not null then
    if v_existing_hash <> v_request_hash then raise exception 'Partial-refund idempotency key was reused with different evidence or amounts.'; end if;
    select * into v_case from public.financial_cases where idempotency_key = p_idempotency_key;
    select * into v_resolution from public.order_refund_resolutions where financial_case_id = v_case.id order by created_at desc limit 1;
    return jsonb_build_object('caseId',v_case.id,'caseReference',v_case.reference,'resolutionId',v_resolution.id,
      'resolutionReference',v_resolution.reference,'amount',v_resolution.amount,'currency',v_resolution.currency,
      'status',v_resolution.status,'duplicate',true,'correlationId',v_case.correlation_id);
  end if;

  insert into public.financial_cases (
    idempotency_key,request_hash,order_id,legacy_dispute_id,case_type,status,opened_by,opened_by_role,
    counterparty_id,reason_code,summary,claim_details,requested_outcome,requested_amount,requested_currency,
    money_movement_blocked,eligibility_status,eligibility_snapshot,policy_version,correlation_id
  ) values (
    p_idempotency_key,v_request_hash,p_order_id,null,'REFUND','OPS_REVIEW',null,'OPS',v_order.tailor_id::uuid,
    p_reason_code,trim(p_summary),jsonb_build_object(
      'opsIssueId',p_ops_issue_id,'decisionBasis',p_decision_basis,'evidenceSource',p_evidence_source,
      'externalReference',trim(p_external_reference),'sourceReceivedAt',p_source_received_at,
      'evidenceVisibility',p_evidence_visibility,'productionStagePreserved',v_order.stage
    ),'PARTIAL_REFUND',p_amount,p_currency,true,'OPS_REVIEW',jsonb_build_object(
      'evaluatedAt',now(),'remainingRefundableAmount',v_refundable,'payoutHeld',true
    ),coalesce(nullif(v_order.commercial_policy_version,''),'ops-partial-refund-2026-08-14-v1'),p_correlation_id
  ) returning * into v_case;

  insert into public.financial_case_evidence (
    case_id,evidence_type,source,evidence_tier,verification_status,visibility,
    source_table,source_record_id,metadata,submitted_by,submitted_by_role,captured_at
  ) values
    (v_case.id,'ORDER_STATE_AT_REVIEW','PLATFORM_ORDER',null,'CORROBORATED','PARTIES','orders',p_order_id,
      jsonb_build_object('stage',v_order.stage,'capturedAt',now()),null,'OPS',now()),
    (v_case.id,'ORDER_TIMELINE_THROUGH_REVIEW','PLATFORM_TIMELINE',null,'CORROBORATED','PARTIES','order_stage_updates',p_order_id,
      jsonb_build_object('cutoffAt',now()),null,'OPS',now()),
    (v_case.id,'ORDER_MESSAGES_THROUGH_REVIEW','PLATFORM_MESSAGE','D','CLAIMED','PARTIES','messages',p_order_id,
      jsonb_build_object('cutoffAt',now()),null,'OPS',now());

  insert into public.financial_case_evidence (
    case_id,evidence_type,source,evidence_tier,verification_status,visibility,
    storage_bucket,storage_object_path,external_reference,source_table,source_record_id,
    mime_type,metadata,submitted_by,submitted_by_role,captured_at
  ) values (
    v_case.id,'OPS_PARTIAL_REFUND_BASIS',p_evidence_source,'D','CLAIMED',p_evidence_visibility,
    nullif(trim(coalesce(p_storage_bucket,'')),''),nullif(trim(coalesce(p_storage_object_path,'')),''),
    trim(p_external_reference),case when p_evidence_source='OPS_NOTE' then 'ops_issues' when p_evidence_source='PLATFORM_MESSAGE' then 'messages' else null end,
    case when p_evidence_source='OPS_NOTE' then p_ops_issue_id::text else null end,
    nullif(trim(coalesce(p_mime_type,'')),''),jsonb_build_object(
      'decisionBasis',p_decision_basis,'sourceReceivedAt',p_source_received_at,'reviewedBy',lower(trim(p_actor_email))
    ),null,'OPS',p_source_received_at
  );

  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,visibility,payload,correlation_id)
  values
    (v_case.id,'CASE_OPENED',null,'OPS','PARTIES',jsonb_build_object('reasonCode',p_reason_code,'requestedOutcome','PARTIAL_REFUND','amount',p_amount,'currency',p_currency),v_case.correlation_id),
    (v_case.id,'EVIDENCE_ADDED',null,'OPS',p_evidence_visibility,jsonb_build_object('evidenceType','OPS_PARTIAL_REFUND_BASIS','source',p_evidence_source,'externalReference',trim(p_external_reference)),v_case.correlation_id),
    (v_case.id,'ELIGIBILITY_RECORDED',null,'OPS','PARTIES',jsonb_build_object('status','OPS_REVIEW','decisionBasis',p_decision_basis,'amount',p_amount,'currency',p_currency),v_case.correlation_id);

  insert into public.order_refund_resolutions(
    return_request_id,financial_case_id,order_id,proposal_id,amount,currency,
    tailor_work_amount,platform_fee_amount,tax_amount,fulfillment_amount,consultation_amount,
    promotion_amount,drapeon_funded_amount,released_tailor_recovery_amount,policy_version,correlation_id
  ) values (
    null,v_case.id,p_order_id,null,p_amount,p_currency,p_tailor_work,p_platform_fee,p_tax,p_fulfillment,
    p_consultation,p_promotion,p_drapeon_funded,p_released_tailor_recovery,
    'ops-partial-refund-2026-08-14-v1',v_case.correlation_id
  ) returning * into v_resolution;

  update public.ops_issues set status='IN_REVIEW',assigned_to=lower(trim(p_actor_email)),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('financial_case_id',v_case.id,'refund_resolution_id',v_resolution.id),
    updated_at=now() where id=p_ops_issue_id;

  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(p_ops_issue_id,'OPS_PARTIAL_REFUND_PREPARED',lower(trim(p_actor_email)),'OPS',trim(p_summary),
    jsonb_build_object('orderId',p_order_id,'status',v_issue.status),
    jsonb_build_object('status','IN_REVIEW','financialCaseId',v_case.id,'refundResolutionId',v_resolution.id,'amount',p_amount,'currency',p_currency));
  insert into public.audit_logs(actor_role,order_id,event,severity,payload)
  values('OPS',p_order_id::uuid,'ops.partial_refund_resolution_prepared','warn',jsonb_build_object(
    'actor_email',lower(trim(p_actor_email)),'case_id',v_case.id,'resolution_id',v_resolution.id,
    'ops_issue_id',p_ops_issue_id,'reason_code',p_reason_code,'decision_basis',p_decision_basis,
    'amount',p_amount,'currency',p_currency,'evidence_source',p_evidence_source,
    'evidence_visibility',p_evidence_visibility,'correlation_id',v_case.correlation_id));

  return jsonb_build_object('caseId',v_case.id,'caseReference',v_case.reference,'resolutionId',v_resolution.id,
    'resolutionReference',v_resolution.reference,'amount',v_resolution.amount,'currency',v_resolution.currency,
    'status',v_resolution.status,'duplicate',false,'correlationId',v_case.correlation_id);
end;
$$;

revoke all on function public.prepare_ops_partial_refund_resolution(text,uuid,text,text,text,text,integer,currency,integer,integer,integer,integer,integer,integer,integer,integer,text,text,timestamptz,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_ops_partial_refund_resolution(text,uuid,text,text,text,text,integer,currency,integer,integer,integer,integer,integer,integer,integer,integer,text,text,timestamptz,text,text,text,text,text,uuid) to service_role;

comment on function public.prepare_ops_partial_refund_resolution(text,uuid,text,text,text,text,integer,currency,integer,integer,integer,integer,integer,integer,integer,integer,text,text,timestamptz,text,text,text,text,text,uuid)
is 'Creates an evidence-backed partial-refund case and exact restoration resolution without moving money or changing the production stage.';
