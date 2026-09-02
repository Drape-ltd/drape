import type { Metadata } from 'next'
import { SettingsWorkspace } from '../../../features/account/settings/settings-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Settings',
  description:
    'Manage Drapeon profile, privacy, security, currency, notifications, and support paths.',
  path: '/account/settings',
})

export default function AccountSettingsPage(): React.JSX.Element {
  return <SettingsWorkspace />
}
