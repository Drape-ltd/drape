/**
 * _shared/cors.ts
 *
 * Allowlist-based CORS headers for Drape Edge Functions.
 *
 * Strategy:
 *  - Native mobile clients (iOS/Android) do NOT send an Origin header.
 *    Those requests are allowed through without a restrictive ACAO header.
 *  - Browser clients (future web app / admin dashboard) must come from an
 *    allowlisted origin. Unrecognised origins receive the primary domain
 *    back, which causes the browser to block the request.
 *  - The ALLOW_HEADERS list is kept intentionally minimal.
 */

const ALLOWED_ORIGINS = new Set([
  'https://drapeon.co',
  'https://www.drapeon.co',
  'https://admin.drapeon.co',
])

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type'

/**
 * Returns CORS response headers appropriate for the incoming request's Origin.
 *
 * Usage in every Edge Function:
 *   import { getCorsHeaders } from '../_shared/cors.ts'
 *   const cors = getCorsHeaders(req)
 *   if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
 *   // ... rest of function ...
 *   return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } })
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')

  // Native mobile: no Origin header — return minimal headers (no ACAO needed)
  if (!origin) {
    return { 'Access-Control-Allow-Headers': ALLOW_HEADERS }
  }

  // Browser: return the actual origin back only if it is allowlisted
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://drapeon.co'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}
