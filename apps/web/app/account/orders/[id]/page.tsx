import type { Metadata } from 'next'
import { OrderDetailWorkspace } from '../../../../features/account/orders/order-detail-workspace'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Order detail',
  description: 'Review a Drapeon order brief, payment ledger, timeline, and messages.',
  path: '/account/orders',
})

export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  return <OrderDetailWorkspace orderId={id} />
}
