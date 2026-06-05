import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountDashboard } from '../../../components/account-dashboard'
import { SiteHeader } from '../../../components/site-header'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = {
  ...buildMetadata({
    title: 'Account dashboard',
    description: 'Manage Drapeon customer and tailor account access.',
    path: '/account/dashboard',
  }),
  robots: {
    index: false,
    follow: false,
  },
}

export default function AccountDashboardPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <SiteHeader />
        <section className="py-8 lg:py-12">
          <AccountDashboard />
        </section>
      </div>
    </main>
  )
}
