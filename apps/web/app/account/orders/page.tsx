import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Orders',
  description: 'Review Drapeon order history, payment state, fulfillment, and production updates.',
  path: '/account/orders',
})

export default function AccountOrdersPage(): JSX.Element {
  return <AccountAppSurface surface="orders" />
}
