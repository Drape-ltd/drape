import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const wranglerPath = resolve(scriptDir, '..', 'wrangler.jsonc')
const productionProjectRef = 'wkfsrunetmgjdtcurmoj'
const config = JSON.parse(readFileSync(wranglerPath, 'utf8'))
const vars = config.vars ?? {}

function projectRef(url) {
  const match = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/u)
  return match?.[1] ?? null
}

const failures = []

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

if (failures.length > 0) {
  console.error(`[web env] Production environment contract failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`[web env] Production web is locked to Supabase project ${productionProjectRef}.`)
