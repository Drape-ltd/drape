import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
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

export default function AccountDashboardPage(): never {
  redirect('/account/orders')
}
