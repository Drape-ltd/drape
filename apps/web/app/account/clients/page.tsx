import type { Metadata } from 'next'
import { ClientsWorkspace } from '../../../features/account/clients/clients-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Clients',
  description: 'Review Drapeon customers and manage private tailor diary records.',
  path: '/account/clients',
})

export default function AccountClientsPage(): React.JSX.Element {
  return <ClientsWorkspace />
}
