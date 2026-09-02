import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Check, MapPin, ShieldCheck } from 'lucide-react'
import { notFound } from 'next/navigation'
import { formatMoney, formatRelative } from '@drape/shared'
import { PublicSiteHeader } from '../../../components/public-site-header'
import { PublicPortfolioGallery } from '../../../components/public-portfolio-gallery'
import { PublicTailorActions } from '../../../components/public-tailor-actions'
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
  const media = tailor.media.length > 0
    ? tailor.media.map((item) => ({
        id: item.id,
        source: item.url,
        posterSource: item.posterUrl,
        kind: item.kind === 'VIDEO' ? 'video' as const : 'image' as const,
        focalX: item.focalX,
        focalY: item.focalY,
        altText: item.altText,
      }))
    : tailor.avatarUrl
      ? [{ id: `avatar-${tailor.id}`, source: tailor.avatarUrl, posterSource: null, kind: 'image' as const, focalX: 0.5, focalY: 0.5, altText: null }]
      : []
  return (
    <main className="min-h-screen bg-[#f4f0e8] text-ink">
      <div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6"><PublicSiteHeader /></div>
      <section className="mx-auto max-w-[92rem] px-5 pb-16 pt-10 sm:px-8 lg:pb-20 lg:pt-12">
        <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-semibold text-ink/54 hover:text-needle"><ArrowLeft aria-hidden="true" size={14} /> Explore</Link>
        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(22rem,0.68fr)] lg:items-center lg:gap-12">
          <div className="relative aspect-[4/5] max-h-[620px] overflow-hidden rounded-[14px] bg-[#e7dfd0]">
            {media[0]?.kind === 'video' ? <video src={media[0].source} poster={media[0].posterSource ?? undefined} className="h-full w-full object-cover" style={{ objectPosition: `${media[0].focalX * 100}% ${media[0].focalY * 100}%` }} autoPlay muted loop playsInline preload="metadata" aria-label={media[0].altText ?? `Portfolio video by ${tailor.displayName}`} /> : media[0] ? <Image src={media[0].source} alt={media[0].altText ?? `Selected work by ${tailor.displayName}`} fill sizes="(min-width:1024px) 52vw,100vw" className="object-cover" style={{ objectPosition: `${media[0].focalX * 100}% ${media[0].focalY * 100}%` }} unoptimized priority /> : null}
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
              {tailor.totalReviews > 0 ? <p>{tailor.averageRating.toFixed(1)} from {tailor.totalReviews} verified review{tailor.totalReviews === 1 ? '' : 's'}</p> : null}
              {tailor.responseHours !== null ? <p>Usually responds within {Math.max(1, Math.round(tailor.responseHours))} hours</p> : null}
            </div>

            {(tailor.specialties.length > 0 || tailor.languages.length > 0 || tailor.fulfillment.length > 0 || tailor.priceRangeMin !== null) ? (
              <dl className="mt-6 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                {tailor.specialties.length > 0 ? <div><dt className="text-xs font-semibold text-ink/42">Specialties</dt><dd className="mt-1 leading-6">{tailor.specialties.join(' · ')}</dd></div> : null}
                {tailor.languages.length > 0 ? <div><dt className="text-xs font-semibold text-ink/42">Languages</dt><dd className="mt-1 leading-6">{tailor.languages.join(' · ')}</dd></div> : null}
                {tailor.fulfillment.length > 0 ? <div><dt className="text-xs font-semibold text-ink/42">Fulfillment</dt><dd className="mt-1 leading-6">{tailor.fulfillment.join(' · ')}</dd></div> : null}
                {tailor.priceRangeMin !== null ? <div><dt className="text-xs font-semibold text-ink/42">Typical project</dt><dd className="mt-1 leading-6">From {formatMoney(tailor.priceRangeMin, tailor.currency ?? 'USD')}</dd></div> : null}
              </dl>
            ) : null}

            <div className="mt-7"><PublicTailorActions tailorId={tailor.id} acceptsCustomOrders={tailor.acceptsCustomOrders} /></div>
          </aside>
        </div>

        {media.length > 1 ? (
          <section className="mt-14 border-t border-ink/10 pt-8">
            <div className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Portfolio</p><h2 className="mt-2 text-3xl">Complete portfolio</h2></div><p className="text-xs text-ink/45">{media.length} pieces</p></div>
            <div className="mt-6"><PublicPortfolioGallery items={media} makerName={tailor.displayName} /></div>
          </section>
        ) : null}

        {tailor.reviews.length > 0 ? (
          <section className="mt-14 border-t border-ink/10 pt-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Completed orders</p>
            <h2 className="mt-2 text-3xl">Customer reviews</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {tailor.reviews.map((review) => (
                <article key={review.id} className="rounded-[12px] border border-ink/8 bg-[#faf8f3] p-5">
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{'★'.repeat(Math.round(review.rating))}<span className="text-ink/20">{'★'.repeat(5 - Math.round(review.rating))}</span></p>{review.createdAt ? <time className="text-xs text-ink/42">{formatRelative(review.createdAt)}</time> : null}</div>
                  {review.body ? <p className="mt-4 text-sm leading-6 text-ink/66">{review.body}</p> : null}
                  <p className="mt-4 text-xs font-semibold text-ink/54">{review.reviewerName}</p>
                  {review.response ? <div className="mt-4 border-l-2 border-needle/30 pl-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-needle">Tailor response</p><p className="mt-1 text-xs leading-5 text-ink/58">{review.response}</p></div> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
      <div className="mx-auto max-w-[92rem] px-5 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
