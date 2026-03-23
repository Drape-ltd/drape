-- ============================================================
-- Drape V1 — Role Grants
-- Run this in the Supabase SQL Editor after schema push + rls.sql.
-- These grants let anon/authenticated reach the tables.
-- RLS policies (rls.sql) then control which ROWS they can touch.
-- Edge Functions in this codebase also rely on service_role reaching PostgREST
-- and RPCs in the public schema.
-- ============================================================

-- ─── Schema access ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- ─── NOTE: public.users does not exist in this project ───────────────────────
-- Profile data lives in customer_profiles / tailor_profiles referencing
-- auth.users(id) directly. No grant on public.users is needed.

-- ─── Sequences (needed for any INSERT that uses a serial/uuid default) ────────
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ─── customer_profiles ────────────────────────────────────────────────────────
-- Customers read/write their own row (RLS enforces the user_id filter).
-- Tailors need SELECT to read a customer's profile on shared orders (RLS handles that too).
GRANT SELECT, INSERT, UPDATE ON TABLE customer_profiles TO authenticated;

-- ─── tailor_profiles ──────────────────────────────────────────────────────────
-- Anyone (including anon) can read live profiles for discovery/search.
GRANT SELECT ON TABLE tailor_profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE tailor_profiles TO authenticated;

-- ─── portfolio_photos ─────────────────────────────────────────────────────────
-- Anyone can view photos for live profiles; tailors manage their own.
GRANT SELECT ON TABLE portfolio_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE portfolio_photos TO authenticated;

-- ─── tailor_client_notes ──────────────────────────────────────────────────────
-- Private fit notes — only the tailor who owns them.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tailor_client_notes TO authenticated;

-- ─── tailor_clients ───────────────────────────────────────────────────────────
-- Private CRM — only the owning tailor.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tailor_clients TO authenticated;

-- ─── offline_orders ───────────────────────────────────────────────────────────
-- Linked to tailor_clients — only the owning tailor.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE offline_orders TO authenticated;

-- ─── orders ───────────────────────────────────────────────────────────────────
-- Customers create orders; both parties read & update their side (RLS).
GRANT SELECT, INSERT, UPDATE ON TABLE orders TO authenticated;

-- ─── order_stage_updates ──────────────────────────────────────────────────────
-- Both parties read; only the tailor inserts.
GRANT SELECT, INSERT ON TABLE order_stage_updates TO authenticated;

-- ─── order_photos ─────────────────────────────────────────────────────────────
-- Both parties read; only the tailor inserts.
GRANT SELECT, INSERT ON TABLE order_photos TO authenticated;

-- ─── messages ─────────────────────────────────────────────────────────────────
-- Both parties send and read; UPDATE to mark as read.
GRANT SELECT, INSERT, UPDATE ON TABLE messages TO authenticated;

-- ─── reviews ──────────────────────────────────────────────────────────────────
-- Published reviews are public; customers write; tailors respond.
GRANT SELECT ON TABLE reviews TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE reviews TO authenticated;

-- ─── disputes ─────────────────────────────────────────────────────────────────
-- Both parties read; only customers open a dispute.
GRANT SELECT, INSERT ON TABLE disputes TO authenticated;

-- ─── payouts ──────────────────────────────────────────────────────────────────
-- Tailors read their own payout records (no user writes — service role only).
GRANT SELECT ON TABLE payouts TO authenticated;

-- ─── push_tokens ──────────────────────────────────────────────────────────────
-- Each user manages their own device token.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_tokens TO authenticated;

-- ─── contact_bypass_logs ──────────────────────────────────────────────────────
-- Service role only — no grants to anon or authenticated.
-- (RLS is enabled with no policies, so nothing gets through.)
