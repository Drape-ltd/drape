#!/usr/bin/env node
import { readFileSync } from 'node:fs'

function loadEnv(path) {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/u).flatMap((line) => {
      const match = line.match(/^([^#=\s]+)=(.*)$/u)
      return match ? [[match[1], match[2].replace(/^"|"$/gu, '')]] : []
    }))
  } catch {
    return {}
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${url} failed (${response.status}): ${text.slice(0, 300)}`)
  return body
}

const manifestPath = argValue('--media')
if (!manifestPath) throw new Error('Pass --media <manifest.json>.')
const apply = process.argv.includes('--apply')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const env = { ...loadEnv('apps/web/.env.local'), ...process.env }
const baseUrl = env.STORE_DEMO_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
const serviceKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
if (!baseUrl || !serviceKey) throw new Error('Missing Supabase URL/service role.')

const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' }
const emails = [
  ...(manifest.reviewerCustomers ?? [manifest.reviewerCustomer]).filter(Boolean).map((entry) => entry.email),
  ...(manifest.tailors ?? []).map((entry) => entry.email),
]
const auth = await request(`${baseUrl}/auth/v1/admin/users?per_page=1000`, { headers })
const targets = (auth.users ?? []).filter((user) => emails.includes(user.email))

for (const user of targets) {
  if (user.user_metadata?.showcase_account !== true || user.user_metadata?.demo_account !== true) {
    throw new Error(`Refusing untagged Auth user ${user.email}.`)
  }
}

const ids = targets.map((user) => user.id)
const tailorProfiles = ids.length === 0 ? [] : await request(
  `${baseUrl}/rest/v1/tailor_profiles?select=id,user_id&user_id=in.(${ids.join(',')})`,
  { headers },
)
const tailorProfileIds = tailorProfiles.map((profile) => profile.id)
const activeStages = [
  'DRAFT', 'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED',
  'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING',
  'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION',
  'DELIVERED', 'COLLECTED', 'IN_DISPUTE',
]
const orders = ids.length === 0 ? [] : await request(
  `${baseUrl}/rest/v1/orders?select=id,reference,stage,customer_id,tailor_id&or=(customer_id.in.(${ids.join(',')}),tailor_id.in.(${ids.join(',')}))&stage=in.(${activeStages.join(',')})`,
  { headers },
)
if (orders.length > 0) {
  throw new Error(`Refusing cleanup while ${orders.length} active showcase order(s) exist. Resolve them through the product workflow first.`)
}

const plan = {
  apply,
  authUsers: targets.map((user) => ({ id: user.id, email: user.email })),
  storagePrefixes: (manifest.tailors ?? []).map((tailor) => `showcase/${tailor.key}`),
}
if (!apply) {
  console.log(JSON.stringify(plan, null, 2))
  process.exit(0)
}

async function storagePaths(prefix, depth = 0) {
  const entries = await request(`${baseUrl}/storage/v1/object/list/portfolio-photos`, {
    method: 'POST', headers, body: JSON.stringify({ prefix, limit: 1000 }),
  })
  const paths = []
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`
    if (entry.id) paths.push(path)
    else if (depth < 4) paths.push(...await storagePaths(path, depth + 1))
  }
  return paths
}

async function deleteRows(table, filter) {
  await request(`${baseUrl}/rest/v1/${table}?${filter}`, {
    method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' },
  })
}

for (const prefix of plan.storagePrefixes) {
  const paths = await storagePaths(prefix)
  if (paths.length > 0) await request(`${baseUrl}/storage/v1/object/portfolio-photos`, {
    method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths }),
  })
}

if (tailorProfileIds.length > 0) {
  await deleteRows('seller_items', `tailor_profile_id=in.(${tailorProfileIds.join(',')})`)
  await deleteRows('portfolio_photos', `tailor_profile_id=in.(${tailorProfileIds.join(',')})`)
}
if (ids.length > 0) {
  await deleteRows('tailor_pickup_details', `user_id=in.(${ids.join(',')})`)
  await deleteRows('tailor_profiles', `user_id=in.(${ids.join(',')})`)
  await deleteRows('customer_profiles', `user_id=in.(${ids.join(',')})`)
  await deleteRows('users', `id=in.(${ids.join(',')})`)
}

// Auth deletion is last, after exact tagged product rows and storage objects.
for (const user of targets) {
  await request(`${baseUrl}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers })
}

console.log(JSON.stringify({ ...plan, removed: targets.length }, null, 2))
