import type { Metadata } from 'next'

import { MarketingShell } from '../../components/marketing-shell'
import { ServiceStatusSurface } from '../../components/service-status-surface'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Service status',
  description: 'Current availability and recent recovery updates for Drapeon services.',
  path: '/status',
})

export default function ServiceStatusPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Service status"
      title="Drapeon availability, clearly reported."
      description="See active service notices and confirmed recoveries without needing to sign in."
    >
      <section className="border-t border-ink/6 py-10 sm:py-14">
        <ServiceStatusSurface />
      </section>
    </MarketingShell>
  )
}
