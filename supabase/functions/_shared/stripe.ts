import { getStripeSecretKey } from './env.ts'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300
const textEncoder = new TextEncoder()

export type StripePaymentIntent = {
  id: string
  client_secret: string | null
  status: string
  amount: number
  currency: string
  metadata?: Record<string, string>
  last_payment_error?: {
    message?: string | null
  } | null
}

export type StripeRefund = {
  id: string
  status?: string | null
  amount?: number | null
  payment_intent?: string | null
  metadata?: Record<string, string> | null
}

export type StripeConnectAccount = {
  id: string
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted?: boolean
  country?: string | null
  email?: string | null
}

export type StripeAccountLink = {
  object: 'account_link'
  created: number
  expires_at: number
  url: string
}

export type StripeTransfer = {
  id: string
  amount: number
  currency: string
  destination?: string | null
  metadata?: Record<string, string> | null
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getStripeSecretKey()}`,
  }
}

async function parseStripeError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => ({}))
  const message =
    typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Stripe request failed with status ${response.status}`
  throw new Error(message)
}

export async function createStripePaymentIntent(options: {
  amount: number
  currency: string
  description: string
  idempotencyKey?: string
  metadata?: Record<string, string>
}): Promise<StripePaymentIntent> {
  const body = new URLSearchParams()
  body.set('amount', String(options.amount))
  body.set('currency', options.currency.toLowerCase())
  body.set('description', options.description)
  body.set('automatic_payment_methods[enabled]', 'true')

  for (const [key, value] of Object.entries(options.metadata ?? {})) {
    body.set(`metadata[${key}]`, value)
  }

  const response = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body,
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function retrieveStripePaymentIntent(
  paymentIntentId: string,
): Promise<StripePaymentIntent> {
  const response = await fetch(`${STRIPE_API_BASE}/payment_intents/${paymentIntentId}`, {
    headers: authHeaders(),
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function cancelStripePaymentIntent(
  paymentIntentId: string,
): Promise<StripePaymentIntent> {
  const response = await fetch(`${STRIPE_API_BASE}/payment_intents/${paymentIntentId}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function refundStripePaymentIntent(options: {
  paymentIntentId: string
  amount?: number
  idempotencyKey?: string
  reasonNote?: string | null
}): Promise<StripeRefund> {
  const body = new URLSearchParams()
  body.set('payment_intent', options.paymentIntentId)
  if (typeof options.amount === 'number' && options.amount > 0) {
    body.set('amount', String(options.amount))
  }
  body.set('reason', 'requested_by_customer')
  if (options.reasonNote?.trim()) {
    body.set('metadata[drape_reason]', options.reasonNote.trim())
  }

  const response = await fetch(`${STRIPE_API_BASE}/refunds`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body,
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function createStripeConnectAccount(options: {
  email: string
  countryCode: string
  metadata?: Record<string, string>
}): Promise<StripeConnectAccount> {
  const body = new URLSearchParams()
  body.set('type', 'express')
  body.set('country', options.countryCode.trim().toUpperCase())
  body.set('email', options.email.trim())
  body.set('capabilities[transfers][requested]', 'true')

  for (const [key, value] of Object.entries(options.metadata ?? {})) {
    body.set(`metadata[${key}]`, value)
  }

  const response = await fetch(`${STRIPE_API_BASE}/accounts`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function retrieveStripeConnectAccount(accountId: string): Promise<StripeConnectAccount> {
  const response = await fetch(`${STRIPE_API_BASE}/accounts/${accountId}`, {
    headers: authHeaders(),
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function createStripeAccountLink(options: {
  accountId: string
  refreshUrl: string
  returnUrl: string
}): Promise<StripeAccountLink> {
  const body = new URLSearchParams()
  body.set('account', options.accountId)
  body.set('refresh_url', options.refreshUrl)
  body.set('return_url', options.returnUrl)
  body.set('type', 'account_onboarding')

  const response = await fetch(`${STRIPE_API_BASE}/account_links`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

export async function createStripeTransfer(options: {
  amount: number
  currency: string
  destinationAccountId: string
  idempotencyKey?: string
  transferGroup?: string | null
  metadata?: Record<string, string>
}): Promise<StripeTransfer> {
  const body = new URLSearchParams()
  body.set('amount', String(options.amount))
  body.set('currency', options.currency.trim().toLowerCase())
  body.set('destination', options.destinationAccountId.trim())
  if (options.transferGroup?.trim()) {
    body.set('transfer_group', options.transferGroup.trim())
  }

  for (const [key, value] of Object.entries(options.metadata ?? {})) {
    body.set(`metadata[${key}]`, value)
  }

  const response = await fetch(`${STRIPE_API_BASE}/transfers`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body,
  })

  if (!response.ok) {
    await parseStripeError(response)
  }

  return response.json()
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function parseStripeSignature(signatureHeader: string) {
  const parts = signatureHeader.split(',').map((part) => part.trim())
  const timestamp = Number(parts.find((part) => part.startsWith('t='))?.slice(2))
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
    .filter((part) => part.length > 0)

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error('Invalid Stripe-Signature header.')
  }

  return { timestamp, signatures }
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

export async function verifyStripeWebhookSignature(options: {
  payload: string
  signatureHeader: string
  webhookSecret: string | string[]
}) {
  const { payload, signatureHeader, webhookSecret } = options
  const { timestamp, signatures } = parseStripeSignature(signatureHeader)

  if (Math.abs(Date.now() / 1000 - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook signature timestamp is outside the allowed tolerance.')
  }

  const signingPayload = `${timestamp}.${payload}`
  const secrets = Array.isArray(webhookSecret) ? webhookSecret : [webhookSecret]

  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingPayload))
    const expected = hex(digest)

    if (signatures.some((signature) => secureEqual(signature, expected))) return
  }

  throw new Error('No Stripe webhook signatures matched the expected signature.')
}
