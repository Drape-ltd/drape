import type { Metadata } from 'next'
import { MeasurementsWorkspace } from '../../../features/account/measurements/measurements-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Measurements',
  description: 'Review Drapeon measurement profiles, Drapeon Vision scans, and fit records.',
  path: '/account/measurements',
})

export default function AccountMeasurementsPage(): React.JSX.Element {
  return <MeasurementsWorkspace />
}
