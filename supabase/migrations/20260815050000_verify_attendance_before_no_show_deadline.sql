-- Verified two-party attendance is terminal as soon as the five-minute overlap
-- threshold is met. The fifteen-minute clock exists for one-sided no-show
-- evidence and must not delay a completed consultation.

create or replace function public.refresh_consultation_attendance_evidence(p_booking_id uuid)
returns public.consultation_attendance_evidence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.consultation_bookings%rowtype;
  v_customer_seconds integer := 0;
  v_tailor_seconds integer := 0;
  v_overlap_seconds integer := 0;
  v_customer_waited boolean := false;
  v_tailor_waited boolean := false;
  v_customer_late boolean := false;
  v_tailor_late boolean := false;
  v_complete boolean := false;
  v_outcome text;
  v_result public.consultation_attendance_evidence%rowtype;
begin
  select * into v_booking from public.consultation_bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Consultation booking not found.'; end if;

  select
    coalesce(sum(greatest(0, extract(epoch from least(coalesce(p.left_at, now()), v_booking.scheduled_end_at) - greatest(p.joined_at, v_booking.scheduled_start_at - interval '5 minutes')))) filter (where p.user_id = v_booking.customer_id), 0)::integer,
    coalesce(sum(greatest(0, extract(epoch from least(coalesce(p.left_at, now()), v_booking.scheduled_end_at) - greatest(p.joined_at, v_booking.scheduled_start_at - interval '5 minutes')))) filter (where p.user_id = v_booking.tailor_id), 0)::integer,
    coalesce(bool_or(p.user_id = v_booking.customer_id and p.joined_at <= v_booking.scheduled_start_at + interval '10 minutes' and coalesce(p.left_at, now()) >= p.joined_at + interval '15 minutes'), false),
    coalesce(bool_or(p.user_id = v_booking.tailor_id and p.joined_at <= v_booking.scheduled_start_at + interval '10 minutes' and coalesce(p.left_at, now()) >= p.joined_at + interval '15 minutes'), false),
    coalesce(bool_or(p.user_id = v_booking.customer_id and p.joined_at > v_booking.scheduled_start_at + interval '15 minutes'), false),
    coalesce(bool_or(p.user_id = v_booking.tailor_id and p.joined_at > v_booking.scheduled_start_at + interval '15 minutes'), false)
  into v_customer_seconds, v_tailor_seconds, v_customer_waited, v_tailor_waited, v_customer_late, v_tailor_late
  from public.order_call_participations p
  join public.order_call_rooms room on room.id = p.call_room_id
  where room.consultation_booking_id = p_booking_id
    and p.joined_at < v_booking.scheduled_end_at
    and coalesce(p.left_at, now()) > v_booking.scheduled_start_at - interval '5 minutes';

  select coalesce(max(greatest(0, extract(epoch from least(coalesce(customer.left_at, now()), coalesce(tailor.left_at, now()), v_booking.scheduled_end_at) - greatest(customer.joined_at, tailor.joined_at, v_booking.scheduled_start_at - interval '5 minutes')))), 0)::integer
  into v_overlap_seconds
  from public.order_call_participations customer
  join public.order_call_rooms customer_room on customer_room.id = customer.call_room_id
  join public.order_call_participations tailor on tailor.call_room_id = customer.call_room_id
  where customer_room.consultation_booking_id = p_booking_id
    and customer.user_id = v_booking.customer_id
    and tailor.user_id = v_booking.tailor_id
    and customer.joined_at < coalesce(tailor.left_at, now())
    and tailor.joined_at < coalesce(customer.left_at, now());

  select exists (
    select 1 from public.order_call_sessions session
    join public.order_call_rooms room on room.id = session.call_room_id
    where room.consultation_booking_id = p_booking_id and session.status = 'ENDED'
  ) into v_complete;

  v_outcome := case
    when not v_complete then 'INSUFFICIENT_EVIDENCE'
    when v_overlap_seconds >= 300 then 'ATTENDED'
    when now() < v_booking.scheduled_start_at + interval '15 minutes' then 'PENDING_WINDOW'
    when v_tailor_waited and v_customer_seconds = 0 then 'CUSTOMER_NO_SHOW_ELIGIBLE'
    when v_customer_waited and v_tailor_seconds = 0 then 'TAILOR_NO_SHOW_ELIGIBLE'
    when v_customer_seconds > 0 or v_tailor_seconds > 0 then 'CONNECTION_OR_SCHEDULING_ISSUE'
    else 'INSUFFICIENT_EVIDENCE'
  end;

  insert into public.consultation_attendance_evidence (
    booking_id, order_id, provider_evidence_complete, customer_verified_seconds,
    tailor_verified_seconds, verified_overlap_seconds, customer_waited_through_deadline,
    tailor_waited_through_deadline, customer_late_visit, tailor_late_visit,
    derived_outcome, evidence_snapshot, evaluated_at, updated_at
  ) values (
    v_booking.id, v_booking.order_id, v_complete, v_customer_seconds,
    v_tailor_seconds, v_overlap_seconds, v_customer_waited, v_tailor_waited,
    v_customer_late, v_tailor_late, v_outcome,
    jsonb_build_object('policyVersion', v_booking.policy_version, 'graceMinutes', 10, 'claimantWaitMinutes', 15, 'attendedOverlapMinutes', 5, 'overlapRule', 'MAX_CONTINUOUS'),
    now(), now()
  ) on conflict (booking_id) do update set
    provider_evidence_complete = excluded.provider_evidence_complete,
    customer_verified_seconds = excluded.customer_verified_seconds,
    tailor_verified_seconds = excluded.tailor_verified_seconds,
    verified_overlap_seconds = excluded.verified_overlap_seconds,
    customer_waited_through_deadline = excluded.customer_waited_through_deadline,
    tailor_waited_through_deadline = excluded.tailor_waited_through_deadline,
    customer_late_visit = excluded.customer_late_visit,
    tailor_late_visit = excluded.tailor_late_visit,
    derived_outcome = excluded.derived_outcome,
    evidence_snapshot = excluded.evidence_snapshot,
    evaluated_at = excluded.evaluated_at,
    updated_at = now()
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.refresh_consultation_attendance_evidence(uuid) from public, anon, authenticated;
grant execute on function public.refresh_consultation_attendance_evidence(uuid) to service_role;
