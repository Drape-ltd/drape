import type { Metadata } from 'next'
import { NotificationsWorkspace } from '../../../features/account/notifications/notifications-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Notifications',
  description: 'Review durable Drapeon order, payment, payout, safety, and support updates.',
  path: '/account/notifications',
})

export default function AccountNotificationsPage(): React.JSX.Element {
  return <NotificationsWorkspace />
}
