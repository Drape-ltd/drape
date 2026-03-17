-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Audit Logs
-- Immutable server-side log of all security-significant events.
-- Written exclusively by Edge Functions via service role.
-- No authenticated-role SELECT or INSERT — service role only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now() NOT NULL,

  -- Who triggered the event (null = system / unauthenticated caller)
  actor_id    text,
  actor_role  text,       -- CUSTOMER | TAILOR | SYSTEM | OPS

  -- What happened
  event       text        NOT NULL,   -- e.g. 'order.stage_changed'
  severity    text        NOT NULL DEFAULT 'info', -- info | warn | error

  -- Optional context
  order_id    uuid,
  payload     jsonb       -- event-specific metadata (no PII)
);

-- No index needed on id (pk). Index on event + created_at for time-range queries.
CREATE INDEX IF NOT EXISTS audit_logs_event_created_at_idx
  ON audit_logs (event, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx
  ON audit_logs (actor_id)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_order_id_idx
  ON audit_logs (order_id)
  WHERE order_id IS NOT NULL;

-- RLS: enable with no policies = service role only. Clients cannot read or write.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Grant SELECT to authenticated so ops tooling can query via service role key.
-- No authenticated-role access — all writes from Edge Functions using service role.
GRANT SELECT ON TABLE audit_logs TO service_role;
