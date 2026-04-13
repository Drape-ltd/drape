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
  webhookSecret: string
}) {
  const { payload, signatureHeader, webhookSecret } = options
  const { timestamp, signatures } = parseStripeSignature(signatureHeader)

  if (Math.abs(Date.now() / 1000 - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook signature timestamp is outside the allowed tolerance.')
  }

  const signingPayload = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingPayload))
  const expected = hex(digest)

  if (!signatures.some((signature) => secureEqual(signature, expected))) {
    throw new Error('No Stripe webhook signatures matched the expected signature.')
  }
}
