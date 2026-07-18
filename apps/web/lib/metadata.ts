import type { Metadata } from 'next'
import { WHATSAPP_SUPPORT } from '@drape/shared'

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'
export const defaultTitle = 'Drapeon | Custom fashion orders, fit, and trusted tailors'
export const defaultDescription =
  'Find trusted tailors, submit clear custom fashion briefs, track production, and use Drapeon Vision for camera-assisted fit measurements.'
export const publicPhoneE164 = WHATSAPP_SUPPORT.phoneE164
export const socialLinks = [
  { label: 'Instagram', url: 'https://www.instagram.com/drapeonn/' },
  { label: 'X', url: 'https://x.com/Drapeonn' },
] as const
export const socialUrls = socialLinks.map((link) => link.url)

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
      title: title === 'Drapeon' ? defaultTitle : `${title} | Drapeon`,
      description,
      images: ['/opengraph-image'],
    },
  }
}
