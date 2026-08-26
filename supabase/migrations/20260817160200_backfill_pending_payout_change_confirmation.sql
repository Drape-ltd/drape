-- Bring payout changes submitted immediately before the confirmation lifecycle
-- deployment into the same safe, user-visible state as new requests.
-- This does not approve, activate, or alter either payout destination.
update public.payout_change_requests
set
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'lifecycle_state', 'AWAITING_CONFIRMATION',
    'confirmation_status', 'PENDING',
    'confirmation_expires_at', to_char(
      (coalesce(submitted_at, updated_at, now()) + interval '48 hours') at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'lifecycle_backfilled_at', to_char(
      now() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ),
  updated_at = now()
where status = 'PENDING'
  and coalesce(metadata->>'lifecycle_state', '') = '';
