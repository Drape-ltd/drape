import type { Metadata } from 'next'
import { BriefWorkspace } from '../../../../features/account/brief/brief-workspace'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Custom brief',
  description: 'Send a protected Drapeon custom order brief to a tailor for quote review.',
  path: '/account/brief',
})

export default async function AccountBriefPage({
  params,
}: {
  params: Promise<{ tailorId: string }>
}): Promise<React.JSX.Element> {
  const { tailorId } = await params
  return <BriefWorkspace tailorId={tailorId} />
}
