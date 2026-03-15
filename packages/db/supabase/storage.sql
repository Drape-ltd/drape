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
-- Then run this SQL to lock down who can upload/delete.
-- ============================================================

-- ─── portfolio-photos ─────────────────────────────────────────────────────────
-- Tailors upload to their own folder: portfolio/{user_id}/*
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
-- Customers upload briefs: briefs/{user_id}/*
-- Tailors upload progress: progress/{order_id}/*
CREATE POLICY "authenticated: upload order photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'order-photos');

CREATE POLICY "authenticated: read order photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'order-photos');

-- ─── message-media ────────────────────────────────────────────────────────────
CREATE POLICY "authenticated: upload message media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'message-media');

CREATE POLICY "authenticated: read message media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'message-media');

-- ─── id-documents (private) ───────────────────────────────────────────────────
-- Only the tailor who owns the document can upload. No reads for authenticated.
-- Service role (Drape admin) accesses this via the Supabase dashboard.
CREATE POLICY "tailors: upload own id document"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'id-documents'
    AND (storage.foldername(name))[1] = 'id-verification'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
