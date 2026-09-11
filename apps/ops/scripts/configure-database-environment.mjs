const environment = process.argv[2]?.trim().toUpperCase()
const expectedRefs = {
  DEVELOPMENT: 'pqptfuqogvrajozfsqzi',
  PRODUCTION: 'wkfsrunetmgjdtcurmoj',
}

if (!(environment in expectedRefs)) {
  console.error('Usage: pnpm --filter @drape/ops db:bind-environment development|production')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!supabaseUrl || !serviceRoleKey) {
  console.error('[ops db] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}

const projectRef = new URL(supabaseUrl).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1]
const expectedRef = expectedRefs[environment]
if (projectRef !== expectedRef) {
  console.error(`[ops db] Refusing ${environment} binding: target project is not ${expectedRef}.`)
  process.exit(1)
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
}

async function invoke(functionName, body) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? `HTTP ${response.status}`
    throw new Error(`${functionName} failed: ${message}`)
  }
  return payload
}

const actor = `ops-release:${process.env.CF_PAGES_COMMIT_SHA?.slice(0, 12) ?? process.env.GIT_COMMIT_SHA?.slice(0, 12) ?? 'local'}`

try {
  const binding = await invoke('configure_ops_runtime_environment', {
    p_environment: environment,
    p_project_ref: projectRef,
    p_configured_by: actor,
  })
  const backfill = await invoke('backfill_ops_case_envelope', {})
  console.log(JSON.stringify({
    environment: binding.environment,
    projectRef: binding.project_ref,
    configuredAt: binding.configured_at,
    backfill,
  }, null, 2))
} catch (error) {
  console.error(`[ops db] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
