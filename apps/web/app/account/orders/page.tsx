import type { Metadata } from 'next'
import { OrdersWorkspace } from '../../../features/account/orders/orders-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Orders',
  description: 'Review Drapeon order history, payment state, fulfillment, and production updates.',
  path: '/account/orders',
})

export default function AccountOrdersPage(): React.JSX.Element {
  return <OrdersWorkspace />
}
