import type { Metadata } from 'next'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Join call',
  description: 'Open the protected Drapeon order thread and join the scheduled call.',
  path: '/account/call-join',
})

export default function AccountCallJoinPage(): React.JSX.Element {
  return <AccountAppSurface surface="messages" />
}
