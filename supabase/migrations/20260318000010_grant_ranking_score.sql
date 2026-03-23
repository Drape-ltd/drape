-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Grant SELECT on ranking_score to anon + authenticated
--
-- ranking_score was added in 20260318000005_tailor_ranking_score.sql AFTER
-- the column-level grants in 20260316000002_rls_hardening.sql were set.
-- New columns are NOT automatically included in existing column grants, so
-- anon/authenticated were denied access, causing PostgREST to return 403
-- on all tailor_profiles SELECT queries that include this column.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT (ranking_score, profile_completed)
  ON TABLE tailor_profiles
  TO anon, authenticated;
