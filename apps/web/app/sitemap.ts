import type { MetadataRoute } from 'next'

const routes = [
  '',
  '/how-it-works',
  '/vision',
  '/pricing',
  '/about',
  '/faq',
  '/trust',
  '/discover',
  '/customers',
  '/tailors',
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
]

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'
  const lastModified = new Date('2026-07-04')

  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified,
  }))
}
