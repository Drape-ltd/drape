import { notFound } from 'next/navigation'
import { TailorProfileView } from '../../../../components/tailor-profile-view'
import { RecentlyViewedTailorRecorder } from '../../../../components/recently-viewed-tailor-recorder'
import { getApprovedPublicTailor } from '../../../../lib/public-marketplace'

export default async function AccountTailorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Account previews should reflect presentation edits immediately. Public
  // browsing retains the bounded regional cache.
  const tailor = await getApprovedPublicTailor(id, true)
  if (!tailor) notFound()
  return (
    <>
      <RecentlyViewedTailorRecorder
        tailor={{
          id: tailor.id,
          displayName: tailor.displayName,
          location: tailor.location ?? '',
          photo: tailor.media[0]?.url ?? tailor.avatarUrl,
        }}
      />
      <TailorProfileView tailor={tailor} account />
    </>
  )
}
