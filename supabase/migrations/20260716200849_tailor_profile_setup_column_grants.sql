-- Drape V1 — explicit column grants for tailor setup fields added after
-- the original column-level tailor_profiles grants. PostgREST rejects the
-- entire SELECT when any requested column lacks a grant.

-- Public/customer-safe order-state flags. These appear in discovery, item cards,
-- and tailor setup reads.
grant select (
  accepts_custom_orders_now,
  shop_paused
) on table public.tailor_profiles to anon, authenticated;

grant update (
  accepts_custom_orders_now,
  shop_paused
) on table public.tailor_profiles to authenticated;

-- Tailor setup/private account status fields. These are consumed by the owner
-- setup screens and web account dashboard under the existing authenticated RLS
-- policies. Keep them away from anon; service role keeps full access.
grant select (
  id_selfie_document_url,
  id_verification_method,
  id_verification_handoff_id,
  id_verification_submitted_at,
  id_verification_rejection_reason,
  id_verification_rejected_at,
  id_verification_metadata
) on table public.tailor_profiles to authenticated;
