import type { Metadata } from 'next'
import { ReferralClaim } from '../../../components/referral-claim'
import { buildMetadata } from '../../../lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildMetadata({
  title: 'A Drapeon referral',
  description: 'Join Drapeon through a trusted customer referral.',
  path: '/referral',
  noindex: true,
})

export default function ReferralPage({ params }: { params: Promise<{ code: string }> }) {
  return <ReferralClaim params={params} />
}
