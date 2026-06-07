#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.WEB_QA_BASE_URL ?? 'http://127.0.0.1:3000'
const outDir = process.env.WEB_QA_OUT_DIR ?? '/private/tmp/drape-web-qa'
const password = process.env.WEB_QA_PASSWORD ?? 'DrapeonWebQA2026!'
const stamp = Date.now()
const email = `web.qa.header.${stamp}@drapeon.co`
const phone = `+1555${String(stamp).slice(-7)}`

function loadEnv(filePath) {
  try {
    const env = {}
    const text = readFileSync(filePath, 'utf8')
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
const serviceRoleKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY

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

async function createConfirmedCustomer() {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase dev URL or service role key.')
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
          display_name: 'Header QA Customer',
          phone,
          role: 'CUSTOMER',
        },
      }),
    },
    'Create confirmed auth user',
  )

  const now = new Date().toISOString()
  await upsertRest('users', {
    id: created.id,
    email,
    display_name: 'Header QA Customer',
    role: 'CUSTOMER',
    phone,
    default_currency: 'USD',
    currency_source: 'USER_SELECTED',
    region_code: 'US',
    currency_confirmed_at: now,
    updated_at: now,
  }, 'id')
  await upsertRest('customer_profiles', {
    user_id: created.id,
    display_name: 'Header QA Customer',
    phone,
    unit_preference: 'in',
    garment_context: 'MENSWEAR',
    measurements: {
      unit: 'in',
      garmentContext: 'MENSWEAR',
      fitPreference: 'Relaxed',
    },
    updated_at: now,
  }, 'user_id')
}

async function main() {
  await mkdir(outDir, { recursive: true })
  await createConfirmedCustomer()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10_000)

  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1_500)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /^Sign in$/i }).click()
  const reachedDashboard = await page
    .waitForFunction(() => window.location.pathname === '/account/dashboard', null, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  if (!reachedDashboard) {
    await page.screenshot({ path: path.join(outDir, 'header-auth-sign-in-failed.png'), fullPage: false })
    const body = await page.locator('body').innerText().catch(() => '')
    throw new Error(`Sign-in did not reach dashboard. Current URL: ${page.url()}. Body: ${body.slice(0, 800)}`)
  }
  await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 10_000 }).catch(() => null)
  await page.waitForTimeout(1_000)

  const signedInHeader = await page.locator('header').first().innerText()
  await page.screenshot({ path: path.join(outDir, 'header-auth-signed-in.png'), fullPage: false })
  const signedInHeaderOk =
    signedInHeader.includes('Account') &&
    signedInHeader.includes('Sign out') &&
    !signedInHeader.includes('Create account')

  if (signedInHeaderOk) {
    await page.locator('header').first().getByRole('button', { name: /^Sign out$/i }).click()
    await page.waitForFunction(() => window.location.pathname === '/sign-in')
    await page.waitForTimeout(1_000)
  }
  const signedOutHeader = await page.locator('header').first().innerText()
  await page.screenshot({ path: path.join(outDir, 'header-auth-signed-out.png'), fullPage: false })
  const signedOutHeaderOk =
    signedOutHeader.includes('Sign in') &&
    signedOutHeader.includes('Create account') &&
    !signedOutHeader.includes('Sign out')

  const report = {
    email,
    signedInHeader,
    signedInHeaderOk,
    signedOutHeader,
    signedOutHeaderOk,
  }
  await writeFile(path.join(outDir, 'header-auth-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
