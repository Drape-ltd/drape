-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Portfolio items for tailor profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio_items (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tailor_profile_id uuid NOT NULL REFERENCES tailor_profiles(id) ON DELETE CASCADE,
  image_url         text NOT NULL,
  title             text NOT NULL,
  description       text,
  category          text,   -- WEDDING | CASUAL | ASOEBI | FORMAL | OTHER
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portfolio_items
  DROP CONSTRAINT IF EXISTS portfolio_category_check;

ALTER TABLE portfolio_items
  ADD CONSTRAINT portfolio_category_check
    CHECK (category IS NULL OR category IN ('WEDDING', 'CASUAL', 'ASOEBI', 'FORMAL', 'OTHER'));

CREATE INDEX IF NOT EXISTS portfolio_items_tailor_profile_id_idx ON portfolio_items (tailor_profile_id);

ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;

-- Tailor manages their own portfolio
DROP POLICY IF EXISTS "tailor: own portfolio" ON portfolio_items;
CREATE POLICY "tailor: own portfolio"
  ON portfolio_items FOR ALL
  TO authenticated
  USING (tailor_profile_id IN (SELECT id FROM tailor_profiles WHERE user_id = auth.uid()))
  WITH CHECK (tailor_profile_id IN (SELECT id FROM tailor_profiles WHERE user_id = auth.uid()));

-- Public can view portfolio of live tailors
DROP POLICY IF EXISTS "public: view live portfolio" ON portfolio_items;
CREATE POLICY "public: view live portfolio"
  ON portfolio_items FOR SELECT
  TO anon, authenticated
  USING (tailor_profile_id IN (SELECT id FROM tailor_profiles WHERE is_live = true));

GRANT SELECT ON TABLE portfolio_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE portfolio_items TO authenticated;
