import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Drape — Custom clothing, crafted for you',
  description:
    'Connect with master tailors. Get measured once. Order anywhere in the world.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-bone text-ink antialiased`}>
        {children}
      </body>
    </html>
  )
}
