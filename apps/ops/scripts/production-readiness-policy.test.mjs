import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OPS_PRODUCTION_PROJECT_REF,
  REQUIRED_EDGE_SECRETS,
  REQUIRED_MIGRATIONS,
  REQUIRED_NOTIFICATION_PRODUCERS,
  REQUIRED_OPS_FUNCTIONS,
  evaluateProductionEvidence,
  evaluateProductionReadiness,
} from './production-readiness-policy.mjs'
import { runProductionCertification } from './production-readiness-runner.mjs'

const RELEASE_ID = '0123456789abcdef0123456789abcdef01234567'

function proof(evidenceRef) {
  return { passed: true, evidenceRef, observedAt: new Date().toISOString(), releaseId: RELEASE_ID }
}

function completeInput() {
  const device = (platform) => ({
    installed: proof(`device/${platform}/install-record`),
    permissionGranted: proof(`device/${platform}/permission-record`),
    notificationReceived: proof(`device/${platform}/provider-receipt`),
    exactCaseDeepLink: proof(`device/${platform}/deep-link-record`),
    restrictedActionsDenied: proof(`device/${platform}/denial-correlation`),
    signOutRevoked: proof(`device/${platform}/revocation-record`),
  })
  return {
    projectRef: OPS_PRODUCTION_PROJECT_REF,
    currentReleaseId: RELEASE_ID,
    evidenceReleaseId: RELEASE_ID,
    worktreeClean: true,
    secretNames: [...REQUIRED_EDGE_SECRETS],
    functions: [
      ...REQUIRED_OPS_FUNCTIONS.map((slug) => ({ slug, status: 'ACTIVE', version: 1, verifyJwt: true })),
      ...REQUIRED_NOTIFICATION_PRODUCERS.map((slug) => ({ slug, status: 'ACTIVE', version: 1, verifyJwt: true })),
    ],
    producerFunctionVersions: Object.fromEntries(REQUIRED_NOTIFICATION_PRODUCERS.map((slug) => [slug, 1])),
    appliedMigrationVersions: [...REQUIRED_MIGRATIONS],
    accessProof: {
      normalAudience: proof('access/normal-audience'),
      sensitiveAudience: proof('access/sensitive-audience'),
      freshMfa: proof('access/fresh-mfa'),
      revocationBeforeExpiry: proof('access/revocation'),
      crossEnvironmentDenial: proof('access/environment-denial'),
    },
    deviceProof: { iphone: device('iphone'), android: device('android') },
    releaseProof: {
      moneyMakerChecker: proof('release/money-receipts'),
      parallelRunReconciled: proof('release/reconciliation-record'),
      rollbackWindowObserved: proof('release/rollback-window'),
      operatorSignOff: proof('release/operator-signoff'),
    },
    cloudflareProof: {
      identityProviderId: 'idp-production-01',
      normalAccessApplicationId: 'access-normal-01',
      sensitiveAccessApplicationId: 'access-sensitive-01',
      opsWorkerVersionId: 'ops-worker-version-01',
      healthMonitorWorkerVersionId: 'health-worker-version-01',
      opsRoutePattern: 'ops.drapeon.co/*',
      healthSchedule: '*/5 * * * *',
    },
  }
}

function evidenceFromInput(input) {
  return {
    releaseId: input.evidenceReleaseId,
    producerFunctionVersions: input.producerFunctionVersions,
    appliedMigrationVersions: input.appliedMigrationVersions,
    accessProof: input.accessProof,
    deviceProof: input.deviceProof,
    releaseProof: input.releaseProof,
    cloudflareProof: input.cloudflareProof,
  }
}

test('complete production evidence passes', () => {
  assert.deepEqual(evaluateProductionReadiness(completeInput()).failures, [])
})

test('missing sensitive audience, one function, ledger, and device proof fail closed', () => {
  const input = completeInput()
  input.secretNames = input.secretNames.filter((name) => name !== 'CF_ACCESS_SENSITIVE_AUD')
  input.functions = input.functions.filter((entry) => entry.slug !== 'ops-money-action')
  input.appliedMigrationVersions = undefined
  input.deviceProof.android.notificationReceived = { passed: false }

  const result = evaluateProductionReadiness(input)
  assert.equal(result.ready, false)
  assert.ok(result.failures.includes('edge-secret:CF_ACCESS_SENSITIVE_AUD'))
  assert.ok(result.failures.includes('edge-function:ops-money-action'))
  assert.ok(result.failures.includes('migration-ledger:missing-authoritative-snapshot'))
  assert.ok(result.failures.includes('device-proof:android:notificationReceived'))
})

