'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '../lib/supabase'
import { safeEntityName, safeUserText } from '../lib/safe-display'

type AccountSurface =
  | 'explore'
  | 'orders'
  | 'order-detail'
  | 'messages'
  | 'measurements'
  | 'shop'
  | 'work'
  | 'checkout'

type JoinedProfile = {
  display_name?: string | null
  business_name?: string | null
  avatar_url?: string | null
  location?: string | null
}

type AccountOrder = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  item_size: string | null
  description: string | null
  occasion: string | null
  stage: string | null
  delivery_method: string | null
  fabric_source: string | null
  special_note: string | null
  fabric_tracking: string | null
  quoted_amount: number | null
  subtotal_amount: number | null
  fulfillment_fee: number | null
  shipping_amount: number | null
  tax_amount: number | null
  platform_fee_amount: number | null
  total_amount: number | null
  currency: string | null
  quoted_currency: string | null
  created_at: string | null
  updated_at: string | null
  deadline: string | null
  quoted_completion_date: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  seller_item_id: string | null
  payment_provider: string | null
  escrow_released: boolean | null
  auto_release_at: string | null
  collection_code_used: boolean | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
  customer_profiles?: JoinedProfile | JoinedProfile[] | null
}

type AccountPayment = {
  id: string
  order_id: string
  phase: string | null
  provider: string | null
  currency: string | null
  amount: number | null
  status: string | null
  confirmed_at: string | null
  created_at: string | null
  refunded_at: string | null
}

type AccountMessage = {
  id: string
  order_id: string
  sender_id: string | null
  type: string | null
  content: string | null
  media_url: string | null
  blocked: boolean | null
  read_at: string | null
  created_at: string | null
}

type StageUpdate = {
  id: string
  order_id: string
  stage: string | null
  note: string | null
  photo_url: string | null
  created_at: string | null
}

type CustomerProfile = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  fit_style: string | null
  updated_at: string | null
}

type TailorProfile = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
  bio: string | null
  location: string | null
  languages: string[] | null
  specialty_tags: string[] | null
  price_range_min: number | null
  price_range_max: number | null
  currency: string | null
  tier: string | null
  availability: string | null
  is_live: boolean | null
  is_verified: boolean | null
  avg_rating: number | null
  total_reviews: number | null
  total_orders: number | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  portfolio_photo_urls: string[] | null
  avatar_url: string | null
  payout_account_verified?: boolean | null
}

type MeasurementProfile = {
  id: string
  label: string | null
  relationship: string | null
  source: string | null
  unit_preference: string | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}

type MeasurementScan = {
  id: string
  capture_method: string | null
  status: string | null
  confidence_overall: string | null
  created_at: string | null
}

type SellerItem = {
  id: string
  tailor_profile_id: string | null
  title: string | null
  description: string | null
  category: string | null
  sizes: string[] | null
  price_amount: number | null
  currency: string | null
  photo_urls: string[] | null
  stock_status: string | null
  inventory_quantity?: number | null
  is_live: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  updated_at: string | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
}

type AccountSurfaceData = {
  userId: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  orders: AccountOrder[]
  payments: AccountPayment[]
  messages: AccountMessage[]
  stageUpdates: StageUpdate[]
  measurementProfiles: MeasurementProfile[]
  measurementScans: MeasurementScan[]
  sellerItems: SellerItem[]
  exploreTailors: TailorProfile[]
  exploreItems: SellerItem[]
  warning: string | null
}

const emptyData: AccountSurfaceData = {
  userId: null,
  customerProfile: null,
  tailorProfile: null,
  orders: [],
  payments: [],
  messages: [],
  stageUpdates: [],
  measurementProfiles: [],
  measurementScans: [],
  sellerItems: [],
  exploreTailors: [],
  exploreItems: [],
  warning: null,
}

