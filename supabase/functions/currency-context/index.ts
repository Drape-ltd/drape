import { getCorsHeaders } from '../_shared/cors.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { detectCurrencyPreference } from '../../../packages/shared/src/currency-config.ts'

const BodySchema = z.object({
  locale: z.string().trim().max(40).optional(),
})

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
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) {
    return new Response(parsed.error, { status: 400, headers: cors })
  }

  const detected = detectCurrencyPreference({
    locale: parsed.data.locale ?? null,
    ipCountryCode: requestCountryCode(req),
  })

  return new Response(JSON.stringify({
    currency: detected.currency,
    source: detected.source,
    regionCode: detected.regionCode,
    usedFallback: detected.usedFallback,
  }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
