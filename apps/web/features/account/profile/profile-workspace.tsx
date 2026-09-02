'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'

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
  kind: 'IMAGE' | 'VIDEO'
  url: string
  posterUrl: string | null
  focalX: number
  focalY: number
  altText: string | null
  isPrimary: boolean
}
const field =
  'h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15'
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(fn, { body })
  if (error) throw new Error('That change could not be saved.')
  return (data || {}) as T
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

function Content({ userId, identity }: { userId: string; identity: AccountRouteIdentity }) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [media, setMedia] = useState<Media[]>([]),
    [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const [form, setForm] = useState({
      displayName: '',
      bio: '',
      location: '',
      languages: '',
      specialties: '',
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
    const c = createClient()
    c.from('tailor_profiles')
      .select(
        'id,display_name,business_name,bio,location,languages,specialty_tags,currency,availability,is_live,is_verified,profile_completed,id_verification_status,payout_account_verified,portfolio_video_urls,avatar_url,price_range_min,price_range_max,seller_type,supports_custom_orders,supports_ready_made,accepts_custom_orders_now,shop_paused,pickup_available,delivery_available,shipping_available,delivery_fee,shipping_fee,consultation_mode,consultation_requirement,consultation_fee_amount,consultation_duration_minutes,consultation_call_type,consultation_fee_creditable'
      )
      .eq('user_id', userId)
      .maybeSingle()
      .then(async (p) => {
        if (!active) return
        if (p.error) {
          setState('error')
          return
        }
        const next = p.data as Profile | null
        setProfile(next)
        setState('ready')
        if (next) {
          setForm({
            displayName: next.business_name || next.display_name || '',
            bio: next.bio || '',
            location: next.location || '',
            languages: (next.languages || []).join(', '),
            specialties: (next.specialty_tags || []).join(', '),
            currency: next.currency || 'USD',
            availability: next.availability || 'OPEN',
          })
          const [portfolio, presentation] = await Promise.all([
            c
              .from('portfolio_items')
              .select('id,image_url,title,description,category,sort_order')
              .eq('tailor_profile_id', next.id)
              .order('sort_order'),
            invoke<{ media?: Media[] }>('tailor-profile-action', {
              action: 'get-media-presentation',
            }).catch(() => ({ media: [] })),
          ])
          if (active) {
            setItems((portfolio.data || []) as Item[])
            setMedia(presentation.media || [])
          }
        }
      }, () => {
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
      timer = setTimeout(() => setRevision((value) => value + 1), 180)
    }
    const channel = client
      .channel(`web-profile:${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tailor_profiles', filter: `id=eq.${profile.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_items', filter: `tailor_profile_id=eq.${profile.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media_assets', filter: `tailor_profile_id=eq.${profile.id}` }, refresh)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [profile?.id])
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
        <button className="font-semibold text-needle" onClick={() => setRevision((v) => v + 1)}>
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
        <Link href="/apply?source=account" className="mt-4 inline-flex font-semibold text-needle">
          Apply as a tailor
        </Link>
      </div>
    )
  const currentProfile = profile
  const update = (key: string, value: string) => setForm((v) => ({ ...v, [key]: value }))
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
          languages: form.languages
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
          specialties: form.specialties
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
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
      setRevision((v) => v + 1)
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
      setRevision((v) => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
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
        </div>
      </section>
      {notice ? (
        <p role="status" className="rounded-[8px] border border-needle/20 bg-needle/5 p-3 text-sm">
          {notice}
        </p>
      ) : null}
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
          <input
            aria-label="Location"
            className={field}
            value={form.location}
            onChange={(e) => update('location', e.target.value)}
            placeholder="City, country"
          />
          <input
            aria-label="Languages"
            className={field}
            value={form.languages}
            onChange={(e) => update('languages', e.target.value)}
            placeholder="Languages, comma separated"
          />
          <input
            aria-label="Specialties"
            className={field}
            value={form.specialties}
            onChange={(e) => update('specialties', e.target.value)}
            placeholder="Specialties, comma separated"
          />
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
          <select
            aria-label="Currency"
            className={field}
            value={form.currency}
            onChange={(e) => update('currency', e.target.value)}
          >
            {['USD', 'GBP', 'EUR', 'CAD', 'NGN', 'GHS', 'KES'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
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
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Portfolio</h2>
            <p className="mt-1 text-sm text-ink/55">
              Complete work, presented as customers will browse it.
            </p>
          </div>
          <span className="text-xs text-ink/45">
            {items.length} pieces · {(profile.portfolio_video_urls || []).length} videos
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <article
              key={item.id}
              className="overflow-hidden rounded-[8px] border border-ui-border bg-white"
            >
              {item.image_url ? (
                <Image
                  src={item.image_url}
                  alt={item.title || 'Portfolio work'}
                  width={640}
                  height={760}
                  className="aspect-[4/5] w-full object-cover"
                  unoptimized
                />
              ) : null}
              <div className="p-3">
                <p className="font-semibold">{item.title || 'Untitled work'}</p>
                <p className="text-xs text-ink/50">
                  {index === 0 ? 'Cover · ' : ''}
                  {item.category || 'Portfolio'}
                </p>
                <div className="mt-3 flex gap-3 text-xs font-semibold">
                  <button
                    onClick={() =>
                      void invoke('portfolio-item-action', {
                        action: 'set-cover',
                        itemId: item.id,
                      }).then(() => setRevision((v) => v + 1))
                    }
                    className="text-needle"
                  >
                    Set cover
                  </button>
                  <button
                    onClick={() =>
                      void invoke('portfolio-item-action', {
                        action: 'delete-item',
                        itemId: item.id,
                      }).then(() => setRevision((v) => v + 1))
                    }
                    className="text-rust"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
        </div>
        <button
          disabled={busy}
          onClick={() => void addPiece()}
          className="mt-4 h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add portfolio item
        </button>
      </section>
      <section className="app-surface p-5">
        <h2 className="text-xl font-semibold">Media presentation</h2>
        <p className="mt-1 text-sm text-ink/55">
          Focal point and alt text travel with each marketplace asset.
        </p>
        {media.length ? (
          <div className="mt-4 grid gap-4">
            {media.map((asset) => (
              <MediaEditor key={asset.id} asset={asset} onSaved={() => setRevision((v) => v + 1)} />
            ))}
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
            href={`/tailors/${profile.id}`}
            className="rounded-[8px] border border-ui-border px-4 py-2 text-sm font-semibold"
          >
            Preview public profile
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
    <div className="grid gap-4 rounded-[8px] border border-ui-border p-4 sm:grid-cols-[120px_1fr]">
      {asset.kind === 'VIDEO' ? (
        <video
          src={asset.url}
          poster={asset.posterUrl || undefined}
          className="aspect-square w-full rounded-[6px] object-cover"
          controls
          playsInline
        />
      ) : (
        <Image
          src={asset.url}
          alt={alt || 'Portfolio asset'}
          width={240}
          height={240}
          className="aspect-square w-full rounded-[6px] object-cover"
          style={{ objectPosition: `${x * 100}% ${y * 100}%` }}
          unoptimized
        />
      )}
      <div className="grid gap-2">
        <label className="text-xs font-semibold">
          Horizontal focus{' '}
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={x}
            onChange={(e) => setX(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <label className="text-xs font-semibold">
          Vertical focus{' '}
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={y}
            onChange={(e) => setY(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <input
          aria-label="Image description"
          className={field}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Describe this work"
        />
        {notice ? (
          <p role="status" className="text-xs text-ink/60">
            {notice}
          </p>
        ) : null}
        <button
          disabled={busy}
          onClick={() => void save()}
          className="h-9 w-fit rounded-[8px] bg-drape-green px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save presentation'}
        </button>
      </div>
    </div>
  )
}
export function ProfileWorkspace() {
  return (
    <AccountRouteRuntime surface="profile">
      {({ session, identity }) => <Content userId={session.user.id} identity={identity} />}
    </AccountRouteRuntime>
  )
}
