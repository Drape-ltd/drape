'use client'

import { Bookmark, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { invalidateAccountData } from '../lib/account-data-cache'
import { createClient } from '../lib/supabase'

type WishlistTarget =
  | { type: 'TAILOR'; id: string }
  | { type: 'READY_MADE_ITEM'; id: string }

type Collection = { id: string; name: string | null }
type SavedEntry = {
  id: string
  collection_id: string
  tailor_id: string | null
  ready_made_item_id: string | null
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke<{ error?: string; message?: string }>(
    'saved-tailor-action',
    { body },
  )
  if (error || data?.error) throw new Error(data?.message ?? 'Your wishlist could not be updated.')
}

export function WishlistSaveControl({
  userId,
  target,
}: {
  userId: string
  target: WishlistTarget
}) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [entries, setEntries] = useState<SavedEntry[]>([])
  const [collectionCounts, setCollectionCounts] = useState<Record<string, number>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const collectionResult = await supabase
      .from('wishlist_collections')
      .select('id, name')
      .eq('customer_id', userId)
      .order('updated_at', { ascending: false })
    if (collectionResult.error) throw collectionResult.error
    const nextCollections = (collectionResult.data ?? []) as Collection[]
    setCollections(nextCollections)
    if (!nextCollections.length) {
      setEntries([])
      setCollectionCounts({})
      return
    }
    const entryResult = await supabase
      .from('wishlist_items')
      .select('id, collection_id, tailor_id, ready_made_item_id')
      .in('collection_id', nextCollections.map(({ id }) => id))
    if (entryResult.error) throw entryResult.error
    const allEntries = (entryResult.data ?? []) as SavedEntry[]
    setCollectionCounts(allEntries.reduce<Record<string, number>>((result, entry) => {
      result[entry.collection_id] = (result[entry.collection_id] ?? 0) + 1
      return result
    }, {}))
    setEntries(allEntries.filter((entry) => target.type === 'TAILOR'
      ? entry.tailor_id === target.id
      : entry.ready_made_item_id === target.id))
  }, [target.id, target.type, userId])

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch(() => setMessage('Wishlists could not load. Try again.'))
    })
  }, [load])

  const savedEntry = entries[0] ?? null
  async function save(input: { collectionId?: string; collectionName?: string }) {
    setBusy(true)
    setMessage(null)
    try {
      await invoke({
        action: target.type === 'TAILOR' ? 'save-tailor' : 'save-ready-made-item',
        ...(target.type === 'TAILOR' ? { tailorProfileId: target.id } : { readyMadeItemId: target.id }),
        ...input,
      })
      invalidateAccountData(`wishlist:${userId}:`)
      await load()
      setPickerOpen(false)
      setNewName('')
      setMessage('Saved to your wishlist.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your wishlist could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function toggle() {
    if (busy) return
    if (savedEntry) {
      setBusy(true)
      setMessage(null)
      try {
        await invoke({ action: 'remove-item', itemId: savedEntry.id })
        invalidateAccountData(`wishlist:${userId}:`)
        await load()
        setMessage('Removed from your wishlist.')
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Your wishlist could not be updated.')
      } finally {
        setBusy(false)
      }
      return
    }
    const onlyCollection = collections.length === 1 ? collections[0] : null
    if (onlyCollection) {
      await save({ collectionId: onlyCollection.id })
      return
    }
    setPickerOpen(true)
  }

  return (
    <div className="relative" aria-live="polite">
      <button
        type="button"
        onClick={() => { void toggle() }}
        disabled={busy}
        aria-pressed={Boolean(savedEntry)}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/14 px-4 text-xs font-semibold text-ink transition-colors hover:border-needle hover:text-needle disabled:cursor-wait disabled:opacity-55"
      >
        <Bookmark aria-hidden="true" size={14} fill={savedEntry ? 'currentColor' : 'none'} />
        {busy ? 'Updating…' : savedEntry ? 'Saved' : 'Save'}
      </button>
      {message ? <p className="mt-2 max-w-64 text-xs text-ink/58">{message}</p> : null}
      {pickerOpen ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="wishlist-picker-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false) }}>
          <section className="w-full max-w-md rounded-[12px] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div><h2 id="wishlist-picker-title" className="text-xl font-semibold">Save to wishlist</h2><p className="mt-1 text-xs text-ink/52">Keep this in the collection where you will look for it.</p></div>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label="Close wishlist picker" className="grid size-9 shrink-0 place-items-center rounded-full border border-ink/10"><X className="size-4" /></button>
            </div>
            {collections.length ? (
              <div className="mt-4 grid gap-2">
                {collections.map((collection) => (
                  <button key={collection.id} type="button" disabled={busy} onClick={() => { void save({ collectionId: collection.id }) }} className="flex min-h-12 items-center justify-between rounded-[8px] border border-ui-border px-4 text-left transition-colors hover:border-needle/45 hover:bg-needle/5">
                    <span className="truncate text-sm font-semibold">{collection.name?.trim() || 'Wishlist'}</span>
                    <span className="shrink-0 text-xs text-ink/45">{collectionCounts[collection.id] ?? 0} saved</span>
                  </button>
                ))}
              </div>
            ) : <p className="mt-4 rounded-[8px] bg-needle/6 px-3 py-2 text-sm text-ink/62">Create your first wishlist to save this.</p>}
            <form className="mt-4 flex gap-2 border-t border-ink/8 pt-4" onSubmit={(event) => { event.preventDefault(); const name = newName.trim(); if (name) void save({ collectionName: name }) }}>
              <label className="min-w-0 flex-1"><span className="sr-only">New wishlist name</span><input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="New wishlist name" className="h-10 w-full rounded-[8px] border border-ui-border px-3 text-sm outline-none focus:border-needle" /></label>
              <button disabled={busy || !newName.trim()} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-needle px-3 text-sm font-semibold text-white disabled:opacity-40"><Plus className="size-4" /> Create</button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
