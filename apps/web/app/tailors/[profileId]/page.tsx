import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicSiteHeader } from '../../../components/public-site-header'
import { SiteFooter } from '../../../components/site-footer'
import { TailorProfileView } from '../../../components/tailor-profile-view'
import { getApprovedPublicTailor } from '../../../lib/public-marketplace'
import { buildMetadata } from '../../../lib/metadata'

type TailorPageProps = { params: Promise<{ profileId: string }> }

export async function generateMetadata({ params }: TailorPageProps): Promise<Metadata> {
  const { profileId } = await params
  const tailor = await getApprovedPublicTailor(profileId)
  if (!tailor) return { title: 'Tailor profile | Drapeon', robots: { index: false, follow: false } }
  return buildMetadata({ title: tailor.displayName, description: tailor.bio ?? `Explore the approved Drapeon profile for ${tailor.displayName}.`, path: `/tailors/${tailor.id}` })
}

export default async function PublicTailorPage({ params }: TailorPageProps) {
  const { profileId } = await params
  const tailor = await getApprovedPublicTailor(profileId)
  if (!tailor) notFound()
  return <main className="min-h-screen bg-[#f4f0e8] text-ink"><div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6"><PublicSiteHeader /></div><section className="mx-auto max-w-[92rem] px-5 pb-16 pt-8 sm:px-8"><TailorProfileView tailor={tailor} /></section><div className="mx-auto max-w-[92rem] px-5 sm:px-8"><SiteFooter /></div></main>
}
