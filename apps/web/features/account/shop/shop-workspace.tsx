'use client'

import Link from 'next/link'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatMoney } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'
import { CatalogueManager } from './catalogue-manager'
import { legacyItemMedia, MarketplaceMediaTile } from './marketplace-media-tile'

type Tailor = {
  id: string
  display_name: string | null
  business_name: string | null
  location: string | null
  availability: string | null
  shop_paused: boolean | null
  is_live: boolean | null
}
export type ShopItem = {
  id: string
  tailor_profile_id: string | null
  title: string | null
  description: string | null
  category: string | null
  sizes: string[] | null
  price_amount: number | null
  currency: string | null
  photo_urls: string[] | null
  size_inventory: Record<string, number> | null
  size_guide: Record<string, unknown> | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  stock_status: string | null
  inventory_quantity: number | null
  is_live: boolean | null
  updated_at: string | null
  tailor_profiles: Tailor | Tailor[] | null
}
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: ShopItem[]; tailorProfile: OwnerProfile | null }
type OwnerProfile = {
  id: string
  currency: string | null
  supports_ready_made: boolean | null
  profile_completed: boolean | null
  is_verified: boolean | null
  payout_account_verified: boolean | null
  payout_reverification_required: boolean | null
  pickup_address: string | null
}
const select =
  'id, tailor_profile_id, title, description, category, sizes, size_inventory, size_guide, price_amount, currency, photo_urls, stock_status, inventory_quantity, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(id, display_name, business_name, location, availability, shop_paused, is_live)'
