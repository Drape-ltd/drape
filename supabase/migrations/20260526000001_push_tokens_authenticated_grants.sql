-- Android push registration writes directly from the signed-in app.
-- RLS already limits rows to auth.uid(); this grant lets authenticated
-- clients reach the table so the policy can do its job.

grant select, insert, update, delete on table public.push_tokens to authenticated;
grant select, insert, update, delete on table public.push_tokens to service_role;

alter table public.push_tokens enable row level security;

drop policy if exists "users: manage own push token" on public.push_tokens;
create policy "users: manage own push token"
  on public.push_tokens
  for all
  to authenticated
  using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);
