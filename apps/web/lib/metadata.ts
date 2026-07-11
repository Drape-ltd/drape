import type { Metadata } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'
const defaultTitle = 'Drapeon | Custom fashion orders, fit, and trusted tailors'

export function buildMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string
  description: string
  path: string
  noindex?: boolean
}): Metadata {
  const url = `${siteUrl}${path}`
  const shouldNoindex = noindex || path === '/account' || path.startsWith('/account/')

  return {
    title,
    description,
    robots: shouldNoindex
      ? {
          index: false,
          follow: false,
        }
      : undefined,
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
