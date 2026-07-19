-- Versioned custom-order negotiation and structured conversation events.
-- Existing orders.quoted_* columns remain as a compatibility projection for
-- checkout and legacy clients while Edge Functions move to these snapshots.

alter table public.orders
  add column if not exists active_quote_id uuid,
  add column if not exists active_quote_version integer,
  add column if not exists negotiation_round_limit integer not null default 3,
  add column if not exists negotiation_rounds_used integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_negotiation_round_limit_check'
  ) then
    alter table public.orders
      add constraint orders_negotiation_round_limit_check
      check (negotiation_round_limit between 1 and 6);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_negotiation_rounds_used_check'
  ) then
    alter table public.orders
      add constraint orders_negotiation_rounds_used_check
      check (negotiation_rounds_used between 0 and negotiation_round_limit);
  end if;
end $$;

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
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_order_id_type is null then
    raise exception 'Could not resolve public.orders.id type for negotiation migration.';
  end if;

  execute format($table$
    create table if not exists public.order_quotes (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      version integer not null check (version > 0),
      status text not null default 'ACTIVE' check (
        status in ('ACTIVE', 'SUPERSEDED', 'ACCEPTED', 'DECLINED', 'EXPIRED')
      ),
      change_kind text not null default 'INITIAL' check (
        change_kind in (
          'INITIAL',
          'CUSTOMER_REVISION',
          'TAILOR_CORRECTION',
          'UNCHANGED_RENEWAL',
          'LEGACY_IMPORT'
        )
      ),
      currency text not null,
      subtotal_amount integer not null check (subtotal_amount >= 0),
      tax_amount integer not null default 0 check (tax_amount >= 0),
      platform_fee_amount integer not null default 0 check (platform_fee_amount >= 0),
      delivery_fee_amount integer not null default 0 check (delivery_fee_amount >= 0),
      total_amount integer not null check (total_amount > 0),
      completion_date timestamptz not null,
      breakdown text,
      assumptions text,
      expires_at timestamptz,
      created_by uuid not null references auth.users(id),
      created_by_role text not null check (created_by_role in ('TAILOR', 'PLATFORM')),
      created_at timestamptz not null default now(),
      status_updated_at timestamptz not null default now(),
      unique (order_id, version)
    )
  $table$, v_order_id_type);

  execute format($table$
    create table if not exists public.quote_revision_requests (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      source_quote_id uuid not null references public.order_quotes(id),
      source_quote_version integer not null check (source_quote_version > 0),
      round_number integer not null check (round_number between 1 and 6),
      status text not null default 'OPEN' check (
        status in ('OPEN', 'WITHDRAWN', 'REVISED', 'CURRENT_RETAINED', 'ORDER_DECLINED', 'CLOSED')
      ),
      reason_codes text[] not null,
      note text not null,
      target_amount integer check (target_amount is null or target_amount > 0),
      currency text not null,
      requested_by uuid not null references auth.users(id),
      responded_by uuid references auth.users(id),
      response_note text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      responded_at timestamptz,
      constraint quote_revision_requests_reason_count_check check (
        cardinality(reason_codes) between 1 and 4
      ),
      constraint quote_revision_requests_note_length_check check (
        char_length(btrim(note)) between 10 and 1200
      ),
      constraint quote_revision_requests_reason_values_check check (
        reason_codes <@ array[
          'PRICE',
          'SCOPE',
          'DEADLINE',
          'FABRIC',
          'FULFILLMENT',
          'FIT_MEASUREMENTS',
          'OTHER'
        ]::text[]
      )
    )
  $table$, v_order_id_type);

  execute format($table$
    create table if not exists public.order_events (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      event_type text not null check (
        event_type in (
          'QUOTE_SENT',
          'QUOTE_REVISED',
          'QUOTE_RENEWED',
          'QUOTE_SUPERSEDED',
          'QUOTE_ACCEPTED',
          'QUOTE_DECLINED',
          'QUOTE_EXPIRED',
          'QUOTE_REVISION_REQUESTED',
          'QUOTE_REVISION_EDITED',
          'QUOTE_REVISION_WITHDRAWN',
          'QUOTE_RETAINED',
          'PAYMENT_CONFIRMED',
          'SCOPE_CHANGE_REQUESTED',
          'FABRIC_DECISION_RECORDED',
          'MEASUREMENT_DECISION_RECORDED',
          'FULFILLMENT_DECISION_RECORDED',
          'REMEDY_DECISION_RECORDED'
        )
      ),
      actor_id uuid references auth.users(id),
      actor_role text not null check (actor_role in ('CUSTOMER', 'TAILOR', 'PLATFORM', 'SYSTEM')),
      quote_id uuid references public.order_quotes(id),
      quote_version integer,
      revision_request_id uuid references public.quote_revision_requests(id),
      title text not null,
      summary text,
      metadata jsonb not null default '{}'::jsonb,
      idempotency_key text not null unique,
      created_at timestamptz not null default now()
    )
  $table$, v_order_id_type);
