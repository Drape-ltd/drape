'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Archive, ShoppingBag, Users } from 'lucide-react'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'

type Collection = { id: string; name: string | null; cover_image_url: string | null; item_count: number | null; updated_at: string | null }
type SavedEntry = { id: string; collection_id: string; tailor_id: string | null; ready_made_item_id: string | null }
type Tailor = { id: string; display_name: string | null; business_name: string | null; location: string | null; specialty_tags: string[] | null; portfolio_photo_urls: string[] | null; avatar_url: string | null; is_verified: boolean | null; avg_rating: number | null }
type Item = { id: string; title: string | null; category: string | null; price_amount: number | null; currency: string | null; photo_urls: string[] | null; stock_status: string | null }
type SavedData = { collections: Collection[]; entries: SavedEntry[]; tailors: Tailor[]; items: Item[] }

const emptyData: SavedData = { collections: [], entries: [], tailors: [], items: [] }
const tailorSelect = 'id, display_name, business_name, location, specialty_tags, portfolio_photo_urls, avatar_url, is_verified, avg_rating'
const itemSelect = 'id, title, category, price_amount, currency, photo_urls, stock_status'

function validMedia(value: string | null | undefined) {
  if (!value) return null
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null } catch { return null }
}
function name(value: string | null | undefined, fallback: string) { return value?.trim() || fallback }
function money(amount: number | null, currency: string | null) {
  if (amount == null) return 'Price on request'
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount) } catch { return `${currency || 'USD'} ${amount.toFixed(2)}` }
}
function relative(value: string | null) {
  if (!value) return 'recently'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}
function unique(values: Array<string | null>) { return [...new Set(values.filter((value): value is string => Boolean(value)))] }

async function fetchSaved(userId: string): Promise<SavedData> {
  const supabase = createClient()
  const collectionsResult = await supabase.from('wishlist_collections').select('id, name, cover_image_url, item_count, updated_at').eq('customer_id', userId).order('updated_at', { ascending: false }).limit(20)
  if (collectionsResult.error) throw new Error('Saved collections could not load.')
  const collections = (collectionsResult.data ?? []) as Collection[]
  if (!collections.length) return emptyData
  const entriesResult = await supabase.from('wishlist_items').select('id, collection_id, tailor_id, ready_made_item_id').in('collection_id', collections.map((collection) => collection.id)).order('created_at', { ascending: false }).limit(120)
  if (entriesResult.error) throw new Error('Saved items could not load.')
  const entries = (entriesResult.data ?? []) as SavedEntry[]
  const tailorIds = unique(entries.map((entry) => entry.tailor_id))
  const itemIds = unique(entries.map((entry) => entry.ready_made_item_id))
  const [tailorsResult, itemsResult] = await Promise.all([
    tailorIds.length ? supabase.from('tailor_profiles').select(tailorSelect).in('id', tailorIds).limit(80) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from('seller_items').select(itemSelect).in('id', itemIds).limit(80) : Promise.resolve({ data: [], error: null }),
  ])
  if (tailorsResult.error || itemsResult.error) throw new Error('Some saved details could not load.')
  return { collections, entries, tailors: (tailorsResult.data ?? []) as Tailor[], items: (itemsResult.data ?? []) as Item[] }
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="app-surface flex items-center justify-between p-4"><div><p className="text-xs font-semibold uppercase text-ink/48">{label}</p><p className="mt-1 text-2xl font-semibold text-ink">{value}</p></div><span className="text-needle">{icon}</span></div>
}

