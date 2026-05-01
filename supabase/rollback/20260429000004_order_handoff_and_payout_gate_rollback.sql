drop index if exists public.payouts_order_status_idx;
drop index if exists public.orders_handoff_release_idx;

alter table public.orders
  drop constraint if exists orders_handoff_confirmation_source_check;

alter table public.orders
  drop column if exists handoff_confirmation_source,
  drop column if exists customer_handoff_confirmed_at,
  drop column if exists handoff_completed_at;