end $$;

create unique index if not exists order_quotes_one_active_per_order_idx
  on public.order_quotes (order_id)
  where status = 'ACTIVE';

create index if not exists order_quotes_order_version_idx
  on public.order_quotes (order_id, version desc);

create unique index if not exists quote_revision_requests_one_open_per_order_idx
  on public.quote_revision_requests (order_id)
  where status = 'OPEN';

create index if not exists quote_revision_requests_order_created_idx
  on public.quote_revision_requests (order_id, created_at desc);

create index if not exists order_events_order_created_idx
  on public.order_events (order_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_active_quote_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_active_quote_id_fkey
      foreign key (active_quote_id) references public.order_quotes(id) on delete set null;
  end if;
end $$;

alter table public.order_quotes enable row level security;
alter table public.quote_revision_requests enable row level security;
alter table public.order_events enable row level security;

grant select on table public.order_quotes to authenticated;
grant select on table public.quote_revision_requests to authenticated;
grant select on table public.order_events to authenticated;
grant select, insert, update, delete on table public.order_quotes to service_role;
grant select, insert, update, delete on table public.quote_revision_requests to service_role;
grant select, insert, update, delete on table public.order_events to service_role;

drop policy if exists "order_quotes: participants can view" on public.order_quotes;
create policy "order_quotes: participants can view"
  on public.order_quotes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders order_row
      where order_row.id::text = order_quotes.order_id::text
        and (
          order_row.customer_id::text = auth.uid()::text
          or order_row.tailor_id::text = auth.uid()::text
        )
    )
  );

drop policy if exists "quote_revision_requests: participants can view" on public.quote_revision_requests;
create policy "quote_revision_requests: participants can view"
  on public.quote_revision_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders order_row
      where order_row.id::text = quote_revision_requests.order_id::text
        and (
          order_row.customer_id::text = auth.uid()::text
          or order_row.tailor_id::text = auth.uid()::text
        )
    )
  );

drop policy if exists "order_events: participants can view" on public.order_events;
create policy "order_events: participants can view"
  on public.order_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders order_row
      where order_row.id::text = order_events.order_id::text
        and (
          order_row.customer_id::text = auth.uid()::text
          or order_row.tailor_id::text = auth.uid()::text
        )
    )
  );

create or replace function public.prevent_order_quote_payload_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ORDER_QUOTE_SNAPSHOTS_ARE_APPEND_ONLY';
  end if;

  if row(
    new.order_id,
    new.version,
    new.change_kind,
    new.currency,
    new.subtotal_amount,
    new.tax_amount,
    new.platform_fee_amount,
    new.delivery_fee_amount,
    new.total_amount,
    new.completion_date,
    new.breakdown,
    new.assumptions,
    new.expires_at,
    new.created_by,
    new.created_by_role,
    new.created_at
  ) is distinct from row(
    old.order_id,
    old.version,
    old.change_kind,
    old.currency,
    old.subtotal_amount,
    old.tax_amount,
    old.platform_fee_amount,
    old.delivery_fee_amount,
    old.total_amount,
    old.completion_date,
    old.breakdown,
    old.assumptions,
    old.expires_at,
    old.created_by,
    old.created_by_role,
    old.created_at
  ) then
    raise exception 'ORDER_QUOTE_SNAPSHOT_PAYLOAD_IS_IMMUTABLE';
  end if;

  new.status_updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_prevent_order_quote_payload_mutation on public.order_quotes;
create trigger trg_prevent_order_quote_payload_mutation
before update or delete on public.order_quotes
for each row
execute function public.prevent_order_quote_payload_mutation();

create or replace function public.prevent_order_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ORDER_EVENTS_ARE_APPEND_ONLY';
end;
$$;

drop trigger if exists trg_prevent_order_event_mutation on public.order_events;
create trigger trg_prevent_order_event_mutation
before update or delete on public.order_events
for each row
execute function public.prevent_order_event_mutation();

