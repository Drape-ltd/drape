-- ============================================================
-- Drape V1 — New order stages: CONSULTATION, DESIGNING, SOURCING
-- Run once in the Supabase SQL Editor (or via CLI).
-- ============================================================

-- Add new enum values (IF NOT EXISTS requires Postgres 14+;
-- Supabase runs Postgres 15+ so this is safe)
ALTER TYPE order_stage ADD VALUE IF NOT EXISTS 'CONSULTATION' AFTER 'PENDING_QUOTE';
ALTER TYPE order_stage ADD VALUE IF NOT EXISTS 'DESIGNING'    AFTER 'CONFIRMED';
ALTER TYPE order_stage ADD VALUE IF NOT EXISTS 'SOURCING'     AFTER 'DESIGNING';

-- Add consultation_fee column (pence, same convention as quoted_amount)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS consultation_fee INTEGER;

-- Backfill: existing orders are unaffected (NULL = no consultation fee)
