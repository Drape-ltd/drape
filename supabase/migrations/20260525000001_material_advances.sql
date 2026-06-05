-- Material advances let Drape fund approved order expenses without releasing
-- the main escrow early. The order payment stays protected; only the
-- customer-approved material portion can move through ops review.

do $$
begin
  if exists (select 1 from pg_type where typname = 'order_payment_phase')
     and not exists (
       select 1
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'order_payment_phase'
         and e.enumlabel = 'MATERIAL_ADVANCE'
     ) then
    alter type order_payment_phase add value 'MATERIAL_ADVANCE';
  end if;
end;
$$;

do $$
declare
  v_order_id_type text;
begin
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

  if v_order_id_type is null then
    raise exception 'Could not resolve public.orders.id type for order_material_advances.';
  end if;

  execute format($sql$
    create table if not exists public.order_material_advances (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      customer_id uuid not null references public.users(id) on delete cascade,
      tailor_id uuid not null references public.users(id) on delete cascade,
      requested_by uuid not null references public.users(id) on delete restrict,
      title text not null check (char_length(trim(title)) between 3 and 120),
      description text not null check (char_length(trim(description)) between 10 and 1000),
      amount integer not null check (amount > 0),
      currency currency not null,
      status text not null default 'REQUESTED' check (
        status in (
          'REQUESTED',
          'DECLINED',
          'PAYMENT_PENDING',
          'PAYMENT_FAILED',
          'PAID',
          'OPS_REVIEW',
          'RELEASED',
          'BLOCKED',
          'CANCELLED'
        )
      ),
      release_status text not null default 'NOT_REQUESTED' check (
        release_status in ('NOT_REQUESTED', 'OPS_REVIEW', 'RELEASED', 'BLOCKED')
      ),
      estimate_photo_url text,
      receipt_url text,
      receipt_note text,
      customer_response_note text,
      payment_provider payment_provider,
      provider_payment_id text,
      provider_checkout_url text,
      payment_id uuid references public.order_payments(id) on delete set null,
      ops_issue_id uuid references public.ops_issues(id) on delete set null,
      provider_release_id text,
      provider_release_response jsonb not null default '{}'::jsonb,
      release_blocked_reason text,
      requested_at timestamptz not null default now(),
      customer_approved_at timestamptz,
      customer_declined_at timestamptz,
      paid_at timestamptz,
      receipt_uploaded_at timestamptz,
      release_requested_at timestamptz,
      released_at timestamptz,
      blocked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $sql$, v_order_id_type);
end;
$$;

create index if not exists order_material_advances_order_idx
  on public.order_material_advances (order_id, created_at desc);

create index if not exists order_material_advances_customer_idx
  on public.order_material_advances (customer_id, status, created_at desc);

create index if not exists order_material_advances_tailor_idx
  on public.order_material_advances (tailor_id, status, created_at desc);

create unique index if not exists order_material_advances_provider_payment_idx
  on public.order_material_advances (payment_provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists order_material_advances_one_active_idx
  on public.order_material_advances (order_id)
  where status in ('REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW', 'BLOCKED');

alter table public.order_material_advances enable row level security;

drop policy if exists "Order participants view material advances" on public.order_material_advances;
create policy "Order participants view material advances"
  on public.order_material_advances
  for select
  using (customer_id = auth.uid() or tailor_id = auth.uid());

grant select on table public.order_material_advances to authenticated;

drop trigger if exists order_material_advances_updated_at on public.order_material_advances;
create trigger order_material_advances_updated_at
  before update on public.order_material_advances
  for each row execute function handle_updated_at();
