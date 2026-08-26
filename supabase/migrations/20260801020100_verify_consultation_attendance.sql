-- Rollback-only proof for consultation attendance and report review behavior.
do $verification$
declare
  v_order public.orders%rowtype;
  v_booking uuid;
  v_room uuid;
  v_evidence public.consultation_attendance_evidence%rowtype;
  v_report jsonb;
  v_duplicate jsonb;
  v_case uuid;
begin
  begin
    select order_record.* into v_order
    from public.orders order_record
    where order_record.customer_id is not null
      and order_record.tailor_id is not null
      and exists (select 1 from auth.users user_record where user_record.id = order_record.customer_id::uuid)
      and exists (select 1 from auth.users user_record where user_record.id = order_record.tailor_id::uuid)
      and not exists (
        select 1 from public.consultation_bookings booking
        where booking.order_id = order_record.id and booking.status = 'CONFIRMED'
      )
    order by order_record.created_at
    limit 1;
    if v_order.id is null then raise exception 'Consultation verification requires one development order with both parties.'; end if;

    insert into public.consultation_bookings(
      order_id, tailor_id, customer_id, scheduled_start_at, scheduled_end_at,
      status, fee_mode, payment_status, commercial_snapshot_locked_at
    ) values (
      v_order.id, v_order.tailor_id::uuid, v_order.customer_id::uuid, now() - interval '30 minutes', now(),
      'CONFIRMED', 'FREE', 'NOT_REQUIRED', now() - interval '40 minutes'
    ) returning id into v_booking;

    insert into public.order_call_rooms(
      order_id, provider_room_name, call_kind, call_type, scheduled_start_at,
      expires_at, consultation_booking_id
    ) values (
      v_order.id, 'migration-consultation-' || v_booking::text, 'CONSULTATION', 'video',
      now() - interval '30 minutes', now() + interval '1 hour', v_booking
    ) returning id into v_room;

    insert into public.order_call_sessions(
      call_room_id, order_id, provider_meeting_id, status, started_at, ended_at, duration_seconds
    ) values (
      v_room, v_order.id, 'migration-meeting-' || v_booking::text, 'ENDED',
      now() - interval '30 minutes', now() - interval '14 minutes', 960
    );
    insert into public.order_call_participations(
      call_room_id, order_id, provider_session_id, user_id, joined_at, left_at, duration_seconds
    ) values (
      v_room, v_order.id, 'migration-tailor-' || v_booking::text, v_order.tailor_id::uuid,
      now() - interval '30 minutes', now() - interval '15 minutes', 900
    );

    v_evidence := public.refresh_consultation_attendance_evidence(v_booking);
    if v_evidence.derived_outcome <> 'CUSTOMER_NO_SHOW_ELIGIBLE'
      or not v_evidence.tailor_waited_through_deadline
      or not v_evidence.provider_evidence_complete then
      raise exception 'Provider-backed customer no-show eligibility was not derived correctly: %', v_evidence.derived_outcome;
    end if;

    v_report := public.submit_consultation_attendance_report(
      v_booking, v_order.tailor_id::uuid,
      'The tailor joined on time and waited continuously for fifteen minutes.',
      'migration-dry-run:consultation-attendance'
    );
    v_duplicate := public.submit_consultation_attendance_report(
      v_booking, v_order.tailor_id::uuid,
      'The tailor joined on time and waited continuously for fifteen minutes.',
      'migration-dry-run:consultation-attendance'
    );
    if v_duplicate->>'caseId' <> v_report->>'caseId' then raise exception 'Attendance report retry was not idempotent.'; end if;

    v_case := (v_report->>'caseId')::uuid;
    if not exists (
      select 1 from public.financial_cases
      where id = v_case and money_movement_blocked and status = 'COUNTERPARTY_REVIEW'
    ) then raise exception 'Attendance report did not hold money for counterpart review.'; end if;

    raise exception 'CONSULTATION_ATTENDANCE_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'CONSULTATION_ATTENDANCE_VERIFICATION_ROLLBACK' then raise; end if;
  end;
  raise notice 'Consultation attendance evidence, idempotency, and money hold verification passed; synthetic rows rolled back.';
end;
$verification$;
