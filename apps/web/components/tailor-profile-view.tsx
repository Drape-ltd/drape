import Link from 'next/link'
import type { Route } from 'next'
import { ArrowLeft, Check, MapPin, ShieldCheck } from 'lucide-react'
import { formatMoney, formatRelative } from '@drape/shared'
import type { PublicTailor } from '../lib/public-marketplace'
import { PublicPortfolioGallery } from './public-portfolio-gallery'
import { PublicTailorActions } from './public-tailor-actions'

export function TailorProfileView({
  tailor,
  account = false,
}: {
  tailor: PublicTailor
  account?: boolean
}) {
  const backHref = account ? '/account/explore' : '/explore'
  const media =
    tailor.media.length > 0
      ? tailor.media.map((item) => ({
          id: item.id,
          source: item.url,
          posterSource: item.posterUrl,
          kind: item.kind === 'VIDEO' ? ('video' as const) : ('image' as const),
          focalX: item.focalX,
          focalY: item.focalY,
          altText: item.altText,
        }))
      : tailor.avatarUrl
        ? [
            {
              id: `avatar-${tailor.id}`,
              source: tailor.avatarUrl,
              posterSource: null,
              kind: 'image' as const,
              focalX: 0.5,
              focalY: 0.5,
              altText: null,
            },
          ]
        : []
  return (
    <div className="pb-10">
      <Link
        href={backHref}
        className="inline-flex h-9 items-center gap-2 rounded-[8px] px-2 text-sm font-semibold text-ink/58 transition hover:bg-white hover:text-needle"
      >
        <ArrowLeft aria-hidden="true" size={15} /> Explore
      </Link>
      <section className="mt-3 grid gap-6 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] md:items-start">
        <div className="w-full max-w-[20rem]">
          {media.length ? (
            <PublicPortfolioGallery
              items={media}
              makerName={tailor.displayName}
              presentation="cover"
            />
          ) : (
            <div className="aspect-[4/5] rounded-[10px] bg-needle/8" />
          )}
        </div>
        <div className="rounded-[8px] border border-ui-border bg-white p-5 sm:p-6">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-needle">
            <ShieldCheck aria-hidden="true" size={14} /> Approved tailor
          </p>
          <h1 className="mt-3 text-3xl leading-none sm:text-4xl">{tailor.displayName}</h1>
          {tailor.location ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink/54">
              <MapPin aria-hidden="true" size={15} /> {tailor.location}
            </p>
          ) : null}
          {tailor.bio ? (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-ink/66">{tailor.bio}</p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {tailor.specialties.map((specialty) => (
              <span
                key={specialty}
                className="inline-flex h-8 items-center rounded-[8px] border border-ui-border bg-bone/55 px-3 text-xs font-semibold text-ink/68"
              >
                {specialty}
              </span>
            ))}
          </div>
          <div className="mt-5 grid gap-2 border-y border-ink/8 py-4 text-sm sm:grid-cols-2">
            <p className="flex items-center gap-2">
              <Check aria-hidden="true" size={14} className="text-needle" /> Reviewed by Drapeon
            </p>
            <p className="flex items-center gap-2">
              <Check aria-hidden="true" size={14} className="text-needle" />{' '}
              {tailor.acceptsCustomOrders ? 'Custom briefs open' : 'Custom briefs paused'}
            </p>
            {tailor.supportsReadyMade ? (
              <p className="flex items-center gap-2">
                <Check aria-hidden="true" size={14} className="text-needle" /> Ready-made available
              </p>
            ) : null}
            {tailor.responseHours !== null ? (
              <p>Usually responds within {Math.max(1, Math.round(tailor.responseHours))} hours</p>
            ) : null}
          </div>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            {tailor.languages.length ? (
              <div>
                <dt className="text-xs font-semibold text-ink/44">Languages</dt>
                <dd className="mt-1 leading-5">{tailor.languages.join(' · ')}</dd>
              </div>
            ) : null}
            {tailor.fulfillment.length ? (
              <div>
                <dt className="text-xs font-semibold text-ink/44">Fulfillment</dt>
                <dd className="mt-1 leading-5">{tailor.fulfillment.join(' · ')}</dd>
              </div>
            ) : null}
            {tailor.priceRangeMin !== null ? (
              <div>
                <dt className="text-xs font-semibold text-ink/44">Typical project</dt>
                <dd className="mt-1 leading-5">
                  From {formatMoney(tailor.priceRangeMin, tailor.currency ?? 'USD')}
                </dd>
              </div>
            ) : null}
            {tailor.totalReviews ? (
              <div>
                <dt className="text-xs font-semibold text-ink/44">Verified reviews</dt>
                <dd className="mt-1 leading-5">
                  {tailor.averageRating.toFixed(1)} from {tailor.totalReviews}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <PublicTailorActions
              tailorId={tailor.id}
              acceptsCustomOrders={tailor.acceptsCustomOrders}
            />
            {tailor.supportsReadyMade ? (
              <Link
                href={`/account/shop?tailor=${tailor.id}` as Route}
                className="inline-flex h-10 items-center rounded-[8px] border border-ink/14 px-4 text-xs font-semibold text-ink transition hover:border-needle hover:text-needle"
              >
                Browse this tailor’s ready-made
              </Link>
            ) : null}
          </div>
        </div>
      </section>
      {media.length > 1 ? (
        <section className="mt-10 border-t border-ink/8 pt-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-needle">
                Portfolio
              </p>
              <h2 className="mt-1 text-2xl">Complete portfolio</h2>
            </div>
            <p className="text-xs text-ink/45">{media.length} pieces</p>
          </div>
          <div className="mt-5">
            <PublicPortfolioGallery items={media} makerName={tailor.displayName} />
          </div>
        </section>
      ) : null}
      {tailor.reviews.length ? (
        <section className="mt-10 border-t border-ink/8 pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-needle">
            Completed orders
          </p>
          <h2 className="mt-1 text-2xl">Customer reviews</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tailor.reviews.map((review) => (
              <article
                key={review.id}
                className="rounded-[8px] border border-ui-border bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{review.rating.toFixed(1)} / 5</p>
                  {review.createdAt ? (
                    <time className="text-xs text-ink/42">{formatRelative(review.createdAt)}</time>
                  ) : null}
                </div>
                {review.body ? (
                  <p className="mt-3 text-sm leading-6 text-ink/66">{review.body}</p>
                ) : null}
                <p className="mt-3 text-xs font-semibold text-ink/54">{review.reviewerName}</p>
                {review.response ? (
                  <div className="mt-3 border-l-2 border-needle/30 pl-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-needle">
                      Tailor response
                    </p>
                    <p className="mt-1 text-xs leading-5 text-ink/58">{review.response}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
