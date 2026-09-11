import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OPS_PRODUCTION_PROJECT_REF,
  REQUIRED_NOTIFICATION_PRODUCERS,
} from './production-readiness-policy.mjs'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const functionsRoot = resolve(root, 'supabase/functions')
const sourcePattern = /_shared\/(?:ops-issues|web-push)\.ts/u

function sourceProducerNames() {
  return readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .filter((entry) => {
      const indexPath = resolve(functionsRoot, entry.name, 'index.ts')
      return existsSync(indexPath) && sourcePattern.test(readFileSync(indexPath, 'utf8'))
    })
    .map((entry) => entry.name)
    .sort()
}

function supabaseFunctionInventory() {
  try {
    const output = execFileSync('supabase', [
      'functions',
      'list',
      '--project-ref',
      OPS_PRODUCTION_PROJECT_REF,
      '--output',
      'json',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(output)
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim()
    throw new Error(`could not read the production function inventory: ${detail}`)
  }
}

const expected = [...REQUIRED_NOTIFICATION_PRODUCERS].sort()
const actualSource = sourceProducerNames()
const missingFromPolicy = actualSource.filter((name) => !expected.includes(name))
const stalePolicyEntries = expected.filter((name) => !actualSource.includes(name))
const failures = []

if (missingFromPolicy.length > 0) failures.push(`policy is missing source producers: ${missingFromPolicy.join(', ')}`)
if (stalePolicyEntries.length > 0) failures.push(`policy lists producers no longer found in source: ${stalePolicyEntries.join(', ')}`)

if (process.argv.includes('--source-only')) {
  if (failures.length > 0) {
    console.error(['Notification-producer source manifest verification failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
    process.exit(1)
  }
  console.log(`Notification-producer source manifest verification passed for ${expected.length} functions.`)
  process.exit(0)
}

const evidencePath = process.env.OPS_PRODUCTION_EVIDENCE_PATH
if (!evidencePath) {
  failures.push('OPS_PRODUCTION_EVIDENCE_PATH is required for the post-deployment version manifest')
}

const evidence = evidencePath && existsSync(resolve(evidencePath))
  ? JSON.parse(readFileSync(resolve(evidencePath), 'utf8'))
  : {}
const evidencedVersions = evidence.producerFunctionVersions ?? {}
let liveInventory = []
try {
  liveInventory = supabaseFunctionInventory()
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
}
const inventory = new Map(liveInventory.map((entry) => [entry.slug, entry]))

for (const name of expected) {
  const live = inventory.get(name)
  const evidencedVersion = evidencedVersions[name]
  console.log(JSON.stringify({
    functionName: name,
    status: live?.status ?? 'MISSING',
    liveVersion: live?.version ?? null,
    evidencedVersion: evidencedVersion ?? null,
  }))
  if (live?.status !== 'ACTIVE') failures.push(`${name}: production function is not ACTIVE`)
  if (!Number.isInteger(evidencedVersion) || evidencedVersion < 1) {
    failures.push(`${name}: no reviewed post-deployment version is recorded`)
  } else if (live?.version !== evidencedVersion) {
    failures.push(`${name}: live version ${live?.version ?? 'missing'} does not match evidence ${evidencedVersion}`)
  }
}

if (failures.length > 0) {
  console.error(['Production notification-producer verification failed closed:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
  process.exit(1)
}

console.log(`Production notification-producer verification passed for ${expected.length} functions.`)
