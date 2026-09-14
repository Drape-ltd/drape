'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Check, ChevronDown, Crosshair, Plus, RotateCcw, Star, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { TAILOR_LANGUAGE_GROUPS, TAILOR_SPECIALTY_GROUPS } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { invalidateAccountData, readAccountData } from '../../../lib/account-data-cache'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'
import { StructuredAddressSearch } from '../../../components/structured-address-search'

type Profile = {
  id: string
  display_name: string | null
  business_name: string | null
  bio: string | null
  location: string | null
  languages: string[] | null
  specialty_tags: string[] | null
  currency: string | null
  availability: string | null
  is_live: boolean | null
  is_verified: boolean | null
  profile_completed: boolean | null
  id_verification_status: string | null
  payout_account_verified: boolean | null
  portfolio_video_urls: string[] | null
  avatar_url: string | null
  price_range_min: number | null
  price_range_max: number | null
  seller_type: string | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  accepts_custom_orders_now: boolean | null
  shop_paused: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  delivery_fee: number | null
  shipping_fee: number | null
  consultation_mode: string | null
  consultation_requirement: string | null
  consultation_fee_amount: number | null
  consultation_duration_minutes: number | null
  consultation_call_type: string | null
  consultation_fee_creditable: boolean | null
  avg_rating: number | null
  total_reviews: number | null
  total_orders: number | null
}
type Item = {
  id: string
  image_url: string | null
  title: string | null
  description: string | null
  category: string | null
  sort_order: number | null
}
type Media = {
  id: string
  portfolioItemId?: string | null
  title?: string | null
  kind: 'IMAGE' | 'VIDEO'
  url: string
  posterUrl: string | null
  focalX: number
  focalY: number
  altText: string | null
  isPrimary: boolean
  moderationStatus?: string | null
}
type Review = {
  id: string
  rating: number
  body: string | null
  tags: string[] | null
  reviewer_name: string | null
  created_at: string | null
}
type OptionGroup = { label: string; items: readonly string[] }
const LANGUAGE_GROUPS: readonly OptionGroup[] = TAILOR_LANGUAGE_GROUPS
const SPECIALTY_GROUPS: readonly OptionGroup[] = TAILOR_SPECIALTY_GROUPS
const field =
  'h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15'
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(fn, { body })
  if (error) throw new Error('That change could not be saved.')
  return (data || {}) as T
}

