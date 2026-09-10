import type { Metadata } from 'next'
import { TailorDirectory, type TailorDirectoryParams } from '../../../components/tailor-directory'
import { buildMetadata } from '../../../lib/metadata'
import { getApprovedPublicTailors } from '../../../lib/public-marketplace'

export const metadata: Metadata = buildMetadata({
  title: 'Explore',
  description: 'Browse live Drapeon tailors and ready-made pieces from your web account.',
  path: '/account/explore',
})

export default async function AccountExplorePage({ searchParams }: { searchParams: Promise<TailorDirectoryParams> }) {
  const params = await searchParams
  const tailors = await getApprovedPublicTailors(40, 0, '')
  return <TailorDirectory tailors={tailors} params={params} basePath="/account/explore" profileBasePath="/account/tailors" />
}
