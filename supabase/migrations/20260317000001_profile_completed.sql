-- Add profile_completed flag to tailor_profiles
ALTER TABLE tailor_profiles
  ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false;

-- Grant the new column (column-level grants require explicit addition)
GRANT SELECT (profile_completed) ON TABLE tailor_profiles TO authenticated;
GRANT UPDATE (profile_completed) ON TABLE tailor_profiles TO authenticated;
