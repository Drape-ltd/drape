-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Fix profile_completed: 'APPROVED' → 'VERIFIED'
--
-- BUG: compute_tailor_profile_completed() checks for
--        id_verification_status IN ('PENDING', 'APPROVED')
--      but the column's CHECK constraint only permits:
--        ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED')
--      'APPROVED' is not a valid value and can never be written to the DB,
--      so verified tailors never reach profile_completed = true.
--
-- Result of the bug:
--   • Verified tailors miss the +30 ranking_score from profile_completed
--   • They rank below unverified-but-complete tailors
--   • No error is thrown — the failure is completely silent
--
-- Fix: replace 'APPROVED' with 'VERIFIED' in the trigger condition.
--
-- Trigger firing order (confirmed correct — no change needed):
--   PostgreSQL fires multiple BEFORE triggers alphabetically by name.
--   trg_tailor_profile_completed  ('p') fires before
--   trg_tailor_ranking_score      ('r')
--   → ranking_score always reads the freshly-computed profile_completed. ✓
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Fix the trigger function
CREATE OR REPLACE FUNCTION compute_tailor_profile_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.profile_completed := (
    NEW.display_name IS NOT NULL AND trim(NEW.display_name) <> '' AND
    NEW.location     IS NOT NULL AND trim(NEW.location)     <> '' AND
    NEW.id_verification_status IN ('PENDING', 'VERIFIED')
  );
  RETURN NEW;
END;
$$;

-- 2. Backfill existing rows with the corrected logic
--    (direct expression — avoids re-triggering loops)
UPDATE tailor_profiles
SET profile_completed = (
  display_name IS NOT NULL AND trim(display_name) <> '' AND
  location     IS NOT NULL AND trim(location)     <> '' AND
  id_verification_status IN ('PENDING', 'VERIFIED')
);

-- 3. Backfill ranking_score for any rows whose profile_completed just changed
--    (ranking_score trigger fires on UPDATE, so touching updated_at is enough)
UPDATE tailor_profiles
SET updated_at = now()
WHERE profile_completed = true
  AND ranking_score < 30;
