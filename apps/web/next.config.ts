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

  if (publicSupabaseUrl && publicSupabaseKey) return

  console.warn(
    '[web env] Public Supabase env was not visible during the Cloudflare build. ' +
      'Browser auth will use /api/public-env.js at runtime; confirm Cloudflare runtime variables are set.'
  )
}

assertPublicSupabaseEnvForCloudflare()

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
            value: 'max-age=31536000; includeSubDomains; preload',
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
