#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, writeFileSync } from 'node:fs'

const APPLE_CUSTOMER_EMAIL = 'review.apple@drapeon.co'
const APPLE_TAILOR_EMAIL = 'showcase.alder-rue@drapeon.co'
const CREDENTIALS_PATH = process.env.REVIEW_CREDENTIALS_PATH ?? '/private/tmp/drape-app-review-credentials.txt'
const apply = process.argv.includes('--apply')
const projectRefIndex = process.argv.indexOf('--project-ref')
const projectRef = projectRefIndex >= 0 ? process.argv[projectRefIndex + 1]?.trim() : ''

function fail(message) {
  throw new Error(`[app-review accounts] ${message}`)
}

if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
  fail('Pass the exact Supabase project with --project-ref <20-character-ref>.')
}

function loadProjectKeys() {
  const serviceRoleFromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const anonFromEnv = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (serviceRoleFromEnv && anonFromEnv) {
    return { serviceRole: serviceRoleFromEnv, anon: anonFromEnv }
  }

  const output = execFileSync(
    'supabase',
    ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const keys = JSON.parse(output)
  const serviceRole = keys.find((key) => key.name === 'service_role')?.api_key
    ?? keys.find((key) => key.type === 'secret')?.api_key
  const anon = keys.find((key) => key.name === 'anon')?.api_key
    ?? keys.find((key) => key.type === 'publishable')?.api_key
  if (!serviceRole || !anon) fail('Could not resolve the service-role and public API keys.')
  return { serviceRole, anon }
}

const { serviceRole, anon } = loadProjectKeys()
const baseUrl = `https://${projectRef}.supabase.co`
const adminHeaders = {
  apikey: serviceRole,
  authorization: `Bearer ${serviceRole}`,
  'content-type': 'application/json',
}

async function request(path, init = {}, label = path) {
  const response = await fetch(`${baseUrl}${path}`, init)
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Keep provider text for a useful, redacted failure.
  }
  if (!response.ok) {
    fail(`${label} failed (${response.status}): ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body)}`)
  }
  return body
}

