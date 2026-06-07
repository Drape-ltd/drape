'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { CONTACTS } from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { createClient } from '../lib/supabase'
import { safeEntityName, safeUserText } from '../lib/safe-display'

type StripeCardElement = {
  mount: (element: HTMLElement) => void
  unmount: () => void
  destroy?: () => void
}

type StripeElements = {
  create: (type: 'card', options?: Record<string, unknown>) => StripeCardElement
}

type StripePaymentIntent = {
  id?: string
  status?: string
}

type StripeJs = {
  elements: (options?: Record<string, unknown>) => StripeElements
  confirmCardPayment: (
    clientSecret: string,
    options: { payment_method: { card: StripeCardElement } },
  ) => Promise<{ error?: { message?: string }; paymentIntent?: StripePaymentIntent }>
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs | null
  }
}

type AccountSurface =
  | 'explore'
  | 'orders'
  | 'order-detail'
  | 'messages'
  | 'measurements'
  | 'shop'
  | 'work'
  | 'checkout'
  | 'saved'
  | 'settings'
  | 'support'
  | 'tailor-detail'
  | 'item-detail'

type JoinedProfile = {
  id?: string | null
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
  garment_description: string | null
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
  video_call_url?: string | null
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
  sender_role?: string | null
  sender_name?: string | null
  type: string | null
  body: string | null
  photo_url: string | null
  voice_url: string | null
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

type ProductionEvidence = {
  id: string
  order_id: string
  stage_key: string | null
  note: string | null
  photo_urls: string[] | null
  created_at: string | null
}

type CustomerProfile = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
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
  measurements?: Record<string, unknown> | null
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
  size_inventory?: Record<string, number> | null
  price_amount: number | null
  currency: string | null
  photo_urls: string[] | null
  stock_status: string | null
  inventory_quantity?: number | null
  size_guide?: Record<string, unknown> | null
  is_live: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  updated_at: string | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
}

type WishlistCollection = {
  id: string
  name: string | null
  cover_image_url: string | null
  item_count: number | null
  created_at: string | null
  updated_at: string | null
}

type WishlistItem = {
  id: string
  collection_id: string
  item_type: 'TAILOR' | 'READY_MADE_ITEM' | string
  tailor_id: string | null
  ready_made_item_id: string | null
  note: string | null
  created_at: string | null
}

type TailorReview = {
  id: string
  tailor_profile_id: string | null
  rating: number | null
  body: string | null
  tags: string[] | null
  reviewer_name: string | null
  tailor_response?: string | null
  created_at: string | null
  published_at: string | null
}

type MaterialAdvance = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  requested_by: string | null
  title: string | null
  description: string | null
  amount: number | null
  currency: string | null
  status: string | null
  release_status: string | null
  estimate_photo_url?: string | null
  receipt_url?: string | null
  receipt_note?: string | null
  customer_response_note?: string | null
  payment_provider?: string | null
  provider_checkout_url?: string | null
  payment_id?: string | null
  created_at: string | null
  updated_at: string | null
}

type AccountSurfaceData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  orders: AccountOrder[]
  payments: AccountPayment[]
  messages: AccountMessage[]
  stageUpdates: StageUpdate[]
  productionEvidence: ProductionEvidence[]
  materialAdvances: MaterialAdvance[]
  measurementProfiles: MeasurementProfile[]
  measurementScans: MeasurementScan[]
  sellerItems: SellerItem[]
  exploreTailors: TailorProfile[]
  exploreItems: SellerItem[]
  wishlistCollections: WishlistCollection[]
  wishlistItems: WishlistItem[]
  savedTailors: TailorProfile[]
  savedItems: SellerItem[]
  tailorDetail: TailorProfile | null
  tailorDetailItems: SellerItem[]
  tailorReviews: TailorReview[]
  itemDetail: SellerItem | null
  warning: string | null
}

const emptyData: AccountSurfaceData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  orders: [],
  payments: [],
  messages: [],
  stageUpdates: [],
  productionEvidence: [],
  materialAdvances: [],
  measurementProfiles: [],
  measurementScans: [],
  sellerItems: [],
  exploreTailors: [],
  exploreItems: [],
  wishlistCollections: [],
  wishlistItems: [],
  savedTailors: [],
  savedItems: [],
  tailorDetail: null,
  tailorDetailItems: [],
  tailorReviews: [],
  itemDetail: null,
  warning: null,
}

