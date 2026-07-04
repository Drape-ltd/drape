import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  RATE_LIMITS,
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  buildRateLimitKey,
  createRateLimitPayload,
  getRateLimitRetryAfter,
  type RateLimitResult,
} from '../../../packages/shared/src/rate-limit.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { Sentry } from './sentry.ts'

export { RATE_LIMITS }

const VIOLATION_ALERT_THRESHOLD = 5
const VIOLATION_WINDOW_MS = 10 * 60_000
const PAYMENT_ENDPOINTS = new Set([
  'payment-action',
  'payout-account-action',
  'payout-setup-request',
  'refund-order-payments',
  'release-order-payouts',
])
const AUTH_ENDPOINTS = new Set([
  'claim-passport',
  'handle-verification-decision',
  'account-profile-action',
  'account-security-action',
  'reauth-proof-action',
])
const WEBHOOK_ENDPOINTS = new Set([
  'stripe-webhook',
  'paystack-webhook',
  'delivery-webhook',
])
const UNAUTHENTICATED_ENDPOINTS = new Set([
  'currency-context',
  'tailor-application',
  'waitlist',
])

type RateLimitContext = {
  ip?: string | null
  userAgent?: string | null
  userId?: string | null
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for') ?? ''
  const cloudflareIp = req.headers.get('cf-connecting-ip') ?? ''
  const realIp = req.headers.get('x-real-ip') ?? ''
  const candidate = forwardedFor.split(',')[0]?.trim() || cloudflareIp.trim() || realIp.trim()
  return (candidate || 'unknown').slice(0, 128)
}

function toWindowSeconds(windowMs: number) {
  return Math.max(1, Math.ceil(windowMs / 1000))
}

function inferEndpointLimit(endpoint: string) {
  if (WEBHOOK_ENDPOINTS.has(endpoint)) return RATE_LIMITS.webhook
  if (PAYMENT_ENDPOINTS.has(endpoint)) return RATE_LIMITS.payment
  if (AUTH_ENDPOINTS.has(endpoint)) return RATE_LIMITS.auth
  if (UNAUTHENTICATED_ENDPOINTS.has(endpoint)) return RATE_LIMITS.unauthenticated
  return RATE_LIMITS.authenticated
}

function getViolationWindowStart() {
  const currentWindow = Math.floor(Date.now() / VIOLATION_WINDOW_MS) * VIOLATION_WINDOW_MS
  return new Date(currentWindow).toISOString()
}

async function recordRateLimitViolation(
  supabase: SupabaseClient,
  identifier: string,
  endpoint: string,
) {
  const key = buildRateLimitKey(identifier, `violation:${endpoint}`)
  const windowStart = getViolationWindowStart()
  const current = await supabase
    .from('rate_limit_counters')
    .select('count')
    .eq('key', key)
    .eq('window_start', windowStart)
    .maybeSingle()

  const nextCount = ((current.data as { count?: number } | null)?.count ?? 0) + 1
  const { error } = await supabase
    .from('rate_limit_counters')
    .upsert(
      { key, window_start: windowStart, count: nextCount },
      { onConflict: 'key,window_start' },
    )

  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      fn: 'rateLimit',
      event: 'violation_count_failed',
      endpoint,
      identifier,
      error: error.message,
    }))
  }

  return nextCount
}

async function alertOnRepeatedViolations(
  supabase: SupabaseClient,
  identifier: string,
  endpoint: string,
  violationCount: number,
  context: RateLimitContext,
) {
  if (violationCount < VIOLATION_ALERT_THRESHOLD) return

  const now = new Date().toISOString()
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'SYSTEM_ALERT',
    severity: 'HIGH',
    source: 'rate_limit',
    actorId: context.userId ?? null,
    actorRole: context.userId ? 'USER' : 'SYSTEM',
    userId: context.userId ?? null,
    title: 'Repeated rate limit violations',
    description: [
      `Identifier ${identifier} exceeded the ${endpoint} rate limit ${violationCount} times in the last 10 minutes.`,
      `IP: ${context.ip ?? 'unknown'}`,
      `User agent: ${context.userAgent ?? 'unknown'}`,
      `Timestamp: ${now}`,
    ].join('\n'),
    recommendedAction: 'Review traffic source, block abusive clients if needed, and confirm no credential stuffing or probing is underway.',
    dedupeKey: `rate-limit:${endpoint}:${identifier}`,
    metadata: {
      endpoint,
      identifier,
      violationCount,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      userId: context.userId ?? null,
      timestamp: now,
    },
  })

  await Sentry.captureMessage('Rate limit abuse detected', {
    level: 'warning',
    extra: {
      ip: context.ip ?? null,
      endpoint,
      violationCount,
      userId: context.userId ?? null,
      userAgent: context.userAgent ?? null,
    },
  })
}

export async function rateLimit(
  supabase: SupabaseClient,
  identifier: string,
  endpoint: string,
  limit: number,
  windowMs: number = RATE_LIMITS.authenticated.windowMs,
  context: RateLimitContext = {},
): Promise<RateLimitResult> {
  const retryAfter = getRateLimitRetryAfter(windowMs)
  const key = buildRateLimitKey(identifier, endpoint)
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_window_seconds: toWindowSeconds(windowMs),
    p_max_requests: limit,
  })

  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      fn: 'rateLimit',
      event: 'check_failed',
      endpoint,
      identifier,
      error: error.message,
    }))
    await Sentry.captureMessage('Rate limit check failed closed', {
      level: 'error',
      extra: {
        endpoint,
        identifier,
        ip: context.ip ?? null,
        userId: context.userId ?? null,
        error: error.message,
      },
    })
    return { allowed: false, retryAfter }
  }

  if (data === true) return { allowed: true }

  const violationCount = await recordRateLimitViolation(supabase, identifier, endpoint)
  await alertOnRepeatedViolations(supabase, identifier, endpoint, violationCount, context)
  return { allowed: false, retryAfter, violationCount }
}

export function rateLimitExceededResponse(
  cors: Record<string, string> = {},
  retryAfter = RATE_LIMIT_RETRY_AFTER_SECONDS,
) {
  return new Response(
    JSON.stringify(createRateLimitPayload(retryAfter)),
    {
      status: 429,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    },
  )
}

/**
 * Checks and atomically increments a rate limit counter in Postgres.
 *
 * Returns true  → request is within the limit, proceed.
 * Returns false → limit exceeded, return 429.
 *
 * Fails closed (returns false) on database errors. These call sites are
 * security-sensitive and should not silently disable abuse protection.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  _windowSeconds: number,
  _maxRequests: number,
): Promise<boolean> {
  const [endpoint, ...identifierParts] = key.split(':')
  const identifier = identifierParts.join(':') || key
  const config = inferEndpointLimit(endpoint || 'edge-function')
  const result = await rateLimit(
    supabase,
    identifier,
    endpoint || 'edge-function',
    config.limit,
    config.windowMs,
  )
  return result.allowed
}
