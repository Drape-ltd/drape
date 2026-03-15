-- ============================================================
-- Drape V1 — Database Webhooks for push notifications
-- Run in the Supabase SQL Editor AFTER deploying the
-- push-notify Edge Function.
--
-- Replace <PROJECT_REF> with your Supabase project ref
-- (found in Settings → General).
-- ============================================================

-- Enable the pg_net extension (needed for HTTP calls from SQL)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── New order → notify tailor ───────────────────────────────────────────────
SELECT supabase_functions.http_request(
  'https://<PROJECT_REF>.supabase.co/functions/v1/push-notify',
  'POST', '{"Content-Type":"application/json"}', '{}', '1000'
);

-- Supabase Dashboard approach (recommended — no SQL needed):
-- Go to Database → Webhooks → Create a new hook:
--
--   Hook 1: new-order-notify
--     Table:  orders
--     Events: INSERT
--     URL:    https://<PROJECT_REF>.supabase.co/functions/v1/push-notify
--     Method: POST
--     Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
--
--   Hook 2: order-stage-notify
--     Table:  orders
--     Events: UPDATE
--     URL:    https://<PROJECT_REF>.supabase.co/functions/v1/push-notify
--     Method: POST
--     Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
--
--   Hook 3: message-notify
--     Table:  messages
--     Events: INSERT
--     URL:    https://<PROJECT_REF>.supabase.co/functions/v1/push-notify
--     Method: POST
--     Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
