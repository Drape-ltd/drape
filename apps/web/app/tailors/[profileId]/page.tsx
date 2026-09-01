import type { Metadata, Route } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, MapPin, ShieldCheck } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PublicSiteHeader } from '../../../components/public-site-header'
import { PublicPortfolioGallery } from '../../../components/public-portfolio-gallery'
import { SiteFooter } from '../../../components/site-footer'
import { getApprovedPublicTailor } from '../../../lib/public-marketplace'
import { buildMetadata } from '../../../lib/metadata'

type TailorPageProps = { params: Promise<{ profileId: string }> }

export async function generateMetadata({ params }: TailorPageProps): Promise<Metadata> {
  const { profileId } = await params
  const tailor = await getApprovedPublicTailor(profileId)
  if (!tailor) return { title: 'Tailor profile | Drapeon', robots: { index: false, follow: false } }
  return buildMetadata({
    title: tailor.displayName,
    description: tailor.bio ?? `Explore the approved Drapeon profile for ${tailor.displayName}.`,
    path: `/tailors/${tailor.id}`,
  })
}

export default async function PublicTailorPage({ params }: TailorPageProps): Promise<React.JSX.Element> {
  const { profileId } = await params
  const tailor = await getApprovedPublicTailor(profileId)
  if (!tailor) notFound()
  const media = [
    ...tailor.portfolioVideos.map((source) => ({ source, kind: 'video' as const })),
    ...tailor.portfolioPhotos.map((source) => ({ source, kind: 'image' as const })),
    ...(tailor.portfolioVideos.length === 0 && tailor.portfolioPhotos.length === 0 && tailor.avatarUrl ? [{ source: tailor.avatarUrl, kind: 'image' as const }] : []),
  ]
  const briefHref = `/account/brief/${tailor.id}` as Route
  const signInForBriefHref = `/sign-in?next=${encodeURIComponent(briefHref)}` as Route

  return (
    <main className="min-h-screen bg-[#f4f0e8] text-ink">
      <div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6"><PublicSiteHeader /></div>
      <section className="mx-auto max-w-[92rem] px-5 pb-16 pt-10 sm:px-8 lg:pb-20 lg:pt-12">
        <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-semibold text-ink/54 hover:text-needle"><ArrowLeft aria-hidden="true" size={14} /> Explore</Link>
        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(22rem,0.68fr)] lg:items-center lg:gap-12">
          <div className="relative aspect-[4/5] max-h-[620px] overflow-hidden rounded-[14px] bg-[#e7dfd0]">
            {media[0]?.kind === 'video' ? <video src={media[0].source} className="h-full w-full object-cover" autoPlay muted loop playsInline preload="metadata" aria-label={`Portfolio video by ${tailor.displayName}`} /> : media[0] ? <Image src={media[0].source} alt={`Selected work by ${tailor.displayName}`} fill sizes="(min-width:1024px) 52vw,100vw" className="object-cover" unoptimized priority /> : null}
          </div>

          <aside className="max-w-xl">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-needle"><ShieldCheck aria-hidden="true" size={14} /> Approved tailor</p>
            <h1 className="mt-4 text-4xl leading-none sm:text-5xl">{tailor.displayName}</h1>
            {tailor.location ? <p className="mt-4 flex items-center gap-2 text-sm text-ink/54"><MapPin aria-hidden="true" size={15} /> {tailor.location}</p> : null}
            {tailor.bio ? <p className="mt-5 max-w-lg text-sm leading-7 text-ink/66 sm:text-base">{tailor.bio}</p> : null}

            <div className="mt-6 grid gap-3 border-y border-ink/10 py-5 text-sm sm:grid-cols-2">
              <p className="flex items-center gap-2"><Check aria-hidden="true" size={15} className="text-needle" /> Reviewed by Drapeon</p>
              {tailor.acceptsCustomOrders ? <p className="flex items-center gap-2"><Check aria-hidden="true" size={15} className="text-needle" /> Custom briefs open</p> : <p className="text-ink/48">Custom briefs paused</p>}
              {tailor.supportsReadyMade ? <p className="flex items-center gap-2"><Check aria-hidden="true" size={15} className="text-needle" /> Ready-made available</p> : null}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              {tailor.acceptsCustomOrders ? <Link href={signInForBriefHref} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-xs font-semibold text-white transition-colors hover:bg-needle">Start a brief <ArrowRight aria-hidden="true" size={14} /></Link> : <span className="text-sm text-ink/48">Custom briefs are not currently open.</span>}
              <Link href="/sign-in" className="px-2 py-2 text-xs font-semibold text-ink/58 hover:text-needle">Sign in</Link>
            </div>
          </aside>
        </div>

        {media.length > 1 ? (
          <section className="mt-14 border-t border-ink/10 pt-8">
            <div className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Portfolio</p><h2 className="mt-2 text-3xl">Complete portfolio</h2></div><p className="text-xs text-ink/45">{media.length} pieces</p></div>
            <div className="mt-6"><PublicPortfolioGallery items={media} makerName={tailor.displayName} /></div>
          </section>
        ) : null}
      </section>
      <div className="mx-auto max-w-[92rem] px-5 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
