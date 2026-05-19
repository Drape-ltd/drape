export const REAUTH_PROOF_WINDOW_MS = 5 * 60 * 1000

export const REAUTH_PROOF_PURPOSES = [
  'ACCOUNT_DELETION',
  'EMAIL_CHANGE',
  'PASSWORD_CHANGE',
  'PHONE_CHANGE',
  'PAYOUT_ACCOUNT_CHANGE',
] as const

export type ReauthProofPurpose = typeof REAUTH_PROOF_PURPOSES[number]

export type ReauthProofPayload = {
  v: 1
  userId: string
  purpose: ReauthProofPurpose
  issuedAt: number
  expiresAt: number
  nonce: string
}

type SecretOptions = {
  secret?: string
}

type TimeOptions = {
  now?: () => number
  ttlMs?: number
}

export type VerifyReauthProofFailureCode =
  | 'REAUTH_PROOF_REQUIRED'
  | 'REAUTH_PROOF_MALFORMED'
  | 'REAUTH_PROOF_SECRET_MISSING'
  | 'REAUTH_PROOF_INVALID'
  | 'REAUTH_PROOF_EXPIRED'
  | 'REAUTH_PROOF_NOT_YET_VALID'
  | 'REAUTH_PROOF_USER_MISMATCH'
  | 'REAUTH_PROOF_PURPOSE_MISMATCH'

export type VerifyReauthProofResult =
  | { ok: true; payload: ReauthProofPayload }
  | { ok: false; code: VerifyReauthProofFailureCode; message: string; actual?: unknown }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAX_CLOCK_SKEW_MS = 30_000

function getReauthSecret(secret?: string) {
  const value =
    secret ??
    Deno.env.get('REAUTH_PROOF_SECRET') ??
    Deno.env.get('DRAPE_REAUTH_PROOF_SECRET') ??
    Deno.env.get('VERIFICATION_SECRET')

  if (!value?.trim()) return null
  return value.trim()
}

export function hasReauthProofSecret(options: SecretOptions = {}) {
  return !!getReauthSecret(options.secret)
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function getHmacKey(secret: string) {
  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signPayload(payloadPart: string, secret: string) {
  const key = await getHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart))
  return base64UrlEncode(new Uint8Array(signature))
}

async function verifySignature(payloadPart: string, signaturePart: string, secret: string) {
  try {
    const key = await getHmacKey(secret)
    return await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart),
      encoder.encode(payloadPart),
    )
  } catch {
    return false
  }
}

function isPurpose(value: unknown): value is ReauthProofPurpose {
  return typeof value === 'string' && REAUTH_PROOF_PURPOSES.includes(value as ReauthProofPurpose)
}

function parsePayload(payloadPart: string): ReauthProofPayload | null {
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlDecode(payloadPart))) as Partial<ReauthProofPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.userId !== 'string' ||
      !isPurpose(parsed.purpose) ||
      typeof parsed.issuedAt !== 'number' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.nonce !== 'string'
    ) {
      return null
    }

    return {
      v: 1,
      userId: parsed.userId,
      purpose: parsed.purpose,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      nonce: parsed.nonce,
    }
  } catch {
    return null
  }
}

export async function issueReauthProof(
  input: {
    userId: string
    purpose: ReauthProofPurpose
  },
  options: SecretOptions & TimeOptions = {},
): Promise<{ proof: string; payload: ReauthProofPayload }> {
  const secret = getReauthSecret(options.secret)
  if (!secret) throw new Error('Missing REAUTH_PROOF_SECRET.')

  const issuedAt = options.now?.() ?? Date.now()
  const expiresAt = issuedAt + (options.ttlMs ?? REAUTH_PROOF_WINDOW_MS)
  const payload: ReauthProofPayload = {
    v: 1,
    userId: input.userId,
    purpose: input.purpose,
    issuedAt,
    expiresAt,
    nonce: crypto.randomUUID(),
  }
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const signaturePart = await signPayload(payloadPart, secret)

  return {
    proof: `${payloadPart}.${signaturePart}`,
    payload,
  }
}

export async function verifyReauthProof(
  proof: string | null | undefined,
  input: {
    userId: string
    purpose: ReauthProofPurpose
  },
  options: SecretOptions & TimeOptions = {},
): Promise<VerifyReauthProofResult> {
  if (!proof?.trim()) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_REQUIRED',
      message: 'Confirm your password again before continuing.',
    }
  }

  const secret = getReauthSecret(options.secret)
  if (!secret) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_SECRET_MISSING',
      message: 'Drape could not verify your recent password confirmation. Try again in a moment.',
    }
  }

  const [payloadPart, signaturePart, extraPart] = proof.trim().split('.')
  if (!payloadPart || !signaturePart || extraPart) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_MALFORMED',
      message: 'Confirm your password again before continuing.',
    }
  }

  const signatureValid = await verifySignature(payloadPart, signaturePart, secret)
  if (!signatureValid) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_INVALID',
      message: 'Confirm your password again before continuing.',
    }
  }

  const payload = parsePayload(payloadPart)
  if (!payload) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_MALFORMED',
      message: 'Confirm your password again before continuing.',
    }
  }

  const now = options.now?.() ?? Date.now()
  if (payload.issuedAt - now > MAX_CLOCK_SKEW_MS) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_NOT_YET_VALID',
      message: 'Confirm your password again before continuing.',
      actual: { issuedAt: payload.issuedAt, now },
    }
  }

  if (now > payload.expiresAt) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_EXPIRED',
      message: 'Your password confirmation expired. Confirm your password again before continuing.',
      actual: { expiresAt: payload.expiresAt, now },
    }
  }

  if (payload.userId !== input.userId) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_USER_MISMATCH',
      message: 'Confirm your password again before continuing.',
      actual: { proofUserId: payload.userId, expectedUserId: input.userId },
    }
  }

  if (payload.purpose !== input.purpose) {
    return {
      ok: false,
      code: 'REAUTH_PROOF_PURPOSE_MISMATCH',
      message: 'Confirm your password again before continuing.',
      actual: { proofPurpose: payload.purpose, expectedPurpose: input.purpose },
    }
  }

  return { ok: true, payload }
}
