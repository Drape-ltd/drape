import type { Metadata } from 'next'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Saved',
  description: 'Review saved Drapeon tailors, wishlist collections, and ready-made pieces.',
  path: '/account/saved',
})

export default function AccountSavedPage(): React.JSX.Element {
  return <AccountAppSurface surface="saved" />
}
