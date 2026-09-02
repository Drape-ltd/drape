/**
 * _shared/cors.ts
 *
 * Allowlist-based CORS headers for Drapeon Edge Functions.
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

const DEV_ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:3004',
  'http://127.0.0.1:3005',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://localhost:3005',
])

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type'
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function isDevProject() {
  try {
    return new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname.startsWith('pqptfuqogvrajozfsqzi')
  } catch {
    return false
  }
}

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
    return {
      ...SECURITY_HEADERS,
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
    }
  }

  // Browser: return the actual origin back only if it is allowlisted
  const allowedOrigin =
    ALLOWED_ORIGINS.has(origin) || (isDevProject() && DEV_ALLOWED_ORIGINS.has(origin))
      ? origin
      : 'https://drapeon.co'
  return {
    ...SECURITY_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}