async function findAuthUser(email) {
  const page = await request('/auth/v1/admin/users?per_page=1000', { headers: adminHeaders }, 'List Auth users')
  return (page.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function tableRows(table, query) {
  return request(`/rest/v1/${table}?${query}`, { headers: adminHeaders }, `Read ${table}`)
}

async function patchRow(table, filter, body) {
  return request(
    `/rest/v1/${table}?${filter}`,
    {
      method: 'PATCH',
      headers: { ...adminHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    },
    `Update ${table}`,
  )
}

const customerAuth = await findAuthUser(APPLE_CUSTOMER_EMAIL)
const tailorAuth = await findAuthUser(APPLE_TAILOR_EMAIL)
if (!customerAuth?.id) fail(`${APPLE_CUSTOMER_EMAIL} does not exist. Seed the approved showcase world first.`)
if (!tailorAuth?.id) fail(`${APPLE_TAILOR_EMAIL} does not exist. Seed the approved showcase world first.`)

const [customerUsers, tailorUsers, customerProfiles, tailorProfiles] = await Promise.all([
  tableRows('users', `select=id,email,role&id=eq.${customerAuth.id}`),
  tableRows('users', `select=id,email,role&id=eq.${tailorAuth.id}`),
  tableRows('customer_profiles', `select=user_id,display_name,measurements&user_id=eq.${customerAuth.id}`),
  tableRows('tailor_profiles', `select=id,user_id,display_name,profile_completed,id_verification_status,is_live,payout_account_verified,payout_reverification_required,portfolio_photo_urls&user_id=eq.${tailorAuth.id}`),
])

const customerUser = customerUsers[0] ?? null
const tailorUser = tailorUsers[0] ?? null
const customerProfile = customerProfiles[0] ?? null
let tailorProfile = tailorProfiles[0] ?? null
if (!customerUser || customerUser.role !== 'CUSTOMER') fail('Apple customer fixture is missing its CUSTOMER account role.')
if (!tailorUser || tailorUser.role !== 'TAILOR') fail('Apple tailor fixture is missing its TAILOR account role.')
if (!customerProfile) fail('Apple customer fixture is missing its customer profile.')
if (!tailorProfile) fail('Apple tailor fixture is missing its tailor profile.')
if (!['VERIFIED', 'APPROVED'].includes(String(tailorProfile.id_verification_status ?? ''))) {
  fail('Apple tailor fixture has not completed the normal trust approval gate. Approve it through Ops before using this script.')
}

if (apply && tailorProfile.profile_completed !== true) {
  const updated = await patchRow(
    'tailor_profiles',
    `user_id=eq.${tailorAuth.id}`,
    { profile_completed: true, updated_at: new Date().toISOString() },
  )
  tailorProfile = { ...tailorProfile, ...(updated[0] ?? {}) }
}

let generatedCredentials = null
if (apply) {
  const customerPassword = randomBytes(24).toString('base64url')
  const tailorPassword = randomBytes(24).toString('base64url')

  for (const [user, role, password] of [
    [customerAuth, 'CUSTOMER', customerPassword],
    [tailorAuth, 'TAILOR', tailorPassword],
  ]) {
    await request(
      `/auth/v1/admin/users/${user.id}`,
      {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          password,
          email_confirm: true,
          user_metadata: {
            ...(user.user_metadata ?? {}),
            role,
            demo_account: true,
            showcase_account: true,
            app_review_account: true,
          },
        }),
      },
      `Rotate ${role.toLowerCase()} reviewer credentials`,
    )
  }

  generatedCredentials = { customerPassword, tailorPassword }
  writeFileSync(
    CREDENTIALS_PATH,
    [
      'Drapeon App Review credentials',
      `Supabase project: ${projectRef}`,
      '',
      'Customer account',
      `Email: ${APPLE_CUSTOMER_EMAIL}`,
      `Password: ${customerPassword}`,
      '',
      'Tailor account',
      `Email: ${APPLE_TAILOR_EMAIL}`,
      `Password: ${tailorPassword}`,
      '',
      'Do not commit this file. Copy both accounts into App Store Connect review notes.',
      '',
    ].join('\n'),
    { mode: 0o600 },
  )
  chmodSync(CREDENTIALS_PATH, 0o600)
}

async function verifyPasswordSignIn(email, password) {
  if (!password) return false
  const session = await request(
    '/auth/v1/token?grant_type=password',
    {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    `Verify password sign-in for ${email}`,
  )
  return typeof session?.access_token === 'string' && session.access_token.length > 0
}

const [customerOrders, tailorOrders, tailorItems] = await Promise.all([
  tableRows('orders', `select=id,reference,stage,order_kind&customer_id=eq.${customerAuth.id}&order=created_at.desc&limit=10`),
  tableRows('orders', `select=id,reference,stage,order_kind&or=(tailor_id.eq.${tailorAuth.id},tailor_profile_id.eq.${tailorProfile.id})&order=created_at.desc&limit=10`),
  tableRows('seller_items', `select=id,title,is_live,stock_status&tailor_profile_id=eq.${tailorProfile.id}&order=created_at.desc&limit=10`),
])

const result = {
  ok: true,
  mode: apply ? 'applied-and-verified' : 'audit-only',
  projectRef,
  customer: {
    email: APPLE_CUSTOMER_EMAIL,
    authConfirmed: Boolean(customerAuth.email_confirmed_at),
    role: customerUser.role,
    profileReady: Boolean(customerProfile.display_name && customerProfile.measurements),
    orderCount: customerOrders.length,
    references: customerOrders.map((order) => order.reference).filter(Boolean),
    signInVerified: await verifyPasswordSignIn(APPLE_CUSTOMER_EMAIL, generatedCredentials?.customerPassword),
  },
  tailor: {
    email: APPLE_TAILOR_EMAIL,
    authConfirmed: Boolean(tailorAuth.email_confirmed_at),
    role: tailorUser.role,
    profileCompleted: tailorProfile.profile_completed === true,
    trustStatus: tailorProfile.id_verification_status,
    isLive: tailorProfile.is_live === true,
    payoutReady: tailorProfile.payout_account_verified === true && tailorProfile.payout_reverification_required !== true,
    portfolioCount: Array.isArray(tailorProfile.portfolio_photo_urls) ? tailorProfile.portfolio_photo_urls.length : 0,
    orderCount: tailorOrders.length,
    shopItemCount: tailorItems.length,
    signInVerified: await verifyPasswordSignIn(APPLE_TAILOR_EMAIL, generatedCredentials?.tailorPassword),
  },
  credentialsPath: apply ? CREDENTIALS_PATH : null,
}

if (!result.customer.profileReady || result.customer.orderCount === 0) fail('Apple customer fixture is not complete enough for review.')
if (!result.tailor.profileCompleted || !result.tailor.isLive || !result.tailor.payoutReady) fail('Apple tailor fixture is still blocked by a launch gate.')
if (result.tailor.portfolioCount < 4 || result.tailor.orderCount === 0 || result.tailor.shopItemCount === 0) {
  fail('Apple tailor fixture is missing portfolio, order, or shop content required for complete review.')
}
if (apply && (!result.customer.signInVerified || !result.tailor.signInVerified)) fail('One or more reviewer password sign-ins failed after rotation.')

console.log(JSON.stringify(result, null, 2))
