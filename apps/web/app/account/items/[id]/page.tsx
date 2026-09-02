import type { Metadata } from 'next'
import { ItemDetailWorkspace } from '../../../../features/account/shop/item-detail-workspace'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Ready-made item',
  description:
    'Review a Drapeon ready-made item, size guidance, stock, fulfillment, and payment state.',
  path: '/account/items',
})

export default async function AccountItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  return <ItemDetailWorkspace itemId={id} />
}
