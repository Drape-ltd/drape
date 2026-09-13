import 'server-only'

import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'
import { cookies, headers } from 'next/headers'
import type { OpsRole } from './ops-console'
import {
  accessCertificateAllowsSensitiveAction,
  accessCertificateFallbackState,
} from './ops-access-certificate-policy.mjs'
import { hasValidOpsAccessTokenClaims } from './ops-access-token-policy.mjs'

export const OPS_SESSION_COOKIE = 'drape_ops_session'
export const OPS_DASHBOARD_TOKEN_MIN_LENGTH = 32

type OpsAccessMode = 'bootstrap-token' | 'cloudflare-access' | 'local-workforce'
type OpsDashboardTokenStatus = 'missing' | 'weak' | 'ready'

export type OpsSession = {
  allowed: boolean
  mode: OpsAccessMode
  role: OpsRole
  principalId: string | null
  email: string | null
  subject: string
  audiences: string[]
  authenticationMethods: string[]
  authenticatedAt: number | null
  expiresAt: number | null
  mfaVerified: boolean
  accessKeyState: 'fresh' | 'stale' | 'not-applicable'
  accessKeyAgeMs: number | null
}

export function hasFreshOpsMfa(session: OpsSession, maxAgeSeconds = 15 * 60) {
  if (session.mode === 'local-workforce') {
    if (!session.mfaVerified || session.authenticatedAt == null) return false
    return Math.floor(Date.now() / 1000) - session.authenticatedAt <= maxAgeSeconds
  }

  if (session.mode !== 'cloudflare-access') return false
  if (!accessCertificateAllowsSensitiveAction(session.accessKeyState)) {
    console.warn('[ops-auth] sensitive access rejected', { reason: 'access-key-state', accessKeyState: session.accessKeyState })
    return false
  }
  const sensitiveAudiences = parseCsv(process.env.CF_ACCESS_SENSITIVE_AUD)
  if (sensitiveAudiences.size === 0) {
    console.warn('[ops-auth] sensitive access rejected', { reason: 'sensitive-audience-missing' })
    return false
  }
  if (!session.audiences.some((audience) => sensitiveAudiences.has(audience.toLowerCase()))) {
    console.warn('[ops-auth] sensitive access rejected', { reason: 'sensitive-audience-mismatch' })
    return false
  }
  if (session.authenticatedAt == null) {
    console.warn('[ops-auth] sensitive access rejected', { reason: 'authenticated-at-missing' })
    return false
  }
  // Independent MFA is enforced by the dedicated Cloudflare Access application.
  // Cloudflare's application JWT proves that policy was passed through its exact
  // audience, while `amr` only reports methods asserted by the upstream IdP and
  // is not populated when Access itself performs the second factor.
  const tokenAgeSeconds = Math.floor(Date.now() / 1000) - session.authenticatedAt
  if (tokenAgeSeconds > maxAgeSeconds) {
    console.warn('[ops-auth] sensitive access rejected', { reason: 'token-too-old', tokenAgeSeconds, maxAgeSeconds })
    return false
  }
  return true
}

export function isNamedOpsWorkforceSession(session: OpsSession) {
  return session.mode === 'cloudflare-access' || session.mode === 'local-workforce'
}

export function getOpsIdentityAssuranceSource(session: OpsSession) {
  return session.mode === 'local-workforce' ? 'MIGRATION_DRY_RUN' : 'CLOUDFLARE_ACCESS'
}

type AccessJwtHeader = {
  alg?: string
  kid?: string
  typ?: string
}

type AccessJwtPayload = {
  aud?: string | string[]
  email?: string
  exp?: number
  groups?: string[] | string
  amr?: string[] | string
  iat?: number
  iss?: string
  nbf?: number
  sub?: string
}

type AccessPublicKey = {
  kid: string | null
  key: KeyObject
}

type AccessCertResponse = {
  keys?: JsonWebKey[]
  jwt_signing_keys?: JsonWebKey[]
  public_cert?: string
  public_certs?: string[]
}

const ACCESS_CERT_CACHE_TTL_MS = 15 * 60 * 1000
let cachedAccessCerts:
  | {
      key: string
      fetchedAt: number
      keys: AccessPublicKey[]
    }
  | null = null

export function getOpsDashboardToken() {
  const token = process.env.OPS_DASHBOARD_TOKEN?.trim()
  return token && token.length > 0 && getOpsDashboardTokenStatus() === 'ready' ? token : null
}

