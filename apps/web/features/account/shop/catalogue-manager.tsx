'use client'

import { ImagePlus, PackagePlus, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { createClient } from '../../../lib/supabase'
import { legacyItemMedia, MarketplaceMediaTile } from './marketplace-media-tile'
import type { ShopItem } from './shop-workspace'

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
type Props = { userId: string; profile: OwnerProfile; items: ShopItem[]; onRefresh: () => void }
type Draft = {
  id: string | null
  title: string
  category: string
  description: string
  price: string
  currency: string
  sizes: string
  inventory: string
  media: string[]
  pickup: boolean
  delivery: boolean
  shipping: boolean
  unit: 'in' | 'cm'
  chestMin: string
  chestMax: string
  waistMin: string
  waistMax: string
  fitNotes: string
  publish: boolean
}

const emptyDraft = (currency = 'USD'): Draft => ({
  id: null,
  title: '',
  category: '',
  description: '',
  price: '',
  currency,
  sizes: 'M',
  inventory: '1',
  media: [],
  pickup: false,
  delivery: false,
  shipping: true,
  unit: 'in',
  chestMin: '',
  chestMax: '',
  waistMin: '',
  waistMax: '',
  fitNotes: '',
  publish: false,
})
const split = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  ),
]
const amount = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null
}
const number = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
async function errorMessage(error: unknown) {
  try {
    const response = (error as { context?: Response }).context
    const payload = response
      ? ((await response.clone().json()) as { message?: string; error?: string })
      : null
    return payload?.message || payload?.error || null
  } catch {
    return null
  }
}
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke('seller-item-action', { body })
  if (error)
    throw new Error((await errorMessage(error)) || 'The catalogue action could not finish.')
  if ((data as { error?: string } | null)?.error)
    throw new Error(
      String((data as { message?: string }).message || (data as { error?: string }).error)
    )
  return data
}

