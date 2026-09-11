import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const opsFunctions = [
  'ops-account-deletion-action',
  'ops-case-action',
  'ops-export-action',
  'ops-health-monitor-ingest',
  'ops-incident-action',
  'ops-money-action',
  'ops-read-gateway',
  'ops-trust-action',
  'ops-web-push-action',
  'ops-workforce-action',
]

const config = await readFile(`${root}/supabase/config.toml`, 'utf8')
const failures = []

for (const functionName of opsFunctions) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const block = config.match(new RegExp(`\\[functions\\.${escaped}\\]\\s+verify_jwt\\s*=\\s*(true|false)`, 'u'))
  if (!block || block[1] !== 'true') failures.push(`${functionName}: Supabase JWT verification must remain enabled`)
}

const callerFiles = [
  'apps/web/lib/ops-edge-broker.ts',
  'apps/ops/app/api/actions/account-deletion/route.ts',
  'apps/ops/app/api/actions/case/route.ts',
  'apps/ops/app/api/actions/incident/route.ts',
  'apps/ops/app/api/actions/trust/route.ts',
  'apps/ops/lib/export-broker.ts',
  'apps/ops/app/ops/api/actions/money/route.ts',
  'apps/ops/app/api/actions/workforce/route.ts',
]
for (const file of callerFiles) {
  const source = await readFile(`${root}/${file}`, 'utf8')
  if (!source.includes('Authorization: `Bearer ${') || !source.includes('apikey:')) {
    failures.push(`${file}: broker calls must send both Authorization and apikey`)
  }
}

for (const file of [
  'apps/ops/app/ops/api/exports/route.ts',
  'apps/ops/app/ops/api/exports/[exportRequestId]/download/route.ts',
]) {
  const source = await readFile(`${root}/${file}`, 'utf8')
  if (!source.includes('invokeOpsExportBroker(')) {
    failures.push(`${file}: Cloudflare mode must use the independently authenticated export broker`)
  }
}

const monitor = await readFile(`${root}/apps/health-monitor/src/index.mjs`, 'utf8')
for (const expected of [
  'apikey: env.SUPABASE_ANON_KEY',
  'authorization: `Bearer ${env.SUPABASE_ANON_KEY}`',
  'x-drape-monitor-secret',
]) {
  if (!monitor.includes(expected)) failures.push(`health-monitor: missing ${expected}`)
}

for (const functionName of [
  'ops-account-deletion-action',
  'ops-case-action',
  'ops-export-action',
  'ops-money-action',
  'ops-read-gateway',
  'ops-web-push-action',
  'ops-workforce-action',
]) {
  const source = await readFile(`${root}/supabase/functions/${functionName}/index.ts`, 'utf8')
  const identityCheck = source.indexOf('verifyCloudflareOpsAccess(')
  const bodyRead = source.indexOf('await request.text()')
  if (identityCheck < 0 || bodyRead < 0 || identityCheck > bodyRead) {
    failures.push(`${functionName}: workforce identity must be verified before request parsing`)
  }
}

for (const functionName of [
  'ops-account-deletion-action',
  'ops-incident-action',
  'ops-money-action',
  'ops-workforce-action',
]) {
  const source = await readFile(`${root}/supabase/functions/${functionName}/index.ts`, 'utf8')
  for (const unsafeResponse of [
    ': error.message, code: error.code',
    "return json({ error: error instanceof Error ? error.message",
  ]) {
    if (source.includes(unsafeResponse)) failures.push(`${functionName}: protected responses must not expose raw database errors`)
  }
  if (!source.includes("'rpc.failed'") && functionName !== 'ops-money-action') {
    failures.push(`${functionName}: unexpected RPC failures must be logged with a correlation ID`)
  }
  if (functionName === 'ops-money-action' && !source.includes("code ?? 'INTERNAL_ERROR'")) {
    failures.push(`${functionName}: unexpected failures must use a stable public error code`)
  }
}

const moneyExecution = await readFile(`${root}/supabase/functions/_shared/ops-money-execution.ts`, 'utf8')
for (const unsafeAdapterResponse of [
  'Refund completed but consultation finalization failed: ${error.message}',
  "error?.message ?? 'The unused fabric value refund could not be prepared.'",
  "error?.message ?? 'The payout destination request is no longer pending review.'",
  'error: decisionError.message',
  "error?.message ?? 'The reviewed payout destination correction could not be applied.'",
]) {
  if (moneyExecution.includes(unsafeAdapterResponse)) failures.push('ops-money-execution: adapter results must not expose raw database errors')
}

if (failures.length > 0) {
  console.error(['Ops Edge authentication boundary is invalid:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
  process.exit(1)
}

console.log(`Ops Edge authentication and response boundary verified for ${opsFunctions.length} functions and ${callerFiles.length + 1} callers.`)
