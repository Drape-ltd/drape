'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { Route } from 'next'
import { ChevronDown, Search, ShieldCheck, SlidersHorizontal, Star, Tags } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import type { PublicTailor } from '../lib/public-marketplace'

export type TailorDirectoryParams = {
  q?: string
  filter?: string
  sort?: string
}

function routeWithParams(basePath: string, params: Record<string, string | undefined>): Route {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value) })
  return `${basePath}${query.size ? `?${query.toString()}` : ''}` as Route
}

function filterLabel(value: string) {
  if (value === 'all') return 'All tailors'
  if (value === 'custom') return 'Custom orders'
  if (value === 'ready-made') return 'Ready-made'
  return value
}

const OUTFIT_FILTERS = [
  'Agbada',
  'Boubou',
  'Kaftan',
  'Dashiki',
  'Ankara',
  'Suits',
  'Tuxedo',
  'Blazers',
  'Shirts',
  'Gowns',
] as const

const OUTFIT_MATCHERS: Record<(typeof OUTFIT_FILTERS)[number], string[]> = {
  Agbada: ['agbada'],
  Boubou: ['boubou'],
  Kaftan: ['kaftan', 'kaftans'],
  Dashiki: ['dashiki', 'danshiki'],
  Ankara: ['ankara'],
  Suits: ['suit', 'suits', 'native set', 'senator'],
  Tuxedo: ['tuxedo'],
  Blazers: ['blazer', 'blazers'],
  Shirts: ['shirt', 'shirts', 'dress shirt'],
  Gowns: ['gown', 'gowns', 'wedding gown', 'evening gown'],
}

function ViewportVideo({ src, poster, label, position }: { src: string; poster?: string; label: string; position: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const stopOthers = (event: Event) => { if ((event as CustomEvent<string>).detail !== src) video.pause() }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.65 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.dispatchEvent(new CustomEvent('drapeon:marketplace-video-play', { detail: src }))
        void video.play().catch(() => undefined)
      } else video.pause()
    }, { threshold: [0, 0.65] })
    window.addEventListener('drapeon:marketplace-video-play', stopOthers)
    observer.observe(video)
    return () => { observer.disconnect(); window.removeEventListener('drapeon:marketplace-video-play', stopOthers) }
  }, [src])
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" className="size-full object-cover" style={{ objectPosition: position }} aria-label={label} />
}

