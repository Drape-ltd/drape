import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Marketplace',
  description: 'Review Drapeon ready-made shop inventory and live marketplace pieces.',
  path: '/account/shop',
})

export default function AccountShopPage(): JSX.Element {
  return <AccountAppSurface surface="shop" />
}
