import type { Metadata } from 'next'
import { TailorDirectory, type TailorDirectoryParams } from '../../../components/tailor-directory'
import { buildMetadata } from '../../../lib/metadata'
import { getApprovedPublicTailors } from '../../../lib/public-marketplace'

export const metadata: Metadata = buildMetadata({
  title: 'Explore',
  description: 'Browse live Drapeon tailors and ready-made pieces from your web account.',
  path: '/account/explore',
})

export default async function AccountExplorePage({
  searchParams,
}: {
  searchParams: Promise<TailorDirectoryParams>
}) {
  const params = await searchParams
  const page = Math.max(1, Math.min(250, Number.parseInt(params.page ?? '1', 10) || 1))
  const offset = (page - 1) * 40
  const query = params.q?.trim() ?? ''
  const [tailors, nextPage] = await Promise.all([
    getApprovedPublicTailors(40, offset, query),
    getApprovedPublicTailors(1, offset + 40, query),
  ])
  return (
    <TailorDirectory
      tailors={tailors}
      params={params}
      basePath="/account/explore"
      profileBasePath="/account/tailors"
      pagination={{ page, hasNextPage: nextPage.length > 0 }}
    />
  )
}
