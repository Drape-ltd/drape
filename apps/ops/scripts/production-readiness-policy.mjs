export const OPS_PRODUCTION_PROJECT_REF = 'wkfsrunetmgjdtcurmoj'

export const REQUIRED_EDGE_SECRETS = Object.freeze([
  'CF_ACCESS_AUD',
  'CF_ACCESS_SENSITIVE_AUD',
  'CF_ACCESS_TEAM_DOMAIN',
  'DRAPE_OPS_ENV',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_SUBJECT',
])

export const REQUIRED_OPS_FUNCTIONS = Object.freeze([
  'ops-account-deletion-action',
  'ops-case-action',
  'ops-export-action',
  'ops-health-monitor-ingest',
  'ops-incident-action',
  'ops-money-action',
  'ops-read-gateway',
  'ops-trust-action',
  'ops-web-push-action',
  'ops-workforce-action',
])

export const REQUIRED_NOTIFICATION_PRODUCERS = Object.freeze([
  'account-profile-action',
  'account-support-action',
  'commercial-adjustment-action',
  'consultation-attendance-action',
  'consultation-lifecycle-action',
  'conversation-safety-report',
  'customer-order-action',
  'drapeon-dispatch-action',
  'escalate-production-stalls',
  'fabric-workflow-action',
  'identity-handoff-action',
  'material-advance-action',
  'media-report-action',
  'monitor-material-reconciliation',
  'monitor-payout-changes',
  'monitor-sentry-issues',
  'monitor-settlements',
  'monitor-tax-controls',
  'payment-action',
  'payout-account-action',
  'paystack-webhook',
  'process-job-queue',
  'process-push-receipts',
  'refund-order-payments',
  'release-consultation-earning',
  'release-order-payouts',
  'release-settlement-tranche',
  'request-account-deletion',
  'request-data-access',
  'return-resolution-action',
  'reverse-stripe-transfer',
  'review-action',
  'seller-access-review-request',
  'send-consultation-reminders',
  'sentry-ops-webhook',
  'stripe-webhook',
  'tailor-order-action',
  'tailor-profile-action',
])

export const REQUIRED_MIGRATIONS = Object.freeze([
  '20260910182000',
  '20260910183500',
  '20260910185000',
  '20260910190000',
  '20260910191500',
  '20260910192000',
  '20260910193000',
  '20260910194000',
  '20260910195000',
  '20260910200000',
  '20260910201000',
  '20260910202000',
  '20260910203000',
  '20260910204000',
  '20260910205000',
  '20260910206000',
  '20260910207000',
  '20260910208000',
  '20260910209000',
  '20260910210000',
  '20260910211000',
  '20260910212000',
  '20260910213000',
  '20260910214000',
  '20260911010000',
  '20260911011000',
  '20260911012000',
  '20260911013000',
  '20260911014000',
  '20260911015000',
  '20260911016000',
])

const REQUIRED_ACCESS_PROOF = Object.freeze([
  'normalAudience',
  'sensitiveAudience',
  'freshMfa',
  'revocationBeforeExpiry',
  'crossEnvironmentDenial',
])

const REQUIRED_DEVICE_PROOF = Object.freeze([
  'installed',
  'permissionGranted',
  'notificationReceived',
  'exactCaseDeepLink',
  'restrictedActionsDenied',
  'signOutRevoked',
])

const REQUIRED_RELEASE_PROOF = Object.freeze([
  'moneyMakerChecker',
  'parallelRunReconciled',
  'rollbackWindowObserved',
  'operatorSignOff',
])

const REQUIRED_CLOUDFLARE_TEXT_PROOF = Object.freeze([
  'identityProviderId',
  'normalAccessApplicationId',
  'sensitiveAccessApplicationId',
  'opsWorkerVersionId',
  'healthMonitorWorkerVersionId',
  'healthSchedule',
])

const PROOF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const RELEASE_ID_PATTERN = /^[0-9a-f]{7,40}$/u
const EVIDENCE_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9._:/-]{7,255}$/iu
const PLACEHOLDER_PROOF = /^(?:example|none|not[-_ ]?set|pending|placeholder|todo|unknown)$/iu

function missingTextKeys(value, keys) {
  return keys.filter((key) => typeof value?.[key] !== 'string'
    || value[key].trim().length < 8
    || PLACEHOLDER_PROOF.test(value[key].trim()))
}

function proofFailure(value, releaseId, nowMs) {
  if (!value || typeof value !== 'object' || value.passed !== true) return 'missing'
  if (!EVIDENCE_REFERENCE_PATTERN.test(value.evidenceRef ?? '')) return 'evidence'
  if (value.releaseId !== releaseId) return 'release'
  const observedAt = Date.parse(value.observedAt ?? '')
  if (!Number.isFinite(observedAt) || observedAt > nowMs + 5 * 60 * 1000 || observedAt < nowMs - PROOF_MAX_AGE_MS) return 'freshness'
  return null
}

