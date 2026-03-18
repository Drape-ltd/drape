import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Validates the caller's JWT from the Authorization header and returns
 * the authenticated user. Returns null if the token is absent or invalid.
 *
 * Uses the Supabase anon key so the JWT is validated server-side against
 * the project's JWT secret — not just decoded locally.
 */
export async function getAuthUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return null
  return { id: user.id, email: user.email }
}
