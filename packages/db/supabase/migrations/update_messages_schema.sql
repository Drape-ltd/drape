-- ============================================================
-- Drape V1 — Update messages table to match MessageThread component
-- Run in Supabase SQL Editor.
-- ============================================================

-- Rename content → body
ALTER TABLE messages RENAME COLUMN content TO body;

-- Drop old media_url (replaced by photo_url / voice_url)
ALTER TABLE messages DROP COLUMN IF EXISTS media_url;
ALTER TABLE messages DROP COLUMN IF EXISTS duration;
ALTER TABLE messages DROP COLUMN IF EXISTS blocked;

-- Add sender metadata columns
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_role TEXT NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '';

-- Add split media columns
ALTER TABLE messages ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_url TEXT;

-- Enable realtime for messages (required for INSERT events in MessageThread)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
