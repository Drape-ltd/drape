import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Drapeon',
    short_name: 'Drapeon',
    description: 'AI-powered fashion discovery and fit.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F0E8',
    theme_color: '#2D6A4F',
  }
}
