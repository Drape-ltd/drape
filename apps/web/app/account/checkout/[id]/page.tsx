import type { Metadata } from 'next'
import { CheckoutWorkspace } from '../../../../features/account/checkout/checkout-workspace'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Payment',
  description:
    'Review Drapeon order payment state and continue secure payment when an order is ready.',
  path: '/account/checkout',
})

export default async function AccountCheckoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  return <CheckoutWorkspace orderId={id} />
}
