-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Tailor profile INSERT policy
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: tailor_profiles — ensure an INSERT policy exists
--
-- initial_schema.sql created a FOR ALL policy ("Tailor owns their profile")
-- that covers INSERT. But if that migration skipped (or the policy was
-- accidentally dropped), authenticated tailors have no permissive INSERT
-- policy and every upsert INSERT path returns 42501.
--
-- Adding an explicit INSERT policy here is safe even if the FOR ALL
-- policy already exists — multiple permissive policies are OR-ed by
-- PostgreSQL, so the net effect is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "tailors: insert own profile" ON tailor_profiles;
CREATE POLICY "tailors: insert own profile"
  ON tailor_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()::text);
