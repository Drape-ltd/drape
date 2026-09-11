import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(resolve(scriptDir, '..', 'wrangler.jsonc'), 'utf8'))
const middleware = readFileSync(resolve(scriptDir, '..', 'middleware.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(scriptDir, '..', 'package.json'), 'utf8'))
const productionProjectRef = 'wkfsrunetmgjdtcurmoj'
const vars = config.vars ?? {}
const requiredSecrets = new Set(config.secrets?.required ?? [])
const failures = []

function projectRef(url) {
  return url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/u)?.[1] ?? null
}

for (const key of ['OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION', 'OPS_DASHBOARD_TOKEN', 'OPS_LOCAL_WORKFORCE_DRY_RUN']) {
  if (Object.prototype.hasOwnProperty.call(vars, key) || process.env[key]) {
    failures.push(`${key} must not exist in the production Ops environment`)
  }
}

if (vars.DRAPE_OPS_ENV !== 'production') failures.push('DRAPE_OPS_ENV must equal production')
if (vars.DRAPE_EXPECTED_SUPABASE_PROJECT_REF !== productionProjectRef) failures.push(`Expected Supabase project ref must equal ${productionProjectRef}`)
if (projectRef(vars.NEXT_PUBLIC_SUPABASE_URL) !== productionProjectRef) failures.push(`NEXT_PUBLIC_SUPABASE_URL must target ${productionProjectRef}`)
if (vars.NEXT_PUBLIC_SITE_URL !== 'https://ops.drapeon.co') failures.push('NEXT_PUBLIC_SITE_URL must equal https://ops.drapeon.co')
if (vars.CF_ACCESS_TEAM_DOMAIN !== 'drapeon.cloudflareaccess.com') failures.push('CF_ACCESS_TEAM_DOMAIN must equal drapeon.cloudflareaccess.com')
if (vars.OPS_HOSTNAME !== 'ops.drapeon.co') failures.push('OPS_HOSTNAME must equal ops.drapeon.co')
if (vars.OPS_CANONICAL_ORIGIN !== 'https://ops.drapeon.co') failures.push('OPS_CANONICAL_ORIGIN must equal https://ops.drapeon.co')

const routePatterns = (config.routes ?? []).map((route) => route.pattern)
if (routePatterns.length !== 1 || routePatterns[0] !== 'ops.drapeon.co/*') {
  failures.push('The Ops deployable may own only ops.drapeon.co/*')
}

if (config.workers_dev !== false) failures.push('workers_dev must be explicitly disabled for the restricted Ops deployable')
if (config.preview_urls !== false) failures.push('preview_urls must be explicitly disabled for the restricted Ops deployable')

for (const secret of ['CF_ACCESS_AUD', 'CF_ACCESS_SENSITIVE_AUD', 'WEB_PUSH_VAPID_PUBLIC_KEY']) {
  if (!requiredSecrets.has(secret)) failures.push(`${secret} must be declared as a required production secret`)
}

if (requiredSecrets.has('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  failures.push('SUPABASE_SERVICE_ROLE_KEY must not be bound to the production Ops Worker; privileged reads and actions belong behind authenticated Edge gateways')
}

for (const contract of [
  'DRAPE_EXPECTED_SUPABASE_PROJECT_REF',
  'NEXT_PUBLIC_SUPABASE_URL',
  'CF_ACCESS_SENSITIVE_AUD',
  'OPS_DASHBOARD_TOKEN',
  'OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION',
  'OPS_LOCAL_WORKFORCE_DRY_RUN',
]) {
  if (!middleware.includes(contract)) failures.push(`Runtime middleware must enforce ${contract}`)
}
for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "script-src-attr 'none'", "form-action 'self'"]) {
  if (!middleware.includes(directive)) failures.push(`Runtime middleware CSP must include ${directive}`)
}
if (!middleware.includes("requestHeaders.set('x-nonce', nonce)")) failures.push('Runtime middleware must pass a per-request nonce into Next.js')
if (!middleware.includes("response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')")) failures.push('Runtime middleware must suppress search indexing')
if (!middleware.includes("NextResponse.redirect(new URL('/ops/my-work', request.url), 307)")) failures.push('Runtime middleware must redirect canonical Ops entry paths before the React server render')
if (packageJson.scripts?.['cf:build'] !== 'node ./scripts/cloudflare-artifact.mjs build') failures.push('Cloudflare builds must use the production artifact guard')
if (packageJson.scripts?.['cf:deploy'] !== 'node ./scripts/cloudflare-artifact.mjs deploy') failures.push('Cloudflare deploys must verify the production artifact')

if (failures.length > 0) {
  console.error(`[ops env] Production environment contract failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`[ops env] Production Ops is isolated to ops.drapeon.co and Supabase project ${productionProjectRef}.`)
