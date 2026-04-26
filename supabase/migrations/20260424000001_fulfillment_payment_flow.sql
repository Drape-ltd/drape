alter table public.orders
  add column if not exists fulfillment_payment_requested_at timestamptz,
  add column if not exists fulfillment_payment_paid_at timestamptz,
  add column if not exists fulfillment_payment_provider payment_provider,
  add column if not exists fulfillment_payment_intent_id text,
  add column if not exists fulfillment_payment_checkout_url text;

create index if not exists orders_fulfillment_payment_requested_idx
  on public.orders (fulfillment_payment_requested_at)
  where fulfillment_payment_requested_at is not null;
