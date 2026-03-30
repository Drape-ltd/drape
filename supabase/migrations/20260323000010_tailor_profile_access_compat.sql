-- Drape V1 — tailor profile access compatibility for older dev projects
-- Makes the app-readable tailor profile columns and own-row policies explicit.

-- Ensure authenticated users can read the columns the mobile app uses on their own row.
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
  availability,
  is_live,
  is_verified,
  avg_rating,
  total_reviews,
  total_orders,
  avg_response_hours,
  ships_internationally,
  portfolio_photo_urls,
  portfolio_video_urls,
  id_document_url,
  id_verification_status,
  avatar_url,
  profile_completed,
  ranking_score,
  created_at,
  updated_at
) ON TABLE tailor_profiles TO authenticated;

-- Reassert authenticated INSERT/UPDATE in case older dev DBs missed earlier grants.
GRANT INSERT ON TABLE tailor_profiles TO authenticated;
GRANT UPDATE (
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
  availability,
  ships_internationally,
  portfolio_photo_urls,
  portfolio_video_urls,
  id_document_url,
  id_verification_status,
  avatar_url,
  stripe_account_id,
  paystack_account_id,
  avg_response_hours,
  updated_at
) ON TABLE tailor_profiles TO authenticated;

-- Use auth.uid directly so this does not depend on legacy helper functions existing.
DROP POLICY IF EXISTS "tailor_profiles: own row select" ON tailor_profiles;
CREATE POLICY "tailor_profiles: own row select"
  ON tailor_profiles
  FOR SELECT
  TO authenticated
  USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "tailor_profiles: own row insert" ON tailor_profiles;
CREATE POLICY "tailor_profiles: own row insert"
  ON tailor_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "tailor_profiles: own row update" ON tailor_profiles;
CREATE POLICY "tailor_profiles: own row update"
  ON tailor_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (
    user_id::text = auth.uid()::text
    AND (
      id_verification_status IS NULL
      OR id_verification_status IN ('PENDING', 'NOT_SUBMITTED')
    )
  );

-- Recreate storage upload rules with the exact path conventions used by the app.
DROP POLICY IF EXISTS "portfolio-photos: tailor can upload" ON storage.objects;
CREATE POLICY "portfolio-photos: tailor can upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'portfolio-photos'
    AND split_part(name, '/', 1) = 'portfolio'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'])
  );

DROP POLICY IF EXISTS "portfolio-photos: tailor can delete own" ON storage.objects;
CREATE POLICY "portfolio-photos: tailor can delete own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'portfolio-photos'
    AND split_part(name, '/', 1) = 'portfolio'
    AND split_part(name, '/', 2) = auth.uid()::text
  );

DROP POLICY IF EXISTS "id-documents: tailor can upload own" ON storage.objects;
CREATE POLICY "id-documents: tailor can upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'id-documents'
    AND split_part(name, '/', 1) = 'id-verification'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp', 'pdf'])
  );
