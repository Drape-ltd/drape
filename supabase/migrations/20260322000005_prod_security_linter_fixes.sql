-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Production security linter fixes
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: Tables with RLS enabled but no policies
--
-- These tables are intentionally service-role-only. Adding explicit policies
-- makes that intent visible to the linter and keeps access locked to backend
-- code paths only.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "service_role_only_audit_logs" ON audit_logs;
CREATE POLICY "service_role_only_audit_logs"
  ON audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only_contact_bypass_logs" ON contact_bypass_logs;
CREATE POLICY "service_role_only_contact_bypass_logs"
  ON contact_bypass_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only_rate_limit_counters" ON rate_limit_counters;
CREATE POLICY "service_role_only_rate_limit_counters"
  ON rate_limit_counters
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only_waitlist_signups" ON waitlist_signups;
CREATE POLICY "service_role_only_waitlist_signups"
  ON waitlist_signups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only_tailor_applications" ON tailor_applications;
CREATE POLICY "service_role_only_tailor_applications"
  ON tailor_applications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: Pin search_path on SECURITY DEFINER / trigger / helper functions
--
-- This removes the mutable-search_path warning and prevents object-name
-- resolution from being influenced by a caller-controlled search_path.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.auth_uid()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.auth_uid() SET search_path = public, auth, pg_temp';
  END IF;

  IF to_regprocedure('public.handle_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.handle_new_user() SET search_path = public, auth, pg_temp';
  END IF;

  IF to_regprocedure('public.check_rate_limit(text, integer, integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.check_rate_limit(text, integer, integer) SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.sync_order_tailor_id()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.sync_order_tailor_id() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.update_tailor_rating_stats()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.update_tailor_rating_stats() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.increment_tailor_total_orders()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_tailor_total_orders() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.compute_tailor_profile_completed()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.compute_tailor_profile_completed() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.compute_tailor_ranking_score()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.compute_tailor_ranking_score() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.set_review_published_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.set_review_published_at() SET search_path = public, pg_temp';
  END IF;
END
$$;