create or replace function public.touch_quote_revision_request_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_quote_revision_request_updated_at on public.quote_revision_requests;
create trigger trg_touch_quote_revision_request_updated_at
before update on public.quote_revision_requests
for each row
execute function public.touch_quote_revision_request_updated_at();

-- Backfill a version-one compatibility snapshot for existing custom quotes.
insert into public.order_quotes (
  order_id,
  version,
  status,
  change_kind,
  currency,
  subtotal_amount,
  tax_amount,
  platform_fee_amount,
  delivery_fee_amount,
  total_amount,
  completion_date,
  breakdown,
  assumptions,
  expires_at,
  created_by,
  created_by_role,
  created_at
)
select
  order_row.id,
  1,
  case
    when order_row.stage::text = 'QUOTE_SENT' then 'ACTIVE'
    when order_row.stage::text in ('DECLINED', 'CANCELLED') then 'DECLINED'
    when order_row.stage::text = 'EXPIRED' then 'EXPIRED'
    else 'ACCEPTED'
  end,
  'LEGACY_IMPORT',
  coalesce(order_row.currency::text, order_row.quoted_currency, 'USD'),
  greatest(coalesce(order_row.subtotal_amount, order_row.quoted_amount, 0), 0),
  greatest(coalesce(order_row.tax_amount, 0), 0),
  greatest(coalesce(order_row.platform_fee_amount, 0), 0),
  greatest(coalesce(order_row.shipping_amount, order_row.fulfillment_fee, 0), 0),
  greatest(coalesce(order_row.total_amount, order_row.quoted_amount, 1), 1),
  coalesce(order_row.quoted_completion_date, order_row.created_at + interval '30 days'),
  null,
  order_row.quote_note,
  order_row.quote_expires_at,
  quote_creator.id,
  'TAILOR',
  coalesce(order_row.stage_updated_at, order_row.updated_at, order_row.created_at, now())
from public.orders order_row
join auth.users quote_creator
  on quote_creator.id::text = order_row.tailor_id::text
where coalesce(order_row.order_kind::text, 'CUSTOM') = 'CUSTOM'
  and order_row.quoted_amount is not null
  and order_row.tailor_id is not null
  and not exists (
    select 1
    from public.order_quotes quote_row
    where quote_row.order_id::text = order_row.id::text
  );

update public.orders order_row
set active_quote_id = quote_row.id,
    active_quote_version = quote_row.version
from public.order_quotes quote_row
where quote_row.order_id::text = order_row.id::text
  and quote_row.status = 'ACTIVE'
  and order_row.active_quote_id is null;

comment on table public.order_quotes is 'Immutable monetary and delivery snapshots for custom-order quote versions.';
comment on table public.quote_revision_requests is 'Formal customer-requested quote changes. Ordinary chat does not consume a round.';
comment on table public.order_events is 'Append-only structured events rendered in order timelines and conversations.';
comment on column public.orders.active_quote_id is 'Current formal quote used for acceptance and checkout version guards.';
comment on column public.orders.negotiation_round_limit is 'Customer-requested quote revision cap. Ops may auditably extend up to six.';

