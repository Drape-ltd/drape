-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Orders insert hardening
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- Customers should not need to read tailor auth UUIDs from client code.
-- Orders already sync tailor_id from tailor_profile_id via DB trigger.
REVOKE SELECT (user_id) ON TABLE tailor_profiles FROM anon, authenticated;

-- Authenticated clients should not be able to toggle is_live directly.
REVOKE UPDATE (is_live) ON TABLE tailor_profiles FROM authenticated;

-- Tighten customer order inserts so the caller can only create their own
-- pending-quote order against an existing live tailor profile.
DROP POLICY IF EXISTS "Customer creates orders" ON orders;
CREATE POLICY "Customer creates orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = customer_id
    AND stage = 'PENDING_QUOTE'
    AND EXISTS (
      SELECT 1 FROM tailor_profiles tp
      WHERE tp.id::text = orders.tailor_profile_id::text
        AND tp.is_live = true
        AND (
          orders.tailor_id IS NULL
          OR orders.tailor_id::text = tp.user_id::text
        )
    )
  );
