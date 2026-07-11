do $$
declare
  v_message_id_type text;
  v_order_id_type text;
  v_user_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_message_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'messages'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  select format_type(a.atttypid, a.atttypmod)
    into v_order_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'orders'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  select format_type(a.atttypid, a.atttypmod)
    into v_user_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'users'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_message_id_type is null then
    raise exception 'Could not resolve public.messages.id type for message_reactions.';
  end if;

  if v_order_id_type is null then
    raise exception 'Could not resolve public.orders.id type for message_reactions.';
  end if;

  if v_user_id_type is null then
    raise exception 'Could not resolve public.users.id type for message_reactions.';
  end if;

  execute format($sql$
    create table if not exists public.message_reactions (
      id uuid primary key default gen_random_uuid(),
      message_id %s not null references public.messages(id) on delete cascade,
      order_id %s not null references public.orders(id) on delete cascade,
      user_id %s not null references public.users(id) on delete cascade,
      emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '🙏')),
      created_at timestamptz not null default now(),
      unique (message_id, user_id, emoji)
    )
  $sql$, v_message_id_type, v_order_id_type, v_user_id_type);
end;
$$;

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id, created_at);

create index if not exists message_reactions_order_idx
  on public.message_reactions (order_id, created_at);

alter table public.message_reactions enable row level security;

grant select, insert, delete on table public.message_reactions to authenticated;

drop policy if exists "Order parties see message reactions" on public.message_reactions;
create policy "Order parties see message reactions"
  on public.message_reactions
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = message_reactions.order_id
        and (
          o.customer_id::text = auth.uid()::text
          or o.tailor_id::text = auth.uid()::text
          or exists (
            select 1
            from public.tailor_profiles tp
            where tp.id::text = o.tailor_profile_id::text
              and tp.user_id::text = auth.uid()::text
          )
        )
    )
  );

drop policy if exists "Order parties add own message reactions" on public.message_reactions;
create policy "Order parties add own message reactions"
  on public.message_reactions
  for insert
  with check (
    user_id::text = auth.uid()::text
    and exists (
      select 1
      from public.messages m
      join public.orders o on o.id = m.order_id
      where m.id = message_reactions.message_id
        and m.order_id = message_reactions.order_id
        and (
          o.customer_id::text = auth.uid()::text
          or o.tailor_id::text = auth.uid()::text
          or exists (
            select 1
            from public.tailor_profiles tp
            where tp.id::text = o.tailor_profile_id::text
              and tp.user_id::text = auth.uid()::text
          )
        )
    )
  );

drop policy if exists "Users remove own message reactions" on public.message_reactions;
create policy "Users remove own message reactions"
  on public.message_reactions
  for delete
  using (user_id::text = auth.uid()::text);
