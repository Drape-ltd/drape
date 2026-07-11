-- Make message-media bucket private so direct URLs no longer bypass RLS.
-- Existing stored values in messages.photo_url are migrated from full public URLs
-- to storage paths so the app can generate signed URLs at read time.

UPDATE storage.buckets
SET public = false
WHERE id = 'message-media';

-- Migrate any existing full public URLs to storage paths.
-- Format was: https://<project>.supabase.co/storage/v1/object/public/message-media/<path>
-- We extract the path after "message-media/" and store just that.
UPDATE messages
SET photo_url = regexp_replace(
  photo_url,
  '^https?://[^/]+/storage/v1/object/public/message-media/',
  ''
)
WHERE photo_url LIKE '%/storage/v1/object/public/message-media/%';

UPDATE messages
SET voice_url = regexp_replace(
  voice_url,
  '^https?://[^/]+/storage/v1/object/public/message-media/',
  ''
)
WHERE voice_url LIKE '%/storage/v1/object/public/message-media/%';
