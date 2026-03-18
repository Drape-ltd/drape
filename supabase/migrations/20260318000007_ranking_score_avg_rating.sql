-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Add avg_rating signal to ranking_score
--
-- Phase 1 ranking_score used only static profile signals (max 110):
--   profile_completed               → +30
--   id_verification_status APPROVED → +40  (now VERIFIED, per _006)
--   id_verification_status PENDING  → +10
--   portfolio_photo_urls ≥ 1        → +20
--   availability = 'OPEN'           → +10
--
-- Problem: a tailor with 50 five-star reviews ranks identically to a brand-new
-- tailor with the same profile completeness. Quality is invisible.
--
-- Fix: add a Bayesian-weighted rating boost.
--
--   rating_boost = ROUND( (total_reviews / (total_reviews + 5)) * avg_rating * 10 )
--
--   Why Bayesian?
--   • Low review counts are shrunk toward 0 so a single 5★ review doesn't
--     catapult a new tailor above a veteran with 50 solid reviews.
--   • The weight (total_reviews / (total_reviews + 5)) approaches 1.0 as
--     review volume grows, so established tailors are fully rewarded.
--
--   Examples:
--     0 reviews, any rating  →  0 pts   (no signal)
--     1 review,  5.0★        →  8 pts
--     5 reviews, 4.0★        → 20 pts
--    10 reviews, 4.5★        → 30 pts
--    50 reviews, 4.8★        → ~44 pts
--
-- New max possible score: ~160
--   (110 static + up to ~50 rating boost for a high-volume, high-rated tailor)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Update trigger function
CREATE OR REPLACE FUNCTION compute_tailor_ranking_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.ranking_score :=
    -- Profile completeness
    CASE WHEN NEW.profile_completed THEN 30 ELSE 0 END

    -- ID verification level
    + CASE NEW.id_verification_status
        WHEN 'VERIFIED' THEN 40
        WHEN 'PENDING'  THEN 10
        ELSE 0
      END

    -- Has at least one portfolio photo
    + CASE WHEN COALESCE(array_length(NEW.portfolio_photo_urls, 1), 0) > 0
        THEN 20 ELSE 0
      END

    -- Currently accepting orders
    + CASE WHEN NEW.availability = 'OPEN' THEN 10 ELSE 0 END

    -- Bayesian-weighted rating boost (0–~50 pts)
    -- Shrinks toward 0 for low review counts; fully weighted at high volume.
    + CASE WHEN COALESCE(NEW.total_reviews, 0) > 0
        THEN ROUND(
          (NEW.total_reviews::numeric / (NEW.total_reviews + 5)) *
          COALESCE(NEW.avg_rating, 0) * 10
        )::integer
        ELSE 0
      END;

  RETURN NEW;
END;
$$;

-- 2. Backfill existing rows (direct expression — avoids re-triggering loops)
UPDATE tailor_profiles
SET ranking_score = (
    CASE WHEN profile_completed THEN 30 ELSE 0 END
  + CASE id_verification_status
      WHEN 'VERIFIED' THEN 40
      WHEN 'PENDING'  THEN 10
      ELSE 0
    END
  + CASE WHEN COALESCE(array_length(portfolio_photo_urls, 1), 0) > 0
      THEN 20 ELSE 0
    END
  + CASE WHEN availability = 'OPEN' THEN 10 ELSE 0 END
  + CASE WHEN COALESCE(total_reviews, 0) > 0
      THEN ROUND(
        (total_reviews::numeric / (total_reviews + 5)) *
        COALESCE(avg_rating, 0) * 10
      )::integer
      ELSE 0
    END
);
