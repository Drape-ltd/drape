alter table public.orders
  add column if not exists handoff_completed_at timestamptz,
  add column if not exists customer_handoff_confirmed_at timestamptz,
  add column if not exists handoff_confirmation_source text;

alter table public.orders
  drop constraint if exists orders_handoff_confirmation_source_check;

alter table public.orders
  add constraint orders_handoff_confirmation_source_check
  check (
    handoff_confirmation_source is null
    or handoff_confirmation_source in (
      'CUSTOMER_RECEIPT',
      'CUSTOMER_COMPLETE',
      'COLLECTION_CODE_VERIFIED',
      'CARRIER_WEBHOOK',
      'SYSTEM_AUTO_DELIVERED',
      'HISTORICAL_BACKFILL'
    )
  );

alter table if exists public.orders disable trigger orders_terminal_guard;

update public.orders
set handoff_completed_at = coalesce(handoff_completed_at, stage_updated_at, updated_at, created_at),
    handoff_confirmation_source = coalesce(handoff_confirmation_source, 'HISTORICAL_BACKFILL')
where stage in ('DELIVERED', 'COLLECTED', 'COMPLETE')
  and handoff_completed_at is null;

update public.orders
set customer_handoff_confirmed_at = coalesce(customer_handoff_confirmed_at, handoff_completed_at, stage_updated_at, updated_at, created_at),
    handoff_confirmation_source = coalesce(handoff_confirmation_source, 'HISTORICAL_BACKFILL')
where stage in ('COLLECTED', 'COMPLETE')
  and customer_handoff_confirmed_at is null;

alter table if exists public.orders enable trigger orders_terminal_guard;

create index if not exists orders_handoff_release_idx
  on public.orders (escrow_released, stage, customer_handoff_confirmed_at, handoff_completed_at);

create index if not exists payouts_order_status_idx
  on public.payouts (order_id, status, processed_at desc);
