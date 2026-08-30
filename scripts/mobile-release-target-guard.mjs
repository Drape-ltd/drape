#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const easPath = path.join(root, 'apps/mobile/eas.json')
const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'))
const profiles = eas.build ?? {}

const productionProfiles = ['testflight', 'production']
const nonProductionProfiles = ['development', 'development-device', 'preview']
const errors = []

for (const name of productionProfiles) {
  const profile = profiles[name]
  if (!profile) {
    errors.push(`Missing ${name} build profile.`)
    continue
  }

  if (profile.environment !== 'production') {
    errors.push(`${name} must load the EAS production environment.`)
  }
  if (profile.env?.EXPO_PUBLIC_SUPABASE_ENV !== 'production') {
    errors.push(`${name} must set EXPO_PUBLIC_SUPABASE_ENV=production.`)
  }
  if (profile.env?.EXPO_PUBLIC_SUPABASE_PROJECT_REF) {
    errors.push(`${name} must not hardcode a Supabase project ref; EAS production owns it.`)
  }
}

for (const name of nonProductionProfiles) {
  const profile = profiles[name]
  if (!profile) continue

  if (profile.environment === 'production') {
    errors.push(`${name} must not load the EAS production environment.`)
  }
  if (profile.env?.EXPO_PUBLIC_SUPABASE_ENV === 'production') {
    errors.push(`${name} must not set EXPO_PUBLIC_SUPABASE_ENV=production.`)
  }
  if (!profile.env?.EXPO_PUBLIC_SUPABASE_PROJECT_REF) {
    errors.push(`${name} must pin its non-production Supabase project ref.`)
  }
}

if (errors.length > 0) {
  console.error('Mobile release target guard failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Mobile release target guard passed.')
console.log('- TestFlight and production load production auth/data.')
console.log('- Development and preview remain pinned away from production.')
