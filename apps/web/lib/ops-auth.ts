import 'server-only'

import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'
import { cookies, headers } from 'next/headers'
import type { OpsRole } from './ops-console'

export const OPS_SESSION_COOKIE = 'drape_ops_session'
export const OPS_DASHBOARD_TOKEN_MIN_LENGTH = 32

type OpsAccessMode = 'bootstrap-token' | 'cloudflare-access' | 'local-workforce'
type OpsDashboardTokenStatus = 'missing' | 'weak' | 'ready'

export type OpsSession = {
  allowed: boolean
  mode: OpsAccessMode
  role: OpsRole
  email: string | null
  subject: string
  authenticationMethods: string[]
  authenticatedAt: number | null
  expiresAt: number | null
  mfaVerified: boolean
}

export function hasFreshOpsMfa(session: OpsSession, maxAgeSeconds = 15 * 60) {
  if (!session.mfaVerified || session.authenticatedAt == null) return false
  return Math.floor(Date.now() / 1000) - session.authenticatedAt <= maxAgeSeconds
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

function normalizeOpsRole(value: string | null | undefined): OpsRole {
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
    default:
      return 'admin'
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

export function getOpsBootstrapRole(): OpsRole {
  return normalizeOpsRole(process.env.OPS_DASHBOARD_BOOTSTRAP_ROLE)
}

function getLocalWorkforceDryRunIdentity() {
  if (process.env.NODE_ENV === 'production' || process.env.OPS_LOCAL_WORKFORCE_DRY_RUN !== '1') return null
  const email = process.env.OPS_LOCAL_WORKFORCE_EMAIL?.trim().toLowerCase() ?? ''
  if (!email.endsWith('@drapeon.co')) return null
  return {
    email,
    role: normalizeOpsRole(process.env.OPS_LOCAL_WORKFORCE_ROLE),
  }
}

export function getOpsAccessMode(): OpsAccessMode | 'unconfigured' {
  const teamDomain = normalizeHost(process.env.CF_ACCESS_TEAM_DOMAIN)
  const audiences = parseCsv(process.env.CF_ACCESS_AUD)
  const bootstrapAllowed =
    process.env.NODE_ENV !== 'production' ||
    process.env.OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION === '1'

  if (teamDomain && audiences.size > 0) return 'cloudflare-access'
  if (getLocalWorkforceDryRunIdentity() && hasOpsDashboardToken()) return 'local-workforce'
  if (bootstrapAllowed && hasOpsDashboardToken()) return 'bootstrap-token'
  return 'unconfigured'
}

export function hasOpsWorkforceAccessConfig() {
  return getOpsAccessMode() === 'cloudflare-access'
}

export function hashOpsToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
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
    return cachedAccessCerts.keys
  }

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

  return keys
}

function normalizeGroups(groups: AccessJwtPayload['groups']) {
  if (Array.isArray(groups)) {
    return groups.map((group) => group.trim().toLowerCase()).filter(Boolean)
  }

  if (typeof groups === 'string') {
    return groups
      .split(',')
      .map((group) => group.trim().toLowerCase())
      .filter(Boolean)
  }

  return []
}

function normalizeAuthenticationMethods(value: AccessJwtPayload['amr']) {
  const methods = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return methods.map((method) => method.trim().toLowerCase()).filter(Boolean)
}

const MFA_AUTHENTICATION_METHODS = new Set(['mfa', 'hwk', 'swk', 'otp', 'face', 'fpt', 'iris', 'retina', 'vbm'])

