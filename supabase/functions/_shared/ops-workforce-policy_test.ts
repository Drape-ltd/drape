import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateOpsWorkforceRequest } from './ops-workforce-policy.ts'

const base = {
  targetPrincipalId: '94009d63-0c35-4b68-bca0-abcd12760456',
  reason: 'Remove access after the confirmed workforce departure.',
  expectedTargetUpdatedAt: '2026-09-11T12:00:00.123456Z',
  expectedCaseVersion: null,
  evidenceRefs: {},
  idempotencyKey: 'workforce-action-20260911-0001',
}

Deno.test('workforce revocation accepts only the bounded command shape', () => {
  const result = validateOpsWorkforceRequest({ ...base, action: 'revoke_drapeon_access' })
  assertEquals(result.ok, true)
  if (result.ok) assertEquals(result.value.action, 'REVOKE_DRAPEON_ACCESS')

  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'DELETE_PRINCIPAL' }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', reason: 'Too short' }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', expectedTargetUpdatedAt: 'tomorrow' }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', idempotencyKey: 'short' }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', evidenceRefs: { accessProvider: 'CF-REF-0001' } }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', operatorEmail: 'operator@example.com' }).ok, false)
})

Deno.test('external offboarding verification requires an optimistic case version and four exact references', () => {
  const valid = {
    ...base,
    action: 'VERIFY_EXTERNAL_OFFBOARDING',
    expectedCaseVersion: 4,
    evidenceRefs: {
      accessProvider: 'CF-AUDIT-20260911-0042',
      collaborationTools: 'OFFBOARD-20260911-COLLAB',
      providerDashboards: 'OFFBOARD-20260911-PROVIDERS',
      scopedCredentials: 'ROTATION-20260911-0017',
    },
  }
  assertEquals(validateOpsWorkforceRequest(valid).ok, true)
  assertEquals(validateOpsWorkforceRequest({ ...valid, expectedCaseVersion: null }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...valid, evidenceRefs: { ...valid.evidenceRefs, extra: 'EXTRA-REF-0001' } }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...valid, evidenceRefs: { ...valid.evidenceRefs, accessProvider: null } }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...valid, evidenceRefs: { ...valid.evidenceRefs, accessProvider: 'https://private.example.com/evidence' } }).ok, false)
})

Deno.test('workforce policy rejects arrays and malformed principal identifiers', () => {
  assertEquals(validateOpsWorkforceRequest([]).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', targetPrincipalId: 'principal-1' }).ok, false)
  assertEquals(validateOpsWorkforceRequest({ ...base, action: 'REVOKE_DRAPEON_ACCESS', expectedCaseVersion: 1.5 }).ok, false)
})
