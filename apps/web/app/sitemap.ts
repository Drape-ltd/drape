import type { MetadataRoute } from 'next'

const routes = [
  '',
  '/how-it-works',
  '/vision',
  '/about',
  '/faq',
  '/trust',
  '/discover',
  '/customers',
  '/tailors',
  '/sign-in',
  '/sign-up',
  '/account',
  '/account/customer',
  '/account/tailor',
  '/account/recovery',
  '/account/ops',
  '/join',
  '/apply',
  '/contact',
  '/help',
  '/terms',
  '/verify',
  '/payouts',
  '/privacy',
  '/account-deletion',
  '/security',
  '/legal',
  '/partnerships',
  '/press',
  '/careers',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'

  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
  }))
}
