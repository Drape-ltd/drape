import type { MetadataRoute } from 'next'
import { siteUrl } from '../lib/metadata'

const routes: Array<{ path: string; priority: number; changeFrequency: 'monthly' | 'weekly' }> = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/join', priority: 0.95, changeFrequency: 'weekly' },
  { path: '/apply', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/how-it-works', priority: 0.86, changeFrequency: 'monthly' },
  { path: '/customers', priority: 0.84, changeFrequency: 'monthly' },
  { path: '/tailors', priority: 0.84, changeFrequency: 'monthly' },
  { path: '/discover', priority: 0.82, changeFrequency: 'weekly' },
  { path: '/vision', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/pricing', priority: 0.78, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.72, changeFrequency: 'monthly' },
  { path: '/help', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/faq', priority: 0.68, changeFrequency: 'monthly' },
  { path: '/trust', priority: 0.66, changeFrequency: 'monthly' },
  { path: '/verify', priority: 0.64, changeFrequency: 'monthly' },
  { path: '/payouts', priority: 0.62, changeFrequency: 'monthly' },
  { path: '/press', priority: 0.58, changeFrequency: 'monthly' },
  { path: '/careers', priority: 0.56, changeFrequency: 'monthly' },
  { path: '/partnerships', priority: 0.56, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/security', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/legal', priority: 0.48, changeFrequency: 'monthly' },
  { path: '/account-deletion', priority: 0.42, changeFrequency: 'monthly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-07-12')

  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
