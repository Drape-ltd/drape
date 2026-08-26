-- Attendance requires one continuous five-minute overlap, not a sum of
-- disconnected joins. A booking may also open only one financial case.

create unique index if not exists financial_cases_one_consultation_booking_idx
  on public.financial_cases ((claim_details->>'bookingId'))
  where case_type = 'CONSULTATION_ATTENDANCE'
    and nullif(claim_details->>'bookingId', '') is not null;

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
    when now() < v_booking.scheduled_start_at + interval '15 minutes' then 'PENDING_WINDOW'
    when v_overlap_seconds >= 300 then 'ATTENDED'
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

do $verification$
declare
  v_order public.orders%rowtype;
  v_booking uuid;
  v_room uuid;
  v_evidence public.consultation_attendance_evidence%rowtype;
begin
  begin
    select order_record.* into v_order from public.orders order_record
    where order_record.customer_id is not null and order_record.tailor_id is not null
      and exists (select 1 from auth.users u where u.id = order_record.customer_id::uuid)
      and exists (select 1 from auth.users u where u.id = order_record.tailor_id::uuid)
      and not exists (select 1 from public.consultation_bookings b where b.order_id::text = order_record.id::text and b.status = 'CONFIRMED')
    order by order_record.created_at limit 1;
    if v_order.id is null then raise exception 'Continuous-overlap verification requires one development order.'; end if;
    insert into public.consultation_bookings(order_id, tailor_id, customer_id, scheduled_start_at, scheduled_end_at, status)
      values (v_order.id, v_order.tailor_id::uuid, v_order.customer_id::uuid, now() - interval '30 minutes', now(), 'CONFIRMED') returning id into v_booking;
    insert into public.order_call_rooms(order_id, provider_room_name, call_kind, call_type, expires_at, consultation_booking_id)
      values (v_order.id, 'migration-overlap-' || v_booking, 'CONSULTATION', 'video', now() + interval '1 hour', v_booking) returning id into v_room;
    insert into public.order_call_sessions(call_room_id, order_id, provider_meeting_id, status, started_at, ended_at)
      values (v_room, v_order.id, 'migration-overlap-' || v_booking, 'ENDED', now() - interval '30 minutes', now());
    insert into public.order_call_participations(call_room_id, order_id, provider_session_id, user_id, joined_at, left_at, duration_seconds)
    values
      (v_room, v_order.id, 'migration-customer-a-' || v_booking, v_order.customer_id::uuid, now() - interval '30 minutes', now() - interval '27 minutes', 180),
      (v_room, v_order.id, 'migration-tailor-a-' || v_booking, v_order.tailor_id::uuid, now() - interval '30 minutes', now() - interval '27 minutes', 180),
      (v_room, v_order.id, 'migration-customer-b-' || v_booking, v_order.customer_id::uuid, now() - interval '23 minutes', now() - interval '20 minutes', 180),
      (v_room, v_order.id, 'migration-tailor-b-' || v_booking, v_order.tailor_id::uuid, now() - interval '23 minutes', now() - interval '20 minutes', 180);
    v_evidence := public.refresh_consultation_attendance_evidence(v_booking);
    if v_evidence.verified_overlap_seconds <> 180 or v_evidence.derived_outcome = 'ATTENDED' then
      raise exception 'Disconnected overlap was incorrectly combined: % seconds, %', v_evidence.verified_overlap_seconds, v_evidence.derived_outcome;
    end if;
    raise exception 'CONSULTATION_CONTINUOUS_OVERLAP_ROLLBACK';
  exception when others then
    if sqlerrm <> 'CONSULTATION_CONTINUOUS_OVERLAP_ROLLBACK' then raise; end if;
  end;
  raise notice 'Continuous consultation overlap verification passed; synthetic rows rolled back.';
end;
$verification$;
