#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.WEB_QA_BASE_URL ?? 'http://127.0.0.1:3000'
const outDir = process.env.WEB_QA_OUT_DIR ?? '/private/tmp/drape-web-qa'
const password = process.env.WEB_QA_PASSWORD ?? 'DrapeonWebQA2026!'
const fastAuth = process.env.WEB_QA_FAST_AUTH === '1'
const stamp = Date.now()
const uiEmail = `web.qa.${stamp}@drapeon.co`
const fallbackEmail = `web.qa.auth.${stamp}@drapeon.co`
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
  '/account/settings',
  '/account/support',
]

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

function slug(value) {
  return value.replace(/^\//u, 'account').replace(/[^\w-]+/gu, '-').replace(/^-|-$/gu, '') || 'account'
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

async function createConfirmedCustomer(email) {
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error('Missing Supabase URL, anon key, or service role key for authenticated fallback QA.')
  }
  if (new URL(supabaseUrl).hostname.startsWith('wkfsrunetmgjdtcurmoj')) {
    throw new Error('Refusing to create QA users on the production Supabase project.')
  }

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
          display_name: 'Web QA Customer',
          phone,
          role: 'CUSTOMER',
        },
      }),
    },
    'Create confirmed auth user',
  )
  const userId = created?.id
  if (!userId) throw new Error('Supabase did not return an auth user id.')

  const now = new Date().toISOString()
  await upsertRest('users', {
    id: userId,
    email,
    display_name: 'Web QA Customer',
    role: 'CUSTOMER',
    phone,
    default_currency: 'USD',
    currency_source: 'USER_SELECTED',
    region_code: 'US',
    currency_confirmed_at: now,
    updated_at: now,
  }, 'id')

  await upsertRest('customer_profiles', {
    user_id: userId,
    display_name: 'Web QA Customer',
    phone,
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
    return { ok: Boolean(body?.access_token), userId: body?.user?.id ?? null }
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

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8_000)
  const events = []
  const badResponses = []
  const routeResults = []

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

  async function screenshot(name) {
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false })
  }

  async function waitForWorkspaceReady() {
    await page.waitForFunction(() => !document.body.innerText.includes('Loading your Drapeon workspace'), null, { timeout: 10_000 }).catch(() => null)
    await page.waitForTimeout(1_000)
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
    await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
    await page.waitForTimeout(1_500)
    await page.locator('input[type="email"]').fill(accountEmail)
    await page.locator('input[type="password"]').fill(password)
    await page.getByRole('button', { name: /^Sign in$/i }).click()
    await page.waitForURL(/\/account\/dashboard/u, { timeout: 12_000 }).catch(() => null)
    await waitForWorkspaceReady()
    await screenshot('authenticated-sign-in-result')
    events.push({
      type: 'auth-debug',
      text: JSON.stringify({
        passwordSessionCheck,
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

  await page.goto(`${baseUrl}/account/support`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
  await waitForWorkspaceReady()
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
    await page.waitForTimeout(2_000)
    const submitText = await page.locator('body').innerText().catch(() => '')
    supportSubmitted = submitText.includes('Support request opened')
    await screenshot('authenticated-support-submit')
  }

  await page.goto(`${baseUrl}/account/dashboard`, { waitUntil: 'domcontentloaded', timeout: 12_000 })
  await waitForWorkspaceReady()
  const signedInHeaderText = await page.locator('header').first().innerText().catch(() => '')
  signedInHeaderOk =
    signedInHeaderText.includes('Account') &&
    signedInHeaderText.includes('Sign out') &&
    !signedInHeaderText.includes('Create account')
  await screenshot('authenticated-header-signed-in')

  if (signedInHeaderOk) {
    await page.locator('header').first().getByRole('button', { name: /^Sign out$/i }).click()
    await page.waitForURL(/\/sign-in/u, { timeout: 12_000 }).catch(() => null)
    await page.waitForTimeout(1_000)
    const signedOutHeaderText = await page.locator('header').first().innerText().catch(() => '')
    signedOutHeaderOk =
      signedOutHeaderText.includes('Sign in') &&
      signedOutHeaderText.includes('Create account') &&
      !signedOutHeaderText.includes('Sign out')
    await screenshot('authenticated-header-signed-out')
  }

  const report = {
    creationMode,
    accountEmail,
    routeResults,
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
