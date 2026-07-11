import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drapeon.co'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/account',
        '/account/',
        '/api',
        '/api/',
        '/auth',
        '/auth/',
        '/ops',
        '/ops/',
        '/payments',
        '/payments/',
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
