-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Tailor Diary / Client Passport
-- Safe to run multiple times (idempotent).
-- NOTE: phone_number and email intentionally omitted — safety policy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diary_entries (
  id                     uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  tailor_id              uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ── Customer info ─────────────────────────────────────────────────────────
  full_name              text    NOT NULL,
  gender                 text,   -- MALE | FEMALE | OTHER
  client_notes           text,

  -- ── Measurements (stored in tailor's preferred unit) ──────────────────────
  measurement_unit       text    NOT NULL DEFAULT 'cm',  -- cm | in
  chest                  numeric,
  shoulder               numeric,
  sleeve                 numeric,
  waist                  numeric,
  hip                    numeric,
  trouser_length         numeric,
  neck                   numeric,
  thigh                  numeric,
  inseam                 numeric,
  ankle                  numeric,
  bicep                  numeric,
  wrist                  numeric,
  back_length            numeric,
  under_bust             numeric,
  custom_measurements    jsonb   NOT NULL DEFAULT '{}',  -- { label: value }

  -- ── Tailor notes ──────────────────────────────────────────────────────────
  fabric_preference      text,
  style_preference       text,
  event_type             text,   -- WEDDING | CASUAL | ASOEBI | FORMAL | OTHER
  special_fitting_notes  text,

  -- ── Session history ───────────────────────────────────────────────────────
  measured_at            date,
  measured_location      text    NOT NULL DEFAULT 'SHOP',  -- SHOP | CUSTOMER_HOME | EVENT
  past_outfits           jsonb   NOT NULL DEFAULT '[]',    -- [{ name, date, notes }]

  -- ── Client Passport (invite & claim) ─────────────────────────────────────
  passport_id            uuid    NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invite_status          text    NOT NULL DEFAULT 'NOT_INVITED',  -- NOT_INVITED | INVITE_SENT | CLAIMED
  claimed_by_user_id     uuid,   -- auth.users.id — set when customer claims the passport

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Add new columns if they don't exist yet (for re-runs after initial deployment)
ALTER TABLE diary_entries
  ADD COLUMN IF NOT EXISTS inseam      numeric,
  ADD COLUMN IF NOT EXISTS ankle       numeric,
  ADD COLUMN IF NOT EXISTS bicep       numeric,
  ADD COLUMN IF NOT EXISTS wrist       numeric,
  ADD COLUMN IF NOT EXISTS back_length numeric,
  ADD COLUMN IF NOT EXISTS under_bust  numeric;

-- Remove contact columns if they were added in a prior run (safety policy)
ALTER TABLE diary_entries
  DROP COLUMN IF EXISTS phone_number,
  DROP COLUMN IF EXISTS email;

-- Constraints (drop first so re-runs are idempotent)
ALTER TABLE diary_entries
  DROP CONSTRAINT IF EXISTS diary_gender_check,
  DROP CONSTRAINT IF EXISTS diary_event_type_check,
  DROP CONSTRAINT IF EXISTS diary_location_check,
  DROP CONSTRAINT IF EXISTS diary_unit_check,
  DROP CONSTRAINT IF EXISTS diary_invite_status_check;

ALTER TABLE diary_entries
  ADD CONSTRAINT diary_gender_check
    CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER')),
  ADD CONSTRAINT diary_event_type_check
    CHECK (event_type IS NULL OR event_type IN ('WEDDING', 'CASUAL', 'ASOEBI', 'FORMAL', 'OTHER')),
  ADD CONSTRAINT diary_location_check
    CHECK (measured_location IN ('SHOP', 'CUSTOMER_HOME', 'EVENT')),
  ADD CONSTRAINT diary_unit_check
    CHECK (measurement_unit IN ('cm', 'in')),
  ADD CONSTRAINT diary_invite_status_check
    CHECK (invite_status IN ('NOT_INVITED', 'INVITE_SENT', 'CLAIMED'));

-- Index: fast lookup by tailor
CREATE INDEX IF NOT EXISTS diary_entries_tailor_id_idx ON diary_entries (tailor_id);

-- Index: claim flow looks up by passport_id
CREATE INDEX IF NOT EXISTS diary_entries_passport_id_idx ON diary_entries (passport_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

-- Tailor owns their diary entirely
DROP POLICY IF EXISTS "tailors: own diary" ON diary_entries;
CREATE POLICY "tailors: own diary"
  ON diary_entries FOR ALL
  TO authenticated
  USING  (tailor_id = auth.uid())
  WITH CHECK (tailor_id = auth.uid());

-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE diary_entries TO authenticated;
