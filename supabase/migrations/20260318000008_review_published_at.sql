-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Set published_at on review insert
--
-- BUG: reviews.published_at was never set. All rows have published_at = NULL,
-- meaning reviews exist in the DB but no moderation gate is enforced and the
-- UI hint "Published after a short review hold" is misleading.
--
-- Decision (V1): publish reviews immediately on insert (no human moderation
-- queue yet). The flagged column remains available for future moderation.
-- The "short review hold" hint will be removed from the UI separately.
--
-- Fix: trigger that sets published_at = now() on INSERT if not already set.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_review_published_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_published_at ON reviews;
CREATE TRIGGER trg_review_published_at
  BEFORE INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION set_review_published_at();

-- Backfill existing reviews that have no published_at
UPDATE reviews SET published_at = created_at WHERE published_at IS NULL;
