import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const wranglerPath = resolve(scriptDir, '..', 'wrangler.jsonc')
const productionProjectRef = 'wkfsrunetmgjdtcurmoj'
const config = JSON.parse(readFileSync(wranglerPath, 'utf8'))
const vars = config.vars ?? {}
const requiredSecrets = new Set(config.secrets?.required ?? [])

function projectRef(url) {
  const match = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/u)
  return match?.[1] ?? null
}

const failures = []

const forbiddenProductionVars = [
  'OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION',
  'OPS_DASHBOARD_TOKEN',
  'OPS_LOCAL_WORKFORCE_DRY_RUN',
]

for (const key of forbiddenProductionVars) {
  if (Object.prototype.hasOwnProperty.call(vars, key) || process.env[key]) {
    failures.push(`${key} must not exist in the production web environment`)
  }
}

if (vars.DRAPE_WEB_ENV !== 'production') {
  failures.push('DRAPE_WEB_ENV must equal production')
}

if (vars.DRAPE_EXPECTED_SUPABASE_PROJECT_REF !== productionProjectRef) {
  failures.push(`DRAPE_EXPECTED_SUPABASE_PROJECT_REF must equal ${productionProjectRef}`)
}

if (projectRef(vars.NEXT_PUBLIC_SUPABASE_URL) !== productionProjectRef) {
  failures.push(`NEXT_PUBLIC_SUPABASE_URL must target ${productionProjectRef}`)
}

if (vars.NEXT_PUBLIC_SITE_URL !== 'https://drapeon.co') {
  failures.push('NEXT_PUBLIC_SITE_URL must equal https://drapeon.co')
}

if (vars.CF_ACCESS_TEAM_DOMAIN !== 'drapeon.cloudflareaccess.com') {
  failures.push('CF_ACCESS_TEAM_DOMAIN must equal drapeon.cloudflareaccess.com')
}

if (vars.OPS_HOSTNAME !== 'ops.drapeon.co') {
  failures.push('OPS_HOSTNAME must equal ops.drapeon.co')
}

if (vars.OPS_CANONICAL_ORIGIN !== 'https://ops.drapeon.co') {
  failures.push('OPS_CANONICAL_ORIGIN must equal https://ops.drapeon.co')
}

for (const secret of ['SUPABASE_SERVICE_ROLE_KEY', 'CF_ACCESS_AUD', 'CF_ACCESS_SENSITIVE_AUD']) {
  if (!requiredSecrets.has(secret)) {
    failures.push(`${secret} must be declared as a required production secret`)
  }
}

const runtimeServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (runtimeServiceKey) {
  let serviceKeyProjectRef = null
  try {
    const encodedPayload = runtimeServiceKey.split('.')[1]
    serviceKeyProjectRef = encodedPayload
      ? JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')).ref ?? null
      : process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF?.trim() ?? null
  } catch {
    serviceKeyProjectRef = process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF?.trim() ?? null
  }

  if (serviceKeyProjectRef !== productionProjectRef) {
    failures.push(`SUPABASE_SERVICE_ROLE_KEY must prove it belongs to ${productionProjectRef}`)
  }
}

if (failures.length > 0) {
  console.error(`[web env] Production environment contract failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`[web env] Production web is locked to Supabase project ${productionProjectRef}.`)
