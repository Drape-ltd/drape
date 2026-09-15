#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/release-contract.json'), 'utf8'))
const args = process.argv.slice(2)
const evidenceRootArg = args.find((arg) => arg.startsWith('--evidence-root='))?.split('=').slice(1).join('=')
const releaseShaArg = args.find((arg) => arg.startsWith('--release-sha='))?.split('=').slice(1).join('=')
const evidenceRoot = evidenceRootArg ? path.resolve(root, evidenceRootArg) : null

if (!evidenceRoot) {
  console.log('Release evidence check skipped: pass --evidence-root for a promotion/release run.')
  process.exit(0)
}

const manifestPath = path.join(evidenceRoot, 'manifest.json')
if (!fs.existsSync(manifestPath)) {
  console.error(`Release evidence failed: missing ${manifestPath}`)
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`Release evidence failed: invalid manifest.json (${error.message})`)
  process.exit(1)
}

const errors = []
if (manifest.schemaVersion !== 1) errors.push('manifest.schemaVersion must be 1.')
if (!manifest.releaseSha || !/^[0-9a-f]{7,64}$/iu.test(manifest.releaseSha)) errors.push('manifest.releaseSha is required.')
if (releaseShaArg && manifest.releaseSha !== releaseShaArg) errors.push(`manifest.releaseSha must match ${releaseShaArg}.`)
if (!manifest.environment || !['development', 'preview', 'production'].includes(manifest.environment)) errors.push('manifest.environment is invalid.')
if (!manifest.platform || !['web', 'ios', 'android', 'supabase', 'edge'].includes(manifest.platform)) errors.push('manifest.platform is invalid.')
if (!manifest.artifactDigest) errors.push('manifest.artifactDigest is required.')
if (!manifest.createdAt || Number.isNaN(Date.parse(manifest.createdAt))) errors.push('manifest.createdAt must be an ISO timestamp.')

const results = manifest.results
if (!results || typeof results !== 'object') {
  errors.push('manifest.results is required and must contain flow results.')
} else {
  for (const flow of Object.keys(contract.criticalFlows)) {
    const result = results[flow]
    if (!result) {
      errors.push(`${flow} has no evidence result.`)
      continue
    }
    if (result.happy !== 'passed') errors.push(`${flow}.happy must be passed.`)
    if (result.negative !== 'passed') errors.push(`${flow}.negative must be passed.`)
    if (result.visual !== 'passed') errors.push(`${flow}.visual must be passed.`)
    if (typeof result.evidence !== 'string' || !result.evidence.trim()) {
      errors.push(`${flow}.evidence must point to a sanitized trace or recording.`)
    }
  }
}

if (errors.length) {
  console.error('Release evidence failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Release evidence passed for ${Object.keys(contract.criticalFlows).length} critical flows.`)