const surfaceCopy: Record<AccountSurface, { eyebrow: string; title: string; body: string }> = {
  explore: {
    eyebrow: 'Explore',
    title: 'Find tailors and ready-made pieces.',
    body: 'Browse the same live marketplace records used by the app. Start orders in mobile for checkout, camera, push, and proof flows.',
  },
  orders: {
    eyebrow: 'Orders',
    title: 'Track every order from one place.',
    body: 'Review custom and ready-made work, payment state, fulfillment, production updates, and next steps.',
  },
  'order-detail': {
    eyebrow: 'Order detail',
    title: 'One order, full context.',
    body: 'Brief, payment, timeline, messages, and handoff context stay together so nobody has to guess what happened.',
  },
  messages: {
    eyebrow: 'Messages',
    title: 'Order conversations stay protected.',
    body: 'Review message threads attached to real orders. Reply, call, voice, and media actions remain in the app for launch.',
  },
  measurements: {
    eyebrow: 'Measurements',
    title: 'Fit records you can trust.',
    body: 'Named wearer profiles, Drape Vision scans, manual profiles, and measurement age all stay visible before ordering.',
  },
  shop: {
    eyebrow: 'Shop',
    title: 'Ready-made inventory without the noise.',
    body: 'Tailors can review their live and draft items. Customers can browse live pieces and continue checkout in the app.',
  },
  work: {
    eyebrow: 'Work queue',
    title: 'Tailor actions, organized by urgency.',
    body: 'Review active production, customer context, payment state, and stage progress before opening app actions.',
  },
  checkout: {
    eyebrow: 'Checkout handoff',
    title: 'Secure checkout continues in the app.',
    body: 'Web shows the exact order and payment state, then hands off to mobile for provider checkout and protected confirmations.',
  },
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function cleanLabel(value: string | null | undefined, fallback = 'Not set') {
  if (!value) return fallback
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function stringList(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined) {
  if (typeof amountMinor !== 'number') return 'Quote pending'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amountMinor / 100)
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatRelative(value: string | null | undefined) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  const deltaMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  const absoluteMinutes = Math.abs(deltaMinutes)
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (absoluteMinutes < 60) return formatter.format(deltaMinutes, 'minute')
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, 'hour')
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 30) return formatter.format(deltaDays, 'day')
  return formatDate(value) ?? 'Recently'
}

function orderTitle(order: AccountOrder) {
  return safeUserText(order.item_title || order.garment_type, 'Drapeon order')
}

function orderAmount(order: AccountOrder) {
  return formatMoney(order.total_amount ?? order.quoted_amount, order.currency ?? order.quoted_currency)
}

function isTerminalOrder(order: AccountOrder) {
  return ['COMPLETE', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(order.stage ?? '')
}

function partyName(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    const tailor = firstJoinedRow(order.tailor_profiles)
    return safeEntityName(tailor?.business_name || tailor?.display_name, 'Tailor')
  }
  const customer = firstJoinedRow(order.customer_profiles)
  return safeEntityName(customer?.display_name, 'Customer')
}

function itemPhoto(item: SellerItem) {
  return stringList(item.photo_urls)[0] ?? null
}

function tailorPhoto(tailor: TailorProfile) {
  return stringList(tailor.portfolio_photo_urls)[0] ?? tailor.avatar_url ?? null
}

function hasMeasurements(profile: CustomerProfile | null) {
  return !!profile?.measurements && Object.keys(profile.measurements).length > 0
}

function fulfillmentSummary({
  pickup,
  delivery,
  shipping,
  pickup_available,
  delivery_available,
  shipping_available,
}: {
  pickup?: boolean | null
  delivery?: boolean | null
  shipping?: boolean | null
  pickup_available?: boolean | null
  delivery_available?: boolean | null
  shipping_available?: boolean | null
}) {
  const values = [
    (pickup ?? pickup_available) ? 'Pickup' : null,
    (delivery ?? delivery_available) ? 'Delivery' : null,
    (shipping ?? shipping_available) ? 'Shipping' : null,
  ].filter(Boolean)
  return values.length > 0 ? values.join(' / ') : 'Fulfillment not set'
}

function latestPayment(orderId: string, payments: AccountPayment[]) {
  return payments.find((payment) => payment.order_id === orderId) ?? null
}

function latestMessage(orderId: string, messages: AccountMessage[]) {
  return messages.find((message) => message.order_id === orderId) ?? null
}

function stageUpdatesFor(orderId: string, updates: StageUpdate[]) {
  return updates.filter((update) => update.order_id === orderId)
}

