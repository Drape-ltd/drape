'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatDatabaseEnumLabel,
  formatMoney,
  normalizePhoneForStorage,
  validatePhoneForProfile,
} from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { createClient } from '../../../lib/supabase'
import { StructuredAddressSearch } from '../../../components/structured-address-search'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'
import { legacyItemMedia, MarketplaceMediaTile } from './marketplace-media-tile'
import type { ShopItem } from './shop-workspace'

type Pricing = {
  currency: string
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  shippingAmount: number
  totalAmount: number
  taxLabel: string | null
  taxFallback: boolean
}
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; item: ShopItem | null }
const select =
  'id, tailor_profile_id, title, description, category, sizes, size_inventory, price_amount, currency, photo_urls, stock_status, inventory_quantity, size_guide, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(id, display_name, business_name, location, availability, shop_paused, is_live)'
type DetailedItem = ShopItem & {
  size_inventory: Record<string, number> | null
  size_guide: Record<string, unknown> | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
}
function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value
}
function text(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback
}
async function functionMessage(error: unknown) {
  try {
    const context = (error as { context?: Response }).context
    if (context?.clone) {
      const payload = (await context.clone().json()) as { message?: string; error?: string }
      return payload.message || payload.error || null
    }
  } catch {}
  return null
}
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body })
  if (error)
    throw new Error(
      (await functionMessage(error)) || 'That action could not finish. Refresh and try again.'
    )
  const result = (data ?? {}) as Record<string, unknown>
  if (result.error) throw new Error(String(result.message || result.error))
  return result as T
}

