import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Checkout handoff',
  description: 'Review Drapeon checkout state before continuing secure payment in the mobile app.',
  path: '/account/checkout',
})

export default function AccountCheckoutPage(): JSX.Element {
  return <AccountAppSurface surface="checkout" />
}
