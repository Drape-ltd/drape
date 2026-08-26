-- The deployed compatibility disputes table uses text primary keys but keeps
-- customer_id as uuid. Replace the new RPC with the exact deployed types.

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

  v_request_hash := encode(digest(concat_ws('|', p_order_id, p_customer_id::text,
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
      'orders', p_order_id,
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
