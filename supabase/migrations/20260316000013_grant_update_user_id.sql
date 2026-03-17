-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Grant UPDATE on user_id for tailor_profiles upsert
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: PostgREST upsert includes ALL payload columns in DO UPDATE SET,
-- including the on_conflict column (user_id).  Since security_fixes.sql
-- revoked blanket UPDATE and re-granted only specific columns, user_id
-- was left without an UPDATE grant, causing every upsert to 403 with
-- 42501 (insufficient_privilege for column user_id).
--
-- This grant is safe: the RLS "tailors: update own profile" policy
-- enforces WITH CHECK (user_id = auth.uid()::text), so a tailor can only
-- ever write their own auth uid into user_id — a functional no-op.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT UPDATE (user_id) ON TABLE tailor_profiles TO authenticated;