function determineWorkforceRole(email: string, groups: string[]): OpsRole | null {
  const normalizedEmail = email.trim().toLowerCase()
  const emailSets = {
    admin: parseCsv(process.env.OPS_ADMIN_EMAILS),
    ops: parseCsv(process.env.OPS_OPS_EMAILS),
    customer_success: parseCsv(process.env.OPS_CUSTOMER_SUCCESS_EMAILS),
    trust: parseCsv(process.env.OPS_TRUST_EMAILS),
    finance: parseCsv(process.env.OPS_FINANCE_EMAILS),
    engineering: parseCsv(process.env.OPS_ENGINEERING_EMAILS),
  }

  const groupSets = {
    admin: parseCsv(process.env.OPS_ADMIN_GROUPS),
    ops: parseCsv(process.env.OPS_OPS_GROUPS),
    customer_success: parseCsv(process.env.OPS_CUSTOMER_SUCCESS_GROUPS),
    trust: parseCsv(process.env.OPS_TRUST_GROUPS),
    finance: parseCsv(process.env.OPS_FINANCE_GROUPS),
    engineering: parseCsv(process.env.OPS_ENGINEERING_GROUPS),
  }

  const groupList = new Set(groups)
  const roleOrder: OpsRole[] = ['admin', 'engineering', 'finance', 'trust', 'customer_success', 'ops']

  for (const role of roleOrder) {
    if (emailSets[role].has(normalizedEmail)) return role

    for (const group of groupSets[role]) {
      if (groupList.has(group)) return role
    }
  }

  return null
}

async function getWorkforceSession(): Promise<OpsSession | null> {
  const teamDomain = normalizeHost(process.env.CF_ACCESS_TEAM_DOMAIN)
  const audiences = [...parseCsv(process.env.CF_ACCESS_AUD)]
  if (!teamDomain || audiences.length === 0) return null

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

  if (!payloadAudiences.some((audience) => audiences.includes(audience.toLowerCase()))) {
    return null
  }

  const expectedIssuer = `https://${teamDomain}`
  if (parsed.payload.iss !== expectedIssuer) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof parsed.payload.nbf === 'number' && parsed.payload.nbf > now) return null
  if (typeof parsed.payload.exp === 'number' && parsed.payload.exp <= now) return null

  const candidateKeys = (await getAccessPublicKeys(teamDomain)).filter(
    (key) => !parsed.header.kid || !key.kid || key.kid === parsed.header.kid,
  )

  const signingInput = Buffer.from(parsed.signingInput, 'utf8')
  const signature = parsed.signature

  const verified = candidateKeys.some((entry) =>
    verifySignature('RSA-SHA256', signingInput, entry.key, signature),
  )

  if (!verified) return null

  const email = parsed.payload.email?.trim().toLowerCase() ?? assertedEmail
  if (!email || !emailMatchesAllowedDomainOrList(email, allowedDomain, allowedEmails)) {
    return null
  }

  if (assertedEmail && assertedEmail !== email) {
    return null
  }

  const role = determineWorkforceRole(email, normalizeGroups(parsed.payload.groups))
  if (!role) return null

  return {
    allowed: true,
    mode: 'cloudflare-access',
    role,
    email,
    subject: parsed.payload.sub?.trim() || email,
    authenticationMethods: normalizeAuthenticationMethods(parsed.payload.amr),
    authenticatedAt: typeof parsed.payload.iat === 'number' ? parsed.payload.iat : null,
    expiresAt: typeof parsed.payload.exp === 'number' ? parsed.payload.exp : null,
    mfaVerified: normalizeAuthenticationMethods(parsed.payload.amr).some((method) => MFA_AUTHENTICATION_METHODS.has(method)),
  }
}

async function getBootstrapSession(): Promise<OpsSession | null> {
  const token = getOpsDashboardToken()
  if (!token) return null

  const cookieStore = await cookies()
  const session = cookieStore.get(OPS_SESSION_COOKIE)?.value ?? null
  if (!safeCompare(session, hashOpsToken(token))) return null

  const localIdentity = getLocalWorkforceDryRunIdentity()
  if (localIdentity) {
    const authenticatedAt = Math.floor(Date.now() / 1000)
    return {
      allowed: true,
      mode: 'local-workforce',
      role: localIdentity.role,
      email: localIdentity.email,
      subject: `local-dry-run:${localIdentity.email}`,
      authenticationMethods: ['mfa', 'local-dry-run'],
      authenticatedAt,
      expiresAt: authenticatedAt + 15 * 60,
      mfaVerified: true,
    }
  }

  return {
    allowed: true,
    mode: 'bootstrap-token',
    role: getOpsBootstrapRole(),
    email: null,
    subject: `bootstrap:${getOpsBootstrapRole()}`,
    authenticationMethods: [],
    authenticatedAt: null,
    expiresAt: null,
    mfaVerified: false,
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
