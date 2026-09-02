import type { NextConfig } from 'next'
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  getSupabaseProjectRef,
} from './lib/supabase-environment'

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

function assertConfiguredWebTarget() {
  const declaredEnvironment = process.env.DRAPE_WEB_ENV?.trim().toLowerCase()
  const expectedProjectRef =
    process.env.DRAPE_EXPECTED_SUPABASE_PROJECT_REF?.trim() ||
    (declaredEnvironment === 'production' ? PRODUCTION_SUPABASE_PROJECT_REF : null)

  if (!expectedProjectRef || !publicSupabaseUrl) return

  const actualProjectRef = getSupabaseProjectRef(publicSupabaseUrl)

  if (actualProjectRef !== expectedProjectRef) {
    throw new Error(
      `[web env] Refusing build: expected Supabase project ${expectedProjectRef}, ` +
        `received ${actualProjectRef ?? 'an invalid URL'}.`
    )
  }
}

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
assertConfiguredWebTarget()

const nextConfig: NextConfig = {
  // Local production builds must not replace the chunks used by a live
  // `next dev` process. CI/Cloudflare keep Next's canonical `.next` output.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
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
            value: 'camera=(self), microphone=(self), geolocation=()',
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
