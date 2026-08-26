-- Close consultation attendance reports with an explicit counterpart decision.
-- Mutual confirmation of a missed call resolves to rescheduling with no money
-- movement; disputed accounts remain frozen for Ops review.

alter table public.consultation_attendance_reviews
  add column if not exists counterparty_response_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'consultation_attendance_reviews_response_code_check'
      and conrelid = 'public.consultation_attendance_reviews'::regclass
  ) then
    alter table public.consultation_attendance_reviews
      add constraint consultation_attendance_reviews_response_code_check
      check (
        counterparty_response_code is null
        or counterparty_response_code in ('AGREE_NO_CALL', 'I_ATTENDED', 'CONNECTION_ISSUE', 'OTHER')
      );
  end if;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.consultation_attendance_reviews;
exception when duplicate_object then null;
end;
$$;

create or replace function public.respond_to_consultation_attendance_report_v2(
  p_booking_id uuid,
  p_actor_id uuid,
  p_response_code text,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.consultation_attendance_reviews%rowtype;
  v_booking public.consultation_bookings%rowtype;
  v_actor_role text;
  v_case public.financial_cases%rowtype;
  v_resolved boolean;
  v_response text;
begin
  if p_response_code not in ('AGREE_NO_CALL', 'I_ATTENDED', 'CONNECTION_ISSUE', 'OTHER') then
    raise exception 'Choose what happened from your side.';
  end if;
  v_response := nullif(btrim(coalesce(p_response, '')), '');
  if p_response_code in ('CONNECTION_ISSUE', 'OTHER') and char_length(coalesce(v_response, '')) < 2 then
    raise exception 'Add a short explanation.';
  end if;

  select * into v_review
  from public.consultation_attendance_reviews
  where booking_id = p_booking_id
  for update;
  if v_review.id is null then raise exception 'Attendance report not found.'; end if;
  if v_review.status <> 'COUNTERPARTY_REVIEW' then
    return jsonb_build_object(
      'reviewId', v_review.id,
      'caseId', v_review.financial_case_id,
      'status', v_review.status,
      'resolutionCode', v_review.resolution_code,
      'existing', true
    );
  end if;

  select * into v_booking from public.consultation_bookings where id = p_booking_id;
  if v_booking.customer_id = p_actor_id then v_actor_role := 'CUSTOMER';
  elsif v_booking.tailor_id = p_actor_id then v_actor_role := 'TAILOR';
  else raise exception 'You are not part of this consultation.'; end if;
  if v_actor_role = v_review.reported_by_role then raise exception 'The counterpart must respond to this report.'; end if;

  v_resolved := p_response_code = 'AGREE_NO_CALL';
  update public.consultation_attendance_reviews set
    counterparty_response_code = p_response_code,
    counterparty_response = coalesce(v_response, case p_response_code
      when 'AGREE_NO_CALL' then 'I agree the consultation did not take place.'
      when 'I_ATTENDED' then 'I joined and waited for the consultation.'
      else p_response_code
    end),
    counterparty_responded_at = now(),
    status = case when v_resolved then 'RESOLVED' else 'OPS_REVIEW' end,
    resolution_code = case when v_resolved then 'RESCHEDULE_REQUIRED' else null end,
    resolved_at = case when v_resolved then now() else null end,
    updated_at = now()
  where id = v_review.id
  returning * into v_review;

  select * into v_case from public.financial_cases where id = v_review.financial_case_id for update;
  update public.financial_cases set
    status = case when v_resolved then 'RESOLVED' else 'OPS_REVIEW' end,
    counterparty_responded_at = now(),
    money_movement_blocked = not v_resolved,
    resolution_code = case when v_resolved then 'CONSULTATION_RESCHEDULE_REQUIRED' else resolution_code end,
    resolution_summary = case when v_resolved then 'Both parties confirmed the consultation did not take place. The fee remains protected while they choose a new time.' else resolution_summary end,
    resolved_at = case when v_resolved then now() else resolved_at end,
    resolved_by = case when v_resolved then p_actor_id else resolved_by end,
    updated_at = now()
  where id = v_case.id;

  insert into public.financial_case_events(case_id, event_type, actor_id, actor_role, payload, correlation_id)
  values (
    v_case.id,
    case when v_resolved then 'CASE_RESOLVED' else 'COUNTERPARTY_RESPONSE_ADDED' end,
    p_actor_id,
    v_actor_role,
    jsonb_build_object(
      'responseCode', p_response_code,
      'response', v_review.counterparty_response,
      'nextAction', case when v_resolved then 'RESCHEDULE' else 'OPS_REVIEW' end
    ),
    v_case.correlation_id
  );

  return jsonb_build_object(
    'reviewId', v_review.id,
    'caseId', v_case.id,
    'status', v_review.status,
    'resolutionCode', v_review.resolution_code,
    'nextAction', case when v_resolved then 'RESCHEDULE' else 'OPS_REVIEW' end
  );
end;
$$;

revoke all on function public.respond_to_consultation_attendance_report_v2(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_consultation_attendance_report_v2(uuid, uuid, text, text) to service_role;

comment on function public.respond_to_consultation_attendance_report_v2(uuid, uuid, text, text) is
  'Records a structured counterpart attendance decision. Mutual no-call confirmation resolves to rescheduling without moving money; disagreements remain frozen for Ops.';
