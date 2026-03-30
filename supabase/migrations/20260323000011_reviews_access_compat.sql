-- Make review submission/reads resilient across dev environments.
-- Some projects drifted without explicit authenticated grants on `reviews`,
-- which can make valid RLS policies fail in practice.

GRANT SELECT, INSERT ON TABLE reviews TO authenticated;

DROP POLICY IF EXISTS "customers: insert review for completed orders" ON reviews;
CREATE POLICY "customers: insert review for completed orders"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.id::text = reviews.order_id::text
        AND o.customer_id::text = auth.uid()::text
        AND o.tailor_profile_id::text = reviews.tailor_profile_id::text
        AND (
          reviews.tailor_id IS NULL
          OR o.tailor_id IS NULL
          OR o.tailor_id::text = reviews.tailor_id::text
        )
        AND o.stage IN ('COMPLETE', 'DELIVERED', 'COLLECTED')
    )
  );

DROP POLICY IF EXISTS "customers: view own submitted reviews" ON reviews;
CREATE POLICY "customers: view own submitted reviews"
  ON reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.id::text = reviews.order_id::text
        AND o.customer_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "tailors: view own reviews" ON reviews;
CREATE POLICY "tailors: view own reviews"
  ON reviews FOR SELECT
  TO authenticated
  USING (
    reviews.tailor_id IS NOT NULL
    AND reviews.tailor_id::text = auth.uid()::text
  );
