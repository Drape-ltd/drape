do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consultation_attendance_reviews' and column_name = 'ops_decision'
  ) then raise exception 'consultation attendance Ops decision column is missing'; end if;

  if to_regprocedure('public.resolve_consultation_attendance_review(uuid,text,text,text,uuid)') is null then
    raise exception 'consultation attendance terminal decision function is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consultation_attendance_reviews' and column_name = 'money_desk_request_id'
  ) then raise exception 'consultation attendance Money Desk link is missing'; end if;
end;
$$;
