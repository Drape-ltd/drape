import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Messages',
  description: 'Review protected Drapeon order conversations from your web account.',
  path: '/account/messages',
})

export default function AccountMessagesPage(): JSX.Element {
  return <AccountAppSurface surface="messages" />
}
