-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Add delivery address to orders
-- ─────────────────────────────────────────────────────────────────────────────

alter table orders add column if not exists delivery_address text;