test('inactive functions and an incomplete migration ledger do not count', () => {
  const input = completeInput()
  input.functions = input.functions.map((entry) => entry.slug === 'ops-read-gateway' ? { ...entry, status: 'FAILED' } : entry)
  input.appliedMigrationVersions = input.appliedMigrationVersions.slice(1)

  const result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes('edge-function:ops-read-gateway'))
  assert.ok(result.failures.includes(`migration:${REQUIRED_MIGRATIONS[0]}`))
})

test('an active Ops function without Supabase JWT verification fails closed', () => {
  const input = completeInput()
  input.functions = input.functions.map((entry) => entry.slug === 'ops-read-gateway' ? { ...entry, verifyJwt: false } : entry)

  const result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes('edge-function-jwt:ops-read-gateway'))
})

test('notification producers require an exact post-deployment version manifest', () => {
  const input = completeInput()
  const producer = REQUIRED_NOTIFICATION_PRODUCERS[0]
  delete input.producerFunctionVersions[producer]

  let result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes(`producer-version-proof:${producer}`))

  input.producerFunctionVersions[producer] = 2
  result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes(`producer-version-drift:${producer}`))
})

test('Cloudflare deployment proof requires real identifiers and the exact Ops route', () => {
  const input = completeInput()
  input.cloudflareProof.opsWorkerVersionId = ''
  input.cloudflareProof.opsRoutePattern = 'drapeon.co/ops*'

  const result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes('cloudflare-proof:opsWorkerVersionId'))
  assert.ok(result.failures.includes('cloudflare-proof:opsRoutePattern'))
})

test('proof claims must carry current release-bound evidence and a recent timestamp', () => {
  const input = completeInput()
  input.accessProof.freshMfa.evidenceRef = 'todo'
  input.deviceProof.iphone.exactCaseDeepLink.releaseId = 'abcdef0'
  input.deviceProof.android.signOutRevoked.observedAt = '2020-01-01T00:00:00.000Z'

  const result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes('access-proof:freshMfa:evidence'))
  assert.ok(result.failures.includes('device-proof:iphone:exactCaseDeepLink:release'))
  assert.ok(result.failures.includes('device-proof:android:signOutRevoked:freshness'))
})

test('certification rejects a dirty or different source release', () => {
  const input = completeInput()
  input.worktreeClean = false
  input.evidenceReleaseId = 'abcdef0123456789'

  const result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes('release-worktree:dirty'))
  assert.ok(result.failures.includes('release-identity:mismatch'))
})

test('health monitoring evidence must match the reviewed five-minute cadence', () => {
  const input = completeInput()
  input.cloudflareProof.healthSchedule = '0 * * * *'

  const result = evaluateProductionReadiness(input)
  assert.ok(result.failures.includes('cloudflare-proof:healthSchedule:cadence'))
})

test('the local evidence preflight validates the complete artifact without remote state', () => {
  const input = completeInput()
  const result = evaluateProductionEvidence({
    currentReleaseId: RELEASE_ID,
    evidence: evidenceFromInput(input),
    worktreeClean: true,
  })

  assert.deepEqual(result.failures, [])
})

test('the local evidence preflight rejects a malformed evidence root', () => {
  const result = evaluateProductionEvidence({
    currentReleaseId: RELEASE_ID,
    evidence: [],
    worktreeClean: true,
  })

  assert.equal(result.ready, false)
  assert.ok(result.failures.includes('evidence:root'))
  assert.ok(result.failures.includes('release-identity:mismatch'))
})

test('invalid local evidence cannot trigger the production inventory loader', () => {
  let remoteCalls = 0
  const certification = runProductionCertification({
    currentReleaseId: RELEASE_ID,
    evidence: {},
    worktreeClean: true,
    loadRemoteInventory() {
      remoteCalls += 1
      throw new Error('remote inventory must not run')
    },
  })

  assert.equal(certification.phase, 'local-evidence')
  assert.equal(certification.result.ready, false)
  assert.equal(remoteCalls, 0)
})

test('valid local evidence advances exactly once to authoritative production inventory', () => {
  const input = completeInput()
  let remoteCalls = 0
  const certification = runProductionCertification({
    currentReleaseId: RELEASE_ID,
    evidence: evidenceFromInput(input),
    worktreeClean: true,
    loadRemoteInventory() {
      remoteCalls += 1
      return { secretNames: input.secretNames, functions: input.functions }
    },
  })

  assert.equal(certification.phase, 'production-inventory')
  assert.equal(certification.result.ready, true)
  assert.equal(remoteCalls, 1)
})
