export type OpsReadAction =
  | 'session'
  | 'canonical-cases'
  | 'trust-case'
  | 'support-case'
  | 'money'
  | 'money-grant'
  | 'orders'
  | 'order-detail'
  | 'reliability'
  | 'customers'
  | 'customer-detail'
  | 'tailors'
  | 'tailor-detail'
  | 'vision'
  | 'delivery'
  | 'communications'
  | 'access-governance'
  | 'audit-report'

const ALL_ROLES = ['admin', 'engineering', 'finance', 'trust', 'customer_success', 'ops'] as const

// Includes the workforce-principal lookup performed by the Edge gateway.
// Budgets count outbound PostgREST/RPC operations, not rows returned.
export const OPS_READ_QUERY_BUDGETS: Readonly<Record<OpsReadAction, number>> = Object.freeze({
  session: 1,
  'canonical-cases': 9,
  'trust-case': 4,
  'support-case': 3,
  money: 7,
  'money-grant': 2,
  orders: 7,
  'order-detail': 11,
  reliability: 5,
  customers: 4,
  'customer-detail': 6,
  tailors: 4,
  'tailor-detail': 6,
  vision: 4,
  delivery: 4,
  communications: 5,
  'access-governance': 2,
  'audit-report': 5,
})

const READ_ROLES: Record<OpsReadAction, readonly string[]> = {
  session: ALL_ROLES,
  'canonical-cases': ALL_ROLES,
  'trust-case': ['admin', 'trust'],
  'support-case': ['admin', 'customer_success', 'ops'],
  money: ['admin', 'finance'],
  'money-grant': ['admin', 'finance'],
  orders: ['admin', 'finance', 'customer_success', 'ops'],
  'order-detail': ['admin', 'finance', 'customer_success', 'ops'],
  reliability: ['admin', 'engineering', 'ops'],
  customers: ['admin', 'customer_success', 'ops'],
  'customer-detail': ['admin', 'customer_success', 'ops'],
  tailors: ['admin', 'trust', 'customer_success', 'ops'],
  'tailor-detail': ['admin', 'trust', 'customer_success', 'ops'],
  vision: ['admin', 'trust', 'engineering', 'ops'],
  delivery: ['admin', 'customer_success', 'ops'],
  communications: ['admin', 'engineering', 'customer_success', 'ops'],
  'access-governance': ['admin'],
  'audit-report': ['admin', 'engineering'],
}

export function isOpsReadAction(value: unknown): value is OpsReadAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(READ_ROLES, value)
}

export function canReadOpsAction(roles: string[], action: OpsReadAction) {
  const normalized = new Set(roles.map((role) => role.trim().toLowerCase()))
  return READ_ROLES[action].some((role) => normalized.has(role))
}

export function rolesForOpsReadAction(action: OpsReadAction) {
  return [...READ_ROLES[action]]
}

export function queryBudgetForOpsReadAction(action: OpsReadAction) {
  return OPS_READ_QUERY_BUDGETS[action]
}

export function isActiveOpsReadPrincipal(input: {
  status: string
  accessSubject: string | null
  permittedEnvironments: string[]
  sessionRevokedBefore: string | null
  accessReviewDueAt: string | null
  assertedSubject: string
  assertionIssuedAt: number | null
  environment: 'DEVELOPMENT' | 'PRODUCTION'
  nowMs?: number
}) {
  if (input.status !== 'ACTIVE') return false
  if (input.accessSubject && input.accessSubject !== input.assertedSubject) return false
  if (!input.permittedEnvironments.map((value) => value.toLowerCase()).includes(input.environment.toLowerCase())) return false
  if (!input.accessReviewDueAt) return false
  const nowMs = input.nowMs ?? Date.now()
  const reviewDueAt = Date.parse(input.accessReviewDueAt)
  if (!Number.isFinite(reviewDueAt) || reviewDueAt <= nowMs) return false
  const revokedBefore = input.sessionRevokedBefore ? Math.floor(Date.parse(input.sessionRevokedBefore) / 1000) : null
  if (revokedBefore !== null && (!Number.isFinite(revokedBefore) || input.assertionIssuedAt === null || input.assertionIssuedAt <= revokedBefore)) return false
  return true
}
