type AccessJwtHeader = {
  alg?: string
  kid?: string
}

export type AccessJwtPayload = {
  aud?: string | string[]
  email?: string
  exp?: number
  amr?: string[] | string
  iat?: number
  iss?: string
  nbf?: number
  sub?: string
}

type AccessJsonWebKey = JsonWebKey & { kid?: string }

type AccessCertResponse = {
  keys?: AccessJsonWebKey[]
  jwt_signing_keys?: AccessJsonWebKey[]
}

export type VerifiedOpsAccessIdentity = {
  email: string
  subject: string
  audiences: string[]
  authenticationMethods: string[]
  issuedAt: number
  expiresAt: number
  sensitiveAssurance: boolean
}

type VerifyOptions = {
  fetcher?: typeof fetch
  nowSeconds?: number
}

const encoder = new TextEncoder()
const MFA_METHODS = new Set(['mfa', 'hwk', 'swk', 'otp', 'face', 'fpt', 'iris', 'retina', 'vbm'])
const CLOCK_SKEW_SECONDS = 30
const CACHE_TTL_MS = 15 * 60 * 1000
let cachedKeys: { teamDomain: string; fetchedAt: number; keys: AccessJsonWebKey[] } | null = null

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T
  } catch {
    return null
  }
}

function normalizeList(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return values.map((entry) => entry.trim().toLowerCase()).filter(Boolean)
}

async function accessKeys(teamDomain: string, fetcher: typeof fetch) {
  const now = Date.now()
  if (cachedKeys?.teamDomain === teamDomain && now - cachedKeys.fetchedAt < CACHE_TTL_MS) return cachedKeys.keys

  const response = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Cloudflare Access certificates returned ${response.status}.`)
  const body = await response.json() as AccessCertResponse
  const keys = [...(body.keys ?? []), ...(body.jwt_signing_keys ?? [])]
    .filter((key) => key.kty === 'RSA' && typeof key.n === 'string' && typeof key.e === 'string')
  if (keys.length === 0) throw new Error('Cloudflare Access did not return a usable RSA signing key.')
  cachedKeys = { teamDomain, fetchedAt: now, keys }
  return keys
}

export async function verifyCloudflareOpsAccess(
  token: string,
  config: {
    teamDomain: string
    normalAudiences: string[]
    sensitiveAudiences: string[]
    requireSensitive: boolean
    allowedEmailDomain?: string
    allowedEmails?: string[]
  },
  options: VerifyOptions = {},
): Promise<VerifiedOpsAccessIdentity | null> {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.trim().split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null
  const header = decodeJson<AccessJwtHeader>(encodedHeader)
  const payload = decodeJson<AccessJwtPayload>(encodedPayload)
  if (!header || !payload || header.alg !== 'RS256') return null

  const teamDomain = config.teamDomain.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/\/+$/u, '')
  if (!teamDomain || payload.iss !== `https://${teamDomain}`) return null
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return null
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf))) return null
  if (payload.iat > now + CLOCK_SKEW_SECONDS) return null
  if (payload.exp <= now - CLOCK_SKEW_SECONDS || payload.exp <= payload.iat) return null
  if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) return null
  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) return null
  if (typeof payload.email !== 'string' || payload.email.trim().length === 0) return null

  const audiences = normalizeList(payload.aud)
  const accepted = new Set((config.requireSensitive ? config.sensitiveAudiences : [...config.normalAudiences, ...config.sensitiveAudiences]).map((entry) => entry.trim().toLowerCase()))
  if (accepted.size === 0 || !audiences.some((audience) => accepted.has(audience))) return null

  const keys = (await accessKeys(teamDomain, options.fetcher ?? fetch))
    .filter((key) => !header.kid || !key.kid || key.kid === header.kid)
  const signature = decodeBase64Url(encodedSignature)
  const signed = encoder.encode(`${encodedHeader}.${encodedPayload}`)
  let signatureValid = false
  for (const jwk of keys) {
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)) {
        signatureValid = true
        break
      }
    } catch {
      // Ignore malformed or unsupported keys; the assertion still fails closed.
    }
  }
  if (!signatureValid) return null

  const email = payload.email?.trim().toLowerCase() ?? ''
  const allowedDomain = (config.allowedEmailDomain ?? 'drapeon.co').trim().toLowerCase()
  const allowedEmails = new Set((config.allowedEmails ?? []).map((entry) => entry.trim().toLowerCase()))
  if (!email || (!email.endsWith(`@${allowedDomain}`) && !allowedEmails.has(email))) return null

  const authenticationMethods = normalizeList(payload.amr)
  const issuedAt = payload.iat
  const sensitiveAssurance = audiences.some((audience) => config.sensitiveAudiences.map((entry) => entry.toLowerCase()).includes(audience))
    && authenticationMethods.some((method) => MFA_METHODS.has(method))
    && now - issuedAt <= 15 * 60
  if (config.requireSensitive && !sensitiveAssurance) return null

  return {
    email,
    subject: payload.sub.trim(),
    audiences,
    authenticationMethods,
    issuedAt,
    expiresAt: payload.exp,
    sensitiveAssurance,
  }
}

export function resetOpsAccessKeyCacheForTests() {
  cachedKeys = null
}
