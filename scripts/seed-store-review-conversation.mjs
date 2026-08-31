#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const ORDER_ID = 'bdbefdbf-4ee6-4343-b66e-3ada57d0ca2a'
const CREDENTIALS_PATH = process.env.REVIEW_CREDENTIALS_PATH ?? '/private/tmp/drape-reviewer-credentials.txt'
const CUSTOMER_EMAIL = 'review.apple@drapeon.co'
const TAILOR_EMAIL = 'showcase.alder-rue@drapeon.co'
const dialogue = [
  {
    email: CUSTOMER_EMAIL,
    body: 'The ivory direction feels perfect. Could we keep the waist architectural and the skirt movement relaxed?',
  },
  {
    email: TAILOR_EMAIL,
    body: 'Absolutely. I’ll preserve the clean waistline and soften the skirt through the side seams. The quote includes one fitting before the final finish.',
  },
  {
    email: CUSTOMER_EMAIL,
    body: 'Perfect, thank you. I’ve reviewed the quote and the September completion date works for me.',
  },
]

async function responseJson(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Preserve provider text for a useful failure.
  }
  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${text.slice(0, 300)}`)
  return body
}

async function discoverProductionClient() {
  const home = await (await fetch('https://drapeon.co')).text()
  const scripts = [...home.matchAll(/src="([^"]+\.js[^"]*)"/gu)]
    .map((match) => new URL(match[1], 'https://drapeon.co').href)
  let bundle = ''
  for (const script of scripts) bundle += await (await fetch(script)).text()

  const base = bundle.match(/https:\/\/[a-z]{20}\.supabase\.co/u)?.[0]
  const candidates = [...new Set([
    ...(bundle.match(/sb_publishable_[A-Za-z0-9_-]+/gu) ?? []),
    ...(bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu) ?? []),
  ])]
  if (!base) throw new Error('Production Supabase URL was not found in the public web artifact.')

  for (const candidate of candidates) {
    const response = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: candidate } })
    if (response.ok) return { base, anon: candidate }
  }
  throw new Error('Production anonymous key was not found in the public web artifact.')
}

const credentialText = readFileSync(CREDENTIALS_PATH, 'utf8')
const password = credentialText.match(/^Password:\s*(.+)$/mu)?.[1]?.trim()
if (!password) throw new Error(`Reviewer password unavailable in ${CREDENTIALS_PATH}.`)

const { base, anon } = await discoverProductionClient()
async function signIn(email) {
  const session = await responseJson(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return session.access_token
}

const tokens = new Map()
for (const email of new Set(dialogue.map((message) => message.email))) {
  tokens.set(email, await signIn(email))
}

const customerToken = tokens.get(CUSTOMER_EMAIL)
const existing = await responseJson(
  `${base}/rest/v1/messages?select=body&order_id=eq.${ORDER_ID}`,
  { headers: { apikey: anon, authorization: `Bearer ${customerToken}` } },
)
const existingBodies = new Set(existing.map((message) => message.body))
let created = 0

for (const message of dialogue) {
  if (existingBodies.has(message.body)) continue
  await responseJson(`${base}/functions/v1/message-action`, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: `Bearer ${tokens.get(message.email)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'send-message',
      orderId: ORDER_ID,
      type: 'TEXT',
      body: message.body,
    }),
  })
  created += 1
}

console.log(JSON.stringify({ ok: true, orderId: ORDER_ID, created, total: dialogue.length }))
