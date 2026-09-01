import type { Metadata, Route } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Scissors, Search, Shirt, ShoppingBag, ShieldCheck } from 'lucide-react'
import { PublicSiteHeader } from '../../components/public-site-header'
import { SiteFooter } from '../../components/site-footer'
import { buildMetadata } from '../../lib/metadata'
import { getApprovedPublicTailors, type PublicTailor } from '../../lib/public-marketplace'

export const metadata: Metadata = buildMetadata({
  title: 'Explore independent tailors',
  description: 'Browse approved Drapeon tailor profiles and find the right fit for your next project.',
  path: '/explore',
})

type ExplorePageProps = { searchParams: Promise<{ q?: string; mode?: string; page?: string }> }

const EXPLORE_PAGE_SIZE = 20

function TailorCard({ tailor, priority = false }: { tailor: PublicTailor; priority?: boolean }) {
  const image = tailor.portfolioPhotos[0] ?? tailor.avatarUrl
  return (
    <article className="group min-w-0">
      <Link href={`/tailors/${tailor.id}` as Route} className="block rounded-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
        <div className="relative aspect-square overflow-hidden rounded-[10px] bg-[#e7dfd0]">
          {tailor.coverVideoUrl ? <video src={tailor.coverVideoUrl} className="h-full w-full object-cover" autoPlay muted loop playsInline preload="metadata" aria-label={`Portfolio video by ${tailor.displayName}`} /> : image ? <Image src={image} alt={`Selected work by ${tailor.displayName}`} fill priority={priority} sizes="(min-width:1536px) 18vw,(min-width:1024px) 22vw,(min-width:640px) 33vw,50vw" className="object-cover transition duration-300 group-hover:scale-[1.015] motion-reduce:transition-none" unoptimized /> : null}
          <span className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-white/92 text-needle shadow-sm" title="Approved tailor"><ShieldCheck aria-hidden="true" size={14} /></span>
        </div>
        <div className="pt-3">
          <h2 className="text-lg leading-none">{tailor.displayName}</h2>
          {tailor.location ? <p className="mt-1.5 truncate text-xs text-ink/48">{tailor.location}</p> : null}
        </div>
      </Link>
    </article>
  )
}

