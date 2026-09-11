import 'server-only'

import type { OpsRole } from './ops-console'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from './ops-edge-broker'
import { createServiceRoleClient } from './server-supabase'

type WorkforcePrincipalRow = {
  id: string
  email: string
  access_subject: string | null
  status: 'ACTIVE' | 'REVOKED'
  roles: string[] | null
  permitted_environments: string[] | null
  session_revoked_before: string | null
  access_review_due_at: string | null
}

const ROLE_PRIORITY: OpsRole[] = [
  'admin',
  'engineering',
  'finance',
  'trust',
  'customer_success',
  'ops',
]

function normalizeRoles(values: string[] | null): OpsRole[] {
  const roles = new Set((values ?? []).map((value) => value.trim().toLowerCase()))
  return ROLE_PRIORITY.filter((role) => roles.has(role))
}

function expectedEnvironment() {
  return process.env.NODE_ENV === 'production' || process.env.DRAPE_WEB_ENV === 'production'
    ? 'production'
    : 'development'
}

export async function getActiveOpsWorkforcePrincipal(input: {
  email: string
  subject: string
  tokenIssuedAt: number | null
}) {
  if (requiresOpsEdgeBroker()) {
    const principal = await invokeOpsReadBroker<{
      id: string
      email: string
      roles: string[]
      accessReviewDueAt: string | null
    }>('session')
    const roles = normalizeRoles(principal.roles)
    const role = roles[0] ?? null
    if (!role || principal.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) return null
    return {
      id: principal.id,
      email: principal.email,
      role,
      roles,
      accessReviewDueAt: principal.accessReviewDueAt,
    }
  }

  const client = createServiceRoleClient()
  if (!client) return null

  const { data, error } = await client
    .from('ops_workforce_principals')
    .select('id,email,access_subject,status,roles,permitted_environments,session_revoked_before,access_review_due_at')
    .eq('email', input.email)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('[ops-auth] Workforce principal lookup failed.', { code: error.code ?? 'unknown' })
    return null
  }

  const principal = data as WorkforcePrincipalRow
  if (principal.status !== 'ACTIVE') return null
  if (principal.access_subject && principal.access_subject !== input.subject) return null
  if (!(principal.permitted_environments ?? []).includes(expectedEnvironment())) return null
  if (!principal.access_review_due_at || Date.parse(principal.access_review_due_at) <= Date.now()) return null

  const revokedBefore = principal.session_revoked_before
    ? Math.floor(Date.parse(principal.session_revoked_before) / 1000)
    : null
  if (
    revokedBefore !== null &&
    Number.isFinite(revokedBefore) &&
    (input.tokenIssuedAt === null || input.tokenIssuedAt <= revokedBefore)
  ) {
    return null
  }

  const roles = normalizeRoles(principal.roles)
  const role = roles[0] ?? null
  if (!role) return null

  return {
    id: principal.id,
    email: principal.email,
    role,
    roles,
    accessReviewDueAt: principal.access_review_due_at,
  }
}
