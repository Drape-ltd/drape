import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({
    name: 'Drapeon Ops',
    short_name: 'Drapeon Ops',
    description: 'Restricted Drapeon workforce control plane.',
    id: '/ops',
    start_url: '/ops/my-work',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f1eb',
    theme_color: '#11251b',
    icons: [
      { src: '/ops-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/ops-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/ops-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  }, { headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/manifest+json' } })
}