export default async function ExplorePage({ searchParams }: ExplorePageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const rawQuery = params.q?.trim().slice(0, 80) ?? ''
  const query = rawQuery.toLowerCase()
  const mode = params.mode === 'custom' || params.mode === 'ready-made' ? params.mode : 'all'
  const requestedPage = Number.parseInt(params.page ?? '1', 10)
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1
  const pageRows = await getApprovedPublicTailors(EXPLORE_PAGE_SIZE + 1, (page - 1) * EXPLORE_PAGE_SIZE, rawQuery)
  const hasNextPage = pageRows.length > EXPLORE_PAGE_SIZE
  const tailors = pageRows.slice(0, EXPLORE_PAGE_SIZE)
  const filtered = tailors.filter((tailor) => {
    const text = [tailor.displayName, tailor.businessName, tailor.location].join(' ').toLowerCase()
    if (query && !text.includes(query)) return false
    if (mode === 'custom' && !tailor.acceptsCustomOrders) return false
    if (mode === 'ready-made' && !tailor.supportsReadyMade) return false
    return true
  })
  const filterLinks = [
    { value: 'all', label: 'All tailors', icon: Scissors, count: tailors.length },
    { value: 'custom', label: 'Custom orders', icon: Shirt, count: tailors.filter((tailor) => tailor.acceptsCustomOrders).length },
    { value: 'ready-made', label: 'Ready-made', icon: ShoppingBag, count: tailors.filter((tailor) => tailor.supportsReadyMade).length },
  ] as const
  const pageHref = (nextPage: number) => {
    const nextParams = new URLSearchParams()
    if (rawQuery) nextParams.set('q', rawQuery)
    if (mode !== 'all') nextParams.set('mode', mode)
    if (nextPage > 1) nextParams.set('page', String(nextPage))
    const suffix = nextParams.toString()
    return `${suffix ? `/explore?${suffix}` : '/explore'}` as Route
  }

  return (
    <main className="min-h-screen bg-[#f4f0e8] text-ink">
      <div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6"><PublicSiteHeader /></div>

      <section className="mx-auto max-w-[92rem] px-5 pb-8 pt-10 sm:px-8 sm:pt-12">
        <div className="grid gap-5 border-b border-ink/10 pb-8 lg:grid-cols-[1fr_0.72fr] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">Independent tailors</p>
            <h1 className="mt-3 max-w-3xl text-4xl leading-[0.98] sm:text-5xl">Find the right tailor for your next piece.</h1>
          </div>
          <div>
            <p className="max-w-xl text-sm leading-6 text-ink/62">Approved profiles with real portfolio work.</p>
            <form className="mt-5 flex items-center gap-3" action="/explore">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search approved tailors</span>
                <Search aria-hidden="true" size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/42" />
                <input name="q" defaultValue={params.q ?? ''} placeholder="Search tailor or location" className="h-11 w-full rounded-full border border-ink/12 bg-[#faf8f3] pl-10 pr-4 text-sm outline-none placeholder:text-ink/38 focus:border-needle focus:ring-2 focus:ring-needle/10" />
              </label>
              {mode !== 'all' ? <input type="hidden" name="mode" value={mode} /> : null}
              <button className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-needle px-4 text-xs font-semibold text-white transition-colors hover:bg-needle-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">Search</button>
            </form>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[92rem] gap-8 px-5 pb-16 sm:px-8 lg:grid-cols-[13rem_1fr] lg:pb-20">
        <aside className="h-fit border-b border-ink/10 pb-6 lg:sticky lg:top-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/42">Browse</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-1">
            {filterLinks.map((filter) => {
              const active = mode === filter.value
              const href = `${filter.value === 'all' ? '/explore' : `/explore?mode=${filter.value}`}${query ? `${filter.value === 'all' ? '?' : '&'}q=${encodeURIComponent(query)}` : ''}` as Route
              const Icon = filter.icon
              return <Link key={filter.value} href={href} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${active ? 'bg-ink text-white' : 'text-ink/65 hover:bg-white/55'}`}><span className="flex items-center gap-2"><Icon aria-hidden="true" size={14} />{filter.label}</span><span className={active ? 'text-xs text-white/55' : 'text-xs text-ink/35'}>{filter.count}</span></Link>
            })}
          </div>
          <p className="mt-6 hidden text-xs leading-5 text-ink/45 lg:block">Only reviewed profiles and original portfolio work appear here.</p>
        </aside>
        <div className="min-w-0">
          <div className="mb-6 flex items-center justify-between gap-4">
            <p className="text-sm font-medium">{query ? `${filtered.length} result${filtered.length === 1 ? '' : 's'}` : 'Available now'}</p>
            <p className="text-xs text-ink/48">Page {page}</p>
          </div>
        {filtered.length === 0 ? (
          <div className="grid min-h-72 place-items-center rounded-[16px] border border-ink/8 bg-[#faf8f3] px-6 text-center">
            <div className="max-w-lg"><h2 className="text-3xl">No approved profile matches that search.</h2><p className="mt-4 text-sm leading-7 text-ink/60">Try a tailor name or location. New profiles appear only after Drapeon review.</p><Link href="/explore" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-needle">Clear search <ArrowRight aria-hidden="true" size={15} /></Link></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((tailor, index) => <TailorCard key={tailor.id} tailor={tailor} priority={index < 3} />)}
          </div>
        )}
        {page > 1 || hasNextPage ? (
          <nav className="mt-10 flex items-center justify-between border-t border-ink/10 pt-5" aria-label="Explore pages">
            {page > 1 ? <Link href={pageHref(page - 1)} className="inline-flex h-9 items-center rounded-full border border-ink/15 px-4 text-xs font-semibold hover:bg-white/60">Previous</Link> : <span />}
            {hasNextPage ? <Link href={pageHref(page + 1)} className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-xs font-semibold text-white hover:bg-ink/90">More tailors <ArrowRight aria-hidden="true" size={14} /></Link> : null}
          </nav>
        ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-[92rem] px-5 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
