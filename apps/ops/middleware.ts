import { NextResponse, type NextRequest } from 'next/server'
import { evaluateOpsRuntimeBoundary } from './lib/runtime-boundary.mjs'

function hostname(request: NextRequest) {
  return (request.headers.get('host') ?? '').trim().toLowerCase().split(':')[0] ?? ''
}

function createNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function lockedResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  })
}

function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV !== 'production'
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    development ? "'unsafe-eval'" : '',
    'https://static.cloudflareinsights.com',
  ].filter(Boolean).join(' ')
  const connectSrc = [
    "'self'",
    'https://cloudflareinsights.com',
    development ? 'ws://localhost:*' : '',
    development ? 'ws://127.0.0.1:*' : '',
  ].filter(Boolean).join(' ')

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "form-action 'self'",
    development ? '' : 'upgrade-insecure-requests',
  ].filter(Boolean).join('; ')
}

function productionContractError(request: NextRequest) {
  const result = evaluateOpsRuntimeBoundary({
    nodeEnvironment: process.env.NODE_ENV,
    hostname: hostname(request),
    expectedHostname: process.env.OPS_HOSTNAME,
    opsEnvironment: process.env.DRAPE_OPS_ENV,
    expectedProjectRef: process.env.DRAPE_EXPECTED_SUPABASE_PROJECT_REF,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    accessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
    normalAudience: process.env.CF_ACCESS_AUD,
    sensitiveAudience: process.env.CF_ACCESS_SENSITIVE_AUD,
    sharedToken: process.env.OPS_DASHBOARD_TOKEN,
    bootstrapFlag: process.env.OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION,
    localWorkforceFlag: process.env.OPS_LOCAL_WORKFORCE_DRY_RUN,
  })
  if (!result) return null
  return result.status === 404
    ? lockedResponse('Not found.', 404)
    : lockedResponse('Ops runtime configuration unavailable.', 503)
}

export function middleware(request: NextRequest) {
  const contractError = productionContractError(request)
  if (contractError) return contractError

  const nonce = createNonce()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce))
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|ops-icon.svg|ops-icon-192.png|ops-icon-512.png|ops-manifest.webmanifest|ops-sw.js).*)'],
}
