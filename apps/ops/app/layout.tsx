import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Drapeon Ops', template: '%s · Drapeon Ops' },
  description: 'Restricted Drapeon workforce control plane.',
  applicationName: 'Drapeon Ops',
  manifest: '/ops-manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Drapeon Ops', statusBarStyle: 'black-translucent' },
  icons: { icon: '/ops-icon.svg', apple: '/ops-icon-192.png' },
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#11251b',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#ops-content">Skip to Ops content</a>
        {children}
      </body>
    </html>
  )
}
