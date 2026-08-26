-- Legacy environments do not all use the same physical type for orders.id.
-- Derive the dependent key type so the call-history contract remains portable
-- while retaining its foreign keys in every environment.
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
    'create table if not exists public.order_call_rooms (
      id uuid primary key default gen_random_uuid(),
      order_id %1$s not null references public.orders(id) on delete cascade,
      provider text not null default ''DAILY'' check (provider = ''DAILY''),
      provider_room_name text not null,
      call_kind text not null check (call_kind in (''CONSULTATION'', ''ORDER'')),
      call_type text not null check (call_type in (''audio'', ''video'')),
      scheduled_start_at timestamptz,
      expires_at timestamptz not null,
      created_by uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      unique (provider, provider_room_name)
    );
    create table if not exists public.order_call_sessions (
      id uuid primary key default gen_random_uuid(),
      call_room_id uuid not null references public.order_call_rooms(id) on delete cascade,
      order_id %1$s not null references public.orders(id) on delete cascade,
      provider_meeting_id text not null,
      status text not null default ''STARTED'' check (status in (''STARTED'', ''ENDED'')),
      started_at timestamptz not null,
      ended_at timestamptz,
      duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider_meeting_id)
    );
    create table if not exists public.order_call_participations (
      id uuid primary key default gen_random_uuid(),
      call_room_id uuid not null references public.order_call_rooms(id) on delete cascade,
      order_id %1$s not null references public.orders(id) on delete cascade,
      provider_session_id text not null,
      user_id uuid references auth.users(id) on delete set null,
      user_name text,
      joined_at timestamptz not null,
      left_at timestamptz,
      duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider_session_id)
    )',
    v_order_id_type
  );
end $$;

create table if not exists public.daily_webhook_events (
  id text primary key,
  event_type text not null,
  room_name text,
  event_created_at timestamptz,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index if not exists order_call_rooms_order_created_idx
  on public.order_call_rooms (order_id, created_at desc);
create index if not exists order_call_sessions_order_started_idx
  on public.order_call_sessions (order_id, started_at desc);
create index if not exists order_call_sessions_room_started_idx
  on public.order_call_sessions (call_room_id, started_at);
create index if not exists order_call_participations_order_joined_idx
  on public.order_call_participations (order_id, joined_at desc);

alter table public.order_call_rooms enable row level security;
alter table public.order_call_sessions enable row level security;
alter table public.order_call_participations enable row level security;
alter table public.daily_webhook_events enable row level security;

grant select on table public.order_call_rooms to authenticated;
grant select on table public.order_call_sessions to authenticated;
grant select on table public.order_call_participations to authenticated;

create policy "Order parties see call rooms"
  on public.order_call_rooms
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_call_rooms.order_id
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

create policy "Order parties see call sessions"
  on public.order_call_sessions
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_call_sessions.order_id
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

create policy "Order parties see call participation"
  on public.order_call_participations
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_call_participations.order_id
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

comment on table public.order_call_rooms is
  'Protected provider room metadata. Contains no call audio, video, transcript, or recording.';
comment on table public.order_call_sessions is
  'Provider-confirmed meeting lifecycle used for user history, support, and investigations.';
comment on table public.order_call_participations is
  'Provider-confirmed join and leave metadata. Contains no call content.';