export function TailorDirectory({
  tailors,
  params,
  basePath,
  profileBasePath,
}: {
  tailors: PublicTailor[]
  params: TailorDirectoryParams
  basePath: '/explore' | '/account/explore'
  profileBasePath: '/tailors' | '/account/tailors'
}) {
  const query = params.q?.trim().slice(0, 80) ?? ''
  const router = useRouter()
  const activeFilter = params.filter?.trim().slice(0, 60) || 'all'
  const sort = ['rating', 'popular', 'price-low'].includes(params.sort ?? '') ? params.sort! : 'rating'
  const quickFilters = ['all', 'custom', 'ready-made'] as const
  const activeOutfit = OUTFIT_FILTERS.includes(activeFilter as (typeof OUTFIT_FILTERS)[number]) ? activeFilter : ''
  const normalizedQuery = query.toLowerCase()
  const filtered = tailors
    .filter((tailor) => {
      if (normalizedQuery && ![tailor.displayName, tailor.businessName, tailor.location, ...tailor.specialties].join(' ').toLowerCase().includes(normalizedQuery)) return false
      if (activeFilter === 'custom') return tailor.acceptsCustomOrders
      if (activeFilter === 'ready-made') return tailor.supportsReadyMade
      if (activeFilter !== 'all') {
        const matchers = OUTFIT_MATCHERS[activeFilter as keyof typeof OUTFIT_MATCHERS]
        if (!matchers) return true
        const specialties = tailor.specialties.join(' ').toLowerCase()
        return matchers.some((matcher) => specialties.includes(matcher))
      }
      return true
    })
    .sort((a, b) => {
      if (sort === 'popular') return b.totalOrders - a.totalOrders || b.averageRating - a.averageRating
      if (sort === 'price-low') return (a.priceRangeMin ?? Number.MAX_SAFE_INTEGER) - (b.priceRangeMin ?? Number.MAX_SAFE_INTEGER)
      return b.averageRating - a.averageRating || b.totalReviews - a.totalReviews
    })

  return (
    <div className="grid gap-4">
      <form action={basePath} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]" aria-label="Search and sort tailors">
        <label className="relative min-w-0">
          <span className="sr-only">Search tailors</span>
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/42" />
          <input name="q" defaultValue={query} placeholder="Search tailor, specialty, or location" className="h-10 w-full rounded-[8px] border border-ui-border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-needle focus:ring-2 focus:ring-needle/12" />
        </label>
        {activeFilter !== 'all' ? <input type="hidden" name="filter" value={activeFilter} /> : null}
        <label className="flex h-10 items-center gap-2 rounded-[8px] border border-ui-border bg-white px-3">
          <SlidersHorizontal aria-hidden="true" className="size-4 text-ink/42" />
          <span className="sr-only">Sort tailors</span>
          <select name="sort" defaultValue={sort} className="bg-transparent text-sm font-semibold outline-none">
            <option value="rating">Top rated</option>
            <option value="popular">Most orders</option>
            <option value="price-low">Lowest starting price</option>
          </select>
        </label>
        <button className="h-10 rounded-[8px] bg-needle px-4 text-sm font-semibold text-white transition hover:bg-needle-600">Apply</button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Tailor filters">
        {quickFilters.map((value) => {
          const active = activeFilter === value
          return (
            <Link
              key={value}
              href={routeWithParams(basePath, { q: query || undefined, filter: value === 'all' ? undefined : value, sort: sort === 'rating' ? undefined : sort })}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex h-9 shrink-0 items-center rounded-[8px] border px-3 text-sm font-semibold transition-colors ${active ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink hover:border-needle/35'}`}
            >
              {filterLabel(value)}
            </Link>
          )
        })}
        <label className={`relative inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] border px-3 text-sm font-semibold transition-colors ${activeOutfit ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink hover:border-needle/35'}`}>
          <Tags aria-hidden="true" className="size-4" />
          <span className="sr-only">Filter by outfit</span>
          <select
            value={activeOutfit}
            onChange={(event) => {
              const outfit = event.target.value
              router.push(routeWithParams(basePath, {
                q: query || undefined,
                filter: outfit || undefined,
                sort: sort === 'rating' ? undefined : sort,
              }))
            }}
            className="cursor-pointer appearance-none bg-transparent pr-4 text-sm font-semibold outline-none"
            aria-label="Outfit"
          >
            <option value="">Outfit</option>
            {OUTFIT_FILTERS.map((outfit) => <option key={outfit} value={outfit}>{outfit}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2" />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-ink/55">
        <p>{filtered.length} tailor{filtered.length === 1 ? '' : 's'}</p>
        {(query || activeFilter !== 'all' || sort !== 'rating') ? <Link href={basePath} className="font-semibold text-needle">Clear</Link> : null}
      </div>

      {filtered.length ? (
        <section className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-label="Tailors">
          {filtered.map((tailor, index) => {
            const cover = tailor.media.find((media) => media.isPrimary) ?? tailor.media[0]
            const fallback = tailor.portfolioPhotos[0] ?? tailor.avatarUrl
            const source = cover?.url ?? fallback
            const isVideo = cover?.kind === 'VIDEO'
            return (
              <Link key={tailor.id} href={`${profileBasePath}/${tailor.id}` as Route} className="group min-w-0 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
                <article>
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[8px] bg-needle/8">
                    {isVideo && source ? <ViewportVideo src={source} poster={cover?.posterUrl ?? undefined} position={`${(cover?.focalX ?? 0.5) * 100}% ${(cover?.focalY ?? 0.5) * 100}%`} label={cover?.altText ?? `Portfolio video by ${tailor.displayName}`} /> : source ? <Image src={source} alt={cover?.altText ?? `Selected work by ${tailor.displayName}`} fill priority={index < 4} sizes="(min-width:1536px) 16vw,(min-width:1280px) 20vw,(min-width:640px) 30vw,48vw" className="object-cover transition-opacity group-hover:opacity-95" style={{ objectPosition: `${(cover?.focalX ?? 0.5) * 100}% ${(cover?.focalY ?? 0.5) * 100}%` }} /> : <div className="grid size-full place-items-center text-sm font-semibold text-needle/60">{tailor.displayName.slice(0, 2).toUpperCase()}</div>}
                    <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-white/92 text-needle shadow-sm" title="Approved tailor"><ShieldCheck aria-hidden="true" size={14} /></span>
                  </div>
                  <div className="pt-2.5">
                    <div className="flex items-start justify-between gap-2"><h2 className="truncate text-base font-semibold leading-tight text-ink">{tailor.displayName}</h2>{tailor.totalReviews ? <span className="flex shrink-0 items-center gap-1 text-xs text-ink/55"><Star aria-hidden="true" size={11} fill="currentColor" />{tailor.averageRating.toFixed(1)}</span> : null}</div>
                    <p className="mt-1 truncate text-xs text-ink/52">{tailor.location || 'Location available in profile'}</p>
                    <p className="mt-1.5 truncate text-xs text-ink/60">{tailor.specialties.slice(0, 2).join(' · ') || (tailor.acceptsCustomOrders ? 'Custom tailoring' : 'Ready-made')}</p>
                  </div>
                </article>
              </Link>
            )
          })}
        </section>
      ) : (
        <section className="rounded-[8px] border border-ui-border bg-white p-6 text-center"><h2 className="text-xl font-semibold text-ink">No tailors match those filters.</h2><p className="mt-2 text-sm text-ink/58">Clear a filter or try another search.</p><Link href={basePath} className="mt-4 inline-flex h-9 items-center rounded-[8px] bg-needle px-3 text-sm font-semibold text-white">View all tailors</Link></section>
      )}
    </div>
  )
}