async function loadItem(itemId: string, userId: string, role: AccountRouteIdentity['role']) {
  const supabase = createClient()
  const result = await supabase.from('seller_items').select(select).eq('id', itemId).maybeSingle()
  if (result.error) throw new Error('This piece could not load.')
  const item = (result.data ?? null) as unknown as DetailedItem | null
  if (!item) return null
  if (item.is_live) return item
  if (role !== 'TAILOR') return null
  const profile = await supabase
    .from('tailor_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  return (profile.data as { id?: string } | null)?.id === item.tailor_profile_id ? item : null
}

function CheckoutPanel({ item, onOrder }: { item: DetailedItem; onOrder: (id: string) => void }) {
  const sizes = item.sizes ?? []
  const options = [
    item.pickup_available && 'PICKUP',
    item.delivery_available && 'DELIVERY',
    item.shipping_available && 'SHIPPING',
  ].filter(Boolean) as string[]
  const [size, setSize] = useState(sizes[0] ?? '')
  const [quantity, setQuantity] = useState(1)
  const [fulfillment, setFulfillment] = useState(options[0] ?? '')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [fitAck, setFitAck] = useState(false)
  const [policyAck, setPolicyAck] = useState(false)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [pricingKey, setPricingKey] = useState('')
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const needsAddress = fulfillment !== 'PICKUP'
  const inputKey = JSON.stringify({
    size,
    quantity,
    fulfillment,
    address,
    city,
    region,
    postalCode,
    countryCode,
  })
  const fresh = Boolean(pricing && pricingKey === inputKey)
  const available =
    size && item.size_inventory
      ? Number(item.size_inventory[size] ?? 0)
      : Number(item.inventory_quantity ?? 0)
  function validate() {
    if (!options.length) return 'This tailor has not enabled fulfillment for this piece.'
    if (sizes.length && !size) return 'Choose a size.'
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3)
      return 'Choose a quantity between 1 and 3.'
    if (available > 0 && quantity > available)
      return `Only ${available} available in this selection.`
    if (
      needsAddress &&
      (!recipientName.trim() ||
        !address.trim() ||
        !city.trim() ||
        !region.trim() ||
        !countryCode.trim())
    )
      return 'Add the recipient and complete delivery address.'
    if (needsAddress) {
      const phoneError = validatePhoneForProfile(normalizePhoneForStorage(recipientPhone))
      if (phoneError) return phoneError
    }
    const leak = filterContactInfo([recipientName, address, city, region].join('\n'))
    if (leak.blocked) return "Delivery details can't include off-platform contact information."
    return null
  }
  const payload = {
    sellerItemId: item.id,
    size: size || undefined,
    quantity,
    fulfillment,
    address: needsAddress ? address.trim() : undefined,
    city: needsAddress ? city.trim() : undefined,
    region: needsAddress ? region.trim() : undefined,
    postalCode: needsAddress ? postalCode.trim() : undefined,
    countryCode: needsAddress ? countryCode.trim().toUpperCase() : undefined,
    addressVerificationSource: needsAddress ? 'CUSTOMER_CONFIRMED_STRUCTURED' : undefined,
    addressVerifiedAt: needsAddress ? new Date().toISOString() : undefined,
  }
  async function preview() {
    const issue = validate()
    if (issue) {
      setError(issue)
      return
    }
    setBusy('preview')
    setError(null)
    try {
      const result = await invoke<{ pricing?: Pricing }>('ready-made-order-action', {
        action: 'preview-checkout',
        ...payload,
      })
      if (!result.pricing) throw new Error('Pricing was not returned.')
      setPricing(result.pricing)
      setPricingKey(inputKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pricing could not load.')
    } finally {
      setBusy(null)
    }
  }
  async function create() {
    const issue = validate()
    if (issue) {
      setError(issue)
      return
    }
    if (!fitAck || !policyAck) {
      setError('Confirm fit guidance and the cancellation policy first.')
      return
    }
    if (!fresh) {
      setError('Preview the latest total before holding stock.')
      return
    }
    setBusy('create')
    setError(null)
    try {
      const result = await invoke<{ orderId?: string }>('ready-made-order-action', {
        action: 'create-checkout',
        ...payload,
        recipientName: needsAddress ? recipientName.trim() : undefined,
        recipientPhone: needsAddress ? normalizePhoneForStorage(recipientPhone) : undefined,
        cancellationPolicyAcknowledged: true,
        fitGuidanceAcknowledged: true,
      })
      if (!result.orderId) throw new Error('Checkout did not return an order.')
      onOrder(result.orderId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stock could not be held.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="app-surface p-5" id="checkout">
      <h2 className="text-xl font-semibold">Checkout</h2>
      <p className="mt-1 text-sm text-ink/58">
        Review fit, fulfillment, tax, and the locked total before payment.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[8px] border border-rust/25 bg-rust/8 p-3 text-sm text-rust"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold">
          Size
          <select
            value={size}
            onChange={(e) => {
              setSize(e.target.value)
              setFitAck(false)
            }}
            className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm"
          >
            {sizes.length ? (
              sizes.map((value) => <option key={value}>{value}</option>)
            ) : (
              <option value="">One size</option>
            )}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Quantity
          <input
            type="number"
            min={1}
            max={3}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="h-10 rounded-[8px] border border-ui-border px-3 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Fulfillment
          <select
            value={fulfillment}
            onChange={(e) => setFulfillment(e.target.value)}
            className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm"
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {formatDatabaseEnumLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {needsAddress ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold">
            Recipient name
            <input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="h-10 rounded-[8px] border border-ui-border px-3 text-sm"
            />
          </label>
          <PhoneNumberField
            label="Recipient phone"
            value={recipientPhone}
            onValueChange={setRecipientPhone}
          />
          <StructuredAddressSearch
            onSelect={(v) => {
              setAddress(v.line1)
              setCity(v.city)
              setRegion(v.stateRegion)
              setPostalCode(v.postcode)
              setCountryCode((v.countryCode || v.country).toUpperCase())
            }}
          />
          <label className="grid gap-1 text-xs font-semibold sm:col-span-2">
            Street address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-10 rounded-[8px] border border-ui-border px-3 text-sm"
            />
          </label>
          {[
            ['City', city, setCity],
            ['Region', region, setRegion],
            ['Postal code', postalCode, setPostalCode],
            ['Country code', countryCode, setCountryCode],
          ].map(([label, value, setter]) => (
            <label key={label as string} className="grid gap-1 text-xs font-semibold">
              {label as string}
              <input
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                className="h-10 rounded-[8px] border border-ui-border px-3 text-sm"
              />
            </label>
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid gap-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={fitAck}
            onChange={(e) => setFitAck(e.target.checked)}
            className="mt-1"
          />
          I reviewed the size and fit guidance.
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={policyAck}
            onChange={(e) => setPolicyAck(e.target.checked)}
            className="mt-1"
          />
          I understand cancellation and handoff reviews stay inside Drapeon.
        </label>
      </div>
      {pricing ? (
        <dl className="mt-4 grid gap-2 rounded-[8px] bg-bone p-4 text-sm">
          {[
            ['Subtotal', pricing.subtotalAmount],
            ['Fulfillment', pricing.shippingAmount],
            [pricing.taxLabel || 'Tax', pricing.taxAmount],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between">
              <dt>{label as string}</dt>
              <dd className="font-semibold">{formatMoney(value as number, pricing.currency)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-ink/10 pt-2 text-base">
            <dt className="font-semibold">Total</dt>
            <dd className="font-semibold text-needle">
              {formatMoney(pricing.totalAmount, pricing.currency)}
            </dd>
          </div>
          {pricing.taxFallback ? (
            <p className="text-xs text-rust">
              Tax is estimated because live lookup was unavailable.
            </p>
          ) : null}
        </dl>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => void preview()}
          disabled={Boolean(busy)}
          className="h-10 rounded-[8px] border border-ui-border bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          {busy === 'preview' ? 'Calculating…' : 'Preview total'}
        </button>
        <button
          onClick={() => void create()}
          disabled={Boolean(busy) || !fresh || !fitAck || !policyAck}
          className="h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy === 'create' ? 'Holding stock…' : 'Hold stock and continue'}
        </button>
      </div>
    </section>
  )
}

function Detail({
  itemId,
  userId,
  identity,
}: {
  itemId: string
  userId: string
  identity: AccountRouteIdentity
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selected, setSelected] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [orderId, setOrderId] = useState<string | null>(null)
  const refresh = useCallback(() => {
    setState({ status: 'loading' })
    void loadItem(itemId, userId, identity.role)
      .then((item) => setState({ status: 'ready', item }))
      .catch((e) =>
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Item unavailable.' })
      )
  }, [identity.role, itemId, userId])
  useEffect(() => {
    queueMicrotask(refresh)
  }, [refresh])
  const item = state.status === 'ready' ? (state.item as DetailedItem | null) : null
  useEffect(() => {
    if (!item) return
    const supabase = createClient()
    const channel = supabase
      .channel(`web-item:${item.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seller_items', filter: `id=eq.${item.id}` },
        refresh
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [item, refresh])
  const media = useMemo(
    () => legacyItemMedia(item?.photo_urls, text(item?.title, 'Ready-made piece')),
    [item]
  )
  if (state.status === 'loading')
    return (
      <section className="app-surface p-6" aria-busy="true">
        Loading piece…
      </section>
    )
  if (state.status === 'error')
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Piece unavailable</h2>
        <p className="mt-2 text-sm">{state.message}</p>
        <button
          onClick={refresh}
          className="mt-4 h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </section>
    )
  if (!item)
    return (
      <section className="app-surface p-6">
        <h2 className="text-xl font-semibold">This piece is not available.</h2>
        <Link href="/account/shop" className="mt-4 inline-flex text-sm font-semibold text-needle">
          Return to Marketplace
        </Link>
      </section>
    )
  const tailor = first(item.tailor_profiles)
  const readyMadeItemId = item.id
  const own = identity.role === 'TAILOR'
  const canBuy = !own && item.is_live && !['SOLD_OUT', 'HIDDEN'].includes(item.stock_status || '')
  async function inquire() {
    setBusy(true)
    setNotice(null)
    try {
      const r = await invoke<{ orderId?: string }>('ready-made-order-action', {
        action: 'start-inquiry',
        sellerItemId: readyMadeItemId,
      })
      if (r.orderId) location.assign(`/account/messages?orderId=${encodeURIComponent(r.orderId)}`)
      else setNotice('Inquiry started. Open Messages to continue.')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Inquiry could not start.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-5 pb-10 lg:grid-cols-2 xl:grid-cols-[3fr_2fr] lg:items-start">
      <section className="app-surface overflow-hidden" data-testid="item-media-panel">
        <div className="relative aspect-[4/3] bg-needle/8">
          <MarketplaceMediaTile
            media={media[selected] ?? null}
            title={text(item.title, 'Ready-made piece')}
            priority
          />
        </div>
        {media.length > 1 ? (
          <div className="grid grid-cols-5 gap-2 p-3">
            {media.map((entry, index) => (
              <button
                key={entry.id}
                aria-label={`View media ${index + 1}`}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
                className={`relative aspect-square overflow-hidden rounded-[8px] border ${selected === index ? 'border-needle ring-2 ring-needle/15' : 'border-ui-border'}`}
              >
                <MarketplaceMediaTile media={entry} title={text(item.title, 'Piece')} />
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <div className="grid h-fit gap-4">
        <section className="app-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-needle">
            {text(item.category, 'Ready-made')}
          </p>
          <h1 className="mt-2 text-3xl text-ink">{text(item.title, 'Ready-made piece')}</h1>
          <p className="mt-2 text-2xl font-semibold">
            {formatMoney(item.price_amount, item.currency)}
          </p>
          <p className="mt-4 text-sm leading-6 text-ink/64">
            {text(
              item.description,
              'Review the piece, fit, fulfillment, and price before checkout.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(item.sizes ?? []).map((v) => (
              <span
                key={v}
                className="rounded-[8px] border border-ui-border px-2 py-1 text-xs font-semibold"
              >
                {v}
              </span>
            ))}
            <span className="rounded-[8px] bg-needle/8 px-2 py-1 text-xs font-semibold text-needle">
              {formatDatabaseEnumLabel(item.stock_status, 'Stock pending')}
            </span>
          </div>
          {tailor ? (
            <Link
              href={`/account/tailors/${tailor.id}`}
              className="mt-5 block border-t border-ui-border pt-4 text-sm font-semibold text-needle"
            >
              By {text(tailor.business_name || tailor.display_name, 'Drapeon tailor')} ·{' '}
              {text(tailor.location, 'Worldwide')}
            </Link>
          ) : null}
          {notice ? (
            <p role="status" className="mt-3 text-sm text-rust">
              {notice}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {canBuy ? (
              <>
                <a
                  href="#checkout"
                  className="h-10 rounded-[8px] bg-drape-green px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Start checkout
                </a>
                <button
                  onClick={() => void inquire()}
                  disabled={busy}
                  className="h-10 rounded-[8px] border border-ui-border px-4 text-sm font-semibold"
                >
                  {busy ? 'Opening…' : 'Ask tailor'}
                </button>
              </>
            ) : own ? (
              <Link
                href="/account/profile"
                className="h-10 rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold"
              >
                Manage catalogue
              </Link>
            ) : (
              <p className="text-sm text-rust">
                This piece is not currently available for checkout.
              </p>
            )}
          </div>
        </section>
        {orderId ? (
          <section className="app-surface p-5">
            <h2 className="text-xl font-semibold">Stock held</h2>
            <p className="mt-2 text-sm text-ink/60">
              Your order is saved. Continue to the locked payment review.
            </p>
            <Link
              href={`/account/checkout/${orderId}`}
              className="mt-4 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white"
            >
              Continue to payment
            </Link>
          </section>
        ) : canBuy ? (
          <CheckoutPanel item={item} onOrder={setOrderId} />
        ) : null}
      </div>
    </div>
  )
}

export function ItemDetailWorkspace({ itemId }: { itemId: string }) {
  return (
    <AccountRouteRuntime surface="item-detail">
      {({ session, identity }) => (
        <Detail itemId={itemId} userId={session.user.id} identity={identity} />
      )}
    </AccountRouteRuntime>
  )
}
