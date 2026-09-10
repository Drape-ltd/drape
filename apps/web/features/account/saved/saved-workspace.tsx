'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { Route } from 'next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Clock3, Heart, Plus, X } from 'lucide-react'
import { createClient } from '../../../lib/supabase'
import { invalidateAccountData } from '../../../lib/account-data-cache'
import { AccountRouteRuntime } from '../account-route-runtime'
import {
  loadRecentlyViewedTailors,
  type RecentlyViewedTailor,
} from '../../../lib/recently-viewed-tailors'

type Collection = { id: string; name: string | null; cover_image_url: string | null }
type Entry = {
  id: string
  collection_id: string
  tailor_id: string | null
  ready_made_item_id: string | null
  note: string | null
}
type Tailor = {
  id: string
  display_name: string | null
  business_name: string | null
  location: string | null
  portfolio_photo_urls: string[] | null
  avatar_url: string | null
}
type Item = {
  id: string
  title: string | null
  price_amount: number | null
  currency: string | null
  photo_urls: string[] | null
}
type Data = { collections: Collection[]; entries: Entry[]; tailors: Tailor[]; items: Item[] }
type Editor =
  | { type: 'create' }
  | { type: 'rename'; collection: Collection }
  | { type: 'note'; entry: Entry }
  | null
const emptyData: Data = { collections: [], entries: [], tailors: [], items: [] }

const label = (value: string | null | undefined, fallback: string) => value?.trim() || fallback
const ids = (values: Array<string | null>) => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
]
function media(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
function price(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return 'Price on request'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount)
  } catch {
    return `${currency || 'USD'} ${amount}`
  }
}

