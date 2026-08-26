-- Supabase installs pgcrypto in the protected extensions schema. Keep the
-- security-definer lookup deterministic while making digest() available.

alter function public.create_commercial_pricing_reservation(
  text, uuid, text, uuid, text, currency, integer, integer, integer, integer,
  integer, text, text, boolean, jsonb, uuid, timestamptz
) set search_path = public, extensions;

alter function public.post_commercial_ledger_transaction(
  text, text, text, text, uuid, text, integer, uuid, text, jsonb, jsonb, uuid,
  uuid, text, currency, integer, currency, integer, numeric, integer
) set search_path = public, extensions;
