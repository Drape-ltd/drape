import type { Metadata } from 'next'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Settings',
  description: 'Manage Drapeon profile, privacy, security, currency, notifications, and support paths.',
  path: '/account/settings',
})

export default function AccountSettingsPage(): React.JSX.Element {
  return <AccountAppSurface surface="settings" />
}