async function load(userId: string): Promise<Data> {
  const supabase = createClient()
  const collectionsResult = await supabase
    .from('wishlist_collections')
    .select('id, name, cover_image_url')
    .eq('customer_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (collectionsResult.error) throw collectionsResult.error
  const collections = (collectionsResult.data ?? []) as Collection[]
  if (!collections.length) return emptyData
  const entriesResult = await supabase
    .from('wishlist_items')
    .select('id, collection_id, tailor_id, ready_made_item_id, note')
    .in(
      'collection_id',
      collections.map(({ id }) => id)
    )
    .order('created_at', { ascending: false })
    .limit(120)
  if (entriesResult.error) throw entriesResult.error
  const entries = (entriesResult.data ?? []) as Entry[]
  const tailorIds = ids(entries.map(({ tailor_id }) => tailor_id))
  const itemIds = ids(entries.map(({ ready_made_item_id }) => ready_made_item_id))
  const [tailorsResult, itemsResult] = await Promise.all([
    tailorIds.length
      ? supabase
          .from('tailor_profiles')
          .select('id, display_name, business_name, location, portfolio_photo_urls, avatar_url')
          .in('id', tailorIds)
      : Promise.resolve({ data: [], error: null }),
    itemIds.length
      ? supabase
          .from('seller_items')
          .select('id, title, price_amount, currency, photo_urls')
          .in('id', itemIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (tailorsResult.error || itemsResult.error) throw tailorsResult.error || itemsResult.error
  return {
    collections,
    entries,
    tailors: (tailorsResult.data ?? []) as Tailor[],
    items: (itemsResult.data ?? []) as Item[],
  }
}

async function act(body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke<{
    error?: string
    message?: string
  }>('saved-tailor-action', { body })
  if (error) throw error
  if (data?.error) throw new Error(data.message || data.error)
}

function EditorModal({
  editor,
  busy,
  close,
  submit,
}: {
  editor: NonNullable<Editor>
  busy: boolean
  close: () => void
  submit: (value: string) => void
}) {
  const [value, setValue] = useState(
    editor.type === 'rename'
      ? (editor.collection.name ?? '')
      : editor.type === 'note'
        ? (editor.entry.note ?? '')
        : ''
  )
  const isNote = editor.type === 'note'
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-ink/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <form
        className="w-full max-w-md rounded-[12px] bg-white p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          submit(value.trim())
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {editor.type === 'create'
              ? 'New wishlist'
              : editor.type === 'rename'
                ? 'Rename wishlist'
                : 'Private note'}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full border border-ink/10"
          >
            <X className="size-4" />
          </button>
        </div>
        {isNote ? (
          <textarea
            autoFocus
            rows={4}
            maxLength={240}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-5 w-full resize-none rounded-[8px] border border-ink/12 p-3 text-sm outline-none focus:border-needle"
            placeholder="Why did you save this?"
          />
        ) : (
          <input
            autoFocus
            maxLength={80}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-5 h-11 w-full rounded-[8px] border border-ink/12 px-3 text-sm outline-none focus:border-needle"
            placeholder="e.g. Wedding ideas"
          />
        )}
        <button
          disabled={busy || (!isNote && !value.trim())}
          className="mt-4 h-10 rounded-[8px] bg-needle px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : isNote ? 'Save note' : 'Save wishlist'}
        </button>
      </form>
    </div>
  )
}

function Wishlists({ userId }: { userId: string }) {
  const [data, setData] = useState<Data>(emptyData)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedTailor[]>([])
  const [showGuide, setShowGuide] = useState(false)
  const refresh = useCallback(async () => {
    setState('loading')
    try {
      setData(await load(userId))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [userId])
  useEffect(() => {
    queueMicrotask(() => {
      void refresh()
    })
  }, [refresh])
  useEffect(() => {
    queueMicrotask(() => {
      setRecentlyViewed(loadRecentlyViewedTailors(userId))
      setShowGuide(window.localStorage.getItem(`drape_saved_best_use_dismissed:${userId}`) !== '1')
    })
  }, [userId])
  const tailors = useMemo(
    () => new Map(data.tailors.map((value) => [value.id, value])),
    [data.tailors]
  )
  const items = useMemo(() => new Map(data.items.map((value) => [value.id, value])), [data.items])
  const selected = data.collections.find(({ id }) => id === selectedId) ?? null
  const collectionEntries = (id: string) =>
    data.entries.filter(({ collection_id }) => collection_id === id)
  const entryInfo = (entry: Entry) => {
    const tailor = entry.tailor_id ? tailors.get(entry.tailor_id) : null
    const item = entry.ready_made_item_id ? items.get(entry.ready_made_item_id) : null
    return {
      title: tailor
        ? label(tailor.business_name || tailor.display_name, 'Tailor')
        : label(item?.title, 'Ready-made piece'),
      subtitle: tailor
        ? label(tailor.location, 'Location pending')
        : price(item?.price_amount, item?.currency),
      image: tailor
        ? media(tailor.portfolio_photo_urls?.[0] || tailor.avatar_url)
        : media(item?.photo_urls?.[0]),
      href: (tailor
        ? `/account/tailors/${tailor.id}`
        : item
          ? `/account/items/${item.id}`
          : '/account/explore') as Route,
    }
  }
  const cover = (collection: Collection) =>
    media(collection.cover_image_url) ||
    collectionEntries(collection.id)
      .map((entry) => entryInfo(entry).image)
      .find(Boolean) ||
    null
  async function mutate(body: Record<string, unknown>, success: string) {
    setBusy(true)
    setNotice(null)
    try {
      await act(body)
      invalidateAccountData(`wishlist:${userId}:`)
      await refresh()
      setNotice(success)
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Your wishlist could not be updated.')
      return false
    } finally {
      setBusy(false)
    }
  }
  async function submit(value: string) {
    if (!editor) return
    const body =
      editor.type === 'create'
        ? { action: 'create-collection', name: value }
        : editor.type === 'rename'
          ? { action: 'rename-collection', collectionId: editor.collection.id, name: value }
          : { action: 'add-note', itemId: editor.entry.id, note: value || null }
    if (await mutate(body, 'Wishlist updated.')) setEditor(null)
  }
  if (state === 'loading')
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((key) => (
          <div key={key} className="aspect-[4/3] animate-pulse rounded-[10px] bg-ink/6" />
        ))}
      </div>
    )
  if (state === 'error')
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Couldn&apos;t load your wishlists.</h2>
        <p className="mt-2 text-sm text-ink/58">Your saved choices have not been changed.</p>
        <button
          onClick={() => void refresh()}
          className="mt-4 h-9 rounded-[8px] bg-needle px-3 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </section>
    )
  const cards = (entries: Entry[]) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {entries.map((entry) => {
        const info = entryInfo(entry)
        return (
          <article
            key={entry.id}
            className="overflow-hidden rounded-[10px] border border-ink/8 bg-white"
          >
            <Link href={info.href}>
              {info.image ? (
                <Image
                  src={info.image}
                  alt=""
                  width={480}
                  height={600}
                  unoptimized
                  className="aspect-[4/5] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[4/5] place-items-center bg-needle/7">
                  <Heart className="size-6 text-needle/50" />
                </div>
              )}
              <div className="p-3">
                <h3 className="truncate text-sm font-semibold">{info.title}</h3>
                <p className="mt-1 truncate text-xs text-ink/50">{info.subtitle}</p>
                {entry.note ? (
                  <p className="mt-2 line-clamp-2 text-xs text-ink/58">{entry.note}</p>
                ) : null}
              </div>
            </Link>
            <div className="flex items-center gap-1 border-t border-ink/7 p-2">
              <button
                onClick={() => setEditor({ type: 'note', entry })}
                className="h-8 px-2 text-xs font-semibold text-needle"
              >
                {entry.note ? 'Edit note' : 'Add note'}
              </button>
              {data.collections.length > 1 ? (
                <label className="relative ml-auto">
                  <select
                    aria-label={`Move ${info.title}`}
                    defaultValue=""
                    onChange={(event) => {
                      const targetCollectionId = event.target.value
                      event.currentTarget.value = ''
                      if (targetCollectionId)
                        void mutate(
                          { action: 'move-item', itemId: entry.id, targetCollectionId },
                          'Item moved.'
                        )
                    }}
                    className="h-8 appearance-none rounded-[7px] border border-ink/10 bg-white pl-2 pr-6 text-xs font-semibold"
                  >
                    <option value="" disabled>
                      Move
                    </option>
                    {data.collections
                      .filter(({ id }) => id !== entry.collection_id)
                      .map((collection) => (
                        <option key={collection.id} value={collection.id}>
                          {label(collection.name, 'Wishlist')}
                        </option>
                      ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 top-2 size-3.5" />
                </label>
              ) : null}
              <button
                onClick={() => {
                  if (window.confirm('Remove this item from the wishlist?'))
                    void mutate({ action: 'remove-item', itemId: entry.id }, 'Item removed.')
                }}
                className="grid size-8 place-items-center text-rust"
                aria-label={`Remove ${info.title}`}
              >
                <X className="size-4" />
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
  return (
    <div className="grid gap-5 pb-10 pt-3">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-4">
        <div>
          <h1 className="text-3xl font-semibold leading-none">Wishlists</h1>
          <p className="mt-2 text-sm text-ink/55">
            {data.collections.length} wishlist{data.collections.length === 1 ? '' : 's'} ·{' '}
            {data.entries.length} saved item{data.entries.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={() => setEditor({ type: 'create' })}
          className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-needle px-4 text-sm font-semibold text-white"
        >
          <Plus className="size-4" /> New wishlist
        </button>
      </header>
      {selected ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm font-semibold text-needle"
            >
              ← All wishlists
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setEditor({ type: 'rename', collection: selected })}
                className="h-9 rounded-[8px] border border-ink/10 px-3 text-sm font-semibold"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Delete this wishlist and everything saved inside it?'))
                    void mutate(
                      { action: 'delete-collection', collectionId: selected.id },
                      'Wishlist deleted.'
                    ).then((ok) => {
                      if (ok) setSelectedId(null)
                    })
                }}
                className="h-9 rounded-[8px] border border-rust/20 px-3 text-sm font-semibold text-rust"
              >
                Delete
              </button>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">{label(selected.name, 'Wishlist')}</h2>
            <p className="mt-1 text-sm text-ink/50">
              {collectionEntries(selected.id).length} saved item
              {collectionEntries(selected.id).length === 1 ? '' : 's'}
            </p>
          </div>
          {collectionEntries(selected.id).length ? (
            cards(collectionEntries(selected.id))
          ) : (
            <Empty onCreate={() => setSelectedId(null)} />
          )}
        </>
      ) : (
        <>
          {recentlyViewed.length ? (
            <section aria-labelledby="recently-viewed-title">
              <div className="flex items-center gap-2">
                <Clock3 className="size-4 text-needle" />
                <h2 id="recently-viewed-title" className="text-base font-semibold">
                  Recently viewed
                </h2>
              </div>
              <p className="mt-1 text-xs text-ink/48">
                Reopen a profile or save it into a wishlist.
              </p>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {recentlyViewed.map((tailor) => (
                  <Link
                    key={tailor.id}
                    href={`/account/tailors/${tailor.id}`}
                    className="w-36 shrink-0"
                  >
                    {tailor.photo ? (
                      <Image
                        src={tailor.photo}
                        alt=""
                        width={144}
                        height={112}
                        unoptimized
                        className="aspect-[4/3] w-full rounded-[9px] object-cover"
                      />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center rounded-[9px] bg-needle/8 text-sm font-semibold text-needle">
                        {tailor.displayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <p className="mt-2 truncate text-sm font-semibold">{tailor.displayName}</p>
                    <p className="truncate text-xs text-ink/48">{tailor.location}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {showGuide ? (
            <div className="flex items-center justify-between gap-3 rounded-[9px] bg-needle/7 px-4 py-3 text-sm text-needle">
              <span>Tap the heart on any tailor or ready-made piece to save it here.</span>
              <button
                type="button"
                aria-label="Dismiss wishlist guide"
                className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-needle/10"
                onClick={() => {
                  window.localStorage.setItem(`drape_saved_best_use_dismissed:${userId}`, '1')
                  setShowGuide(false)
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}
          {data.collections.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.collections.map((collection) => {
                const image = cover(collection)
                const count = collectionEntries(collection.id).length
                return (
                  <button
                    key={collection.id}
                    onClick={() => setSelectedId(collection.id)}
                    className="overflow-hidden rounded-[10px] border border-ink/8 bg-white text-left"
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        width={480}
                        height={360}
                        unoptimized
                        className="aspect-[4/3] w-full object-cover"
                      />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center bg-needle/7">
                        <Heart className="size-6 text-needle" />
                      </div>
                    )}
                    <div className="p-3">
                      <h2 className="truncate text-base font-semibold">
                        {label(collection.name, 'Wishlist')}
                      </h2>
                      <p className="mt-1 text-xs text-ink/50">
                        {count} item{count === 1 ? '' : 's'}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <Empty onCreate={() => setEditor({ type: 'create' })} />
          )}
        </>
      )}
      {notice ? (
        <p
          className="rounded-[8px] border border-needle/15 bg-needle/5 px-3 py-2 text-sm text-needle"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {editor ? (
        <EditorModal
          editor={editor}
          busy={busy}
          close={() => setEditor(null)}
          submit={(value) => void submit(value)}
        />
      ) : null}
    </div>
  )
}
function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="app-surface p-7">
      <Heart className="size-6 text-needle" />
      <h2 className="mt-4 text-xl font-semibold">Nothing saved here yet.</h2>
      <p className="mt-2 text-sm text-ink/58">
        Create a wishlist, then save tailors and ready-made pieces while comparing.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onCreate}
          className="h-9 rounded-[8px] bg-needle px-3 text-sm font-semibold text-white"
        >
          Create wishlist
        </button>
        <Link
          href="/account/explore"
          className="inline-flex h-9 items-center rounded-[8px] border border-ink/10 px-3 text-sm font-semibold"
        >
          Browse tailors
        </Link>
      </div>
    </section>
  )
}

export function SavedWorkspace() {
  return (
    <AccountRouteRuntime surface="saved">
      {({ session }) => <Wishlists userId={session.user.id} />}
    </AccountRouteRuntime>
  )
}
