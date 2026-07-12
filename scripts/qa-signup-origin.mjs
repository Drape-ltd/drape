#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const OUT_DIR = process.env.QA_OUT_DIR ?? 'competition-screens/qa-reports'
const PASSWORD = process.env.QA_SIGNUP_PASSWORD ?? 'DrapeonSignupQA2026!'
const NETWORK_TIMEOUT_MS = 60_000

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
  ...loadEnv('apps/mobile/.env.local'),
  ...loadEnv('apps/web/.env.local'),
  ...process.env,
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ?? env.SUPABASE_ANON_KEY
const serviceRoleKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
const supabaseEnv = env.EXPO_PUBLIC_SUPABASE_ENV ?? env.NEXT_PUBLIC_SUPABASE_ENV ?? 'unknown'

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing Supabase URL, anon/publishable key, or service role key.')
}
if (supabaseEnv.toLowerCase() === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error('Refusing to run signup QA against production without --allow-production.')
}

const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
}

async function fetchJson(url, options, label, optional = false) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Keep raw body for diagnostics.
  }

  if (!response.ok) {
    const failure = { ok: false, label, status: response.status, body }
    if (optional) return failure
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

async function signUp(email, role, webOnboarding) {
  return fetchJson(
    `${supabaseUrl}/auth/v1/signup`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        data: {
          display_name: webOnboarding.displayName,
          phone: webOnboarding.phone,
          role,
          web_onboarding: webOnboarding,
        },
      }),
    },
    `Sign up ${role} ${email}`,
    true,
  )
}

async function signIn(email) {
  return fetchJson(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
    `Sign in ${email}`,
    true,
  )
}

async function recover(email) {
  return fetchJson(
    `${supabaseUrl}/auth/v1/recover`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email }),
    },
    `Recover ${email}`,
    true,
  )
}

async function adminConfirmUser(userId) {
  return fetchJson(
    `${supabaseUrl}/auth/v1/admin/users/${userId}`,
    {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ email_confirm: true }),
    },
    `Admin-confirm QA user ${userId}`,
  )
}

async function rest(pathname, tokenOrService, label, optional = false, method = 'GET', body = undefined) {
  const headers = tokenOrService === 'service'
    ? serviceHeaders
    : {
        apikey: anonKey,
        authorization: `Bearer ${tokenOrService}`,
        'content-type': 'application/json',
      }
  return fetchJson(
    `${supabaseUrl}/rest/v1/${pathname}`,
    {
      method,
      headers: {
        ...headers,
        Prefer: method === 'GET' ? undefined : 'resolution=merge-duplicates,return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    label,
    optional,
  )
}

async function bootstrapViaFunction(accessToken, onboarding) {
  return fetchJson(
    `${supabaseUrl}/functions/v1/account-profile-action`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'bootstrap-web-onboarding',
        onboarding,
      }),
    },
    `${onboarding.role} web onboarding bootstrap function`,
  )
}

async function bootstrapCustomer(accessToken, userId, onboarding) {
  return {
    functionResult: await bootstrapViaFunction(accessToken, onboarding),
    userId,
  }
}

async function bootstrapTailor(accessToken, userId, onboarding) {
  return {
    functionResult: await bootstrapViaFunction(accessToken, onboarding),
    userId,
  }
}

async function verifyRows(email, userId) {
  const [users, customerProfiles, tailorProfiles] = await Promise.all([
    rest(`users?select=id,email,display_name,role,phone,default_currency,currency_source,region_code&id=eq.${encodeURIComponent(userId)}&limit=1`, 'service', `Verify users row ${email}`, true),
    rest(`customer_profiles?select=user_id,display_name,phone,unit_preference,garment_context,measurements&user_id=eq.${encodeURIComponent(userId)}&limit=1`, 'service', `Verify customer profile ${email}`, true),
    rest(`tailor_profiles?select=user_id,display_name,location,languages,specialty_tags,price_range_min,price_range_max,currency,supports_custom_orders,supports_ready_made,pickup_available,delivery_available,shipping_available&user_id=eq.${encodeURIComponent(userId)}&limit=1`, 'service', `Verify tailor profile ${email}`, true),
  ])
  return { users, customerProfiles, tailorProfiles }
}