async function fetchAccountSurfaceData(userId: string): Promise<AccountSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const [customerProfileRes, tailorProfileRes, measurementProfilesRes, measurementScansRes, exploreTailorsRes] =
    await Promise.all([
      supabase
        .from('customer_profiles')
        .select('user_id, display_name, avatar_url, measurements, unit_preference, fit_style, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('tailor_profiles')
        .select(
          'id, user_id, display_name, business_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, tier, availability, is_live, is_verified, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, portfolio_photo_urls, avatar_url, payout_account_verified'
        )
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('customer_measurement_profiles')
        .select('id, label, relationship, source, unit_preference, is_default, last_measured_at, updated_at')
        .eq('customer_id', userId)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(10),
      supabase
        .from('measurement_scans')
        .select('id, capture_method, status, confidence_overall, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('tailor_profiles')
        .select(
          'id, user_id, display_name, business_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, tier, availability, is_live, is_verified, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, portfolio_photo_urls, avatar_url'
        )
        .eq('is_live', true)
        .order('avg_rating', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(12),
    ])

  if (
    customerProfileRes.error ||
    tailorProfileRes.error ||
    measurementProfilesRes.error ||
    measurementScansRes.error ||
    exploreTailorsRes.error
  ) {
    warning = 'Some account records could not load. Refresh in a moment; your app data is still safe.'
  }

  const tailorProfile = tailorProfileRes.error ? null : ((tailorProfileRes.data ?? null) as TailorProfile | null)
  const orderFilter = tailorProfile?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfile.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(
      `
        id, reference, order_kind, garment_type, item_title, item_size, description, occasion, stage, delivery_method,
        fabric_source, special_note, fabric_tracking, quoted_amount, subtotal_amount, fulfillment_fee, shipping_amount,
        tax_amount, platform_fee_amount, total_amount, currency, quoted_currency, created_at, updated_at, deadline,
        quoted_completion_date, customer_id, tailor_id, tailor_profile_id, seller_item_id, payment_provider,
        escrow_released, auto_release_at, collection_code_used,
        tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location),
        customer_profiles!customer_id(display_name, avatar_url)
      `
    )
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : ((ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Order history could not load. Refresh in a moment; your app data is still safe.'
  }

  const orderIds = orders.map((order) => order.id)
  let payments: AccountPayment[] = []
  let messages: AccountMessage[] = []
  let stageUpdates: StageUpdate[] = []

  if (orderIds.length > 0) {
    const [paymentsRes, messagesRes, stageUpdatesRes] = await Promise.all([
      supabase
        .from('order_payments')
        .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('messages')
        .select('id, order_id, sender_id, type, content, media_url, blocked, read_at, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('order_stage_updates')
        .select('id, order_id, stage, note, photo_url, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (paymentsRes.error || messagesRes.error || stageUpdatesRes.error) {
      warning = 'Some order activity could not load. Refresh in a moment; your app data is still safe.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
      messages = (messagesRes.data ?? []) as AccountMessage[]
      stageUpdates = (stageUpdatesRes.data ?? []) as StageUpdate[]
    }
  }

  let sellerItems: SellerItem[] = []
  if (tailorProfile?.id) {
    const sellerItemsRes = await supabase
      .from('seller_items')
      .select(
        'id, tailor_profile_id, title, description, category, sizes, price_amount, currency, photo_urls, stock_status, inventory_quantity, is_live, pickup_available, delivery_available, shipping_available, updated_at'
      )
      .eq('tailor_profile_id', tailorProfile.id)
      .order('updated_at', { ascending: false })
      .limit(30)

    if (sellerItemsRes.error) {
      warning = 'Shop records could not load. Refresh in a moment; your app data is still safe.'
    } else {
      sellerItems = (sellerItemsRes.data ?? []) as SellerItem[]
    }
  }

  let exploreItems: SellerItem[] = []
  const exploreItemsRes = await supabase
    .from('seller_items')
    .select(
      'id, tailor_profile_id, title, description, category, sizes, price_amount, currency, photo_urls, stock_status, inventory_quantity, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(display_name, business_name, location)'
    )
    .eq('is_live', true)
    .neq('stock_status', 'SOLD_OUT')
    .neq('stock_status', 'HIDDEN')
    .order('updated_at', { ascending: false })
    .limit(18)

  if (exploreItemsRes.error) {
    warning = warning ?? 'Ready-made pieces could not load. Refresh in a moment.'
  } else {
    exploreItems = (exploreItemsRes.data ?? []) as SellerItem[]
  }

  return {
    userId,
    customerProfile: customerProfileRes.error ? null : ((customerProfileRes.data ?? null) as CustomerProfile | null),
    tailorProfile,
    orders,
    payments,
    messages,
    stageUpdates,
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfile[]),
    measurementScans: measurementScansRes.error ? [] : ((measurementScansRes.data ?? []) as MeasurementScan[]),
    sellerItems,
    exploreTailors: exploreTailorsRes.error ? [] : ((exploreTailorsRes.data ?? []) as TailorProfile[]),
    exploreItems,
    warning,
  }
}

function AccountRouteShell({
  session,
  data,
  surface,
  children,
}: {
  session: Session
  data: AccountSurfaceData
  surface: AccountSurface
  children: ReactNode
}) {
  const copy = surfaceCopy[surface]
  const role = session.user.user_metadata?.role === 'TAILOR' ? 'TAILOR' : 'CUSTOMER'
  const links: Array<[string, Route]> = [
    ['Dashboard', '/account/dashboard'],
    ['Explore', '/account/explore'],
    ['Orders', '/account/orders'],
    ['Messages', '/account/messages'],
    ['Measurements', '/account/measurements'],
  ]
  if (role === 'TAILOR' || data.tailorProfile) {
    links.push(['Shop', '/account/shop'], ['Work', '/account/work'])
  }
  const surfaceKey = surface.split('-')[0] ?? surface

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
        <div className="rounded-[1.75rem] border border-ink/8 bg-white/80 p-4 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/" className="text-4xl font-semibold tracking-[-0.04em] text-needle">
              Drapeon
            </Link>
            <nav className="flex gap-2 overflow-x-auto pb-1 lg:justify-end lg:pb-0">
              {links.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className={
                    href.includes(surfaceKey) || (surface === 'order-detail' && href === '/account/orders')
                      ? 'whitespace-nowrap rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white'
                      : 'whitespace-nowrap rounded-full border border-ink/8 bg-white px-4 py-2.5 text-sm font-semibold text-ink/72'
                  }
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <section className="grid gap-5 py-6 lg:grid-cols-[1fr_0.34fr]">
          <div className="rounded-[1.75rem] border border-ink/8 bg-white/82 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{copy.eyebrow}</p>
            <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">{copy.title}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-ink/66">{copy.body}</p>
            {data.warning ? (
              <p className="mt-5 rounded-[1rem] border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
                {data.warning}
              </p>
            ) : null}
          </div>
          <div className="rounded-[1.75rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Signed in</p>
            <h2 className="mt-3 break-words text-2xl font-semibold text-ink">{session.user.email}</h2>
            <p className="mt-3 text-sm leading-6 text-ink/62">
              Same identity as mobile. Open the app for camera, checkout, calls, proof uploads, and push-first actions.
            </p>
            <a href="drape://" className="mt-5 inline-flex rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white">
              Open app
            </a>
          </div>
        </section>

        {children}
      </div>
    </main>
  )
}

function AuthRequiredCard() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <div className="rounded-[1.75rem] border border-ink/8 bg-white/86 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Account</p>
          <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Sign in to continue.</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">
            These web surfaces use the same protected Drapeon account records as the mobile app.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-in" className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
              Sign in
            </Link>
            <Link href="/sign-up" className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

function LoadingCard() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <div className="rounded-[1.75rem] border border-ink/8 bg-white/86 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <p className="text-sm font-semibold text-ink/62">Loading your Drapeon workspace...</p>
        </div>
      </div>
    </main>
  )
}

function PhotoTile({ src, label }: { src: string | null; label: string }) {
  if (!src) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-[1.15rem] bg-needle/10 text-sm font-semibold text-needle">
        {label}
      </div>
    )
  }
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.15rem]">
      <Image
        src={src}
        alt={label}
        fill
        sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 90vw"
        className="object-cover"
        unoptimized
      />
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-[1rem] border border-ink/6 bg-white/72 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/72">{label}</p>
      <p className="mt-2 text-sm font-semibold text-ink">{value || 'Not set'}</p>
    </div>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[1.4rem] border border-ink/8 bg-white/76 p-6 shadow-sm">
      <h2 className="text-2xl text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/66">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function RenderExplore({ data }: { data: AccountSurfaceData }) {
  return (
    <div className="grid gap-6">
      <section>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailors</p>
            <h2 className="mt-2 text-3xl text-ink">Live profiles</h2>
          </div>
          <p className="text-sm text-ink/58">{data.exploreTailors.length} visible</p>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.exploreTailors.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3">
              <EmptyState
                title="No live tailors loaded yet."
                body="Explore reads live tailor profiles from Supabase. If this is empty, either the marketplace is paused or profiles are not live."
              />
            </div>
          ) : (
            data.exploreTailors.map((tailor) => (
              <article key={tailor.id} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-4 shadow-sm">
                <PhotoTile src={tailorPhoto(tailor)} label="Tailor photo" />
                <div className="mt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h3>
                      <p className="mt-1 text-sm text-ink/58">{safeUserText(tailor.location, 'Location pending')}</p>
                    </div>
                    <p className="rounded-full bg-bone px-3 py-1 text-sm font-semibold text-ink">
                      {Number(tailor.avg_rating ?? 0).toFixed(1)}
                    </p>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink/62">
                    {safeUserText(tailor.bio || stringList(tailor.specialty_tags).join(', '), 'Verified craft profile on Drapeon.')}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-semibold text-ink/62">
                    <span className="rounded-full bg-bone px-3 py-2 text-center">{cleanLabel(tailor.availability, 'Availability')}</span>
                    <span className="rounded-full bg-bone px-3 py-2 text-center">
                      {formatMoney(tailor.price_range_min, tailor.currency)}
                    </span>
                  </div>
                  <a href="drape://" className="mt-4 inline-flex w-full justify-center rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white">
                    Start in app
                  </a>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="border-t border-ink/6 pt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Ready-made</p>
            <h2 className="mt-2 text-3xl text-ink">Live shop pieces</h2>
          </div>
          <p className="text-sm text-ink/58">{data.exploreItems.length} pieces</p>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.exploreItems.map((item) => {
            const tailor = firstJoinedRow(item.tailor_profiles)
            return (
              <article key={item.id} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-4 shadow-sm">
                <PhotoTile src={itemPhoto(item)} label="Ready-made item" />
                <div className="mt-4">
                  <h3 className="text-2xl text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                  <p className="mt-1 text-sm text-ink/58">{safeEntityName(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')}</p>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <p className="font-semibold text-ink">{formatMoney(item.price_amount, item.currency)}</p>
                    <p className="text-sm font-semibold text-rust">{cleanLabel(item.stock_status, 'In stock')}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-ink/62">{fulfillmentSummary(item)}</p>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function OrderCard({ order, data }: { order: AccountOrder; data: AccountSurfaceData }) {
  const payment = latestPayment(order.id, data.payments)
  const message = latestMessage(order.id, data.messages)
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="block rounded-[1.45rem] border border-ink/8 bg-white/84 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">{cleanLabel(order.order_kind, 'Order')}</p>
          <h3 className="mt-2 text-2xl text-ink">{orderTitle(order)}</h3>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {partyName(order, data.userId)} · {cleanLabel(order.stage, 'In progress')} · {cleanLabel(order.delivery_method, 'Fulfillment')}
          </p>
          {message ? (
            <p className="mt-3 line-clamp-1 text-sm text-ink/54">
              {message.blocked ? 'Protected message blocked.' : safeUserText(message.content, message.media_url ? 'Media message attached.' : 'Message activity recorded.')}
            </p>
          ) : null}
        </div>
        <div className="min-w-44 text-left lg:text-right">
          <p className="font-semibold text-ink">{orderAmount(order)}</p>
          <p className="mt-1 text-sm text-ink/52">{cleanLabel(payment?.status, 'Payment pending')}</p>
          <p className="mt-1 text-xs text-ink/46">{formatRelative(order.updated_at ?? order.created_at)}</p>
        </div>
      </div>
    </Link>
  )
}

function RenderOrders({ data }: { data: AccountSurfaceData }) {
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order))
  const pastOrders = data.orders.filter(isTerminalOrder)
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryLine label="Active" value={`${activeOrders.length} orders`} />
        <SummaryLine label="Completed" value={`${pastOrders.length} orders`} />
        <SummaryLine label="Messages" value={`${data.messages.length} recent records`} />
      </section>
      <section className="grid gap-4">
        <h2 className="text-3xl text-ink">Active orders</h2>
        {activeOrders.length === 0 ? (
          <EmptyState
            title="No active orders."
            body="Custom and ready-made orders will appear here after they are created in the app."
            action={<Link href="/account/explore" className="font-semibold text-needle">Browse Explore</Link>}
          />
        ) : (
          activeOrders.map((order) => <OrderCard key={order.id} order={order} data={data} />)
        )}
      </section>
      {pastOrders.length > 0 ? (
        <section className="grid gap-4 border-t border-ink/6 pt-6">
          <h2 className="text-3xl text-ink">Past orders</h2>
          {pastOrders.map((order) => <OrderCard key={order.id} order={order} data={data} />)}
        </section>
      ) : null}
    </div>
  )
}

function RenderOrderDetail({ data, orderId }: { data: AccountSurfaceData; orderId?: string }) {
  const order = data.orders.find((entry) => entry.id === orderId)
  if (!order) {
    return (
      <EmptyState
        title="Order not found."
        body="This order may belong to another account, or it may not have loaded yet. Refresh, then check the app if the issue persists."
        action={<Link href="/account/orders" className="font-semibold text-needle">Back to orders</Link>}
      />
    )
  }
  const updates = stageUpdatesFor(order.id, data.stageUpdates).sort((a, b) => {
    return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  })
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const messages = data.messages.filter((message) => message.order_id === order.id)

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{cleanLabel(order.order_kind, 'Order')}</p>
          <h2 className="mt-3 text-4xl text-ink">{orderTitle(order)}</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {safeUserText(order.description || order.special_note, 'The app brief carries full order details and proof media.')}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryLine label="Status" value={cleanLabel(order.stage, 'In progress')} />
            <SummaryLine label="Amount" value={orderAmount(order)} />
            <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
            <SummaryLine label="Due date" value={formatDate(order.quoted_completion_date ?? order.deadline) ?? 'Pending'} />
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Next best action</p>
          <h3 className="mt-3 text-3xl text-ink">
            {latestPayment(order.id, data.payments)?.status === 'CONFIRMED' ? 'Review order progress.' : 'Confirm checkout state.'}
          </h3>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Payment, proof uploads, consultation calls, stage media, and handoff confirmation stay in the app so the trust chain is complete.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <Link href={`/account/checkout/${order.id}`} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
              View checkout handoff
            </Link>
            <a href="drape://" className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
              Open order in app
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Brief</h2>
          <div className="mt-5 grid gap-3">
            <SummaryLine label="Party" value={partyName(order, data.userId)} />
            <SummaryLine label="Garment" value={safeUserText(order.garment_type || order.item_title, 'Garment')} />
            <SummaryLine label="Fabric" value={cleanLabel(order.fabric_source, 'Fabric source')} />
            <SummaryLine label="Tracking" value={order.fabric_tracking ? 'Tracking added in app' : 'No tracking added'} />
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Timeline</h2>
          <div className="mt-5 grid gap-3">
            {updates.length === 0 ? (
              <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No production updates yet. Stage photos and videos appear here after the tailor posts them in the app.
              </p>
            ) : (
              updates.map((update) => (
                <div key={update.id} className="rounded-[1rem] border border-ink/6 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-3 w-3 rounded-full bg-needle" />
                    <div>
                      <h3 className="font-semibold text-ink">{cleanLabel(update.stage, 'Stage update')}</h3>
                      <p className="mt-1 text-sm leading-6 text-ink/62">{safeUserText(update.note, 'Stage updated.')}</p>
                      <p className="mt-2 text-xs text-ink/46">{formatRelative(update.created_at)}</p>
                    </div>
                  </div>
                  {update.photo_url ? <div className="mt-3 max-w-64"><PhotoTile src={update.photo_url} label="Stage media" /></div> : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Payments</h2>
          <div className="mt-5 grid gap-3">
            {payments.length === 0 ? (
              <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">No payment record loaded for this order yet.</p>
            ) : (
              payments.map((payment) => (
                <SummaryLine
                  key={payment.id}
                  label={cleanLabel(payment.phase, 'Payment')}
                  value={`${formatMoney(payment.amount, payment.currency)} · ${cleanLabel(payment.status, 'Pending')}`}
                />
              ))
            )}
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Messages</h2>
          <div className="mt-5 grid gap-3">
            {messages.length === 0 ? (
              <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">No messages on this order yet.</p>
            ) : (
              messages.slice(0, 4).map((message) => (
                <div key={message.id} className="rounded-[1rem] border border-ink/6 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                    {message.sender_id === data.userId ? 'You' : 'Other party'} · {formatRelative(message.created_at)}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-ink/62">
                    {message.blocked ? 'A message was blocked to keep the order protected.' : safeUserText(message.content, message.media_url ? 'Media message attached.' : 'Message activity recorded.')}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function RenderMessages({ data }: { data: AccountSurfaceData }) {
  const threads = data.orders
    .map((order) => ({
      order,
      messages: data.messages.filter((message) => message.order_id === order.id),
    }))
    .filter((thread) => thread.messages.length > 0)

  return (
    <div className="grid gap-5">
      {threads.length === 0 ? (
        <EmptyState
          title="No order conversations yet."
          body="Drapeon messages unlock around orders. When a customer or tailor sends a note, photo, voice note, or call request, the thread appears here."
          action={<Link href="/account/orders" className="font-semibold text-needle">View orders</Link>}
        />
      ) : (
        threads.map(({ order, messages }) => (
          <section key={order.id} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{cleanLabel(order.order_kind, 'Order')}</p>
                <h2 className="mt-2 text-3xl text-ink">{orderTitle(order)}</h2>
                <p className="mt-1 text-sm text-ink/58">{partyName(order, data.userId)} · {messages.length} messages</p>
              </div>
              <Link href={`/account/orders/${order.id}`} className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                Open order
              </Link>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {messages.slice(0, 6).map((message) => (
                <div key={message.id} className="rounded-[1.1rem] border border-ink/6 bg-bone/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                    {message.sender_id === data.userId ? 'You sent' : 'Received'} · {cleanLabel(message.type, 'Message')}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink/66">
                    {message.blocked ? 'Contact-sharing or unsafe content was blocked.' : safeUserText(message.content, message.media_url ? 'Media message attached.' : 'Message activity recorded.')}
                  </p>
                  <p className="mt-3 text-xs text-ink/46">{formatRelative(message.created_at)}</p>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function RenderMeasurements({ data }: { data: AccountSurfaceData }) {
  const legacyMeasurementCount = hasMeasurements(data.customerProfile) ? 1 : 0
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryLine label="Named profiles" value={`${data.measurementProfiles.length}`} />
        <SummaryLine label="Drape Vision scans" value={`${data.measurementScans.length}`} />
        <SummaryLine label="Profile units" value={data.customerProfile?.unit_preference || data.measurementProfiles[0]?.unit_preference || 'Not set'} />
      </section>
      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Wearer profiles</h2>
          <div className="mt-5 grid gap-3">
            {data.measurementProfiles.length === 0 && legacyMeasurementCount === 0 ? (
              <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No measurement profiles yet. Add manual measurements or use Drape Vision in the app before starting a custom order.
              </p>
            ) : (
              <>
                {data.measurementProfiles.map((profile) => (
                  <div key={profile.id} className="rounded-[1.1rem] border border-ink/6 bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-ink">{safeUserText(profile.label, 'Measurement profile')}</h3>
                        <p className="mt-1 text-sm text-ink/60">
                          {cleanLabel(profile.relationship, 'Wearer')} · {cleanLabel(profile.source, 'Manual')}
                        </p>
                      </div>
                      <p className="text-xs font-semibold text-needle">{profile.is_default ? 'Default' : profile.unit_preference}</p>
                    </div>
                    <p className="mt-3 text-xs text-ink/46">
                      Last measured {formatDate(profile.last_measured_at ?? profile.updated_at) ?? 'recently'}
                    </p>
                  </div>
                ))}
                {legacyMeasurementCount > 0 ? (
                  <div className="rounded-[1.1rem] border border-ink/6 bg-white p-4">
                    <h3 className="font-semibold text-ink">Main customer measurements</h3>
                    <p className="mt-1 text-sm text-ink/60">Legacy profile · {data.customerProfile?.fit_style || 'Fit preference not set'}</p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Drape Vision</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Drape Vision remains app-first because scan capture needs camera guidance, privacy prompts, retake paths, and proof review.
          </p>
          <div className="mt-5 grid gap-3">
            {data.measurementScans.length === 0 ? (
              <p className="rounded-[1rem] bg-white/70 p-4 text-sm leading-6 text-ink/62">No scan records yet.</p>
            ) : (
              data.measurementScans.map((scan) => (
                <SummaryLine
                  key={scan.id}
                  label={cleanLabel(scan.capture_method, 'Scan')}
                  value={`${cleanLabel(scan.status, 'Captured')} · ${cleanLabel(scan.confidence_overall, 'Confidence pending')}`}
                />
              ))
            )}
          </div>
          <a href="drape://" className="mt-5 inline-flex rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
            Open measurements in app
          </a>
        </div>
      </section>
    </div>
  )
}

function RenderShop({ data }: { data: AccountSurfaceData }) {
  const isTailor = !!data.tailorProfile
  const items = isTailor ? data.sellerItems : data.exploreItems
  return (
    <div className="grid gap-6">
      {isTailor ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <SummaryLine label="Total items" value={`${data.sellerItems.length}`} />
          <SummaryLine label="Live" value={`${data.sellerItems.filter((item) => item.is_live).length}`} />
          <SummaryLine label="Payout" value={data.tailorProfile?.payout_account_verified ? 'Ready' : 'Needs setup'} />
        </section>
      ) : null}
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState
              title={isTailor ? 'No shop items yet.' : 'No live shop items loaded.'}
              body={isTailor ? 'Create ready-made items in the app with real photos, sizes, stock, fit guide, and fulfillment.' : 'Ready-made items from live tailors appear here.'}
              action={isTailor ? <a href="drape://" className="font-semibold text-needle">Open shop in app</a> : null}
            />
          </div>
        ) : (
          items.map((item) => {
            const tailor = firstJoinedRow(item.tailor_profiles)
            return (
              <article key={item.id} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-4 shadow-sm">
                <PhotoTile src={itemPhoto(item)} label="Ready-made item" />
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">{safeUserText(item.category, 'Ready-made')}</p>
                  <h3 className="mt-2 text-2xl text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                  <p className="mt-1 text-sm text-ink/58">
                    {isTailor ? (item.is_live ? 'Live listing' : 'Draft listing') : safeEntityName(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <SummaryLine label="Price" value={formatMoney(item.price_amount, item.currency)} />
                    <SummaryLine label="Stock" value={cleanLabel(item.stock_status, 'Stock')} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-ink/62">{fulfillmentSummary(item)}</p>
                </div>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}

function RenderWork({ data }: { data: AccountSurfaceData }) {
  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor workspace not set up."
        body="Create or switch to a tailor profile before the web work queue can show orders, shop, payout state, and client context."
        action={<Link href="/sign-up?role=tailor" className="font-semibold text-needle">Create tailor account</Link>}
      />
    )
  }

  const tailorOrders = data.orders.filter((order) => order.tailor_profile_id === data.tailorProfile?.id || order.tailor_id === data.userId)
  const activeOrders = tailorOrders.filter((order) => !isTerminalOrder(order))
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-4">
        <SummaryLine label="Active" value={`${activeOrders.length}`} />
        <SummaryLine label="Profile" value={data.tailorProfile.is_live ? 'Live' : 'Not live'} />
        <SummaryLine label="Shop" value={`${data.sellerItems.filter((item) => item.is_live).length} live`} />
        <SummaryLine label="Payout" value={data.tailorProfile.payout_account_verified ? 'Ready' : 'Needs setup'} />
      </section>
      <section className="grid gap-4">
        {activeOrders.length === 0 ? (
          <EmptyState
            title="No active work right now."
            body="New custom briefs and ready-made orders will appear here when customers place them."
            action={<Link href="/account/shop" className="font-semibold text-needle">Review shop</Link>}
          />
        ) : (
          activeOrders.map((order) => (
            <div key={order.id} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">{cleanLabel(order.order_kind, 'Order')}</p>
                  <h2 className="mt-2 text-3xl text-ink">{orderTitle(order)}</h2>
                  <p className="mt-2 text-sm leading-6 text-ink/62">
                    {partyName(order, data.userId)} · {cleanLabel(order.stage, 'In progress')} · {orderAmount(order)}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                  <Link href={`/account/orders/${order.id}`} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                    View brief
                  </Link>
                  <a href="drape://" className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white">
                    Open actions in app
                  </a>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
                <SummaryLine label="Payment" value={cleanLabel(latestPayment(order.id, data.payments)?.status, 'Payment pending')} />
                <SummaryLine label="Updated" value={formatRelative(order.updated_at ?? order.created_at)} />
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function RenderCheckout({ data, orderId }: { data: AccountSurfaceData; orderId?: string }) {
  const order = data.orders.find((entry) => entry.id === orderId) ?? data.orders[0] ?? null
  if (!order) {
    return (
      <EmptyState
        title="No checkout-ready order loaded."
        body="Create or open an order in the app first. Web will then show payment state and hand off to secure mobile checkout."
        action={<Link href="/account/orders" className="font-semibold text-needle">View orders</Link>}
      />
    )
  }
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const confirmed = payments.some((payment) => ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? ''))

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{confirmed ? 'Payment confirmed' : 'Checkout needed'}</p>
        <h2 className="mt-3 text-4xl text-ink">{orderTitle(order)}</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          {confirmed
            ? 'This payment is recorded. Continue tracking production, handoff, and support from the order.'
            : 'Provider checkout stays in the app for launch so payment sheet, redirects, push, and order state remain tightly controlled.'}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SummaryLine label="Order total" value={orderAmount(order)} />
          <SummaryLine label="Provider" value={cleanLabel(order.payment_provider, 'Provider selected at checkout')} />
          <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
          <SummaryLine label="Status" value={cleanLabel(order.stage, 'In progress')} />
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a href="drape://" className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
            Continue in app
          </a>
          <Link href={`/account/orders/${order.id}`} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
            Back to order
          </Link>
        </div>
      </section>
      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <h2 className="text-3xl text-ink">Payment ledger</h2>
        <div className="mt-5 grid gap-3">
          {payments.length === 0 ? (
            <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No provider payment has been recorded yet. If you already paid, do not pay again; open support from the app.
            </p>
          ) : (
            payments.map((payment) => (
              <SummaryLine
                key={payment.id}
                label={cleanLabel(payment.phase, 'Payment')}
                value={`${formatMoney(payment.amount, payment.currency)} · ${cleanLabel(payment.status, 'Pending')}`}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export function AccountAppSurface({
  surface,
  orderId,
}: {
  surface: AccountSurface
  orderId?: string
}): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [data, setData] = useState<AccountSurfaceData>(emptyData)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return
      setSession(sessionData.session)
      if (!sessionData.session?.user.id) {
        setLoading(false)
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession?.user.id) {
        setData(emptyData)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id) return
    let active = true
    fetchAccountSurfaceData(session.user.id)
      .then((nextData) => {
        if (!active) return
        setData(nextData)
      })
      .catch(() => {
        if (!active) return
        setData({
          ...emptyData,
          userId: session.user.id,
          warning: 'Account data could not load. Refresh in a moment; your app data is still safe.',
        })
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [session?.user.id])

  const content = useMemo(() => {
    switch (surface) {
      case 'explore':
        return <RenderExplore data={data} />
      case 'orders':
        return <RenderOrders data={data} />
      case 'order-detail':
        return <RenderOrderDetail data={data} orderId={orderId} />
      case 'messages':
        return <RenderMessages data={data} />
      case 'measurements':
        return <RenderMeasurements data={data} />
      case 'shop':
        return <RenderShop data={data} />
      case 'work':
        return <RenderWork data={data} />
      case 'checkout':
        return <RenderCheckout data={data} orderId={orderId} />
      default:
        return null
    }
  }, [data, orderId, surface])

  if (loading || (session?.user.id && data.userId !== session.user.id)) return <LoadingCard />
  if (!session) return <AuthRequiredCard />

  return (
    <AccountRouteShell session={session} data={data} surface={surface}>
      {content}
    </AccountRouteShell>
  )
}
