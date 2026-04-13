import { getPaystackSecretKey } from './env.ts'

const PAYSTACK_API_BASE = 'https://api.paystack.co'
const textEncoder = new TextEncoder()

export type PaystackTransaction = {
  id?: number
  status: string
  reference: string
  amount: number
  currency: string
  authorization_url?: string | null
  access_code?: string | null
  gateway_response?: string | null
  message?: string | null
  metadata?: Record<string, unknown> | null
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getPaystackSecretKey()}`,
  }
}

async function parsePaystackError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => ({}))
  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : `Paystack request failed with status ${response.status}`
  throw new Error(message)
}

export async function initializePaystackTransaction(options: {
  amount: number
  currency: string
  email: string
  reference: string
  callbackUrl: string
  metadata?: Record<string, unknown>
}): Promise<PaystackTransaction> {
  const response = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(options.amount),
      currency: options.currency.toUpperCase(),
      email: options.email,
      reference: options.reference,
      callback_url: options.callbackUrl,
      metadata: options.metadata ?? {},
    }),
  })

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.reference || !payload?.data?.authorization_url) {
    throw new Error('Paystack did not return a usable checkout session.')
  }

  return payload.data as PaystackTransaction
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackTransaction> {
  const response = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  })

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.reference) {
    throw new Error('Paystack did not return a valid verification payload.')
  }

  return payload.data as PaystackTransaction
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

export async function verifyPaystackWebhookSignature(options: {
  payload: string
  signatureHeader: string
}) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getPaystackSecretKey()),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(options.payload))
  const expected = hex(digest)

  if (!secureEqual(options.signatureHeader, expected)) {
    throw new Error('No Paystack webhook signatures matched the expected signature.')
  }
}
