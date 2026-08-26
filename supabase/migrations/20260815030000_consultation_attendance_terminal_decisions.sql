-- Authoritative Ops outcomes for contested consultation attendance.
-- Money outcomes are decisions only: provider movement remains behind Money Desk.

alter table public.consultation_attendance_reviews
  add column if not exists ops_decision text,
  add column if not exists ops_decision_note text,
  add column if not exists ops_decided_by text,
  add column if not exists ops_decided_at timestamptz,
  add column if not exists money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict;

alter table public.consultation_attendance_reviews
  add constraint consultation_attendance_reviews_ops_decision_check check (
    ops_decision is null or ops_decision in ('RESCHEDULE', 'CUSTOMER_REFUND', 'TAILOR_EARNING')
  ),
  add constraint consultation_attendance_reviews_ops_note_check check (
    ops_decision_note is null or char_length(ops_decision_note) between 12 and 1000
  );

create or replace function public.resolve_consultation_attendance_review(
  p_review_id uuid,
  p_decision text,
  p_note text,
  p_actor_email text,
  p_money_desk_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.consultation_attendance_reviews%rowtype;
  v_booking public.consultation_bookings%rowtype;
  v_resolution text;
begin
  if upper(trim(coalesce(p_decision, ''))) not in ('RESCHEDULE', 'CUSTOMER_REFUND', 'TAILOR_EARNING') then
    raise exception 'Choose reschedule, customer refund, or verified tailor earning.';
  end if;
  if char_length(trim(coalesce(p_note, ''))) not between 12 and 1000 then
    raise exception 'Record the evidence-based decision in 12 to 1,000 characters.';
  end if;
  if nullif(trim(coalesce(p_actor_email, '')), '') is null then
    raise exception 'A named Ops identity is required.';
  end if;
  if upper(trim(p_decision)) <> 'RESCHEDULE' and p_money_desk_request_id is null then
    raise exception 'Money decisions require an independently approved Money Desk request.';
  end if;

  select * into v_review
  from public.consultation_attendance_reviews
  where id = p_review_id
  for update;
  if v_review.id is null then raise exception 'Attendance review was not found.'; end if;

  if v_review.status = 'RESOLVED' then
    if v_review.ops_decision = upper(trim(p_decision))
      and v_review.money_desk_request_id is not distinct from p_money_desk_request_id then
      return jsonb_build_object(
        'reviewId', v_review.id,
        'bookingId', v_review.booking_id,
        'orderId', v_review.order_id,
        'decision', v_review.ops_decision,
        'resolutionCode', v_review.resolution_code,
        'existing', true
      );
    end if;
    raise exception 'This attendance review already has a different terminal decision.';
  end if;
  if v_review.status <> 'OPS_REVIEW' then
    raise exception 'This attendance review is not ready for an Ops decision.';
  end if;

  select * into v_booking from public.consultation_bookings where id = v_review.booking_id for update;
  if v_booking.id is null then raise exception 'Consultation booking was not found.'; end if;

  v_resolution := case upper(trim(p_decision))
    when 'RESCHEDULE' then 'RESCHEDULE_REQUIRED'
    when 'CUSTOMER_REFUND' then 'CUSTOMER_REFUND_APPROVED'
    else 'TAILOR_EARNING_VERIFIED'
  end;

  update public.consultation_attendance_reviews
  set status = 'RESOLVED',
      resolution_code = v_resolution,
      resolved_at = now(),
      ops_decision = upper(trim(p_decision)),
      ops_decision_note = trim(p_note),
      ops_decided_by = lower(trim(p_actor_email)),
      ops_decided_at = now(),
      money_desk_request_id = p_money_desk_request_id,
      updated_at = now()
  where id = v_review.id;

  update public.financial_cases
  set status = 'RESOLVED',
      money_movement_blocked = upper(trim(p_decision)) = 'RESCHEDULE',
      eligibility_status = case when upper(trim(p_decision)) = 'RESCHEDULE' then 'NOT_EVALUATED' else 'ELIGIBLE' end,
      resolved_at = now(),
      resolution_code = v_resolution,
      resolution_summary = trim(p_note),
      updated_at = now()
  where id = v_review.financial_case_id;

  update public.consultation_bookings
  set settlement_status = case upper(trim(p_decision))
        when 'RESCHEDULE' then case when fee_mode = 'PAID' and payment_status = 'PAID' then 'HELD' else 'NOT_REQUIRED' end
        when 'CUSTOMER_REFUND' then 'REFUND_PENDING'
        else 'EARNED'
      end,
      settlement_outcome = v_resolution,
      earned_amount = case when upper(trim(p_decision)) = 'TAILOR_EARNING' then coalesce(fee_amount, 0) else 0 end,
      refunded_amount = 0,
      settlement_eligible_at = case when upper(trim(p_decision)) = 'TAILOR_EARNING' then now() else null end,
      settlement_failure_reason = null,
      updated_at = now()
  where id = v_booking.id;

  insert into public.financial_case_events (
    case_id, event_type, actor_role, visibility, payload, correlation_id
  ) values (
    v_review.financial_case_id, 'CASE_RESOLVED', 'OPS', 'PARTIES',
    jsonb_build_object(
      'bookingId', v_booking.id,
      'decision', upper(trim(p_decision)),
      'resolutionCode', v_resolution,
      'moneyDeskRequestId', p_money_desk_request_id,
      'note', trim(p_note),
      'decidedBy', lower(trim(p_actor_email))
    ),
    v_booking.commercial_correlation_id
  );

  update public.ops_issues
  set status = case when upper(trim(p_decision)) = 'RESCHEDULE' then 'RESOLVED' else 'IN_REVIEW' end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'attendance_resolution_code', v_resolution,
        'attendance_decision', upper(trim(p_decision)),
        'money_desk_request_id', p_money_desk_request_id,
        'ops_decided_by', lower(trim(p_actor_email))
      ),
      updated_at = now()
  where related_entity_type = 'CONSULTATION_BOOKING'
    and related_entity_id = v_booking.id::text
    and status in ('OPEN', 'IN_REVIEW', 'ESCALATED');

  return jsonb_build_object(
    'reviewId', v_review.id,
    'bookingId', v_booking.id,
    'orderId', v_review.order_id,
    'customerId', v_booking.customer_id,
    'tailorId', v_booking.tailor_id,
    'decision', upper(trim(p_decision)),
    'resolutionCode', v_resolution,
    'moneyDeskRequestId', p_money_desk_request_id,
    'existing', false
  );
end;
$$;

revoke all on function public.resolve_consultation_attendance_review(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_consultation_attendance_review(uuid, text, text, text, uuid) to service_role;

comment on function public.resolve_consultation_attendance_review(uuid, text, text, text, uuid) is
  'Records the single terminal Ops attendance decision. Refund and earning decisions must reference a Money Desk request; no provider money moves in this function.';
