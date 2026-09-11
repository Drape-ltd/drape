import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OpsSession } from '../../web/lib/ops-auth'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

type LocalPrincipal = {
  id: string
  email: string
  roles: string[]
  status: string
  permitted_environments: string[]
  access_review_due_at: string | null
}

/**
 * Resolve the named database principal behind the development-only local
 * workforce session. Cloudflare subject binding is intentionally absent here
 * because this mode cannot exist in a production Node environment. Role,
 * environment, active status, and access-review expiry still fail closed.
 */
export async function resolveLocalWorkforcePrincipal(session: OpsSession): Promise<{
  client: SupabaseClient
  principal: LocalPrincipal
} | null> {
  if (process.env.NODE_ENV === 'production' || session.mode !== 'local-workforce' || !session.email) return null
  const client = createServiceRoleClient()
  if (!client) return null
  const result = await client
    .from('ops_workforce_principals')
    .select('id,email,roles,status,permitted_environments,access_review_due_at')
    .eq('email', session.email)
    .maybeSingle()
  if (result.error || !result.data) return null
  const principal = result.data as LocalPrincipal
  if (
    principal.status !== 'ACTIVE'
    || principal.email.trim().toLowerCase() !== session.email.trim().toLowerCase()
    || !principal.roles.includes(session.role)
    || !principal.permitted_environments.includes('development')
    || !principal.access_review_due_at
    || Date.parse(principal.access_review_due_at) <= Date.now()
  ) return null
  return { client, principal }
}