export function getOpsDashboardTokenStatus(): OpsDashboardTokenStatus {
  const token = process.env.OPS_DASHBOARD_TOKEN?.trim()
  if (!token) return 'missing'

  const normalized = token.toLowerCase()
  if (
    token.length < OPS_DASHBOARD_TOKEN_MIN_LENGTH ||
    normalized === 'your_internal_ops_token_here' ||
    normalized.includes('change_me') ||
    normalized.includes('changeme') ||
    normalized.includes('password')
  ) {
    return 'weak'
  }

  return 'ready'
}

export function hasOpsDashboardToken() {
  return getOpsDashboardToken() !== null
}

function normalizeOpsRole(value: string | null | undefined): OpsRole | null {
  const normalized = value?.trim().toLowerCase()

  switch (normalized) {
    case 'ops':
      return 'ops'
    case 'customer_success':
    case 'customer-success':
    case 'customersuccess':
      return 'customer_success'
    case 'trust':
      return 'trust'
    case 'finance':
      return 'finance'
    case 'engineering':
    case 'eng':
      return 'engineering'
    case 'admin':
      return 'admin'
    default:
      return null
  }
}

function normalizeHost(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return normalized && normalized.length > 0 ? normalized : null
}

function parseCsv(value: string | null | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
}

function emailMatchesAllowedDomainOrList(email: string, allowedDomain: string | null, allowedEmails: Set<string>) {
  const normalizedEmail = email.trim().toLowerCase()
  if (allowedEmails.has(normalizedEmail)) return true
  if (!allowedDomain) return false
  return normalizedEmail.endsWith(`@${allowedDomain}`)
}

export function getOpsBootstrapRole(): OpsRole | null {
  return normalizeOpsRole(process.env.OPS_DASHBOARD_BOOTSTRAP_ROLE)
}

export type LocalWorkforceDryRunIdentity = {
  key: 'reviewer' | 'founder'
  label: string
  email: string
  role: OpsRole
}

export function getLocalWorkforceDryRunIdentity(): LocalWorkforceDryRunIdentity | null {
  if (process.env.NODE_ENV === 'production' || process.env.OPS_LOCAL_WORKFORCE_DRY_RUN !== '1') return null
  const email = process.env.OPS_LOCAL_WORKFORCE_EMAIL?.trim().toLowerCase() ?? ''
  const role = normalizeOpsRole(process.env.OPS_LOCAL_WORKFORCE_ROLE)
  if (!email.endsWith('@drapeon.co') || !role) return null

  const founderEmail = (process.env.OPS_MONEY_APPROVER_EMAILS ?? 'founders@drapeon.co')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .find((entry) => entry.endsWith('@drapeon.co'))
  const founder = founderEmail === email && role === 'admin'

  return {
    key: founder ? 'founder' : 'reviewer',
    label: founder ? 'Founder approver' : 'Ops reviewer',
    email,
    role,
  }
}

export function getOpsAccessMode(): OpsAccessMode | 'unconfigured' {
  const teamDomain = normalizeHost(process.env.CF_ACCESS_TEAM_DOMAIN)
  const audiences = parseCsv(process.env.CF_ACCESS_AUD)
  if (teamDomain && audiences.size > 0) return 'cloudflare-access'
  if (process.env.NODE_ENV === 'production') return 'unconfigured'
  if (getLocalWorkforceDryRunIdentity() && hasOpsDashboardToken()) return 'local-workforce'
  if (hasOpsDashboardToken() && getOpsBootstrapRole()) return 'bootstrap-token'
  return 'unconfigured'
}

export function hasOpsWorkforceAccessConfig() {
  return getOpsAccessMode() === 'cloudflare-access'
}

export function hashOpsToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createLocalWorkforceSessionValue(identity: LocalWorkforceDryRunIdentity) {
  const token = getOpsDashboardToken()
  if (!token) return null
  return createHmac('sha256', token)
    .update(`local-workforce-v2:${identity.key}:${identity.email}:${identity.role}`)
    .digest('hex')
}

function safeCompare(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right || left.length !== right.length) return false

  try {
    return timingSafeEqual(Buffer.from(left), Buffer.from(right))
  } catch {
    return false
  }
}

export function matchesOpsDashboardToken(candidate: string | null | undefined) {
  return safeCompare(candidate?.trim() ?? null, getOpsDashboardToken())
}

export async function hasOpsAccess() {
  return (await getOpsSession())?.allowed === true
}

function decodeJwtPart<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

function parseJwt(jwt: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null

  const header = decodeJwtPart<AccessJwtHeader>(encodedHeader)
  const payload = decodeJwtPart<AccessJwtPayload>(encodedPayload)
  if (!header || !payload) return null

  return {
    header,
    payload,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, 'base64url'),
  }
}

