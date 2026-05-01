alter table if exists public.payment_webhook_events
  add column if not exists idempotency_key text;

create index if not exists payment_webhook_events_idempotency_created_idx
  on public.payment_webhook_events (idempotency_key, created_at desc);