function StructuredPicker({
  label,
  values,
  groups,
  limit,
  onChange,
}: {
  label: string
  values: string[]
  groups: readonly OptionGroup[]
  limit: number
  onChange: (values: string[]) => void
}) {
  return (
    <details className="group relative min-w-0">
      <summary
        className={`${field} flex cursor-pointer list-none items-center justify-between gap-3`}
      >
        <span className="truncate">
          {values.length
            ? `${values.length} selected · ${values.slice(0, 2).join(', ')}`
            : `Choose ${label.toLowerCase()}`}
        </span>
        <ChevronDown
          className="size-4 shrink-0 transition group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="absolute z-40 mt-2 max-h-80 w-full min-w-[18rem] overflow-y-auto rounded-[8px] border border-ui-border bg-white p-2 shadow-xl">
        {groups.map((group) => (
          <fieldset key={group.label} className="border-b border-ui-border py-2 last:border-0">
            <legend className="px-2 text-[0.68rem] font-semibold uppercase tracking-[.12em] text-ink/45">
              {group.label}
            </legend>
            <div className="mt-1 grid gap-0.5">
              {group.items.map((option) => {
                const active = values.includes(option)
                const disabled = !active && values.length >= limit
                return (
                  <label
                    key={option}
                    className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-sm hover:bg-ui-muted ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={active}
                      disabled={disabled}
                      onChange={() =>
                        onChange(
                          active ? values.filter((value) => value !== option) : [...values, option]
                        )
                      }
                    />
                    <span
                      className={`grid size-5 place-items-center rounded-[5px] border ${active ? 'border-needle bg-needle text-white' : 'border-ui-border'}`}
                    >
                      {active ? <Check className="size-3" /> : null}
                    </span>
                    {option}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </details>
  )
}
async function upload(userId: string, file: File) {
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024)
    throw new Error('Choose an image under 12 MB.')
  const ext =
    file.name
      .split('.')
      .pop()
      ?.replace(/[^a-z0-9]/gi, '') || 'jpg'
  const path = `portfolio/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
  const client = createClient()
  const { error } = await client.storage
    .from('portfolio-photos')
    .upload(path, file, { cacheControl: '31536000' })
  if (error) throw new Error('The image could not upload.')
  return client.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl
}

async function loadProfileWorkspace(userId: string) {
  const client = createClient()
  const result = await client
    .from('tailor_profiles')
    .select(
      'id,display_name,business_name,bio,location,languages,specialty_tags,currency,availability,is_live,is_verified,profile_completed,id_verification_status,payout_account_verified,portfolio_video_urls,avatar_url,price_range_min,price_range_max,seller_type,supports_custom_orders,supports_ready_made,accepts_custom_orders_now,shop_paused,pickup_available,delivery_available,shipping_available,delivery_fee,shipping_fee,consultation_mode,consultation_requirement,consultation_fee_amount,consultation_duration_minutes,consultation_call_type,consultation_fee_creditable,avg_rating,total_reviews,total_orders'
    )
    .eq('user_id', userId)
    .maybeSingle()
  if (result.error) throw new Error('Storefront unavailable.')
  const profile = result.data as Profile | null
  if (!profile)
    return { profile, items: [] as Item[], media: [] as Media[], reviews: [] as Review[] }
  const [portfolio, presentation, reviews] = await Promise.all([
    client
      .from('portfolio_items')
      .select('id,image_url,title,description,category,sort_order')
      .eq('tailor_profile_id', profile.id)
      .order('sort_order'),
    invoke<{ media?: Media[] }>('tailor-profile-action', {
      action: 'get-media-presentation',
    }).catch(() => ({ media: [] })),
    client
      .from('reviews')
      .select('id,rating,body,tags,reviewer_name,created_at')
      .eq('tailor_profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(40),
  ])
  if (portfolio.error) throw new Error('Portfolio unavailable.')
  return {
    profile,
    items: (portfolio.data || []) as Item[],
    media: presentation.media || [],
    reviews: (reviews.data || []) as Review[],
  }
}

function Content({ userId, identity }: { userId: string; identity: AccountRouteIdentity }) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [media, setMedia] = useState<Media[]>([]),
    [reviews, setReviews] = useState<Review[]>([]),
    [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [portfolioEditorOpen, setPortfolioEditorOpen] = useState(false),
    [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)
  const [form, setForm] = useState({
      displayName: '',
      bio: '',
      location: '',
      languages: [] as string[],
      specialties: [] as string[],
      currency: 'USD',
      availability: 'OPEN',
    }),
    [piece, setPiece] = useState({
      title: '',
      category: '',
      description: '',
      file: null as File | null,
    })
  useEffect(() => {
    let active = true
    if (identity.role !== 'TAILOR') {
      queueMicrotask(() => {
        if (active) setState('ready')
      })
      return
    }
    void readAccountData(`profile:${userId}`, () => loadProfileWorkspace(userId))
      .then(({ profile: next, items: nextItems, media: nextMedia, reviews: nextReviews }) => {
        if (!active) return
        setProfile(next)
        setItems(nextItems)
        setMedia(nextMedia)
        setReviews(nextReviews)
        setState('ready')
        if (next) {
          setForm({
            displayName: next.business_name || next.display_name || '',
            bio: next.bio || '',
            location: next.location || '',
            languages: next.languages || [],
            specialties: next.specialty_tags || [],
            currency: next.currency || 'USD',
            availability: next.availability || 'OPEN',
          })
        }
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => {
      active = false
    }
  }, [identity.role, revision, userId])
  useEffect(() => {
    if (!profile?.id) return
    const client = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        invalidateAccountData(`profile:${userId}`)
        setRevision((value) => value + 1)
      }, 180)
    }
    const channel = client
      .channel(`web-profile:${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tailor_profiles', filter: `id=eq.${profile.id}` },
        refresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'portfolio_items',
          filter: `tailor_profile_id=eq.${profile.id}`,
        },
        refresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'media_assets',
          filter: `tailor_profile_id=eq.${profile.id}`,
        },
        refresh
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [profile?.id, userId])
  if (state === 'loading')
    return (
      <div className="app-surface p-6" aria-busy>
        Loading storefront…
      </div>
    )
  if (state === 'error')
    return (
      <div className="app-surface p-6" role="alert">
        Storefront unavailable.{' '}
        <button
          className="font-semibold text-needle"
          onClick={() => {
            invalidateAccountData(`profile:${userId}`)
            setRevision((v) => v + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  if (!profile)
    return (
      <div className="app-surface p-6">
        <h2 className="text-xl font-semibold">Tailor profile required</h2>
        <p className="mt-2 text-sm text-ink/60">
          Customer accounts manage personal details in Settings.
        </p>
        <Link href="/account/profile?setup=1" className="mt-4 inline-flex font-semibold text-needle">
          Set up a tailor profile
        </Link>
      </div>
    )
  const currentProfile = profile
  const refreshProfile = () => {
    invalidateAccountData(`profile:${userId}`)
    setRevision((value) => value + 1)
  }
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  async function saveProfile() {
    setBusy(true)
    setNotice('')
    try {
      await invoke('tailor-profile-action', {
        action: 'update-profile',
        profile: {
          displayName: form.displayName,
          bio: form.bio || null,
          location: form.location,
          languages: form.languages,
          specialties: form.specialties,
          currency: form.currency,
          availability: form.availability,
          priceRangeMin: currentProfile.price_range_min,
          priceRangeMax: currentProfile.price_range_max,
          sellerType: currentProfile.seller_type || 'TAILOR',
          supportsCustomOrders: currentProfile.supports_custom_orders !== false,
          supportsReadyMade: currentProfile.supports_ready_made === true,
          acceptsCustomOrdersNow: currentProfile.accepts_custom_orders_now !== false,
          shopPaused: currentProfile.shop_paused === true,
          pickupAvailable: currentProfile.pickup_available === true,
          deliveryAvailable: currentProfile.delivery_available === true,
          shippingAvailable: currentProfile.shipping_available === true,
          deliveryFee: currentProfile.delivery_fee || 0,
          shippingFee: currentProfile.shipping_fee || 0,
          consultationMode: currentProfile.consultation_mode || 'FREE',
          consultationRequirement: currentProfile.consultation_requirement || 'OPTIONAL',
          consultationFeeAmount: currentProfile.consultation_fee_amount,
          consultationDurationMinutes: currentProfile.consultation_duration_minutes || 30,
          consultationCallType: currentProfile.consultation_call_type || 'VIDEO',
          consultationFeeCreditable: currentProfile.consultation_fee_creditable === true,
        },
      })
      setNotice('Public profile saved.')
      refreshProfile()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  async function addPiece() {
    if (!piece.title.trim() || !piece.file) {
      setNotice('Add a title and image.')
      return
    }
    setBusy(true)
    try {
      const imageUrl = await upload(userId, piece.file)
      await invoke('portfolio-item-action', {
        action: 'create-item',
        item: {
          imageUrl,
          title: piece.title,
          category: piece.category || null,
          description: piece.description || null,
        },
      })
      setPiece({ title: '', category: '', description: '', file: null })
      setNotice('Portfolio item added.')
      setPortfolioEditorOpen(false)
      refreshProfile()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  async function setCover(item: Item) {
    const previous = items
    setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)])
    setBusy(true)
    setNotice('')
    try {
      await invoke('portfolio-item-action', { action: 'set-cover', itemId: item.id })
      setNotice(
        `${item.title || 'Portfolio piece'} is now your cover. The gallery order has been updated.`
      )
      refreshProfile()
    } catch (error) {
      setItems(previous)
      setNotice(error instanceof Error ? error.message : 'The cover could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  const activeSelectedMediaId = media.some((asset) => asset.id === selectedMediaId)
    ? selectedMediaId
    : media.find((asset) => asset.isPrimary)?.id ?? media[0]?.id ?? null
  const selectedMedia = media.find((asset) => asset.id === activeSelectedMediaId) ?? null
  const portfolioItemFor = (asset: Media) =>
    items.find((item) => item.id === asset.portfolioItemId || item.image_url === asset.url) ?? null
  const selectedPortfolioItem = selectedMedia ? portfolioItemFor(selectedMedia) : null
  return (
    <div className="grid gap-5 pb-10">
      <section className="app-surface p-5">
        <div className="flex flex-wrap items-center gap-4">
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt=""
              width={64}
              height={64}
              className="size-16 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div className="grid size-16 place-items-center rounded-full bg-needle/10 text-xl font-bold text-needle">
              {form.displayName[0] || 'D'}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-needle">
              Storefront
            </p>
            <h2 className="text-2xl font-semibold">{form.displayName || 'Your profile'}</h2>
            <p className="text-sm text-ink/55">
              {profile.is_live ? 'Live' : 'Not live'} ·{' '}
              {profile.is_verified
                ? 'Trust approved'
                : `Trust ${profile.id_verification_status?.toLowerCase() || 'not submitted'}`}{' '}
              · {profile.payout_account_verified ? 'Payout ready' : 'Payout setup needed'}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link
              href="#reviews"
              className="inline-flex items-center gap-1.5 rounded-full border border-ui-border bg-white px-3 py-1.5 text-xs font-semibold text-ink"
            >
              <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
              {profile.total_reviews
                ? `${Number(profile.avg_rating || 0).toFixed(1)} · ${profile.total_reviews} ${profile.total_reviews === 1 ? 'review' : 'reviews'}`
                : 'No reviews yet'}
            </Link>
            <Link
              href="/account/orders?filter=completed"
              className="rounded-full border border-ui-border bg-white px-3 py-1.5 text-xs font-semibold text-ink/65"
            >
              {profile.total_orders || 0} orders
            </Link>
          </div>
        </div>
      </section>
      {notice ? (
        <p role="status" className="rounded-[8px] border border-needle/20 bg-needle/5 p-3 text-sm">
          {notice}
        </p>
      ) : null}
      <section id="reviews" className="app-surface scroll-mt-6 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-needle">
              Customer feedback
            </p>
            <h2 className="mt-1 text-xl font-semibold">Reviews</h2>
          </div>
          <p className="text-sm font-semibold text-ink/60">
            {profile.total_reviews
              ? `${Number(profile.avg_rating || 0).toFixed(1)} / 5 · ${profile.total_reviews} ${profile.total_reviews === 1 ? 'review' : 'reviews'}`
              : 'No reviews yet'}
          </p>
        </div>
        {reviews.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {reviews.map((review) => (
              <article
                key={review.id}
                className="rounded-[8px] border border-ui-border bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p
                    className="text-sm font-semibold text-amber-500"
                    aria-label={`${review.rating} out of 5 stars`}
                  >
                    {'★'.repeat(review.rating)}
                    <span className="text-ink/12">{'★'.repeat(5 - review.rating)}</span>
                  </p>
                  <p className="text-xs text-ink/42">{review.reviewer_name || 'Customer'}</p>
                </div>
                {review.body ? (
                  <p className="mt-3 text-sm leading-6 text-ink/65">{review.body}</p>
                ) : null}
                {review.tags?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {review.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-needle/8 px-2.5 py-1 text-[11px] font-semibold text-needle"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-[8px] border border-dashed border-ui-border bg-ui-muted/30 p-4 text-sm text-ink/55">
            Completed-order reviews will appear here automatically.
          </p>
        )}
      </section>
      <section className="app-surface p-5">
        <h2 className="text-xl font-semibold">Public profile</h2>
        <p className="mt-1 text-sm text-ink/55">
          Keep the details customers use to assess fit and availability accurate.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            aria-label="Public name"
            className={field}
            value={form.displayName}
            onChange={(e) => update('displayName', e.target.value)}
            placeholder="Public name"
          />
          <StructuredAddressSearch
            label="City or base location"
            value={form.location}
            placeholder="Search city or area"
            allowManualFallback={false}
            className=""
            onSelect={(address) =>
              update('location', [address.city, address.stateRegion, address.country].filter(Boolean).join(', '))
            }
          />
          <div>
            <p className="mb-1.5 text-sm font-semibold">Languages</p>
            <StructuredPicker
              label="Languages"
              values={form.languages}
              groups={LANGUAGE_GROUPS}
              limit={12}
              onChange={(languages) => setForm((value) => ({ ...value, languages }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Specialties</p>
            <StructuredPicker
              label="Specialties"
              values={form.specialties}
              groups={SPECIALTY_GROUPS}
              limit={20}
              onChange={(specialties) => setForm((value) => ({ ...value, specialties }))}
            />
          </div>
          <textarea
            aria-label="Bio"
            className={`${field} min-h-28 py-3 sm:col-span-2`}
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="Describe your work"
          />
          <select
            aria-label="Availability"
            className={field}
            value={form.availability}
            onChange={(e) => update('availability', e.target.value)}
          >
            <option value="OPEN">Open</option>
            <option value="LIMITED">Limited</option>
            <option value="FULLY_BOOKED">Fully booked</option>
          </select>
          <div className={`${field} flex items-center justify-between gap-3`}>
            <span aria-label="Currency">Prices shown in {form.currency}</span>
            <Link href="/account/settings" className="font-semibold text-needle">
              Change currency
            </Link>
          </div>
        </div>
        <button
          disabled={busy}
          onClick={() => void saveProfile()}
          className="mt-4 h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save profile
        </button>
      </section>
      <section className="app-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Portfolio</h2>
            <p className="mt-1 text-sm text-ink/55">
              Complete work, presented as customers will browse it.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink/45">
              {items.length} pieces · {(profile.portfolio_video_urls || []).length} videos
            </span>
            <button
              type="button"
              onClick={() => setPortfolioEditorOpen((value) => !value)}
              aria-expanded={portfolioEditorOpen}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-ui-border bg-white px-3 text-xs font-semibold text-ink hover:border-needle/35"
            >
              {portfolioEditorOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
              {portfolioEditorOpen ? 'Close' : 'Add piece'}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => {
            const presentation = media.find(
              (asset) => asset.portfolioItemId === item.id || asset.url === item.image_url
            )
            return (
              <article
                key={item.id}
                className="overflow-hidden rounded-[8px] border border-ui-border bg-white"
              >
                {item.image_url ? (
                  <div className="relative aspect-[4/5] w-full overflow-hidden bg-ui-muted">
                    <Image
                      src={item.image_url}
                      alt={presentation?.altText || item.title || 'Portfolio work'}
                      fill
                      sizes="(min-width:1280px) 20vw, (min-width:640px) 40vw, 100vw"
                      className="object-cover"
                      style={{
                        objectPosition: `${(presentation?.focalX ?? 0.5) * 100}% ${(presentation?.focalY ?? 0.5) * 100}%`,
                      }}
                      unoptimized
                    />
                  </div>
                ) : null}
              <div className="p-3">
                <p className="font-semibold">{item.title || 'Untitled work'}</p>
                <p className="text-xs text-ink/50">
                  {index === 0 ? 'Cover · ' : ''}
                  {item.category || 'Portfolio'}
                </p>
                <div className="mt-3 flex gap-3 text-xs font-semibold">
                  <button
                    disabled={busy || index === 0}
                    onClick={() => void setCover(item)}
                    className="inline-flex items-center gap-1 text-needle disabled:opacity-40"
                  >
                    <Star className="size-3" /> {index === 0 ? 'Current cover' : 'Make cover'}
                  </button>
                  <button
                    onClick={() =>
                      void invoke('portfolio-item-action', {
                        action: 'delete-item',
                        itemId: item.id,
                      }).then(() => refreshProfile())
                    }
                    className="text-rust"
                  >
                    Remove
                  </button>
                </div>
              </div>
              </article>
            )
          })}
        </div>
        {portfolioEditorOpen ? (
          <div className="mt-5 grid gap-3 border-t border-ui-border pt-5 sm:grid-cols-2">
            <input
              className={field}
              value={piece.title}
              onChange={(e) => setPiece((v) => ({ ...v, title: e.target.value }))}
              placeholder="Piece title"
            />
            <input
              className={field}
              value={piece.category}
              onChange={(e) => setPiece((v) => ({ ...v, category: e.target.value }))}
              placeholder="Category"
            />
            <input
              aria-label="Portfolio image"
              type="file"
              accept="image/*"
              onChange={(e) => setPiece((v) => ({ ...v, file: e.target.files?.[0] || null }))}
              className="text-sm sm:col-span-2"
            />
            <textarea
              className={`${field} min-h-20 py-3 sm:col-span-2`}
              value={piece.description}
              onChange={(e) => setPiece((v) => ({ ...v, description: e.target.value }))}
              placeholder="Short description"
            />
            <div className="flex gap-2 sm:col-span-2">
              <button
                disabled={busy}
                onClick={() => void addPiece()}
                className="h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Adding…' : 'Add portfolio item'}
              </button>
              <button
                type="button"
                onClick={() => setPortfolioEditorOpen(false)}
                className="h-10 rounded-[8px] border border-ui-border bg-white px-4 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="app-surface p-5">
        <h2 className="text-xl font-semibold">Portfolio presentation</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/55">
          Pick the best crop, choose the profile cover, and give each piece a clear description so
          customers can understand the work at a glance.
        </p>
        {media.length ? (
          <div className="mt-4 max-w-2xl">
            <div className="flex gap-2 overflow-x-auto pb-2" role="listbox" aria-label="Choose a portfolio asset to adjust">
              {media.map((asset, index) => {
                const selected = asset.id === activeSelectedMediaId
                const portfolioItem = portfolioItemFor(asset)
                const assetName =
                  asset.title?.trim() || portfolioItem?.title?.trim() || asset.altText?.trim() || `Portfolio ${asset.kind === 'VIDEO' ? 'video' : 'image'} ${index + 1}`
                return (
                  <button
                    key={asset.id}
                    type="button"
                    role="option"
                    onClick={() => setSelectedMediaId(asset.id)}
                    className={`relative shrink-0 overflow-hidden rounded-[8px] border-2 bg-ui-muted transition ${selected ? 'border-needle ring-2 ring-needle/15' : 'border-transparent hover:border-ui-border'}`}
                    style={{ width: 72, height: 90 }}
                    aria-label={`Edit ${assetName}${asset.isPrimary ? ', current cover' : ''}`}
                    title={assetName}
                    aria-selected={selected}
                  >
                    {asset.kind === 'VIDEO' ? (
                      <video
                        src={asset.url}
                        poster={asset.posterUrl || undefined}
                        muted
                        playsInline
                        className="size-full object-cover"
                        style={{ objectPosition: `${asset.focalX * 100}% ${asset.focalY * 100}%` }}
                      />
                    ) : (
                      <Image
                        src={asset.url}
                        alt={asset.altText || `Portfolio asset ${index + 1}`}
                        fill
                        sizes="3rem"
                        className="object-cover"
                        style={{ objectPosition: `${asset.focalX * 100}% ${asset.focalY * 100}%` }}
                        unoptimized
                      />
                    )}
                    {asset.isPrimary ? (
                      <span className="absolute bottom-1 left-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-needle shadow-sm">
                      Cover
                      </span>
                    ) : null}
                    {!['APPROVED', 'AUTO_ALLOWED'].includes(asset.moderationStatus || '') ? (
                      <span className="absolute right-1 top-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 shadow-sm">
                        Review
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {selectedMedia ? (
              <div className="mt-2 rounded-[8px] border border-ui-border bg-ui-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {selectedMedia.title?.trim() ||
                        selectedPortfolioItem?.title?.trim() ||
                        selectedMedia.altText?.trim() ||
                        `Portfolio ${selectedMedia.kind === 'VIDEO' ? 'video' : 'image'} ${media.findIndex((asset) => asset.id === activeSelectedMediaId) + 1}`}
                    </p>
                    <p className="text-xs text-ink/50">
                      {!['APPROVED', 'AUTO_ALLOWED'].includes(selectedMedia.moderationStatus || '')
                        ? 'Awaiting safety review · not public yet'
                        : selectedMedia.isPrimary
                          ? 'Live profile cover'
                          : `Live · ${media.findIndex((asset) => asset.id === activeSelectedMediaId) + 1} of ${media.length}`}
                    </p>
                  </div>
                  <span className="rounded-full border border-ui-border bg-white px-2.5 py-1 text-[10px] font-semibold text-ink/55">
                    4:5 preview
                  </span>
                </div>
                <MediaEditor
                  key={activeSelectedMediaId}
                  asset={selectedMedia}
                  onSaved={refreshProfile}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 rounded-[8px] border border-dashed border-ui-border bg-ui-muted/35 p-4">
            <p className="text-sm font-semibold">
              Presentation controls appear after media processing.
            </p>
            <p className="mt-1 text-sm leading-6 text-ink/55">
              Add a portfolio image above. Once its stable media record is ready, you can set the
              crop focus and accessible description here.
            </p>
          </div>
        )}
      </section>
      <section className="app-surface p-5">
        <h2 className="text-xl font-semibold">Trust and payouts</h2>
        <p className="mt-2 text-sm text-ink/58">
          Marketplace visibility and payout readiness are separate gates. Drapeon uses a private
          challenge video, not government ID collection.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/account/payout"
            className="rounded-[8px] border border-ui-border px-4 py-2 text-sm font-semibold"
          >
            Review payout setup
          </Link>
          <Link
            href={`/account/tailors/${profile.id}?preview=1`}
            className="rounded-[8px] border border-ui-border px-4 py-2 text-sm font-semibold"
          >
            Preview live profile
          </Link>
        </div>
      </section>
    </div>
  )
}
function MediaEditor({ asset, onSaved }: { asset: Media; onSaved: () => void }) {
  const [x, setX] = useState(asset.focalX),
    [y, setY] = useState(asset.focalY),
    [alt, setAlt] = useState(asset.altText || ''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  function moveFocus(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    setX(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
    setY(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)))
  }
  async function save() {
    setBusy(true)
    setNotice('')
    try {
      await invoke('tailor-profile-action', {
        action: 'update-media-presentation',
        mediaAssetId: asset.id,
        focalX: x,
        focalY: y,
        altText: alt || null,
        isPrimary: asset.isPrimary,
      })
      setNotice('Presentation saved across Explore and your public profile.')
      onSaved()
    } catch {
      setNotice('Presentation could not save. Your previous settings remain active.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid max-w-xl gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div>
        <button
          type="button"
          className="relative max-w-full touch-none cursor-crosshair overflow-hidden rounded-[8px] border border-ui-border bg-ui-muted"
          style={{ width: 176, height: 220 }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            moveFocus(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveFocus(event)
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.025
            if (event.key === 'ArrowLeft') setX((value) => Math.max(0, value - step))
            else if (event.key === 'ArrowRight') setX((value) => Math.min(1, value + step))
            else if (event.key === 'ArrowUp') setY((value) => Math.max(0, value - step))
            else if (event.key === 'ArrowDown') setY((value) => Math.min(1, value + step))
            else return
            event.preventDefault()
          }}
          aria-label="Choose the image focal point. Click or drag to keep that point centered."
        >
          {asset.kind === 'VIDEO' ? (
            <video
              src={asset.url}
              poster={asset.posterUrl || undefined}
              className="size-full object-cover"
              style={{ objectPosition: `${x * 100}% ${y * 100}%` }}
              muted
              playsInline
            />
          ) : (
            <Image
              src={asset.url}
              alt={alt || 'Portfolio asset'}
              fill
              sizes="176px"
              className="object-cover"
              style={{ objectPosition: `${x * 100}% ${y * 100}%` }}
              unoptimized
            />
          )}
          <span
            className="pointer-events-none absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/90 bg-ink/55 text-white shadow-sm"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
          >
            <Crosshair className="size-4" aria-hidden="true" />
          </span>
        </button>
        <p className="mt-2 max-w-44 text-[11px] leading-4 text-ink/50">
          Click or drag to keep the important detail in frame.
        </p>
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold">Focal point</p>
            <button
              type="button"
              onClick={() => {
                setX(0.5)
                setY(0.5)
              }}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-needle"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Centre
            </button>
          </div>
          <p className="mt-1 text-xs leading-5 text-ink/50">
            The preview is the same 4:5 crop customers see in Explore.
          </p>
        </div>
        <label className="grid gap-1.5 text-xs font-semibold">
          Accessible description
          <textarea
            className={`${field} min-h-20 resize-y py-2 leading-5`}
            value={alt}
            maxLength={240}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Describe the garment, fabric, and visible details"
          />
          <span className="text-[11px] font-normal text-ink/45">{alt.length}/240</span>
        </label>
        {notice ? (
          <p role="status" className="text-xs text-ink/60">
            {notice}
          </p>
        ) : null}
        <button
          disabled={busy}
          onClick={() => void save()}
          className="h-9 w-fit rounded-full bg-drape-green px-4 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save presentation'}
        </button>
      </div>
    </div>
  )
}
export function ProfileWorkspace() {
  const searchParams = useSearchParams()

  if (searchParams.get('setup') === '1') {
    return <AccountAppSurface surface="profile" embedded />
  }

  return (
    <AccountRouteRuntime surface="profile">
      {({ session, identity }) => <Content userId={session.user.id} identity={identity} />}
    </AccountRouteRuntime>
  )
}
