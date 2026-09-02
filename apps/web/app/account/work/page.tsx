import type { Metadata } from 'next'
import { WorkWorkspace } from '../../../features/account/work/work-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Work queue',
  description: 'Review Drapeon tailor orders, payment state, production stages, and next actions.',
  path: '/account/work',
})

export default function AccountWorkPage(): React.JSX.Element {
  return <WorkWorkspace />
}
