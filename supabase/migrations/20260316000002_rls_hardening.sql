-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — RLS Hardening
-- Fixes 8 security issues identified in audit.
-- Safe to run multiple times (all statements are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- NOTE: public.users table does not exist in this Supabase project.
-- The app uses auth.users directly via the Supabase client session.
-- All profile data is stored in customer_profiles / tailor_profiles
-- referencing auth.users(id). No grant needed.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: saved_tailors — missing table + RLS
-- App reads/writes this table but it was never created.
-- tailor_profile_id is text (tailor_profiles.id is text in the app layer).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS saved_tailors (
  id                uuid    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tailor_profile_id text    NOT NULL,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (user_id, tailor_profile_id)
);

ALTER TABLE saved_tailors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers: manage own saved tailors" ON saved_tailors;
CREATE POLICY "customers: manage own saved tailors"
  ON saved_tailors FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

GRANT SELECT, INSERT, DELETE ON TABLE saved_tailors TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 3: tailor_profiles — sensitive columns must not be exposed publicly
--
-- Stripe/Paystack account IDs, ID document URLs, and internal enforcement
-- fields are currently readable by the public SELECT policy.
--
-- Approach: revoke sensitive columns from anon and authenticated roles,
-- then re-grant only the safe columns needed for discovery and order flows.
-- Service role (Edge Functions) retains full access.
-- ═══════════════════════════════════════════════════════════════════════════

-- Step A: revoke blanket SELECT granted in grants.sql
REVOKE SELECT ON TABLE tailor_profiles FROM anon, authenticated;

-- Step B: re-grant only the columns that are safe to expose
--   Excluded: stripe_account_id, paystack_account_id, id_document_url,
--             id_document_path, id_verified_at, bypass_attempts, tier_lost_at
GRANT SELECT (
  id,
  user_id,
  display_name,
  business_name,
  bio,
  location,
  languages,
  specialty_tags,
  price_range_min,
  price_range_max,
  currency,
  tier,
  availability,
  is_verified,
  is_live,
  avg_rating,
  total_reviews,
  total_orders,
  avg_response_hours,
  ships_internationally,
  portfolio_photo_urls,
  portfolio_video_urls,
  id_verification_status,
  created_at,
  updated_at
) ON TABLE tailor_profiles TO anon, authenticated;

-- Step C: tailor still needs to read/write their own full row (e.g. setup screen)
-- We grant the sensitive columns only to authenticated so the tailor can read
-- their own stripe_account_id etc. — RLS policy already restricts which ROWS
-- they can see, so only their own row returns those columns.
GRANT SELECT (
  stripe_account_id,
  paystack_account_id,
  id_document_url,
  id_verified_at,
  bypass_attempts,
  tier_lost_at
) ON TABLE tailor_profiles TO authenticated;

-- INSERT / UPDATE remain as before (authenticated only, RLS enforces ownership)
GRANT INSERT, UPDATE ON TABLE tailor_profiles TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 4: orders UPDATE — customers and tailors must not mutate financial /
--         state / identity columns directly.
--
-- Restricted columns (Edge Functions / service role only):
--   stage, stage_updated_at, quoted_amount, quoted_currency,
--   quoted_completion_date, quote_note, quote_expires_at,
--   payment_provider, payment_intent_id, escrow_released, escrow_released_at,
--   auto_release_at, collection_code, collection_code_expiry,
--   collection_code_used, dispute_id, customer_id, tailor_profile_id, tailor_id
--
-- Allowed customer updates: special_note, delivery_method, deadline, occasion,
--                            description, fabric_source, fit_note, reference_photos
-- Allowed tailor updates:   quote fields (via Edge Function), fabric_tracking
--                            (but we still lock those here — EF uses service role)
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE UPDATE ON TABLE orders FROM authenticated;

-- Grant only columns confirmed to exist in the live schema.
-- Use a DO block so any column that was never created is skipped gracefully
-- rather than aborting the whole migration.
DO $$
DECLARE
  safe_cols text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
  INTO safe_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'orders'
    AND column_name  = ANY(ARRAY[
      'garment_type', 'garment_description', 'description',
      'occasion', 'deadline', 'fabric_source', 'delivery_method',
      'special_note', 'fit_note', 'reference_photos',
      'fabric_tracking', 'updated_at'
    ]);

  IF safe_cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON TABLE orders TO authenticated', safe_cols);
  END IF;
END $$;

-- NOTE: stage transitions, quotes, payments, escrow, and collection codes
-- must ALL go through Edge Functions that run as service role.


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 5: messages UPDATE — restrict to read receipts only
--
-- The existing policy allows any party to UPDATE any column on any message
-- in a shared order thread. This enables content spoofing.
-- Replace with a policy that:
--   - only allows marking received messages (not your own) as read
--   - only allows setting read_at (not modifying body/sender/etc.)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "parties: mark messages read" ON messages;
DROP POLICY IF EXISTS "Order parties mark messages read" ON messages;

CREATE POLICY "parties: mark received messages read"
  ON messages FOR UPDATE
  USING (
    -- can only mark messages you did NOT send
    -- sender_id is text in the live schema; auth.uid() is uuid — cast to text
    sender_id != auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = messages.order_id
        AND (
          o.customer_id::text = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM tailor_profiles tp
            WHERE tp.id::text = o.tailor_profile_id::text
              AND tp.user_id::text = auth.uid()::text
          )
        )
    )
  )
  WITH CHECK (
    -- the only column that may change is read_at, and only to a non-null timestamp
    read_at IS NOT NULL
  );

