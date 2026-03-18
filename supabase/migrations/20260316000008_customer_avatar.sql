-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Customer avatar support
-- Adds avatar_url to customer_profiles and creates the avatars storage bucket.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Column on customer_profiles
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. avatars storage bucket (public — URLs are safe to display in-app)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,  -- 5 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS: authenticated user may only write under their own user_id folder
--    Path convention: <user_id>/<filename>  (no subfolder, keeps it simple)

DROP POLICY IF EXISTS "avatars: owner can insert" ON storage.objects;
CREATE POLICY "avatars: owner can insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars: owner can update" ON storage.objects;
CREATE POLICY "avatars: owner can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars: owner can delete" ON storage.objects;
CREATE POLICY "avatars: owner can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- 4. Public read — anyone can view an avatar URL (needed for tab bar + tailor view)
DROP POLICY IF EXISTS "avatars: public read" ON storage.objects;
CREATE POLICY "avatars: public read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');