export function CatalogueManager({ userId, profile, items, onRefresh }: Props) {
  const [draft, setDraft] = useState(() => emptyDraft(profile.currency || 'USD'))
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canPublish =
    profile.supports_ready_made === true &&
    profile.profile_completed === true &&
    profile.is_verified === true &&
    profile.payout_account_verified === true &&
    profile.payout_reverification_required !== true
  const publishReason =
    profile.supports_ready_made !== true
      ? 'Enable ready-made selling in Profile first.'
      : profile.profile_completed !== true
        ? 'Complete your tailor profile before publishing.'
        : profile.is_verified !== true
          ? 'Tailor approval is required before publishing.'
          : profile.payout_reverification_required === true
            ? 'Complete payout reverification before publishing.'
            : profile.payout_account_verified !== true
              ? 'Finish payout setup before publishing.'
              : null
  const sizes = useMemo(() => split(draft.sizes), [draft.sizes])

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  function edit(item: ShopItem) {
    if (item.is_live) {
      setNotice({
        tone: 'error',
        text: 'Hide this listing before editing so customers cannot order while details change.',
      })
      return
    }
    const guide = (item.size_guide ?? {}) as Record<string, unknown>
    const ranges = (guide.sizeRanges ?? {}) as Record<
      string,
      Record<string, { min?: number; max?: number }>
    >
    const firstSize = item.sizes?.[0] || 'M'
    setDraft({
      ...emptyDraft(item.currency || profile.currency || 'USD'),
      id: item.id,
      title: item.title || '',
      category: item.category || '',
      description: item.description || '',
      price: item.price_amount ? String(item.price_amount / 100) : '',
      sizes: (item.sizes || []).join(', ') || 'M',
      inventory: String(item.inventory_quantity ?? 1),
      media: item.photo_urls || [],
      pickup: item.pickup_available === true,
      delivery: item.delivery_available === true,
      shipping: item.shipping_available === true,
      unit: guide.unit === 'cm' ? 'cm' : 'in',
      chestMin: String(ranges[firstSize]?.chest?.min ?? ''),
      chestMax: String(ranges[firstSize]?.chest?.max ?? ''),
      waistMin: String(ranges[firstSize]?.waist?.min ?? ''),
      waistMax: String(ranges[firstSize]?.waist?.max ?? ''),
      fitNotes: String(guide.fitNotes ?? ''),
      publish: false,
    })
    setNotice(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function addMedia(file: File | null) {
    if (!file) return
    if (draft.media.length >= 8) {
      setNotice({ tone: 'error', text: 'Listings can contain up to 8 photos or videos.' })
      return
    }
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ]
    if (!allowed.includes(file.type) || file.size > 50 * 1024 * 1024) {
      setNotice({
        tone: 'error',
        text: 'Choose a JPG, PNG, WebP, MP4, MOV, or WebM file under 50 MB.',
      })
      return
    }
    setBusy('media')
    try {
      const ext =
        file.name.split('.').pop()?.toLowerCase() ||
        (file.type.startsWith('video/') ? 'mp4' : 'jpg')
      const path = `shop/${userId}/${crypto.randomUUID()}.${ext}`
      const { error } = await createClient()
        .storage.from('seller-item-media')
        .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false })
      if (error) throw error
      const { data } = createClient().storage.from('seller-item-media').getPublicUrl(path)
      update('media', [...draft.media, data.publicUrl])
      setNotice({ tone: 'success', text: 'Media added. It will lead the listing in this order.' })
    } catch {
      setNotice({ tone: 'error', text: 'That media could not upload. Try again.' })
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  async function save() {
    setNotice(null)
    const leak = filterContactInfo(
      [draft.title, draft.category, draft.description, draft.fitNotes].join('\n')
    )
    if (leak.blocked) {
      setNotice({
        tone: 'error',
        text: 'Listings cannot include phone numbers, emails, handles, or external links.',
      })
      return
    }
    const priceAmount = amount(draft.price)
    const inventory = Number.parseInt(draft.inventory, 10)
    if (
      !draft.title.trim() ||
      !draft.category.trim() ||
      draft.description.trim().length < 24 ||
      !priceAmount ||
      !sizes.length ||
      !Number.isInteger(inventory) ||
      inventory < 1
    ) {
      setNotice({
        tone: 'error',
        text: 'Add a title, category, price, at least one size, stock, and a fuller description.',
      })
      return
    }
    if (!draft.media.length) {
      setNotice({ tone: 'error', text: 'Add at least one clear photo or video.' })
      return
    }
    if (!draft.pickup && !draft.delivery && !draft.shipping) {
      setNotice({ tone: 'error', text: 'Choose at least one fulfillment method.' })
      return
    }
    if (draft.pickup && !profile.pickup_address?.trim()) {
      setNotice({
        tone: 'error',
        text: 'Add your private pickup address in Profile before enabling pickup.',
      })
      return
    }
    const chest = { min: number(draft.chestMin), max: number(draft.chestMax) }
    const waist = { min: number(draft.waistMin), max: number(draft.waistMax) }
    if (!chest.min && !chest.max && !waist.min && !waist.max) {
      setNotice({
        tone: 'error',
        text: 'Add at least one chest or waist fit range so customers can choose confidently.',
      })
      return
    }
    if (draft.publish && !canPublish) {
      setNotice({ tone: 'error', text: publishReason || 'Finish go-live checks first.' })
      return
    }
    const sizeRanges = Object.fromEntries(
      sizes.map((size) => [
        size,
        {
          ...(chest.min || chest.max ? { chest } : {}),
          ...(waist.min || waist.max ? { waist } : {}),
        },
      ])
    )
    const perSize = Math.max(1, Math.floor(inventory / sizes.length))
    setBusy('save')
    try {
      await invoke({
        action: draft.id ? 'update-item' : 'create-item',
        itemId: draft.id || undefined,
        title: draft.title.trim(),
        category: draft.category.trim(),
        description: draft.description.trim(),
        priceAmount,
        currency: draft.currency,
        sizes,
        sizeInventory: Object.fromEntries(sizes.map((size) => [size, perSize])),
        inventoryQuantity: inventory,
        photoUrls: draft.media,
        sizeGuide: {
          version: 1,
          unit: draft.unit,
          fields: ['chest', 'waist'],
          sizeRanges,
          fitNotes: draft.fitNotes.trim() || null,
          stretchNotes: null,
          sizeAdvice: 'ASK_SELLER',
        },
        pickupAvailable: draft.pickup,
        deliveryAvailable: draft.delivery,
        shippingAvailable: draft.shipping,
        isLive: draft.publish,
      })
      setDraft(emptyDraft(profile.currency || 'USD'))
      setNotice({ tone: 'success', text: draft.publish ? 'Listing published.' : 'Draft saved.' })
      onRefresh()
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Listing could not save.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function action(kind: 'publish-item' | 'hide-item' | 'delete-item', item: ShopItem) {
    if (kind === 'publish-item' && !canPublish) {
      setNotice({ tone: 'error', text: publishReason || 'Finish go-live checks first.' })
      return
    }
    if (kind === 'delete-item' && !window.confirm('Delete this hidden draft permanently?')) return
    setBusy(`${kind}:${item.id}`)
    try {
      await invoke({ action: kind, itemId: item.id })
      setNotice({
        tone: 'success',
        text:
          kind === 'publish-item'
            ? 'Listing published.'
            : kind === 'hide-item'
              ? 'Listing hidden.'
              : 'Draft deleted.',
      })
      onRefresh()
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Action could not finish.',
      })
    } finally {
      setBusy(null)
    }
  }

  const input =
    'h-10 w-full rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15'
  return (
    <div className="grid gap-5 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)] lg:items-start">
      <section className="app-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
              Catalogue
            </p>
            <h1 className="mt-2 text-3xl text-ink">{draft.id ? 'Edit listing' : 'Add a piece'}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink/62">
              Photos or video lead the listing. Fit, stock, and fulfillment stay explicit.
            </p>
          </div>
          <PackagePlus className="size-5 text-needle" />
        </div>
        {notice ? (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-[8px] border p-3 text-sm ${notice.tone === 'error' ? 'border-rust/25 bg-rust/8 text-rust' : 'border-needle/20 bg-needle/8 text-needle'}`}
          >
            {notice.text}
          </p>
        ) : null}
        {publishReason ? (
          <p className="mt-4 rounded-[8px] border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Drafts are available.</strong> {publishReason}
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold">
            Title
            <input
              className={input}
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Category
            <input
              className={input}
              value={draft.category}
              onChange={(e) => update('category', e.target.value)}
              placeholder="Jackets, dresses, trousers…"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold sm:col-span-2">
            Description
            <textarea
              className={`${input} min-h-24 py-2`}
              value={draft.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Price
            <div className="flex">
              <span className="grid h-10 place-items-center rounded-l-[8px] border border-r-0 border-ui-border bg-needle/5 px-3 text-xs">
                {draft.currency}
              </span>
              <input
                className={`${input} rounded-l-none`}
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => update('price', e.target.value)}
              />
            </div>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Total stock
            <input
              className={input}
              type="number"
              min="1"
              value={draft.inventory}
              onChange={(e) => update('inventory', e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold sm:col-span-2">
            Sizes <span className="font-normal text-ink/50">comma separated</span>
            <input
              className={input}
              value={draft.sizes}
              onChange={(e) => update('sizes', e.target.value)}
            />
          </label>
        </div>
        <fieldset className="mt-5 border-t border-ui-border pt-4">
          <legend className="text-sm font-semibold">
            Fit guide <span className="font-normal text-ink/50">applied to each listed size</span>
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs">
              Chest min
              <input
                className={`${input} mt-1`}
                inputMode="decimal"
                value={draft.chestMin}
                onChange={(e) => update('chestMin', e.target.value)}
              />
            </label>
            <label className="text-xs">
              Chest max
              <input
                className={`${input} mt-1`}
                inputMode="decimal"
                value={draft.chestMax}
                onChange={(e) => update('chestMax', e.target.value)}
              />
            </label>
            <label className="text-xs">
              Waist min
              <input
                className={`${input} mt-1`}
                inputMode="decimal"
                value={draft.waistMin}
                onChange={(e) => update('waistMin', e.target.value)}
              />
            </label>
            <label className="text-xs">
              Waist max
              <input
                className={`${input} mt-1`}
                inputMode="decimal"
                value={draft.waistMax}
                onChange={(e) => update('waistMax', e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            {(['in', 'cm'] as const).map((unit) => (
              <button
                type="button"
                key={unit}
                aria-pressed={draft.unit === unit}
                onClick={() => update('unit', unit)}
                className={`h-8 rounded-[8px] border px-3 text-xs font-semibold ${draft.unit === unit ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white'}`}
              >
                {unit}
              </button>
            ))}
          </div>
          <label className="mt-3 grid gap-1.5 text-sm font-semibold">
            Fit notes
            <textarea
              className={`${input} min-h-20 py-2`}
              value={draft.fitNotes}
              onChange={(e) => update('fitNotes', e.target.value)}
            />
          </label>
        </fieldset>
        <fieldset className="mt-5 border-t border-ui-border pt-4">
          <legend className="text-sm font-semibold">Fulfillment</legend>
          <div className="mt-3 flex flex-wrap gap-3">
            {(
              [
                ['pickup', 'Pickup'],
                ['delivery', 'Local delivery'],
                ['shipping', 'Shipping'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => update(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 border-t border-ui-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold hover:border-needle/40">
              <ImagePlus className="size-4" />
              {busy === 'media' ? 'Uploading…' : 'Add media'}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                className="sr-only"
                onChange={(e) => void addMedia(e.target.files?.[0] || null)}
              />
            </label>
            <span className="text-xs text-ink/50">{draft.media.length}/8</span>
          </div>
          {draft.media.length ? (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {draft.media.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  onClick={() =>
                    update(
                      'media',
                      draft.media.filter((_, i) => i !== index)
                    )
                  }
                  title="Remove media"
                  className="relative aspect-square overflow-hidden rounded-[8px] border border-ui-border"
                >
                  <MarketplaceMediaTile
                    media={legacyItemMedia([url], draft.title || 'Listing media')[0] || null}
                    title={draft.title || 'Listing media'}
                  />
                  <span className="absolute right-1 top-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] text-white">
                    Remove
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ui-border pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={draft.publish}
              onChange={(e) => update('publish', e.target.checked)}
            />
            Publish after checks
          </label>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void save()}
            className="h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:opacity-45"
          >
            {busy === 'save' ? 'Saving…' : draft.id ? 'Save changes' : 'Save listing'}
          </button>
          {draft.id ? (
            <button
              type="button"
              onClick={() => setDraft(emptyDraft(profile.currency || 'USD'))}
              className="h-10 rounded-[8px] border border-ui-border px-4 text-sm font-semibold"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </section>
      <section className="grid gap-3" aria-label="Your listings">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Your shop</p>
          <h2 className="mt-1 text-2xl text-ink">
            {items.length} listing{items.length === 1 ? '' : 's'}
          </h2>
        </div>
        {items.length === 0 ? (
          <div className="app-surface p-5 text-sm text-ink/60">
            Your drafts and published pieces will appear here.
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="app-surface grid grid-cols-[5.5rem_1fr] gap-3 p-3">
              <div className="aspect-[4/5] overflow-hidden rounded-[8px] bg-needle/8">
                <MarketplaceMediaTile
                  media={legacyItemMedia(item.photo_urls, item.title || 'Listing')[0] || null}
                  title={item.title || 'Listing'}
                />
              </div>
              <div className="min-w-0">
                <div className="flex justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold">
                    {item.title || 'Untitled listing'}
                  </h3>
                  <span className="text-[10px] font-semibold uppercase text-ink/45">
                    {item.is_live ? 'Live' : 'Draft'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink/55">{item.inventory_quantity ?? 0} in stock</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    title="Edit listing"
                    onClick={() => edit(item)}
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-ui-border px-2 text-xs font-semibold"
                  >
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => void action(item.is_live ? 'hide-item' : 'publish-item', item)}
                    className="h-8 rounded-[8px] border border-ui-border px-2 text-xs font-semibold"
                  >
                    {item.is_live ? 'Hide' : 'Publish'}
                  </button>
                  {!item.is_live ? (
                    <button
                      title="Delete draft"
                      disabled={busy !== null}
                      onClick={() => void action('delete-item', item)}
                      className="grid size-8 place-items-center rounded-[8px] border border-rust/20 text-rust"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
