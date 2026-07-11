import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../../components/account-app-surface'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Payment',
  description: 'Review Drapeon order payment state and continue secure payment when an order is ready.',
  path: '/account/checkout',
})

export default async function AccountCheckoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<JSX.Element> {
  const { id } = await params
  return <AccountAppSurface surface="checkout" orderId={id} />
}
