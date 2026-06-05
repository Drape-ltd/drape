import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Drapeon',
    short_name: 'Drapeon',
    description: 'Find a tailor you trust, place one clear order, and follow it all the way through.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F0E8',
    theme_color: '#2D6A4F',
  }
}
