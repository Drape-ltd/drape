#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contractPath = path.join(root, 'config/release-contract.json')
const easPath = path.join(root, 'apps/mobile/eas.json')
const errors = []

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    errors.push(`Could not read ${path.relative(root, filePath)}: ${error.message}`)
    return null
  }
}

const contract = readJson(contractPath)
const eas = readJson(easPath)

if (contract) {
  if (contract.version !== 1) errors.push('config/release-contract.json must use version 1.')
  for (const key of ['productionSupabaseProjectRef', 'developmentSupabaseProjectRef']) {
    if (!/^[a-z0-9]+$/u.test(contract[key] ?? '')) errors.push(`${key} must be a Supabase project ref.`)
  }
  const requiredChecks = [
    'mobile-release-target',
    'build-profile-parity',
    'app-identity',
    'web-environment',
    'happy-and-negative-matrix',
  ]
  if (!Array.isArray(contract.requiredChecks)) {
    errors.push('requiredChecks must list every blocking release check.')
  } else {
    for (const check of requiredChecks) {
      if (!contract.requiredChecks.includes(check)) errors.push(`requiredChecks is missing ${check}.`)
    }
  }

  const flows = contract.criticalFlows
  if (!flows || typeof flows !== 'object' || Array.isArray(flows) || Object.keys(flows).length === 0) {
    errors.push('criticalFlows must be a non-empty object.')
  } else {
    const seen = new Set()
    const allowedSurfaces = new Set(['web', 'ios', 'android', 'ops'])
    for (const [flow, definition] of Object.entries(flows)) {
      if (seen.has(flow)) errors.push(`Duplicate critical flow: ${flow}`)
      seen.add(flow)
      if (!/^[-a-z0-9]+\.[-a-z0-9]+$/u.test(flow)) errors.push(`Invalid critical flow key: ${flow}`)
      for (const field of ['surfaces', 'happy', 'negative']) {
        if (!Array.isArray(definition?.[field]) || definition[field].length === 0) {
          errors.push(`${flow}.${field} must contain at least one case.`)
        }
      }
      if (new Set(definition?.surfaces ?? []).size !== (definition?.surfaces ?? []).length) {
        errors.push(`${flow}.surfaces contains duplicates.`)
      }
      if ((definition?.surfaces ?? []).some((surface) => typeof surface !== 'string' || !allowedSurfaces.has(surface))) {
        errors.push(`${flow}.surfaces must contain only web, ios, android, or ops.`)
      }
      for (const field of ['happy', 'negative']) {
        if ((definition?.[field] ?? []).some((value) => typeof value !== 'string' || !value.trim())) {
          errors.push(`${flow}.${field} entries must be non-empty strings.`)
        }
        if (new Set(definition?.[field] ?? []).size !== (definition?.[field] ?? []).length) {
          errors.push(`${flow}.${field} contains duplicate cases.`)
        }
      }
    }
  }
}

if (eas) {
  const profiles = eas.build ?? {}
  const expected = {
    development: { environment: 'development', supabaseEnv: 'development', projectRef: 'pqptfuqogvrajozfsqzi' },
    'development-device': { environment: 'development', supabaseEnv: 'development', projectRef: 'pqptfuqogvrajozfsqzi' },
    preview: { environment: 'preview', supabaseEnv: 'preview', projectRef: 'pqptfuqogvrajozfsqzi' },
    testflight: { environment: 'production', supabaseEnv: 'production', projectRef: null },
    production: { environment: 'production', supabaseEnv: 'production', projectRef: null },
  }
  for (const [name, rule] of Object.entries(expected)) {
    const profile = profiles[name]
    if (!profile) {
      errors.push(`Missing EAS build profile: ${name}`)
      continue
    }
    if (profile.environment !== rule.environment) errors.push(`${name}.environment must be ${rule.environment}.`)
    if (profile.env?.EXPO_PUBLIC_SUPABASE_ENV !== rule.supabaseEnv) {
      errors.push(`${name}.env.EXPO_PUBLIC_SUPABASE_ENV must be ${rule.supabaseEnv}.`)
    }
    const configuredRef = profile.env?.EXPO_PUBLIC_SUPABASE_PROJECT_REF ?? null
    if (rule.projectRef && configuredRef !== rule.projectRef) {
      errors.push(`${name} must pin Supabase project ${rule.projectRef}.`)
    }
    if (!rule.projectRef && configuredRef) {
      errors.push(`${name} must resolve its production Supabase ref through EAS, not hardcode it.`)
    }
    const serialized = JSON.stringify(profile)
    if (/service[_-]?role|supabase_service_role|secret_key/iu.test(serialized)) {
      errors.push(`${name} contains a service-role or provider secret in client build configuration.`)
    }
  }
}

const requiredPaths = [
  'scripts/generate-release-manifest.mjs',
  'scripts/mobile-release-target-guard.mjs',
  'apps/mobile/scripts/check-build-profile-parity.mjs',
  'apps/mobile/scripts/check-app-identity.mjs',
  'apps/web/scripts/verify-environment.mjs',
  'scripts/web-auth-qa-runner.mjs',
]
for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`Required release check is missing: ${relativePath}`)
}

if (errors.length) {
  console.error('Release contract failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Release contract passed.')
console.log(`- ${Object.keys(contract?.criticalFlows ?? {}).length} critical flows require happy and negative evidence.`)
console.log('- EAS lanes and client-secret boundaries are explicit.')
