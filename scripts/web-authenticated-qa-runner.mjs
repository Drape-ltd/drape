#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.WEB_QA_BASE_URL ?? 'http://127.0.0.1:3000'
const outDir = process.env.WEB_QA_OUT_DIR ?? '/private/tmp/drape-web-qa'
const password = process.env.WEB_QA_PASSWORD ?? 'DrapeonWebQA2026!'
const fastAuth = process.env.WEB_QA_FAST_AUTH === '1'
const enableMutations = process.env.WEB_QA_ENABLE_MUTATIONS === '1'
const enableEmailSmoke = process.env.WEB_QA_ENABLE_EMAILS === '1'
const publicOnly = process.env.WEB_QA_PUBLIC_ONLY === '1'
const allowProdWaitlistMutation = process.env.WEB_QA_ALLOW_PROD_WAITLIST_MUTATION === '1'
const enableOpsQa = process.env.WEB_QA_ENABLE_OPS_QA !== '0'
const enableOpsProviderMutations = process.env.WEB_QA_ENABLE_OPS_PROVIDER_MUTATIONS === '1'
const enableOpsRbacMatrix = process.env.WEB_QA_ENABLE_OPS_RBAC_MATRIX !== '0'
const spawnOpsRbacRoleServers = process.env.WEB_QA_SPAWN_OPS_RBAC_SERVERS === '1'
const stamp = Date.now()
const uiEmail = `web.qa.${stamp}@drapeon.co`
const fallbackEmail = `web.qa.auth.${stamp}@drapeon.co`
const tailorEmail = `web.qa.tailor.${stamp}@drapeon.co`
const publicWaitlistEmail = process.env.WEB_QA_WAITLIST_EMAIL ?? `prod.waitlist.qa.runner.${stamp}@drapeon.co`
const phone = `+1555${String(stamp).slice(-7)}`

const accountPaths = [
  '/account/dashboard',
  '/account/explore',
  '/account/saved',
  '/account/orders',
  '/account/messages',
  '/account/measurements',
  '/account/shop',
  '/account/work',
  '/account/tailor',
  '/account/profile',
  '/account/earnings',
  '/account/payout',
  '/account/checkout',
  '/account/settings',
  '/account/support',
]

const OPS_ACTION_KINDS = [
  'seller-item-visibility',
  'dispute-status',
  'dispute-resolution',
  'bypass-review',
  'application-status',
  'verification-decision',
  'profile-change-decision',
  'payout-change-decision',
  'deletion-status',
  'review-visibility',
  'conversation-access',
  'dispatch-stage',
  'order-review-resolution',
  'order-partial-refund',
  'payout-release',
  'material-advance-release',
  'payout-block-resolution',
  'ops-issue-status',
  'manual-issue-create',
  'ops-issue-bulk-resolve',
  'support-thread-mark-read',
  'payout-bulk-release',
  'bypass-bulk-review',
]

const OPS_ROLE_ACTION_ACCESS = {
  admin: OPS_ACTION_KINDS,
  ops: [
    'seller-item-visibility',
    'application-status',
    'dispatch-stage',
    'order-partial-refund',
    'material-advance-release',
    'payout-block-resolution',
    'ops-issue-status',
    'manual-issue-create',
    'ops-issue-bulk-resolve',
    'support-thread-mark-read',
  ],
  customer_success: [
    'dispute-status',
    'dispute-resolution',
    'conversation-access',
    'order-review-resolution',
    'order-partial-refund',
    'material-advance-release',
    'payout-block-resolution',
    'ops-issue-status',
    'manual-issue-create',
    'ops-issue-bulk-resolve',
    'support-thread-mark-read',
  ],
  trust: [
    'seller-item-visibility',
    'bypass-review',
    'verification-decision',
    'profile-change-decision',
    'deletion-status',
    'review-visibility',
    'conversation-access',
    'ops-issue-status',
    'manual-issue-create',
    'ops-issue-bulk-resolve',
    'support-thread-mark-read',
    'bypass-bulk-review',
  ],
  finance: [
    'order-partial-refund',
    'payout-release',
    'payout-change-decision',
    'material-advance-release',
    'payout-block-resolution',
    'ops-issue-status',
    'manual-issue-create',
    'ops-issue-bulk-resolve',
    'payout-bulk-release',
  ],
  engineering: ['ops-issue-status', 'manual-issue-create', 'ops-issue-bulk-resolve'],
}

const OPS_ROLES = Object.keys(OPS_ROLE_ACTION_ACCESS)
const OPS_NON_ADMIN_ROLES = OPS_ROLES.filter((role) => role !== 'admin')

function loadEnv(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8')
    const env = {}
    for (const line of text.split(/\r?\n/u)) {
      const match = line.match(/^([^#=\s]+)=(.*)$/u)
      if (!match) continue
      env[match[1]] = match[2].replace(/^"|"$/gu, '').trim()
    }
    return env
  } catch {
    return {}
  }
}

const env = {
  ...loadEnv('/Users/onaopemipodimowo/drape/apps/web/.env.local'),
  ...process.env,
}
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? env.SUPABASE_ANON_KEY
const serviceRoleKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
const opsToken = process.env.WEB_QA_OPS_TOKEN ?? env.OPS_DASHBOARD_TOKEN ?? ''
const opsBootstrapRole = normalizeOpsRole(process.env.WEB_QA_OPS_ROLE ?? env.OPS_DASHBOARD_BOOTSTRAP_ROLE)
const opsRbacRoles = parseOpsRoleList(process.env.WEB_QA_OPS_RBAC_ROLES)
const opsRbacRoleBaseUrls = parseOpsRoleBaseUrls(process.env.WEB_QA_OPS_RBAC_ROLE_URLS)
const stripeQaSecretKey = process.env.WEB_QA_STRIPE_SECRET_KEY
  ?? env.WEB_QA_STRIPE_SECRET_KEY
  ?? env.STRIPE_SECRET_KEY_SANDBOX
  ?? env.STRIPE_SECRET_KEY
  ?? ''
const stripeQaDestinationAccountId = process.env.WEB_QA_STRIPE_CONNECT_ACCOUNT_ID
  ?? env.WEB_QA_STRIPE_CONNECT_ACCOUNT_ID
  ?? ''
const opsProviderMutationMode = resolveOpsProviderMutationMode()

function slug(value) {
  return value.replace(/^\//u, 'account').replace(/[^\w-]+/gu, '-').replace(/^-|-$/gu, '') || 'account'
}

function normalizeOpsRole(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().replace(/-/gu, '_') : ''
  return Object.hasOwn(OPS_ROLE_ACTION_ACCESS, normalized) ? normalized : 'admin'
}

function parseOpsRoleList(value) {
  const roles = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeOpsRole)
    .filter((role) => role !== 'admin')

  return roles.length > 0 ? [...new Set(roles)] : OPS_NON_ADMIN_ROLES
}

function parseOpsRoleBaseUrls(value) {
  const urls = new Map()
  for (const entry of (value ?? '').split(',')) {
    const [rawRole, rawUrl] = entry.split('=')
    const role = normalizeOpsRole(rawRole ?? '')
    const url = rawUrl?.trim().replace(/\/+$/u, '')
    if (role !== 'admin' && url) urls.set(role, url)
  }
  return urls
}

function isStripeTestKey(value) {
  return typeof value === 'string' && value.trim().startsWith('sk_test_')
}

function isStripeAccountId(value) {
  return typeof value === 'string' && /^acct_[A-Za-z0-9_]+$/u.test(value.trim())
}

function resolveOpsProviderMutationMode() {
  if (!enableOpsProviderMutations) return 'blocked-fixture'
  if (!isStripeTestKey(stripeQaSecretKey)) return 'provider-fixture-missing'
  if (!isStripeAccountId(stripeQaDestinationAccountId)) return 'provider-fixture-missing'
  return 'stripe-test-provider'
}

function opsTokenStatus(value) {
  const token = typeof value === 'string' ? value.trim() : ''
  const normalized = token.toLowerCase()
  if (!token) return 'missing'
  if (
    token.length < 32 ||
    normalized === 'your_internal_ops_token_here' ||
    normalized.includes('change_me') ||
    normalized.includes('changeme') ||
    normalized.includes('password')
  ) {
    return 'weak'
  }
  return 'ready'
}

function hashOpsToken(value) {
  return createHash('sha256').update(value).digest('hex')
}

function opsCookieForToken(value) {
  return `drape_ops_session=${hashOpsToken(value.trim())}`
}

function encodeForm(fields) {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const entry of value) form.append(key, String(entry))
      continue
    }
    form.set(key, String(value))
  }
  return form
}

async function postLocalFormToBase(targetBaseUrl, pathname, fields, cookie, label) {
  const normalizedBaseUrl = targetBaseUrl.replace(/\/+$/u, '')
  const response = await fetch(`${normalizedBaseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: encodeForm(fields),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })

  const text = await response.text().catch(() => '')
  const location = response.headers.get('location') ?? ''
  return {
    label,
    baseUrl: normalizedBaseUrl,
    status: response.status,
    location,
    setCookie: response.headers.get('set-cookie') ?? '',
    body: text.slice(0, 1000),
  }
}

async function postLocalForm(pathname, fields, cookie, label) {
  return postLocalFormToBase(baseUrl, pathname, fields, cookie, label)
}

function redirectSearch(result) {
  try {
    return new URL(result.location || '/', result.baseUrl ?? baseUrl).searchParams
  } catch {
    return new URL('/', result.baseUrl ?? baseUrl).searchParams
  }
}

function assertOpsRedirect(result, key, expectedValues = []) {
  if (![302, 303, 307, 308].includes(result.status)) {
    throw new Error(`${result.label} did not redirect from /ops/action: ${result.status} ${result.body}`)
  }
  const params = redirectSearch(result)
  const actual = params.get(key)
  if (!actual) {
    throw new Error(`${result.label} redirect did not include ${key}: ${result.location}`)
  }
  if (expectedValues.length > 0 && !expectedValues.includes(actual)) {
    throw new Error(`${result.label} expected ${key}=${expectedValues.join('/')} but got ${actual}: ${result.location}`)
  }
  return {
    redirectStatus: result.status,
    [key]: actual,
    location: result.location,
  }
}

function assertOpsRedirectOutcome(result, expected) {
  if (![302, 303, 307, 308].includes(result.status)) {
    throw new Error(`${result.label} did not redirect from /ops/action: ${result.status} ${result.body}`)
  }
  const params = redirectSearch(result)
  const notice = params.get('notice')
  const error = params.get('error')
  const matched =
    (notice && (expected.notice ?? []).includes(notice)) ||
    (error && (expected.error ?? []).includes(error))

  if (!matched) {
    throw new Error(`${result.label} redirected with unexpected outcome notice=${notice ?? 'null'} error=${error ?? 'null'}: ${result.location}`)
  }

  return {
    redirectStatus: result.status,
    notice,
    error,
    location: result.location,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function opsRbacPortForRole(role, index) {
  const base = Number.parseInt(process.env.WEB_QA_OPS_RBAC_PORT_BASE ?? '3300', 10)
  const offset = Number.isFinite(base) && base > 0 ? base : 3300
  return offset + index
}

async function waitForHttpReady(targetBaseUrl, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${targetBaseUrl}/ops`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      })
      if (response.status < 500) return { ready: true }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(1_000)
  }

  return { ready: false, error: lastError || 'timeout' }
}

async function startOpsRoleServer(role, index) {
  const port = opsRbacPortForRole(role, index)
  const targetBaseUrl = `http://127.0.0.1:${port}`
  const logs = []
  const child = spawn('pnpm', ['--filter', '@drape/web', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPS_DASHBOARD_TOKEN: opsToken,
      OPS_DASHBOARD_BOOTSTRAP_ROLE: role,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (chunk) => {
    logs.push(chunk.toString())
    if (logs.length > 40) logs.shift()
  })
  child.stderr?.on('data', (chunk) => {
    logs.push(chunk.toString())
    if (logs.length > 40) logs.shift()
  })

  const ready = await waitForHttpReady(targetBaseUrl)
  if (!ready.ready) {
    child.kill('SIGTERM')
    throw new Error(`Ops RBAC ${role} server did not become ready on ${targetBaseUrl}: ${ready.error}. ${logs.join('').slice(-1600)}`)
  }

  return {
    role,
    baseUrl: targetBaseUrl,
    logs,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(5_000).then(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }),
      ])
    },
  }
}

async function fetchJson(url, options, label) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Keep raw body for diagnostics.
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

async function upsertRest(table, body, onConflict) {
  return fetchJson(
    `${supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    },
    `Upsert ${table}`,
  )
}

async function insertRest(table, body, label) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for fixture insert.')
  }
  return fetchJson(
    `${supabaseUrl}/rest/v1/${table}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    },
    label,
  )
}

async function patchRest(table, query, body, label) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for fixture update.')
  }
  return fetchJson(
    `${supabaseUrl}/rest/v1/${table}?${query}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    },
    label,
  )
}

async function selectRest(table, query, label) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for fixture lookup.')
  }
  return fetchJson(
    `${supabaseUrl}/rest/v1/${table}?${query}`,
    {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    },
    label,
  )
}

async function deleteRest(table, query, label) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for fixture cleanup.')
  }
  return fetchJson(
    `${supabaseUrl}/rest/v1/${table}?${query}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        prefer: 'return=minimal',
      },
    },
    label,
  )
}

async function rpcRest(functionName, body, label) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for fixture RPC.')
  }
  return fetchJson(
    `${supabaseUrl}/rest/v1/rpc/${functionName}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    label,
  )
}

async function selectFirstRest(table, query, label) {
  const rows = await selectRest(table, query, label)
  return Array.isArray(rows) ? rows[0] ?? null : null
}

function rememberFixtureId(fixture, key, id) {
  if (!fixture || !id) return
  if (!Array.isArray(fixture[key])) fixture[key] = []
  fixture[key].push(id)
}

async function invokeEdgeFunction(functionName, accessToken, body, label) {
  if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase URL or anon key for Edge Function smoke.')
  if (!accessToken) throw new Error('Missing authenticated access token for Edge Function smoke.')
  return fetchJson(
    `${supabaseUrl}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    label,
  )
}

async function invokeEdgeFunctionRaw(functionName, accessToken, body) {
  if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase URL or anon key for Edge Function smoke.')
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let bodyJson = text
  try {
    bodyJson = text ? JSON.parse(text) : null
  } catch {
    // Keep raw body for diagnostics.
  }
  return { ok: response.ok, status: response.status, body: bodyJson }
}

function responseSummary(result) {
  const body = result?.body && typeof result.body === 'object' && !Array.isArray(result.body)
    ? result.body
    : {}
  return {
    httpStatus: result?.status ?? null,
    code: typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : null,
    reason: typeof body.reason === 'string' ? body.reason : null,
    field: typeof body.field === 'string' ? body.field : null,
    message: typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : typeof result?.body === 'string'
          ? result.body.slice(0, 240)
          : null,
  }
}

function assertExpectedRejection(result, { statuses = [400], codes = [], textIncludes = [] } = {}) {
  if (result.ok) throw new Error(`Expected rejection, got ${result.status}`)
  if (statuses.length > 0 && !statuses.includes(result.status)) {
    throw new Error(`Expected status ${statuses.join('/')} rejection, got ${result.status}: ${JSON.stringify(result.body)}`)
  }
  const summary = responseSummary(result)
  if (codes.length > 0 && !codes.some((code) => [summary.code, summary.reason, summary.field].includes(code))) {
    throw new Error(`Expected rejection code ${codes.join('/')} got ${JSON.stringify(summary)}`)
  }
  const haystack = JSON.stringify(result.body ?? '')
  if (textIncludes.length > 0 && !textIncludes.some((text) => haystack.includes(text))) {
    throw new Error(`Expected rejection text ${textIncludes.join('/')} got ${haystack.slice(0, 400)}`)
  }
  return summary
}

function assertQaFixtureAllowed() {
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error('Missing Supabase URL, anon key, or service role key for disposable QA fixtures.')
  }
  if (new URL(supabaseUrl).hostname.startsWith('wkfsrunetmgjdtcurmoj')) {
    throw new Error('Refusing to create disposable QA fixtures on the production Supabase project.')
  }
}

