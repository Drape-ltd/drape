-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Security Hardening (Round 3)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: Collection code brute-force protection
--
-- Track how many times the customer has submitted a wrong collection code.
-- The Edge Function rejects attempts after 5 failures until ops resets the order.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS collection_code_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.collection_code_attempts IS
  'Number of failed collection-code submissions. Locked at 5 — resets on success.';


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: push_tokens — RLS was never enabled
--
-- Without RLS any authenticated user can read or overwrite any push token.
-- Lock it so users can only manage their own row.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users: manage own push token" ON push_tokens;
CREATE POLICY "users: manage own push token"
  ON push_tokens FOR ALL
  TO authenticated
  USING  (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 3: Avatars bucket — file-extension enforcement in RLS
--
-- The bucket already has allowed_mime_types set to image/jpeg, image/png,
-- image/webp (set when the bucket was created). However the MIME type is
-- supplied by the client and could be spoofed. Adding a server-side
-- extension check in the RLS policy provides a defence-in-depth layer:
-- only .jpg / .jpeg / .png / .webp files are accepted regardless of
-- whatever MIME type the client claims.
-- ═══════════════════════════════════════════════════════════════════════════

-- Replace the simple owner-can-insert policy with one that also
-- validates the file extension via storage.extension(name).
DROP POLICY IF EXISTS "avatars: owner can insert" ON storage.objects;
CREATE POLICY "avatars: owner can insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp'])
  );

-- Tighten UPDATE to the same extension allowlist.
DROP POLICY IF EXISTS "avatars: owner can update" ON storage.objects;
CREATE POLICY "avatars: owner can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp'])
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 4: order-photos / message-media — same extension enforcement
--
-- Apply the same extension allowlist to user-uploaded content photos
-- to prevent disguised executable uploads.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "order-photos: parties can upload" ON storage.objects;
CREATE POLICY "order-photos: parties can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-photos'
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov'])
    AND (
      (
        split_part(name, '/', 1) = 'brief'
        AND split_part(name, '/', 2) = auth.uid()::text
      )
      OR
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

DROP POLICY IF EXISTS "message-media: parties can upload" ON storage.objects;
CREATE POLICY "message-media: parties can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-media'
    AND lower(storage.extension(name)) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'mp3', 'm4a', 'aac'])
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
-- INDEX: speed up collection code attempt look-ups
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS orders_collection_code_stage_idx
  ON orders (stage, collection_code)
  WHERE stage = 'READY_FOR_COLLECTION';
