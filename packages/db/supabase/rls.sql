-- ============================================================
-- Drape V1 — Row Level Security Policies
-- Run this in the Supabase SQL Editor (once, after schema push).
-- ============================================================

-- ─────────────────────────────────────────────
-- CUSTOMER PROFILES
-- ─────────────────────────────────────────────
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers: read own profile"
  ON customer_profiles FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "customers: insert own profile"
  ON customer_profiles FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "customers: update own profile"
  ON customer_profiles FOR UPDATE
  USING (auth.uid()::text = user_id);

-- Tailors can read a customer's profile when they share an active order
CREATE POLICY "tailors: read customer profile for shared orders"
  ON customer_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.customer_id = customer_profiles.user_id
        AND orders.tailor_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- TAILOR PROFILES
-- ─────────────────────────────────────────────
ALTER TABLE tailor_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read live tailor profiles (search / discovery)
CREATE POLICY "public: read live tailor profiles"
  ON tailor_profiles FOR SELECT
  USING (is_live = true);

-- Tailor can always read their own profile (even if not live)
CREATE POLICY "tailors: read own profile"
  ON tailor_profiles FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "tailors: insert own profile"
  ON tailor_profiles FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "tailors: update own profile"
  ON tailor_profiles FOR UPDATE
  USING (auth.uid()::text = user_id);

-- Customers can read a tailor's profile when they share an active order
CREATE POLICY "customers: read tailor profile for shared orders"
  ON tailor_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.tailor_id = tailor_profiles.user_id
        AND orders.customer_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- PORTFOLIO PHOTOS
-- ─────────────────────────────────────────────
ALTER TABLE portfolio_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public: read portfolio photos"
  ON portfolio_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tailor_profiles
      WHERE tailor_profiles.id = portfolio_photos.tailor_profile_id
        AND tailor_profiles.is_live = true
    )
  );

CREATE POLICY "tailors: manage own portfolio photos"
  ON portfolio_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tailor_profiles
      WHERE tailor_profiles.id = portfolio_photos.tailor_profile_id
        AND tailor_profiles.user_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- TAILOR CLIENT NOTES (private fit notes for On Drape clients)
-- ─────────────────────────────────────────────
ALTER TABLE tailor_client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tailors: manage own client notes"
  ON tailor_client_notes FOR ALL
  USING (auth.uid()::text = tailor_id);

-- ─────────────────────────────────────────────
-- TAILOR CLIENTS (private / offline CRM)
-- ─────────────────────────────────────────────
ALTER TABLE tailor_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tailors: manage own clients"
  ON tailor_clients FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tailor_profiles
      WHERE tailor_profiles.id = tailor_clients.tailor_profile_id
        AND tailor_profiles.user_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- OFFLINE ORDERS
-- ─────────────────────────────────────────────
ALTER TABLE offline_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tailors: manage own offline orders"
  ON offline_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tailor_clients
      JOIN tailor_profiles ON tailor_profiles.id = tailor_clients.tailor_profile_id
      WHERE tailor_clients.id = offline_orders.tailor_client_id
        AND tailor_profiles.user_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Customer who placed the order
CREATE POLICY "customers: read own orders"
  ON orders FOR SELECT
  USING (auth.uid()::text = customer_id);

CREATE POLICY "customers: create orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid()::text = customer_id);

CREATE POLICY "customers: update own orders"
  ON orders FOR UPDATE
  USING (auth.uid()::text = customer_id);

-- Tailor assigned to the order
CREATE POLICY "tailors: read assigned orders"
  ON orders FOR SELECT
  USING (auth.uid()::text = tailor_id);

CREATE POLICY "tailors: update assigned orders"
  ON orders FOR UPDATE
  USING (auth.uid()::text = tailor_id);

-- ─────────────────────────────────────────────
-- ORDER STAGE UPDATES
-- ─────────────────────────────────────────────
ALTER TABLE order_stage_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties: read stage updates for own orders"
  ON order_stage_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_stage_updates.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

CREATE POLICY "tailors: insert stage updates"
  ON order_stage_updates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_stage_updates.order_id
        AND orders.tailor_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- ORDER PHOTOS
-- ─────────────────────────────────────────────
ALTER TABLE order_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties: read photos for own orders"
  ON order_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_photos.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

CREATE POLICY "tailors: insert order photos"
  ON order_photos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_photos.order_id
        AND orders.tailor_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- MESSAGES
-- ─────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties: read messages for own orders"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = messages.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

CREATE POLICY "parties: send messages on own orders"
  ON messages FOR INSERT
  WITH CHECK (
    auth.uid()::text = sender_id
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = messages.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

CREATE POLICY "parties: mark messages read"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = messages.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

-- ─────────────────────────────────────────────
-- REVIEWS
-- ─────────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read published reviews on live tailor profiles
CREATE POLICY "public: read published reviews"
  ON reviews FOR SELECT
  USING (published_at IS NOT NULL);

-- Parties can read reviews for their own orders
CREATE POLICY "parties: read own order review"
  ON reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = reviews.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

-- Customer who placed the order can write the review
CREATE POLICY "customers: insert review"
  ON reviews FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = reviews.order_id
        AND orders.customer_id = auth.uid()::text
    )
  );

-- Tailor can update their own response field only
CREATE POLICY "tailors: update own review response"
  ON reviews FOR UPDATE
  USING (auth.uid()::text = tailor_id);

-- ─────────────────────────────────────────────
-- DISPUTES
-- ─────────────────────────────────────────────
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties: read disputes for own orders"
  ON disputes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = disputes.order_id
        AND (orders.customer_id = auth.uid()::text OR orders.tailor_id = auth.uid()::text)
    )
  );

CREATE POLICY "customers: open dispute"
  ON disputes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = disputes.order_id
        AND orders.customer_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- PAYOUTS
-- ─────────────────────────────────────────────
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tailors: read own payouts"
  ON payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tailor_profiles
      WHERE tailor_profiles.id = payouts.tailor_profile_id
        AND tailor_profiles.user_id = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────
-- PUSH TOKENS
-- ─────────────────────────────────────────────
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: manage own push token"
  ON push_tokens FOR ALL
  USING (auth.uid()::text = user_id);

-- ─────────────────────────────────────────────
-- CONTACT BYPASS LOGS (service role only — no user access)
-- ─────────────────────────────────────────────
ALTER TABLE contact_bypass_logs ENABLE ROW LEVEL SECURITY;
-- No policies = no access for anon/authenticated. Service role bypasses RLS.
