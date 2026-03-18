-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Tailor Ranking Score
--
-- AUDIT — current state before this migration:
--   All explore + search queries sort by avg_rating DESC.
--   Limitations:
--     • New tailors (0 reviews) always rank at the bottom regardless of
--       profile quality, verification, or portfolio completeness.
--     • No quality signal for verification status or profile readiness.
--     • Fully-booked tailors rank the same as available ones.
--     • Location is hard-filtered (excluded) rather than boosted — global
--       results disappear instead of appearing lower.
--
-- FIX — trigger-maintained `ranking_score` column computed from static
-- quality signals. Queries sort by ranking_score DESC.
--
-- Scoring signals (Phase 1):
--   profile_completed               → +30
--   id_verification_status APPROVED → +40
--   id_verification_status PENDING  → +10
--   portfolio_photo_urls ≥ 1 photo  → +20
--   availability = 'OPEN'           → +10
--
-- Max possible score: 110 (complete, approved, portfolio, available)
--
-- Future signals — add to the function body without any schema change:
--   avg_rating × weight, total_reviews, total_orders, avg_response_hours
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add column (idempotent)
ALTER TABLE tailor_profiles
  ADD COLUMN IF NOT EXISTS ranking_score integer NOT NULL DEFAULT 0;

-- 2. Scoring function
CREATE OR REPLACE FUNCTION compute_tailor_ranking_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.ranking_score :=
    -- Profile completeness (name + location + ID verification started)
    CASE WHEN NEW.profile_completed THEN 30 ELSE 0 END

    -- ID verification level
    + CASE NEW.id_verification_status
        WHEN 'APPROVED' THEN 40
        WHEN 'PENDING'  THEN 10
        ELSE 0
      END

    -- Has at least one portfolio photo
    + CASE WHEN COALESCE(array_length(NEW.portfolio_photo_urls, 1), 0) > 0
        THEN 20 ELSE 0
      END

    -- Currently accepting orders
    + CASE WHEN NEW.availability = 'OPEN' THEN 10 ELSE 0 END;

  RETURN NEW;
END;
$$;

-- 3. Attach trigger — fires on every profile write
DROP TRIGGER IF EXISTS trg_tailor_ranking_score ON tailor_profiles;
CREATE TRIGGER trg_tailor_ranking_score
  BEFORE INSERT OR UPDATE ON tailor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION compute_tailor_ranking_score();

-- 4. Backfill existing rows (direct expression — avoids re-triggering loops)
UPDATE tailor_profiles
SET ranking_score = (
    CASE WHEN profile_completed THEN 30 ELSE 0 END
  + CASE id_verification_status
      WHEN 'APPROVED' THEN 40
      WHEN 'PENDING'  THEN 10
      ELSE 0
    END
  + CASE WHEN COALESCE(array_length(portfolio_photo_urls, 1), 0) > 0
      THEN 20 ELSE 0
    END
  + CASE WHEN availability = 'OPEN' THEN 10 ELSE 0 END
);
