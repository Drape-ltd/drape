import type { NextConfig } from 'next'

function getPublicSupabaseUrl() {
  return (
    process.env.DRAPEON_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    null
  )
}

function getPublicSupabaseKey() {
  return (
    process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    null
  )
}

function getSupabaseStorageHostname() {
  const supabaseUrl = getPublicSupabaseUrl()

  if (!supabaseUrl) return null

  try {
    return new URL(supabaseUrl).hostname
  } catch {
    return null
  }
}

const supabaseStorageHostname = getSupabaseStorageHostname()
const supabaseStorageOrigin = supabaseStorageHostname ? `https://${supabaseStorageHostname}` : ''
const publicSupabaseUrl = getPublicSupabaseUrl()
const publicSupabaseKey = getPublicSupabaseKey()

function isCloudflareBuild() {
  return Boolean(
    process.env.CF_PAGES ||
      process.env.CF_PAGES_BRANCH ||
      process.env.CF_PAGES_COMMIT_SHA ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.CF_ACCOUNT_ID
  )
}

function assertPublicSupabaseEnvForCloudflare() {
  if (!isCloudflareBuild()) return

  const missing: string[] = []
  if (!publicSupabaseUrl) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL')
  }
  if (!publicSupabaseKey) {
    missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  }

  if (!missing.length) return

  throw new Error(
    `[web env] Missing public Supabase env for browser auth: ${missing.join(', ')}. ` +
      'Set these in Cloudflare Pages/Workers production variables and redeploy.'
  )
}

assertPublicSupabaseEnvForCloudflare()

function contentSecurityPolicy() {
  const imgSrc = ["'self'", 'data:', 'blob:', supabaseStorageOrigin, 'https://*.stripe.com'].filter(Boolean).join(' ')
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
  ].join(' ')

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src ${imgSrc}`,
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "font-src 'self' data:",
    "form-action 'self'",
    shouldUpgradeInsecureRequests ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ')
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  env: {
    DRAPEON_PUBLIC_SUPABASE_URL: publicSupabaseUrl ?? '',
    DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicSupabaseKey ?? '',
  },
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
