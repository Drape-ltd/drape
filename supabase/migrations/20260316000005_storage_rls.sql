-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Storage Bucket RLS Policies
-- Locks down the 4 Supabase Storage buckets used by the app.
-- Without these, any authenticated user can read or overwrite any file.
-- Safe to run multiple times (DROP POLICY IF EXISTS before each CREATE).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Buckets and their access rules:
--
--   order-photos      — brief reference photos + progress photos
--                       INSERT: order customer OR tailor on that order
--                       SELECT: order customer OR tailor on that order
--                       DELETE: tailor on that order (to remove their own uploads only)
--
--   message-media     — message photos + voice notes
--                       INSERT: party on the order the message belongs to
--                       SELECT: party on the order the message belongs to
--
--   portfolio-photos  — tailor portfolio images / videos + avatar
--                       INSERT/UPDATE/DELETE: the owning tailor only
--                       SELECT: public (portfolio is publicly visible)
--
--   id-documents      — tailor government ID verification photos
--                       INSERT: the tailor themselves (one-time upload flow)
--                       SELECT: NOBODY via client — service role only
--                       (the ops verification email function reads this via service role)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- Helper: extract the Supabase user_id segment from a storage object name.
-- Object paths follow the convention: <folder>/<user_id>/<filename>
-- e.g. "progress/abc-123/1234567890.jpg"  → "abc-123"
-- ═══════════════════════════════════════════════════════════════════════════

-- (No separate helper needed — we use split_part(name, '/', 2) inline.)


-- ═══════════════════════════════════════════════════════════════════════════
-- BUCKET: order-photos
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "order-photos: parties can upload" ON storage.objects;
CREATE POLICY "order-photos: parties can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-photos'
    AND (
      -- Customer uploading brief reference photos: path = brief/<user_id>/...
      (
        split_part(name, '/', 1) = 'brief'
        AND split_part(name, '/', 2) = auth.uid()::text
      )
      OR
      -- Tailor uploading progress photos: path = progress/<order_id>/...
      -- Verify caller is the tailor on that order
      (
        split_part(name, '/', 1) = 'progress'
        AND EXISTS (
          SELECT 1 FROM orders o
          JOIN tailor_profiles tp ON tp.id::text = o.tailor_profile_id::text
          WHERE o.id::text = split_part(name, '/', 2)
            AND tp.user_id::text = auth.uid()::text
        )
      )
    )
  );

DROP POLICY IF EXISTS "order-photos: parties can read" ON storage.objects;
CREATE POLICY "order-photos: parties can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-photos'
    AND (
      -- Customer reading their own brief uploads
      (
        split_part(name, '/', 1) = 'brief'
        AND split_part(name, '/', 2) = auth.uid()::text
      )
      OR
      -- Either party on a progress-photo order
      (
        split_part(name, '/', 1) = 'progress'
        AND EXISTS (
          SELECT 1 FROM orders o
          LEFT JOIN tailor_profiles tp ON tp.id::text = o.tailor_profile_id::text
          WHERE o.id::text = split_part(name, '/', 2)
            AND (
              o.customer_id::text = auth.uid()::text
              OR tp.user_id::text = auth.uid()::text
            )
        )
      )
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- BUCKET: message-media
-- Only parties (customer + tailor) on the order may upload or read.
-- Path convention: messages/<order_id>/<filename>
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "message-media: parties can upload" ON storage.objects;
CREATE POLICY "message-media: parties can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-media'
    AND EXISTS (
      SELECT 1 FROM orders o
      LEFT JOIN tailor_profiles tp ON tp.id::text = o.tailor_profile_id::text
      WHERE o.id::text = split_part(name, '/', 2)
        AND (
          o.customer_id::text = auth.uid()::text
          OR tp.user_id::text = auth.uid()::text
        )
    )
  );

DROP POLICY IF EXISTS "message-media: parties can read" ON storage.objects;
CREATE POLICY "message-media: parties can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'message-media'
    AND EXISTS (
      SELECT 1 FROM orders o
      LEFT JOIN tailor_profiles tp ON tp.id::text = o.tailor_profile_id::text
      WHERE o.id::text = split_part(name, '/', 2)
        AND (
          o.customer_id::text = auth.uid()::text
          OR tp.user_id::text = auth.uid()::text
        )
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- BUCKET: portfolio-photos
-- Public read (discovery). Only the owning tailor can write/delete.
-- Path convention: portfolio/<user_id>/... or avatar/<user_id>/...
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "portfolio-photos: public read" ON storage.objects;
CREATE POLICY "portfolio-photos: public read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'portfolio-photos');

DROP POLICY IF EXISTS "portfolio-photos: tailor can upload" ON storage.objects;
CREATE POLICY "portfolio-photos: tailor can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'portfolio-photos'
    AND split_part(name, '/', 2) = auth.uid()::text
  );

DROP POLICY IF EXISTS "portfolio-photos: tailor can delete own" ON storage.objects;
CREATE POLICY "portfolio-photos: tailor can delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'portfolio-photos'
    AND split_part(name, '/', 2) = auth.uid()::text
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- BUCKET: id-documents
-- Government ID photos — strictly private.
-- INSERT: tailor themselves (one upload, path = id-verification/<user_id>/...)
-- SELECT: NOBODY via client (service role reads via Edge Function only)
-- No DELETE — immutable once submitted; ops must remove via dashboard if needed
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "id-documents: tailor can upload own" ON storage.objects;
CREATE POLICY "id-documents: tailor can upload own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'id-documents'
    AND split_part(name, '/', 2) = auth.uid()::text
  );

-- Deliberately no SELECT policy for authenticated or anon roles.
-- The id-documents bucket must be configured as PRIVATE in the Supabase dashboard
-- so that public URLs are blocked and only service-role-signed URLs work.
-- The notify-ops-verification Edge Function accesses this via service role.

-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANT: set each bucket's public/private status in the Supabase dashboard:
--   order-photos      → public  (CDN URLs work for in-app display)
--   message-media     → public  (CDN URLs work for in-app display)
--   portfolio-photos  → public  (CDN URLs work for discovery)
--   id-documents      → PRIVATE (no public URLs — service role only)
-- RLS policies above control who can INSERT/DELETE regardless of public setting.
-- For SELECT on public buckets, RLS still fires — the policies above apply.
-- ─────────────────────────────────────────────────────────────────────────────
