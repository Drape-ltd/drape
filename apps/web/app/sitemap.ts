import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'
import { siteUrl } from '../lib/metadata'
import { getApprovedPublicTailorsForSitemap } from '../lib/public-marketplace'

export const dynamic = 'force-dynamic'

const getCachedSitemapTailors = unstable_cache(
  getApprovedPublicTailorsForSitemap,
  ['approved-public-tailors-sitemap'],
  { revalidate: 3_600 },
)

const routes: Array<{ path: string; priority: number; changeFrequency: 'monthly' | 'weekly' }> = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/explore', priority: 0.95, changeFrequency: 'weekly' },
  { path: '/how-it-works', priority: 0.86, changeFrequency: 'monthly' },
  { path: '/customers', priority: 0.84, changeFrequency: 'monthly' },
  { path: '/tailors', priority: 0.84, changeFrequency: 'monthly' },
  { path: '/vision', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/pricing', priority: 0.78, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/careers', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/partnerships', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/press', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/help', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/faq', priority: 0.68, changeFrequency: 'monthly' },
  { path: '/trust', priority: 0.66, changeFrequency: 'monthly' },
  { path: '/verify', priority: 0.64, changeFrequency: 'monthly' },
  { path: '/payouts', priority: 0.62, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/security', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/legal', priority: 0.48, changeFrequency: 'monthly' },
  { path: '/account-deletion', priority: 0.42, changeFrequency: 'monthly' },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticLastModified = new Date('2026-09-13')

  let tailorRoutes: MetadataRoute.Sitemap = []
  try {
    const tailors = await getCachedSitemapTailors()
    tailorRoutes = tailors.map((tailor) => ({
      url: `${siteUrl}/tailors/${tailor.id}`,
      changeFrequency: 'weekly',
      priority: 0.76,
      images: Array.from(new Set([
        ...tailor.media.filter((item) => item.kind === 'IMAGE').map((item) => item.url),
        ...tailor.portfolioPhotos,
        ...(tailor.avatarUrl ? [tailor.avatarUrl] : []),
      ])).slice(0, 12),
    }))
  } catch (error) {
    console.error('[sitemap] Approved tailor URLs could not be loaded.', error)
  }

  const staticRoutes = routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified: staticLastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  return [...staticRoutes, ...tailorRoutes]
}
