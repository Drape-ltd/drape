-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Extend profile_completed trigger to fire on INSERT as well
--
-- Problem: 20260318000002 only created a BEFORE UPDATE trigger.
-- The setup wizard calls upsert() which performs an INSERT on first run,
-- so the trigger never fires and the client-supplied `profile_completed: true`
-- was written directly — bypassing the verification gate.
--
-- Fix: (Re)create the trigger function and attach it as BEFORE INSERT OR UPDATE.
-- Self-contained — safe to run even if 20260318000002 was never applied.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. (Re)create the trigger function — idempotent via CREATE OR REPLACE
CREATE OR REPLACE FUNCTION compute_tailor_profile_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 2. Revoke client write access on profile_completed (idempotent — no-op if already revoked)
REVOKE UPDATE (profile_completed) ON tailor_profiles FROM authenticated;

-- 3. Drop old trigger (any version) and recreate as BEFORE INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_tailor_profile_completed ON tailor_profiles;

CREATE TRIGGER trg_tailor_profile_completed
  BEFORE INSERT OR UPDATE ON tailor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION compute_tailor_profile_completed();

-- 4. Backfill existing rows
UPDATE tailor_profiles
SET profile_completed = (
  display_name IS NOT NULL AND trim(display_name) <> '' AND
  location     IS NOT NULL AND trim(location)     <> '' AND
  id_verification_status IN ('PENDING', 'APPROVED')
);
