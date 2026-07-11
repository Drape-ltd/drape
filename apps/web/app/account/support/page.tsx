import type { Metadata } from 'next'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Support',
  description: 'Get Drapeon support for orders, payments, fit, delivery, account security, and tailor payouts.',
  path: '/account/support',
})

export default function AccountSupportPage(): React.JSX.Element {
  return <AccountAppSurface surface="support" />
}
