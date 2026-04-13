alter table public.orders
  add column if not exists payment_checkout_url text;