async function qaOne(input) {
  const signup = await signUp(input.email, input.onboarding.role, input.onboarding)
  const duplicateSignup = await signUp(input.email, input.onboarding.role, input.onboarding)
  let firstSignIn = await signIn(input.email)
  const userId = signup?.user?.id ?? signup?.id ?? firstSignIn?.user?.id ?? null
  let confirmation = null
  if (!firstSignIn?.access_token && userId) {
    confirmation = await adminConfirmUser(userId)
    firstSignIn = await signIn(input.email)
  }

  const accessToken = firstSignIn?.access_token
  const bootstrap = accessToken && userId
    ? input.onboarding.role === 'CUSTOMER'
      ? await bootstrapCustomer(accessToken, userId, input.onboarding)
      : await bootstrapTailor(accessToken, userId, input.onboarding)
    : { skipped: true }
  const rows = userId ? await verifyRows(input.email, userId) : null
  const recovery = await recover(input.email)

  return {
    role: input.onboarding.role,
    email: input.email,
    signup: {
      ok: signup?.ok !== false,
      hasSession: Boolean(signup?.session ?? signup?.access_token),
      userId,
      status: signup?.status ?? null,
      error: signup?.body?.msg ?? signup?.body?.error_description ?? signup?.body?.message ?? signup?.body?.error ?? null,
    },
    duplicateSignup: {
      ok: duplicateSignup?.ok !== false,
      status: duplicateSignup?.status ?? null,
      message: duplicateSignup?.body?.msg ?? duplicateSignup?.body?.error_description ?? duplicateSignup?.body?.message ?? duplicateSignup?.body?.error ?? null,
    },
    initialSignIn: {
      ok: Boolean(firstSignIn?.access_token),
      status: firstSignIn?.status ?? null,
      error: firstSignIn?.body?.error_description ?? firstSignIn?.body?.msg ?? firstSignIn?.body?.message ?? null,
    },
    confirmation: confirmation ? { ok: true, confirmedAt: confirmation?.email_confirmed_at ?? null } : null,
    bootstrap,
    rows,
    recovery: {
      ok: recovery?.ok !== false,
      status: recovery?.status ?? 200,
      message: recovery?.body?.msg ?? recovery?.body?.message ?? null,
    },
  }
}

const stamp = Date.now()

function qaPhone(offset) {
  const localDigits = String((BigInt(stamp) + BigInt(offset)) % 10_000_000n).padStart(7, '0')
  return `+1555${localDigits}`
}

const customer = {
  email: `signup.qa.customer.${stamp}@drapeon.co`,
  onboarding: {
    source: 'web',
    role: 'CUSTOMER',
    displayName: 'Signup QA Customer',
    phone: qaPhone(1),
    defaultCurrency: 'USD',
    currencySource: 'USER_SELECTED',
    regionCode: 'US',
    customer: {
      unitPreference: 'in',
      garmentContext: 'MENSWEAR',
    },
  },
}
const tailor = {
  email: `signup.qa.tailor.${stamp}@drapeon.co`,
  onboarding: {
    source: 'web',
    role: 'TAILOR',
    displayName: 'Signup QA Tailor',
    phone: qaPhone(2),
    defaultCurrency: 'USD',
    currencySource: 'USER_SELECTED',
    regionCode: 'US',
    tailor: {
      location: 'Austin',
      languages: ['English', 'Yoruba'],
      specialties: ['Agbada', 'Aso-oke', 'Alterations'],
      priceRangeMin: 50000,
      priceRangeMax: 250000,
      supportsCustomOrders: true,
      supportsReadyMade: true,
      fulfillment: ['PICKUP', 'SHIPPING'],
    },
  },
}

await mkdir(OUT_DIR, { recursive: true })
const result = {
  ok: true,
  supabaseEnv,
  generatedAt: new Date().toISOString(),
  customer: await qaOne(customer),
  tailor: await qaOne(tailor),
}
const filename = path.join(OUT_DIR, `qa-signup-origin-${stamp}.json`)
await writeFile(filename, JSON.stringify(result, null, 2))
console.log(JSON.stringify({
  report: filename,
  summary: {
    customerEmail: customer.email,
    tailorEmail: tailor.email,
    customerSignupOk: result.customer.signup.ok,
    customerSignInOk: result.customer.initialSignIn.ok,
    customerProfileCreated: Array.isArray(result.customer.rows?.customerProfiles) && result.customer.rows.customerProfiles.length === 1,
    tailorSignupOk: result.tailor.signup.ok,
    tailorSignInOk: result.tailor.initialSignIn.ok,
    tailorProfileCreated: Array.isArray(result.tailor.rows?.tailorProfiles) && result.tailor.rows.tailorProfiles.length === 1,
    recoveryOk: result.customer.recovery.ok && result.tailor.recovery.ok,
  },
}, null, 2))
