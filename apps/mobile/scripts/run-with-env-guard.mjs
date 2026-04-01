import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VALID_APP_VARIANTS = new Set(['development', 'preview', 'production'])
const VALID_SUPABASE_ENVS = new Set(['development', 'preview', 'staging', 'test', 'production'])

function fail(message) {
  console.error(`[mobile env] ${message}`)
  process.exit(1)
}

function parseEnvFile(content) {
  const entries = {}

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

function loadEnvFiles(appVariant) {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const appDir = resolve(scriptDir, '..')
  const envFiles =
    appVariant === 'production'
      ? ['.env', '.env.production', '.env.production.local']
      : ['.env', '.env.local']

  return envFiles.reduce((merged, fileName) => {
    const filePath = resolve(appDir, fileName)
    if (!existsSync(filePath)) return merged

    return {
      ...merged,
      ...parseEnvFile(readFileSync(filePath, 'utf8')),
    }
  }, {})
}

function getSupabaseProjectRef(url) {
  try {
    const hostname = new URL(url).hostname
    const [ref, provider] = hostname.split('.')
    return provider === 'supabase' ? ref ?? null : null
  } catch {
    return null
  }
}

const [, , appVariant, ...commandArgs] = process.argv

if (!VALID_APP_VARIANTS.has(appVariant)) {
  fail('Usage: node ./scripts/run-with-env-guard.mjs <development|preview|production> <command...>')
}

if (!commandArgs.length) {
  fail('No command provided after the app variant.')
}

const fileEnv = loadEnvFiles(appVariant)
const env = {
  ...fileEnv,
  ...process.env,
  EXPO_PUBLIC_APP_VARIANT: appVariant,
}

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? ''
const supabaseKey =
  env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''
const supabaseEnv = env.EXPO_PUBLIC_SUPABASE_ENV?.trim().toLowerCase() ?? ''
const declaredProjectRef = env.EXPO_PUBLIC_SUPABASE_PROJECT_REF?.trim() ?? ''
const actualProjectRef = getSupabaseProjectRef(supabaseUrl)

if (!supabaseUrl) {
  fail(`Missing EXPO_PUBLIC_SUPABASE_URL for the ${appVariant} mobile environment.`)
}

if (!actualProjectRef) {
  fail(`EXPO_PUBLIC_SUPABASE_URL must point to a Supabase project, received "${supabaseUrl}".`)
}

if (!supabaseKey) {
  fail(
    `Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY) for the ${appVariant} mobile environment.`
  )
}

if (!supabaseEnv) {
  fail(
    'Missing EXPO_PUBLIC_SUPABASE_ENV. Set it explicitly so non-production mobile builds cannot drift into production.'
  )
}

if (!VALID_SUPABASE_ENVS.has(supabaseEnv)) {
  fail(
    `EXPO_PUBLIC_SUPABASE_ENV must be one of ${Array.from(VALID_SUPABASE_ENVS).join(', ')}. Received "${supabaseEnv}".`
  )
}

if (appVariant !== 'production' && !declaredProjectRef) {
  fail(
    `Missing EXPO_PUBLIC_SUPABASE_PROJECT_REF for the ${appVariant} mobile environment. Add the expected non-production project ref so the guard can verify it.`
  )
}

if (declaredProjectRef && declaredProjectRef !== actualProjectRef) {
  fail(
    `Supabase project ref mismatch. EXPO_PUBLIC_SUPABASE_URL points to ${actualProjectRef}, but EXPO_PUBLIC_SUPABASE_PROJECT_REF is ${declaredProjectRef}.`
  )
}

if (appVariant === 'production' && supabaseEnv !== 'production') {
  fail('Production mobile builds must use EXPO_PUBLIC_SUPABASE_ENV=production.')
}

if (appVariant !== 'production' && supabaseEnv === 'production') {
  fail(`The ${appVariant} mobile environment is labeled production. Refusing to continue.`)
}

console.log(`[mobile env] ${appVariant} using Supabase project ref ${actualProjectRef} labeled ${supabaseEnv}.`)

const [command, ...args] = commandArgs
const resolvedCommand =
  process.platform === 'win32' && !command.endsWith('.cmd') ? `${command}.cmd` : command

const child = spawn(resolvedCommand, args, {
  stdio: 'inherit',
  env,
})

child.on('error', (error) => {
  console.error(`[mobile env] Failed to run ${command}:`, error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
