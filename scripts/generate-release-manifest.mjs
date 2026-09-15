#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const args = process.argv.slice(2)

function option(name) {
  const value = args.find((arg) => arg.startsWith(`--${name}=`))
  return value ? value.slice(name.length + 3) : null
}

const platform = option('platform')
const profileName = option('profile')
const environment = option('environment')
const artifactArg = option('artifact')
const outputArg = option('output') ?? 'artifacts/release/manifest.json'

if (!platform || !['web', 'ios', 'android', 'supabase', 'edge'].includes(platform)) {
  console.error('Usage: node scripts/generate-release-manifest.mjs --platform=web|ios|android|supabase|edge --profile=<profile> --environment=<environment> --artifact=<path>')
  process.exit(1)
}
if (!profileName || !environment || !['development', 'preview', 'production'].includes(environment)) {
  console.error('A profile and a valid environment are required.')
  process.exit(1)
}
if (!artifactArg) {
  console.error('A built artifact is required. Generate the manifest only after the immutable artifact exists.')
  process.exit(1)
}

const artifactPath = path.resolve(root, artifactArg)
if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
  console.error(`Artifact does not exist: ${artifactPath}`)
  process.exit(1)
}

const eas = JSON.parse(fs.readFileSync(path.join(root, 'apps/mobile/eas.json'), 'utf8'))
const profile = eas.build?.[profileName] ?? {}
if (!eas.build?.[profileName]) {
  console.error(`Unknown EAS build profile: ${profileName}`)
  process.exit(1)
}
if (profile.environment !== environment) {
  console.error(`Profile ${profileName} targets ${profile.environment ?? 'an unspecified environment'}, not ${environment}.`)
  process.exit(1)
}
const releaseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const artifactDigest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex')
const featureFlags = Object.fromEntries(
  Object.entries(profile.env ?? {}).filter(([key]) => key.startsWith('EXPO_PUBLIC_'))
)

const manifest = {
  schemaVersion: 1,
  releaseSha,
  artifactDigest: `sha256:${artifactDigest}`,
  artifactPath: path.relative(root, artifactPath),
  platform,
  buildNumber: option('build-number') ?? process.env.EXPO_PUBLIC_BUILD_NUMBER ?? 'unknown',
  profile: profileName,
  environment,
  supabaseProjectRef:
    option('supabase-project-ref') ??
    process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF ??
    profile.env?.EXPO_PUBLIC_SUPABASE_PROJECT_REF ??
    'resolved-by-eas',
  webOrigin: option('web-origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.EXPO_PUBLIC_SITE_URL ?? null,
  sentryRelease: option('sentry-release') ?? process.env.EXPO_PUBLIC_RELEASE_SHA ?? releaseSha,
  featureFlags,
  migrationRange: [],
  createdAt: new Date().toISOString(),
}

const outputPath = path.resolve(root, outputArg)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Release manifest written to ${path.relative(root, outputPath)}`)
console.log(`- ${platform}/${profileName} · ${environment} · ${releaseSha}`)
console.log(`- sha256:${artifactDigest}`)