function SavedContent({ userId }: { userId: string }) {
  const [data, setData] = useState<SavedData>(emptyData)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => { let active = true; void fetchSaved(userId).then((result) => { if (active) { setData(result); setStatus('ready') } }).catch(() => { if (active) setStatus('error') }); return () => { active = false } }, [userId])
  if (status === 'loading') return <div className="app-surface p-6 text-sm text-ink/60">Loading saved work…</div>
  if (status === 'error') return <div className="app-surface p-6"><h2 className="text-xl font-semibold text-ink">Saved work could not load.</h2><p className="mt-2 text-sm text-ink/60">Refresh to retry. Your saved records have not been changed.</p></div>
  const tailorById = new Map(data.tailors.map((tailor) => [tailor.id, tailor]))
  const itemById = new Map(data.items.map((item) => [item.id, item]))
  return <div className="grid gap-5 pb-10">
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Collections" value={data.collections.length} icon={<Archive />} /><Metric label="Saved tailors" value={data.tailors.length} icon={<Users />} /><Metric label="Saved pieces" value={data.items.length} icon={<ShoppingBag />} /></section>
    {!data.collections.length ? <section className="app-surface p-7"><h2 className="text-2xl font-semibold text-ink">Nothing saved yet.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-ink/62">Save tailors and ready-made pieces while comparing options. They will stay organized here.</p><Link href="/account/explore" className="mt-5 inline-flex h-9 items-center rounded-[8px] bg-drape-green px-3 text-sm font-semibold text-white">Explore tailors</Link></section> : null}
    {data.collections.length ? <section className="grid gap-4 md:grid-cols-2">{data.collections.map((collection) => { const entries = data.entries.filter((entry) => entry.collection_id === collection.id); const open = expanded.has(collection.id); const cover = validMedia(collection.cover_image_url) || entries.map((entry) => entry.tailor_id ? validMedia(tailorById.get(entry.tailor_id)?.portfolio_photo_urls?.[0] || tailorById.get(entry.tailor_id)?.avatar_url) : validMedia(itemById.get(entry.ready_made_item_id || '')?.photo_urls?.[0])).find(Boolean) || null; return <article key={collection.id} className="app-surface overflow-hidden"><button type="button" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); open ? next.delete(collection.id) : next.add(collection.id); return next })} className="grid w-full gap-4 p-4 text-left sm:grid-cols-[7rem_1fr]">{cover ? <Image src={cover} alt="" width={224} height={168} unoptimized className="aspect-[4/3] w-full rounded-[8px] object-cover" /> : <div className="aspect-[4/3] rounded-[8px] bg-needle/8" />}<div><p className="text-xs font-semibold uppercase text-needle/76">Wishlist</p><h2 className="mt-1 text-xl font-semibold text-ink">{name(collection.name, 'Wishlist')}</h2><p className="mt-1 text-sm text-ink/54">{collection.item_count ?? entries.length} items · Updated {relative(collection.updated_at)}</p><p className="mt-3 text-xs font-semibold text-needle">{open ? 'Close collection' : 'Open collection'}</p></div></button>{open ? <div className="grid gap-2 border-t border-ui-border p-4">{entries.length ? entries.map((entry) => { const tailor = entry.tailor_id ? tailorById.get(entry.tailor_id) : null; const item = entry.ready_made_item_id ? itemById.get(entry.ready_made_item_id) : null; return <Link key={entry.id} href={tailor ? `/account/tailors/${tailor.id}` : item ? `/account/items/${item.id}` : '/account/explore'} className="rounded-[8px] border border-ui-border px-3 py-2 text-sm font-semibold text-ink hover:border-needle/35">{tailor ? name(tailor.business_name || tailor.display_name, 'Saved tailor') : name(item?.title, 'Saved piece')}</Link> }) : <p className="text-sm text-ink/58">This collection is empty.</p>}</div> : null}</article> })}</section> : null}
    {data.tailors.length ? <section><h2 className="mb-3 text-xs font-semibold uppercase text-ink/48">Saved tailors</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data.tailors.map((tailor) => { const photo = validMedia(tailor.portfolio_photo_urls?.[0] || tailor.avatar_url); return <Link key={tailor.id} href={`/account/tailors/${tailor.id}`} className="app-surface overflow-hidden">{photo ? <Image src={photo} alt="" width={480} height={360} unoptimized className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-needle/8" />}<div className="p-3"><h3 className="font-semibold text-ink">{name(tailor.business_name || tailor.display_name, 'Tailor')}</h3><p className="mt-1 text-sm text-ink/52">{name(tailor.location, 'Location pending')}</p></div></Link> })}</div></section> : null}
    {data.items.length ? <section><h2 className="mb-3 text-xs font-semibold uppercase text-ink/48">Saved ready-made</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data.items.map((item) => { const photo = validMedia(item.photo_urls?.[0]); return <Link key={item.id} href={`/account/items/${item.id}`} className="app-surface overflow-hidden">{photo ? <Image src={photo} alt="" width={480} height={360} unoptimized className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-needle/8" />}<div className="p-3"><h3 className="font-semibold text-ink">{name(item.title, 'Ready-made piece')}</h3><p className="mt-1 text-sm font-semibold text-rust">{money(item.price_amount, item.currency)}</p></div></Link> })}</div></section> : null}
  </div>
}

export function SavedWorkspace() { return <AccountRouteRuntime surface="saved">{({ session }) => <SavedContent userId={session.user.id} />}</AccountRouteRuntime> }
