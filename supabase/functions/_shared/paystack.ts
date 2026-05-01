import { getPaystackSecretKey } from './env.ts'

const PAYSTACK_API_BASE = 'https://api.paystack.co'
const PAYSTACK_REQUEST_TIMEOUT_MS = 8_000
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

export type PaystackRefund = {
  id?: number
  status?: string | null
  transaction?: number | string | null
  amount?: number | null
  currency?: string | null
  customer_note?: string | null
  merchant_note?: string | null
}

export type PaystackBank = {
  id?: number
  name: string
  code: string
  country?: string | null
  currency?: string | null
  type?: string | null
  active?: boolean | null
}

export type PaystackResolvedAccount = {
  account_number: string
  account_name: string
  bank_id?: number | null
}

export type PaystackTransferRecipient = {
  recipient_code: string
  type?: string | null
  name?: string | null
  currency?: string | null
  active?: boolean | null
}

export type PaystackTransfer = {
  id?: number
  status?: string | null
  reference?: string | null
  transfer_code?: string | null
  amount?: number | null
  currency?: string | null
}

const FALLBACK_PAYSTACK_BANKS_NG: PaystackBank[] = [
  { name: 'Access Bank', code: '044', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Ecobank Nigeria', code: '050', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Fidelity Bank', code: '070', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'First Bank of Nigeria', code: '011', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'First City Monument Bank', code: '214', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Guaranty Trust Bank', code: '058', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Keystone Bank', code: '082', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Polaris Bank', code: '076', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Stanbic IBTC Bank', code: '221', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Sterling Bank', code: '232', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Union Bank of Nigeria', code: '032', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'United Bank For Africa', code: '033', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Wema Bank', code: '035', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
  { name: 'Zenith Bank', code: '057', country: 'Nigeria', currency: 'NGN', type: 'nuban', active: true },
]

function authHeaders() {
  return {
    Authorization: `Bearer ${getPaystackSecretKey()}`,
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

async function fetchPaystack(url: string, init: RequestInit, context: string) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Paystack ${context} timed out. Please try again.`)
    }
    throw error
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
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transaction/initialize`, {
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
  }, 'transaction initialization')

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
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  }, 'payment verification')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.reference) {
    throw new Error('Paystack did not return a valid verification payload.')
  }

  return payload.data as PaystackTransaction
}

export async function refundPaystackTransaction(options: {
  reference: string
  amount?: number
  currency?: string | null
  reasonNote?: string | null
}): Promise<PaystackRefund> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/refund`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transaction: options.reference,
      ...(typeof options.amount === 'number' && options.amount > 0 ? { amount: options.amount } : {}),
      ...(options.currency?.trim() ? { currency: options.currency.trim().toUpperCase() } : {}),
      ...(options.reasonNote?.trim()
        ? {
            customer_note: options.reasonNote.trim(),
            merchant_note: options.reasonNote.trim(),
          }
        : {}),
    }),
  }, 'refund request')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status) {
    throw new Error('Paystack did not confirm the refund request.')
  }

  return payload.data as PaystackRefund
}

function paystackCountryQueryValue(countryCode: string | null | undefined) {
  const normalized = countryCode?.trim().toUpperCase() ?? ''
  if (normalized === 'NG') return 'nigeria'
  if (normalized === 'GH') return 'ghana'
  if (normalized === 'KE') return 'kenya'
  return null
}

export async function listPaystackBanks(options: {
  countryCode?: string | null
  currency?: string | null
}): Promise<PaystackBank[]> {
  const url = new URL(`${PAYSTACK_API_BASE}/bank`)
  const country = paystackCountryQueryValue(options.countryCode)
  if (country) url.searchParams.set('country', country)
  if (options.currency?.trim()) url.searchParams.set('currency', options.currency.trim().toUpperCase())
  url.searchParams.set('use_cursor', 'false')

  const response = await fetchPaystack(url.toString(), {
    headers: authHeaders(),
  }, 'bank list lookup')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !Array.isArray(payload?.data)) {
    throw new Error('Paystack did not return a usable bank list.')
  }

  return payload.data as PaystackBank[]
}

export function fallbackPaystackBanks(options: {
  countryCode?: string | null
  currency?: string | null
}): PaystackBank[] {
  const country = options.countryCode?.trim().toUpperCase() ?? ''
  const currency = options.currency?.trim().toUpperCase() ?? ''
  if (country === 'NG' || currency === 'NGN') {
    return FALLBACK_PAYSTACK_BANKS_NG
  }
  return []
}

export async function resolvePaystackAccountNumber(options: {
  accountNumber: string
  bankCode: string
  currency?: string | null
}): Promise<PaystackResolvedAccount> {
  const url = new URL(`${PAYSTACK_API_BASE}/bank/resolve`)
  url.searchParams.set('account_number', options.accountNumber.trim())
  url.searchParams.set('bank_code', options.bankCode.trim())
  if (options.currency?.trim()) {
    url.searchParams.set('currency', options.currency.trim().toUpperCase())
  }

  const response = await fetchPaystack(url.toString(), {
    headers: authHeaders(),
  }, 'account verification')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.account_name || !payload?.data?.account_number) {
    throw new Error('Paystack could not verify this bank account.')
  }

  return payload.data as PaystackResolvedAccount
}

export async function createPaystackTransferRecipient(options: {
  name: string
  accountNumber: string
  bankCode: string
  currency: string
}): Promise<PaystackTransferRecipient> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transferrecipient`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'nuban',
      name: options.name.trim(),
      account_number: options.accountNumber.trim(),
      bank_code: options.bankCode.trim(),
      currency: options.currency.trim().toUpperCase(),
    }),
  }, 'transfer recipient setup')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.recipient_code) {
    throw new Error('Paystack did not return a usable transfer recipient.')
  }

  return payload.data as PaystackTransferRecipient
}

export async function createPaystackTransfer(options: {
  amount: number
  recipientCode: string
  reason: string
  reference: string
  currency?: string | null
}): Promise<PaystackTransfer> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transfer`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'balance',
      amount: options.amount,
      recipient: options.recipientCode.trim(),
      reason: options.reason.trim(),
      reference: options.reference.trim(),
      ...(options.currency?.trim() ? { currency: options.currency.trim().toUpperCase() } : {}),
    }),
  }, 'transfer request')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data) {
    throw new Error('Paystack did not confirm the transfer request.')
  }

  return payload.data as PaystackTransfer
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
