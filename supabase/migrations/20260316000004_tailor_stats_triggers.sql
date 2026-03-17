-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Tailor Stats Triggers
-- Moves avg_rating / total_reviews / total_orders updates from client-side code
-- into the database so a customer cannot manipulate tailor profile stats directly.
-- Safe to run multiple times (all statements are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER 1: update avg_rating + total_reviews after a review is inserted
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_tailor_rating_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tailor_profiles
  SET
    avg_rating    = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM reviews
      WHERE tailor_id::text = NEW.tailor_id::text
    ),
    total_reviews = (
      SELECT COUNT(*)
      FROM reviews
      WHERE tailor_id::text = NEW.tailor_id::text
    ),
    updated_at = now()
  WHERE user_id::text = NEW.tailor_id::text;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_update_tailor_rating_stats ON reviews;
CREATE TRIGGER reviews_update_tailor_rating_stats
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_tailor_rating_stats();


-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER 2: increment total_orders when an order first reaches a terminal
--            completion stage (COMPLETE, DELIVERED, or COLLECTED).
--            Only fires on the transition — not on subsequent updates.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_tailor_total_orders()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only act when transitioning INTO a terminal stage for the first time
  IF NEW.stage IN ('COMPLETE', 'DELIVERED', 'COLLECTED')
     AND (OLD.stage IS NULL OR OLD.stage NOT IN ('COMPLETE', 'DELIVERED', 'COLLECTED'))
  THEN
    UPDATE tailor_profiles
    SET
      total_orders = COALESCE(total_orders, 0) + 1,
      updated_at   = now()
    WHERE user_id::text = NEW.tailor_id::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_increment_tailor_total_orders ON orders;
CREATE TRIGGER orders_increment_tailor_total_orders
  AFTER UPDATE OF stage ON orders
  FOR EACH ROW EXECUTE FUNCTION increment_tailor_total_orders();
