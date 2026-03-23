-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Security Fixes (Post-Audit Round 2)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: messages INSERT — validate sender_role matches caller's actual
--        position on the order.
--
-- The existing policy only checks sender_id = auth.uid() and order membership.
-- A customer could claim sender_role = 'TAILOR' to impersonate a tailor
-- in the thread.  This WITH CHECK addition ties role to the order's actual
-- customer_id / tailor_id columns.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "parties: send messages on own orders" ON messages;
CREATE POLICY "parties: send messages on own orders"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    -- sender_id must be the calling user
    auth.uid()::text = sender_id::text
    -- caller must be a party on this order
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = messages.order_id
        AND (o.customer_id::text = auth.uid()::text OR o.tailor_id::text = auth.uid()::text)
    )
    -- sender_role must match which side of the order the caller actually is
    AND (
      (sender_role = 'CUSTOMER' AND EXISTS (
        SELECT 1 FROM orders o WHERE o.id = messages.order_id AND o.customer_id::text = auth.uid()::text
      ))
      OR
      (sender_role = 'TAILOR' AND EXISTS (
        SELECT 1 FROM orders o WHERE o.id = messages.order_id AND o.tailor_id::text = auth.uid()::text
      ))
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: tailor_profiles UPDATE — restrict which columns authenticated
--        users can update.
--
-- A tailor must not be able to set tier, avg_rating, total_reviews,
-- total_orders, is_verified, id_verification_status, or id_document_url
-- directly.  These are set by DB triggers, Edge Functions, and ops only.
-- ═══════════════════════════════════════════════════════════════════════════

-- Revoke blanket UPDATE; re-grant only safe editable columns.
REVOKE UPDATE ON TABLE tailor_profiles FROM authenticated;

GRANT UPDATE (
  display_name,
  business_name,
  bio,
  location,
  languages,
  specialty_tags,
  price_range_min,
  price_range_max,
  currency,
  availability,
  ships_internationally,
  portfolio_photo_urls,
  portfolio_video_urls,
  id_document_url,        -- tailor can re-submit their own ID document
  id_verification_status, -- only safe value they should ever write is 'PENDING'
                          -- (RLS policy below prevents them writing VERIFIED/REJECTED)
  stripe_account_id,
  paystack_account_id,
  avg_response_hours,
  updated_at
) ON TABLE tailor_profiles TO authenticated;

-- Prevent client from writing dangerous id_verification_status values.
-- The only transition allowed from the client is → PENDING (submitting ID).
-- VERIFIED and REJECTED are set exclusively by handle-verification-decision.
DROP POLICY IF EXISTS "tailors: update own profile" ON tailor_profiles;
CREATE POLICY "tailors: update own profile"
  ON tailor_profiles FOR UPDATE
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (
    user_id::text = auth.uid()::text
    -- client may only set id_verification_status to PENDING or NOT_SUBMITTED
    AND (
      id_verification_status IS NULL
      OR id_verification_status IN ('PENDING', 'NOT_SUBMITTED')
    )
  );
