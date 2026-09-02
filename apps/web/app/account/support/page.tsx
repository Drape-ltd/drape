import type { Metadata } from 'next'
import { SupportWorkspace } from '../../../features/account/support/support-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Support',
  description: 'Get Drapeon support for orders, payments, fit, delivery, account security, and tailor payouts.',
  path: '/account/support',
})

export default function AccountSupportPage(): React.JSX.Element {
  return <SupportWorkspace />
}
