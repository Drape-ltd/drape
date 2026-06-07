import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Saved',
  description: 'Review saved Drapeon tailors, wishlist collections, and ready-made pieces.',
  path: '/account/saved',
})

export default function AccountSavedPage(): JSX.Element {
  return <AccountAppSurface surface="saved" />
}
