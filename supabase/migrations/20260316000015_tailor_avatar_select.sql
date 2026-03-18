-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Grant SELECT on avatar_url for tailor_profiles
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: rls_hardening.sql (migration 002) uses column-level SELECT grants on
-- tailor_profiles. Any column added after that migration will not be
-- selectable until a GRANT SELECT (col) is issued explicitly.
--
-- avatar_url was added in migration 014. Without this grant,
-- GET /rest/v1/tailor_profiles?select=...avatar_url... returns 403.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT (avatar_url) ON TABLE tailor_profiles TO anon, authenticated;
