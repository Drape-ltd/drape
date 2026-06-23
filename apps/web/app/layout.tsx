import type { Metadata } from 'next'
import Script from 'next/script'
import * as React from 'react'
import { AuthLandingRedirect } from '../components/auth-landing-redirect'
import { getSupabasePublishableKey, getSupabaseUrl } from '../lib/supabase-config'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Drapeon | AI-powered fashion discovery and fit',
    template: '%s | Drapeon',
  },
  description:
    'AI-powered fashion discovery and fit, including Drape Vision camera-assisted measurements.',
  applicationName: 'Drapeon',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Drapeon | AI-powered fashion discovery and fit',
    description:
      'Discover fashion, work with trusted tailors, and use Drape Vision for camera-assisted measurements.',
    url: siteUrl,
    siteName: 'Drapeon',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Drapeon',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Drapeon | AI-powered fashion discovery and fit',
    description:
      'Discover fashion, work with trusted tailors, and use Drape Vision for camera-assisted measurements.',
    images: ['/opengraph-image'],
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const publicSupabaseEnv = {
    supabaseUrl: getSupabaseUrl(),
    supabasePublishableKey: getSupabasePublishableKey(),
  }
  const hasPublicSupabaseEnv = Boolean(publicSupabaseEnv.supabaseUrl && publicSupabaseEnv.supabasePublishableKey)

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'O4 Group LLC',
    legalName: 'O4 Group LLC',
    brand: {
      '@type': 'Brand',
      name: 'Drapeon',
    },
    url: siteUrl,
    email: 'hello@drapeon.co',
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Drapeon',
    url: siteUrl,
    description: 'AI-powered fashion discovery and fit.',
  }

  return (
    <html lang="en">
      <body className="bg-bone text-ink antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <Script src="/api/public-env.js" strategy="beforeInteractive" />
        {hasPublicSupabaseEnv ? (
          <script
            id="drapeon-public-env"
            dangerouslySetInnerHTML={{
              __html: `window.__DRAPEON_PUBLIC_ENV__=${JSON.stringify(publicSupabaseEnv).replace(/</g, '\\u003c')};`,
            }}
          />
        ) : null}
        <AuthLandingRedirect />
        {children}
      </body>
    </html>
  )
}
