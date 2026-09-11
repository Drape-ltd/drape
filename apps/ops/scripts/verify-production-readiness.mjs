import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OPS_PRODUCTION_PROJECT_REF,
} from './production-readiness-policy.mjs'
import { runProductionCertification } from './production-readiness-runner.mjs'

function supabaseJson(args) {
  const output = execFileSync('supabase', [...args, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return JSON.parse(output)
}

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
  const certification = runProductionCertification({
    currentReleaseId,
    evidence,
    worktreeClean,
    loadRemoteInventory() {
      const secrets = supabaseJson(['secrets', 'list', '--project-ref', OPS_PRODUCTION_PROJECT_REF])
      const functions = supabaseJson(['functions', 'list', '--project-ref', OPS_PRODUCTION_PROJECT_REF])
      return {
        secretNames: secrets.map((entry) => entry.name),
        functions: functions.map((entry) => ({
          slug: entry.slug,
          status: entry.status,
          version: entry.version,
          verifyJwt: entry.verify_jwt,
        })),
      }
    },
  })
  const { result } = certification

  if (!result.ready) {
    console.error(`[ops prod] Certification failed closed during ${certification.phase} with ${result.failures.length} unmet gates:\n- ${result.failures.join('\n- ')}`)
    process.exit(1)
  }

  console.log(`[ops prod] Production certification passed for ${OPS_PRODUCTION_PROJECT_REF}.`)
} catch (error) {
  console.error(`[ops prod] Certification could not run: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
