import { assertEquals } from 'jsr:@std/assert@1'
import { canReadOpsAction, isActiveOpsReadPrincipal, isOpsReadAction, OPS_READ_QUERY_BUDGETS, queryBudgetForOpsReadAction, rolesForOpsReadAction } from './ops-read-policy.ts'

Deno.test('Ops read actions reject unknown operations', () => {
  assertEquals(isOpsReadAction('arbitrary-table-read'), false)
  assertEquals(isOpsReadAction('money'), true)
})

Deno.test('broad case visibility does not grant sensitive domain reads', () => {
  assertEquals(canReadOpsAction(['ops'], 'canonical-cases'), true)
  assertEquals(canReadOpsAction(['ops'], 'money'), false)
  assertEquals(canReadOpsAction(['ops'], 'access-governance'), false)
  assertEquals(canReadOpsAction(['finance'], 'money'), true)
  assertEquals(canReadOpsAction(['trust'], 'trust-case'), true)
  assertEquals(canReadOpsAction(['trust'], 'support-case'), false)
})

Deno.test('access governance remains admin only', () => {
  assertEquals(rolesForOpsReadAction('access-governance'), ['admin'])
  assertEquals(canReadOpsAction(['engineering'], 'access-governance'), false)
  assertEquals(canReadOpsAction(['admin'], 'access-governance'), true)
})

Deno.test('customer and tailor detail projections preserve domain role boundaries', () => {
  assertEquals(canReadOpsAction(['customer_success'], 'customer-detail'), true)
  assertEquals(canReadOpsAction(['trust'], 'customer-detail'), false)
  assertEquals(canReadOpsAction(['trust'], 'tailor-detail'), true)
  assertEquals(canReadOpsAction(['finance'], 'tailor-detail'), false)
})

Deno.test('every authorized Ops read has a finite enforced query budget', () => {
  const actions = Object.keys(OPS_READ_QUERY_BUDGETS)
  assertEquals(actions.length, 18)
  for (const action of actions) {
    if (!isOpsReadAction(action)) throw new Error(`Budgeted unknown action: ${action}`)
    const budget = queryBudgetForOpsReadAction(action)
    assertEquals(Number.isSafeInteger(budget) && budget > 0 && budget <= 12, true)
  }
  assertEquals(queryBudgetForOpsReadAction('reliability'), 5)
  assertEquals(queryBudgetForOpsReadAction('canonical-cases'), 9)
})

Deno.test('principal checks fail closed across revocation, review expiry, subject, and environment', () => {
  const base = {
    status: 'ACTIVE', accessSubject: 'staff-subject', permittedEnvironments: ['development'], sessionRevokedBefore: null,
    accessReviewDueAt: '2026-10-01T00:00:00.000Z', assertedSubject: 'staff-subject', assertionIssuedAt: 1_789_000_000,
    environment: 'DEVELOPMENT' as const, nowMs: Date.parse('2026-09-11T00:00:00.000Z'),
  }
  assertEquals(isActiveOpsReadPrincipal(base), true)
  assertEquals(isActiveOpsReadPrincipal({ ...base, environment: 'PRODUCTION' }), false)
  assertEquals(isActiveOpsReadPrincipal({ ...base, assertedSubject: 'other-subject' }), false)
  assertEquals(isActiveOpsReadPrincipal({ ...base, accessReviewDueAt: '2026-09-10T00:00:00.000Z' }), false)
  assertEquals(isActiveOpsReadPrincipal({ ...base, sessionRevokedBefore: '2026-09-11T00:00:00.000Z', assertionIssuedAt: 1_789_000_000 }), false)
  assertEquals(isActiveOpsReadPrincipal({ ...base, accessReviewDueAt: null }), false)
})
