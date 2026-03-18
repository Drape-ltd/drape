import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Checks and atomically increments a rate limit counter in Postgres.
 *
 * Returns true  → request is within the limit, proceed.
 * Returns false → limit exceeded, return 429.
 *
 * Fails open (returns true) on database errors to avoid blocking
 * legitimate traffic during transient infra issues.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  windowSeconds: number,
  maxRequests: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  })
  if (error) {
    console.error(`[rateLimit] DB error for key "${key}":`, error.message)
    return true // fail open
  }
  return data === true
}
