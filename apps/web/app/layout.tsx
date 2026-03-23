import type { Metadata } from 'next'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Drape | Custom clothing, handled beautifully',
    template: '%s | Drape',
  },
  description:
    'Find a tailor you trust, place one clear order, and follow it all the way through.',
  applicationName: 'Drape',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Drape | Custom clothing, handled beautifully',
    description:
      'Find a tailor you trust, place one clear order, and follow it all the way through.',
    url: siteUrl,
    siteName: 'Drape',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Drape',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Drape | Custom clothing, handled beautifully',
    description:
      'Find a tailor you trust, place one clear order, and follow it all the way through.',
    images: ['/opengraph-image'],
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({ children }: { children: any }): JSX.Element {
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Drape',
    url: siteUrl,
    email: 'hello@drapeon.co',
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Drape',
    url: siteUrl,
    description: 'Find a tailor you trust, place one clear order, and follow it all the way through.',
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
        {children}
      </body>
    </html>
  )
}
