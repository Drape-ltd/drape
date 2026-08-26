do $verification$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'consultation_attendance_reviews'
      and column_name = 'counterparty_response_code'
  ) then raise exception 'Attendance response code was not added.'; end if;
  if to_regprocedure('public.respond_to_consultation_attendance_report_v2(uuid,uuid,text,text)') is null then
    raise exception 'Structured attendance response RPC is missing.';
  end if;
  raise notice 'Consultation counterpart outcome contract verified.';
end;
$verification$;
