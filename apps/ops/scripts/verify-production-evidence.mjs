import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateProductionEvidence } from './production-readiness-policy.mjs'

function readEvidence(pathValue) {
  if (!pathValue) throw new Error('OPS_PRODUCTION_EVIDENCE_PATH is required')
  const path = resolve(pathValue)
  if (!existsSync(path)) throw new Error(`Evidence file does not exist: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

try {
  const currentReleaseId = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase()
  const worktreeClean = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length === 0
  const evidence = readEvidence(process.env.OPS_PRODUCTION_EVIDENCE_PATH)
  const result = evaluateProductionEvidence({ currentReleaseId, evidence, worktreeClean })

  if (!result.ready) {
    console.error(`[ops prod] Local evidence preflight failed closed with ${result.failures.length} unmet gates:\n- ${result.failures.join('\n- ')}`)
    process.exit(1)
  }

  console.log(`[ops prod] Local evidence preflight passed for release ${currentReleaseId}.`)
} catch (error) {
  console.error(`[ops prod] Local evidence preflight could not run: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
