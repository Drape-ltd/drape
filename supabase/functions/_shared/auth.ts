import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceRoleKey, getSupabaseUrl } from './env.ts'

/**
 * Validates the caller's JWT from the Authorization header and returns
 * the authenticated user. Returns null if the token is absent or invalid.
 */
export async function getAuthUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return null

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user?.id) {
    console.error('[getAuthUser] auth API error:', error?.message ?? 'unknown')
    return null
  }

  return { id: data.user.id, email: data.user.email }
}
