#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const LINKED_PROJECT_REF_PATH = path.join(ROOT, 'supabase', '.temp', 'project-ref')
const LOCAL_TARGETS_PATH = path.join(ROOT, '.env.supabase-targets.local')
const SUPABASE_FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions')
const DEFAULT_DEV_PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const MAX_PRODUCTION_MIGRATIONS_PER_PUSH = 5

const RUNTIME_PROVIDED_FUNCTION_ENVS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const CUSTOM_FUNCTION_SECRETS = [
  'AZURE_TRANSLATOR_KEY',
  'AZURE_TRANSLATOR_REGION',
  'DAILY_API_KEY',
  'DECISION_FUNCTION_URL',
  'DRAPE_HEALTHCHECK_SECRET',
  'DRAPE_REAUTH_PROOF_SECRET',
  'DRAPE_SERVICE_ROLE_JWT',
  'DRAPE_SERVICE_ROLE_KEY',
  'EMAIL_CHANGE_REDIRECT_URL',
  'HEALTHCHECK_SECRET',
  'GOOGLE_CLOUD_TRANSLATION_API_KEY',
  'MANUAL_BANK_ENTRY_ENABLED',
  'NEXT_PUBLIC_SITE_URL',
  'OPS_EMAIL',
  'OPS_NOTIFICATION_EMAILS',
  'QUOTE_NEGOTIATION_V1',
  'PAYSTACK_CALLBACK_URL',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_SECRET_KEY_TEST',
  'REAUTH_PROOF_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'SHIPBUBBLE_SECRET_KEY',
  'SHIPBUBBLE_WEBHOOK_SECRET',
  'SHIPPO_WEBHOOK_SECRET',
  'SENTRY_DSN',
  'SENTRY_MONITOR_ORG',
  'SENTRY_MONITOR_PROJECTS',
  'SENTRY_MONITOR_TOKEN',
  'SITE_URL',
  'SMS_PROVIDER',
  'SUPABASE_SENTRY_DSN',
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_AUTH_HOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET_KEY_SANDBOX',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRETS',
  'TERMII_API_BASE_URL',
  'TERMII_API_KEY',
  'TERMII_CHANNEL',
  'TERMII_FROM',
  'TERMII_MESSAGE_TYPE',
  'TERMII_SENDER_ID',
  'IDENTITY_RETENTION_ENFORCEMENT',
  'TOPSHIP_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'AUTH_SMS_HOOK_SECRET',
  'VERIFICATION_SECRET',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_SUBJECT',
  'WEBHOOK_SECRET',
  'ZIPTAX_API_KEY',
]

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = line.slice(0, equalsIndex).trim()
    if (!key || process.env[key]) continue

    let value = line.slice(equalsIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

loadLocalEnvFile(LOCAL_TARGETS_PATH)

function normalizeTarget(value) {
  const normalized = (value ?? '').trim().toLowerCase()

  if (normalized === 'dev' || normalized === 'development') return 'development'
  if (normalized === 'prod' || normalized === 'production') return 'production'

  return null
}

function readLinkedProjectRef() {
  try {
    const value = fs.readFileSync(LINKED_PROJECT_REF_PATH, 'utf8').trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

function getExpectedProjectRef(target) {
  if (target === 'development') {
    return process.env.DRAPE_SUPABASE_DEV_PROJECT_REF?.trim() || DEFAULT_DEV_PROJECT_REF
  }

  const productionRef = process.env.DRAPE_SUPABASE_PROD_PROJECT_REF?.trim() || ''
  if (!productionRef) {
    fail(
      [
        'Missing DRAPE_SUPABASE_PROD_PROJECT_REF.',
        'Create .env.supabase-targets.local in the repo root and add:',
        'DRAPE_SUPABASE_PROD_PROJECT_REF=your_production_project_ref',
      ].join('\n')
    )
  }

  return productionRef
}

function fail(message) {
  console.error(`\n[Drape Supabase Guard] ${message}\n`)
  process.exit(1)
}

function runSupabase(args) {
  const result = spawnSync('supabase', args, {
    cwd: ROOT,
    stdio: 'inherit',
  })

  if (result.error) {
    fail(result.error.message)
  }

  process.exit(result.status ?? 1)
}

function inspectPendingMigrations(args) {
  const result = spawnSync('supabase', ['db', 'push', '--dry-run', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  })

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stdout.write(output)

  if (result.error) fail(result.error.message)
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)

  // Supabase has emitted both plain version lines and full migration filenames
  // across CLI releases. Count only reviewed migration records and tolerate ANSI
  // formatting so a production batch can never be reported as an empty batch.
  const normalizedOutput = output.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
  const versions = new Set(
    Array.from(
      normalizedOutput.matchAll(/(?:^|[\/\s])((?:19|20)\d{12})(?=_[^\s/]+\.sql\b|\s|$)/gm),
      (match) => match[1]
    )
  )

  if (/Would push these migrations|migration[s]? to apply/i.test(normalizedOutput) && versions.size === 0) {
    fail('Supabase reported pending production migrations, but the guard could not parse the batch. Refusing to continue.')
  }
  if (versions.size > MAX_PRODUCTION_MIGRATIONS_PER_PUSH) {
    fail(
      `Production push contains ${versions.size} pending migrations; the reviewed limit is ${MAX_PRODUCTION_MIGRATIONS_PER_PUSH}. Split and verify the batch on development first.`
    )
  }

  return versions.size
}

function getDeployableFunctionNames() {
  if (!fs.existsSync(SUPABASE_FUNCTIONS_DIR)) return []

  return fs
    .readdirSync(SUPABASE_FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .sort()
}

function assertLinkedProject(target, expectedRef, linkedRef) {
  if (!linkedRef) {
    fail(
      [
        'No linked Supabase project was found for this repo.',
        `Run: pnpm supabase:link:${target === 'production' ? 'prod' : 'dev'}`,
      ].join('\n')
    )
  }

  if (linkedRef !== expectedRef) {
    fail(
      [
        `Refusing to run against linked project ${linkedRef}.`,
        `Expected the ${target} project ${expectedRef}.`,
        `Run: pnpm supabase:link:${target === 'production' ? 'prod' : 'dev'}`,
      ].join('\n')
    )
  }
}

function printStatus() {
  const linkedRef = readLinkedProjectRef()
  const devRef = getExpectedProjectRef('development')
  const prodRef = process.env.DRAPE_SUPABASE_PROD_PROJECT_REF?.trim() || '(not configured)'

  console.log('\nDrape Supabase target status\n')
  console.log(`Linked project ref: ${linkedRef ?? '(not linked)'}`)
  console.log(`Expected dev ref:  ${devRef}`)
  console.log(`Expected prod ref: ${prodRef}`)

  if (!linkedRef) {
    console.log(
      '\nNext step: link this repo to dev or prod with pnpm supabase:link:dev or pnpm supabase:link:prod.\n'
    )
    return
  }

  if (linkedRef === devRef) {
    console.log('\nCurrent target: development\n')
    return
  }

  if (linkedRef === prodRef) {
    console.log('\nCurrent target: production\n')
    return
  }

  console.log('\nCurrent target: unknown to the repo guard\n')
}

function printUsage() {
  console.log(`
Usage:
  node scripts/supabase-target-guard.mjs status
  node scripts/supabase-target-guard.mjs link <development|production>
  node scripts/supabase-target-guard.mjs db:push <development|production>
  node scripts/supabase-target-guard.mjs functions:deploy <development|production> <function-name> [more-names...]
  node scripts/supabase-target-guard.mjs functions:deploy-all <development|production>
  node scripts/supabase-target-guard.mjs secrets:set <development|production> KEY=VALUE [more KEY=VALUE]
  node scripts/supabase-target-guard.mjs secrets:manifest

The script also reads .env.supabase-targets.local in the repo root.
`)
}

function printSecretsManifest() {
  console.log('\nDrape Supabase function secret manifest\n')
  console.log('Runtime-provided by Supabase:')
  for (const key of RUNTIME_PROVIDED_FUNCTION_ENVS) {
    console.log(`- ${key}`)
  }

  console.log('\nCustom secrets to manage explicitly:')
  for (const key of CUSTOM_FUNCTION_SECRETS) {
    console.log(`- ${key}`)
  }

  console.log(
    '\nNote: Cloudflare web envs such as CF_ACCESS_AUD and OPS_ADMIN_EMAILS are separate from Supabase function secrets.\n'
  )
}

const [, , command, rawTarget, ...rawRest] = process.argv
const rest = rawRest.filter((value) => value !== '--')

if (!command || command === '--help' || command === '-h') {
  printUsage()
  process.exit(0)
}

if (command === 'status') {
  printStatus()
  process.exit(0)
}

if (command === 'secrets:manifest') {
  printSecretsManifest()
  process.exit(0)
}

const target = normalizeTarget(rawTarget)
if (!target) {
  fail('Target must be development/dev or production/prod.')
}

const expectedRef = getExpectedProjectRef(target)
const linkedRef = readLinkedProjectRef()

if (command === 'link') {
  console.log(`\n[Drape Supabase Guard] Linking repo to ${target} project ${expectedRef}.\n`)
  runSupabase(['link', '--project-ref', expectedRef])
}

if (command === 'db:push') {
  assertLinkedProject(target, expectedRef, linkedRef)

  if (target === 'production') {
    const forwardedArgs = rest.filter((value) => value !== '--dry-run')
    const pendingCount = inspectPendingMigrations(forwardedArgs)
    console.log(
      `\n[Drape Supabase Guard] Reviewed production batch: ${pendingCount} pending migration(s).\n`
    )

    if (rest.includes('--dry-run')) process.exit(0)
  }

  console.log(
    `\n[Drape Supabase Guard] Running db push against ${target} project ${expectedRef}.\n`
  )
  runSupabase(['db', 'push', ...rest])
}

if (command === 'functions:deploy') {
  if (rest.length === 0) {
    fail('Pass at least one function name to deploy.')
  }

  assertLinkedProject(target, expectedRef, linkedRef)

  for (const functionName of rest) {
    if (!functionName.trim()) continue
    console.log(
      `\n[Drape Supabase Guard] Deploying ${functionName} to ${target} project ${expectedRef}.\n`
    )

    const result = spawnSync('supabase', ['functions', 'deploy', functionName], {
      cwd: ROOT,
      stdio: 'inherit',
    })

    if (result.error) {
      fail(result.error.message)
    }

    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1)
    }
  }

  process.exit(0)
}

if (command === 'functions:deploy-all') {
  assertLinkedProject(target, expectedRef, linkedRef)

  const functionNames = getDeployableFunctionNames()
  if (functionNames.length === 0) {
    fail('No deployable functions were found in supabase/functions.')
  }

  for (const functionName of functionNames) {
    console.log(
      `\n[Drape Supabase Guard] Deploying ${functionName} to ${target} project ${expectedRef}.\n`
    )

    const result = spawnSync('supabase', ['functions', 'deploy', functionName], {
      cwd: ROOT,
      stdio: 'inherit',
    })

    if (result.error) {
      fail(result.error.message)
    }

    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1)
    }
  }

  process.exit(0)
}

if (command === 'secrets:set') {
  if (rest.length === 0) {
    fail('Pass at least one KEY=VALUE pair to set.')
  }

  const invalidEntries = rest.filter((entry) => !entry.includes('=') || entry.startsWith('='))
  if (invalidEntries.length > 0) {
    fail(`Every secret must be passed as KEY=VALUE. Invalid entries: ${invalidEntries.join(', ')}`)
  }

  assertLinkedProject(target, expectedRef, linkedRef)
  console.log(
    `\n[Drape Supabase Guard] Setting ${rest.length} secrets on ${target} project ${expectedRef}.\n`
  )
  runSupabase(['secrets', 'set', ...rest])
}

fail(`Unknown command "${command}".`)
