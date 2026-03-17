-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Add quoted_currency to orders
-- ─────────────────────────────────────────────────────────────────────────────

alter table orders add column if not exists quoted_currency text default 'USD';