function appendProofFailures(failures, group, value, keys, releaseId, nowMs) {
  for (const key of keys) {
    const reason = proofFailure(value?.[key], releaseId, nowMs)
    if (reason) failures.push(`${group}:${key}${reason === 'missing' ? '' : `:${reason}`}`)
  }
}

function checkedAt(nowMs) {
  return new Date(nowMs).toISOString()
}

function evidenceFromReadinessInput(input) {
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

export function evaluateProductionEvidence(input) {
  const failures = []
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const evidenceIsObject = input.evidence !== null
    && typeof input.evidence === 'object'
    && !Array.isArray(input.evidence)
  const evidence = evidenceIsObject ? input.evidence : {}
  if (!evidenceIsObject) failures.push('evidence:root')

  const currentReleaseId = typeof input.currentReleaseId === 'string' ? input.currentReleaseId.trim().toLowerCase() : ''
  const evidenceReleaseId = typeof evidence.releaseId === 'string' ? evidence.releaseId.trim().toLowerCase() : ''
  if (!RELEASE_ID_PATTERN.test(currentReleaseId) || evidenceReleaseId !== currentReleaseId) {
    failures.push('release-identity:mismatch')
  }
  if (input.worktreeClean !== true) failures.push('release-worktree:dirty')

  for (const slug of REQUIRED_NOTIFICATION_PRODUCERS) {
    const evidencedVersion = evidence.producerFunctionVersions?.[slug]
    if (!Number.isInteger(evidencedVersion) || evidencedVersion < 1) {
      failures.push(`producer-version-proof:${slug}`)
    }
  }

  if (!Array.isArray(evidence.appliedMigrationVersions)) {
    failures.push('migration-ledger:missing-authoritative-snapshot')
  } else {
    const appliedMigrations = new Set(evidence.appliedMigrationVersions)
    for (const version of REQUIRED_MIGRATIONS) {
      if (!appliedMigrations.has(version)) failures.push(`migration:${version}`)
    }
  }

  appendProofFailures(failures, 'access-proof', evidence.accessProof, REQUIRED_ACCESS_PROOF, currentReleaseId, nowMs)
  for (const platform of ['iphone', 'android']) {
    appendProofFailures(failures, `device-proof:${platform}`, evidence.deviceProof?.[platform], REQUIRED_DEVICE_PROOF, currentReleaseId, nowMs)
  }
  appendProofFailures(failures, 'release-proof', evidence.releaseProof, REQUIRED_RELEASE_PROOF, currentReleaseId, nowMs)
  for (const key of missingTextKeys(evidence.cloudflareProof, REQUIRED_CLOUDFLARE_TEXT_PROOF)) {
    failures.push(`cloudflare-proof:${key}`)
  }
  if (evidence.cloudflareProof?.opsRoutePattern !== 'ops.drapeon.co/*') {
    failures.push('cloudflare-proof:opsRoutePattern')
  }
  if (evidence.cloudflareProof?.healthSchedule !== '*/5 * * * *') {
    failures.push('cloudflare-proof:healthSchedule:cadence')
  }

  return {
    ready: failures.length === 0,
    failures,
    checkedAt: checkedAt(nowMs),
  }
}

export function evaluateProductionReadiness(input) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now()
  const evidence = evidenceFromReadinessInput(input)
  const evidenceResult = evaluateProductionEvidence({
    evidence,
    currentReleaseId: input.currentReleaseId,
    worktreeClean: input.worktreeClean,
    nowMs,
  })
  const failures = [...evidenceResult.failures]
  const secretNames = new Set(input.secretNames ?? [])
  const functions = new Map((input.functions ?? []).map((entry) => [entry?.slug, entry]))

  if (input.projectRef !== OPS_PRODUCTION_PROJECT_REF) {
    failures.push(`project-ref: expected ${OPS_PRODUCTION_PROJECT_REF}`)
  }

  for (const name of REQUIRED_EDGE_SECRETS) {
    if (!secretNames.has(name)) failures.push(`edge-secret:${name}`)
  }
  for (const slug of REQUIRED_OPS_FUNCTIONS) {
    const entry = functions.get(slug)
    if (entry?.status !== 'ACTIVE') failures.push(`edge-function:${slug}`)
    else if (entry.verifyJwt !== true) failures.push(`edge-function-jwt:${slug}`)
  }
  for (const slug of REQUIRED_NOTIFICATION_PRODUCERS) {
    const entry = functions.get(slug)
    const evidencedVersion = evidence.producerFunctionVersions?.[slug]
    if (entry?.status !== 'ACTIVE') {
      failures.push(`producer-function:${slug}`)
    } else if (Number.isInteger(evidencedVersion) && evidencedVersion >= 1 && entry.version !== evidencedVersion) {
      failures.push(`producer-version-drift:${slug}`)
    }
  }

  return {
    ready: failures.length === 0,
    failures,
    checkedAt: checkedAt(nowMs),
  }
}