async function createConfirmedAuthUser(email, displayName, role) {
  assertQaFixtureAllowed()
  const created = await fetchJson(
    `${supabaseUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          role,
        },
      }),
    },
    `Create confirmed ${role.toLowerCase()} auth user`,
  )
  const userId = created?.id
  if (!userId) throw new Error('Supabase did not return an auth user id.')
  return { email, userId }
}

async function deleteAuthUser(userId) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for auth cleanup.')
  }
  return fetchJson(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    },
    'Delete disposable auth user',
  )
}

async function createConfirmedCustomer(email) {
  const { userId } = await createConfirmedAuthUser(email, 'Web QA Customer', 'CUSTOMER', phone)

  const now = new Date().toISOString()
  await upsertRest('users', {
    id: userId,
    email,
    display_name: 'Web QA Customer',
    role: 'CUSTOMER',
    default_currency: 'USD',
    currency_source: 'USER_SELECTED',
    region_code: 'US',
    currency_confirmed_at: now,
    updated_at: now,
  }, 'id')

  await upsertRest('customer_profiles', {
    user_id: userId,
    display_name: 'Web QA Customer',
    unit_preference: 'in',
    garment_context: 'MENSWEAR',
    measurements: {
      unit: 'in',
      garmentContext: 'MENSWEAR',
      fitFlags: [],
    },
    updated_at: now,
  }, 'user_id')

  return { email, userId }
}

async function createDisposableQaFixtures() {
  assertQaFixtureAllowed()

  const fixture = {
    tailorEmail,
    tailorUserId: null,
    tailorAccessToken: null,
    tailorProfileId: null,
    sellerItemId: null,
    portfolioItemIds: [],
    orderIds: [],
    readyMadeReservations: [],
    contactBypassLogIds: [],
    tailorApplicationIds: [],
    deletionRequestIds: [],
    opsIssueIds: [],
    materialAdvanceIds: [],
    providerPaymentIds: [],
    verificationTailors: [],
  }

  try {
    const { userId: tailorUserId } = await createConfirmedAuthUser(tailorEmail, 'Web QA Tailor', 'TAILOR')
    fixture.tailorUserId = tailorUserId
    const now = new Date().toISOString()

    await upsertRest('users', {
      id: tailorUserId,
      email: tailorEmail,
      display_name: 'Web QA Tailor',
      role: 'TAILOR',
      default_currency: 'USD',
      currency_source: 'USER_SELECTED',
      region_code: 'US',
      currency_confirmed_at: now,
      updated_at: now,
    }, 'id')

    const profileRows = await upsertRest('tailor_profiles', {
      user_id: tailorUserId,
      display_name: 'Web QA Tailor',
      business_name: `Web QA Tailor ${String(stamp).slice(-6)}`,
      bio: 'Disposable web authenticated QA tailor fixture.',
      location: 'Chicago, IL',
      languages: ['English'],
      specialty_tags: ['QA fixture', 'Alterations'],
      price_range_min: 5000,
      price_range_max: 25000,
      currency: 'USD',
      payout_currency: 'USD',
      payout_provider: 'STRIPE',
      payout_account_type: 'STRIPE_CONNECT',
      payout_account_verified: true,
      payout_reverification_required: false,
      stripe_account_id: 'acct_web_qa_fixture',
      stripe_connect_account_id: 'acct_web_qa_fixture',
      tier: 'VERIFIED',
      availability: 'OPEN',
      is_verified: true,
      is_live: true,
      supports_custom_orders: true,
      supports_ready_made: true,
      pickup_available: true,
      delivery_available: true,
      shipping_available: true,
      delivery_fee: 1200,
      shipping_fee: 1800,
      portfolio_photo_urls: [],
      portfolio_video_urls: [],
      avatar_url: 'https://drapeon.co/logo.png',
      trust_verification_video_path: `verification-video/${tailorUserId}/challenge_profile-work-payments_${stamp}.mp4`,
      trust_verification_challenge_id: 'profile-work-payments',
      trust_verification_challenge_text: 'Say your name, confirm this profile and work are yours, then turn your head gently to the right and back.',
      id_verification_method: 'CHALLENGE_VIDEO',
      id_verification_status: 'VERIFIED',
      profile_completed: true,
      updated_at: now,
    }, 'user_id')

    const tailorProfileId = Array.isArray(profileRows) ? profileRows[0]?.id : null
    if (!tailorProfileId) throw new Error('Disposable tailor profile was not created.')
    fixture.tailorProfileId = tailorProfileId

    const portfolioRows = await insertRest('portfolio_items', {
      tailor_profile_id: tailorProfileId,
      image_url: 'https://drapeon.co/logo.png',
      title: 'Web QA portfolio proof',
      description: 'Disposable portfolio proof for trust verification QA.',
      category: null,
      sort_order: 0,
    }, 'Insert disposable portfolio proof')
    const portfolioItemId = Array.isArray(portfolioRows) ? portfolioRows[0]?.id : null
    if (!portfolioItemId) throw new Error('Disposable portfolio proof was not created.')
    rememberFixtureId(fixture, 'portfolioItemIds', portfolioItemId)
    await patchRest(
      'tailor_profiles',
      `id=eq.${encodeURIComponent(tailorProfileId)}`,
      { portfolio_photo_urls: ['https://drapeon.co/logo.png'] },
      'Seed disposable verification portfolio summary',
    )

    await upsertRest('tailor_pickup_details', {
      user_id: tailorUserId,
      pickup_address: '123 QA Studio Ave, Chicago, IL',
      pickup_instructions: 'Disposable QA pickup fixture.',
      updated_at: now,
    }, 'user_id')

    const itemRows = await insertRest('seller_items', {
      tailor_profile_id: tailorProfileId,
      title: `Web QA Ready-made ${String(stamp).slice(-6)}`,
      description: 'Disposable ready-made item used by the authenticated web QA runner.',
      category: 'Kaftan',
      sizes: ['M'],
      size_inventory: { M: 3 },
      price_amount: 8900,
      currency: 'USD',
      photo_urls: [],
      is_ready_made: true,
      is_live: true,
      stock_status: 'IN_STOCK',
      inventory_quantity: 3,
      pickup_available: true,
      delivery_available: true,
      shipping_available: true,
      updated_at: now,
    }, 'Insert disposable seller item')

    const sellerItemId = Array.isArray(itemRows) ? itemRows[0]?.id : null
    if (!sellerItemId) throw new Error('Disposable seller item was not created.')
    fixture.sellerItemId = sellerItemId

    const tailorSession = await verifyPasswordSession(tailorEmail)
    if (!tailorSession.ok || !tailorSession.accessToken) {
      throw new Error(tailorSession.error ?? 'Disposable tailor auth session could not be created.')
    }
    fixture.tailorAccessToken = tailorSession.accessToken

    return fixture
  } catch (error) {
    await cleanupDisposableQaFixtures(fixture).catch(() => null)
    throw error
  }
}

async function createDisposableVerificationTailor(fixture, decisionLabel) {
  const email = `web.qa.verification.${decisionLabel}.${stamp}@drapeon.co`
  const displayName = `Web QA Verification ${decisionLabel}`
  const fixturePhone = `+1556${decisionLabel === 'approval' ? '1' : '2'}${String(stamp).slice(-6)}`
  const { userId } = await createConfirmedAuthUser(email, displayName, 'TAILOR')
  const now = new Date().toISOString()

  await upsertRest('users', {
    id: userId,
    email,
    phone: fixturePhone,
    display_name: displayName,
    role: 'TAILOR',
    default_currency: 'USD',
    currency_source: 'USER_SELECTED',
    region_code: 'US',
    currency_confirmed_at: now,
    updated_at: now,
  }, 'id')

  const profileRows = await upsertRest('tailor_profiles', {
    user_id: userId,
    display_name: displayName,
    business_name: `${displayName} Studio`,
    bio: 'Disposable pending trust-review fixture.',
    location: 'Chicago, IL',
    languages: ['English'],
    specialty_tags: ['Alterations'],
    price_range_min: 5000,
    price_range_max: 25000,
    currency: 'USD',
    tier: 'VERIFIED',
    availability: 'OPEN',
    is_verified: false,
    is_live: false,
    supports_custom_orders: true,
    supports_ready_made: false,
    pickup_available: true,
    delivery_available: false,
    shipping_available: false,
    portfolio_photo_urls: ['https://drapeon.co/logo.png'],
    portfolio_video_urls: [],
    avatar_url: 'https://drapeon.co/logo.png',
    trust_verification_video_path: `verification-video/${userId}/challenge_profile-work-payments_${stamp}.mp4`,
    trust_verification_challenge_id: 'profile-work-payments',
    trust_verification_challenge_text: 'Say your name, confirm this profile and work are yours, then turn your head gently to the right and back.',
    id_verification_method: 'CHALLENGE_VIDEO',
    id_verification_status: 'PENDING',
    profile_completed: true,
    updated_at: now,
  }, 'user_id')

  const profileId = Array.isArray(profileRows) ? profileRows[0]?.id : null
  if (!profileId) throw new Error(`Disposable ${decisionLabel} verification profile was not created.`)

  const portfolioRows = await insertRest('portfolio_items', {
    tailor_profile_id: profileId,
    image_url: 'https://drapeon.co/logo.png',
    title: `${displayName} portfolio proof`,
    description: 'Disposable portfolio proof for trust verification QA.',
    category: null,
    sort_order: 0,
  }, `Insert disposable ${decisionLabel} verification portfolio proof`)
  const portfolioItemId = Array.isArray(portfolioRows) ? portfolioRows[0]?.id : null
  if (!portfolioItemId) throw new Error(`Disposable ${decisionLabel} verification portfolio proof was not created.`)

  rememberFixtureId(fixture, 'portfolioItemIds', portfolioItemId)
  fixture.verificationTailors.push({ userId, profileId, email })
  return { userId, profileId, email }
}

function qaReference(prefix) {
  return `${prefix}-${stamp.toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`
}

function buildCustomBriefPreflightPayload(tailorProfileId, overrides = {}) {
  const future = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString()
  return {
    action: 'preflight-create-order',
    tailorProfileId,
    garmentType: 'Agbada',
    garmentTypeOther: null,
    genderPresentation: 'Unisex',
    description: 'Authenticated web QA preflight for a custom agbada with a relaxed silhouette, deep green fabric, and event-ready finishing. This should validate without creating an order.',
    occasion: 'QA event',
    deadline: future,
    referencePhotos: [],
    referencePhotoCount: 0,
    styleReferenceLinks: ['https://www.pinterest.com/pin/123456789/'],
    styleNotes: 'Use this as a non-mutating preflight only.',
    customerMeasurementsSnapshot: null,
    fitNote: 'Please confirm measurements before quoting this QA dry run.',
    bodyNote: 'Please confirm measurements before quoting this QA dry run.',
    fabricSource: 'TAILOR_SOURCES',
    fabricDescription: 'Medium-weight cotton blend in deep green with a smooth finish.',
    fabricBudgetAmount: null,
    fabricBudgetCurrency: null,
    fabricSourcingDeadlineDays: 5,
    supportMeta: {
      source: 'web-authenticated-qa-runner',
      wearerContext: {
        mode: 'SELF',
        label: 'Web QA Customer',
        measurementProfileLabel: 'Tailor follow-up needed',
        relationship: 'BUYER',
        selectedAt: new Date().toISOString(),
      },
      measurementFallback: { requiredBeforeQuote: true, note: 'Please confirm measurements before quoting this QA dry run.' },
      fabricPolicy: { approvalRequiredForTailorSourcing: true },
    },
    deliveryMethod: 'LOCAL_COLLECTION',
    shippingPreference: null,
    deliveryInstructions: null,
    deliveryAddress: null,
    deliveryCity: null,
    deliveryRegion: null,
    deliveryPostalCode: null,
    deliveryCountryCode: null,
    recipientName: null,
    recipientPhone: null,
    cancellationPolicyAcknowledged: true,
    ...overrides,
  }
}

async function createDisposableCustomOrder(fixture, customerUserId, stage, overrides = {}) {
  if (!fixture?.tailorUserId || !fixture?.tailorProfileId) {
    throw new Error('Disposable tailor fixture is not available.')
  }
  if (!customerUserId) throw new Error('Customer user id is not available for disposable order creation.')

  const now = new Date().toISOString()
  const rows = await insertRest('orders', {
    customer_id: customerUserId,
    tailor_profile_id: fixture.tailorProfileId,
    tailor_id: fixture.tailorUserId,
    reference: qaReference('QA-CUSTOM'),
    order_kind: 'CUSTOM',
    garment_type: 'QA kaftan',
    garment_description: 'Disposable QA custom order.',
    occasion: 'QA smoke',
    fabric_source: 'TAILOR_SOURCES',
    delivery_method: 'LOCAL_COLLECTION',
    currency: 'USD',
    quoted_currency: 'USD',
    stage,
    stage_updated_at: now,
    special_note: '{"webQaFixture":true}',
    deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }, `Insert disposable custom order ${stage}`)

  const order = Array.isArray(rows) ? rows[0] : null
  if (!order?.id) throw new Error(`Disposable ${stage} order was not created.`)
  fixture.orderIds.push(order.id)
  return order
}

async function createDisposableOpsIssue(fixture, overrides = {}) {
  const rows = await insertRest('ops_issues', {
    issue_type: 'SYSTEM_ALERT',
    severity: 'LOW',
    status: 'OPEN',
    source: 'web-authenticated-qa-runner',
    actor_id: 'web-authenticated-qa-runner',
    actor_role: 'SYSTEM',
    title: `Web QA ops issue ${stamp}`,
    description: 'Disposable workflow issue created by the web authenticated QA runner.',
    recommended_action: 'Verify ops action handling, then let cleanup remove this fixture.',
    dedupe_key: `web-authenticated-qa-runner:${stamp}:${randomUUID()}`,
    metadata: { webQaFixture: true, stamp },
    last_seen_at: new Date().toISOString(),
    ...overrides,
  }, 'Insert disposable ops issue')

  const issue = Array.isArray(rows) ? rows[0] : null
  if (!issue?.id) throw new Error('Disposable ops issue was not created.')
  rememberFixtureId(fixture, 'opsIssueIds', issue.id)
  return issue
}

async function createDisposableContactBypassLog(fixture, userId) {
  const rows = await insertRest('contact_bypass_logs', {
    id: randomUUID(),
    user_id: userId,
    surface: 'web-authenticated-qa-runner',
    content: 'Call me at +15555550123 from this disposable QA log.',
    attempt: 1,
    reviewed: false,
  }, 'Insert disposable contact bypass log')

  const log = Array.isArray(rows) ? rows[0] : null
  if (!log?.id) throw new Error('Disposable contact bypass log was not created.')
  rememberFixtureId(fixture, 'contactBypassLogIds', log.id)
  return log
}

async function createDisposableTailorApplication(fixture) {
  const rows = await insertRest('tailor_applications', {
    business_name: `Web QA Application ${stamp}`,
    display_name: 'Web QA Applicant',
    email: `web.qa.application.${stamp}.${randomUUID().slice(0, 8)}@drapeon.co`,
    location: 'Chicago, IL',
    specialty: 'QA tailoring',
    portfolio_url: 'https://example.com/web-qa-portfolio',
    instagram_url: null,
    notes: 'Disposable tailor application for ops QA.',
    source: 'WEB_QA',
    status: 'PENDING',
  }, 'Insert disposable tailor application')

  const application = Array.isArray(rows) ? rows[0] : null
  if (!application?.id) throw new Error('Disposable tailor application was not created.')
  rememberFixtureId(fixture, 'tailorApplicationIds', application.id)
  return application
}

async function createDisposableDeletionRequest(fixture, userId, email) {
  const rows = await insertRest('account_deletion_requests', {
    user_id: userId,
    email,
    role: 'TAILOR',
    status: 'PENDING',
    reason: 'Disposable account deletion request for ops QA.',
    metadata: { webQaFixture: true, stamp },
  }, 'Insert disposable account deletion request')

  const request = Array.isArray(rows) ? rows[0] : null
  if (!request?.id) throw new Error('Disposable account deletion request was not created.')
  rememberFixtureId(fixture, 'deletionRequestIds', request.id)
  return request
}

async function createDisposableReview(fixture, customerUserId) {
  const order = await createDisposableCustomOrder(disposableQaFromFixture(fixture), customerUserId, 'COMPLETE', {
    quoted_amount: 12500,
    total_amount: 12500,
    subtotal_amount: 12500,
  })
  const rows = await insertRest('reviews', {
    order_id: order.id,
    tailor_profile_id: fixture.tailorProfileId,
    tailor_id: fixture.tailorUserId,
    rating: 4,
    body: 'Disposable held review for ops QA.',
    reviewer_name: 'Web QA Customer',
    flagged: true,
    published_at: null,
    tags: ['QA'],
  }, 'Insert disposable review')

  const review = Array.isArray(rows) ? rows[0] : null
  if (!review?.id) throw new Error('Disposable review was not created.')
  return { review, order }
}

function disposableQaFromFixture(fixture) {
  return fixture
}

async function createDisposableDispute(fixture, customerUserId, status = 'OPEN') {
  const order = await createDisposableCustomOrder(fixture, customerUserId, 'IN_DISPUTE', {
    quoted_amount: 12500,
    total_amount: 12500,
    subtotal_amount: 12500,
  })
  const now = new Date().toISOString()
  const rows = await insertRest('disputes', {
    order_id: order.id,
    customer_id: customerUserId,
    reason: 'QA_DISPUTE',
    description: 'Disposable dispute created by the web authenticated QA runner.',
    evidence_urls: [],
    status,
    updated_at: now,
  }, 'Insert disposable dispute')

  const dispute = Array.isArray(rows) ? rows[0] : null
  if (!dispute?.id) throw new Error('Disposable dispute was not created.')
  return { dispute, order }
}

async function createDisposableOrderPayment(fixture, orderId, overrides = {}) {
  const now = new Date().toISOString()
  const rows = await insertRest('order_payments', {
    order_id: orderId,
    phase: 'INITIAL_ORDER',
    provider: 'PAYSTACK',
    currency: 'NGN',
    amount: 12500,
    status: 'SUCCEEDED',
    idempotency_key: qaReference('QA-PAYMENT'),
    provider_payment_id: `web-qa-payment-${stamp}-${randomUUID().slice(0, 8)}`,
    provider_checkout_url: null,
    provider_response: { webQaFixture: true, stamp },
    refunded_amount: 0,
    confirmed_at: now,
    ...overrides,
  }, 'Insert disposable order payment')

  const payment = Array.isArray(rows) ? rows[0] : null
  if (!payment?.id) throw new Error('Disposable order payment was not created.')
  return payment
}

async function createStripeTestPaymentIntent(amount, currency, description) {
  if (!isStripeTestKey(stripeQaSecretKey)) {
    throw new Error('WEB_QA_STRIPE_SECRET_KEY/STRIPE_SECRET_KEY_SANDBOX must be a sk_test_ key for provider mutation QA.')
  }

  const body = new URLSearchParams()
  body.set('amount', String(amount))
  body.set('currency', currency.toLowerCase())
  body.set('payment_method', 'pm_card_visa')
  body.set('confirm', 'true')
  body.append('payment_method_types[]', 'card')
  body.set('description', description)
  body.set('metadata[web_qa_fixture]', 'true')
  body.set('metadata[stamp]', String(stamp))

  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeQaSecretKey.trim()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `web-qa-payment-intent-${stamp}-${randomUUID()}`,
    },
    body,
    signal: AbortSignal.timeout(20_000),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.status !== 'succeeded' || typeof payload?.id !== 'string') {
    throw new Error(`Stripe test PaymentIntent did not succeed: ${response.status} ${JSON.stringify(payload).slice(0, 500)}`)
  }

  return payload
}

async function createDisposableRefundOrder(fixture, customerUserId, { providerBacked = false } = {}) {
  const order = await createDisposableCustomOrder(fixture, customerUserId, 'COMPLETE', {
    quoted_amount: 12500,
    total_amount: 12500,
    subtotal_amount: 12500,
    source_currency: providerBacked ? 'USD' : 'NGN',
    source_amount: 12500,
    tailor_payout_currency_locked: providerBacked ? 'USD' : 'NGN',
    tailor_payout_provider_locked: providerBacked ? 'STRIPE' : 'PAYSTACK',
  })
  let providerPaymentId = null
  if (providerBacked) {
    const intent = await createStripeTestPaymentIntent(12500, 'USD', `Drape web QA refundable order ${order.reference}`)
    providerPaymentId = intent.id
    rememberFixtureId(fixture, 'providerPaymentIds', intent.id)
  }

  const payment = await createDisposableOrderPayment(fixture, order.id, {
    provider: providerBacked ? 'STRIPE' : 'PAYSTACK',
    currency: providerBacked ? 'USD' : 'NGN',
    amount: 12500,
    provider_payment_id: providerBacked ? providerPaymentId : null,
  })
  return { order, payment, providerPaymentId }
}

async function createDisposablePayoutReadyOrder(fixture, customerUserId, { providerBacked = false, mismatch = false, stage = 'COMPLETE' } = {}) {
  const confirmedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  const currency = providerBacked ? 'USD' : 'NGN'
  const provider = providerBacked ? 'STRIPE' : 'PAYSTACK'
  const order = await createDisposableCustomOrder(fixture, customerUserId, stage, {
    quoted_amount: 12500,
    total_amount: 12500,
    subtotal_amount: 12500,
    source_currency: currency,
    source_amount: 12500,
    tailor_payout_currency_locked: mismatch ? 'USD' : currency,
    tailor_payout_provider_locked: mismatch ? 'STRIPE' : provider,
    tailor_stripe_connect_account_id_locked: providerBacked ? stripeQaDestinationAccountId.trim() : null,
    tailor_paystack_recipient_code_locked: null,
    escrow_released: false,
    handoff_completed_at: confirmedAt,
    customer_handoff_confirmed_at: confirmedAt,
    handoff_confirmation_source: 'CUSTOMER_COMPLETE',
  })
  const payment = await createDisposableOrderPayment(fixture, order.id, {
    provider,
    currency,
    amount: 12500,
    provider_payment_id: providerBacked ? `web-qa-settled-${stamp}-${randomUUID().slice(0, 8)}` : `web-qa-paystack-${stamp}-${randomUUID().slice(0, 8)}`,
  })
  return { order, payment }
}

async function createDisposableMaterialAdvance(fixture, customerUserId, options = {}) {
  const {
    paid = false,
    providerBacked = false,
  } = options
  const currency = providerBacked ? 'USD' : 'NGN'
  const order = await createDisposableCustomOrder(fixture, customerUserId, 'SOURCING', {
    quoted_amount: 12500,
    total_amount: 12500,
    subtotal_amount: 12500,
    currency,
    quoted_currency: currency,
    source_currency: currency,
    source_amount: 12500,
  })
  let payment = null
  if (paid) {
    payment = await createDisposableOrderPayment(fixture, order.id, {
      phase: 'MATERIAL_ADVANCE',
      provider: providerBacked ? 'STRIPE' : 'PAYSTACK',
      currency,
      amount: 2500,
      provider_payment_id: providerBacked ? `web-qa-material-${stamp}-${randomUUID().slice(0, 8)}` : `web-qa-material-paystack-${stamp}-${randomUUID().slice(0, 8)}`,
    })
  }
  const rows = await insertRest('order_material_advances', {
    order_id: order.id,
    customer_id: customerUserId,
    tailor_id: fixture.tailorUserId,
    requested_by: fixture.tailorUserId,
    title: 'Web QA material advance',
    description: 'Disposable material advance fixture used by the ops QA runner.',
    amount: 2500,
    currency,
    status: paid ? 'OPS_REVIEW' : 'REQUESTED',
    release_status: paid ? 'OPS_REVIEW' : 'NOT_REQUESTED',
    payment_provider: paid ? (providerBacked ? 'STRIPE' : 'PAYSTACK') : null,
    provider_payment_id: paid ? payment?.provider_payment_id ?? null : null,
    payment_id: paid ? payment?.id ?? null : null,
    paid_at: paid ? new Date().toISOString() : null,
    release_requested_at: paid ? new Date().toISOString() : null,
  }, 'Insert disposable material advance')

  const advance = Array.isArray(rows) ? rows[0] : null
  if (!advance?.id) throw new Error('Disposable material advance was not created.')
  rememberFixtureId(fixture, 'materialAdvanceIds', advance.id)
  return { advance, order, payment }
}

async function cleanupDisposableQaFixtures(fixture) {
  if (!fixture) return { skipped: true }

  const cleanupErrors = []
  async function attempt(label, fn) {
    try {
      await fn()
    } catch (error) {
      cleanupErrors.push({ label, error: error instanceof Error ? error.message : String(error) })
    }
  }

  for (const reservation of fixture.readyMadeReservations ?? []) {
    await attempt(`release inventory ${reservation.orderId}`, () => rpcRest('release_seller_item_inventory', {
      target_item_id: reservation.sellerItemId,
      released_quantity: reservation.quantity,
      released_size: reservation.size,
    }, 'Release disposable ready-made inventory'))
  }

  const orderIds = [...new Set(fixture.orderIds ?? [])]
  if (orderIds.length > 0) {
    const orderFilter = `order_id=in.(${orderIds.join(',')})`
    for (const table of [
      'messages',
      'order_stage_updates',
      'order_photos',
      'custom_order_details',
      'order_production_evidence',
      'order_material_advances',
      'order_handoff_issues',
      'payouts',
      'order_payments',
      'reviews',
      'disputes',
      'audit_logs',
    ]) {
      await attempt(`delete ${table}`, () => deleteRest(table, orderFilter, `Delete disposable ${table}`))
    }
    await attempt('delete order-linked ops issues', () => deleteRest('ops_issues', `order_id=in.(${orderIds.join(',')})`, 'Delete disposable order-linked ops issues'))
    await attempt('delete orders', () => deleteRest('orders', `id=in.(${orderIds.join(',')})`, 'Delete disposable orders'))
  }

  const materialAdvanceIds = [...new Set(fixture.materialAdvanceIds ?? [])]
  if (materialAdvanceIds.length > 0) {
    await attempt('delete material advance ops issues', () => deleteRest('ops_issues', `related_entity_id=in.(${materialAdvanceIds.join(',')})`, 'Delete disposable material advance ops issues'))
    await attempt('delete material advances', () => deleteRest('order_material_advances', `id=in.(${materialAdvanceIds.join(',')})`, 'Delete disposable material advances'))
  }

  const opsIssueIds = [...new Set(fixture.opsIssueIds ?? [])]
  if (opsIssueIds.length > 0) {
    await attempt('delete ops issues', () => deleteRest('ops_issues', `id=in.(${opsIssueIds.join(',')})`, 'Delete disposable ops issues'))
  }

  const contactBypassLogIds = [...new Set(fixture.contactBypassLogIds ?? [])]
  if (contactBypassLogIds.length > 0) {
    await attempt('delete contact bypass logs', () => deleteRest('contact_bypass_logs', `id=in.(${contactBypassLogIds.join(',')})`, 'Delete disposable contact bypass logs'))
  }

  const deletionRequestIds = [...new Set(fixture.deletionRequestIds ?? [])]
  if (deletionRequestIds.length > 0) {
    await attempt('delete account deletion requests', () => deleteRest('account_deletion_requests', `id=in.(${deletionRequestIds.join(',')})`, 'Delete disposable account deletion requests'))
  }

  const tailorApplicationIds = [...new Set(fixture.tailorApplicationIds ?? [])]
  if (tailorApplicationIds.length > 0) {
    await attempt('delete tailor applications', () => deleteRest('tailor_applications', `id=in.(${tailorApplicationIds.join(',')})`, 'Delete disposable tailor applications'))
  }

  if (fixture.sellerItemId) {
    await attempt('delete seller item', () => deleteRest('seller_items', `id=eq.${fixture.sellerItemId}`, 'Delete disposable seller item'))
  }
  const portfolioItemIds = [...new Set(fixture.portfolioItemIds ?? [])]
  if (portfolioItemIds.length > 0) {
    await attempt('delete portfolio items', () => deleteRest('portfolio_items', `id=in.(${portfolioItemIds.join(',')})`, 'Delete disposable portfolio items'))
  }
  if (fixture.tailorUserId) {
    await attempt('delete pickup details', () => deleteRest('tailor_pickup_details', `user_id=eq.${fixture.tailorUserId}`, 'Delete disposable pickup details'))
  }
  for (const verificationTailor of fixture.verificationTailors ?? []) {
    await attempt(
      `delete verification profile ${verificationTailor.profileId}`,
      () => deleteRest('tailor_profiles', `id=eq.${verificationTailor.profileId}`, 'Delete disposable verification profile'),
    )
    await attempt(
      `delete verification public user ${verificationTailor.userId}`,
      () => deleteRest('users', `id=eq.${verificationTailor.userId}`, 'Delete disposable verification public user'),
    )
    await attempt(
      `delete verification auth user ${verificationTailor.userId}`,
      () => deleteAuthUser(verificationTailor.userId),
    )
  }
  if (fixture.tailorProfileId) {
    await attempt('delete tailor profile', () => deleteRest('tailor_profiles', `id=eq.${fixture.tailorProfileId}`, 'Delete disposable tailor profile'))
  }
  if (fixture.tailorUserId) {
    await attempt('delete public user', () => deleteRest('users', `id=eq.${fixture.tailorUserId}`, 'Delete disposable public user'))
    await attempt('delete auth user', () => deleteAuthUser(fixture.tailorUserId))
  }

  return { skipped: false, errors: cleanupErrors }
}

async function verifyPasswordSession(email) {
  if (!supabaseUrl || !anonKey) return { ok: false, error: 'Missing Supabase URL or anon key.' }
  try {
    const body = await fetchJson(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      },
      'Password session check',
    )
    return { ok: Boolean(body?.access_token), userId: body?.user?.id ?? null, accessToken: body?.access_token ?? null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function browserAuthState(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    localStorageKeys: Object.keys(window.localStorage).filter((key) => key.includes('supabase') || key.includes('auth') || key.startsWith('sb-')),
    cookies: document.cookie
      .split(';')
      .map((entry) => entry.trim().split('=')[0])
      .filter((name) => name.includes('supabase') || name.includes('auth') || name.startsWith('sb-')),
  }))
}

async function fetchPublicQaJson(response) {
  const text = await response.text().catch(() => '')
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text.slice(0, 1000)
  }
}

async function runPublicOnlyQa() {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, '')
  const checks = []
  const publicPaths = [
    { pathname: '/', expectedText: 'Drapeon' },
    { pathname: '/join', expectedText: 'waitlist' },
    { pathname: '/sign-in', expectedText: 'Sign in' },
    { pathname: '/sign-up', expectedText: 'Create' },
    { pathname: '/apply', expectedText: 'tailor' },
    { pathname: '/tailors', expectedText: 'tailor' },
  ]

  for (const { pathname, expectedText } of publicPaths) {
    const response = await fetch(`${normalizedBaseUrl}${pathname}`, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.text().catch(() => '')
    const includesExpectedText = body.toLowerCase().includes(expectedText.toLowerCase())
    checks.push({
      type: 'public-page',
      pathname,
      status: response.status,
      ok: response.ok && includesExpectedText,
      includesExpectedText,
      expectedText,
      finalUrl: response.url,
    })
  }

  const webPushResponse = await fetch(`${normalizedBaseUrl}/api/web-push`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const webPushBody = await fetchPublicQaJson(webPushResponse)
  checks.push({
    type: 'web-push-config',
    status: webPushResponse.status,
    ok: webPushResponse.ok && Boolean(webPushBody?.enabled && webPushBody?.publicKey),
    enabled: Boolean(webPushBody?.enabled),
    publicKeyLength: typeof webPushBody?.publicKey === 'string' ? webPushBody.publicKey.length : 0,
  })

  const invalidWaitlistResponse = await fetch(`${normalizedBaseUrl}/api/waitlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'CUSTOMER', name: 'No Email' }),
    signal: AbortSignal.timeout(20_000),
  })
  const invalidWaitlistBody = await fetchPublicQaJson(invalidWaitlistResponse)
  checks.push({
    type: 'waitlist-invalid-payload',
    status: invalidWaitlistResponse.status,
    ok: invalidWaitlistResponse.status === 400,
    body: invalidWaitlistBody,
  })

  const honeypotWaitlistResponse = await fetch(`${normalizedBaseUrl}/api/waitlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'CUSTOMER',
      name: 'Bot Field',
      email: `bot.${stamp}@drapeon.co`,
      website: 'https://spam.example',
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const honeypotWaitlistBody = await fetchPublicQaJson(honeypotWaitlistResponse)
  checks.push({
    type: 'waitlist-honeypot',
    status: honeypotWaitlistResponse.status,
    ok: honeypotWaitlistResponse.ok && honeypotWaitlistBody?.ok === true,
    body: honeypotWaitlistBody,
  })

  if (allowProdWaitlistMutation) {
    const waitlistResponse = await fetch(`${normalizedBaseUrl}/api/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'CUSTOMER',
        name: 'Drapeon Prod QA Runner',
        email: publicWaitlistEmail,
        location: 'Launch QA',
        notes: 'Disposable production waitlist smoke test from the web QA runner.',
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const waitlistBody = await fetchPublicQaJson(waitlistResponse)
    checks.push({
      type: 'waitlist-submit',
      skipped: false,
      email: publicWaitlistEmail,
      status: waitlistResponse.status,
      ok: waitlistResponse.ok && waitlistBody?.ok === true,
      body: waitlistBody,
    })
  } else {
    checks.push({
      type: 'waitlist-submit',
      skipped: true,
      ok: true,
      reason: 'Set WEB_QA_ALLOW_PROD_WAITLIST_MUTATION=1 to create a real disposable waitlist smoke row.',
    })
  }

  const report = {
    mode: 'public-only',
    baseUrl: normalizedBaseUrl,
    allowProdWaitlistMutation,
    waitlistEmail: allowProdWaitlistMutation ? publicWaitlistEmail : null,
    checks,
    passed: checks.every((check) => check.ok || check.skipped),
  }

  await writeFile(path.join(outDir, 'public-prod-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exit(1)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  if (publicOnly) {
    await runPublicOnlyQa()
    return
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8_000)
  const events = []
  const badResponses = []
  const routeResults = []
  const flowResults = []
  let disposableQa = null
  let disposableQaCleanup = null

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) events.push({ type: message.type(), text: message.text() })
  })
  page.on('requestfailed', (request) => {
    events.push({ type: 'requestfailed', text: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}` })
  })
  page.on('response', async (response) => {
    const status = response.status()
    if (status < 400) return
    const url = response.url()
    if (!url.includes('supabase.co') && !url.includes('/api/')) return
    let text = ''
    try {
      text = (await response.text()).slice(0, 800)
    } catch {
      text = ''
    }
    badResponses.push({ status, url, text })
  })
  page.on('pageerror', (error) => events.push({ type: 'pageerror', text: error.message }))

  async function screenshotFor(targetPage, name) {
    await targetPage.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false })
  }

  async function screenshot(name) {
    await screenshotFor(page, name)
  }

  async function signInWithPassword(targetPage, email, passwordValue, screenshotName) {
    await targetPage.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await targetPage.waitForSelector('input[type="email"]', { timeout: 8_000 }).catch(() => null)
      if (await targetPage.locator('input[type="email"]').count().catch(() => 0)) break
      await targetPage.reload({ waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => null)
    }
    if (!(await targetPage.locator('input[type="email"]').count().catch(() => 0))) {
      await screenshotFor(targetPage, `${screenshotName}-missing-form`)
      const body = await targetPage.locator('body').innerText().catch(() => '')
      throw new Error(`Sign-in form was not visible at ${targetPage.url()}: ${body.slice(0, 240)}`)
    }
    await targetPage.waitForTimeout(3_000)
    await targetPage.locator('input[type="email"]').fill(email)
    await targetPage.locator('input[type="password"]').fill(passwordValue)
    await targetPage.getByRole('button', { name: /^Sign in$/i }).click()
  }

  function recordFlow(name, status, details = {}) {
    flowResults.push({
      name,
      ...details,
      status,
    })
  }

  async function runFlow(name, fn) {
    try {
      const details = await fn()
      recordFlow(name, 'passed', details ?? {})
    } catch (error) {
      recordFlow(name, 'failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  function guardedSkip(name, reason, todo) {
    recordFlow(name, 'skipped', { reason, todo })
  }

  async function waitForWorkspaceReady(targetPage = page) {
    await targetPage.waitForFunction(() => !document.body.innerText.includes('Loading your Drapeon workspace'), null, { timeout: 10_000 }).catch(() => null)
    await targetPage.waitForTimeout(1_000)
  }

  async function runOpsActionQaSuite(customerUserId) {
    await runFlow('ops action auth boundary', async () => {
      const checked = []
      for (const kind of OPS_ACTION_KINDS) {
        const result = await postLocalForm('/ops/action', {
          kind,
          redirectTo: '/ops?view=overview',
        }, null, `Ops locked boundary ${kind}`)
        const redirect = assertOpsRedirect(result, 'error', ['locked'])
        checked.push({ kind, error: redirect.error })
      }
      return { checked: checked.length, actions: checked }
    })

    if (!enableOpsQa) {
      guardedSkip(
        'ops action authenticated suite',
        'WEB_QA_ENABLE_OPS_QA=0 disabled ops action QA.',
        'Run without WEB_QA_ENABLE_OPS_QA=0 to exercise the ops control-plane action suite.',
      )
      return
    }

    const status = opsTokenStatus(opsToken)
    if (status !== 'ready') {
      guardedSkip(
        'ops action authenticated suite',
        `Ops bootstrap token is ${status}; the app requires a non-placeholder token of at least 32 characters.`,
        'Start the web dev server with a strong OPS_DASHBOARD_TOKEN and run the runner with the same token, or pass WEB_QA_OPS_TOKEN.',
      )
      return
    }

    if (!disposableQa?.tailorUserId || !disposableQa.tailorProfileId || !disposableQa.sellerItemId || !customerUserId) {
      guardedSkip(
        'ops action authenticated suite',
        'Disposable customer/tailor fixtures were not available.',
        'Run against a non-production Supabase project with service-role credentials so ops QA can create and clean fixtures.',
      )
      return
    }

    let opsCookie = null
    const opsStartedAt = new Date(Date.now() - 5_000).toISOString()
    const allowedForRole = new Set(OPS_ROLE_ACTION_ACCESS[opsBootstrapRole] ?? OPS_ROLE_ACTION_ACCESS.admin)

    async function postOpsAction(kind, fields, label) {
      return postLocalForm('/ops/action', {
        redirectTo: '/ops?view=overview',
        kind,
        ...fields,
      }, opsCookie, label)
    }

    async function requireLatestAudit(event, { orderId = null } = {}) {
      const filters = [
        'select=id,event,order_id,payload,created_at',
        `event=eq.${encodeURIComponent(event)}`,
        `created_at=gte.${encodeURIComponent(opsStartedAt)}`,
        'order=created_at.desc',
        'limit=1',
      ]
      if (orderId) filters.splice(2, 0, `order_id=eq.${encodeURIComponent(orderId)}`)
      const audit = await selectFirstRest('audit_logs', filters.join('&'), `Select latest audit log ${event}`)
      if (!audit?.id) throw new Error(`Expected audit log ${event}${orderId ? ` for order ${orderId}` : ''}.`)
      return audit
    }

    async function requireIssueAudit(issueId, actionTaken) {
      const audit = await selectFirstRest(
        'ops_audit_logs',
        `select=id,issue_id,action_taken,performed_role,reason,created_at&issue_id=eq.${encodeURIComponent(issueId)}&action_taken=eq.${encodeURIComponent(actionTaken)}&order=created_at.desc&limit=1`,
        `Select ops audit ${actionTaken}`,
      )
      if (!audit?.id) throw new Error(`Expected ops audit ${actionTaken} for issue ${issueId}.`)
      return audit
    }

    async function requireLatestOpsIssue(filters, label) {
      const issue = await selectFirstRest(
        'ops_issues',
        `select=id,issue_type,status,order_id,related_entity_id,metadata,created_at&${filters}&order=created_at.desc&limit=1`,
        label,
      )
      if (!issue?.id) throw new Error(`Expected ops issue for ${label}.`)
      return issue
    }

    async function requireLatestPayout(orderId) {
      const payout = await selectFirstRest(
        'payouts',
        `select=id,status,blocked_reason,provider,provider_payout_id,provider_response,source_payment_id,amount,currency&order_id=eq.${encodeURIComponent(orderId)}&order=processed_at.desc&limit=1`,
        'Select latest disposable payout',
      )
      if (!payout?.id) throw new Error(`Expected payout row for order ${orderId}.`)
      return payout
    }

    async function prepareStripeProviderBackedPayoutProfile() {
      if (opsProviderMutationMode !== 'stripe-test-provider') return false
      await patchRest(
        'tailor_profiles',
        `id=eq.${encodeURIComponent(disposableQa.tailorProfileId)}`,
        {
          payout_currency: 'USD',
          payout_provider: 'STRIPE',
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: true,
          payout_reverification_required: false,
          stripe_account_id: stripeQaDestinationAccountId.trim(),
          stripe_connect_account_id: stripeQaDestinationAccountId.trim(),
          updated_at: new Date().toISOString(),
        },
        'Prepare disposable Stripe payout profile',
      )
      return true
    }

    async function runAllowedOpsAction(kind, name, fn) {
      if (!allowedForRole.has(kind)) {
        guardedSkip(
          name,
          `Current ops role ${opsBootstrapRole} does not allow ${kind}.`,
          `Run this suite with OPS_DASHBOARD_BOOTSTRAP_ROLE=admin, or run a dedicated ${opsBootstrapRole} RBAC pass expecting forbidden redirects.`,
        )
        return
      }
      await runFlow(name, fn)
    }

    await runFlow('ops action login/unlock', async () => {
      const result = await postLocalForm('/ops/login', {
        token: opsToken,
        redirectTo: '/ops',
      }, null, 'Ops dashboard login')
      const redirect = assertOpsRedirect(result, 'notice', ['ops-unlocked'])
      opsCookie = result.setCookie ? result.setCookie.split(';')[0] : opsCookieForToken(opsToken)
      if (!opsCookie) throw new Error('Ops login did not produce a cookie.')
      return { ...redirect, role: opsBootstrapRole }
    })

    if (!opsCookie) {
      guardedSkip(
        'ops action authenticated matrix',
        'Ops login did not complete, so authenticated action checks cannot run.',
        'Fix the ops bootstrap token/dev-server env mismatch and rerun the QA runner.',
      )
      return
    }

    await runFlow('ops action RBAC current-role forbidden matrix', async () => {
      const forbidden = OPS_ACTION_KINDS.filter((kind) => !allowedForRole.has(kind))
      const checked = []
      for (const kind of forbidden) {
        const result = await postOpsAction(kind, {}, `Ops RBAC forbidden ${kind}`)
        const redirect = assertOpsRedirect(result, 'error', ['forbidden'])
        checked.push({ kind, error: redirect.error })
      }
      return {
        role: opsBootstrapRole,
        forbiddenChecks: checked.length,
        checked,
        note: checked.length === 0
          ? 'Current role allows every action; rerun with OPS_DASHBOARD_BOOTSTRAP_ROLE=engineering, finance, trust, ops, or customer_success for denial checks.'
          : null,
      }
    })

    async function checkDeniedOpsActionsForRole(role, roleIndex) {
      let ownedServer = null
      let targetBaseUrl = null
      let targetCookie = null
      let source = null

      try {
        if (role === opsBootstrapRole) {
          targetBaseUrl = baseUrl
          targetCookie = opsCookie
          source = 'current-server'
        } else if (opsRbacRoleBaseUrls.has(role)) {
          targetBaseUrl = opsRbacRoleBaseUrls.get(role)
          targetCookie = opsCookieForToken(opsToken)
          source = 'configured-url'
        } else if (spawnOpsRbacRoleServers) {
          ownedServer = await startOpsRoleServer(role, roleIndex)
          targetBaseUrl = ownedServer.baseUrl
          targetCookie = opsCookieForToken(opsToken)
          source = 'spawned-server'
        } else {
          return {
            role,
            status: 'skipped',
            reason:
              'No role-specific Ops server was available. Set WEB_QA_SPAWN_OPS_RBAC_SERVERS=1 or provide WEB_QA_OPS_RBAC_ROLE_URLS.',
          }
        }

        const allowed = new Set(OPS_ROLE_ACTION_ACCESS[role] ?? [])
        const denied = OPS_ACTION_KINDS.filter((kind) => !allowed.has(kind))
        const checked = []
        for (const kind of denied) {
          const result = await postLocalFormToBase(targetBaseUrl, '/ops/action', {
            redirectTo: '/ops?view=overview',
            kind,
          }, targetCookie, `Ops RBAC ${role} forbids ${kind}`)
          const redirect = assertOpsRedirect(result, 'error', ['forbidden'])
          checked.push({ kind, error: redirect.error })
        }
        return {
          role,
          status: 'checked',
          source,
          baseUrl: targetBaseUrl,
          allowedChecks: OPS_ACTION_KINDS.length - denied.length,
          deniedChecks: checked.length,
          checked,
        }
      } finally {
        await ownedServer?.stop()
      }
    }

    await runFlow('ops action unknown kind forbidden', async () => {
      const result = await postOpsAction('web-qa-unknown-action', {}, 'Ops unknown action')
      return assertOpsRedirect(result, 'error', ['forbidden'])
    })

    await runAllowedOpsAction('seller-item-visibility', 'ops action: seller item visibility', async () => {
      const result = await postOpsAction('seller-item-visibility', {
        itemId: disposableQa.sellerItemId,
        visibilityAction: 'HIDE',
        note: 'Web QA hide ready-made listing.',
      }, 'Ops seller item hide')
      const redirect = assertOpsRedirect(result, 'notice', ['seller-item-hidden'])
      const item = await selectFirstRest(
        'seller_items',
        `select=id,is_live,stock_status&id=eq.${encodeURIComponent(disposableQa.sellerItemId)}`,
        'Select seller item after ops visibility action',
      )
      if (item?.is_live !== false || item?.stock_status !== 'HIDDEN') {
        throw new Error(`Seller item was not hidden: ${JSON.stringify(item)}`)
      }
      const audit = await requireLatestAudit('ops.seller_item_visibility_updated')
      return { ...redirect, itemId: item.id, isLive: item.is_live, stockStatus: item.stock_status, auditId: audit.id }
    })

    await runAllowedOpsAction('dispute-status', 'ops action: dispute status', async () => {
      const { dispute } = await createDisposableDispute(disposableQa, customerUserId, 'OPEN')
      const result = await postOpsAction('dispute-status', {
        disputeId: dispute.id,
        status: 'UNDER_REVIEW',
      }, 'Ops dispute status')
      const redirect = assertOpsRedirect(result, 'notice', ['dispute-saved'])
      const updated = await selectFirstRest('disputes', `select=id,status&id=eq.${encodeURIComponent(dispute.id)}`, 'Select dispute status')
      if (updated?.status !== 'UNDER_REVIEW') throw new Error(`Dispute status did not update: ${JSON.stringify(updated)}`)
      const audit = await requireLatestAudit('ops.dispute_status_updated')
      return { ...redirect, disputeId: dispute.id, status: updated.status, auditId: audit.id }
    })

    await runAllowedOpsAction('dispute-resolution', 'ops action: dispute resolution', async () => {
      const { dispute, order } = await createDisposableDispute(disposableQa, customerUserId, 'OPEN')
      const result = await postOpsAction('dispute-resolution', {
        disputeId: dispute.id,
        outcome: 'RELEASE',
        resolution: 'Web QA resolved in tailor favor.',
      }, 'Ops dispute resolution')
      const redirect = assertOpsRedirect(result, 'notice', ['dispute-resolved'])
      const updatedDispute = await selectFirstRest('disputes', `select=id,status,resolution&id=eq.${encodeURIComponent(dispute.id)}`, 'Select resolved dispute')
      const updatedOrder = await selectFirstRest('orders', `select=id,stage,escrow_released&id=eq.${encodeURIComponent(order.id)}`, 'Select dispute order')
      if (updatedDispute?.status !== 'RESOLVED_RELEASED' || updatedOrder?.stage !== 'COMPLETE' || updatedOrder?.escrow_released !== true) {
        throw new Error(`Dispute resolution state mismatch: ${JSON.stringify({ updatedDispute, updatedOrder })}`)
      }
      const audit = await requireLatestAudit('ops.dispute_resolved', { orderId: order.id })
      return { ...redirect, disputeId: dispute.id, orderId: order.id, stage: updatedOrder.stage, auditId: audit.id }
    })

    await runAllowedOpsAction('bypass-review', 'ops action: bypass review', async () => {
      const log = await createDisposableContactBypassLog(disposableQa, customerUserId)
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'CONTACT_BYPASS',
        related_entity_type: 'contact_bypass_log',
        related_entity_id: log.id,
        title: `Web QA contact bypass ${stamp}`,
      })
      const result = await postOpsAction('bypass-review', {
        logId: log.id,
        reviewed: 'true',
      }, 'Ops bypass review')
      const redirect = assertOpsRedirect(result, 'notice', ['bypass-saved'])
      const updatedLog = await selectFirstRest('contact_bypass_logs', `select=id,reviewed,reviewed_at&id=eq.${encodeURIComponent(log.id)}`, 'Select bypass log')
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status,resolved_at&id=eq.${encodeURIComponent(issue.id)}`, 'Select bypass issue')
      if (updatedLog?.reviewed !== true || updatedIssue?.status !== 'RESOLVED') {
        throw new Error(`Bypass review state mismatch: ${JSON.stringify({ updatedLog, updatedIssue })}`)
      }
      const audit = await requireLatestAudit('ops.contact_bypass_review_updated')
      const issueAudit = await requireIssueAudit(issue.id, 'CONTACT_BYPASS_REVIEWED')
      return { ...redirect, logId: log.id, issueId: issue.id, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    await runAllowedOpsAction('application-status', 'ops action: application status', async () => {
      const application = await createDisposableTailorApplication(disposableQa)
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'TAILOR_APPLICATION',
        related_entity_type: 'tailor_application',
        related_entity_id: application.id,
        title: `Web QA tailor application ${stamp}`,
      })
      const result = await postOpsAction('application-status', {
        applicationId: application.id,
        status: 'CONTACTED',
      }, 'Ops application status')
      const redirect = assertOpsRedirect(result, 'notice', ['application-saved'])
      const updatedApplication = await selectFirstRest('tailor_applications', `select=id,status&id=eq.${encodeURIComponent(application.id)}`, 'Select application')
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status&id=eq.${encodeURIComponent(issue.id)}`, 'Select application issue')
      if (updatedApplication?.status !== 'CONTACTED' || updatedIssue?.status !== 'IN_REVIEW') {
        throw new Error(`Application status mismatch: ${JSON.stringify({ updatedApplication, updatedIssue })}`)
      }
      const audit = await requireLatestAudit('ops.tailor_application_status_updated')
      const issueAudit = await requireIssueAudit(issue.id, 'TAILOR_APPLICATION_STATUS_UPDATED')
      return { ...redirect, applicationId: application.id, issueId: issue.id, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    await runAllowedOpsAction('verification-decision', 'ops action: verification approval and rejection', async () => {
      const approvalFixture = await createDisposableVerificationTailor(disposableQa, 'approval')
      const approvalIssue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'TAILOR_VERIFICATION',
        user_id: approvalFixture.userId,
        tailor_profile_id: approvalFixture.profileId,
        title: `Web QA tailor verification approval ${stamp}`,
      })

      const approvalResult = await postOpsAction('verification-decision', {
        tailorUserId: approvalFixture.userId,
        decision: 'APPROVE',
      }, 'Ops verification approval')
      const approvalRedirect = assertOpsRedirect(approvalResult, 'notice', ['verification-approved'])
      const approvedProfile = await selectFirstRest(
        'tailor_profiles',
        `select=id,id_verification_status,is_live,is_verified&id=eq.${encodeURIComponent(approvalFixture.profileId)}`,
        'Select approved verification profile',
      )
      const resolvedApprovalIssue = await selectFirstRest(
        'ops_issues',
        `select=id,status,resolved_at&id=eq.${encodeURIComponent(approvalIssue.id)}`,
        'Select approved verification issue',
      )
      if (
        approvedProfile?.id_verification_status !== 'VERIFIED' ||
        approvedProfile?.is_live !== true ||
        approvedProfile?.is_verified !== true ||
        resolvedApprovalIssue?.status !== 'RESOLVED' ||
        !resolvedApprovalIssue?.resolved_at
      ) {
        throw new Error(`Verification approval state mismatch: ${JSON.stringify({ approvedProfile, resolvedApprovalIssue })}`)
      }
      const approvalIssueAudit = await requireIssueAudit(approvalIssue.id, 'VERIFICATION_APPROVED')
      const approvalDecisionAudit = await requireLatestAudit('ops.verification_decision_logged')
      const approvalPayload = approvalDecisionAudit.payload && typeof approvalDecisionAudit.payload === 'object'
        ? approvalDecisionAudit.payload
        : {}
      if (
        approvalPayload.decision !== 'APPROVE' ||
        approvalPayload.email_sent !== true ||
        !['SENT', 'SKIPPED', 'ERROR'].includes(approvalPayload.push_status)
      ) {
        throw new Error(`Verification approval side effects were not recorded: ${JSON.stringify(approvalPayload)}`)
      }

      const rejectionFixture = await createDisposableVerificationTailor(disposableQa, 'rejection')
      const rejectionIssue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'TAILOR_VERIFICATION',
        user_id: rejectionFixture.userId,
        tailor_profile_id: rejectionFixture.profileId,
        title: `Web QA tailor verification rejection ${stamp}`,
      })
      const rejectionResult = await postOpsAction('verification-decision', {
        tailorUserId: rejectionFixture.userId,
        decision: 'REJECT',
        reason: 'The disposable challenge video did not include the requested movement.',
      }, 'Ops verification rejection')
      const rejectionRedirect = assertOpsRedirect(rejectionResult, 'notice', ['verification-rejected'])
      const profile = await selectFirstRest('tailor_profiles', `select=id,id_verification_status,is_live&id=eq.${encodeURIComponent(rejectionFixture.profileId)}`, 'Select verification profile')
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status,resolved_at&id=eq.${encodeURIComponent(rejectionIssue.id)}`, 'Select verification issue')
      if (profile?.id_verification_status !== 'REJECTED' || profile?.is_live !== false || updatedIssue?.status !== 'RESOLVED') {
        throw new Error(`Verification decision mismatch: ${JSON.stringify({ profile, updatedIssue })}`)
      }
      const rejectionIssueAudit = await requireIssueAudit(rejectionIssue.id, 'VERIFICATION_REJECTED')
      const rejectionDecisionAudit = await requireLatestAudit('ops.verification_decision_logged')
      const rejectionPayload = rejectionDecisionAudit.payload && typeof rejectionDecisionAudit.payload === 'object'
        ? rejectionDecisionAudit.payload
        : {}
      if (
        rejectionPayload.decision !== 'REJECT' ||
        rejectionPayload.email_sent !== true ||
        !['SENT', 'SKIPPED', 'ERROR'].includes(rejectionPayload.push_status)
      ) {
        throw new Error(`Verification rejection side effects were not recorded: ${JSON.stringify(rejectionPayload)}`)
      }

      return {
        approval: {
          ...approvalRedirect,
          profileId: approvedProfile.id,
          issueId: approvalIssue.id,
          issueAuditId: approvalIssueAudit.id,
          decisionAuditId: approvalDecisionAudit.id,
          emailSent: approvalPayload.email_sent,
          pushStatus: approvalPayload.push_status,
        },
        rejection: {
          ...rejectionRedirect,
          profileId: profile.id,
          issueId: rejectionIssue.id,
          issueAuditId: rejectionIssueAudit.id,
          decisionAuditId: rejectionDecisionAudit.id,
          emailSent: rejectionPayload.email_sent,
          pushStatus: rejectionPayload.push_status,
        },
      }
    })

    await runAllowedOpsAction('deletion-status', 'ops action: deletion status', async () => {
      const request = await createDisposableDeletionRequest(disposableQa, disposableQa.tailorUserId, disposableQa.tailorEmail)
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'ACCOUNT_DELETION_REQUEST',
        related_entity_type: 'account_deletion_request',
        related_entity_id: request.id,
        user_id: disposableQa.tailorUserId,
        title: `Web QA account deletion ${stamp}`,
      })
      const result = await postOpsAction('deletion-status', {
        deletionRequestId: request.id,
        status: 'ACKNOWLEDGED',
      }, 'Ops deletion status')
      const redirect = assertOpsRedirect(result, 'notice', ['deletion-saved'])
      const updatedRequest = await selectFirstRest('account_deletion_requests', `select=id,status,acknowledged_at&id=eq.${encodeURIComponent(request.id)}`, 'Select deletion request')
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status&id=eq.${encodeURIComponent(issue.id)}`, 'Select deletion issue')
      if (updatedRequest?.status !== 'ACKNOWLEDGED' || !updatedRequest?.acknowledged_at || updatedIssue?.status !== 'IN_REVIEW') {
        throw new Error(`Deletion status mismatch: ${JSON.stringify({ updatedRequest, updatedIssue })}`)
      }
      const audit = await requireLatestAudit('ops.account_deletion_status_updated')
      const issueAudit = await requireIssueAudit(issue.id, 'ACCOUNT_DELETION_STATUS_UPDATED')
      return { ...redirect, deletionRequestId: request.id, issueId: issue.id, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    await runAllowedOpsAction('review-visibility', 'ops action: review visibility', async () => {
      const { review } = await createDisposableReview(disposableQa, customerUserId)
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'CONTENT_FLAG',
        related_entity_type: 'review',
        related_entity_id: review.id,
        title: `Web QA review moderation ${stamp}`,
      })
      const result = await postOpsAction('review-visibility', {
        reviewId: review.id,
        visibility: 'PUBLISH',
      }, 'Ops review visibility')
      const redirect = assertOpsRedirect(result, 'notice', ['review-published'])
      const updatedReview = await selectFirstRest('reviews', `select=id,published_at,flagged&id=eq.${encodeURIComponent(review.id)}`, 'Select review visibility')
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status&id=eq.${encodeURIComponent(issue.id)}`, 'Select review issue')
      if (!updatedReview?.published_at || updatedReview?.flagged !== false || updatedIssue?.status !== 'RESOLVED') {
        throw new Error(`Review visibility mismatch: ${JSON.stringify({ updatedReview, updatedIssue })}`)
      }
      const audit = await requireLatestAudit('ops.review_visibility_updated')
      const issueAudit = await requireIssueAudit(issue.id, 'REVIEW_PUBLISHED')
      return { ...redirect, reviewId: review.id, issueId: issue.id, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    await runAllowedOpsAction('conversation-access', 'ops action: conversation access', async () => {
      const order = await createDisposableCustomOrder(disposableQa, customerUserId, 'CONFIRMED')
      const result = await postOpsAction('conversation-access', {
        orderId: order.id,
        accessAction: 'BLOCK',
        reason: 'Web QA conversation safety check.',
      }, 'Ops conversation access')
      const redirect = assertOpsRedirect(result, 'notice', ['conversation-blocked'])
      const audit = await requireLatestAudit('conversation.blocked', { orderId: order.id })
      return { ...redirect, orderId: order.id, auditId: audit.id }
    })

    await runAllowedOpsAction('dispatch-stage', 'ops action: dispatch stage', async () => {
      const order = await createDisposableCustomOrder(disposableQa, customerUserId, 'READY_FOR_DRAPE_DISPATCH', {
        delivery_method: 'SHIPPING',
        delivery_address: '123 QA Dispatch Ave, Chicago, IL',
        recipient_name: 'Web QA Recipient',
        recipient_phone: '+15555550199',
        quoted_amount: 12500,
        total_amount: 14300,
        subtotal_amount: 12500,
        shipping_amount: 1800,
      })
      const result = await postOpsAction('dispatch-stage', {
        orderId: order.id,
        targetStage: 'SHIPPED',
        provider: 'Web QA Courier',
        reference: `WEB-QA-REF-${stamp}`,
        contactName: 'QA Dispatcher',
        contactPhone: '+15555550198',
        trackingNumber: `WEBQA${String(stamp).slice(-8)}`,
        serviceLevel: 'STANDARD',
        note: 'Web QA dispatch stage update.',
      }, 'Ops dispatch stage')
      const redirect = assertOpsRedirect(result, 'notice', ['dispatch-saved'])
      const updatedOrder = await selectFirstRest('orders', `select=id,stage,fulfillment_provider,fulfillment_reference,tracking_number,carrier&id=eq.${encodeURIComponent(order.id)}`, 'Select dispatch order')
      if (updatedOrder?.stage !== 'SHIPPED' || !updatedOrder?.tracking_number || updatedOrder?.fulfillment_provider !== 'Web QA Courier') {
        throw new Error(`Dispatch state mismatch: ${JSON.stringify(updatedOrder)}`)
      }
      const audit = await requireLatestAudit('ops.dispatch_stage_updated', { orderId: order.id })
      return { ...redirect, orderId: order.id, stage: updatedOrder.stage, trackingNumber: updatedOrder.tracking_number, auditId: audit.id }
    })

    await runAllowedOpsAction('order-review-resolution', 'ops action: order review resolution', async () => {
      const order = await createDisposableCustomOrder(disposableQa, customerUserId, 'IN_DISPUTE', {
        special_note: JSON.stringify({
          cancellationReview: {
            status: 'OPEN',
            requestedFromStage: 'CONFIRMED',
          },
        }),
        quoted_amount: 12500,
        total_amount: 12500,
        subtotal_amount: 12500,
      })
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'ORDER_REVIEW',
        order_id: order.id,
        dedupe_key: `order-review:cancellation:${order.id}`,
        title: `Web QA order review ${stamp}`,
      })
      const result = await postOpsAction('order-review-resolution', {
        orderId: order.id,
        reviewType: 'CANCELLATION',
        outcome: 'CONTINUE',
        resolution: 'Web QA continues the order after review.',
      }, 'Ops order review resolution')
      const redirect = assertOpsRedirect(result, 'notice', ['order-review-continued'])
      const updatedOrder = await selectFirstRest('orders', `select=id,stage,special_note&id=eq.${encodeURIComponent(order.id)}`, 'Select order review order')
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status,resolved_at&id=eq.${encodeURIComponent(issue.id)}`, 'Select order review issue')
      if (updatedOrder?.stage !== 'CONFIRMED' || updatedIssue?.status !== 'RESOLVED') {
        throw new Error(`Order review state mismatch: ${JSON.stringify({ updatedOrder, updatedIssue })}`)
      }
      const audit = await requireLatestAudit('ops.order_review_resolved', { orderId: order.id })
      const issueAudit = await requireIssueAudit(issue.id, 'ORDER_REVIEW_RESOLVED')
      return { ...redirect, orderId: order.id, issueId: issue.id, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    await runAllowedOpsAction('order-partial-refund', 'ops action: partial refund fixture', async () => {
      const providerBacked = opsProviderMutationMode === 'stripe-test-provider'
      const { order, payment } = await createDisposableRefundOrder(disposableQa, customerUserId, { providerBacked })
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'SYSTEM_ALERT',
        order_id: order.id,
        related_entity_type: 'order',
        related_entity_id: order.id,
        title: `Web QA partial refund ${stamp}`,
      })
      const result = await postOpsAction('order-partial-refund', {
        issueId: issue.id,
        orderId: order.id,
        amount: '12.00',
        maxRefundableAmount: '12500',
        note: 'Web QA disposable partial refund.',
      }, 'Ops partial refund fixture')

      if (providerBacked) {
        const redirect = assertOpsRedirect(result, 'notice', ['partial-refund-issued'])
        const updatedOrder = await selectFirstRest('orders', `select=id,stage&id=eq.${encodeURIComponent(order.id)}`, 'Select partial refund order')
        const updatedPayment = await selectFirstRest('order_payments', `select=id,status,refunded_amount&id=eq.${encodeURIComponent(payment.id)}`, 'Select partial refund payment')
        const updatedIssue = await selectFirstRest('ops_issues', `select=id,status&id=eq.${encodeURIComponent(issue.id)}`, 'Select partial refund issue')
        if (updatedOrder?.stage !== 'PARTIALLY_REFUNDED' || updatedPayment?.status !== 'PARTIAL_REFUND' || updatedPayment?.refunded_amount !== 1200 || updatedIssue?.status !== 'RESOLVED') {
          throw new Error(`Partial refund provider mutation mismatch: ${JSON.stringify({ updatedOrder, updatedPayment, updatedIssue })}`)
        }
        const audit = await requireLatestAudit('ops.order_partial_refund_issued', { orderId: order.id })
        const paymentAudit = await requireLatestAudit('payment.partial_refund_executed', { orderId: order.id })
        const issueAudit = await requireIssueAudit(issue.id, 'ORDER_PARTIAL_REFUND_ISSUED')
        return {
          ...redirect,
          mode: opsProviderMutationMode,
          orderId: order.id,
          paymentId: payment.id,
          auditId: audit.id,
          paymentAuditId: paymentAudit.id,
          issueAuditId: issueAudit.id,
        }
      }

      const redirect = assertOpsRedirect(result, 'error', ['refund-failed'])
      const updatedOrder = await selectFirstRest('orders', `select=id,stage&id=eq.${encodeURIComponent(order.id)}`, 'Select failed partial refund order')
      const failureIssue = await requireLatestOpsIssue(
        `issue_type=eq.REFUND_FAILED&order_id=eq.${encodeURIComponent(order.id)}`,
        'partial refund failure issue',
      )
      if (updatedOrder?.stage !== 'COMPLETE' || failureIssue.status !== 'OPEN') {
        throw new Error(`Partial refund guarded failure state mismatch: ${JSON.stringify({ updatedOrder, failureIssue })}`)
      }
      const audit = await requireLatestAudit('ops.order_partial_refund_failed', { orderId: order.id })
      return {
        ...redirect,
        mode: opsProviderMutationMode,
        orderId: order.id,
        paymentId: payment.id,
        failureIssueId: failureIssue.id,
        auditId: audit.id,
      }
    })

    await runAllowedOpsAction('payout-release', 'ops action: payout release fixture', async () => {
      const providerBacked = await prepareStripeProviderBackedPayoutProfile()
      const { order } = await createDisposablePayoutReadyOrder(disposableQa, customerUserId, { providerBacked })
      const result = await postOpsAction('payout-release', {
        orderId: order.id,
      }, 'Ops payout release fixture')
      const redirect = assertOpsRedirectOutcome(result, {
        notice: ['payout-release-triggered'],
        error: ['payout-release-failed'],
      })
      const payout = await requireLatestPayout(order.id)
      const updatedOrder = await selectFirstRest('orders', `select=id,escrow_released,escrow_released_at&id=eq.${encodeURIComponent(order.id)}`, 'Select payout release order')

      if (providerBacked) {
        if (!['PROCESSING', 'PAID', 'FAILED'].includes(payout.status)) {
          throw new Error(`Provider-backed payout did not reach provider execution state: ${JSON.stringify(payout)}`)
        }
        if (payout.status !== 'FAILED' && updatedOrder?.escrow_released !== true) {
          throw new Error(`Provider-backed payout did not release escrow after non-failed payout: ${JSON.stringify({ payout, updatedOrder })}`)
        }
      } else if (payout.status !== 'BLOCKED' || payout.blocked_reason !== 'PAYOUT_ACCOUNT_MISSING') {
        throw new Error(`Blocked payout fixture mismatch: ${JSON.stringify(payout)}`)
      }

      const routeAudit = redirect.notice
        ? await requireLatestAudit('ops.payout_release_triggered', { orderId: order.id })
        : await requireLatestAudit('ops.payout_release_failed', { orderId: order.id })
      const edgeAudit = payout.status === 'BLOCKED'
        ? await requireLatestOpsIssue(`issue_type=eq.PAYOUT_BLOCKED&order_id=eq.${encodeURIComponent(order.id)}`, 'blocked payout issue')
        : payout.status === 'FAILED'
          ? await requireLatestOpsIssue(`issue_type=eq.PAYOUT_FAILED&order_id=eq.${encodeURIComponent(order.id)}`, 'failed payout issue')
          : await requireLatestAudit('payout.released', { orderId: order.id })
      return {
        ...redirect,
        mode: opsProviderMutationMode,
        orderId: order.id,
        payoutId: payout.id,
        payoutStatus: payout.status,
        blockedReason: payout.blocked_reason ?? null,
        routeAuditId: routeAudit.id,
        edgeEvidenceId: edgeAudit.id,
      }
    })

    await runAllowedOpsAction('material-advance-release', 'ops action: material advance release fixture', async () => {
      const providerBacked = await prepareStripeProviderBackedPayoutProfile()
      const { advance, order } = await createDisposableMaterialAdvance(disposableQa, customerUserId, {
        paid: true,
        providerBacked,
      })
      const result = await postOpsAction('material-advance-release', {
        advanceId: advance.id,
        note: 'Web QA material advance release fixture.',
      }, 'Ops material advance release')
      const redirect = assertOpsRedirectOutcome(result, {
        notice: ['material-advance-release-triggered'],
        error: ['material-advance-release-failed'],
      })
      const updatedAdvance = await selectFirstRest('order_material_advances', `select=id,status,release_status,release_blocked_reason,provider_release_id&id=eq.${encodeURIComponent(advance.id)}`, 'Select material advance')

      if (providerBacked) {
        if (!['BLOCKED', 'RELEASED'].includes(updatedAdvance?.status)) {
          throw new Error(`Provider-backed material advance state mismatch: ${JSON.stringify(updatedAdvance)}`)
        }
      } else if (updatedAdvance?.status !== 'BLOCKED' || updatedAdvance?.release_status !== 'BLOCKED' || updatedAdvance?.release_blocked_reason !== 'PAYOUT_DESTINATION_MISSING') {
        throw new Error(`Blocked material advance fixture mismatch: ${JSON.stringify(updatedAdvance)}`)
      }

      const evidence = updatedAdvance.status === 'RELEASED'
        ? await requireLatestAudit('material_advance.released', { orderId: order.id })
        : await requireLatestOpsIssue(`related_entity_id=eq.${encodeURIComponent(advance.id)}`, 'material advance release issue')
      const routeAudit = redirect.notice
        ? await requireLatestAudit('ops.material_advance_release_triggered')
        : await requireLatestAudit('ops.material_advance_release_failed')

      if (!['BLOCKED', 'RELEASED'].includes(updatedAdvance?.status)) {
        throw new Error(`Unexpected material advance state: ${JSON.stringify(updatedAdvance)}`)
      }
      return {
        ...redirect,
        mode: opsProviderMutationMode,
        advanceId: advance.id,
        orderId: order.id,
        status: updatedAdvance?.status ?? null,
        releaseStatus: updatedAdvance?.release_status ?? null,
        routeAuditId: routeAudit.id,
        evidenceId: evidence.id,
      }
    })

    await runAllowedOpsAction('payout-block-resolution', 'ops action: payout block resolution fixture', async () => {
      const providerBacked = await prepareStripeProviderBackedPayoutProfile()
      const { order } = await createDisposablePayoutReadyOrder(disposableQa, customerUserId, {
        providerBacked,
        stage: 'DELIVERED',
      })
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'PAYOUT_BLOCKED',
        severity: 'HIGH',
        order_id: order.id,
        related_entity_type: 'order',
        related_entity_id: order.id,
        title: `Web QA payout block ${stamp}`,
        description: 'Disposable payout block issue for ops QA resolution.',
        recommended_action: 'Apply a disposable payout resolution and verify audit state.',
        dedupe_key: `web-qa-payout-block:${order.id}`,
      })
      const result = await postOpsAction('payout-block-resolution', {
        issueId: issue.id,
        orderId: order.id,
        resolutionMode: 'ORIGINAL_CURRENCY',
        note: 'Web QA applies payout block resolution.',
      }, 'Ops payout block resolution fixture')
      const redirect = assertOpsRedirectOutcome(result, {
        notice: ['payout-resolution-applied'],
        error: ['payout-release-failed'],
      })
      const updatedOrder = await selectFirstRest(
        'orders',
        `select=id,ops_payout_resolution_mode,ops_payout_override_currency,ops_payout_override_provider,ops_payout_override_amount,escrow_released&id=eq.${encodeURIComponent(order.id)}`,
        'Select payout block resolution order',
      )
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status&id=eq.${encodeURIComponent(issue.id)}`, 'Select payout block issue')
      const payout = await requireLatestPayout(order.id)
      const expectedIssueStatus = redirect.notice ? 'RESOLVED' : 'OPEN'
      if (updatedOrder?.ops_payout_resolution_mode !== 'ORIGINAL_CURRENCY' || updatedIssue?.status !== expectedIssueStatus) {
        throw new Error(`Payout block resolution state mismatch: ${JSON.stringify({ updatedOrder, updatedIssue, payout })}`)
      }
      if (!providerBacked && (payout.status !== 'BLOCKED' || payout.blocked_reason !== 'PAYOUT_ACCOUNT_MISSING')) {
        throw new Error(`Payout block fixture should block before provider: ${JSON.stringify(payout)}`)
      }
      if (providerBacked && !['PROCESSING', 'PAID', 'FAILED'].includes(payout.status)) {
        throw new Error(`Provider-backed payout block resolution did not reach provider execution state: ${JSON.stringify(payout)}`)
      }
      const audit = redirect.notice
        ? await requireLatestAudit('ops.payout_block_resolution_applied', { orderId: order.id })
        : await requireLatestAudit('ops.payout_block_resolution_failed', { orderId: order.id })
      const issueEvidence = redirect.notice
        ? await requireIssueAudit(issue.id, 'PAYOUT_BLOCK_RESOLUTION_APPLIED')
        : await requireLatestOpsIssue(`issue_type=eq.PAYOUT_BLOCKED&order_id=eq.${encodeURIComponent(order.id)}`, 'payout block failure issue')
      return {
        ...redirect,
        mode: opsProviderMutationMode,
        orderId: order.id,
        issueId: issue.id,
        payoutId: payout.id,
        payoutStatus: payout.status,
        blockedReason: payout.blocked_reason ?? null,
        auditId: audit.id,
        issueAuditId: redirect.notice ? issueEvidence.id : null,
        failureIssueId: redirect.error ? issueEvidence.id : null,
      }
    })

    await runAllowedOpsAction('ops-issue-status', 'ops action: issue status', async () => {
      const issue = await createDisposableOpsIssue(disposableQa, {
        issue_type: 'SYSTEM_ALERT',
        title: `Web QA issue status ${stamp}`,
      })
      const result = await postOpsAction('ops-issue-status', {
        issueId: issue.id,
        status: 'IN_REVIEW',
        note: 'Web QA issue triage.',
      }, 'Ops issue status')
      const redirect = assertOpsRedirect(result, 'notice', ['workflow-issue-saved'])
      const updatedIssue = await selectFirstRest('ops_issues', `select=id,status,assigned_to&id=eq.${encodeURIComponent(issue.id)}`, 'Select workflow issue')
      if (updatedIssue?.status !== 'IN_REVIEW') throw new Error(`Workflow issue did not update: ${JSON.stringify(updatedIssue)}`)
      const audit = await requireLatestAudit('ops.workflow_issue_status_updated')
      const issueAudit = await requireIssueAudit(issue.id, 'ISSUE_STATUS_UPDATED')
      return { ...redirect, issueId: issue.id, status: updatedIssue.status, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    await runAllowedOpsAction('manual-issue-create', 'ops action: manual issue create', async () => {
      const title = `Web QA manual issue ${stamp} ${randomUUID().slice(0, 8)}`
      const result = await postOpsAction('manual-issue-create', {
        issueType: 'SYSTEM_ALERT',
        severity: 'LOW',
        title,
        description: 'Disposable manual issue created by the web ops QA runner.',
        recommendedAction: 'Confirm the issue was created, audited, and then cleaned by the runner.',
        note: 'Web QA manual issue note.',
      }, 'Ops manual issue create')
      const redirect = assertOpsRedirect(result, 'notice', ['manual-issue-created'])
      const issue = await selectFirstRest(
        'ops_issues',
        `select=id,status,title,issue_type&title=eq.${encodeURIComponent(title)}&order=created_at.desc&limit=1`,
        'Select manual ops issue',
      )
      if (!issue?.id || issue.status !== 'OPEN') throw new Error(`Manual ops issue was not created: ${JSON.stringify(issue)}`)
      rememberFixtureId(disposableQa, 'opsIssueIds', issue.id)
      const audit = await requireLatestAudit('ops.manual_issue_created')
      const issueAudit = await requireIssueAudit(issue.id, 'ISSUE_CREATED_MANUAL')
      return { ...redirect, issueId: issue.id, auditId: audit.id, issueAuditId: issueAudit.id }
    })

    if (!enableOpsRbacMatrix) {
      guardedSkip(
        'ops action RBAC non-admin denial matrix',
        'WEB_QA_ENABLE_OPS_RBAC_MATRIX=0 disabled the non-admin RBAC matrix.',
        'Run without WEB_QA_ENABLE_OPS_RBAC_MATRIX=0 to verify every non-admin denial redirect.',
      )
    } else if (!spawnOpsRbacRoleServers && !opsRbacRoles.some((role) => role === opsBootstrapRole || opsRbacRoleBaseUrls.has(role))) {
      guardedSkip(
        'ops action RBAC non-admin denial matrix',
        'No non-admin role server was available for denial checks.',
        'Set WEB_QA_SPAWN_OPS_RBAC_SERVERS=1, run the app once per OPS_DASHBOARD_BOOTSTRAP_ROLE and pass WEB_QA_OPS_RBAC_ROLE_URLS, or run the QA runner against a non-admin bootstrap role.',
      )
    } else {
      await runFlow('ops action RBAC non-admin denial matrix', async () => {
        const results = []
        for (const [index, role] of opsRbacRoles.entries()) {
          results.push(await checkDeniedOpsActionsForRole(role, index))
        }

        const checkedRoles = results.filter((result) => result.status === 'checked')
        const skippedRoles = results.filter((result) => result.status === 'skipped')
        if (checkedRoles.length === 0) {
          throw new Error('No non-admin Ops roles were checked. Enable spawned role servers or provide role base URLs.')
        }

        return {
          requestedRoles: opsRbacRoles,
          checkedRoles: checkedRoles.map((result) => result.role),
          skippedRoles,
          totalDeniedChecks: checkedRoles.reduce((sum, result) => sum + result.deniedChecks, 0),
          results,
        }
      })
    }
  }

  let accountEmail = uiEmail
  let creationMode = 'ui-sign-up'

  let signupAuthenticated = false

  if (!fastAuth) {
    try {
      await page.goto(`${baseUrl}/sign-up`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
      await page.waitForTimeout(1_500)
      await page.locator('input[autocomplete="name"]').fill('Web QA Customer')
      await page.locator('input[autocomplete="tel"]').fill(phone)
      await page.locator('input[type="email"]').fill(uiEmail)
      await page.locator('input[autocomplete="new-password"]').first().fill(password)
      await page.locator('input[autocomplete="new-password"]').nth(1).fill(password)
      await page.getByRole('button', { name: /^Menswear\b/i }).click()
      await page.getByRole('button', { name: /^Create account$/i }).click()
      await page.waitForTimeout(3_000)
      await screenshot('authenticated-sign-up-result')

      const afterSignupText = await page.locator('body').innerText().catch(() => '')
      signupAuthenticated = page.url().includes('/account/dashboard') || afterSignupText.includes('Dashboard')
    } catch (error) {
      events.push({
        type: 'signup-fallback',
        text: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (!signupAuthenticated) {
    creationMode = 'admin-confirmed-fallback'
    const fallback = await createConfirmedCustomer(fallbackEmail)
    accountEmail = fallback.email
    const passwordSessionCheck = await verifyPasswordSession(accountEmail)
    await signInWithPassword(page, accountEmail, password, 'authenticated-sign-in')
    await page.waitForURL(/\/account\/dashboard/u, { timeout: 12_000 }).catch(() => null)
    await waitForWorkspaceReady()
    await screenshot('authenticated-sign-in-result')
    events.push({
      type: 'auth-debug',
      text: JSON.stringify({
        passwordSessionCheck: {
          ok: passwordSessionCheck.ok,
          userId: passwordSessionCheck.userId ?? null,
          hasAccessToken: Boolean(passwordSessionCheck.accessToken),
          error: passwordSessionCheck.error ?? null,
        },
        afterSignInUrl: page.url(),
        afterSignInHeading: await page.locator('h1').first().innerText().catch(() => null),
        afterSignInText: (await page.locator('body').innerText().catch(() => '')).slice(0, 600),
        browserAuthState: await browserAuthState(page),
      }),
    })
  }

  for (const accountPath of accountPaths) {
    const response = await page.goto(`${baseUrl}${accountPath}`, { waitUntil: 'domcontentloaded', timeout: 12_000 }).catch((error) => {
      routeResults.push({ path: accountPath, error: error instanceof Error ? error.message : String(error) })
      return null
    })
    await waitForWorkspaceReady()
    await screenshot(`authenticated-${slug(accountPath)}`)
    const body = await page.locator('body').innerText().catch(() => '')
    routeResults.push({
      path: accountPath,
      status: response?.status() ?? null,
      url: page.url(),
      h1: await page.locator('h1').first().innerText().catch(() => null),
      signedInWall: body.includes('Sign in to Drapeon') || body.includes('Sign in to continue') || page.url().includes('/sign-in'),
      hasEmptyState: body.includes('No ') || body.includes('not loaded') || body.includes('will appear'),
    })
  }

  await runFlow('negative: unauthenticated account route wall', async () => {
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const guestPage = await guestContext.newPage()
    guestPage.setDefaultTimeout(8_000)
    try {
      await guestPage.goto(`${baseUrl}/account/orders`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
      await waitForWorkspaceReady(guestPage)
      const body = await guestPage.locator('body').innerText().catch(() => '')
      const blocked = guestPage.url().includes('/sign-in')
        || body.includes('Sign in to Drapeon')
        || body.includes('Sign in to continue')
      if (!blocked) throw new Error(`Guest reached protected route: ${guestPage.url()}`)
      await screenshotFor(guestPage, 'negative-unauthenticated-account-wall')
      return { blocked: true, url: guestPage.url() }
    } finally {
      await guestContext.close()
    }
  })

  await runFlow('negative: invalid sign-in rejected', async () => {
    const invalidContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const invalidPage = await invalidContext.newPage()
    invalidPage.setDefaultTimeout(8_000)
    try {
      await invalidPage.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
      await invalidPage.waitForSelector('input[type="email"]', { timeout: 8_000 })
      await invalidPage.waitForTimeout(3_000)
      await invalidPage.locator('input[type="email"]').fill(`invalid.${stamp}@drapeon.co`)
      await invalidPage.locator('input[type="password"]').fill('not-the-password')
      await invalidPage.getByRole('button', { name: /^Sign in$/i }).click()
      await invalidPage.waitForTimeout(1_500)
      const body = await invalidPage.locator('body').innerText().catch(() => '')
      const stayedOut = !invalidPage.url().includes('/account/')
        && (await invalidPage.locator('input[type="password"]').count().catch(() => 0)) > 0
      if (!stayedOut) throw new Error(`Invalid credentials appeared to authenticate: ${invalidPage.url()}`)
      await screenshotFor(invalidPage, 'negative-invalid-sign-in')
      return { rejected: true, url: invalidPage.url(), bodySample: body.slice(0, 240) }
    } finally {
      await invalidContext.close()
    }
  })

  const postAuthSessionCheck = await verifyPasswordSession(accountEmail)
  const accessToken = postAuthSessionCheck.accessToken ?? null
  events.push({
    type: 'auth-token-check',
    text: JSON.stringify({
      ok: postAuthSessionCheck.ok,
      userId: postAuthSessionCheck.userId ?? null,
      hasAccessToken: Boolean(accessToken),
      error: postAuthSessionCheck.error ?? null,
    }),
  })

  try {
    disposableQa = await createDisposableQaFixtures()
    events.push({
      type: 'disposable-fixture',
      text: JSON.stringify({
        tailorUserId: disposableQa.tailorUserId,
        tailorProfileId: disposableQa.tailorProfileId,
        sellerItemId: disposableQa.sellerItemId,
      }),
    })
  } catch (error) {
    events.push({
      type: 'disposable-fixture',
      text: error instanceof Error ? error.message : String(error),
    })
  }

  let fixtureTailor = disposableQa?.tailorProfileId
    ? { id: disposableQa.tailorProfileId, display_name: 'Web QA Tailor', business_name: 'Web QA Tailor' }
    : null
  let fixtureReadyMadeItem = disposableQa?.sellerItemId
    ? { id: disposableQa.sellerItemId, title: 'Web QA Ready-made', tailor_profile_id: disposableQa.tailorProfileId }
    : null
  if (!fixtureTailor?.id) {
    try {
      const tailors = await selectRest(
        'tailor_profiles',
        'select=id,display_name,business_name,supports_custom_orders,is_live&supports_custom_orders=eq.true&is_live=eq.true&limit=1',
        'Select custom tailor fixture',
      )
      fixtureTailor = Array.isArray(tailors) ? tailors[0] ?? null : null
    } catch (error) {
      events.push({
        type: 'fixture-lookup',
        text: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (!fixtureReadyMadeItem?.id) {
    try {
      const items = await selectRest(
        'seller_items',
        'select=id,title,tailor_profile_id,is_live,stock_status&is_live=eq.true&limit=1',
        'Select ready-made item fixture',
      )
      fixtureReadyMadeItem = Array.isArray(items) ? items[0] ?? null : null
    } catch (error) {
      events.push({
        type: 'fixture-lookup',
        text: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await runFlow('explore search/filter', async () => {
    await page.goto(`${baseUrl}/account/explore`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    await waitForWorkspaceReady()
    await page.locator('input[placeholder^="Search by tailor"]').fill('qa')
    const customOnly = page.locator('label', { hasText: 'Custom orders only' }).first()
    if (await customOnly.count()) await customOnly.click()
    await page.waitForTimeout(700)
    await screenshot('flow-explore-search-filter')
    return {
      url: page.url(),
      bodySample: (await page.locator('body').innerText().catch(() => '')).slice(0, 300),
    }
  })

  await runFlow('negative: measurements contact leak blocked', async () => {
    await page.goto(`${baseUrl}/account/measurements`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    await waitForWorkspaceReady()
    await page.getByLabel('Profile name').fill('Call +15555550123')
    const decimalInputs = page.locator('input[inputmode="decimal"]')
    const values = ['70', '38', '32', '39']
    for (let index = 0; index < values.length; index += 1) {
      await decimalInputs.nth(index).fill(values[index])
    }
    await page.getByRole('button', { name: /^Save profile$/i }).click()
    await page.waitForFunction(() => document.body.innerText.includes("Measurement profile names can't include contact details."), null, { timeout: 8_000 }).catch(() => null)
    await screenshot('negative-measurements-contact-leak')
    const text = await page.locator('body').innerText().catch(() => '')
    if (!text.includes("Measurement profile names can't include contact details.")) {
      throw new Error('Measurement contact-leak validation copy did not appear.')
    }
    return { blocked: true }
  })

  await runFlow('measurements editor save', async () => {
    await page.goto(`${baseUrl}/account/measurements`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    await waitForWorkspaceReady()
    await page.getByLabel('Profile name').fill('QA fit profile')
    const decimalInputs = page.locator('input[inputmode="decimal"]')
    const values = ['70', '38', '32', '39']
    for (let index = 0; index < values.length; index += 1) {
      await decimalInputs.nth(index).fill(values[index])
    }
    await page.getByRole('button', { name: /^Save profile$/i }).click()
    await page.waitForFunction(() => document.body.innerText.includes('Measurement profile saved') || document.body.innerText.includes('Measurements could not save'), null, { timeout: 12_000 }).catch(() => null)
    await screenshot('flow-measurements-editor-save')
    const text = await page.locator('body').innerText().catch(() => '')
    if (!text.includes('Measurement profile saved')) throw new Error('Measurement save success copy did not appear.')
    return { saved: true }
  })

  await runFlow('settings notification mutation', async () => {
    await page.goto(`${baseUrl}/account/settings`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    await waitForWorkspaceReady()
    const platformUpdates = page.locator('label', { hasText: 'Platform updates' }).first()
    if (!(await platformUpdates.count())) throw new Error('Platform updates preference was not visible.')
    await platformUpdates.click()
    await page.getByRole('button', { name: /^Save preferences$/i }).click()
    await page.waitForFunction(() => document.body.innerText.includes('Notification preferences saved') || document.body.innerText.includes('Preferences could not save'), null, { timeout: 12_000 }).catch(() => null)
    await screenshot('flow-settings-notification-prefs')
    const text = await page.locator('body').innerText().catch(() => '')
    if (!text.includes('Notification preferences saved')) throw new Error('Notification preference save success copy did not appear.')
    return { saved: true }
  })

  await runFlow('web push readiness smoke', async () => {
    const configResponse = await fetch(`${baseUrl}/api/web-push`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!configResponse.ok) throw new Error(`Web push config failed with HTTP ${configResponse.status}.`)
    const config = await configResponse.json()
    const workerResponse = await fetch(`${baseUrl}/web-push-sw.js`, {
      headers: { Accept: 'application/javascript,text/javascript,*/*' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!workerResponse.ok) throw new Error(`Web push service worker failed with HTTP ${workerResponse.status}.`)
    const workerSource = await workerResponse.text()
    if (!workerSource.includes('showNotification')) throw new Error('Web push service worker does not show notifications.')
    return {
      configured: Boolean(config.enabled && config.publicKey),
      publicKeyLength: typeof config.publicKey === 'string' ? config.publicKey.length : 0,
      serviceWorkerBytes: workerSource.length,
    }
  })

  if (fixtureTailor?.id) {
    await runFlow('custom brief preflight', async () => {
      await page.goto(`${baseUrl}/account/brief/${fixtureTailor.id}`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
      await waitForWorkspaceReady()
      await screenshot('flow-custom-brief-route')
      const result = await invokeEdgeFunction(
        'custom-order-action',
        accessToken,
        buildCustomBriefPreflightPayload(fixtureTailor.id),
        'Custom brief preflight',
      )
      return { ok: Boolean(result?.ok), tailorId: fixtureTailor.id }
    })
  } else {
    guardedSkip('custom brief preflight', 'No live custom tailor fixture was available.', 'Seed a live tailor that supports custom orders for web authenticated QA.')
  }

  if (disposableQa?.tailorEmail) {
    await runFlow('tailor-role actor coverage', async () => {
      const tailorContext = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
      const tailorPage = await tailorContext.newPage()
      tailorPage.setDefaultTimeout(8_000)
      try {
        await signInWithPassword(tailorPage, disposableQa.tailorEmail, password, 'tailor-role-sign-in')
        await tailorPage.waitForURL(/\/account/u, { timeout: 12_000 }).catch(() => null)
        await waitForWorkspaceReady(tailorPage)

        const tailorRouteResults = []
        for (const tailorPath of ['/account/work', '/account/tailor', '/account/profile', '/account/earnings', '/account/payout']) {
          const response = await tailorPage.goto(`${baseUrl}${tailorPath}`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
          await waitForWorkspaceReady(tailorPage)
          await screenshotFor(tailorPage, `tailor-role-${slug(tailorPath)}`)
          const body = await tailorPage.locator('body').innerText().catch(() => '')
          tailorRouteResults.push({
            path: tailorPath,
            status: response?.status() ?? null,
            signedInWall: body.includes('Sign in to Drapeon') || tailorPage.url().includes('/sign-in'),
            h1: await tailorPage.locator('h1').first().innerText().catch(() => null),
          })
        }
        return { tailorEmail: disposableQa.tailorEmail, routes: tailorRouteResults }
      } finally {
        await tailorContext.close()
      }
    })
  } else {
    guardedSkip(
      'tailor-role actor coverage',
      'Disposable tailor fixture setup was not available.',
      'Run against a non-production Supabase project with service-role credentials so the runner can create and clean a tailor fixture.',
    )
  }

  if (fixtureTailor?.id) {
    await runFlow('tailor detail save/unsave', async () => {
      await page.goto(`${baseUrl}/account/tailors/${fixtureTailor.id}`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
      await waitForWorkspaceReady()
      const saveButton = page.getByRole('button', { name: /^(Save tailor|Remove from saved)$/i })
      const firstLabel = await saveButton.innerText()
      await saveButton.click()
      await page.waitForTimeout(1_200)
      const secondLabel = await saveButton.innerText().catch(() => '')
      await saveButton.click()
      await page.waitForTimeout(1_200)
      await screenshot('flow-tailor-detail-save-unsave')
      return { tailorId: fixtureTailor.id, firstLabel, secondLabel }
    })
  } else {
    guardedSkip('tailor detail save/unsave', 'No live tailor fixture was available.', 'Seed a live tailor profile for save/unsave QA.')
  }

  if (fixtureReadyMadeItem?.id) {
    await runFlow('shop item detail', async () => {
      const response = await page.goto(`${baseUrl}/account/items/${fixtureReadyMadeItem.id}`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
      await waitForWorkspaceReady()
      await screenshot('flow-shop-item-detail')
      return { itemId: fixtureReadyMadeItem.id, httpStatus: response?.status() ?? null }
    })
  } else {
    guardedSkip('shop item detail', 'No live ready-made item fixture was available.', 'Seed a live ready-made item for item-detail QA.')
  }

  await runFlow('public tailor application validation', async () => {
    await page.goto(`${baseUrl}/apply`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    const submitButton = page.getByRole('button', { name: /Submit application/i })
    if (!(await submitButton.count())) throw new Error('Submit application button was not visible.')
    const disabled = await submitButton.first().isDisabled().catch(() => false)
    if (!disabled) await submitButton.first().click()
    await page.waitForTimeout(800)
    await screenshot('flow-public-tailor-application-validation')
    const body = await page.locator('body').innerText().catch(() => '')
    return {
      validationVisible: body.includes('portfolio') || body.includes('application'),
      submitDisabled: disabled,
    }
  })

  if (enableEmailSmoke) {
    await runFlow('password reset/magic-link smoke', async () => {
      await page.goto(`${baseUrl}/account/recovery`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
      await page.locator('input[type="email"]').fill(accountEmail)
      await page.getByRole('button').filter({ hasText: /Send|Continue|Reset/i }).first().click()
      await page.waitForTimeout(1_500)
      await screenshot('flow-password-reset-magic-link')
      return { emailSmokeEnabled: true }
    })
  } else {
    guardedSkip(
      'password reset/magic-link smoke',
      'WEB_QA_ENABLE_EMAILS is not set; sending auth emails is disabled by default.',
      'Run with WEB_QA_ENABLE_EMAILS=1 against a non-production email sink to exercise this path.',
    )
  }

  let readyMadeCheckoutOrderId = null
  if (disposableQa?.sellerItemId && accessToken) {
    await runFlow('ready-made checkout/create path', async () => {
      const preview = await invokeEdgeFunction('ready-made-order-action', accessToken, {
        action: 'preview-checkout',
        sellerItemId: disposableQa.sellerItemId,
        size: 'M',
        quantity: 1,
        fulfillment: 'PICKUP',
      }, 'Ready-made checkout preview')

      const checkout = await invokeEdgeFunction('ready-made-order-action', accessToken, {
        action: 'create-checkout',
        sellerItemId: disposableQa.sellerItemId,
        size: 'M',
        quantity: 1,
        fulfillment: 'PICKUP',
        cancellationPolicyAcknowledged: true,
      }, 'Ready-made checkout create')

      readyMadeCheckoutOrderId = checkout?.orderId ?? null
      if (readyMadeCheckoutOrderId) {
        disposableQa.orderIds.push(readyMadeCheckoutOrderId)
        disposableQa.readyMadeReservations.push({
          orderId: readyMadeCheckoutOrderId,
          sellerItemId: disposableQa.sellerItemId,
          quantity: 1,
          size: 'M',
        })
      }

      return {
        previewOk: Boolean(preview?.ok),
        checkoutOk: Boolean(checkout?.ok),
        orderId: readyMadeCheckoutOrderId,
        existing: checkout?.existing === true,
      }
    })
  } else {
    guardedSkip(
      'ready-made checkout/create path',
      'Disposable seller item or customer access token was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
  }

  if (readyMadeCheckoutOrderId && accessToken) {
    await runFlow('payment initiation', async () => {
      if (!enableMutations) {
        return {
          dryRun: true,
          orderId: readyMadeCheckoutOrderId,
          reason: 'WEB_QA_ENABLE_MUTATIONS is not set, so provider-side payment initialization was intentionally not invoked.',
          todo: 'Run with WEB_QA_ENABLE_MUTATIONS=1 against provider test credentials to call payment-action prepare-payment.',
        }
      }

      const payment = await invokeEdgeFunction('payment-action', accessToken, {
        action: 'prepare-payment',
        orderId: readyMadeCheckoutOrderId,
      }, 'Payment initiation')
      return {
        dryRun: false,
        orderId: readyMadeCheckoutOrderId,
        ok: Boolean(payment?.ok),
        provider: payment?.provider ?? null,
        paymentPhase: payment?.paymentPhase ?? null,
        hasCheckoutUrl: Boolean(payment?.checkoutUrl),
        hasClientSecret: Boolean(payment?.clientSecret),
      }
    })
  } else {
    guardedSkip(
      'payment initiation',
      'No disposable payable checkout order was created.',
      'Fix ready-made checkout fixture creation before exercising payment initiation.',
    )
  }

  if (disposableQa && accessToken && postAuthSessionCheck.userId) {
    await runFlow('message send/photo path', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const textMessage = await invokeEdgeFunction('message-action', accessToken, {
        action: 'send-message',
        orderId: order.id,
        type: 'TEXT',
        body: 'Authenticated web QA disposable message inside the protected order thread.',
      }, 'Message text send')
      const photoMessage = await invokeEdgeFunction('message-action', accessToken, {
        action: 'send-message',
        orderId: order.id,
        type: 'PHOTO',
        photoUrl: 'https://example.com/drape-web-qa-photo.jpg',
      }, 'Message photo send')
      return {
        orderId: order.id,
        textOk: Boolean(textMessage?.ok),
        photoOk: Boolean(photoMessage?.ok),
      }
    })

    await runFlow('consultation request', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'PENDING_QUOTE')
      const scheduledStartAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
      const result = await invokeEdgeFunction('customer-order-action', accessToken, {
        action: 'request-consultation',
        orderId: order.id,
        scheduledStartAt,
        timezone: 'America/Chicago',
        note: 'Disposable authenticated web QA consultation request.',
      }, 'Customer consultation request')
      return { orderId: order.id, ok: Boolean(result?.ok), scheduledStartAt }
    })

    await runFlow('quote send', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'PENDING_QUOTE')
      const completionDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString()
      const result = await invokeEdgeFunction('tailor-order-action', disposableQa.tailorAccessToken, {
        action: 'send-quote',
        orderId: order.id,
        amount: 12500,
        currency: 'USD',
        completionDate,
        note: 'Disposable authenticated web QA quote.',
      }, 'Tailor quote send')
      return { orderId: order.id, ok: Boolean(result?.ok), completionDate }
    })

    await runFlow('stage advance', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const proofUrl = `https://example.com/drape-web-qa-stage-proof-${stamp}-${order.id}.jpg`
      const result = await invokeEdgeFunction('tailor-order-action', disposableQa.tailorAccessToken, {
        action: 'advance-stage',
        orderId: order.id,
        targetStage: 'DESIGNING',
        note: 'Disposable web QA stage advance into designing.',
        photoUrl: proofUrl,
        photoUrls: [proofUrl],
        mediaFingerprints: [`web-qa-stage-${stamp}-${order.id}`],
      }, 'Tailor stage advance')
      return {
        orderId: order.id,
        ok: Boolean(result?.ok),
        targetStage: result?.stage ?? 'DESIGNING',
      }
    })
  } else {
    guardedSkip(
      'message send/photo path',
      'Disposable tailor fixture, customer access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'consultation request',
      'Disposable tailor fixture, customer access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'quote send',
      'Disposable tailor fixture, customer access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'stage advance',
      'Disposable tailor fixture, customer access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
  }

  if (fixtureTailor?.id && accessToken) {
    await runFlow('negative: custom brief contact leak rejected', async () => {
      const result = await invokeEdgeFunctionRaw(
        'custom-order-action',
        accessToken,
        buildCustomBriefPreflightPayload(fixtureTailor.id, {
          supportMeta: {
            source: 'web-authenticated-qa-runner',
            wearerContext: {
              mode: 'SELF',
              label: 'Call +15555550123',
              measurementProfileLabel: 'Tailor follow-up needed',
              relationship: 'BUYER',
              selectedAt: new Date().toISOString(),
            },
            measurementFallback: { requiredBeforeQuote: true, note: 'Please confirm measurements before quoting this QA dry run.' },
            fabricPolicy: { approvalRequiredForTailorSourcing: true },
          },
        }),
      )
      return assertExpectedRejection(result, { statuses: [400], textIncludes: ['Contact details'] })
    })

    await runFlow('negative: custom brief unauthenticated rejected', async () => {
      const result = await invokeEdgeFunctionRaw(
        'custom-order-action',
        null,
        buildCustomBriefPreflightPayload(fixtureTailor.id),
      )
      return assertExpectedRejection(result, { statuses: [401, 403], codes: ['UNAUTHORIZED'] })
    })
  } else {
    guardedSkip(
      'negative: custom brief contact leak rejected',
      'No live custom tailor fixture or customer access token was available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: custom brief unauthenticated rejected',
      'No live custom tailor fixture was available.',
      'Seed a live custom tailor fixture so the unauthenticated preflight rejection can be exercised.',
    )
  }

  if (disposableQa?.sellerItemId && accessToken) {
    await runFlow('negative: ready-made invalid quantity rejected', async () => {
      const result = await invokeEdgeFunctionRaw('ready-made-order-action', accessToken, {
        action: 'preview-checkout',
        sellerItemId: disposableQa.sellerItemId,
        size: 'M',
        quantity: 0,
        fulfillment: 'PICKUP',
      })
      return assertExpectedRejection(result, { statuses: [400], textIncludes: ['Check the checkout details'] })
    })

    await runFlow('negative: ready-made checkout policy required', async () => {
      const result = await invokeEdgeFunctionRaw('ready-made-order-action', accessToken, {
        action: 'create-checkout',
        sellerItemId: disposableQa.sellerItemId,
        size: 'M',
        quantity: 1,
        fulfillment: 'PICKUP',
        cancellationPolicyAcknowledged: false,
      })
      return assertExpectedRejection(result, { statuses: [400], textIncludes: ['cancellation policy'] })
    })
  } else {
    guardedSkip(
      'negative: ready-made invalid quantity rejected',
      'Disposable seller item or customer access token was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: ready-made checkout policy required',
      'Disposable seller item or customer access token was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
  }

  if (accessToken) {
    await runFlow('negative: payment invalid order rejected', async () => {
      const result = await invokeEdgeFunctionRaw('payment-action', accessToken, {
        action: 'prepare-payment',
        orderId: randomUUID(),
      })
      return assertExpectedRejection(result, { statuses: [400, 403, 404] })
    })
  } else {
    guardedSkip(
      'negative: payment invalid order rejected',
      'Customer access token was not available.',
      'Sign in a disposable customer before exercising payment-action negative coverage.',
    )
  }

  if (disposableQa && accessToken && disposableQa.tailorAccessToken && postAuthSessionCheck.userId) {
    await runFlow('negative: message empty text rejected', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const result = await invokeEdgeFunctionRaw('message-action', accessToken, {
        action: 'send-message',
        orderId: order.id,
        type: 'TEXT',
        body: '   ',
      })
      return assertExpectedRejection(result, { statuses: [400], codes: ['MESSAGE_BODY_REQUIRED'] })
    })

    await runFlow('negative: message photo url required', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const result = await invokeEdgeFunctionRaw('message-action', accessToken, {
        action: 'send-message',
        orderId: order.id,
        type: 'PHOTO',
      })
      return assertExpectedRejection(result, { statuses: [400], codes: ['PHOTO_URL_REQUIRED'] })
    })

    await runFlow('negative: consultation invalid stage rejected', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const result = await invokeEdgeFunctionRaw('customer-order-action', accessToken, {
        action: 'request-consultation',
        orderId: order.id,
        scheduledStartAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        timezone: 'America/Chicago',
        note: 'Disposable authenticated web QA invalid consultation request.',
      })
      return assertExpectedRejection(result, { statuses: [400, 409], textIncludes: ['request-consultation', 'stage'] })
    })

    await runFlow('negative: quote zero amount rejected', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'PENDING_QUOTE')
      const result = await invokeEdgeFunctionRaw('tailor-order-action', disposableQa.tailorAccessToken, {
        action: 'send-quote',
        orderId: order.id,
        amount: 0,
        currency: 'USD',
        completionDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString(),
        note: 'Disposable authenticated web QA invalid quote.',
      })
      return assertExpectedRejection(result, { statuses: [400], textIncludes: ['amount'] })
    })

    await runFlow('negative: stage advance missing proof rejected', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const result = await invokeEdgeFunctionRaw('tailor-order-action', disposableQa.tailorAccessToken, {
        action: 'advance-stage',
        orderId: order.id,
        targetStage: 'DESIGNING',
        note: 'Disposable web QA missing proof stage advance.',
      })
      return assertExpectedRejection(result, { statuses: [409], codes: ['PHOTO_REQUIRED'] })
    })

    await runFlow('negative: customer cannot advance tailor stage', async () => {
      const order = await createDisposableCustomOrder(disposableQa, postAuthSessionCheck.userId, 'CONFIRMED')
      const proofUrl = `https://example.com/drape-web-qa-forbidden-stage-${stamp}-${order.id}.jpg`
      const result = await invokeEdgeFunctionRaw('tailor-order-action', accessToken, {
        action: 'advance-stage',
        orderId: order.id,
        targetStage: 'DESIGNING',
        note: 'Disposable web QA forbidden customer stage advance.',
        photoUrl: proofUrl,
        photoUrls: [proofUrl],
        mediaFingerprints: [`web-qa-forbidden-stage-${stamp}-${order.id}`],
      })
      return assertExpectedRejection(result, { statuses: [401, 403, 404] })
    })
  } else {
    guardedSkip(
      'negative: message empty text rejected',
      'Disposable tailor fixture, customer access token, tailor access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: message photo url required',
      'Disposable tailor fixture, customer access token, tailor access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: consultation invalid stage rejected',
      'Disposable tailor fixture, customer access token, tailor access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: quote zero amount rejected',
      'Disposable tailor fixture, customer access token, tailor access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: stage advance missing proof rejected',
      'Disposable tailor fixture, customer access token, tailor access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
    guardedSkip(
      'negative: customer cannot advance tailor stage',
      'Disposable tailor fixture, customer access token, tailor access token, or customer id was not available.',
      'Run against a non-production Supabase project with service-role credentials and a signed-in customer.',
    )
  }

  await page.goto(`${baseUrl}/account/support`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
  await waitForWorkspaceReady()
  await page.waitForFunction(() => document.body.innerText.includes('Ask Drapeon for help') || document.body.innerText.includes('Sign in to continue'), null, { timeout: 12_000 }).catch(() => null)
  const supportBefore = await page.locator('body').innerText().catch(() => '')
  let supportLeakBlocked = false
  let supportSubmitted = false
  let signedInHeaderOk = false
  let signedOutHeaderOk = false
  if (supportBefore.includes('Ask Drapeon for help')) {
    await page.locator('select').first().selectOption('GENERAL')
    await page.locator('input[placeholder="Short subject"]').fill('QA web support')
    await page.locator('textarea[placeholder^="Tell us what happened"]').fill('Call me at +15555550123 about this test')
    await page.getByRole('button', { name: /Open support request/i }).click()
    await page.waitForTimeout(800)
    const leakText = await page.locator('body').innerText().catch(() => '')
    supportLeakBlocked = leakText.includes("Support requests can't include") || leakText.includes('Keep phone numbers')
    await screenshot('authenticated-support-contact-block')

    await page.locator('textarea[placeholder^="Tell us what happened"]').fill('Launch web authenticated QA support request. No user action needed.')
    await page.getByRole('button', { name: /Open support request/i }).click()
    await page.waitForFunction(() => {
      const text = document.body.innerText
      return text.includes('Support request opened') || text.includes('Support could not open') || text.includes('Rate limit')
    }, null, { timeout: 20_000 }).catch(() => null)
    const submitText = await page.locator('body').innerText().catch(() => '')
    supportSubmitted = submitText.includes('Support request opened')

    if (!supportSubmitted && accessToken) {
      const supportFallback = await invokeEdgeFunction('account-support-action', accessToken, {
        action: 'submit-support',
        category: 'GENERAL',
        orderId: null,
        subject: 'QA web support fallback',
        description: 'Launch web authenticated QA support request fallback for alternate localhost ports. No user action needed.',
      }, 'Support request direct fallback')
      supportSubmitted = Boolean(supportFallback?.ok)
    }

    await screenshot('authenticated-support-submit')
  }
  recordFlow(
    'support contact leak and submit',
    supportLeakBlocked && supportSubmitted ? 'passed' : 'failed',
    {
      supportLeakBlocked,
      supportSubmitted,
      formVisible: supportBefore.includes('Ask Drapeon for help'),
    },
  )

  await page.goto(`${baseUrl}/account/dashboard`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
  await waitForWorkspaceReady()
  await page.waitForFunction(() => document.body.innerText.includes('Sign out') || document.body.innerText.includes('Sign in to continue'), null, { timeout: 12_000 }).catch(() => null)
  const signedInPageText = await page.locator('body').innerText().catch(() => '')
  signedInHeaderOk = signedInPageText.includes('Sign out')
  await screenshot('authenticated-header-signed-in')

  if (signedInHeaderOk) {
    await page.getByRole('button', { name: /^Sign out$/i }).first().click()
    await page.waitForTimeout(500)
    const confirmSignOut = page.getByRole('button', { name: /^(Tap to confirm|Confirm sign out)$/i }).first()
    if (await confirmSignOut.count().catch(() => 0)) {
      await confirmSignOut.click()
    }
    await page.waitForURL(/\/sign-in/u, { timeout: 12_000 }).catch(() => null)
    await page.waitForTimeout(1_000)
    await page.waitForFunction(() => document.body.innerText.includes('Sign in') && !document.body.innerText.includes('Sign out'), null, { timeout: 12_000 }).catch(() => null)
    const signedOutPageText = await page.locator('body').innerText().catch(() => '')
    signedOutHeaderOk =
      (page.url().includes('/sign-in') || signedOutPageText.includes('Sign in')) &&
      !signedOutPageText.includes('Sign out')
    await screenshot('authenticated-header-signed-out')
  }
  recordFlow('header signed-in/out state', signedInHeaderOk && signedOutHeaderOk ? 'passed' : 'failed', {
    signedInHeaderOk,
    signedOutHeaderOk,
  })

  await runOpsActionQaSuite(postAuthSessionCheck.userId)

  disposableQaCleanup = await cleanupDisposableQaFixtures(disposableQa)
  if (disposableQaCleanup && !disposableQaCleanup.skipped) {
    events.push({
      type: 'disposable-fixture-cleanup',
      text: JSON.stringify({
        errorCount: disposableQaCleanup.errors?.length ?? 0,
        errors: disposableQaCleanup.errors ?? [],
      }),
    })
  }

  const report = {
    creationMode,
    accountEmail,
    enableMutations,
    enableEmailSmoke,
    enableOpsQa,
    enableOpsProviderMutations,
    opsQa: {
      tokenStatus: opsTokenStatus(opsToken),
      assumedBootstrapRole: opsBootstrapRole,
      actionCount: OPS_ACTION_KINDS.length,
      rbacMatrixEnabled: enableOpsRbacMatrix,
      rbacMatrixRoles: opsRbacRoles,
      rbacMatrixSpawnEnabled: spawnOpsRbacRoleServers,
      rbacMatrixConfiguredRoleUrls: [...opsRbacRoleBaseUrls.keys()],
      providerMutationMode: opsProviderMutationMode,
    },
    fixtures: {
      tailorId: fixtureTailor?.id ?? null,
      readyMadeItemId: fixtureReadyMadeItem?.id ?? null,
      disposableTailorProfileId: disposableQa?.tailorProfileId ?? null,
      disposableSellerItemId: disposableQa?.sellerItemId ?? null,
      disposableCleanup: disposableQaCleanup,
    },
    routeResults,
    flowResults,
    supportLeakBlocked,
    supportSubmitted,
    signedInHeaderOk,
    signedOutHeaderOk,
    events,
    badResponses,
  }
  await writeFile(path.join(outDir, 'authenticated-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
