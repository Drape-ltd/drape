import { existsSync, lstatSync, readFileSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const repoDir = resolve(appDir, '..', '..')
const environmentFiles = [
  resolve(appDir, '.env.local'),
  resolve(repoDir, '.env'),
]
const artifactEnvPath = resolve(appDir, '.open-next', 'cloudflare', 'next-env.mjs')
const wranglerPath = resolve(appDir, 'wrangler.jsonc')
const productionProjectRef = 'wkfsrunetmgjdtcurmoj'
const mode = process.argv[2]

function pathEntryExists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

if (mode !== 'build' && mode !== 'deploy') {
  console.error('Usage: node ./scripts/cloudflare-artifact.mjs <build|deploy>')
  process.exit(1)
}

const wrangler = JSON.parse(readFileSync(wranglerPath, 'utf8'))
const productionVars = wrangler.vars ?? {}
const forbiddenArtifactKeys = [
  'DATABASE_URL',
  'DIRECT_URL',
  'OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION',
  'OPS_DASHBOARD_TOKEN',
  'OPS_LOCAL_WORKFORCE_DRY_RUN',
  'OPS_LOCAL_WORKFORCE_EMAIL',
  'OPS_LOCAL_WORKFORCE_ROLE',
  'PAYSTACK_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TURNSTILE_SECRET_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
]

function assertSafeArtifact() {
  if (!existsSync(artifactEnvPath)) {
    throw new Error('OpenNext environment artifact is missing.')
  }

  const artifact = readFileSync(artifactEnvPath, 'utf8')
  const leakedKeys = forbiddenArtifactKeys.filter((key) => artifact.includes(`\"${key}\"`))
  if (leakedKeys.length > 0) {
    throw new Error(`OpenNext artifact contains forbidden environment keys: ${leakedKeys.join(', ')}`)
  }
  const projectRefs = [...artifact.matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/gu)].map((match) => match[1])
  const unexpectedRefs = [...new Set(projectRefs.filter((ref) => ref !== productionProjectRef))]
  if (unexpectedRefs.length > 0) {
    throw new Error('OpenNext artifact contains a non-production Supabase project reference.')
  }
}

function productionChildEnv() {
  const allowedHostKeys = [
    'CI',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'COREPACK_HOME',
    'FORCE_COLOR',
    'HOME',
    'LANG',
    'LC_ALL',
    'LOGNAME',
    'NO_COLOR',
    'NODE_EXTRA_CA_CERTS',
    'NODE_OPTIONS',
    'PNPM_HOME',
    'SHELL',
    'TERM',
    'TMPDIR',
    'USER',
  ]
  const childEnv = Object.fromEntries(
    allowedHostKeys
      .filter((key) => typeof process.env[key] === 'string')
      .map((key) => [key, process.env[key]]),
  )
  childEnv.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`
  childEnv.NODE_ENV = 'production'
  childEnv.NEXT_DIST_DIR = '.next'

  for (const [key, value] of Object.entries(productionVars)) {
    if (typeof value === 'string') childEnv[key] = value
  }
  return childEnv
}

function runOpenNext(command) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pnpm', ['exec', 'opennextjs-cloudflare', command], {
      cwd: appDir,
      env: productionChildEnv(),
      stdio: 'inherit',
    })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (signal) return rejectPromise(new Error(`OpenNext ${command} exited on signal ${signal}.`))
      if (code !== 0) return rejectPromise(new Error(`OpenNext ${command} exited with code ${code ?? 1}.`))
      resolvePromise()
    })
  })
}

const hiddenEnvironmentFiles = []
try {
  for (const environmentFile of environmentFiles) {
    if (!pathEntryExists(environmentFile)) continue
    if (lstatSync(environmentFile).isSymbolicLink()) {
      const linkTarget = readlinkSync(environmentFile)
      unlinkSync(environmentFile)
      writeFileSync(environmentFile, '')
      hiddenEnvironmentFiles.push({ environmentFile, linkTarget })
      continue
    }
    const hiddenPath = `${environmentFile}.ops-production-${process.pid}`
    if (existsSync(hiddenPath)) throw new Error('Temporary production-build environment path already exists.')
    renameSync(environmentFile, hiddenPath)
    // Next inspects known dotenv paths during compilation. Leave an empty,
    // non-secret placeholder so a moved symlink does not produce ENOENT.
    writeFileSync(environmentFile, '')
    hiddenEnvironmentFiles.push({ environmentFile, hiddenPath })
  }

  if (mode === 'build') await runOpenNext('build')
  assertSafeArtifact()
  if (mode === 'deploy') await runOpenNext('deploy')
} catch (error) {
  console.error(`[ops cloudflare] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  for (const { environmentFile, hiddenPath, linkTarget } of hiddenEnvironmentFiles.reverse()) {
    if (existsSync(environmentFile)) unlinkSync(environmentFile)
    if (linkTarget) symlinkSync(linkTarget, environmentFile)
    else renameSync(hiddenPath, environmentFile)
  }
}
