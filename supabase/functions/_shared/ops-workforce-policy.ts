export const OPS_WORKFORCE_ACTIONS = [
  'REVOKE_DRAPEON_ACCESS',
  'VERIFY_EXTERNAL_OFFBOARDING',
] as const

export type OpsWorkforceAction = (typeof OPS_WORKFORCE_ACTIONS)[number]

export const OPS_WORKFORCE_EVIDENCE_KEYS = [
  'accessProvider',
  'collaborationTools',
  'providerDashboards',
  'scopedCredentials',
] as const

export type OpsWorkforceEvidence = Record<(typeof OPS_WORKFORCE_EVIDENCE_KEYS)[number], string>

export type ValidOpsWorkforceRequest = {
  targetPrincipalId: string
  action: OpsWorkforceAction
  reason: string
  expectedTargetUpdatedAt: string
  expectedCaseVersion: number | null
  evidenceRefs: OpsWorkforceEvidence | Record<string, never>
  idempotencyKey: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,254}$/u
const REQUEST_KEYS = new Set([
  'targetPrincipalId',
  'action',
  'reason',
  'expectedTargetUpdatedAt',
  'expectedCaseVersion',
  'evidenceRefs',
  'idempotencyKey',
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function isOpsUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value.trim())
}

export function validateOpsWorkforceRequest(input: unknown):
  | { ok: true; value: ValidOpsWorkforceRequest }
  | { ok: false; error: string } {
  const body = record(input)
  if (Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) {
    return { ok: false, error: 'unsupported-field' }
  }

  const targetPrincipalId = typeof body.targetPrincipalId === 'string' ? body.targetPrincipalId.trim() : ''
  if (!isOpsUuid(targetPrincipalId)) return { ok: false, error: 'invalid-target-principal' }

  const normalizedAction = typeof body.action === 'string' ? body.action.trim().toUpperCase() : ''
  if (!OPS_WORKFORCE_ACTIONS.includes(normalizedAction as OpsWorkforceAction)) {
    return { ok: false, error: 'unsupported-action' }
  }
  const action = normalizedAction as OpsWorkforceAction

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 12 || reason.length > 1_000) {
    return { ok: false, error: 'reason-must-be-12-to-1000-characters' }
  }

  const expectedTargetUpdatedAt = typeof body.expectedTargetUpdatedAt === 'string'
    ? body.expectedTargetUpdatedAt.trim()
    : ''
  if (
    !expectedTargetUpdatedAt
    || expectedTargetUpdatedAt.length > 64
    || !Number.isFinite(Date.parse(expectedTargetUpdatedAt))
  ) {
    return { ok: false, error: 'invalid-target-version' }
  }

  const expectedCaseVersion = body.expectedCaseVersion == null
    ? null
    : Number(body.expectedCaseVersion)
  if (
    expectedCaseVersion !== null
    && (!Number.isSafeInteger(expectedCaseVersion) || expectedCaseVersion < 1)
  ) {
    return { ok: false, error: 'invalid-case-version' }
  }
  if (action === 'VERIFY_EXTERNAL_OFFBOARDING' && expectedCaseVersion === null) {
    return { ok: false, error: 'case-version-required' }
  }

  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
  if (idempotencyKey.length < 16 || idempotencyKey.length > 180) {
    return { ok: false, error: 'invalid-idempotency-key' }
  }

  const evidence = record(body.evidenceRefs)
  const evidenceKeys = Object.keys(evidence).sort()
  if (action === 'REVOKE_DRAPEON_ACCESS') {
    if (evidenceKeys.length > 0) return { ok: false, error: 'evidence-not-accepted-for-revocation' }
    return {
      ok: true,
      value: {
        targetPrincipalId,
        action,
        reason,
        expectedTargetUpdatedAt,
        expectedCaseVersion,
        evidenceRefs: {},
        idempotencyKey,
      },
    }
  }

  const requiredKeys = [...OPS_WORKFORCE_EVIDENCE_KEYS].sort()
  if (evidenceKeys.length !== requiredKeys.length || evidenceKeys.some((key, index) => key !== requiredKeys[index])) {
    return { ok: false, error: 'four-exact-evidence-references-required' }
  }

  const evidenceRefs = {} as OpsWorkforceEvidence
  for (const key of OPS_WORKFORCE_EVIDENCE_KEYS) {
    const value = evidence[key]
    if (typeof value !== 'string' || value.trim().includes('://') || !EVIDENCE_REFERENCE.test(value.trim())) {
      return { ok: false, error: 'invalid-evidence-reference' }
    }
    evidenceRefs[key] = value.trim()
  }

  return {
    ok: true,
    value: {
      targetPrincipalId,
      action,
      reason,
      expectedTargetUpdatedAt,
      expectedCaseVersion,
      evidenceRefs,
      idempotencyKey,
    },
  }
}
