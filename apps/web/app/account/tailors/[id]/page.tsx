import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../../components/account-app-surface'
import { buildMetadata } from '../../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Tailor profile',
  description: 'Review a Drapeon tailor profile, portfolio, ready-made pieces, and order handoff.',
  path: '/account/tailors',
})

export default async function AccountTailorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<JSX.Element> {
  const { id } = await params
  return <AccountAppSurface surface="tailor-detail" tailorId={id} />
}