function createPublicKeysFromResponse(json: AccessCertResponse): AccessPublicKey[] {
  const keys: AccessPublicKey[] = []
  const jwks = [...(json.keys ?? []), ...(json.jwt_signing_keys ?? [])]

  for (const jwk of jwks) {
    try {
      keys.push({
        kid: typeof jwk.kid === 'string' ? jwk.kid : null,
        key: createPublicKey({ key: jwk, format: 'jwk' }),
      })
    } catch {
      continue
    }
  }

  const pemCerts = [
    ...(typeof json.public_cert === 'string' ? [json.public_cert] : []),
    ...((json.public_certs ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  ]

  for (const pem of pemCerts) {
    try {
      keys.push({
        kid: null,
        key: createPublicKey(pem),
      })
    } catch {
      continue
    }
  }

  return keys
}

async function getAccessPublicKeys(teamDomain: string) {
  const cacheKey = teamDomain
  const now = Date.now()

  if (cachedAccessCerts && cachedAccessCerts.key === cacheKey && now - cachedAccessCerts.fetchedAt < ACCESS_CERT_CACHE_TTL_MS) {
    return { keys: cachedAccessCerts.keys, state: 'fresh' as const, ageMs: now - cachedAccessCerts.fetchedAt }
  }

  try {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Cloudflare Access cert fetch failed with ${response.status}`)
    }

    const json = (await response.json()) as AccessCertResponse
    const keys = createPublicKeysFromResponse(json)

    if (keys.length === 0) {
      throw new Error('Cloudflare Access cert response did not contain usable signing keys')
    }

    cachedAccessCerts = {
      key: cacheKey,
      fetchedAt: now,
      keys,
    }

    return { keys, state: 'fresh' as const, ageMs: 0 }
  } catch (error) {
    const ageMs = cachedAccessCerts ? now - cachedAccessCerts.fetchedAt : Number.POSITIVE_INFINITY
    if (accessCertificateFallbackState({
      ageMs,
      issuerMatches: cachedAccessCerts?.key === cacheKey,
      keyCount: cachedAccessCerts?.keys.length ?? 0,
    }) === 'stale' && cachedAccessCerts) {
      console.warn('[ops-auth] Cloudflare Access certificates are temporarily stale.', {
        ageMs,
        failureType: error instanceof Error ? error.name : 'UnknownError',
      })
      return { keys: cachedAccessCerts.keys, state: 'stale' as const, ageMs }
    }
    throw error
  }
}

function normalizeAuthenticationMethods(value: AccessJwtPayload['amr']) {
  const methods = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return methods.map((method) => method.trim().toLowerCase()).filter(Boolean)
}

const MFA_AUTHENTICATION_METHODS = new Set(['mfa', 'hwk', 'swk', 'otp', 'face', 'fpt', 'iris', 'retina', 'vbm'])

async function getWorkforceSession(): Promise<OpsSession | null> {
  const teamDomain = normalizeHost(process.env.CF_ACCESS_TEAM_DOMAIN)
  const primaryAudiences = [...parseCsv(process.env.CF_ACCESS_AUD)]
  const sensitiveAudiences = [...parseCsv(process.env.CF_ACCESS_SENSITIVE_AUD)]
  const acceptedAudiences = [...new Set([...primaryAudiences, ...sensitiveAudiences])]
  if (!teamDomain || primaryAudiences.length === 0) return null

  const allowedDomain = normalizeHost(process.env.OPS_ALLOWED_EMAIL_DOMAIN) ?? 'drapeon.co'
  const allowedEmails = parseCsv(process.env.OPS_ALLOWED_EMAILS)
  const headerStore = await headers()
  const jwt = headerStore.get('cf-access-jwt-assertion')?.trim() ?? ''
  const assertedEmail = headerStore.get('cf-access-authenticated-user-email')?.trim().toLowerCase() ?? null

  if (!jwt) return null

  const parsed = parseJwt(jwt)
  if (!parsed) return null

  if (parsed.header.alg !== 'RS256') return null

  const payloadAudiences = Array.isArray(parsed.payload.aud)
    ? parsed.payload.aud
    : typeof parsed.payload.aud === 'string'
      ? [parsed.payload.aud]
      : []

  if (!payloadAudiences.some((audience) => acceptedAudiences.includes(audience.toLowerCase()))) {
    return null
  }

  const expectedIssuer = `https://${teamDomain}`
  if (parsed.payload.iss !== expectedIssuer) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const issuedAt = parsed.payload.iat
  const expiresAt = parsed.payload.exp
  const signedSubject = parsed.payload.sub
  const signedEmail = parsed.payload.email
  if (
    typeof issuedAt !== 'number' ||
    typeof expiresAt !== 'number' ||
    typeof signedSubject !== 'string' ||
    typeof signedEmail !== 'string'
  ) {
    return null
  }
  if (!hasValidOpsAccessTokenClaims(parsed.payload, now)) return null

  const accessKeys = await getAccessPublicKeys(teamDomain)
  const candidateKeys = accessKeys.keys.filter(
    (key) => !parsed.header.kid || !key.kid || key.kid === parsed.header.kid,
  )

  const signingInput = Buffer.from(parsed.signingInput, 'utf8')
  const signature = parsed.signature

  const verified = candidateKeys.some((entry) =>
    verifySignature('RSA-SHA256', signingInput, entry.key, signature),
  )

  if (!verified) return null

  const email = signedEmail.trim().toLowerCase()
  if (!email || !emailMatchesAllowedDomainOrList(email, allowedDomain, allowedEmails)) {
    return null
  }

  if (assertedEmail && assertedEmail !== email) {
    return null
  }

  const subject = signedSubject.trim()
  const { getActiveOpsWorkforcePrincipal } = await import('./ops-workforce-principal')
  const principal = await getActiveOpsWorkforcePrincipal({
    email,
    subject,
    tokenIssuedAt: issuedAt,
  })
  if (!principal) return null

  return {
    allowed: true,
    mode: 'cloudflare-access',
    role: principal.role,
    principalId: principal.id,
    email,
    subject,
    audiences: payloadAudiences,
    authenticationMethods: normalizeAuthenticationMethods(parsed.payload.amr),
    authenticatedAt: issuedAt,
    expiresAt,
    mfaVerified: normalizeAuthenticationMethods(parsed.payload.amr).some((method) => MFA_AUTHENTICATION_METHODS.has(method)),
    accessKeyState: accessKeys.state,
    accessKeyAgeMs: accessKeys.ageMs,
  }
}

async function getBootstrapSession(): Promise<OpsSession | null> {
  const token = getOpsDashboardToken()
  if (!token) return null

  const cookieStore = await cookies()
  const expectedSession = hashOpsToken(token)
  const sessionCookies = cookieStore.getAll(OPS_SESSION_COOKIE)
  const localIdentity = getLocalWorkforceDryRunIdentity()

  if (localIdentity) {
    const expectedLocalSession = createLocalWorkforceSessionValue(localIdentity)
    if (!expectedLocalSession || !sessionCookies.some((cookie) => safeCompare(cookie.value, expectedLocalSession))) {
      return null
    }
    const authenticatedAt = Math.floor(Date.now() / 1000)
    return {
      allowed: true,
      mode: 'local-workforce',
      role: localIdentity.role,
      principalId: null,
      email: localIdentity.email,
      subject: `local-dry-run:${localIdentity.email}`,
      audiences: ['local-workforce'],
      authenticationMethods: ['mfa', 'local-dry-run'],
      authenticatedAt,
      expiresAt: authenticatedAt + 15 * 60,
      mfaVerified: true,
      accessKeyState: 'not-applicable',
      accessKeyAgeMs: null,
    }
  }

  if (!sessionCookies.some((cookie) => safeCompare(cookie.value, expectedSession))) return null

  const role = getOpsBootstrapRole()
  if (!role) return null
  return {
    allowed: true,
    mode: 'bootstrap-token',
    role,
    principalId: null,
    email: null,
    subject: `bootstrap:${role}`,
    audiences: [],
    authenticationMethods: [],
    authenticatedAt: null,
    expiresAt: null,
    mfaVerified: false,
    accessKeyState: 'not-applicable',
    accessKeyAgeMs: null,
  }
}

export async function getOpsSession(): Promise<OpsSession | null> {
  const mode = getOpsAccessMode()

  if (mode === 'cloudflare-access') {
    return getWorkforceSession()
  }

  if (mode === 'bootstrap-token' || mode === 'local-workforce') {
    return getBootstrapSession()
  }

  return null
}

export async function getOpsAccessIdentityHint(): Promise<string | null> {
  if (getOpsAccessMode() !== 'cloudflare-access') return null

  const assertedEmail = (await headers())
    .get('cf-access-authenticated-user-email')
    ?.trim()
    .toLowerCase()

  return assertedEmail && assertedEmail.includes('@') ? assertedEmail : null
}
