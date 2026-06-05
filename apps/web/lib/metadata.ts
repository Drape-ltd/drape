import type { Metadata } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'
const defaultTitle = 'Drapeon | AI-powered fashion discovery and fit'

export function buildMetadata({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): Metadata {
  const url = `${siteUrl}${path}`

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title: title === 'Drapeon' ? defaultTitle : `${title} | Drapeon`,
      description,
      url,
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
      title: title === 'Drapeon' ? defaultTitle : `${title} | Drapeon`,
      description,
      images: ['/opengraph-image'],
    },
  }
}
