-- Ensure trigger-maintained tailor stats can run from customer-initiated flows.
-- Without SECURITY DEFINER, review inserts can fail because the trigger tries
-- to update tailor_profiles using the caller's privileges.

CREATE OR REPLACE FUNCTION update_tailor_rating_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

CREATE OR REPLACE FUNCTION increment_tailor_total_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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