const surfaceCopy: Record<AccountSurface, { eyebrow: string; title: string; body: string }> = {
  explore: {
    eyebrow: 'Explore',
    title: 'Find tailors and ready-made pieces.',
    body: 'Browse the same live marketplace records used by the app. Web supports ready-made checkout, order review, messages, and safe app handoffs where native capture is needed.',
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
    body: 'Review and reply inside real order threads. Web blocks off-platform contact sharing and keeps calls tied to the order record.',
  },
  measurements: {
    eyebrow: 'Measurements',
    title: 'Fit records you can trust.',
    body: 'Named wearer profiles, Drape Vision scans, manual profiles, and measurement age all stay visible before ordering.',
  },
  shop: {
    eyebrow: 'Shop',
    title: 'Ready-made inventory without the noise.',
    body: 'Tailors can create launch-ready pieces on web. Customers can review stock, fit guidance, and begin checkout from the item detail.',
  },
  work: {
    eyebrow: 'Work queue',
    title: 'Tailor actions, organized by urgency.',
    body: 'Review active production, customer context, payment state, quotes, stage progress, and safe next actions from web.',
  },
  checkout: {
    eyebrow: 'Checkout handoff',
    title: 'Secure checkout with clear payment state.',
    body: 'Web prepares provider checkout, reuses processing attempts to avoid duplicate charges, and keeps the exact order state visible.',
  },
  saved: {
    eyebrow: 'Saved',
    title: 'Wishlists, saved tailors, and pieces.',
    body: 'Saved records from the app stay visible on web so event planning, repeat orders, and ready-made browsing do not get lost.',
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Account settings without guesswork.',
    body: 'Review profile, currency, notifications, login security, privacy, support, and deletion routes from the same account.',
  },
  support: {
    eyebrow: 'Support',
    title: 'Get help with the right context.',
    body: 'Choose the issue type, include the order when possible, and keep payment, fit, delivery, and account questions routed clearly.',
  },
  'tailor-detail': {
    eyebrow: 'Tailor profile',
    title: 'Review the tailor before starting an order.',
    body: 'Portfolio, specialties, fulfillment, pricing, reviews, and ready-made pieces stay together before the app handoff.',
  },
  'item-detail': {
    eyebrow: 'Ready-made detail',
    title: 'Review the piece before checkout.',
    body: 'Images, size, stock, fit guidance, fulfillment, tailor context, and price stay focused on the ready-made purchase.',
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

function safeList(value: string[] | null | undefined, fallback = 'Not listed') {
  const cleaned = stringList(value)
    .map((entry) => safeUserText(entry))
    .filter(Boolean)
  return cleaned.length > 0 ? cleaned.join(', ') : fallback
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

function safeMediaUrl(src: string | null | undefined) {
  if (!src) return null
  if (src.startsWith('/') || src.startsWith('data:') || src.startsWith('blob:')) return src
  try {
    const url = new URL(src)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : ''
    if (supabaseHost && url.hostname === supabaseHost && url.pathname.startsWith('/storage/v1/object/public/')) {
      return src
    }
  } catch {
    return null
  }
  return null
}

function itemPhoto(item: SellerItem) {
  return stringList(item.photo_urls).map(safeMediaUrl).find(Boolean) ?? null
}

function tailorPhoto(tailor: TailorProfile) {
  return stringList(tailor.portfolio_photo_urls).map(safeMediaUrl).find(Boolean) ?? safeMediaUrl(tailor.avatar_url) ?? null
}

function hasMeasurements(profile: CustomerProfile | null) {
  return !!profile?.measurements && Object.keys(profile.measurements).length > 0
}

function fitPreferenceFromProfile(profile: CustomerProfile | null) {
  const measurements = profile?.measurements
  if (!measurements || typeof measurements !== 'object') return 'Fit preference not set'
  const candidate =
    measurements.fitPreference ??
    measurements.fit_style ??
    measurements.fitStyle ??
    measurements.fit
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? safeUserText(candidate, 'Fit preference saved')
    : 'Fit preference not set'
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

function productionEvidenceFor(orderId: string, evidence: ProductionEvidence[]) {
  return evidence.filter((item) => item.order_id === orderId)
}

function isVideoMediaUrl(src: string | null | undefined) {
  if (!src) return false
  try {
    const pathname = src.startsWith('blob:') || src.startsWith('data:')
      ? src
      : new URL(src).pathname
    return /\.(mp4|mov|m4v|webm|ogg)$/iu.test(pathname)
  } catch {
    return /\.(mp4|mov|m4v|webm|ogg)$/iu.test(src)
  }
}

function mediaFingerprint(file: File) {
  return [file.name, file.type, file.size, file.lastModified]
    .join(':')
    .replace(/\s+/g, '-')
    .slice(0, 240)
}

const tailorProfileSelect =
  'id, user_id, display_name, business_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, tier, availability, is_live, is_verified, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, portfolio_photo_urls, avatar_url, payout_account_verified'

const sellerItemSelect =
  'id, tailor_profile_id, title, description, category, sizes, size_inventory, price_amount, currency, photo_urls, stock_status, inventory_quantity, size_guide, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(id, display_name, business_name, avatar_url, location)'

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

function accountRoute(path: string): Route {
  return path as Route
}

function priceRange(tailor: TailorProfile) {
  if (typeof tailor.price_range_min !== 'number' && typeof tailor.price_range_max !== 'number') return 'Pricing set in quote'
  if (typeof tailor.price_range_min === 'number' && typeof tailor.price_range_max === 'number') {
    return `${formatMoney(tailor.price_range_min, tailor.currency)} - ${formatMoney(tailor.price_range_max, tailor.currency)}`
  }
  return formatMoney(tailor.price_range_min ?? tailor.price_range_max, tailor.currency)
}

function sizeGuideSummary(sizeGuide: Record<string, unknown> | null | undefined) {
  if (!sizeGuide || Object.keys(sizeGuide).length === 0) return 'Fit guidance continues in the app.'
  const keys = Object.keys(sizeGuide)
    .map((key) => safeUserText(key))
    .filter(Boolean)
    .slice(0, 4)
  return keys.length > 0 ? `Fit guide saved for ${keys.join(', ')}.` : 'Fit guide saved.'
}

function stockCopy(item: SellerItem) {
  if (typeof item.inventory_quantity === 'number') {
    if (item.inventory_quantity <= 0) return 'Sold out'
    if (item.inventory_quantity === 1) return '1 left'
    return `${item.inventory_quantity} left`
  }
  return cleanLabel(item.stock_status, 'Stock available')
}

function mailto(address: string, subject: string) {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`
}

function friendlyActionError(error: unknown, fallback = 'That action could not finish right now. Please try again.') {
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown; error?: unknown }).message ?? (error as { error?: unknown }).error
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.replace(/^FunctionsHttpError:\s*/i, '').trim()
    }
  }
  if (typeof error === 'string' && error.trim().length > 0) return error
  return fallback
}

async function invokeAccountFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = createClient()
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw new Error(friendlyActionError(error))
  const payload = (data ?? {}) as Record<string, unknown>
  const message = typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : null
  if (payload.error) throw new Error(message ?? 'That action could not finish right now. Please try again.')
  return payload as T
}

function assertNoContactLeak(value: string, fallback?: string) {
  const filtered = filterContactInfo(value)
  if (filtered.blocked) {
    return fallback ?? filtered.userMessage
  }
  return null
}

function splitList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseMinorUnits(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const amount = Number.parseFloat(cleaned)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function parseInventoryFromSizes(sizes: string[], inventoryValue: string) {
  const fallback = Number.parseInt(inventoryValue, 10)
  const count = Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  return Object.fromEntries(sizes.map((size, index) => [size, index === 0 ? count : 0]))
}

function isPayableOrder(order: AccountOrder) {
  if (order.order_kind === 'CUSTOM') {
    return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  if (order.order_kind === 'READY_MADE') {
    return ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  return false
}

function nextStageOptions(order: AccountOrder) {
  if (order.order_kind === 'READY_MADE') {
    if (order.stage === 'CONFIRMED') return ['FINISHING']
    if (order.stage === 'FINISHING') return order.delivery_method === 'LOCAL_COLLECTION'
      ? ['READY_FOR_COLLECTION']
      : ['READY_FOR_DRAPE_DISPATCH']
    return []
  }

  if (order.stage === 'CONFIRMED') return ['DESIGNING']
  if (order.stage === 'DESIGNING') return ['SOURCING', 'CUTTING']
  if (order.stage === 'SOURCING') return ['CUTTING']
  if (order.stage === 'CUTTING') return ['SEWING']
  if (order.stage === 'SEWING') return ['FINISHING']
  if (order.stage === 'FINISHING') return order.delivery_method === 'LOCAL_COLLECTION'
    ? ['READY_FOR_COLLECTION']
    : ['READY_FOR_DRAPE_DISPATCH']
  return []
}

function datetimeLocalToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function uploadPublicFile(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const filePath = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error('The image could not upload. Try a smaller clothing or product photo.')
  return supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl
}

let stripeScriptPromise: Promise<void> | null = null

function stripePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ??
    ''
  ).trim()
}

function loadStripeScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Stripe checkout needs a browser.'))
  if (window.Stripe) return Promise.resolve()
  if (!stripeScriptPromise) {
    stripeScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Stripe could not load.')), { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Stripe could not load.'))
      document.head.appendChild(script)
    })
  }
  return stripeScriptPromise
}

async function fetchAccountSurfaceData(
  userId: string,
  options: { tailorId?: string; itemId?: string } = {},
): Promise<AccountSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const [accountRes, customerProfileRes, tailorProfileRes, measurementProfilesRes, measurementScansRes, exploreTailorsRes] =
    await Promise.all([
      supabase
        .from('users')
        .select('default_currency')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('customer_profiles')
        .select('user_id, display_name, avatar_url, measurements, unit_preference, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('tailor_profiles')
        .select(tailorProfileSelect)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('customer_measurement_profiles')
        .select('id, label, relationship, source, unit_preference, measurements, is_default, last_measured_at, updated_at')
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
        .select(tailorProfileSelect)
        .eq('is_live', true)
        .order('avg_rating', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(12),
    ])

  if (
    accountRes.error ||
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
        id, reference, order_kind, garment_type, item_title, item_size, garment_description, occasion, stage, delivery_method,
        fabric_source, special_note, fabric_tracking, quoted_amount, subtotal_amount, fulfillment_fee, shipping_amount,
        tax_amount, platform_fee_amount, total_amount, currency, quoted_currency, created_at, updated_at, deadline,
        quoted_completion_date, customer_id, tailor_id, tailor_profile_id, seller_item_id, payment_provider,
        video_call_url, escrow_released, auto_release_at, collection_code_used,
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
  let productionEvidence: ProductionEvidence[] = []
  let materialAdvances: MaterialAdvance[] = []

  if (orderIds.length > 0) {
    const [paymentsRes, messagesRes, stageUpdatesRes, productionEvidenceRes, materialAdvancesRes] = await Promise.all([
      supabase
        .from('order_payments')
        .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('messages')
        .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, blocked, read_at, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('order_stage_updates')
        .select('id, order_id, stage, note, photo_url, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('order_production_evidence')
        .select('id, order_id, stage_key, note, photo_urls, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('order_material_advances')
        .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, receipt_note, customer_response_note, payment_provider, provider_checkout_url, payment_id, created_at, updated_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(60),
    ])

    if (paymentsRes.error || messagesRes.error || stageUpdatesRes.error || productionEvidenceRes.error || materialAdvancesRes.error) {
      warning = 'Some order activity could not load. Refresh in a moment; your app data is still safe.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
      messages = (messagesRes.data ?? []) as AccountMessage[]
      stageUpdates = (stageUpdatesRes.data ?? []) as StageUpdate[]
      productionEvidence = (productionEvidenceRes.data ?? []) as ProductionEvidence[]
      materialAdvances = (materialAdvancesRes.data ?? []) as MaterialAdvance[]
    }
  }

  let sellerItems: SellerItem[] = []
  if (tailorProfile?.id) {
    const sellerItemsRes = await supabase
      .from('seller_items')
      .select(sellerItemSelect)
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
    .select(sellerItemSelect)
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

  let wishlistCollections: WishlistCollection[] = []
  let wishlistItems: WishlistItem[] = []
  let savedTailors: TailorProfile[] = []
  let savedItems: SellerItem[] = []

  const wishlistCollectionsRes = await supabase
    .from('wishlist_collections')
    .select('id, name, cover_image_url, item_count, created_at, updated_at')
    .eq('customer_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (wishlistCollectionsRes.error) {
    warning = warning ?? 'Saved records could not load. Refresh in a moment; your app data is still safe.'
  } else {
    wishlistCollections = (wishlistCollectionsRes.data ?? []) as WishlistCollection[]
    const collectionIds = wishlistCollections.map((collection) => collection.id)
    if (collectionIds.length > 0) {
      const wishlistItemsRes = await supabase
        .from('wishlist_items')
        .select('id, collection_id, item_type, tailor_id, ready_made_item_id, note, created_at')
        .in('collection_id', collectionIds)
        .order('created_at', { ascending: false })
        .limit(120)

      if (wishlistItemsRes.error) {
        warning = warning ?? 'Wishlist items could not load. Refresh in a moment; your app data is still safe.'
      } else {
        wishlistItems = (wishlistItemsRes.data ?? []) as WishlistItem[]
        const savedTailorIds = uniqueValues(wishlistItems.map((item) => item.tailor_id))
        const savedItemIds = uniqueValues(wishlistItems.map((item) => item.ready_made_item_id))

        if (savedTailorIds.length > 0) {
          const savedTailorsRes = await supabase
            .from('tailor_profiles')
            .select(tailorProfileSelect)
            .in('id', savedTailorIds)
            .limit(80)
          if (savedTailorsRes.error) {
            warning = warning ?? 'Saved tailors could not load. Refresh in a moment.'
          } else {
            savedTailors = (savedTailorsRes.data ?? []) as TailorProfile[]
          }
        }

        if (savedItemIds.length > 0) {
          const savedItemsRes = await supabase
            .from('seller_items')
            .select(sellerItemSelect)
            .in('id', savedItemIds)
            .limit(80)
          if (savedItemsRes.error) {
            warning = warning ?? 'Saved ready-made items could not load. Refresh in a moment.'
          } else {
            savedItems = (savedItemsRes.data ?? []) as SellerItem[]
          }
        }
      }
    }
  }

  let tailorDetail: TailorProfile | null = null
  let tailorDetailItems: SellerItem[] = []
  let tailorReviews: TailorReview[] = []
  if (options.tailorId) {
    const [tailorDetailRes, tailorItemsRes, tailorReviewsRes] = await Promise.all([
      supabase.from('tailor_profiles').select(tailorProfileSelect).eq('id', options.tailorId).maybeSingle(),
      supabase
        .from('seller_items')
        .select(sellerItemSelect)
        .eq('tailor_profile_id', options.tailorId)
        .order('updated_at', { ascending: false })
        .limit(18),
      supabase
        .from('reviews')
        .select('id, tailor_profile_id, rating, body, tags, reviewer_name, tailor_response, created_at, published_at')
        .eq('tailor_profile_id', options.tailorId)
        .not('published_at', 'is', null)
        .eq('flagged', false)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    if (tailorDetailRes.error) {
      warning = warning ?? 'Tailor profile could not load. Refresh in a moment.'
    } else {
      tailorDetail = (tailorDetailRes.data ?? null) as TailorProfile | null
    }
    if (!tailorItemsRes.error) {
      tailorDetailItems = (tailorItemsRes.data ?? []) as SellerItem[]
    }
    if (!tailorReviewsRes.error) {
      tailorReviews = (tailorReviewsRes.data ?? []) as TailorReview[]
    }
  }

  let itemDetail: SellerItem | null = null
  if (options.itemId) {
    const itemDetailRes = await supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('id', options.itemId)
      .maybeSingle()

    if (itemDetailRes.error) {
      warning = warning ?? 'Ready-made item could not load. Refresh in a moment.'
    } else {
      itemDetail = (itemDetailRes.data ?? null) as SellerItem | null
    }
  }

  return {
    userId,
    accountCurrency: accountRes.error ? null : ((accountRes.data as { default_currency?: string | null } | null)?.default_currency ?? null),
    customerProfile: customerProfileRes.error ? null : ((customerProfileRes.data ?? null) as CustomerProfile | null),
    tailorProfile,
    orders,
    payments,
    messages,
    stageUpdates,
    productionEvidence,
    materialAdvances,
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfile[]),
    measurementScans: measurementScansRes.error ? [] : ((measurementScansRes.data ?? []) as MeasurementScan[]),
    sellerItems,
    exploreTailors: exploreTailorsRes.error ? [] : ((exploreTailorsRes.data ?? []) as TailorProfile[]),
    exploreItems,
    wishlistCollections,
    wishlistItems,
    savedTailors,
    savedItems,
    tailorDetail,
    tailorDetailItems,
    tailorReviews,
    itemDetail,
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
    ['Saved', '/account/saved'],
    ['Orders', '/account/orders'],
    ['Messages', '/account/messages'],
    ['Measurements', '/account/measurements'],
    ['Settings', '/account/settings'],
    ['Support', '/account/support'],
  ]
  if (role === 'TAILOR' || data.tailorProfile) {
    links.push(['Shop', '/account/shop'], ['Work', '/account/work'])
  }
  const activeHref =
    surface === 'order-detail'
      ? '/account/orders'
      : surface === 'tailor-detail'
        ? '/account/explore'
        : surface === 'item-detail'
          ? data.tailorProfile
            ? '/account/shop'
            : '/account/explore'
          : `/account/${surface}`

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
                    href === activeHref
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
              Same identity as mobile. Open the app for Drape Vision capture, native push permission, and device camera guidance.
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
  const safeSrc = safeMediaUrl(src)
  if (!safeSrc) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-[1.15rem] bg-needle/10 text-sm font-semibold text-needle">
        {label}
      </div>
    )
  }
  if (isVideoMediaUrl(safeSrc)) {
    return (
      <video
        src={safeSrc}
        controls
        preload="metadata"
        className="aspect-[4/3] w-full rounded-[1.15rem] bg-ink object-cover"
        aria-label={label}
      />
    )
  }
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.15rem]">
      <Image
        src={safeSrc}
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

function ActionNotice({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) return null
  return (
    <p className={`rounded-[1rem] px-4 py-3 text-sm leading-6 ${error ? 'border border-rust/20 bg-rust/8 text-ink' : 'border border-needle/14 bg-needle/8 text-needle'}`}>
      {error || success}
    </p>
  )
}

function StripeCardAuthorization({
  clientSecret,
  label,
  submitLabel,
  onConfirm,
  onDone,
}: {
  clientSecret: string
  label: string
  submitLabel: string
  onConfirm: (paymentIntentId: string) => Promise<void>
  onDone: () => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeJs | null>(null)
  const cardRef = useRef<StripeCardElement | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let mountedCard: StripeCardElement | null = null

    async function mountCard() {
      setReady(false)
      setError(null)
      const publishableKey = stripePublishableKey()
      if (!publishableKey) {
        setError('Stripe web checkout needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.')
        return
      }
      try {
        await loadStripeScript()
        if (!active || !window.Stripe || !mountRef.current) return
        const stripe = window.Stripe(publishableKey)
        if (!stripe) {
          setError('Stripe checkout could not initialize.')
          return
        }
        const elements = stripe.elements()
        const card = elements.create('card', {
          hidePostalCode: true,
          style: {
            base: {
              color: '#1d1d1b',
              fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '16px',
              '::placeholder': { color: '#8b8a83' },
            },
            invalid: { color: '#d9542f' },
          },
        })
        card.mount(mountRef.current)
        stripeRef.current = stripe
        cardRef.current = card
        mountedCard = card
        if (active) setReady(true)
      } catch (mountError) {
        if (active) setError(friendlyActionError(mountError, 'Stripe checkout could not load.'))
      }
    }

    void mountCard()

    return () => {
      active = false
      setReady(false)
      mountedCard?.unmount()
      mountedCard?.destroy?.()
      if (cardRef.current === mountedCard) cardRef.current = null
      stripeRef.current = null
    }
  }, [clientSecret])

  async function confirmCard() {
    setError(null)
    setSuccess(null)
    const stripe = stripeRef.current
    const card = cardRef.current
    if (!stripe || !card) {
      setError('Stripe checkout is still loading.')
      return
    }
    setBusy(true)
    try {
      const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } })
      if (result.error) {
        setError(result.error.message ?? 'Card authorization failed. Check the card details and try again.')
        return
      }
      const paymentIntentId = result.paymentIntent?.id
      if (!paymentIntentId) {
        setError('Stripe authorized the card but did not return a payment reference.')
        return
      }
      await onConfirm(paymentIntentId)
      setSuccess('Payment confirmed. The order record is updating now.')
      onDone()
    } catch (confirmError) {
      setError(friendlyActionError(confirmError, 'Payment could not be confirmed. Refresh the order before trying again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-[1.1rem] border border-ink/8 bg-white p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/72">Stripe card</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">{label}</h3>
      </div>
      <div ref={mountRef} className="min-h-12 rounded-full border border-ink/10 bg-bone px-4 py-3" />
      <ActionNotice error={error} success={success} />
      <button type="button" onClick={confirmCard} disabled={busy || !ready} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
        {busy ? 'Confirming...' : ready ? submitLabel : 'Loading Stripe...'}
      </button>
      <p className="text-xs leading-5 text-ink/52">Card details are handled by Stripe. Drapeon never sees or stores the card number.</p>
    </div>
  )
}

function CheckoutAction({ order, onRefresh }: { order: AccountOrder; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [stripePayment, setStripePayment] = useState<{
    clientSecret: string
    paymentIntentId?: string | null
    amount?: number | null
    currency?: string | null
  } | null>(null)

  async function handleCheckout() {
    setBusy(true)
    setError(null)
    setStripePayment(null)
    setSuccess('Preparing payment. Do not start another checkout while this finishes.')
    try {
      const result = await invokeAccountFunction<{
        ok?: boolean
        confirmed?: boolean
        alreadyPaid?: boolean
        provider?: string
        authorizationUrl?: string | null
        clientSecret?: string | null
        paymentIntentId?: string | null
        amount?: number
        currency?: string
      }>('payment-action', { action: 'prepare-payment', orderId: order.id })

      onRefresh()
      if (result.confirmed || result.alreadyPaid) {
        setSuccess('Payment is already confirmed on this order.')
        return
      }
      if (result.authorizationUrl) {
        setSuccess('Payment is ready. Redirecting to the secure provider checkout.')
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.provider === 'STRIPE' && result.clientSecret) {
        setStripePayment({
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId ?? null,
          amount: result.amount ?? null,
          currency: result.currency ?? null,
        })
        setSuccess('Card payment is ready. Enter card details below; Drapeon will not create a duplicate charge.')
        return
      }
      setSuccess('Payment is prepared. Open the app if the provider window does not appear.')
    } catch (checkoutError) {
      setError(friendlyActionError(checkoutError, 'Payment could not start cleanly. Please refresh the order and try again.'))
      setSuccess(null)
    } finally {
      setBusy(false)
    }
  }

  if (!isPayableOrder(order)) {
    return (
      <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is not awaiting a customer payment right now.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <button
        type="button"
        onClick={handleCheckout}
        disabled={busy}
        className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
      >
        {busy ? 'Preparing checkout...' : 'Start secure checkout'}
      </button>
      {stripePayment ? (
        <StripeCardAuthorization
          clientSecret={stripePayment.clientSecret}
          label={formatMoney(
            stripePayment.amount ?? order.total_amount ?? order.quoted_amount,
            stripePayment.currency ?? order.currency ?? order.quoted_currency,
          )}
          submitLabel="Authorize card"
          onConfirm={async (paymentIntentId) => {
            await invokeAccountFunction('payment-action', {
              action: 'confirm-payment',
              orderId: order.id,
              paymentIntentId,
            })
          }}
          onDone={() => {
            setStripePayment(null)
            onRefresh()
          }}
        />
      ) : null}
      <p className="text-xs leading-5 text-ink/52">
        If checkout is already processing, Drapeon will reuse the current attempt instead of creating a duplicate charge.
      </p>
    </div>
  )
}

function MessageComposer({ order, onRefresh }: { order: AccountOrder; onRefresh: () => void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [callBusy, setCallBusy] = useState<string | null>(null)
  const [callTime, setCallTime] = useState('')
  const [callReason, setCallReason] = useState('OTHER')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const canMessage = !isTerminalOrder(order)
  const isReadyMade = order.order_kind === 'READY_MADE'

  async function sendMessage() {
    const trimmed = body.trim()
    setError(null)
    setSuccess(null)
    if (!trimmed) {
      setError('Write a message before sending.')
      return
    }
    const leak = assertNoContactLeak(trimmed)
    if (leak) {
      setError(leak)
      return
    }
    setBusy(true)
    try {
      await invokeAccountFunction('message-action', {
        action: 'send-message',
        orderId: order.id,
        type: 'TEXT',
        body: trimmed,
      })
      setBody('')
      setSuccess('Message sent inside the protected order thread.')
      onRefresh()
    } catch (messageError) {
      setError(friendlyActionError(messageError, 'Message could not send. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function scheduleReadyMadeCall() {
    const scheduledStartAt = datetimeLocalToIso(callTime)
    setError(null)
    setSuccess(null)
    if (!scheduledStartAt) {
      setError('Choose a valid call time.')
      return
    }
    setCallBusy('schedule')
    try {
      await invokeAccountFunction('order-call-action', {
        action: 'schedule-ready-made-call',
        orderId: order.id,
        scheduledStartAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reason: callReason,
      })
      setSuccess('Ready-made clarification call scheduled. Both sides will see it in Messages.')
      onRefresh()
    } catch (callError) {
      setError(friendlyActionError(callError, 'Call could not be scheduled. Please try again.'))
    } finally {
      setCallBusy(null)
    }
  }

  async function startCall(callType: 'audio' | 'video') {
    setError(null)
    setSuccess(null)
    setCallBusy(callType)
    try {
      const result = await invokeAccountFunction<{ url?: string | null; fallback?: string; message?: string }>('create-order-call-room', {
        orderId: order.id,
        callType,
      })
      onRefresh()
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer')
        setSuccess(`Drape ${callType} call opened in a new tab.`)
        return
      }
      setSuccess(result.message ?? 'Calling is unavailable right now. Continue in Messages so the order record stays protected.')
    } catch (callError) {
      setError(friendlyActionError(callError, 'Call could not start right now. Keep the conversation in Messages.'))
    } finally {
      setCallBusy(null)
    }
  }

  if (!canMessage) {
    return (
      <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is closed, so the web thread is read-only.
      </p>
    )
  }

  return (
    <div className="grid gap-4 rounded-[1.2rem] border border-ink/8 bg-white p-4">
      <ActionNotice error={error} success={success} />
      <label className="grid gap-2">
        <span className="text-sm font-semibold text-ink">Reply</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={2000}
          className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
          placeholder="Keep order decisions, fit notes, and timing inside Drapeon."
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={sendMessage}
          disabled={busy}
          className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          {busy ? 'Sending...' : 'Send message'}
        </button>
        <button
          type="button"
          onClick={() => startCall('audio')}
          disabled={!!callBusy}
          className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38"
        >
          {callBusy === 'audio' ? 'Opening...' : 'Audio call'}
        </button>
        <button
          type="button"
          onClick={() => startCall('video')}
          disabled={!!callBusy}
          className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38"
        >
          {callBusy === 'video' ? 'Opening...' : 'Video call'}
        </button>
      </div>
      {isReadyMade ? (
        <div className="grid gap-3 border-t border-ink/6 pt-4 md:grid-cols-[1fr_0.65fr_auto] md:items-end">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Schedule ready-made call</span>
            <input
              type="datetime-local"
              value={callTime}
              onChange={(event) => setCallTime(event.target.value)}
              className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Reason</span>
            <select
              value={callReason}
              onChange={(event) => setCallReason(event.target.value)}
              className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
            >
              <option value="SIZE_OR_FIT">Size or fit</option>
              <option value="ITEM_CONDITION">Item condition</option>
              <option value="PICKUP_OR_DELIVERY">Pickup or delivery</option>
              <option value="TIMELINE">Timing</option>
              <option value="OTHER">Order clarity</option>
            </select>
          </label>
          <button
            type="button"
            onClick={scheduleReadyMadeCall}
            disabled={!!callBusy}
            className="inline-flex justify-center rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
          >
            {callBusy === 'schedule' ? 'Scheduling...' : 'Schedule'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ManualMeasurementEditor({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('Me')
  const [relationship, setRelationship] = useState('SELF')
  const [unit, setUnit] = useState('in')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fieldNames = ['height', 'chest', 'waist', 'hips', 'shoulder', 'sleeve', 'inseam']

  function startEdit(profile: MeasurementProfile) {
    const nextMeasurements = profile.measurements ?? {}
    setEditingId(profile.id)
    setLabel(profile.label ?? 'Me')
    setRelationship(profile.relationship ?? 'SELF')
    setUnit(profile.unit_preference ?? 'in')
    setFields(Object.fromEntries(fieldNames.map((field) => {
      const value = nextMeasurements[field]
      return [field, typeof value === 'number' || typeof value === 'string' ? String(value) : '']
    })))
    setError(null)
    setSuccess(null)
  }

  function resetForm() {
    setEditingId(null)
    setLabel('Me')
    setRelationship('SELF')
    setUnit('in')
    setFields({})
  }

  async function saveProfile() {
    setError(null)
    setSuccess(null)
    if (!data.userId) return
    const labelLeak = assertNoContactLeak(label, "Measurement profile names can't include contact details.")
    if (labelLeak) {
      setError(labelLeak)
      return
    }
    const measurements = Object.fromEntries(
      fieldNames
        .map((field) => [field, Number.parseFloat(fields[field] ?? '')] as const)
        .filter(([, value]) => Number.isFinite(value) && value > 0),
    )
    if (Object.keys(measurements).length < 4) {
      setError('Add at least height, chest, waist, and hips before saving a profile.')
      return
    }
    setBusy(true)
    const supabase = createClient()
    const payload = {
      label: label.trim(),
      relationship,
      unit_preference: unit,
      source: 'MANUAL',
      measurements,
      last_measured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const result = editingId
      ? await supabase.from('customer_measurement_profiles').update(payload).eq('id', editingId)
      : await supabase.from('customer_measurement_profiles').insert({
          ...payload,
          customer_id: data.userId,
          is_default: data.measurementProfiles.length === 0,
        })
    setBusy(false)
    if (result.error) {
      setError('Measurements could not save. Please refresh and try again.')
      return
    }
    setSuccess(editingId ? 'Measurement profile updated.' : 'Measurement profile saved.')
    resetForm()
    onRefresh()
  }

  return (
    <div className="grid gap-4 rounded-[1.4rem] border border-needle/12 bg-needle/8 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Manual profile</p>
        <h3 className="mt-2 text-2xl text-ink">{editingId ? 'Update wearer measurements' : 'Add wearer measurements'}</h3>
      </div>
      <ActionNotice error={error} success={success} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-ink">Profile name</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-ink">Wearer</span>
          <select value={relationship} onChange={(event) => setRelationship(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
            <option value="SELF">Me</option>
            <option value="BUYER">Buyer</option>
            <option value="NAMED_OTHER">Someone else</option>
            <option value="GROUP">Group member</option>
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-ink">Unit</span>
          <select value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
            <option value="in">Inches</option>
            <option value="cm">Centimetres</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fieldNames.map((field) => (
          <label key={field} className="grid gap-2">
            <span className="text-sm font-semibold capitalize text-ink">{field}</span>
            <input
              inputMode="decimal"
              value={fields[field] ?? ''}
              onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))}
              className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={saveProfile} disabled={busy} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy ? 'Saving...' : editingId ? 'Update profile' : 'Save profile'}
        </button>
        {editingId ? (
          <button type="button" onClick={resetForm} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
            Cancel edit
          </button>
        ) : null}
      </div>
      {data.measurementProfiles.length > 0 ? (
        <div className="grid gap-2 border-t border-needle/12 pt-4">
          {data.measurementProfiles.map((profile) => (
            <button key={profile.id} type="button" onClick={() => startEdit(profile)} className="rounded-[1rem] border border-ink/6 bg-white px-4 py-3 text-left text-sm font-semibold text-ink">
              Edit {safeUserText(profile.label, 'measurement profile')}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SellerItemManager({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(data.tailorProfile?.currency ?? 'USD')
  const [sizes, setSizes] = useState('M')
  const [inventory, setInventory] = useState('1')
  const [fitGuide, setFitGuide] = useState('')
  const [fulfillment, setFulfillment] = useState({ pickup: true, delivery: false, shipping: false })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [publish, setPublish] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function saveItem() {
    setError(null)
    setSuccess(null)
    if (!data.userId || !data.tailorProfile?.id) return
    const textToCheck = [title, category, description, fitGuide].filter(Boolean).join('\n')
    const leak = assertNoContactLeak(textToCheck, "Ready-made listings can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    const priceAmount = parseMinorUnits(price)
    const nextSizes = splitList(sizes)
    if (!title.trim() || !category.trim() || !description.trim() || !priceAmount || nextSizes.length === 0) {
      setError('Add title, category, description, price, and at least one size.')
      return
    }
    setBusy(true)
    try {
      const photoUrls = photoFile
        ? [await uploadPublicFile('seller-item-media', data.userId, photoFile)]
        : []
      const sizeInventory = parseInventoryFromSizes(nextSizes, inventory)
      await invokeAccountFunction('seller-item-action', {
        action: 'create-item',
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        sizes: nextSizes,
        sizeInventory,
        priceAmount,
        currency,
        photoUrls,
        inventoryQuantity: Object.values(sizeInventory).reduce((sum, value) => sum + value, 0),
        sizeGuide: fitGuide.trim()
          ? { unit: 'in', notes: fitGuide.trim(), sizes: nextSizes }
          : null,
        pickupAvailable: fulfillment.pickup,
        deliveryAvailable: fulfillment.delivery,
        shippingAvailable: fulfillment.shipping,
        isLive: publish,
      })
      setSuccess(publish ? 'Ready-made item saved and publish checks passed.' : 'Ready-made draft saved.')
      setTitle('')
      setCategory('')
      setDescription('')
      setPrice('')
      setSizes('M')
      setInventory('1')
      setFitGuide('')
      setPhotoFile(null)
      setPublish(false)
      onRefresh()
    } catch (itemError) {
      setError(friendlyActionError(itemError, 'Ready-made item could not save. Check required fields and try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!data.tailorProfile) return null

  return (
    <section className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Shop action</p>
          <h2 className="mt-2 text-3xl text-ink">Create ready-made listing</h2>
        </div>
        <p className="text-sm leading-6 text-ink/62">Live publish checks photos, sizes, stock, fit guide, fulfillment, and payout readiness.</p>
      </div>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Category</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-ink">Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
        </label>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Price</span>
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Currency</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Sizes</span>
            <input value={sizes} onChange={(event) => setSizes(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Stock</span>
            <input inputMode="numeric" value={inventory} onChange={(event) => setInventory(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-ink">Fit guide</span>
          <input value={fitGuide} onChange={(event) => setFitGuide(event.target.value)} placeholder="Example: relaxed fit, best for 38-40 inch chest" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
        </label>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Product photo</span>
            <input type="file" accept="image/*" capture="environment" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink" />
            <span className="text-xs leading-5 text-ink/52">On iPad or mobile, take a fresh garment photo or choose one from your library.</span>
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Fulfillment</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                { key: 'pickup', label: 'Pickup' },
                { key: 'delivery', label: 'Delivery' },
                { key: 'shipping', label: 'Shipping' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center justify-center gap-2 rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={fulfillment[key]}
                    onChange={(event) => setFulfillment((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm font-semibold text-ink">
          <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
          Publish after preflight
        </label>
        <button type="button" onClick={saveItem} disabled={busy} className="inline-flex w-full justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20 sm:w-auto">
          {busy ? 'Saving...' : publish ? 'Save and publish' : 'Save draft'}
        </button>
      </div>
    </section>
  )
}

function TailorOrderActions({ order, data, onRefresh }: { order: AccountOrder; data: AccountSurfaceData; onRefresh: () => void }) {
  const [quoteAmount, setQuoteAmount] = useState('')
  const [quoteCurrency, setQuoteCurrency] = useState(order.currency ?? data.tailorProfile?.currency ?? 'USD')
  const [completionDate, setCompletionDate] = useState('')
  const [quoteNote, setQuoteNote] = useState('')
  const [targetStage, setTargetStage] = useState(nextStageOptions(order)[0] ?? '')
  const [stageNote, setStageNote] = useState('')
  const [stageMediaFiles, setStageMediaFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const isTailor = !!data.tailorProfile && (order.tailor_profile_id === data.tailorProfile.id || order.tailor_id === data.userId)
  const stageOptions = nextStageOptions(order)

  if (!isTailor || isTerminalOrder(order)) return null

  function addStageMedia(files: FileList | null) {
    if (!files?.length) return
    setStageMediaFiles((current) => [...current, ...Array.from(files)].slice(0, 6))
  }

  async function sendQuote() {
    const amount = parseMinorUnits(quoteAmount)
    const dateIso = completionDate ? new Date(completionDate).toISOString() : null
    const leak = assertNoContactLeak(quoteNote, "Quote notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!amount || !dateIso) {
      setError('Add a quote amount and completion date.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    setBusy('quote')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action: 'send-quote',
        orderId: order.id,
        amount,
        currency: quoteCurrency,
        completionDate: dateIso,
        note: quoteNote.trim() || undefined,
      })
      setSuccess('Quote sent to the customer.')
      onRefresh()
    } catch (quoteError) {
      setError(friendlyActionError(quoteError, 'Quote could not be sent. Check the order state and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function advanceStage() {
    const leak = assertNoContactLeak(stageNote, "Stage notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!targetStage || stageNote.trim().length < 10) {
      setError('Choose the next stage and add a clear note.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    setBusy('stage')
    try {
      const selectedFiles = stageMediaFiles.slice(0, 6)
      const photoUrls = await Promise.all(
        selectedFiles.map((file) => uploadPublicFile('order-photos', `progress/${order.id}`, file)),
      )
      const mediaFingerprints = selectedFiles.map(mediaFingerprint)
      await invokeAccountFunction('tailor-order-action', {
        action: 'advance-stage',
        orderId: order.id,
        targetStage,
        note: stageNote.trim(),
        photoUrl: photoUrls[0],
        photoUrls,
        mediaFingerprints,
      })
      setStageNote('')
      setStageMediaFiles([])
      setSuccess('Stage updated and added to the order timeline.')
      onRefresh()
    } catch (stageError) {
      setError(friendlyActionError(stageError, 'Stage could not be updated. Check approval gates and try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor actions</p>
      <h2 className="mt-2 text-3xl text-ink">Work this order from web</h2>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '') ? (
          <div className="grid gap-3 rounded-[1.2rem] border border-ink/8 bg-white p-4">
            <h3 className="text-xl font-semibold text-ink">Send quote</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input inputMode="decimal" value={quoteAmount} onChange={(event) => setQuoteAmount(event.target.value)} placeholder="Amount" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <select value={quoteCurrency} onChange={(event) => setQuoteCurrency(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
              <input type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </div>
            <textarea value={quoteNote} onChange={(event) => setQuoteNote(event.target.value)} rows={2} placeholder="Optional quote note" className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={sendQuote} disabled={busy === 'quote'} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'quote' ? 'Sending...' : 'Send quote'}
            </button>
          </div>
        ) : null}
        {stageOptions.length > 0 ? (
          <div className="grid gap-3 rounded-[1.2rem] border border-ink/8 bg-white p-4">
            <h3 className="text-xl font-semibold text-ink">Update production stage</h3>
            <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
              <select value={targetStage} onChange={(event) => setTargetStage(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {stageOptions.map((stage) => <option key={stage} value={stage}>{cleanLabel(stage)}</option>)}
              </select>
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="inline-flex cursor-pointer justify-center rounded-full border border-needle/16 bg-needle/8 px-4 py-3 text-sm font-semibold text-needle">
                    Take fresh proof
                    <input
                      type="file"
                      accept="image/*,video/*"
                      capture="environment"
                      onChange={(event) => addStageMedia(event.target.files)}
                      className="sr-only"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink">
                    Attach media
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={(event) => addStageMedia(event.target.files)}
                      className="sr-only"
                    />
                  </label>
                </div>
                <p className="text-xs leading-5 text-ink/52">
                  Use fresh clothing proof. iPad and mobile browsers can open the camera here; desktop can attach photos or video.
                </p>
                {stageMediaFiles.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-bone px-3 py-1 text-xs font-semibold text-ink/62">
                      {stageMediaFiles.length} proof item{stageMediaFiles.length === 1 ? '' : 's'} selected
                    </span>
                    <button type="button" onClick={() => setStageMediaFiles([])} className="text-xs font-semibold text-needle">
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <textarea value={stageNote} onChange={(event) => setStageNote(event.target.value)} rows={2} placeholder="Tell the customer what changed" className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={advanceStage} disabled={busy === 'stage'} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'stage' ? 'Updating...' : 'Update stage'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function MaterialAdvancePanel({ order, data, onRefresh }: { order: AccountOrder; data: AccountSurfaceData; onRefresh: () => void }) {
  const advances = data.materialAdvances.filter((advance) => advance.order_id === order.id)
  const isTailor = order.tailor_id === data.userId
  const isCustomer = order.customer_id === data.userId
  const hasActiveAdvance = advances.some((advance) => ['REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW', 'BLOCKED'].includes(advance.status ?? ''))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(order.currency ?? order.quoted_currency ?? 'USD')
  const [responseNote, setResponseNote] = useState('')
  const [receiptNote, setReceiptNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [stripeAdvancePayment, setStripeAdvancePayment] = useState<{
    advanceId: string
    clientSecret: string
    amount?: number | null
    currency?: string | null
  } | null>(null)

  async function requestAdvance() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([title, description].join('\n'), "Material advance requests can't include contact details.")
    const parsedAmount = parseMinorUnits(amount)
    if (leak) {
      setError(leak)
      return
    }
    if (!title.trim() || description.trim().length < 10 || !parsedAmount) {
      setError('Add a title, clear reason, and valid amount.')
      return
    }
    setBusy('request')
    try {
      await invokeAccountFunction('material-advance-action', {
        action: 'request-advance',
        orderId: order.id,
        title: title.trim(),
        description: description.trim(),
        amount: parsedAmount,
        currency,
      })
      setTitle('')
      setDescription('')
      setAmount('')
      setSuccess('Material advance sent to the customer for approval.')
      onRefresh()
    } catch (advanceError) {
      setError(friendlyActionError(advanceError, 'Material advance could not be requested. Check payment state and amount limits.'))
    } finally {
      setBusy(null)
    }
  }

  async function respondAdvance(advance: MaterialAdvance, decision: 'APPROVE' | 'DECLINE') {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(responseNote, "Material advance responses can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    setBusy(`${decision}:${advance.id}`)
    try {
      await invokeAccountFunction('material-advance-action', {
        action: 'respond-advance',
        advanceId: advance.id,
        decision,
        note: responseNote.trim() || undefined,
      })
      setResponseNote('')
      setSuccess(decision === 'APPROVE' ? 'Material advance approved. Payment is now available.' : 'Material advance declined.')
      onRefresh()
    } catch (responseError) {
      setError(friendlyActionError(responseError, 'Material advance response could not save. Refresh and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function payAdvance(advance: MaterialAdvance) {
    setError(null)
    setSuccess(null)
    setStripeAdvancePayment(null)
    setBusy(`pay:${advance.id}`)
    try {
      const result = await invokeAccountFunction<{
        authorizationUrl?: string | null
        clientSecret?: string | null
        provider?: string | null
        amount?: number | null
        currency?: string | null
      }>('material-advance-action', {
        action: 'prepare-payment',
        advanceId: advance.id,
      })
      onRefresh()
      if (result.authorizationUrl) {
        setSuccess('Opening secure material advance checkout.')
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.clientSecret) {
        setStripeAdvancePayment({
          advanceId: advance.id,
          clientSecret: result.clientSecret,
          amount: result.amount ?? advance.amount,
          currency: result.currency ?? advance.currency,
        })
        setSuccess('Material advance card payment is ready. Enter card details below.')
        return
      }
      setSuccess('Material advance payment is processing. Do not start a duplicate payment.')
    } catch (paymentError) {
      setError(friendlyActionError(paymentError, 'Material advance payment could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function uploadReceipt(advance: MaterialAdvance) {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(receiptNote, "Receipt notes can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!receiptFile) {
      setError('Choose a receipt or supplier proof image first.')
      return
    }
    setBusy(`receipt:${advance.id}`)
    try {
      const receiptUrl = await uploadPublicFile('order-photos', `progress/${order.id}`, receiptFile)
      await invokeAccountFunction('material-advance-action', {
        action: 'upload-receipt',
        advanceId: advance.id,
        receiptUrl,
        note: receiptNote.trim() || undefined,
      })
      setReceiptFile(null)
      setReceiptNote('')
      setSuccess('Receipt proof saved for this material advance.')
      onRefresh()
    } catch (receiptError) {
      setError(friendlyActionError(receiptError, 'Receipt proof could not upload. Try again with a clear clothing or supplier image.'))
    } finally {
      setBusy(null)
    }
  }

  if (!isTailor && !isCustomer && advances.length === 0) return null

  return (
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Material advance</p>
          <h2 className="mt-2 text-3xl text-ink">Protected material costs</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-ink/62">Main escrow never releases early. The customer approves and pays the material amount separately before ops reviews release.</p>
      </div>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {advances.length === 0 ? (
          <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">No material advance is open on this order.</p>
        ) : (
          advances.map((advance) => (
            <article key={advance.id} className="rounded-[1.2rem] border border-ink/8 bg-bone/60 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-ink">{safeUserText(advance.title, 'Material advance')}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/62">{safeUserText(advance.description, 'Material cost requested.')}</p>
                  <p className="mt-3 text-sm font-semibold text-ink">{formatMoney(advance.amount, advance.currency)} · {cleanLabel(advance.status, 'Requested')} · {cleanLabel(advance.release_status, 'Release pending')}</p>
                </div>
                {advance.receipt_url ? (
                  <a href={advance.receipt_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-needle">View receipt</a>
                ) : null}
              </div>
              {isCustomer && advance.status === 'REQUESTED' ? (
                <div className="mt-4 grid gap-3 border-t border-ink/6 pt-4">
                  <textarea value={responseNote} onChange={(event) => setResponseNote(event.target.value)} rows={2} placeholder="Optional note for the tailor" className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => respondAdvance(advance, 'APPROVE')} disabled={!!busy} className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                      {busy === `APPROVE:${advance.id}` ? 'Approving...' : 'Approve'}
                    </button>
                    <button type="button" onClick={() => respondAdvance(advance, 'DECLINE')} disabled={!!busy} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38">
                      {busy === `DECLINE:${advance.id}` ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                </div>
              ) : null}
              {isCustomer && ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(advance.status ?? '') ? (
                <div className="mt-4 grid gap-3">
                  <button type="button" onClick={() => payAdvance(advance)} disabled={!!busy} className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                    {busy === `pay:${advance.id}` ? 'Preparing...' : advance.status === 'PAYMENT_FAILED' ? 'Retry material payment' : 'Pay material advance'}
                  </button>
                  {stripeAdvancePayment?.advanceId === advance.id ? (
                    <StripeCardAuthorization
                      clientSecret={stripeAdvancePayment.clientSecret}
                      label={formatMoney(stripeAdvancePayment.amount ?? advance.amount, stripeAdvancePayment.currency ?? advance.currency)}
                      submitLabel="Authorize material payment"
                      onConfirm={async (paymentIntentId) => {
                        await invokeAccountFunction('material-advance-action', {
                          action: 'confirm-payment',
                          advanceId: advance.id,
                          paymentIntentId,
                        })
                      }}
                      onDone={() => {
                        setStripeAdvancePayment(null)
                        onRefresh()
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {isTailor && ['PAID', 'OPS_REVIEW', 'RELEASED', 'BLOCKED'].includes(advance.status ?? '') && !advance.receipt_url ? (
                <div className="mt-4 grid gap-3 border-t border-ink/6 pt-4">
                  <input type="file" accept="image/*" capture="environment" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink" />
                  <textarea value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} rows={2} placeholder="Optional receipt note" className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                  <button type="button" onClick={() => uploadReceipt(advance)} disabled={!!busy} className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                    {busy === `receipt:${advance.id}` ? 'Uploading...' : 'Upload receipt proof'}
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
        {isTailor && (order.order_kind ?? 'CUSTOM') === 'CUSTOM' && !hasActiveAdvance ? (
          <div className="grid gap-3 rounded-[1.2rem] border border-needle/12 bg-needle/8 p-4">
            <h3 className="text-xl font-semibold text-ink">Request a material advance</h3>
            <div className="grid gap-3 md:grid-cols-[1fr_0.55fr_0.4fr]">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aso-oke embroidery deposit" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Explain the material cost and why it is needed before production continues." className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={requestAdvance} disabled={busy === 'request'} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'request' ? 'Requesting...' : 'Request advance'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

const SUPPORT_CATEGORIES = [
  ['PAYMENT', 'Payment issue'],
  ['FIT', 'Fit or alteration issue'],
  ['DELIVERY_HANDOFF', 'Delivery or handoff issue'],
  ['ACCOUNT_SECURITY', 'Account or security issue'],
  ['TAILOR_PAYOUT', 'Tailor payout or setup issue'],
  ['GENERAL', 'Something else'],
] as const

function GeneralSupportForm({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const orderOptions = data.orders.slice(0, 12)
  const [category, setCategory] = useState<(typeof SUPPORT_CATEGORIES)[number][0]>('PAYMENT')
  const [orderId, setOrderId] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function submitSupport() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([subject, description].join('\n'), "Support requests can't include phone numbers, email addresses, social handles, or off-platform contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (subject.trim().length < 3 || description.trim().length < 10) {
      setError('Add a short subject and enough detail for ops to understand what happened.')
      return
    }
    setBusy(true)
    try {
      const result = await invokeAccountFunction<{ ok?: boolean; issueNumber?: number | null }>('account-support-action', {
        action: 'submit-support',
        category,
        orderId: orderId || undefined,
        subject: subject.trim(),
        description: description.trim(),
      })
      setSubject('')
      setDescription('')
      setSuccess(result.issueNumber ? `Support request opened as #${String(result.issueNumber).padStart(4, '0')}.` : 'Support request opened for ops review.')
      onRefresh()
    } catch (supportError) {
      setError(friendlyActionError(supportError, `Support could not open from web. Email ${CONTACTS.support} if this keeps happening.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
      <h2 className="mt-2 text-3xl text-ink">Ask Drapeon for help</h2>
      <p className="mt-3 text-sm leading-7 text-ink/66">
        Open a protected support request from web. Attach an order when the issue is about payment, fit, delivery, payout, or production.
      </p>
      <div className="mt-5 grid gap-3">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <select value={category} onChange={(event) => setCategory(event.target.value as (typeof SUPPORT_CATEGORIES)[number][0])} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
            {SUPPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
            <option value="">No order attached</option>
            {orderOptions.map((order) => <option key={order.id} value={order.id}>{order.reference ?? orderTitle(order)} · {cleanLabel(order.stage)}</option>)}
          </select>
        </div>
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={120}
          className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
          placeholder="Short subject"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={1500}
          className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
          placeholder="Tell us what happened inside Drapeon. Keep phone numbers, emails, and social handles out of the request."
        />
        <button type="button" onClick={submitSupport} disabled={busy} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy ? 'Opening support...' : 'Open support request'}
        </button>
      </div>
    </section>
  )
}

function SupportIssueForm({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order))
  const [orderId, setOrderId] = useState(activeOrders[0]?.id ?? '')
  const [issueType, setIssueType] = useState('NEED_DRAPE_HELP')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reportIssue() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(description, "Support notes can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!orderId || description.trim().length < 10) {
      setError('Choose an order and add a short description.')
      return
    }
    setBusy(true)
    try {
      await invokeAccountFunction('handoff-support-action', {
        action: 'report-issue',
        orderId,
        issueType,
        description: description.trim(),
      })
      setDescription('')
      setSuccess('Handoff issue opened on this order.')
      onRefresh()
    } catch (supportError) {
      setError(friendlyActionError(supportError, 'Handoff support is only available once pickup or delivery is in progress. Use email for other issues.'))
    } finally {
      setBusy(false)
    }
  }

  if (activeOrders.length === 0) return null

  return (
    <section className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Protected support</p>
      <h2 className="mt-2 text-3xl text-ink">Open handoff help</h2>
      <p className="mt-3 text-sm leading-7 text-ink/66">This creates a real order handoff issue when pickup or delivery is active. Use the support request above for payment, fit, account, and payout questions.</p>
      <div className="mt-5 grid gap-3">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
            {activeOrders.map((order) => <option key={order.id} value={order.id}>{order.reference ?? orderTitle(order)} · {cleanLabel(order.stage)}</option>)}
          </select>
          <select value={issueType} onChange={(event) => setIssueType(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
            <option value="AT_PICKUP">At pickup</option>
            <option value="CANT_FIND_LOCATION">Cannot find location</option>
            <option value="COUNTERPART_NOT_RESPONDING">Other party not responding</option>
            <option value="ORDER_NOT_READY">Order not ready</option>
            <option value="COURIER_OR_DELIVERY_ISSUE">Courier or delivery issue</option>
            <option value="NEED_DRAPE_HELP">Need Drapeon help</option>
          </select>
        </div>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" placeholder="Describe what happened inside Drapeon. Do not include phone numbers or handles." />
        <button type="button" onClick={reportIssue} disabled={busy} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy ? 'Opening help...' : 'Open handoff help'}
        </button>
      </div>
    </section>
  )
}

function ReadyMadeCheckoutForm({ item, data, onRefresh }: { item: SellerItem; data: AccountSurfaceData; onRefresh: () => void }) {
  const sizes = stringList(item.sizes)
  const [size, setSize] = useState(sizes[0] ?? '')
  const [quantity, setQuantity] = useState('1')
  const [fulfillment, setFulfillment] = useState(item.pickup_available ? 'PICKUP' : item.delivery_available ? 'DELIVERY' : 'SHIPPING')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const needsAddress = fulfillment !== 'PICKUP'

  async function startCheckout() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([address, city, region, recipientName].join('\n'), "Checkout delivery details can't include off-platform contact details.")
    if (leak) {
      setError(leak)
      return
    }
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 3) {
      setError('Choose a quantity between 1 and 3.')
      return
    }
    if (needsAddress && (!address.trim() || !recipientName.trim() || !recipientPhone.trim())) {
      setError('Delivery and shipping need recipient details before checkout.')
      return
    }
    if (!ack) {
      setError('Acknowledge the cancellation policy before checkout.')
      return
    }
    setBusy(true)
    try {
      const result = await invokeAccountFunction<{ orderId?: string }>('ready-made-order-action', {
        action: 'create-checkout',
        sellerItemId: item.id,
        size: size || undefined,
        quantity: parsedQuantity,
        fulfillment,
        address: needsAddress ? address.trim() : undefined,
        city: needsAddress ? city.trim() : undefined,
        region: needsAddress ? region.trim() : undefined,
        postalCode: needsAddress ? postalCode.trim() : undefined,
        countryCode: needsAddress ? countryCode.trim() : undefined,
        recipientName: needsAddress ? recipientName.trim() : undefined,
        recipientPhone: needsAddress ? recipientPhone.trim() : undefined,
        cancellationPolicyAcknowledged: true,
      })
      onRefresh()
      if (result.orderId) {
        setSuccess('Checkout order created. Opening payment handoff.')
        window.location.assign(`/account/checkout/${result.orderId}`)
        return
      }
      setSuccess('Checkout order created. Open Orders to continue payment.')
    } catch (checkoutError) {
      setError(friendlyActionError(checkoutError, 'Ready-made checkout could not start. Refresh and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Checkout</p>
      <h2 className="mt-2 text-3xl text-ink">Start ready-made checkout</h2>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Size</span>
            <select value={size} onChange={(event) => setSize(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
              {sizes.length === 0 ? <option value="">One size</option> : sizes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Quantity</span>
            <input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Fulfillment</span>
            <select value={fulfillment} onChange={(event) => setFulfillment(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
              {item.pickup_available ? <option value="PICKUP">Pickup</option> : null}
              {item.delivery_available ? <option value="DELIVERY">Delivery</option> : null}
              {item.shipping_available ? <option value="SHIPPING">Shipping</option> : null}
            </select>
          </label>
        </div>
        {needsAddress ? (
          <div className="grid gap-3 md:grid-cols-2">
            <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Recipient name" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder="Recipient phone for courier only" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50 md:col-span-2" />
            <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Region/state" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} placeholder="Postal code" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <input value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} placeholder="Country code" maxLength={2} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </div>
        ) : null}
        <label className="flex items-start gap-3 text-sm leading-6 text-ink/70">
          <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="mt-1" />
          I understand cancellation and handoff reviews stay inside Drapeon.
        </label>
        <button type="button" onClick={startCheckout} disabled={busy || !data.userId} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy ? 'Starting checkout...' : 'Create checkout'}
        </button>
      </div>
    </section>
  )
}

function ProfileSettingsEditor({ data, session, onRefresh }: { data: AccountSurfaceData; session: Session | null; onRefresh: () => void }) {
  const role = session?.user.user_metadata?.role === 'TAILOR' ? 'TAILOR' : 'CUSTOMER'
  const currentDisplayName = data.customerProfile?.display_name || data.tailorProfile?.display_name || data.tailorProfile?.business_name || ''
  const currentCurrency = data.accountCurrency || data.tailorProfile?.currency || 'USD'
  const [displayName, setDisplayName] = useState(currentDisplayName)
  const [currency, setCurrency] = useState(currentCurrency)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function saveDisplayName() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(displayName, "Display names can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!displayName.trim()) {
      setError('Add a display name before saving.')
      return
    }
    setBusy('name')
    try {
      await invokeAccountFunction('account-profile-action', {
        action: 'update-display-name',
        role,
        displayName: displayName.trim(),
      })
      setSuccess('Display name updated.')
      onRefresh()
    } catch (nameError) {
      setError(friendlyActionError(nameError, 'Display name could not save. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function saveCurrency() {
    setError(null)
    setSuccess(null)
    setBusy('currency')
    try {
      await invokeAccountFunction('account-profile-action', {
        action: 'update-currency',
        role,
        currency,
      })
      setSuccess('Currency preference updated.')
      onRefresh()
    } catch (currencyError) {
      setError(friendlyActionError(currencyError, 'Currency could not save. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Editable on web</p>
      <h2 className="mt-2 text-3xl text-ink">Profile basics</h2>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your public display name" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <button type="button" onClick={saveDisplayName} disabled={busy === 'name'} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy === 'name' ? 'Saving...' : 'Save name'}
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Currency</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <button type="button" onClick={saveCurrency} disabled={busy === 'currency'} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy === 'currency' ? 'Saving...' : 'Save currency'}
          </button>
        </div>
        <p className="text-sm leading-6 text-ink/60">
          Phone changes, OTP, payout setup, and account deletion stay behind the stronger guarded flows.
        </p>
      </div>
    </section>
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
                    {safeUserText(tailor.bio, safeList(tailor.specialty_tags, 'Verified craft profile on Drapeon.'))}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-semibold text-ink/62">
                    <span className="rounded-full bg-bone px-3 py-2 text-center">{cleanLabel(tailor.availability, 'Availability')}</span>
                    <span className="rounded-full bg-bone px-3 py-2 text-center">
                      {formatMoney(tailor.price_range_min, tailor.currency)}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Link
                      href={accountRoute(`/account/tailors/${tailor.id}`)}
                      className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink"
                    >
                      View profile
                    </Link>
                    <a href="drape://" className="inline-flex justify-center rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white">
                      Start in app
                    </a>
                  </div>
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
                    <p className="text-sm font-semibold text-rust">{stockCopy(item)}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-ink/62">{fulfillmentSummary(item)}</p>
                  <Link
                    href={accountRoute(`/account/items/${item.id}`)}
                    className="mt-4 inline-flex w-full justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink"
                  >
                    View item
                  </Link>
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
              {message.blocked ? 'Protected message blocked.' : safeUserText(message.body, message.photo_url || message.voice_url ? 'Media message attached.' : 'Message activity recorded.')}
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

function RenderOrderDetail({ data, orderId, onRefresh }: { data: AccountSurfaceData; orderId?: string; onRefresh: () => void }) {
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
  const proofEvidence = productionEvidenceFor(order.id, data.productionEvidence)
  const proofMediaUrls = Array.from(new Set(
    proofEvidence
      .flatMap((item) => stringList(item.photo_urls))
      .map(safeMediaUrl)
      .filter((src): src is string => !!src),
  ))

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{cleanLabel(order.order_kind, 'Order')}</p>
          <h2 className="mt-3 text-4xl text-ink">{orderTitle(order)}</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {safeUserText(order.garment_description || order.special_note, 'The app brief carries full order details and proof media.')}
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
            Payment, messages, consultation requests, stage updates, and proof media stay attached to this order. Use the app for Drape Vision capture when body measurement scanning is needed.
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

      {order.customer_id === data.userId && isPayableOrder(order) ? (
        <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Checkout</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Start the real provider checkout from web. If the provider is already processing, Drapeon reuses that attempt.
          </p>
          <div className="mt-5">
            <CheckoutAction order={order} onRefresh={onRefresh} />
          </div>
        </section>
      ) : null}

      <TailorOrderActions order={order} data={data} onRefresh={onRefresh} />
      <MaterialAdvancePanel order={order} data={data} onRefresh={onRefresh} />

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
                No production updates yet. Stage photos and videos appear here after the tailor posts them from web or the app.
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
          {proofMediaUrls.length > 0 ? (
            <div className="mt-5 border-t border-ink/6 pt-5">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-semibold text-ink">Proof media</h3>
                <p className="text-xs font-semibold text-ink/48">{proofMediaUrls.length} item{proofMediaUrls.length === 1 ? '' : 's'}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {proofMediaUrls.slice(0, 6).map((src, index) => (
                  <PhotoTile key={`${src}-${index}`} src={src} label={`Production proof ${index + 1}`} />
                ))}
              </div>
            </div>
          ) : null}
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
                    {message.blocked ? 'A message was blocked to keep the order protected.' : safeUserText(message.body, message.photo_url || message.voice_url ? 'Media message attached.' : 'Message activity recorded.')}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="mt-5">
            <MessageComposer order={order} onRefresh={onRefresh} />
          </div>
        </div>
      </section>
    </div>
  )
}

function RenderMessages({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
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
                    {message.blocked ? 'Contact-sharing or unsafe content was blocked.' : safeUserText(message.body, message.photo_url || message.voice_url ? 'Media message attached.' : 'Message activity recorded.')}
                  </p>
                  <p className="mt-3 text-xs text-ink/46">{formatRelative(message.created_at)}</p>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <MessageComposer order={order} onRefresh={onRefresh} />
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function RenderMeasurements({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const legacyMeasurementCount = hasMeasurements(data.customerProfile) ? 1 : 0
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryLine label="Named profiles" value={`${data.measurementProfiles.length}`} />
        <SummaryLine label="Drape Vision scans" value={`${data.measurementScans.length}`} />
        <SummaryLine label="Profile units" value={data.customerProfile?.unit_preference || data.measurementProfiles[0]?.unit_preference || 'Not set'} />
      </section>
      <ManualMeasurementEditor data={data} onRefresh={onRefresh} />
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
                    <p className="mt-1 text-sm text-ink/60">Legacy profile · {fitPreferenceFromProfile(data.customerProfile)}</p>
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

function RenderShop({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const items = isTailor ? data.sellerItems : data.exploreItems
  return (
    <div className="grid gap-6">
      {isTailor ? <SellerItemManager data={data} onRefresh={onRefresh} /> : null}
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
                  <Link
                    href={accountRoute(`/account/items/${item.id}`)}
                    className="mt-4 inline-flex w-full justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink"
                  >
                    View item
                  </Link>
                </div>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}

function RenderWork({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
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
              <div className="mt-5">
                <TailorOrderActions order={order} data={data} onRefresh={onRefresh} />
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function RenderCheckout({ data, orderId, onRefresh }: { data: AccountSurfaceData; orderId?: string; onRefresh: () => void }) {
  const order = data.orders.find((entry) => entry.id === orderId) ?? data.orders[0] ?? null
  if (!order) {
    return (
      <EmptyState
        title="No checkout-ready order loaded."
        body="Create or open an order first. Web will then show payment state and start secure provider checkout when the order is payable."
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
            : 'Start provider checkout here when available. If a payment is already processing, Drapeon reuses that attempt instead of creating a duplicate charge.'}
        </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryLine label="Order total" value={orderAmount(order)} />
            <SummaryLine label="Provider" value={cleanLabel(order.payment_provider, 'Provider selected at checkout')} />
            <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
            <SummaryLine label="Status" value={cleanLabel(order.stage, 'In progress')} />
          </div>
          <div className="mt-6">
            <CheckoutAction order={order} onRefresh={onRefresh} />
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

function RenderSaved({ data }: { data: AccountSurfaceData }) {
  const tailorById = new Map(data.savedTailors.map((tailor) => [tailor.id, tailor]))
  const itemById = new Map(data.savedItems.map((item) => [item.id, item]))

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryLine label="Collections" value={`${data.wishlistCollections.length}`} />
        <SummaryLine label="Saved tailors" value={`${data.savedTailors.length}`} />
        <SummaryLine label="Saved pieces" value={`${data.savedItems.length}`} />
      </section>

      {data.wishlistCollections.length === 0 && data.savedTailors.length === 0 && data.savedItems.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          body="Save tailors and ready-made pieces in the app while planning an event. They will appear here with clean links back into Explore."
          action={<Link href="/account/explore" className="font-semibold text-needle">Browse Explore</Link>}
        />
      ) : null}

      {data.wishlistCollections.length > 0 ? (
        <section className="grid gap-5 md:grid-cols-2">
          {data.wishlistCollections.map((collection) => {
            const items = data.wishlistItems.filter((item) => item.collection_id === collection.id).slice(0, 4)
            const fallbackPhoto =
              collection.cover_image_url ||
              items
                .map((entry) => {
                  if (entry.tailor_id) {
                    const tailor = tailorById.get(entry.tailor_id)
                    return tailor ? tailorPhoto(tailor) : null
                  }
                  if (entry.ready_made_item_id) {
                    const item = itemById.get(entry.ready_made_item_id)
                    return item ? itemPhoto(item) : null
                  }
                  return null
                })
                .find(Boolean) ||
              null

            return (
              <article key={collection.id} className="rounded-[1.55rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-[0.38fr_0.62fr]">
                  <PhotoTile src={fallbackPhoto} label="Wishlist collection" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Wishlist</p>
                    <h2 className="mt-2 text-3xl text-ink">{safeUserText(collection.name, 'Wishlist')}</h2>
                    <p className="mt-2 text-sm text-ink/58">
                      {collection.item_count ?? items.length} items · Updated {formatRelative(collection.updated_at)}
                    </p>
                    <div className="mt-4 grid gap-2">
                      {items.length === 0 ? (
                        <p className="rounded-[1rem] bg-bone/70 px-4 py-3 text-sm leading-6 text-ink/62">
                          This collection is ready for items saved from the app.
                        </p>
                      ) : (
                        items.map((entry) => {
                          const tailor = entry.tailor_id ? tailorById.get(entry.tailor_id) : null
                          const item = entry.ready_made_item_id ? itemById.get(entry.ready_made_item_id) : null
                          const href = tailor
                            ? accountRoute(`/account/tailors/${tailor.id}`)
                            : item
                              ? accountRoute(`/account/items/${item.id}`)
                              : '/account/explore'
                          return (
                            <Link
                              key={entry.id}
                              href={href}
                              className="rounded-[1rem] border border-ink/6 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-needle/24"
                            >
                              {tailor
                                ? safeEntityName(tailor.business_name || tailor.display_name, 'Saved tailor')
                                : item
                                  ? safeUserText(item.title, 'Saved ready-made item')
                                  : 'Saved item'}
                            </Link>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      ) : null}

      {data.savedTailors.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <h2 className="text-3xl text-ink">Saved tailors</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedTailors.map((tailor) => (
              <Link key={tailor.id} href={accountRoute(`/account/tailors/${tailor.id}`)} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-4 shadow-sm transition hover:-translate-y-1">
                <PhotoTile src={tailorPhoto(tailor)} label="Tailor photo" />
                <h3 className="mt-4 text-2xl text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h3>
                <p className="mt-1 text-sm text-ink/58">{safeUserText(tailor.location, 'Location pending')}</p>
                <p className="mt-3 text-sm leading-6 text-ink/62">{safeList(stringList(tailor.specialty_tags).slice(0, 3), 'Custom clothing profile')}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.savedItems.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <h2 className="text-3xl text-ink">Saved ready-made</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedItems.map((item) => (
              <Link key={item.id} href={accountRoute(`/account/items/${item.id}`)} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-4 shadow-sm transition hover:-translate-y-1">
                <PhotoTile src={itemPhoto(item)} label="Ready-made item" />
                <h3 className="mt-4 text-2xl text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                <div className="mt-3 flex items-center justify-between gap-4 text-sm">
                  <span className="font-semibold text-ink">{formatMoney(item.price_amount, item.currency)}</span>
                  <span className="font-semibold text-rust">{stockCopy(item)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function RenderSettings({ data, session, onRefresh }: { data: AccountSurfaceData; session: Session | null; onRefresh: () => void }) {
  const role = session?.user.user_metadata?.role === 'TAILOR' ? 'TAILOR' : 'CUSTOMER'
  const displayName = safeEntityName(
    data.customerProfile?.display_name || data.tailorProfile?.business_name || data.tailorProfile?.display_name,
    'Drapeon member',
  )
  const currency =
    data.accountCurrency ||
    data.tailorProfile?.currency ||
    data.orders.find((order) => order.currency)?.currency ||
    'USD'

  const rows: Array<{ title: string; body: string; action: ReactNode }> = [
    {
      title: 'Personal info',
      body: `${displayName}. Email and sensitive contact details are managed through secure account settings.`,
      action: <span className="font-semibold text-needle">Editable above</span>,
    },
    {
      title: 'Role and mode',
      body: role === 'TAILOR' ? 'Tailor workspace is active. Customer mode can still use the same account.' : 'Customer workspace is active. Tailor mode can be added from the same account.',
      action: <Link href="/account/dashboard" className="font-semibold text-needle">Open dashboard</Link>,
    },
    {
      title: 'Currency',
      body: `Current preference: ${currency}. Checkout still routes by order and provider availability.`,
      action: <span className="font-semibold text-needle">Editable above</span>,
    },
    {
      title: 'Notifications',
      body: 'Push, email, and SMS fallback preferences are app-first so device permission state stays accurate.',
      action: <a href="drape://" className="font-semibold text-needle">Open notifications</a>,
    },
    {
      title: 'Login and security',
      body: 'Password recovery, SSO, phone OTP, and sensitive-action reauth use the same Supabase identity.',
      action: <Link href="/account/recovery" className="font-semibold text-needle">Account recovery</Link>,
    },
    {
      title: 'Privacy and data',
      body: 'Measurements and order records are protected account data. Data access and deletion are reviewed before action.',
      action: <Link href="/account-deletion" className="font-semibold text-needle">Deletion guard</Link>,
    },
    {
      title: 'Support',
      body: 'Order, payment, fit, delivery, payout, and account issues route through the correct Drapeon inbox.',
      action: <Link href="/account/support" className="font-semibold text-needle">Get support</Link>,
    },
  ]

  return (
    <div className="grid gap-6">
      <ProfileSettingsEditor
        key={`${data.customerProfile?.display_name ?? ''}:${data.tailorProfile?.display_name ?? ''}:${data.tailorProfile?.business_name ?? ''}:${data.accountCurrency ?? data.tailorProfile?.currency ?? ''}`}
        data={data}
        session={session}
        onRefresh={onRefresh}
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryLine label="Signed in as" value={session?.user.email ?? 'Signed in'} />
        <SummaryLine label="Workspace" value={role === 'TAILOR' ? 'Tailor' : 'Customer'} />
        <SummaryLine label="Profile readiness" value={data.tailorProfile?.payout_account_verified ? 'Payout ready' : data.customerProfile || data.tailorProfile ? 'Profile started' : 'Needs setup'} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {rows.map((row) => (
          <article key={row.title} className="rounded-[1.45rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
            <h2 className="text-2xl text-ink">{row.title}</h2>
            <p className="mt-3 text-sm leading-7 text-ink/66">{row.body}</p>
            <div className="mt-5">{row.action}</div>
          </article>
        ))}
      </section>
    </div>
  )
}

function RenderSupport({ data, onRefresh }: { data: AccountSurfaceData; onRefresh: () => void }) {
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order)).slice(0, 5)
  const issueRoutes = [
    ['Payment issue', CONTACTS.support, 'Payment help'],
    ['Fit issue', CONTACTS.support, 'Fit help'],
    ['Delivery or handoff issue', CONTACTS.support, 'Delivery help'],
    ['Account or security issue', CONTACTS.security, 'Account security help'],
    ['Tailor payout or setup issue', CONTACTS.payouts, 'Tailor payout help'],
  ] as const

  return (
    <div className="grid gap-6">
      <GeneralSupportForm data={data} onRefresh={onRefresh} />
      <SupportIssueForm data={data} onRefresh={onRefresh} />
      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <h2 className="text-3xl text-ink">Order-aware help</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          Pick the order first when the issue involves payment, fit, delivery, stage updates, or handoff. Web can now open general support and handoff issues, with email as a fallback.
        </p>
        <div className="mt-5 grid gap-3">
          {activeOrders.length === 0 ? (
            <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No active orders loaded. For account help, use the routes below.
            </p>
          ) : (
            activeOrders.map((order) => (
              <div key={order.id} className="rounded-[1.1rem] border border-ink/6 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-ink">{orderTitle(order)}</h3>
                    <p className="mt-1 text-sm text-ink/60">{partyName(order, data.userId)} · {cleanLabel(order.stage, 'In progress')}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link href={accountRoute(`/account/orders/${order.id}`)} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                      View order
                    </Link>
                    <a href={mailto(CONTACTS.support, `Drapeon order help: ${order.reference ?? order.id}`)} className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white">
                      Email support
                    </a>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {issueRoutes.map(([title, email, subject]) => (
          <a key={title} href={mailto(email, subject)} className="rounded-[1.45rem] border border-ink/8 bg-white/84 p-5 shadow-sm transition hover:-translate-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Support</p>
            <h2 className="mt-3 text-2xl text-ink">{title}</h2>
            <p className="mt-3 break-words text-sm font-semibold text-needle">{email}</p>
            <p className="mt-3 text-sm leading-6 text-ink/62">Use the app for protected proof photos, calls, receipts, and order-stage actions.</p>
          </a>
        ))}
      </section>
    </div>
  )
}

function RenderTailorDetail({ data, tailorId }: { data: AccountSurfaceData; tailorId?: string }) {
  const tailor = data.tailorDetail ?? data.exploreTailors.find((entry) => entry.id === tailorId) ?? data.savedTailors.find((entry) => entry.id === tailorId)
  if (!tailor) {
    return (
      <EmptyState
        title="Tailor profile not available."
        body="This profile may not be live, may belong to another account context, or may still be loading."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }
  const portfolio = stringList(tailor.portfolio_photo_urls)
  const readyMade = data.tailorDetailItems.length > 0 ? data.tailorDetailItems : data.exploreItems.filter((item) => item.tailor_profile_id === tailor.id)

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
          <PhotoTile src={tailorPhoto(tailor)} label="Tailor profile" />
        </div>
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{cleanLabel(tailor.tier, 'Tailor')}</p>
          <h2 className="mt-3 text-4xl text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">{safeUserText(tailor.bio, 'Portfolio, fit guidance, and order context stay connected through Drapeon.')}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryLine label="Location" value={safeUserText(tailor.location, 'Location pending')} />
            <SummaryLine label="Rating" value={`${Number(tailor.avg_rating ?? 0).toFixed(1)} · ${tailor.total_reviews ?? 0} reviews`} />
            <SummaryLine label="Pricing" value={priceRange(tailor)} />
            <SummaryLine label="Fulfillment" value={fulfillmentSummary(tailor)} />
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <a href="drape://" className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
              Start custom order in app
            </a>
            <Link href="/account/saved" className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
              Back to saved
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Craft profile</h2>
          <div className="mt-5 grid gap-3">
            <SummaryLine label="Specialties" value={safeList(tailor.specialty_tags)} />
            <SummaryLine label="Languages" value={safeList(tailor.languages)} />
            <SummaryLine label="Custom orders" value={tailor.supports_custom_orders ? 'Available in app' : 'Not listed'} />
            <SummaryLine label="Ready-made" value={tailor.supports_ready_made ? 'Available' : 'Not listed'} />
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Reviews</h2>
          <div className="mt-5 grid gap-3">
            {data.tailorReviews.length === 0 ? (
              <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                Public reviews will appear here after completed Drapeon orders.
              </p>
            ) : (
              data.tailorReviews.map((review) => (
                <div key={review.id} className="rounded-[1rem] border border-ink/6 bg-white p-4">
                  <p className="text-sm font-semibold text-ink">{Number(review.rating ?? 0).toFixed(1)} stars · {safeEntityName(review.reviewer_name, 'Customer')}</p>
                  <p className="mt-2 text-sm leading-6 text-ink/62">{safeUserText(review.body, 'Review published.')}</p>
                  {review.tailor_response ? <p className="mt-2 text-sm leading-6 text-needle">Tailor response: {safeUserText(review.tailor_response)}</p> : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {portfolio.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <h2 className="text-3xl text-ink">Portfolio</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {portfolio.slice(0, 9).map((src, index) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="block">
                <PhotoTile src={src} label={`Portfolio image ${index + 1}`} />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="border-t border-ink/6 pt-6">
        <h2 className="text-3xl text-ink">Ready-made from this tailor</h2>
        {readyMade.length === 0 ? (
          <p className="mt-5 rounded-[1.2rem] border border-ink/8 bg-white/84 p-5 text-sm leading-7 text-ink/62">
            No live ready-made items loaded for this tailor yet.
          </p>
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {readyMade.map((item) => (
              <Link key={item.id} href={accountRoute(`/account/items/${item.id}`)} className="rounded-[1.5rem] border border-ink/8 bg-white/84 p-4 shadow-sm transition hover:-translate-y-1">
                <PhotoTile src={itemPhoto(item)} label="Ready-made item" />
                <h3 className="mt-4 text-2xl text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                <p className="mt-2 text-sm font-semibold text-ink">{formatMoney(item.price_amount, item.currency)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function RenderItemDetail({ data, itemId, onRefresh }: { data: AccountSurfaceData; itemId?: string; onRefresh: () => void }) {
  const item =
    data.itemDetail ??
    data.exploreItems.find((entry) => entry.id === itemId) ??
    data.savedItems.find((entry) => entry.id === itemId) ??
    data.sellerItems.find((entry) => entry.id === itemId)
  if (!item) {
    return (
      <EmptyState
        title="Ready-made item not available."
        body="This item may be sold out, hidden, or still loading. Return to Explore to browse live pieces."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }
  const tailor = firstJoinedRow(item.tailor_profiles)
  const gallery = stringList(item.photo_urls)

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
          <PhotoTile src={gallery[0] ?? null} label="Ready-made item" />
          {gallery.length > 1 ? (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {gallery.slice(1, 4).map((src, index) => (
                <a key={src} href={src} target="_blank" rel="noreferrer" className="block">
                  <PhotoTile src={src} label={`Item image ${index + 2}`} />
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{safeUserText(item.category, 'Ready-made')}</p>
          <h2 className="mt-3 text-4xl text-ink">{safeUserText(item.title, 'Ready-made item')}</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">{safeUserText(item.description, 'Review size, stock, fulfillment, and checkout before purchase.')}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryLine label="Price" value={formatMoney(item.price_amount, item.currency)} />
            <SummaryLine label="Stock" value={stockCopy(item)} />
            <SummaryLine label="Sizes" value={safeList(item.sizes, 'Confirm in app')} />
            <SummaryLine label="Fulfillment" value={fulfillmentSummary(item)} />
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <a href="drape://" className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
              Open in app
            </a>
            {item.tailor_profile_id ? (
              <Link href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
                View tailor
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {data.userId && data.tailorProfile?.id !== item.tailor_profile_id && item.is_live ? (
        <ReadyMadeCheckoutForm item={item} data={data} onRefresh={onRefresh} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Fit guidance</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">{sizeGuideSummary(item.size_guide)}</p>
          <p className="mt-4 rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
            Web checkout creates the same order record as mobile. Use the app if you need native push or camera-guided proof during handoff.
          </p>
        </div>
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Tailor</h2>
          <p className="mt-3 text-2xl text-ink">{safeEntityName(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')}</p>
          <p className="mt-2 text-sm text-ink/58">{safeUserText(tailor?.location, 'Location pending')}</p>
          <p className="mt-4 text-sm leading-7 text-ink/66">
            Custom-order questions and calls stay inside the Drapeon order record. Use the app only for Vision capture and native camera proof.
          </p>
        </div>
      </section>
    </div>
  )
}

export function AccountAppSurface({
  surface,
  orderId,
  tailorId,
  itemId,
}: {
  surface: AccountSurface
  orderId?: string
  tailorId?: string
  itemId?: string
}): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [data, setData] = useState<AccountSurfaceData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

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
    fetchAccountSurfaceData(session.user.id, { tailorId, itemId })
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
  }, [itemId, reloadKey, session?.user.id, tailorId])

  const content = useMemo(() => {
    const onRefresh = () => setReloadKey((current) => current + 1)
    switch (surface) {
      case 'explore':
        return <RenderExplore data={data} />
      case 'orders':
        return <RenderOrders data={data} />
      case 'order-detail':
        return <RenderOrderDetail data={data} orderId={orderId} onRefresh={onRefresh} />
      case 'messages':
        return <RenderMessages data={data} onRefresh={onRefresh} />
      case 'measurements':
        return <RenderMeasurements data={data} onRefresh={onRefresh} />
      case 'shop':
        return <RenderShop data={data} onRefresh={onRefresh} />
      case 'work':
        return <RenderWork data={data} onRefresh={onRefresh} />
      case 'checkout':
        return <RenderCheckout data={data} orderId={orderId} onRefresh={onRefresh} />
      case 'saved':
        return <RenderSaved data={data} />
      case 'settings':
        return <RenderSettings data={data} session={session} onRefresh={onRefresh} />
      case 'support':
        return <RenderSupport data={data} onRefresh={onRefresh} />
      case 'tailor-detail':
        return <RenderTailorDetail data={data} tailorId={tailorId} />
      case 'item-detail':
        return <RenderItemDetail data={data} itemId={itemId} onRefresh={onRefresh} />
      default:
        return null
    }
  }, [data, itemId, orderId, session, surface, tailorId])

  if (loading || (session?.user.id && data.userId !== session.user.id)) return <LoadingCard />
  if (!session) return <AuthRequiredCard />

  return (
    <AccountRouteShell session={session} data={data} surface={surface}>
      {content}
    </AccountRouteShell>
  )
}
