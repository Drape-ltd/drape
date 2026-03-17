-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Rate Limiting
-- Postgres-backed fixed-window counter used by Edge Functions (service role).
-- No grants to anon/authenticated — only service role (Edge Functions) may call.
-- Safe to run multiple times (all statements are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- Table: one row per (key, window_start) bucket
-- key format: "<function-name>:<user-uuid>"
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Index to speed up the periodic purge of expired windows
CREATE INDEX IF NOT EXISTS rate_limit_counters_window_idx
  ON rate_limit_counters (window_start);

-- No grants to anon / authenticated.
-- Service role (Edge Functions) already has full access.


-- ───────────────────────────────────────────────────────────────────────────
-- Function: check_rate_limit
--
-- Atomically increments the counter for (key, current_window) and returns
-- true if the count is within p_max_requests, false if over limit.
--
-- Window is aligned to multiples of p_window_seconds from the Unix epoch
-- (e.g. 3600s = aligned hourly windows).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key            text,
  p_window_seconds int,
  p_max_requests   int
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_window timestamptz;
  v_count  int;
BEGIN
  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO rate_limit_counters (key, window_start, count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE
    SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;

  -- Probabilistic cleanup: ~1% of calls delete rows older than 24 hours.
  -- No external scheduler needed — old windows are cleared automatically over time.
  IF random() < 0.01 THEN
    DELETE FROM rate_limit_counters
    WHERE window_start < now() - interval '24 hours';
  END IF;

  RETURN v_count <= p_max_requests;
END;
$$;


