import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { OPS_PRODUCTION_PROJECT_REF, REQUIRED_OPS_FUNCTIONS } from './production-readiness-policy.mjs'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const wrangler = JSON.parse(await readFile(`${root}/apps/ops/wrangler.jsonc`, 'utf8'))
const anonKey = String(wrangler?.vars?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
const configuredUrl = String(wrangler?.vars?.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/u, '')
const expectedUrl = `https://${OPS_PRODUCTION_PROJECT_REF}.supabase.co`

if (!anonKey || configuredUrl !== expectedUrl) {
  console.error(`Production Ops Edge probe configuration must target ${OPS_PRODUCTION_PROJECT_REF}.`)
  process.exit(1)
}

const bodyFor = (functionName) => functionName === 'ops-health-monitor-ingest'
  ? { environment: 'PRODUCTION' }
  : { action: '__UNAUTHENTICATED_PROBE__' }

const failures = []
for (const functionName of REQUIRED_OPS_FUNCTIONS) {
  const url = `${expectedUrl}/functions/v1/${functionName}`
  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bodyFor(functionName)),
  }
  const withoutJwt = await fetch(url, options)
  const withoutIdentity = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
  })
  const responseText = (await withoutIdentity.text()).slice(0, 240)
  const cacheControl = withoutIdentity.headers.get('cache-control') ?? ''
  const result = {
    functionName,
    withoutJwt: withoutJwt.status,
    withoutWorkforceIdentity: withoutIdentity.status,
    cacheControl,
    response: responseText,
  }
  console.log(JSON.stringify(result))
  if (withoutJwt.status !== 401) failures.push(`${functionName}: request without Supabase JWT returned ${withoutJwt.status}`)
  if (withoutIdentity.status !== 401) failures.push(`${functionName}: request without workforce identity returned ${withoutIdentity.status}`)
  if (!cacheControl.includes('private') || !cacheControl.includes('no-store')) failures.push(`${functionName}: denial was cacheable`)
}

if (failures.length > 0) {
  console.error(['Production Ops Edge deny-path proof failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
  process.exit(1)
}

console.log(`Production Ops Edge deny-path proof passed for ${REQUIRED_OPS_FUNCTIONS.length} functions.`)
