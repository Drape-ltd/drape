export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60

export const RATE_LIMITS = {
  unauthenticated: {
    limit: 10,
    windowMs: RATE_LIMIT_WINDOW_MS,
  },
  authenticated: {
    limit: 60,
    windowMs: RATE_LIMIT_WINDOW_MS,
  },
  payment: {
    limit: 20,
    windowMs: RATE_LIMIT_WINDOW_MS,
  },
  auth: {
    limit: 5,
    windowMs: RATE_LIMIT_WINDOW_MS,
  },
  webhook: {
    limit: 100,
    windowMs: RATE_LIMIT_WINDOW_MS,
  },
} as const

export type RateLimitKind = keyof typeof RATE_LIMITS

export type RateLimitResult = {
  allowed: boolean
  retryAfter?: number
  violationCount?: number
}

export function buildRateLimitKey(identifier: string, endpoint: string) {
  const safeEndpoint = endpoint.trim().replace(/[^a-zA-Z0-9:._/-]/gu, '_')
  const safeIdentifier = identifier.trim().replace(/[^a-zA-Z0-9:._@/-]/gu, '_')
  return `rl:${safeEndpoint}:${safeIdentifier}`
}

export function getRateLimitRetryAfter(windowMs = RATE_LIMIT_WINDOW_MS) {
  return Math.max(1, Math.ceil(windowMs / 1000))
}

export function createRateLimitPayload(retryAfter = RATE_LIMIT_RETRY_AFTER_SECONDS) {
  return {
    error: 'Too many requests',
    retryAfter,
    message: 'Please wait before retrying',
  } as const
}
