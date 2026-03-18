-- ============================================================
-- Drape V1 — Storage bucket policies
-- Run AFTER creating the buckets in the Supabase dashboard:
--
--   Storage → New bucket (repeat for each):
--   1. portfolio-photos   public: true
--   2. order-photos       public: true
--   3. message-media      public: true
--   4. id-documents       public: false  ← private (ID verification)
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── portfolio-photos ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tailors: upload portfolio photos"     ON storage.objects;
DROP POLICY IF EXISTS "tailors: delete own portfolio photos" ON storage.objects;
DROP POLICY IF EXISTS "public: read portfolio photos"        ON storage.objects;

CREATE POLICY "tailors: upload portfolio photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'portfolio-photos'
    AND (storage.foldername(name))[1] = 'portfolio'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "tailors: delete own portfolio photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'portfolio-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "public: read portfolio photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'portfolio-photos');

-- ─── order-photos ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated: upload order photos" ON storage.objects;
DROP POLICY IF EXISTS "authenticated: read order photos"   ON storage.objects;

CREATE POLICY "authenticated: upload order photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'order-photos');

CREATE POLICY "authenticated: read order photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'order-photos');

-- ─── message-media ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated: upload message media" ON storage.objects;
DROP POLICY IF EXISTS "authenticated: read message media"   ON storage.objects;

CREATE POLICY "authenticated: upload message media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'message-media');

CREATE POLICY "authenticated: read message media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'message-media');

-- ─── id-documents (private) ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "tailors: upload own id document" ON storage.objects;

CREATE POLICY "tailors: upload own id document"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'id-documents'
    AND (storage.foldername(name))[1] = 'id-verification'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
