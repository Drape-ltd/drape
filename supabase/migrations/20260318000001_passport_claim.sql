-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Passport claim security hardening
-- Safe to run multiple times (idempotent).
--
-- Changes:
--   1. Add invite_expires_at to diary_entries (30-day TTL set when tailor shares)
--   2. Lock claimed_by_user_id — only service role may write it
--   3. Explicit column-level GRANTs so authenticated (tailor) can only update
--      invite fields they own; claim fields are service-role-only
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add expiry column
ALTER TABLE diary_entries
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;

-- 2. Revoke broad UPDATE so we can be explicit about which columns each role may touch
-- (authenticated = tailor JWT)
REVOKE UPDATE ON TABLE diary_entries FROM authenticated;

-- 3. Re-grant only the columns a tailor legitimately needs to update
GRANT UPDATE (
  full_name,
  gender,
  client_notes,
  measurement_unit,
  chest, shoulder, sleeve, waist, hip, trouser_length,
  neck, thigh, inseam, ankle, bicep, wrist, back_length, under_bust,
  custom_measurements,
  fabric_preference, style_preference, event_type, special_fitting_notes,
  measured_at, measured_location, past_outfits,
  invite_status, invite_expires_at
) ON diary_entries TO authenticated;

-- claimed_by_user_id is intentionally NOT in the GRANT above.
-- It is written exclusively by the claim-passport Edge Function using the
-- service role key, which bypasses RLS and column-level restrictions.
-- This prevents a tailor's authenticated client from ever forging a claim.

-- 4. Ensure the RLS policy is still in place (idempotent re-create)
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tailors: own diary" ON diary_entries;
CREATE POLICY "tailors: own diary"
  ON diary_entries FOR ALL
  TO authenticated
  USING  (tailor_id = auth.uid())
  WITH CHECK (tailor_id = auth.uid());
