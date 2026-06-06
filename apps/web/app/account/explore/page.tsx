import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Explore',
  description: 'Browse live Drapeon tailors and ready-made pieces from your web account.',
  path: '/account/explore',
})

export default function AccountExplorePage(): JSX.Element {
  return <AccountAppSurface surface="explore" />
}
