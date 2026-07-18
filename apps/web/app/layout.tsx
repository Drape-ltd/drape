import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { headers } from 'next/headers'
import * as React from 'react'
import { AuthLandingRedirect } from '../components/auth-landing-redirect'
import { WebAnalytics } from '../components/web-analytics'
import { WebSessionScopeGuard } from '../components/web-session-scope-guard'
import { UiProvider } from '../components/ui/ui-provider'
import {
  defaultDescription,
  defaultTitle,
  publicPhoneE164,
  siteUrl,
  socialUrls,
} from '../lib/metadata'
import { getSupabasePublishableKey, getSupabaseUrl } from '../lib/supabase-config'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: '%s | Drapeon',
  },
  description: defaultDescription,
  applicationName: 'Drapeon',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  category: 'fashion marketplace',
  creator: 'Drapeon',
  publisher: 'O4 Group LLC',
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    url: siteUrl,
    siteName: 'Drapeon',
    type: 'website',
    locale: 'en_US',
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
    site: '@Drapeonn',
    creator: '@Drapeonn',
    title: defaultTitle,
    description: defaultDescription,
    images: ['/opengraph-image'],
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const publicSupabaseEnv = {
    supabaseUrl: getSupabaseUrl(),
    supabasePublishableKey: getSupabasePublishableKey(),
  }
  const hasPublicSupabaseEnv = Boolean(publicSupabaseEnv.supabaseUrl && publicSupabaseEnv.supabasePublishableKey)
  const logoUrl = `${siteUrl}/icon-512.png`

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: 'Drapeon',
    alternateName: 'O4 Group LLC',
    legalName: 'O4 Group LLC',
    url: siteUrl,
    logo: logoUrl,
    image: logoUrl,
    email: CONTACTS.hello,
    telephone: publicPhoneE164,
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: CONTACTS.support,
        telephone: publicPhoneE164,
        availableLanguage: ['en'],
      },
      {
        '@type': 'ContactPoint',
        contactType: 'general inquiries',
        email: CONTACTS.hello,
        telephone: publicPhoneE164,
        availableLanguage: ['en'],
      },
    ],
    sameAs: socialUrls,
    brand: {
      '@type': 'Brand',
      name: 'Drapeon',
      logo: logoUrl,
    },
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    name: 'Drapeon',
    alternateName: 'Drapeon custom tailoring marketplace',
    url: siteUrl,
    description: defaultDescription,
    publisher: {
      '@id': `${siteUrl}/#organization`,
    },
    inLanguage: 'en-US',
    sameAs: socialUrls,
  }

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="bg-ui-canvas text-ink antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <script
          nonce={nonce}
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, '\\u003c') }}
        />
        <script
          nonce={nonce}
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, '\\u003c') }}
        />
        {hasPublicSupabaseEnv ? (
          <script
            nonce={nonce}
            suppressHydrationWarning
            id="drapeon-public-env"
            dangerouslySetInnerHTML={{
              __html: `window.__DRAPEON_PUBLIC_ENV__=${JSON.stringify(publicSupabaseEnv).replace(/</g, '\\u003c')};`,
            }}
          />
        ) : null}
        <WebAnalytics />
        <WebSessionScopeGuard />
        <AuthLandingRedirect />
        <UiProvider>
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </UiProvider>
      </body>
    </html>
  )
}
