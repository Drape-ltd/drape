-- ============================================================
-- Drape V1 — Postgres helper functions
-- Run once in the Supabase SQL Editor.
-- ============================================================

-- Safely increments tailor_profiles.total_orders by 1.
-- Called from the mobile app when an order is marked COMPLETE.
CREATE OR REPLACE FUNCTION increment_tailor_orders(tailor_user_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE tailor_profiles
  SET total_orders = total_orders + 1,
      updated_at   = now()
  WHERE user_id = tailor_user_id;
$$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION increment_tailor_orders(TEXT) TO authenticated;
