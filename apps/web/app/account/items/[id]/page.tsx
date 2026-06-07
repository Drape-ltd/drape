import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../../components/account-app-surface'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Ready-made item',
  description: 'Review a Drapeon ready-made item, size guidance, stock, fulfillment, and checkout handoff.',
  path: '/account/items',
})

export default async function AccountItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<JSX.Element> {
  const { id } = await params
  return <AccountAppSurface surface="item-detail" itemId={id} />
}
