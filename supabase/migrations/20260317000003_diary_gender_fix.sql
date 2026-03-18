-- Update diary_entries gender constraint to include PREFER_NOT_TO_SAY.
-- Keeps 'OTHER' in the allowed set for backwards compatibility with existing rows.
ALTER TABLE diary_entries DROP CONSTRAINT IF EXISTS diary_gender_check;

ALTER TABLE diary_entries
  ADD CONSTRAINT diary_gender_check
    CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'));
