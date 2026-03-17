-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Add avatar_url to tailor_profiles
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tailor_profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Grant UPDATE on the new column (column-level grants are additive)
GRANT UPDATE (avatar_url) ON TABLE tailor_profiles TO authenticated;
