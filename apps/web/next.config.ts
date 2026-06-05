import type { NextConfig } from 'next'

function getSupabaseStorageHostname() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL

  if (!supabaseUrl) return null

  try {
    return new URL(supabaseUrl).hostname
  } catch {
    return null
  }
}

const supabaseStorageHostname = getSupabaseStorageHostname()
const supabaseStorageOrigin = supabaseStorageHostname ? `https://${supabaseStorageHostname}` : ''

function contentSecurityPolicy() {
  const imgSrc = ["'self'", 'data:', 'blob:', supabaseStorageOrigin].filter(Boolean).join(' ')
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const shouldUpgradeInsecureRequests = siteUrl.startsWith('https://') && !siteUrl.includes('localhost')
  const connectSrc = [
    "'self'",
    'https://*.supabase.co',
    'https://*.sentry.io',
    'https://*.posthog.com',
    'https://us.i.posthog.com',
    'https://api.resend.com',
  ].join(' ')

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src ${imgSrc}`,
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "form-action 'self'",
    shouldUpgradeInsecureRequests ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ')
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(),
          },
        ],
      },
    ]
  },
  images: {
    remotePatterns: supabaseStorageHostname
      ? [
          {
            protocol: 'https',
            hostname: supabaseStorageHostname,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },
}

export default nextConfig
