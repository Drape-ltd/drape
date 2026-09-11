import {
  OPS_PRODUCTION_PROJECT_REF,
  evaluateProductionEvidence,
  evaluateProductionReadiness,
} from './production-readiness-policy.mjs'

function readinessInput({ currentReleaseId, evidence, remoteInventory, worktreeClean, nowMs }) {
  return {
    projectRef: OPS_PRODUCTION_PROJECT_REF,
    currentReleaseId,
    evidenceReleaseId: evidence.releaseId,
    worktreeClean,
    nowMs,
    secretNames: remoteInventory.secretNames,
    functions: remoteInventory.functions,
    producerFunctionVersions: evidence.producerFunctionVersions,
    appliedMigrationVersions: evidence.appliedMigrationVersions,
    accessProof: evidence.accessProof,
    deviceProof: evidence.deviceProof,
    releaseProof: evidence.releaseProof,
    cloudflareProof: evidence.cloudflareProof,
  }
}

export function runProductionCertification({
  currentReleaseId,
  evidence,
  loadRemoteInventory,
  nowMs,
  worktreeClean,
}) {
  const evidenceResult = evaluateProductionEvidence({
    currentReleaseId,
    evidence,
    nowMs,
    worktreeClean,
  })

  if (!evidenceResult.ready) {
    return { phase: 'local-evidence', result: evidenceResult }
  }

  const remoteInventory = loadRemoteInventory()
  return {
    phase: 'production-inventory',
    result: evaluateProductionReadiness(readinessInput({
      currentReleaseId,
      evidence,
      remoteInventory,
      worktreeClean,
      nowMs,
    })),
  }
}
