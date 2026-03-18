-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Harden profile_completed: trigger-computed, not client-settable
-- Safe to run multiple times (idempotent).
--
-- Problem: profile_completed was included in the authenticated column-level
-- UPDATE grant, allowing a tailor to set it to TRUE directly via the client
-- before completing ID verification — bypassing the verification gate.
--
-- Fix:
--   1. Revoke UPDATE on profile_completed from authenticated role.
--   2. Create a BEFORE UPDATE trigger that recomputes profile_completed
--      automatically whenever the relevant fields change. The tailor client
--      never needs to set this column; the trigger handles it.
--
-- A profile is considered complete when:
--   - display_name is set (non-null, non-empty)
--   - location is set (non-null, non-empty)
--   - id_verification_status is PENDING or APPROVED
--     (meaning the tailor has submitted their ID for review)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Revoke UPDATE on profile_completed from authenticated (tailor JWT)
--    profile_completed is now write-protected from the client entirely.
REVOKE UPDATE (profile_completed) ON tailor_profiles FROM authenticated;

-- 2. Trigger function — recomputes profile_completed before every UPDATE
CREATE OR REPLACE FUNCTION compute_tailor_profile_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as owner, not as the calling role
AS $$
BEGIN
  NEW.profile_completed := (
    NEW.display_name IS NOT NULL AND trim(NEW.display_name) <> '' AND
    NEW.location     IS NOT NULL AND trim(NEW.location)     <> '' AND
    NEW.id_verification_status IN ('PENDING', 'APPROVED')
  );
  RETURN NEW;
END;
$$;

-- 3. Attach trigger to tailor_profiles (drop first for idempotency)
DROP TRIGGER IF EXISTS trg_tailor_profile_completed ON tailor_profiles;
CREATE TRIGGER trg_tailor_profile_completed
  BEFORE UPDATE ON tailor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION compute_tailor_profile_completed();

-- 4. Backfill: recompute the flag for all existing rows so the column is
--    consistent with the new logic immediately after the migration runs.
UPDATE tailor_profiles
SET profile_completed = (
  display_name IS NOT NULL AND trim(display_name) <> '' AND
  location     IS NOT NULL AND trim(location)     <> '' AND
  id_verification_status IN ('PENDING', 'APPROVED')
);