function joined(value: Tailor | Tailor[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value
}
function label(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback
}

async function loadShop(userId: string, role: AccountRouteIdentity['role']) {
  const supabase = createClient()
  let tailorProfile: OwnerProfile | null = null
  if (role === 'TAILOR') {
    const profile = await supabase
      .from('tailor_profiles')
      .select(
        'id, currency, supports_ready_made, profile_completed, is_verified, payout_account_verified, payout_reverification_required'
      )
      .eq('user_id', userId)
      .maybeSingle()
    if (profile.error) throw new Error('Your catalogue identity could not load.')
    const baseProfile = profile.data as Omit<OwnerProfile, 'pickup_address'> | null
    if (baseProfile) {
      const pickup = await supabase
        .from('tailor_pickup_details')
        .select('pickup_address')
        .eq('user_id', userId)
        .maybeSingle()
      if (pickup.error) throw new Error('Your private pickup details could not load.')
      tailorProfile = {
        ...baseProfile,
        pickup_address:
          (pickup.data as { pickup_address?: string | null } | null)?.pickup_address ?? null,
      }
    }
  }
  let query = supabase
    .from('seller_items')
    .select(select)
    .order('updated_at', { ascending: false })
    .limit(48)
  query = tailorProfile
    ? query.eq('tailor_profile_id', tailorProfile.id)
    : query.eq('is_live', true).not('stock_status', 'in', '(SOLD_OUT,HIDDEN)')
  const result = await query
  if (result.error) throw new Error('Marketplace pieces could not load. Refresh to retry.')
  return { items: (result.data ?? []) as unknown as ShopItem[], tailorProfile }
}

function ShopContent({ userId, identity }: { userId: string; identity: AccountRouteIdentity }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState('newest')
  useEffect(() => {
    let active = true
    void loadShop(userId, identity.role)
      .then((data) => {
        if (active) setState({ status: 'ready', ...data })
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Marketplace unavailable.',
          })
      })
    return () => {
      active = false
    }
  }, [identity.role, revision, userId])
  useEffect(() => {
    if (state.status !== 'ready') return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel(`web-shop:${state.tailorProfile?.id || 'public'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'seller_items',
          ...(state.tailorProfile?.id
            ? { filter: `tailor_profile_id=eq.${state.tailorProfile.id}` }
            : {}),
        },
        () => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => setRevision((value) => value + 1), 180)
        }
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [state])
  const derived = useMemo(() => {
    if (state.status !== 'ready') return { categories: [], items: [] }
    const categories = [
      ...new Set(
        state.items.map((item) => item.category).filter((value): value is string => Boolean(value))
      ),
    ].sort()
    const needle = search.trim().toLowerCase()
    const items = state.items
      .filter(
        (item) =>
          (category === 'All' || item.category === category) &&
          (!needle ||
            [
              item.title,
              item.description,
              item.category,
              joined(item.tailor_profiles)?.business_name,
              joined(item.tailor_profiles)?.display_name,
              joined(item.tailor_profiles)?.location,
            ]
              .join(' ')
              .toLowerCase()
              .includes(needle))
      )
      .sort((a, b) =>
        sort === 'price-low'
          ? (a.price_amount ?? Infinity) - (b.price_amount ?? Infinity)
          : sort === 'price-high'
            ? (b.price_amount ?? -1) - (a.price_amount ?? -1)
            : new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
      )
    return { categories, items }
  }, [category, search, sort, state])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-6" aria-busy="true">
        Loading the marketplace…
      </section>
    )
  if (state.status === 'error')
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Marketplace unavailable</h2>
        <p className="mt-2 text-sm text-ink/62">{state.message}</p>
        <button
          className="mt-4 h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white"
          onClick={() => setRevision((v) => v + 1)}
        >
          Try again
        </button>
      </section>
    )
  const isTailor = identity.role === 'TAILOR'
  if (isTailor && state.tailorProfile) {
    return (
      <CatalogueManager
        userId={userId}
        profile={state.tailorProfile}
        items={state.items}
        onRefresh={() => setRevision((value) => value + 1)}
      />
    )
  }
  return (
    <div className="grid gap-5 pb-10">
      <div className="flex justify-end">
        {!isTailor ? (
          <Link
            href="/account/explore"
            className="inline-flex h-9 items-center rounded-[8px] bg-drape-green px-3 text-sm font-semibold text-white"
          >
            Explore tailors
          </Link>
        ) : null}
      </div>
      <section aria-label="Marketplace filters" className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="relative">
          <span className="sr-only">Search pieces</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/45" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pieces, tailors, or locations"
            className="h-10 w-full rounded-[8px] border border-ui-border bg-white pl-9 pr-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
          />
        </label>
        <label className="flex items-center gap-2 rounded-[8px] border border-ui-border bg-white px-3">
          <SlidersHorizontal className="size-4 text-ink/45" />
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="h-10 bg-transparent text-sm font-semibold outline-none"
          >
            <option value="newest">Newest</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </label>
      </section>
      {derived.categories.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Categories">
          {['All', ...derived.categories].map((value) => (
            <button
              key={value}
              onClick={() => setCategory(value)}
              aria-pressed={category === value}
              className={`h-8 shrink-0 rounded-[8px] border px-3 text-xs font-semibold transition-colors ${category === value ? 'border-drape-green bg-drape-green text-white' : 'border-ui-border bg-white text-ink hover:border-needle/40'}`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between text-sm text-ink/55">
        <p>
          {derived.items.length} piece{derived.items.length === 1 ? '' : 's'}
        </p>
        {search || category !== 'All' ? (
          <button
            className="font-semibold text-needle"
            onClick={() => {
              setSearch('')
              setCategory('All')
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {!derived.items.length ? (
        <section className="app-surface p-7">
          <h2 className="text-xl font-semibold">No matching pieces.</h2>
          <p className="mt-2 text-sm text-ink/60">
            Adjust the filters or explore tailor portfolios instead.
          </p>
        </section>
      ) : (
        <section
          className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 xl:grid-cols-4"
          aria-label="Marketplace pieces"
        >
          {derived.items.map((item, index) => {
            const tailor = joined(item.tailor_profiles)
            const media =
              legacyItemMedia(item.photo_urls, label(item.title, 'Ready-made piece'))[0] ?? null
            return (
              <Link
                key={item.id}
                href={`/account/items/${item.id}`}
                className="group min-w-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-needle"
              >
                <article>
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[8px] bg-needle/8">
                    <MarketplaceMediaTile
                      media={media}
                      title={label(item.title, 'Ready-made piece')}
                      priority={index < 4}
                      className="transition-opacity duration-200 group-hover:opacity-95"
                    />
                    {!item.is_live ? (
                      <span className="absolute left-2 top-2 rounded-[6px] bg-ink/80 px-2 py-1 text-[0.65rem] font-semibold text-white">
                        Draft
                      </span>
                    ) : null}
                  </div>
                  <div className="pt-2">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate text-sm font-semibold text-ink">
                        {label(item.title, 'Ready-made piece')}
                      </h2>
                      <p className="shrink-0 text-sm font-semibold text-ink">
                        {formatMoney(item.price_amount, item.currency)}
                      </p>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink/55">
                      {isTailor
                        ? label(item.stock_status, 'Stock pending')
                        : `${label(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')} · ${label(tailor?.location, 'Worldwide')}`}
                    </p>
                  </div>
                </article>
              </Link>
            )
          })}
        </section>
      )}
    </div>
  )
}

export function ShopWorkspace() {
  return (
    <AccountRouteRuntime surface="shop">
      {({ session, identity }) => <ShopContent userId={session.user.id} identity={identity} />}
    </AccountRouteRuntime>
  )
}
