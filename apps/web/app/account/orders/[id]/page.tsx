import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../../components/account-app-surface'
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
}): Promise<JSX.Element> {
  const { id } = await params
  return <AccountAppSurface surface="order-detail" orderId={id} />
}
