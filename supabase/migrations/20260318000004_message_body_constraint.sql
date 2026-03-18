-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Add body length constraint to messages table
--
-- Problem: The messages.body column had no length cap, allowing unbounded
-- payloads to be stored, wasting storage and potentially enabling abuse.
--
-- Fix: Add a CHECK constraint capping body at 5000 characters.
-- VOICE and PHOTO messages have null body — the constraint allows NULL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages
  ADD CONSTRAINT chk_message_body_length
  CHECK (body IS NULL OR length(body) <= 5000);
