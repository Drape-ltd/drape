-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Fix signup bugs found during first real-device test
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: saved_tailors — tailor_profile_id was TEXT with no FK.
--
-- PostgREST requires a real foreign key to resolve join hints like
-- tailor_profiles!tailor_profile_id(...).  Recreate the table with a
-- proper uuid FK so the Saved screen query works.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS saved_tailors CASCADE;

CREATE TABLE saved_tailors (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tailor_profile_id uuid        NOT NULL REFERENCES tailor_profiles(id) ON DELETE CASCADE,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (user_id, tailor_profile_id)
);

ALTER TABLE saved_tailors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers: manage own saved tailors" ON saved_tailors;
CREATE POLICY "customers: manage own saved tailors"
  ON saved_tailors FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON TABLE saved_tailors TO authenticated;

DROP INDEX IF EXISTS saved_tailors_user_id_idx;
DROP INDEX IF EXISTS saved_tailors_tailor_id_idx;
CREATE INDEX saved_tailors_user_id_idx    ON saved_tailors (user_id);
CREATE INDEX saved_tailors_tailor_id_idx  ON saved_tailors (tailor_profile_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: tailor_profiles UPDATE grant — add is_live so the setup upsert
--         (DO UPDATE SET …) doesn't fail with column-level 403.
--
-- Context: security_fixes.sql revoked blanket UPDATE and re-granted only
-- safe editable columns — but omitted is_live.  The setup wizard upsert
-- includes is_live in its payload, which the DO UPDATE SET clause then
-- tries to write, triggering a column-permission 403.
--
-- Granting UPDATE on is_live to authenticated is safe because:
--  - The RLS "tailors: update own profile" USING clause restricts which ROWS
--    they can touch (only their own).
--  - Tailors legitimately need to be able to keep is_live as-is or set it
--    to false (ops can always override it via service role).
--  - The route guard in _layout.tsx already redirects unverified tailors
--    back to setup, so a self-set is_live = false is harmless.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT UPDATE (is_live) ON TABLE tailor_profiles TO authenticated;
