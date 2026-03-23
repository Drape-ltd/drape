import { getServiceRoleKey, getSupabaseUrl } from './env.ts'

/**
 * Validates the caller's JWT from the Authorization header and returns
 * the authenticated user. Returns null if the token is absent or invalid.
 *
 * Makes a direct fetch to /auth/v1/user — bypasses supabase-js gotrue client
 * to avoid any ES256 JWT handling quirks in the bundled client version.
 */
export async function getAuthUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const supabaseUrl    = getSupabaseUrl()
  const serviceRoleKey = getServiceRoleKey()

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey':        serviceRoleKey,
    },
  })

  if (!res.ok) {
    console.error('[getAuthUser] auth API error:', res.status, await res.text())
    return null
  }

  const user = await res.json()
  if (!user?.id) return null
  return { id: user.id, email: user.email }
}
