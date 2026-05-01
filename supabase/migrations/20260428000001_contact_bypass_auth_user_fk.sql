alter table if exists public.contact_bypass_logs
  drop constraint if exists contact_bypass_logs_user_id_fkey;

do $$
declare
  user_id_type text;
begin
  select data_type
    into user_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'contact_bypass_logs'
    and column_name = 'user_id';

  if user_id_type in ('text', 'character varying') then
    delete from public.contact_bypass_logs
    where user_id is null
      or btrim(user_id) = ''
      or btrim(user_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    alter table public.contact_bypass_logs
      alter column user_id type uuid
      using btrim(user_id)::uuid;
  end if;

  delete from public.contact_bypass_logs logs
  where not exists (
    select 1
    from auth.users users_row
    where users_row.id = logs.user_id
  );
end $$;

alter table if exists public.contact_bypass_logs
  add constraint contact_bypass_logs_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
