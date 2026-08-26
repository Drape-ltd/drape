begin;

do $verification$
declare
  v_definition text;
  v_attended_position integer;
  v_wait_position integer;
begin
  select pg_get_functiondef('public.refresh_consultation_attendance_evidence(uuid)'::regprocedure)
  into v_definition;
  v_attended_position := position('when v_overlap_seconds >= 300' in v_definition);
  v_wait_position := position('when now() < v_booking.scheduled_start_at' in v_definition);
  if v_attended_position = 0 or v_wait_position = 0 or v_attended_position > v_wait_position then
    raise exception 'Verified attendance must be evaluated before the no-show wait deadline.';
  end if;
end;
$verification$;

rollback;
