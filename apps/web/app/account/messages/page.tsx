import type { Metadata } from 'next'
import { MessagesWorkspace } from '../../../features/account/messages/messages-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Messages',
  description: 'Review protected Drapeon order conversations from your web account.',
  path: '/account/messages',
})

export default function AccountMessagesPage(): React.JSX.Element {
  return <MessagesWorkspace />
}
