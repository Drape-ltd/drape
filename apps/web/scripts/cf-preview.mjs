import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const envLocalPath = resolve(scriptDir, '..', '.env.local')

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

function getSupabaseProjectRef(url) {
  const match = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/u)
  return match?.[1] ?? null
}

function readEnvLocal() {
  if (!existsSync(envLocalPath)) {
    return {}
  }

  return parseEnvFile(readFileSync(envLocalPath, 'utf8'))
}

function logSupabaseRef(mode, envLocal) {
  const shellUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? null
  const fileUrl = envLocal.NEXT_PUBLIC_SUPABASE_URL ?? null
  const activeUrl = shellUrl ?? fileUrl
  const ref = getSupabaseProjectRef(activeUrl)

  if (!ref) return

  const source = shellUrl ? 'shell env' : 'apps/web/.env.local'
  console.log(`[web env] ${mode} using Supabase project ref ${ref} from ${source}.`)
}

function assertSafeDeployEnv(mode) {
  const envLocal = readEnvLocal()
  logSupabaseRef(mode, envLocal)

  if (mode !== 'deploy' || process.env.ALLOW_LOCAL_WEB_ENV_DEPLOY === '1') {
    return
  }

  const publicSupabaseKeys = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]
  const presentKeys = publicSupabaseKeys.filter((key) => Boolean(envLocal[key]))

  if (!presentKeys.length) {
    return
  }

  const ref = getSupabaseProjectRef(envLocal.NEXT_PUBLIC_SUPABASE_URL)
  const projectLabel = ref ? ` for project ${ref}` : ''

  console.error(
    `[web env] Refusing Cloudflare deploy because apps/web/.env.local defines ${presentKeys.join(', ')}${projectLabel}.`
  )
  console.error(
    '[web env] Next.js will inline those public values into the client bundle. Use Cloudflare/CI env vars for deploys, or rerun with ALLOW_LOCAL_WEB_ENV_DEPLOY=1 if this is intentional.'
  )
  process.exit(1)
}

const cloudflareDeployEnv = Boolean(
  process.env.CF_PAGES ||
  process.env.CF_PAGES_BRANCH ||
  process.env.CF_PAGES_COMMIT_SHA ||
  ((process.env.CI === 'true' || process.env.CI === '1') &&
    (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID))
)

const forcedMode = process.argv[2]
const mode =
  forcedMode === 'deploy' || forcedMode === 'preview'
    ? forcedMode
    : cloudflareDeployEnv
      ? 'deploy'
      : 'preview'
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const args = ['dlx', '@opennextjs/cloudflare@latest', mode]

assertSafeDeployEnv(mode)

if (cloudflareDeployEnv) {
  console.log('Cloudflare deploy environment detected; running OpenNext deploy instead of the long-lived preview server.')
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
})

child.on('error', (error) => {
  console.error(`Failed to run OpenNext ${mode}:`, error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
