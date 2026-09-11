-- Finish approved cancellation refunds from either the initial provider call or
-- a later webhook. The immutable Money Desk payment snapshot is authoritative;
-- the function remains PROCESSING until every approved payment claim is fully
-- refunded, then closes the order, dispute, linked issues, and execution attempt
-- in one database transaction.

create or replace function public.finalize_ops_order_cancellation_refund(
  p_money_desk_request_id uuid,
  p_dispute_id uuid,
  p_provider_reference text default null,
  p_actor_email text default null,
  p_actor_role text default 'SYSTEM'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_order public.orders%rowtype;
  v_dispute public.disputes%rowtype;
  v_attempt public.money_desk_execution_attempts%rowtype;
  v_claim_count integer;
  v_incomplete_count integer;
  v_note text;
  v_issue record;
  v_resolved_at timestamptz := now();
begin
  select * into v_request
  from public.money_desk_requests
  where id = p_money_desk_request_id
  for update;

  if v_request.id is null then raise exception 'Money Desk cancellation request was not found.'; end if;
  if v_request.action_type <> 'CUSTOMER_REFUND' or v_request.target_type <> 'ORDER_CANCELLATION' then
    raise exception 'Money Desk request is not an order cancellation refund.';
  end if;
  if v_request.order_id is null or v_request.order_id <> v_request.target_id then
    raise exception 'Cancellation request is missing its immutable order link.';
  end if;
  if coalesce(v_request.action_payload->>'disputeId', '') <> p_dispute_id::text then
    raise exception 'Cancellation dispute does not match the approved request.';
  end if;
  if v_request.status = 'FAILED' then
    return jsonb_build_object(
      'requestId', v_request.id,
      'orderId', v_request.order_id,
      'status', 'FAILED',
      'remainingClaimCount', null,
      'duplicate', true
    );
  end if;
  if v_request.status not in ('EXECUTING', 'SUCCEEDED') then
    raise exception 'Cancellation request is not executing.';
  end if;

  select * into v_order from public.orders where id::text = v_request.order_id for update;
  if v_order.id is null then raise exception 'Cancellation order was not found.'; end if;

  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if v_dispute.id is null or v_dispute.order_id::text <> v_order.id::text then
    raise exception 'Cancellation dispute was not found for this order.';
  end if;

  select count(*) into v_claim_count
  from jsonb_array_elements(coalesce(v_request.action_payload->'paymentClaims', '[]'::jsonb));
  if v_claim_count = 0 then raise exception 'Cancellation request has no approved payment claims.'; end if;

  select count(*) into v_incomplete_count
  from jsonb_array_elements(v_request.action_payload->'paymentClaims') claim
  left join public.order_payments payment
    on payment.id::text = claim->>'paymentId'
   and payment.order_id::text = v_order.id::text
  where payment.id is null
     or payment.status::text <> 'REFUNDED'
     or coalesce(payment.refunded_amount, 0) < payment.amount;

  if v_incomplete_count > 0 then
    return jsonb_build_object(
      'requestId', v_request.id,
      'orderId', v_order.id,
      'status', 'PROCESSING',
      'remainingClaimCount', v_incomplete_count,
      'duplicate', false
    );
  end if;

  v_note := 'Drapeon approved cancellation and every captured, unreleased payment reached a recorded refund. '
    || coalesce(nullif(trim(v_request.action_payload->>'note'), ''), v_request.reason);

  perform public.finalize_order_terminal(
    v_order.id,
    'REFUNDED',
    null,
    upper(coalesce(nullif(trim(p_actor_role), ''), 'SYSTEM')),
    'ops.order_cancellation_refund_completed',
    v_note,
    jsonb_build_object(
      'money_desk_request_id', v_request.id,
      'refunded_payment_count', v_claim_count,
      'amount', v_request.amount,
      'currency', v_request.currency,
      'provider_reference', nullif(trim(coalesce(p_provider_reference, '')), '')
    ),
    case when v_order.stage::text = 'REFUNDED' then null else array['IN_DISPUTE']::text[] end,
    null,
    false,
    true,
    true,
    false
  );

  if v_dispute.status::text in ('OPEN', 'UNDER_REVIEW') then
    update public.disputes set
      status = 'RESOLVED_REFUNDED',
      resolution = v_note,
      resolved_at = v_resolved_at,
      resolved_by = nullif(trim(coalesce(p_actor_email, '')), ''),
      updated_at = v_resolved_at
    where id = v_dispute.id;
  elsif v_dispute.status::text <> 'RESOLVED_REFUNDED' then
    raise exception 'Cancellation dispute reached a conflicting terminal state.';
  end if;

  update public.order_material_advances set
    status = 'CANCELLED',
    release_status = 'BLOCKED',
    reconciliation_status = 'RESOLVED',
    reconciliation_outcome = 'UNUSED_VALUE',
    reconciled_at = coalesce(reconciled_at, v_resolved_at),
    reconciliation_resolved_at = coalesce(reconciliation_resolved_at, v_resolved_at),
    reconciliation_resolution = 'CUSTOMER_REFUNDED'
  where id::text in (
    select claim->>'materialAdvanceId'
    from jsonb_array_elements(v_request.action_payload->'paymentClaims') claim
    where nullif(claim->>'materialAdvanceId', '') is not null
  );

  for v_issue in
    select id, status, assigned_to, resolved_at
    from public.ops_issues
    where order_id::text = v_order.id::text
      and issue_type in ('PRODUCTION_STALL', 'PAYOUT_BLOCKED', 'ORDER_REVIEW', 'REFUND_FAILED')
      and status <> 'RESOLVED'
    for update
  loop
    update public.ops_issues set
      status = 'RESOLVED',
      assigned_to = coalesce(nullif(trim(coalesce(p_actor_email, '')), ''), assigned_to),
      resolved_at = v_resolved_at,
      last_seen_at = v_resolved_at
    where id = v_issue.id;

    insert into public.ops_audit_logs (
      issue_id, action_taken, performed_by, performed_role, reason, before_state, after_state
    ) values (
      v_issue.id,
      'ORDER_CANCELLATION_REFUND_COMPLETED',
      nullif(trim(coalesce(p_actor_email, '')), ''),
      upper(coalesce(nullif(trim(p_actor_role), ''), 'SYSTEM')),
      v_note,
      jsonb_build_object('status', v_issue.status, 'assigned_to', v_issue.assigned_to, 'resolved_at', v_issue.resolved_at),
      jsonb_build_object('status', 'RESOLVED', 'resolved_at', v_resolved_at, 'money_desk_request_id', v_request.id)
    );
  end loop;

  if v_request.status = 'EXECUTING' then
    select * into v_attempt
    from public.money_desk_execution_attempts
    where request_id = v_request.id and status = 'PROCESSING'
    order by started_at desc
    limit 1
    for update;
    if v_attempt.id is null then raise exception 'Cancellation execution attempt was not found.'; end if;

    perform public.complete_money_desk_execution(
      v_attempt.id,
      'SUCCEEDED',
      nullif(trim(coalesce(p_provider_reference, '')), ''),
      null,
      null
    );
  end if;

  return jsonb_build_object(
    'requestId', v_request.id,
    'orderId', v_order.id,
    'disputeId', v_dispute.id,
    'status', 'SUCCEEDED',
    'remainingClaimCount', 0,
    'duplicate', v_request.status = 'SUCCEEDED'
  );
end;
$$;

revoke all on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) to service_role;

comment on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) is
  'Idempotently closes an approved cancellation only after every immutable Money Desk payment claim is fully refunded.';
