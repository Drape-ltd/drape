import { NextResponse, type NextRequest } from 'next/server'

function getPublicSupabaseUrl() {
  return (
    process.env.DRAPEON_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    null
  )
}

function getSupabaseStorageOrigin() {
  const supabaseUrl = getPublicSupabaseUrl()
  if (!supabaseUrl) return ''

  try {
    return `https://${new URL(supabaseUrl).hostname}`
  } catch {
    return ''
  }
}

function createNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hasCloudflareAccessConfig() {
  return Boolean(
    process.env.CF_ACCESS_TEAM_DOMAIN?.trim() &&
      process.env.CF_ACCESS_AUD?.trim()
  )
}

function isExplicitOpsBreakGlassEnabled() {
  return process.env.OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION === '1'
}

function getHostname(request: NextRequest) {
  const host = request.headers.get('host')?.trim().toLowerCase() ?? ''
  return host.split(':')[0] ?? ''
}

function getOpsHostname() {
  return (process.env.OPS_HOSTNAME ?? 'ops.drapeon.co').trim().toLowerCase()
}

function isOpsPath(pathname: string) {
  return pathname === '/ops' || pathname.startsWith('/ops/')
}

function isProductionRequest(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return false
  const hostname = getHostname(request)
  return hostname !== 'localhost' && hostname !== '127.0.0.1'
}

function isOpsHostname(request: NextRequest) {
  return getHostname(request) === getOpsHostname()
}

function isProductionOpsRequest(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/ops')) return false
  return isProductionRequest(request)
}

function isPublicProductionOpsRequest(request: NextRequest) {
  return isProductionRequest(request) && isOpsPath(request.nextUrl.pathname) && !isOpsHostname(request)
}

function notFoundResponse() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

function contentSecurityPolicy(nonce: string) {
  const imgSrc = ["'self'", 'data:', 'blob:', getSupabaseStorageOrigin(), 'https://*.stripe.com']
    .filter(Boolean)
    .join(' ')
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const shouldUpgradeInsecureRequests = siteUrl.startsWith('https://') && !siteUrl.includes('localhost')
  const connectSrc = [
    "'self'",
    'https://*.supabase.co',
    'https://*.sentry.io',
    'https://*.posthog.com',
    'https://us.i.posthog.com',
    'https://api.resend.com',
    'https://api.stripe.com',
    'https://r.stripe.com',
    'https://m.stripe.network',
    'https://cloudflareinsights.com',
  ].join(' ')

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src ${imgSrc}`,
    `script-src 'self' 'nonce-${nonce}' https://js.stripe.com https://static.cloudflareinsights.com`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "form-action 'self'",
    shouldUpgradeInsecureRequests ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ')
}

export function middleware(request: NextRequest) {
  if (isPublicProductionOpsRequest(request)) {
    return notFoundResponse()
  }

  if (
    isProductionOpsRequest(request) &&
    !hasCloudflareAccessConfig() &&
    !isExplicitOpsBreakGlassEnabled()
  ) {
    return new Response('Ops access requires Cloudflare Access in production.', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  }

  const nonce = createNonce()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|opengraph-image).*)'],
}
