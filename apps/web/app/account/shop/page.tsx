import type { Metadata } from 'next'
import { ShopWorkspace } from '../../../features/account/shop/shop-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Marketplace',
  description: 'Review Drapeon ready-made shop inventory and live marketplace pieces.',
  path: '/account/shop',
})

export default function AccountShopPage(): React.JSX.Element {
  return <ShopWorkspace />
}
