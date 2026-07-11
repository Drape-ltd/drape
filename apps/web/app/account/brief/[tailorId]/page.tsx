import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../../components/account-app-surface'
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
}): Promise<JSX.Element> {
  const { tailorId } = await params
  return <AccountAppSurface surface="brief" tailorId={tailorId} />
}