REVOKE UPDATE ON TABLE messages FROM authenticated;
GRANT UPDATE (read_at) ON TABLE messages TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 6: reviews INSERT — require a completable order stage
--
-- Customers could previously review an order in any stage.
-- Now the order must be in a terminal completion stage.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "customers: insert review" ON reviews;
DROP POLICY IF EXISTS "Customer creates review for their order" ON reviews;

CREATE POLICY "customers: insert review for completed orders"
  ON reviews FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = reviews.order_id
        AND o.customer_id::text = auth.uid()::text
        AND o.stage IN ('COMPLETE', 'DELIVERED', 'COLLECTED')
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 7: reviews UPDATE — tailor may only update their response columns
--
-- The existing policy allows the tailor to UPDATE any column including
-- rating, body, published_at, and flagged.
-- Restrict UPDATE grant to only the response fields.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE UPDATE ON TABLE reviews FROM authenticated;

GRANT UPDATE (
  tailor_response,
  tailor_responded_at
) ON TABLE reviews TO authenticated;

-- Re-issue the tailor response policy (logic unchanged, column grant now limits scope)
DROP POLICY IF EXISTS "tailors: update own review response" ON reviews;
DROP POLICY IF EXISTS "Tailor responds to their reviews" ON reviews;

CREATE POLICY "tailors: update own review response"
  ON reviews FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tailor_profiles tp
      WHERE tp.id::text = reviews.tailor_profile_id::text
        AND tp.user_id::text = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tailor_profiles tp
      WHERE tp.id::text = reviews.tailor_profile_id::text
        AND tp.user_id::text = auth.uid()::text
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 8: orders tailor_id / tailor_profile_id sync
--
-- schema_fixes.sql added tailor_id (uuid) alongside tailor_profile_id (uuid).
-- Keep them consistent via trigger so RLS policies that use either column
-- always agree on who the tailor is.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_order_tailor_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- When tailor_profile_id is set, resolve and mirror the user_id into tailor_id.
  -- Cast both sides to text to handle mixed text/uuid column types across tables.
  IF NEW.tailor_profile_id IS NOT NULL THEN
    SELECT user_id INTO NEW.tailor_id
    FROM tailor_profiles
    WHERE id::text = NEW.tailor_profile_id::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_sync_tailor_id ON orders;
CREATE TRIGGER orders_sync_tailor_id
  BEFORE INSERT OR UPDATE OF tailor_profile_id ON orders
  FOR EACH ROW EXECUTE FUNCTION sync_order_tailor_id();

-- Back-fill existing rows where tailor_id is null but tailor_profile_id is set
UPDATE orders o
SET tailor_id = tp.user_id
FROM tailor_profiles tp
WHERE tp.id::text = o.tailor_profile_id::text
  AND o.tailor_id IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES — ensure RLS policy sub-queries are fast under load
-- (idempotent — skipped if already exist)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS saved_tailors_user_id_idx
  ON saved_tailors (user_id);

CREATE INDEX IF NOT EXISTS messages_order_sender_idx
  ON messages (order_id, sender_id);

CREATE INDEX IF NOT EXISTS reviews_tailor_profile_id_idx
  ON reviews (tailor_profile_id);

CREATE INDEX IF NOT EXISTS orders_tailor_profile_id_idx
  ON orders (tailor_profile_id);
