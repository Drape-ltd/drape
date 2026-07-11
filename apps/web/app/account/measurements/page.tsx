import type { Metadata } from 'next'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Measurements',
  description: 'Review Drapeon measurement profiles, Drapeon Vision scans, and fit records.',
  path: '/account/measurements',
})

export default function AccountMeasurementsPage(): React.JSX.Element {
  return <AccountAppSurface surface="measurements" />
}
