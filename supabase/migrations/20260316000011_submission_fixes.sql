-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Submission Fixes
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: tailor_profiles UPDATE policy — case mismatch on id_verification_status
--
-- security_fixes.sql wrote the WITH CHECK using lowercase 'pending' and
-- 'not_submitted', but the app (and the DB check constraint on the column)
-- uses uppercase 'PENDING' / 'NOT_SUBMITTED'.  PostgreSQL string comparison
-- is case-sensitive so `'PENDING' IN ('pending', 'not_submitted')` = FALSE,
-- causing every upsert that includes id_verification_status to fail with
-- a policy violation (403) on the DO UPDATE SET path.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 0: tailor_profiles INSERT grant — was never explicitly granted
--
-- initial_schema.sql has no GRANT statements.  rls_hardening.sql adds
-- GRANT INSERT, UPDATE — but if that migration was skipped, authenticated
-- users have no INSERT permission and every new tailor profile upsert
-- returns 403 immediately, before RLS is even evaluated.
--
-- security_fixes.sql only touches UPDATE (revoke + re-grant column-level),
-- so INSERT is unaffected by it.  We re-assert it here idempotently.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT INSERT ON TABLE tailor_profiles TO authenticated;

-- Also re-assert the full column-level UPDATE grant so this migration is
-- self-contained even if security_fixes.sql hasn't been run yet.
REVOKE UPDATE ON TABLE tailor_profiles FROM authenticated;
GRANT UPDATE (
  display_name, business_name, bio, location, languages, specialty_tags,
  price_range_min, price_range_max, currency, availability, ships_internationally,
  portfolio_photo_urls, portfolio_video_urls,
  id_document_url, id_verification_status,
  is_live,
  stripe_account_id, paystack_account_id, avg_response_hours,
  updated_at
) ON TABLE tailor_profiles TO authenticated;


DROP POLICY IF EXISTS "tailors: update own profile" ON tailor_profiles;
CREATE POLICY "tailors: update own profile"
  ON tailor_profiles FOR UPDATE
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (
    user_id::text = auth.uid()::text
    AND (
      id_verification_status IS NULL
      OR id_verification_status IN ('PENDING', 'NOT_SUBMITTED')
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: message-media storage bucket — bucket was missing
--
-- security_hardening.sql created RLS policies for message-media uploads
-- but the bucket itself was never inserted into storage.buckets, causing
-- every bucket-existence check to return 400.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-media',
  'message-media',
  false,
  52428800, -- 50 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO NOTHING;