create or replace function public.record_order_event(
  p_order_id text,
  p_event_type text,
  p_actor_id uuid,
  p_actor_role text,
  p_title text,
  p_idempotency_key text,
  p_summary text default null,
  p_quote_id uuid default null,
  p_quote_version integer default null,
  p_revision_request_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  perform 1
  from public.orders order_row
  where order_row.id::text = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  insert into public.order_events (
    order_id,
    event_type,
    actor_id,
    actor_role,
    quote_id,
    quote_version,
    revision_request_id,
    title,
    summary,
    metadata,
    idempotency_key
  )
  select
    order_row.id,
    p_event_type,
    p_actor_id,
    p_actor_role,
    p_quote_id,
    p_quote_version,
    p_revision_request_id,
    p_title,
    p_summary,
    coalesce(p_metadata, '{}'::jsonb),
    p_idempotency_key
  from public.orders order_row
  where order_row.id::text = p_order_id
  on conflict (idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event_row.id
      into v_event_id
    from public.order_events event_row
    where event_row.idempotency_key = p_idempotency_key
      and event_row.order_id::text = p_order_id;
  end if;

  if v_event_id is null then
    raise exception 'ORDER_EVENT_IDEMPOTENCY_CONFLICT';
  end if;

  return v_event_id;
end;
$$;

create or replace function public.request_order_quote_revision(
  p_order_id text,
  p_customer_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer,
  p_reason_codes text[],
  p_note text,
  p_target_amount integer default null,
  p_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_revision public.quote_revision_requests%rowtype;
  v_next_round integer;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
  for update;

  if v_order.id is null or v_order.customer_id::text <> p_customer_id::text then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if coalesce(v_order.order_kind::text, 'CUSTOM') <> 'CUSTOM' then
    raise exception 'QUOTE_NEGOTIATION_CUSTOM_ONLY';
  end if;
  if v_order.stage::text <> 'QUOTE_SENT' then
    raise exception 'QUOTE_NEGOTIATION_NOT_AVAILABLE';
  end if;

  select *
    into v_quote
  from public.order_quotes
  where id = p_quote_id
    and order_id::text = p_order_id
  for update;

  if v_quote.id is null
     or v_quote.status <> 'ACTIVE'
     or v_quote.version <> p_expected_quote_version
     or v_order.active_quote_id is distinct from v_quote.id
     or v_order.active_quote_version is distinct from v_quote.version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  if exists (
    select 1
    from public.quote_revision_requests
    where order_id::text = p_order_id
      and status = 'OPEN'
  ) then
    raise exception 'QUOTE_REVISION_ALREADY_OPEN';
  end if;

  if v_order.negotiation_rounds_used >= v_order.negotiation_round_limit then
    raise exception 'QUOTE_REVISION_LIMIT_REACHED';
  end if;

  v_next_round := v_order.negotiation_rounds_used + 1;

  insert into public.quote_revision_requests (
    order_id,
    source_quote_id,
    source_quote_version,
    round_number,
    reason_codes,
    note,
    target_amount,
    currency,
    requested_by
  )
  values (
    v_order.id,
    v_quote.id,
    v_quote.version,
    v_next_round,
    p_reason_codes,
    btrim(p_note),
    p_target_amount,
    coalesce(nullif(upper(btrim(p_currency)), ''), v_quote.currency),
    p_customer_id
  )
  returning * into v_revision;

  update public.orders
  set negotiation_rounds_used = v_next_round,
      updated_at = now()
  where id::text = p_order_id;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_REVISION_REQUESTED',
    p_customer_id,
    'CUSTOMER',
    'Quote changes requested',
    'quote-revision-requested:' || v_revision.id::text,
    btrim(p_note),
    v_quote.id,
    v_quote.version,
    v_revision.id,
    jsonb_build_object(
      'roundNumber', v_next_round,
      'roundLimit', v_order.negotiation_round_limit,
      'reasonCodes', p_reason_codes,
      'targetAmount', p_target_amount,
      'currency', v_revision.currency
    )
  );

  return jsonb_build_object(
    'revisionRequestId', v_revision.id,
    'roundNumber', v_next_round,
    'roundLimit', v_order.negotiation_round_limit,
    'quoteId', v_quote.id,
    'quoteVersion', v_quote.version,
    'eventId', v_event_id
  );
end;
$$;

create or replace function public.edit_order_quote_revision(
  p_order_id text,
  p_customer_id uuid,
  p_revision_request_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer,
  p_reason_codes text[],
  p_note text,
  p_target_amount integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.quote_revision_requests%rowtype;
  v_event_id uuid;
begin
  perform 1
  from public.orders order_row
  where order_row.id::text = p_order_id
    and order_row.customer_id::text = p_customer_id::text
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  update public.quote_revision_requests
  set reason_codes = p_reason_codes,
      note = btrim(p_note),
      target_amount = p_target_amount
  where id = p_revision_request_id
    and order_id::text = p_order_id
    and requested_by = p_customer_id
    and source_quote_id = p_quote_id
    and source_quote_version = p_expected_quote_version
    and status = 'OPEN'
    and responded_by is null
  returning * into v_revision;

  if v_revision.id is null then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_REVISION_EDITED',
    p_customer_id,
    'CUSTOMER',
    'Change request updated',
    'quote-revision-edited:' || v_revision.id::text || ':' || to_char(v_revision.updated_at, 'YYYYMMDDHH24MISSUS'),
    v_revision.note,
    v_revision.source_quote_id,
    v_revision.source_quote_version,
    v_revision.id,
    jsonb_build_object('reasonCodes', v_revision.reason_codes, 'targetAmount', v_revision.target_amount)
  );

  return jsonb_build_object('revisionRequestId', v_revision.id, 'eventId', v_event_id, 'updated', true);
end;
$$;

create or replace function public.withdraw_order_quote_revision(
  p_order_id text,
  p_customer_id uuid,
  p_revision_request_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_revision public.quote_revision_requests%rowtype;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  update public.quote_revision_requests
  set status = 'WITHDRAWN',
      responded_at = now()
  where id = p_revision_request_id
    and order_id::text = p_order_id
    and requested_by = p_customer_id
    and source_quote_id = p_quote_id
    and source_quote_version = p_expected_quote_version
    and status = 'OPEN'
    and responded_by is null
  returning * into v_revision;

  if v_revision.id is null then
    raise exception 'QUOTE_REVISION_CANNOT_BE_WITHDRAWN';
  end if;

  update public.orders
  set negotiation_rounds_used = greatest(0, negotiation_rounds_used - 1),
      updated_at = now()
  where id::text = p_order_id;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_REVISION_WITHDRAWN',
    p_customer_id,
    'CUSTOMER',
    'Change request withdrawn',
    'quote-revision-withdrawn:' || v_revision.id::text,
    null,
    v_revision.source_quote_id,
    v_revision.source_quote_version,
    v_revision.id,
    jsonb_build_object('roundNumber', v_revision.round_number)
  );

  return jsonb_build_object(
    'revisionRequestId', v_revision.id,
    'withdrawn', true,
    'roundsUsed', greatest(0, v_order.negotiation_rounds_used - 1),
    'eventId', v_event_id
  );
end;
$$;

create or replace function public.create_order_quote_snapshot(
  p_order_id text,
  p_tailor_id uuid,
  p_expected_quote_id uuid,
  p_expected_quote_version integer,
  p_revision_request_id uuid,
  p_change_kind text,
  p_currency text,
  p_subtotal_amount integer,
  p_tax_amount integer,
  p_platform_fee_amount integer,
  p_delivery_fee_amount integer,
  p_total_amount integer,
  p_completion_date timestamptz,
  p_breakdown text default null,
  p_assumptions text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_current_quote public.order_quotes%rowtype;
  v_quote public.order_quotes%rowtype;
  v_revision public.quote_revision_requests%rowtype;
  v_version integer;
  v_event_type text;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
    and tailor_id::text = p_tailor_id::text
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if coalesce(v_order.order_kind::text, 'CUSTOM') <> 'CUSTOM' then
    raise exception 'QUOTE_NEGOTIATION_CUSTOM_ONLY';
  end if;
  if v_order.stage::text not in ('PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT') then
    raise exception 'PAID_ORDER_CANNOT_BE_REQUOTED';
  end if;
  if p_change_kind not in ('INITIAL', 'CUSTOMER_REVISION', 'TAILOR_CORRECTION', 'UNCHANGED_RENEWAL') then
    raise exception 'INVALID_QUOTE_CHANGE_KIND';
  end if;

  select *
    into v_current_quote
  from public.order_quotes
  where order_id::text = p_order_id
    and status = 'ACTIVE'
  for update;

  if v_current_quote.id is null then
    if p_expected_quote_id is not null or p_expected_quote_version is not null then
      raise exception 'QUOTE_VERSION_CHANGED';
    end if;
    if v_order.stage::text not in ('PENDING_QUOTE', 'CONSULTATION') then
      raise exception 'QUOTE_VERSION_CHANGED';
    end if;
  else
    if v_current_quote.id is distinct from p_expected_quote_id
       or v_current_quote.version is distinct from p_expected_quote_version
       or v_order.active_quote_id is distinct from v_current_quote.id
       or v_order.active_quote_version is distinct from v_current_quote.version then
      raise exception 'QUOTE_VERSION_CHANGED';
    end if;
  end if;

  if p_change_kind = 'CUSTOMER_REVISION' then
    select *
      into v_revision
    from public.quote_revision_requests
    where id = p_revision_request_id
      and order_id::text = p_order_id
      and source_quote_id = v_current_quote.id
      and source_quote_version = v_current_quote.version
      and status = 'OPEN'
    for update;

    if v_revision.id is null then
      raise exception 'QUOTE_REVISION_NOT_OPEN';
    end if;
  elsif p_revision_request_id is not null then
    raise exception 'REVISION_REQUEST_NOT_ALLOWED_FOR_CHANGE_KIND';
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
  from public.order_quotes
  where order_id::text = p_order_id;

  if v_current_quote.id is not null then
    update public.order_quotes
    set status = 'SUPERSEDED'
    where id = v_current_quote.id;
  end if;

  insert into public.order_quotes (
    order_id,
    version,
    change_kind,
    currency,
    subtotal_amount,
    tax_amount,
    platform_fee_amount,
    delivery_fee_amount,
    total_amount,
    completion_date,
    breakdown,
    assumptions,
    expires_at,
    created_by,
    created_by_role
  )
  values (
    v_order.id,
    v_version,
    p_change_kind,
    upper(btrim(p_currency)),
    p_subtotal_amount,
    p_tax_amount,
    p_platform_fee_amount,
    p_delivery_fee_amount,
    p_total_amount,
    p_completion_date,
    nullif(btrim(coalesce(p_breakdown, '')), ''),
    nullif(btrim(coalesce(p_assumptions, '')), ''),
    p_expires_at,
    p_tailor_id,
    'TAILOR'
  )
  returning * into v_quote;

  update public.orders
  set stage = 'QUOTE_SENT',
      quoted_amount = p_total_amount,
      fulfillment_fee = p_delivery_fee_amount,
      currency = upper(btrim(p_currency))::currency,
      quoted_currency = upper(btrim(p_currency)),
      source_currency = upper(btrim(p_currency))::currency,
      source_amount = p_subtotal_amount,
      fx_rate = 1,
      fx_rate_timestamp = now(),
      subtotal_amount = p_subtotal_amount,
      platform_fee_amount = p_platform_fee_amount,
      tax_amount = p_tax_amount,
      shipping_amount = p_delivery_fee_amount,
      total_amount = p_total_amount,
      quoted_completion_date = p_completion_date,
      quote_note = nullif(btrim(coalesce(p_assumptions, '')), ''),
      quote_expires_at = p_expires_at,
      active_quote_id = v_quote.id,
      active_quote_version = v_quote.version,
      stage_updated_at = now(),
      updated_at = now()
  where id::text = p_order_id;

  if v_revision.id is not null then
    update public.quote_revision_requests
    set status = 'REVISED',
        responded_by = p_tailor_id,
        response_note = nullif(btrim(coalesce(p_assumptions, '')), ''),
        responded_at = now()
    where id = v_revision.id;
  end if;

  v_event_type := case
    when p_change_kind = 'INITIAL' then 'QUOTE_SENT'
    when p_change_kind = 'UNCHANGED_RENEWAL' then 'QUOTE_RENEWED'
    else 'QUOTE_REVISED'
  end;

  v_event_id := public.record_order_event(
    p_order_id,
    v_event_type,
    p_tailor_id,
    'TAILOR',
    case when v_version = 1 then 'Quote sent' else 'Revised quote sent' end,
    lower(v_event_type) || ':' || v_quote.id::text,
    nullif(btrim(coalesce(p_assumptions, '')), ''),
    v_quote.id,
    v_quote.version,
    v_revision.id,
    jsonb_build_object(
      'currency', v_quote.currency,
      'totalAmount', v_quote.total_amount,
      'completionDate', v_quote.completion_date,
      'changeKind', v_quote.change_kind
    )
  );

  return jsonb_build_object(
    'quoteId', v_quote.id,
    'quoteVersion', v_quote.version,
    'revisionRequestId', v_revision.id,
    'eventId', v_event_id,
    'status', v_quote.status
  );
end;
$$;

create or replace function public.keep_current_order_quote(
  p_order_id text,
  p_tailor_id uuid,
  p_revision_request_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer,
  p_response_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.quote_revision_requests%rowtype;
  v_event_id uuid;
begin
  perform 1
  from public.orders order_row
  join public.order_quotes quote_row
    on quote_row.id = order_row.active_quote_id
  where order_row.id::text = p_order_id
    and order_row.tailor_id::text = p_tailor_id::text
    and order_row.stage::text = 'QUOTE_SENT'
    and quote_row.id = p_quote_id
    and quote_row.version = p_expected_quote_version
    and quote_row.status = 'ACTIVE'
  for update of order_row, quote_row;

  if not found then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  update public.quote_revision_requests
  set status = 'CURRENT_RETAINED',
      responded_by = p_tailor_id,
      response_note = nullif(btrim(coalesce(p_response_note, '')), ''),
      responded_at = now()
  where id = p_revision_request_id
    and order_id::text = p_order_id
    and source_quote_id = p_quote_id
    and source_quote_version = p_expected_quote_version
    and status = 'OPEN'
  returning * into v_revision;

  if v_revision.id is null then
    raise exception 'QUOTE_REVISION_NOT_OPEN';
  end if;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_RETAINED',
    p_tailor_id,
    'TAILOR',
    'Current quote retained',
    'quote-retained:' || v_revision.id::text,
    v_revision.response_note,
    p_quote_id,
    p_expected_quote_version,
    v_revision.id,
    jsonb_build_object('roundNumber', v_revision.round_number)
  );

  return jsonb_build_object('revisionRequestId', v_revision.id, 'eventId', v_event_id, 'retained', true);
end;
$$;

create or replace function public.accept_active_order_quote(
  p_order_id text,
  p_customer_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.stage::text <> 'QUOTE_SENT' then
    raise exception 'QUOTE_ACCEPTANCE_NOT_AVAILABLE';
  end if;
  if exists (
    select 1
    from public.quote_revision_requests
    where order_id::text = p_order_id
      and status = 'OPEN'
  ) then
    raise exception 'QUOTE_REVISION_STILL_OPEN';
  end if;

  update public.order_quotes
  set status = 'ACCEPTED'
  where id = p_quote_id
    and order_id::text = p_order_id
    and version = p_expected_quote_version
    and status = 'ACTIVE'
  returning * into v_quote;

  if v_quote.id is null
     or v_order.active_quote_id is distinct from p_quote_id
     or v_order.active_quote_version is distinct from p_expected_quote_version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  update public.orders
  set stage = 'PAYMENT_PENDING',
      stage_updated_at = now(),
      updated_at = now()
  where id::text = p_order_id;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_ACCEPTED',
    p_customer_id,
    'CUSTOMER',
    'Quote accepted',
    'quote-accepted:' || v_quote.id::text,
    null,
    v_quote.id,
    v_quote.version,
    null,
    jsonb_build_object('currency', v_quote.currency, 'totalAmount', v_quote.total_amount)
  );

  return jsonb_build_object(
    'quoteId', v_quote.id,
    'quoteVersion', v_quote.version,
    'eventId', v_event_id,
    'stage', 'PAYMENT_PENDING'
  );
end;
$$;

create or replace function public.decline_active_order_quote(
  p_order_id text,
  p_customer_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
    and customer_id::text = p_customer_id::text
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.stage::text <> 'QUOTE_SENT' then
    raise exception 'QUOTE_DECLINE_NOT_AVAILABLE';
  end if;
  if v_order.active_quote_id is distinct from p_quote_id
     or v_order.active_quote_version is distinct from p_expected_quote_version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  select *
    into v_quote
  from public.order_quotes
  where id = p_quote_id
    and order_id::text = p_order_id
    and version = p_expected_quote_version
    and status = 'ACTIVE'
  for update;

  if v_quote.id is null then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  perform *
  from public.finalize_order_terminal(
    v_order.id::uuid,
    'DECLINED',
    p_customer_id::text,
    'CUSTOMER',
    'order.stage_changed',
    'Customer declined the quote.',
    jsonb_build_object(
      'action', 'decline-quote',
      'from_stage', v_order.stage::text,
      'to_stage', 'DECLINED',
      'quote_id', p_quote_id,
      'quote_version', p_expected_quote_version
    ),
    array['QUOTE_SENT']::text[]
  );

  update public.order_quotes
  set status = 'DECLINED'
  where id = p_quote_id;

  update public.quote_revision_requests
  set status = 'CLOSED',
      responded_by = p_customer_id,
      response_note = 'Order declined by customer.',
      responded_at = now(),
      updated_at = now()
  where order_id::text = p_order_id
    and status = 'OPEN';

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_DECLINED',
    p_customer_id,
    'CUSTOMER',
    'Quote declined',
    'quote-declined:' || p_quote_id::text,
    null,
    p_quote_id,
    p_expected_quote_version,
    null,
    '{}'::jsonb
  );

  return jsonb_build_object(
    'quoteId', p_quote_id,
    'quoteVersion', p_expected_quote_version,
    'eventId', v_event_id,
    'stage', 'DECLINED'
  );
end;
$$;

create or replace function public.decline_order_after_quote_revision(
  p_order_id text,
  p_tailor_id uuid,
  p_quote_id uuid,
  p_expected_quote_version integer,
  p_revision_request_id uuid,
  p_response_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_revision public.quote_revision_requests%rowtype;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.orders
  where id::text = p_order_id
    and tailor_id::text = p_tailor_id::text
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.stage::text <> 'QUOTE_SENT' then
    raise exception 'QUOTE_NEGOTIATION_NOT_AVAILABLE';
  end if;
  if v_order.active_quote_id is distinct from p_quote_id
     or v_order.active_quote_version is distinct from p_expected_quote_version then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  select *
    into v_quote
  from public.order_quotes
  where id = p_quote_id
    and order_id::text = p_order_id
    and version = p_expected_quote_version
    and status = 'ACTIVE'
  for update;

  select *
    into v_revision
  from public.quote_revision_requests
  where id = p_revision_request_id
    and order_id::text = p_order_id
    and quote_id = p_quote_id
    and quote_version = p_expected_quote_version
    and status = 'OPEN'
  for update;

  if v_quote.id is null or v_revision.id is null then
    raise exception 'QUOTE_VERSION_CHANGED';
  end if;

  perform *
  from public.finalize_order_terminal(
    v_order.id::uuid,
    'DECLINED',
    p_tailor_id::text,
    'TAILOR',
    'order.stage_changed',
    coalesce(nullif(trim(p_response_note), ''), 'Tailor declined after reviewing the quote change request.'),
    jsonb_build_object(
      'action', 'decline-after-revision',
      'from_stage', v_order.stage::text,
      'to_stage', 'DECLINED',
      'quote_id', p_quote_id,
      'quote_version', p_expected_quote_version,
      'revision_request_id', p_revision_request_id
    ),
    array['QUOTE_SENT']::text[]
  );

  update public.order_quotes
  set status = 'DECLINED'
  where id = p_quote_id;

  update public.quote_revision_requests
  set status = 'ORDER_DECLINED',
      responded_by = p_tailor_id,
      response_note = nullif(trim(p_response_note), ''),
      responded_at = now(),
      updated_at = now()
  where id = p_revision_request_id;

  v_event_id := public.record_order_event(
    p_order_id,
    'QUOTE_DECLINED',
    p_tailor_id,
    'TAILOR',
    'Quote declined',
    'quote-declined:' || p_quote_id::text,
    nullif(trim(p_response_note), ''),
    p_quote_id,
    p_expected_quote_version,
    p_revision_request_id,
    jsonb_build_object('source', 'QUOTE_NEGOTIATION')
  );

  return jsonb_build_object(
    'quoteId', p_quote_id,
    'quoteVersion', p_expected_quote_version,
    'revisionRequestId', p_revision_request_id,
    'eventId', v_event_id,
    'stage', 'DECLINED'
  );
end;
$$;

revoke all on function public.record_order_event(text, text, uuid, text, text, text, text, uuid, integer, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.request_order_quote_revision(text, uuid, uuid, integer, text[], text, integer, text) from public, anon, authenticated;
revoke all on function public.edit_order_quote_revision(text, uuid, uuid, uuid, integer, text[], text, integer) from public, anon, authenticated;
revoke all on function public.withdraw_order_quote_revision(text, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.create_order_quote_snapshot(text, uuid, uuid, integer, uuid, text, text, integer, integer, integer, integer, integer, timestamptz, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.keep_current_order_quote(text, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.accept_active_order_quote(text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.decline_active_order_quote(text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.decline_order_after_quote_revision(text, uuid, uuid, integer, uuid, text) from public, anon, authenticated;

grant execute on function public.record_order_event(text, text, uuid, text, text, text, text, uuid, integer, uuid, jsonb) to service_role;
grant execute on function public.request_order_quote_revision(text, uuid, uuid, integer, text[], text, integer, text) to service_role;
grant execute on function public.edit_order_quote_revision(text, uuid, uuid, uuid, integer, text[], text, integer) to service_role;
grant execute on function public.withdraw_order_quote_revision(text, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.create_order_quote_snapshot(text, uuid, uuid, integer, uuid, text, text, integer, integer, integer, integer, integer, timestamptz, text, text, timestamptz) to service_role;
grant execute on function public.keep_current_order_quote(text, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.accept_active_order_quote(text, uuid, uuid, integer) to service_role;
grant execute on function public.decline_active_order_quote(text, uuid, uuid, integer) to service_role;
grant execute on function public.decline_order_after_quote_revision(text, uuid, uuid, integer, uuid, text) to service_role;
