import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { detectCurrencyPreference } from '../../../packages/shared/src/currency-config.ts'

const BodySchema = z.object({
  locale: z.string().trim().max(40).optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function requestCountryCode(req: Request) {
  const candidates = [
    req.headers.get('cf-ipcountry'),
    req.headers.get('x-vercel-ip-country'),
    req.headers.get('x-country-code'),
    req.headers.get('x-country'),
  ]

  for (const value of candidates) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
    if (/^[A-Z]{2}$/.test(normalized) && normalized !== 'XX' && normalized !== 'T1') {
      return normalized
    }
  }

  return null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405, cors)
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const clientIp = getClientIp(req)
  const limit = await rateLimit(
    supabase,
    clientIp,
    'currency-context',
    RATE_LIMITS.unauthenticated.limit,
    RATE_LIMITS.unauthenticated.windowMs,
    { ip: clientIp, userAgent: req.headers.get('user-agent') },
  )
  if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, cors)
  }

  const detected = detectCurrencyPreference({
    locale: parsed.data.locale ?? null,
    ipCountryCode: requestCountryCode(req),
  })

  return jsonResponse({
    currency: detected.currency,
    source: detected.source,
    regionCode: detected.regionCode,
    usedFallback: detected.usedFallback,
  }, 200, cors)
})
