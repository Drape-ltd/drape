-- Per-participant conversation translation preferences and server-only translation cache.
do $$
declare
  v_order_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_order_id_type
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'orders'
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if v_order_id_type is null then
    raise exception 'public.orders.id column was not found';
  end if;

  execute format(
    'create table if not exists public.conversation_translation_preferences (
      order_id %s not null references public.orders(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      auto_translate boolean not null default false,
      target_language text not null default ''en'' check (target_language ~ ''^[a-z]{2,3}(-[A-Za-z]{2,4})?$''),
      source_language text check (source_language is null or source_language ~ ''^[a-z]{2,3}(-[A-Za-z]{2,4})?$''),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (order_id, user_id)
    )',
    v_order_id_type
  );
end $$;

alter table public.conversation_translation_preferences enable row level security;

drop policy if exists "translation preferences: participant reads own" on public.conversation_translation_preferences;
create policy "translation preferences: participant reads own"
on public.conversation_translation_preferences for select
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.orders o
    where o.id = order_id and auth.uid()::text in (o.customer_id::text, o.tailor_id::text)
  )
);

drop policy if exists "translation preferences: participant inserts own" on public.conversation_translation_preferences;
create policy "translation preferences: participant inserts own"
on public.conversation_translation_preferences for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.orders o
    where o.id = order_id and auth.uid()::text in (o.customer_id::text, o.tailor_id::text)
  )
);

drop policy if exists "translation preferences: participant updates own" on public.conversation_translation_preferences;
create policy "translation preferences: participant updates own"
on public.conversation_translation_preferences for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
declare
  v_message_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_message_id_type
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'messages'
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if v_message_id_type is null then
    raise exception 'public.messages.id column was not found';
  end if;

  execute format(
    'create table if not exists public.message_translations (
      message_id %s not null references public.messages(id) on delete cascade,
      target_language text not null,
      source_language text not null,
      translated_text text not null,
      original_sha256 text not null,
      provider text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (message_id, target_language, source_language)
    )',
    v_message_id_type
  );
end $$;

alter table public.message_translations enable row level security;
-- No client policies: translations are returned only by the participant-authorized Edge function.

create index if not exists conversation_translation_preferences_user_idx
  on public.conversation_translation_preferences (user_id, updated_at desc);

comment on table public.message_translations is
  'Server-only cache. Original message text remains authoritative and is never overwritten.';
