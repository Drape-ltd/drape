'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  CONTACTS,
  CORE_MEASUREMENT_FIELDS,
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  MEASUREMENT_FIELD_KEYS,
  buildMeasurementProfileStoragePayload,
  deriveCancellationPolicy,
  currencySymbol,
  isMeasurementFieldKey,
  isTransientMeasurementMetadataKey,
  measurementCoreCompleteness,
  mergeMeasurementRecords,
  normalizeAccountCurrency,
  readMeasurementValue,
  validatePasswordStrength,
} from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { canTransition, type OrderStage } from '@drape/shared/order-machine'
import { createClient } from '../lib/supabase'
import { safeEntityName, safeUserText } from '../lib/safe-display'
import { clearWebSessionScope } from '../lib/web-session-scope'
import { registerWebPushSubscription } from '../lib/web-push-client'
import { AccountContextProvider, useAccountContext, type AccountContextValue } from './account-context'
import { OpenAppButton } from './open-app-button'

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
  | 'brief'
  | 'shop'
  | 'work'
  | 'earnings'
  | 'payout'
  | 'profile'
  | 'checkout'
  | 'saved'
  | 'settings'
  | 'support'
  | 'tailor-detail'
  | 'item-detail'

const ORDER_REALTIME_SURFACES = new Set<AccountSurface>(['orders', 'order-detail', 'work', 'checkout'])
const ORDER_REALTIME_ROW_EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const
const ORDER_REALTIME_CHILD_TABLES = [
  'custom_order_details',
  'messages',
  'order_material_advances',
  'order_payments',
  'order_production_evidence',
  'order_stage_updates',
  'reviews',
] as const

function isRealtimeFilterValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,120}$/.test(value)
}

function uniqueRealtimeOrderIds(values: Array<string | null | undefined>) {
  const ids = new Set<string>()
  for (const value of values) {
    if (isRealtimeFilterValue(value)) ids.add(value)
  }
  return [...ids].slice(0, 60)
}

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
  delivery_address?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  fabric_source: string | null
  special_note: string | null
  fabric_tracking: string | null
  customer_measurements_snapshot?: Record<string, unknown> | null
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
  fulfillment_payment_requested_at?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_provider?: string | null
  fulfillment_payment_intent_id?: string | null
  fulfillment_payment_checkout_url?: string | null
  consultation_fee?: number | null
  video_call_url?: string | null
  escrow_released: boolean | null
  auto_release_at: string | null
  collection_code: string | null
  collection_code_expiry: string | null
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
  read_at: string | null
  created_at: string | null
}

type AccountMessageReaction = {
  id: string
  message_id: string
  order_id: string
  user_id: string
  emoji: string
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
  payout_currency?: string | null
  payout_provider?: string | null
  payout_reverification_required?: boolean | null
  payout_account_type?: string | null
  payout_account_verified?: boolean | null
  payout_account_verified_at?: string | null
  payout_bank_name?: string | null
  payout_account_name?: string | null
  payout_account_masked?: string | null
  payout_country_code?: string | null
  manual_bank_entry?: boolean | null
  manual_bank_name?: string | null
  manual_bank_country_code?: string | null
  manual_bank_country_name?: string | null
  manual_bank_swift_bic?: string | null
  manual_bank_account_name?: string | null
  manual_bank_verification_status?: string | null
  manual_bank_submitted_at?: string | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
  payout_account_change_count?: number | null
  payout_account_last_changed_at?: string | null
  payout_account_change_locked_until?: string | null
  payout_destination_hold_until?: string | null
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

type ReadyMadeCheckoutPricingPreview = {
  currency: string
  displayCurrency?: string | null
  sourceCurrency?: string | null
  sourceSubtotal?: number | null
  fxRate?: number | null
  fxRateTimestamp?: string | null
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  taxRateBps: number
  taxRegion: string | null
  taxFallback: boolean
  taxFallbackReason: string | null
  shippingAmount: number
  totalAmount: number
  taxLabel: string | null
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

type AccountReview = {
  id: string
  order_id: string | null
  rating: number | null
  created_at: string | null
}

type PortfolioItem = {
  id: string
  image_url: string | null
  title: string | null
  description: string | null
  category: string | null
  sort_order: number | null
  created_at: string | null
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

type CustomOrderDetail = {
  order_id: string
  fabric_approval_required: boolean | null
  fabric_approval_status: string | null
  fabric_approval_requested_at?: string | null
  fabric_approved_at?: string | null
  fabric_changes_requested_at?: string | null
}

type AccountPayout = {
  id: string
  tailor_profile_id: string | null
  amount: number | null
  currency: string | null
  provider: string | null
  status: string | null
  provider_payout_id: string | null
  blocked_reason: string | null
  order_id: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  processed_at: string | null
}

type AccountBaseData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  warning: string | null
}

const emptyData: AccountBaseData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  warning: null,
}

type AccountShellData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  activeOrderCount: number
  customerActiveOrderCount: number
  tailorActiveOrderCount: number
  unreadCount: number
  checkoutPendingCount: number
  payoutNeedsSetup: boolean
  warning: string | null
}

type MeasurementsSurfaceData = {
  measurementProfiles: MeasurementProfile[]
  measurementScans: MeasurementScan[]
  warning: string | null
}

type MeasurementsRenderData = MeasurementsSurfaceData & {
  customerProfile: CustomerProfile | null
}

type ExploreSurfaceData = {
  exploreTailors: TailorProfile[]
  exploreItems: SellerItem[]
  warning: string | null
}

type ExploreRenderData = ExploreSurfaceData & {
  accountCurrency: string | null
}

type OrderActorData = {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type OrdersSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  messages: AccountMessage[]
  warning: string | null
}

type OrdersRenderData = OrdersSurfaceData & OrderActorData

type OrderDetailSurfaceData = {
  order: AccountOrder | null
  payments: AccountPayment[]
  messages: AccountMessage[]
  stageUpdates: StageUpdate[]
  productionEvidence: ProductionEvidence[]
  materialAdvances: MaterialAdvance[]
  customOrderDetail: CustomOrderDetail | null
  reviews: AccountReview[]
  warning: string | null
}

type OrderDetailRenderData = OrderDetailSurfaceData & OrderActorData & {
  customerProfile: CustomerProfile | null
}

type PayoutRenderData = {
  tailorProfile: TailorProfile | null
}

type SupportSurfaceData = {
  orders: AccountOrder[]
  warning: string | null
}

type SupportRenderData = SupportSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type ShopSurfaceData = {
  sellerItems: SellerItem[]
  exploreItems: SellerItem[]
  warning: string | null
}

type ShopRenderData = ShopSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type WorkSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  sellerItems: SellerItem[]
  warning: string | null
}

type WorkRenderData = WorkSurfaceData & OrderActorData

type BriefSurfaceData = {
  tailor: TailorProfile | null
  measurementProfiles: MeasurementProfile[]
  warning: string | null
}

type BriefRenderData = BriefSurfaceData & {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
}

type CheckoutSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  warning: string | null
}

type CheckoutRenderData = CheckoutSurfaceData & {
  userId: string | null
}

type EarningsSurfaceData = {
  payouts: AccountPayout[]
  orders: AccountOrder[]
  warning: string | null
}

type EarningsRenderData = EarningsSurfaceData & {
  tailorProfile: TailorProfile | null
}

type ProfileSurfaceData = {
  sellerItems: SellerItem[]
  portfolioItems: PortfolioItem[]
  warning: string | null
}

type ProfileRenderData = ProfileSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type SettingsSurfaceData = {
  orderCurrencies: string[]
  warning: string | null
}

type SettingsRenderData = SettingsSurfaceData & {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
}

type TailorDetailSurfaceData = {
  tailor: TailorProfile | null
  readyMade: SellerItem[]
  tailorReviews: TailorReview[]
  isSaved: boolean
  warning: string | null
}

type ItemDetailSurfaceData = {
  item: SellerItem | null
  warning: string | null
}

type ItemDetailRenderData = ItemDetailSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type MessagesSurfaceData = {
  orders: AccountOrder[]
  messages: AccountMessage[]
  reactions: AccountMessageReaction[]
  warning: string | null
}

type MessagesRenderData = MessagesSurfaceData & {
  userId: string | null
}

type SavedSurfaceData = {
  wishlistCollections: WishlistCollection[]
  wishlistItems: WishlistItem[]
  savedTailors: TailorProfile[]
  savedItems: SellerItem[]
  warning: string | null
}

const emptyShellData: AccountShellData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  activeOrderCount: 0,
  customerActiveOrderCount: 0,
  tailorActiveOrderCount: 0,
  unreadCount: 0,
  checkoutPendingCount: 0,
  payoutNeedsSetup: false,
  warning: null,
}

const emptyMeasurementsSurfaceData: MeasurementsSurfaceData = {
  measurementProfiles: [],
  measurementScans: [],
  warning: null,
}

const emptyExploreSurfaceData: ExploreSurfaceData = {
  exploreTailors: [],
  exploreItems: [],
  warning: null,
}

const emptyOrdersSurfaceData: OrdersSurfaceData = {
  orders: [],
  payments: [],
  messages: [],
  warning: null,
}

const emptyOrderDetailSurfaceData: OrderDetailSurfaceData = {
  order: null,
  payments: [],
  messages: [],
  stageUpdates: [],
  productionEvidence: [],
  materialAdvances: [],
  customOrderDetail: null,
  reviews: [],
  warning: null,
}

const emptySupportSurfaceData: SupportSurfaceData = {
  orders: [],
  warning: null,
}

const emptyShopSurfaceData: ShopSurfaceData = {
  sellerItems: [],
  exploreItems: [],
  warning: null,
}

const emptyWorkSurfaceData: WorkSurfaceData = {
  orders: [],
  payments: [],
  sellerItems: [],
  warning: null,
}

const emptyBriefSurfaceData: BriefSurfaceData = {
  tailor: null,
  measurementProfiles: [],
  warning: null,
}

const emptyCheckoutSurfaceData: CheckoutSurfaceData = {
  orders: [],
  payments: [],
  warning: null,
}

const emptyEarningsSurfaceData: EarningsSurfaceData = {
  payouts: [],
  orders: [],
  warning: null,
}

const emptyProfileSurfaceData: ProfileSurfaceData = {
  sellerItems: [],
  portfolioItems: [],
  warning: null,
}

const emptySettingsSurfaceData: SettingsSurfaceData = {
  orderCurrencies: [],
  warning: null,
}

const emptyTailorDetailSurfaceData: TailorDetailSurfaceData = {
  tailor: null,
  readyMade: [],
  tailorReviews: [],
  isSaved: false,
  warning: null,
}

const emptyItemDetailSurfaceData: ItemDetailSurfaceData = {
  item: null,
  warning: null,
}

const emptyMessagesSurfaceData: MessagesSurfaceData = {
  orders: [],
  messages: [],
  reactions: [],
  warning: null,
}

const emptySavedSurfaceData: SavedSurfaceData = {
  wishlistCollections: [],
  wishlistItems: [],
  savedTailors: [],
  savedItems: [],
  warning: null,
}

function accountDataFromShell(shellData: AccountShellData, warningOverride?: string | null): AccountBaseData {
  return {
    ...emptyData,
    userId: shellData.userId,
    accountCurrency: shellData.accountCurrency,
    customerProfile: shellData.customerProfile,
    tailorProfile: shellData.tailorProfile,
    warning: warningOverride ?? null,
  }
}

let _lastKnownSession: Session | null = null
const _shellCache = new Map<string, { shellData: AccountShellData; at: number }>()
const SHELL_CACHE_TTL = 45_000

function shellCacheRead(userId: string): AccountShellData | null {
  const e = _shellCache.get(userId)
  if (!e || Date.now() - e.at > SHELL_CACHE_TTL) return null
  return e.shellData
}

function shellCacheWrite(userId: string, shellData: AccountShellData) {
  _shellCache.set(userId, { shellData, at: Date.now() })
}

function shellCacheDelete(userId: string) {
  _shellCache.delete(userId)
}

function readCachedShellSnapshot() {
  const session = _lastKnownSession
  if (!session?.user.id) return null
  const shellData = shellCacheRead(session.user.id)
  return shellData ? { session, shellData } : null
}

async function fetchAccountShellDataCached(uid: string): Promise<AccountShellData> {
  const cached = shellCacheRead(uid)
  if (cached) return cached

  const result = await fetchAccountShellData(uid)
  shellCacheWrite(uid, result)
  return result
}

const surfaceCopy: Record<AccountSurface, { eyebrow: string; title: string; body: string }> = {
  explore: {
    eyebrow: 'Explore',
    title: 'Find the right tailor.',
    body: 'Browse tailor profiles, portfolio work, pricing, fulfillment, reviews, and ready-made pieces before you start a brief.',
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
    body: 'Review and reply inside real order threads. Calls, photos, and notes stay tied to the order.',
  },
  measurements: {
    eyebrow: 'Measurements',
    title: 'Fit records you can trust.',
    body: 'Named wearer profiles, Drapeon Vision scans, manual profiles, and measurement age all stay visible before ordering.',
  },
  brief: {
    eyebrow: 'Custom brief',
    title: 'Send a protected custom-order request.',
    body: 'Share the garment, references, fit context, fabric plan, and fulfillment preference. The tailor reviews the brief before quoting.',
  },
  shop: {
    eyebrow: 'Marketplace',
    title: 'Ready-made pieces from Drapeon tailors.',
    body: 'Browse available garments with price, stock, fit guidance, fulfillment options, and checkout from the item detail.',
  },
  work: {
    eyebrow: 'Tailor cockpit',
    title: 'Your business at a glance.',
    body: 'Active orders, availability, payout readiness, and the next action that needs your attention — all from one surface.',
  },
  earnings: {
    eyebrow: 'Earnings',
    title: 'Know what is pending, blocked, and paid.',
    body: 'Review payout records and order payment context from web. Money movement still follows provider checks, handoff windows, refunds, and ops controls.',
  },
  payout: {
    eyebrow: 'Payout setup',
    title: 'Keep payout readiness explicit.',
    body: 'Review payout destination status and use provider-backed setup paths where supported. Manual bank entry stays ops-reviewed before it can be trusted for payouts.',
  },
  profile: {
    eyebrow: 'Your profile',
    title: 'Storefront, setup, and trust.',
    body: 'Manage your live profile, payout readiness, portfolio, and how customers see your business on Drapeon.',
  },
  checkout: {
    eyebrow: 'Payment',
    title: 'Pay only when an order is ready.',
    body: 'Custom briefs move to payment after the tailor sends a quote. Ready-made pieces can go straight to checkout, and failed or pending payments stay attached to the order.',
  },
  saved: {
    eyebrow: 'Saved',
    title: 'Wishlists, saved tailors, and pieces.',
    body: 'Keep saved tailors, ready-made pieces, and planning lists easy to find.',
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Account settings without guesswork.',
    body: 'Review profile, currency, notifications, login security, privacy, support, and deletion routes.',
  },
  support: {
    eyebrow: 'Support',
    title: 'Get help with the right context.',
    body: 'Choose the issue type, include the order when possible, and keep payment, fit, delivery, and account questions routed clearly.',
  },
  'tailor-detail': {
    eyebrow: 'Tailor profile',
    title: 'Review the tailor before starting an order.',
    body: 'Portfolio, specialties, fulfillment, pricing, reviews, and ready-made pieces stay together before you choose.',
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
  const date = parseDateValue(value)
  if (!date) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null
  const normalized =
    typeof value === 'string' &&
    value.includes('T') &&
    !/(?:z|[+-]\d{2}:?\d{2})$/iu.test(value.trim())
      ? `${value.trim()}Z`
      : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function timestampMs(value: string | null | undefined, fallback = 0) {
  return parseDateValue(value)?.getTime() ?? fallback
}

function formatRelative(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return 'Recently'
  const deltaMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  const absoluteMinutes = Math.abs(deltaMinutes)
  if (absoluteMinutes <= 1) return 'Just now'
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (absoluteMinutes < 60) return formatter.format(deltaMinutes, 'minute')
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, 'hour')
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 30) return formatter.format(deltaDays, 'day')
  return formatDate(value) ?? 'Recently'
}

function formatMessageRelative(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return 'Recently'
  if (date.getTime() > Date.now()) return 'Just now'
  return formatRelative(value)
}

function autoReleaseLabel(value: string | null | undefined) {
  if (!value) return null
  const dateLabel = formatDate(value)
  const relative = formatRelative(value)
  return dateLabel ? `${relative} (${dateLabel})` : relative
}

function isHandoffStage(stage: string | null | undefined) {
  return ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COLLECTED'].includes(stage ?? '')
}

function readableCode(value: string | null | undefined) {
  if (!value) return null
  return value
    .replace(/\s+/g, '')
    .replace(/(.{2})/g, '$1 ')
    .trim()
}

function orderTitle(order: AccountOrder) {
  return safeUserText(order.item_title || order.garment_type, 'Drapeon order')
}

function orderAmount(order: AccountOrder) {
  return formatMoney(order.total_amount ?? order.quoted_amount, order.currency ?? order.quoted_currency)
}

function isTerminalOrder(order: AccountOrder) {
  return ['COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REFUNDED'].includes(order.stage ?? '')
}

const CUSTOMER_SELF_CANCEL_STAGES = new Set(['PENDING_QUOTE', 'CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED'])
const CUSTOMER_CANCELLATION_REVIEW_STAGES = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'FINISHING'])
const CUSTOMER_DELIVERY_REVIEW_STAGES = new Set(['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED'])
const CUSTOMER_DISPUTE_STAGES = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION'])
const CUSTOMER_RECEIPT_STAGES = new Set(['SHIPPED', 'OUT_FOR_DELIVERY'])
const CUSTOMER_COMPLETE_STAGES = new Set(['DELIVERED', 'COLLECTED'])
const CUSTOMER_AFTERCARE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE'])
const CUSTOMER_FABRIC_TRACKING_STAGES = new Set(['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'])
const PRE_CUTTING_STAGES = new Set(['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING'])
const SCOPE_CHANGE_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
])

const SCOPE_CHANGE_TYPE_OPTIONS = [
  { value: 'MEASUREMENT_AMENDMENT', label: 'Measurement amendment' },
  { value: 'STYLE_OR_REFERENCE', label: 'Style or reference' },
  { value: 'FABRIC_OR_MATERIAL', label: 'Fabric or material' },
  { value: 'ADD_OR_REMOVE_ITEM', label: 'Add or remove item' },
  { value: 'DEADLINE_OR_EVENT', label: 'Deadline or event' },
  { value: 'PAUSE_OR_RESTART', label: 'Pause or restart' },
  { value: 'REWORK_OR_ALTERATION', label: 'Rework or alteration' },
  { value: 'OTHER', label: 'Other' },
] as const

const SCOPE_CHANGE_IMPACT_OPTIONS = [
  { value: 'PRICE', label: 'Price' },
  { value: 'DEADLINE', label: 'Deadline' },
  { value: 'FIT', label: 'Fit' },
  { value: 'FABRIC', label: 'Fabric' },
  { value: 'STYLE', label: 'Style' },
  { value: 'FULFILLMENT', label: 'Fulfillment' },
] as const

const MATERIAL_ISSUE_REASON_OPTIONS = [
  { value: 'POOR_FABRIC_QUALITY', label: 'Poor fabric quality' },
  { value: 'INSUFFICIENT_YARDAGE', label: 'Insufficient yardage' },
  { value: 'FABRIC_NOT_RECEIVED', label: 'Fabric not received' },
  { value: 'WRONG_FABRIC_TYPE', label: 'Wrong fabric type' },
  { value: 'FABRIC_DAMAGED', label: 'Fabric damaged' },
  { value: 'FABRIC_MISMATCH', label: 'Fabric mismatch' },
] as const

const MATERIAL_ISSUE_RESPONSE_OPTIONS = [
  { value: 'REPLACE_FABRIC', label: 'I will replace the fabric' },
  { value: 'ASK_TAILOR_TO_SOURCE', label: 'Ask tailor to source fabric' },
  { value: 'REVISE_DESIGN', label: 'Revise the design' },
  { value: 'CANCEL_ORDER', label: 'Request cancellation review' },
] as const

const TAILOR_CANCELLATION_REASON_OPTIONS = [
  { value: 'ITEM_UNAVAILABLE', label: 'Item unavailable' },
  { value: 'ITEM_DAMAGED_BEFORE_DISPATCH', label: 'Item damaged before dispatch' },
  { value: 'TAILOR_CANNOT_FULFIL', label: 'Tailor cannot fulfil' },
  { value: 'DISPATCH_DELAY', label: 'Dispatch delay' },
  { value: 'OTHER', label: 'Other' },
] as const

const TAILOR_DELIVERY_REASON_OPTIONS = [
  { value: 'DISPATCH_DELAY', label: 'Dispatch delay' },
  { value: 'DELIVERY_FAILED', label: 'Delivery failed' },
  { value: 'RETURN_TO_SENDER', label: 'Return to sender' },
  { value: 'RECIPIENT_UNREACHABLE', label: 'Recipient unreachable' },
  { value: 'OTHER', label: 'Other' },
] as const

function measurementSnapshotForOrder(order: AccountOrder) {
  const snapshot = order.customer_measurements_snapshot
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
}

function orderNeedsMeasurementConfirmation(order: AccountOrder) {
  return measurementSnapshotForOrder(order)?.needsConfirmation === true
}

const ORDER_CALL_STAGES = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
])

type OrderSupportMeta = {
  consultation?: {
    status?: string | null
    requestedBy?: string | null
    feeAmount?: number | null
    feeCurrency?: string | null
    feeCreditable?: boolean | null
    requestNote?: string | null
    requestedAt?: string | null
    proposedStartAt?: string | null
    scheduledStartAt?: string | null
    scheduledEndAt?: string | null
    timezone?: string | null
    paidAt?: string | null
    paymentTiming?: string | null
  } | null
  orderCall?: {
    status?: string | null
    scheduledStartAt?: string | null
    scheduledEndAt?: string | null
    timezone?: string | null
    completedAt?: string | null
  } | null
  styleAlignment?: {
    requiredBeforeCutting?: boolean | null
    status?: string | null
    tailorInterpretation?: string | null
    instruction?: string | null
    customerExpectation?: string | null
    approvalRequestedAt?: string | null
    approvedAt?: string | null
    changeRequestedAt?: string | null
  } | null
  materialIssue?: {
    status?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
    response?: string | null
    responseLabel?: string | null
    responseNote?: string | null
  } | null
  scopeChange?: {
    status?: string | null
    requestedBy?: string | null
    type?: string | null
    typeLabel?: string | null
    summary?: string | null
    impacts?: string[] | null
    priceImpactMinor?: number | null
    deadlineImpact?: string | null
    responseNote?: string | null
  } | null
  cancellationReview?: {
    status?: string | null
    requestedBy?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
  } | null
  deliveryReview?: {
    status?: string | null
    requestedBy?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
  } | null
  dispatchRecord?: {
    bookedAt?: string | null
    premiumException?: boolean | null
  } | null
  fitProfile?: {
    requiresTailorReview?: boolean | null
    tailorMeasurementOverride?: boolean | null
    tailorMeasurementOverrideReason?: string | null
  } | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  fabricHandoffMode?: string | null
  fabricHandoffLabel?: string | null
}

function parseOrderSupportMeta(value: string | null | undefined): OrderSupportMeta {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as OrderSupportMeta
      : {}
  } catch {
    return {}
  }
}

function formatDateTime(value: string | null | undefined, timezone?: string | null) {
  const date = parseDateValue(value)
  if (!date) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function dateTimeLocalInputValue(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function canStartOrderCall(order: AccountOrder) {
  if (order.stage === 'CONSULTATION') return true
  return ORDER_CALL_STAGES.has(order.stage ?? '')
}

const CUSTOMER_ACTIVE_THREAD_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
])

const TAILOR_ACTIVE_THREAD_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'IN_DISPUTE',
])

function isActiveConversationOrder(order: AccountOrder, userId: string | null) {
  const stage = order.stage ?? ''
  if (order.customer_id === userId) return CUSTOMER_ACTIVE_THREAD_STAGES.has(stage)
  return TAILOR_ACTIVE_THREAD_STAGES.has(stage)
}

function isReadyMadeInquiryOrder(order: Pick<AccountOrder, 'order_kind' | 'stage' | 'seller_item_id'>) {
  return order.stage === 'PENDING_QUOTE' && (
    order.order_kind === 'READY_MADE' ||
    (typeof order.seller_item_id === 'string' && order.seller_item_id.trim().length > 0)
  )
}

function showOrderInOrdersSurface(order: AccountOrder, data: OrderActorData) {
  if (!isReadyMadeInquiryOrder(order)) return true
  return isTailorOrder(order, data)
}

function partyName(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    const tailor = firstJoinedRow(order.tailor_profiles)
    return safeEntityName(tailor?.business_name || tailor?.display_name, 'Tailor')
  }
  const customer = firstJoinedRow(order.customer_profiles)
  return safeEntityName(customer?.display_name, 'Customer')
}

function partyAvatar(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    return safeMediaUrl(firstJoinedRow(order.tailor_profiles)?.avatar_url ?? null, 'avatars')
  }
  return safeMediaUrl(firstJoinedRow(order.customer_profiles)?.avatar_url ?? null, 'avatars')
}

function partyKey(order: AccountOrder, userId: string | null): string {
  return order.customer_id === userId
    ? (order.tailor_profile_id ?? order.tailor_id ?? `_${order.id}`)
    : (order.customer_id ?? `_${order.id}`)
}

type PublicMediaBucket = 'avatars' | 'portfolio-photos' | 'seller-item-media'

const PUBLIC_MEDIA_BUCKETS: PublicMediaBucket[] = ['avatars', 'portfolio-photos', 'seller-item-media']
const TRUSTED_EXTERNAL_IMAGE_HOSTS = new Set(['images.unsplash.com'])

function isPublicMediaBucket(value: string): value is PublicMediaBucket {
  return PUBLIC_MEDIA_BUCKETS.includes(value as PublicMediaBucket)
}

function runtimeSupabaseUrl() {
  const envUrl = process.env.DRAPEON_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (envUrl.trim()) return envUrl.replace(/\/+$/u, '')

  if (typeof window === 'undefined') return ''
  return window.__DRAPEON_PUBLIC_ENV__?.supabaseUrl?.trim().replace(/\/+$/u, '') ?? ''
}

function encodeStoragePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function publicStorageMediaUrl(src: string, fallbackBucket: PublicMediaBucket) {
  const supabaseUrl = runtimeSupabaseUrl()
  if (!supabaseUrl) return null

  const parts = src
    .trim()
    .replace(/^\/+/u, '')
    .replace(/^public\//u, '')
    .split('/')
    .filter(Boolean)

  const first = parts[0] ?? ''
  const bucket = isPublicMediaBucket(first) ? first : fallbackBucket
  const objectParts = isPublicMediaBucket(first) ? parts.slice(1) : parts
  if (objectParts[0] === 'public') objectParts.shift()
  const objectPath = encodeStoragePath(objectParts.join('/'))
  if (!objectPath) return null

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}

function safeMediaUrl(src: string | null | undefined, bucket?: PublicMediaBucket) {
  if (!src) return null
  const value = src.trim()
  if (!value) return null
  if (value.startsWith('data:') || value.startsWith('blob:')) return value
  if (bucket && !/^(https?:)/iu.test(value)) return publicStorageMediaUrl(value, bucket)
  if (value.startsWith('/')) return value
  try {
    const url = new URL(value)
    const supabaseUrl = runtimeSupabaseUrl()
    const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : ''
    if (
      supabaseHost &&
      url.hostname === supabaseHost &&
      (url.pathname.startsWith('/storage/v1/object/public/') ||
        url.pathname.startsWith('/storage/v1/object/sign/'))
    ) {
      return value
    }
    if (url.protocol === 'https:' && TRUSTED_EXTERNAL_IMAGE_HOSTS.has(url.hostname)) {
      return value
    }
  } catch {
    return null
  }
  return null
}

function initialsForName(value: string | null | undefined) {
  const parts = safeEntityName(value, 'Drapeon')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return 'D'
  if (parts.length === 1) return (parts[0] ?? 'D').slice(0, 2).toUpperCase()
  return `${parts[0]?.charAt(0) ?? 'D'}${parts[parts.length - 1]?.charAt(0) ?? ''}`.toUpperCase()
}

function itemPhoto(item: SellerItem) {
  return stringList(item.photo_urls).map((src) => safeMediaUrl(src, 'seller-item-media')).find(Boolean) ?? null
}

function sizeGuideNotes(item: SellerItem) {
  const guide = item.size_guide
  return guide && typeof guide.notes === 'string' ? guide.notes : ''
}

function tailorPhoto(tailor: TailorProfile) {
  return stringList(tailor.portfolio_photo_urls).map((src) => safeMediaUrl(src, 'portfolio-photos')).find(Boolean) ?? safeMediaUrl(tailor.avatar_url, 'avatars') ?? null
}

function hasMeasurements(profile: CustomerProfile | null) {
  return !!profile?.measurements && Object.keys(profile.measurements).length > 0
}

function measurementCompleteness(measurements: Record<string, unknown> | null | undefined) {
  return measurementCoreCompleteness(measurements)
}

function measurementsForProfile(profile: MeasurementProfile, customerProfile: CustomerProfile | null) {
  const shouldMergeLegacy =
    profile.is_default === true &&
    (!profile.relationship || profile.relationship === 'SELF')
  return shouldMergeLegacy
    ? mergeMeasurementRecords(customerProfile?.measurements, profile.measurements)
    : profile.measurements ?? {}
}

const MEASUREMENT_FIELD_LABELS: Record<(typeof MEASUREMENT_FIELD_KEYS)[number], string> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulderWidth: 'Shoulder width',
  inseam: 'Inseam',
  sleeveLength: 'Sleeve length',
  neckCircumference: 'Neck circumference',
  underBust: 'Under bust',
  height: 'Height',
  backLength: 'Back length',
  outseam: 'Outseam',
  thighCircumference: 'Thigh circumference',
  kneeCircumference: 'Knee circumference',
  bicepCircumference: 'Bicep circumference',
  wristCircumference: 'Wrist circumference',
  headCircumference: 'Head circumference',
  hatBandLine: 'Hat band line',
  headLength: 'Head length',
  headWidth: 'Head width',
  earToEarOverCrown: 'Ear to ear over crown',
  frontToBackOverCrown: 'Front to back over crown',
  filaHeight: 'Fila height',
  torsoLength: 'Torso length',
}

const MEASUREMENT_PROFILE_METADATA_KEYS = new Set([
  'unit',
  'measurementProfileLabel',
  'measurementProfileUpdatedAt',
  'wearerContext',
  'fitStyle',
  'fitPassportVersion',
  'measurementSource',
  'measurementSourceLabel',
  'fitConfidence',
  'needsConfirmation',
  'confirmationReason',
  'confirmationFields',
  'confirmationRequestedAt',
  'confirmedAt',
  'confirmedBy',
  'confirmedFields',
  'garmentContext',
  'bodyShape',
  'fitFlags',
  'bodyNote',
  'bodyFlags',
  'symmetryFlags',
  'requiresTailorReview',
])

function hasEditableMeasurementValue(value: unknown) {
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  return false
}

function measurementEditorValue(
  measurements: Record<string, unknown> | null | undefined,
  field: { key: string; aliases?: readonly string[] },
) {
  if (!measurements) return undefined
  const candidates = [field.key, ...(field.aliases ?? [])]
  return candidates.map((key) => measurements[key]).find(hasEditableMeasurementValue)
}

function isEditableCustomMeasurementKey(key: string, value: unknown): boolean {
  const isTransientMetadata = isTransientMeasurementMetadataKey(String(key))
  return !isMeasurementFieldKey(key) &&
    !MEASUREMENT_PROFILE_METADATA_KEYS.has(key) &&
    !isTransientMetadata &&
    hasEditableMeasurementValue(value)
}

function coreMeasurementSummary(measurements: Record<string, unknown> | null | undefined) {
  return CORE_MEASUREMENT_FIELDS.map((field) => {
    const value = readMeasurementValue(measurements, field)
    if (value == null) return null
    return `${field.label}: ${safeUserText(String(value), 'Saved')}`
  }).filter((value): value is string => Boolean(value))
}

function scanConfidenceLabel(value: string | null | undefined) {
  if (!value) return 'Confidence pending'
  const numeric = Number.parseFloat(value)
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return 'Good confidence'
    if (numeric >= 0.6) return 'Review recommended'
    return 'Needs review'
  }
  return cleanLabel(value, 'Confidence pending')
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

const publicTailorProfileSelect =
  'id, user_id, display_name, business_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, tier, availability, is_live, is_verified, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, portfolio_photo_urls, avatar_url'

const ownTailorProfileSelect =
  `${publicTailorProfileSelect}, payout_currency, payout_provider, payout_reverification_required, payout_account_type, payout_account_verified, payout_account_verified_at, payout_bank_name, payout_account_name, payout_account_masked, payout_country_code, manual_bank_entry, manual_bank_name, manual_bank_country_code, manual_bank_country_name, manual_bank_swift_bic, manual_bank_account_name, manual_bank_verification_status, manual_bank_submitted_at, paystack_recipient_code, stripe_connect_account_id, payout_account_change_count, payout_account_last_changed_at, payout_account_change_locked_until, payout_destination_hold_until`

const sellerItemSelect =
  'id, tailor_profile_id, title, description, category, sizes, size_inventory, price_amount, currency, photo_urls, stock_status, inventory_quantity, size_guide, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(id, display_name, business_name, avatar_url, location)'

const accountOrderSelect = `
  id, reference, order_kind, garment_type, item_title, item_size, garment_description, occasion, stage, delivery_method,
  delivery_address, recipient_name, recipient_phone,
  fabric_source, special_note, fabric_tracking, customer_measurements_snapshot, quoted_amount, subtotal_amount, fulfillment_fee, shipping_amount,
  tax_amount, platform_fee_amount, total_amount, currency, quoted_currency, created_at, updated_at, deadline,
  quoted_completion_date, customer_id, tailor_id, tailor_profile_id, seller_item_id, payment_provider,
  fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
  consultation_fee, video_call_url, escrow_released, auto_release_at, collection_code, collection_code_expiry, collection_code_used,
  tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location)
`

async function hydrateOrderCustomerProfiles(
  supabase: ReturnType<typeof createClient>,
  orders: AccountOrder[],
): Promise<AccountOrder[]> {
  const customerIds = uniqueValues(orders.map((order) => order.customer_id))
  if (customerIds.length === 0) return orders

  const { data, error } = await supabase
    .from('customer_profiles')
    .select('user_id, display_name, avatar_url')
    .in('user_id', customerIds)

  if (error) return orders

  const profilesByUserId = new Map(
    ((data ?? []) as Array<{ user_id?: string | null; display_name?: string | null; avatar_url?: string | null }>)
      .filter((profile) => profile.user_id)
      .map((profile) => [
        profile.user_id!,
        {
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
        } satisfies JoinedProfile,
      ]),
  )

  return orders.map((order) => ({
    ...order,
    customer_profiles: order.customer_id ? (profilesByUserId.get(order.customer_id) ?? order.customer_profiles ?? null) : order.customer_profiles ?? null,
  }))
}

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
  return cleanLabel(item.stock_status, 'In stock')
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

async function functionHttpErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const context = (error as { context?: unknown }).context
  if (
    !context ||
    typeof context !== 'object' ||
    typeof (context as { clone?: unknown }).clone !== 'function'
  ) {
    return null
  }
  try {
    const text = await (context as Response).clone().text()
    if (!text.trim()) return null
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; code?: unknown }
      const message = typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : null
      return message?.trim() || null
    } catch {
      return text.trim()
    }
  } catch {
    return null
  }
}

async function invokeAccountFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = createClient()
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw new Error((await functionHttpErrorMessage(error)) ?? friendlyActionError(error))
  const payload = (data ?? {}) as Record<string, unknown>
  const message = typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : null
  if (payload.error) throw new Error(message ?? 'That action could not finish right now. Please try again.')
  return payload as T
}

type ReauthProofPurpose = 'ACCOUNT_DELETION' | 'EMAIL_CHANGE' | 'PASSWORD_CHANGE' | 'PHONE_CHANGE' | 'PAYOUT_ACCOUNT_CHANGE'

async function issueWebReauthProof(password: string, purpose: ReauthProofPurpose) {
  const result = await invokeAccountFunction<{ proof?: string; expiresAt?: string }>('reauth-proof-action', {
    action: 'issue-proof',
    password,
    purpose,
  })
  if (!result.proof) throw new Error('Could not confirm your current password. Try again.')
  return result
}

async function ensureDefaultWishlistCollection(userId: string) {
  const supabase = createClient()
  const name = 'My Go-To Tailors'
  const { data: existing, error: existingError } = await supabase
    .from('wishlist_collections')
    .select('id, name')
    .eq('customer_id', userId)
    .eq('name', name)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as { id: string; name: string }

  const { data: created, error: createError } = await supabase
    .from('wishlist_collections')
    .insert({ customer_id: userId, name })
    .select('id, name')
    .single()

  if (createError) throw createError
  return created as { id: string; name: string }
}

async function saveTailorDirectly(userId: string, tailorProfileId: string) {
  const collection = await ensureDefaultWishlistCollection(userId)
  const supabase = createClient()
  const { error: itemError } = await supabase
    .from('wishlist_items')
    .insert({
      collection_id: collection.id,
      item_type: 'TAILOR',
      tailor_id: tailorProfileId,
    })

  if (itemError && (itemError as { code?: string }).code !== '23505') throw itemError
}

async function removeSavedTailorDirectly(userId: string, tailorProfileId: string) {
  const supabase = createClient()
  const { data: collections, error: collectionsError } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', userId)

  if (collectionsError) throw collectionsError
  const collectionIds = (collections ?? []).map((collection: { id: string }) => collection.id)
  if (collectionIds.length > 0) {
    const { error: wishlistError } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('item_type', 'TAILOR')
      .eq('tailor_id', tailorProfileId)
      .in('collection_id', collectionIds)

    if (wishlistError) throw wishlistError
  }
}

async function isTailorSavedDirectly(userId: string, tailorProfileId: string) {
  const supabase = createClient()
  const { data: collections, error: collectionsError } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', userId)

  if (collectionsError) return false
  const collectionIds = (collections ?? []).map((collection: { id: string }) => collection.id)
  if (collectionIds.length === 0) return false

  const { data, error } = await supabase
    .from('wishlist_items')
    .select('id')
    .eq('item_type', 'TAILOR')
    .eq('tailor_id', tailorProfileId)
    .in('collection_id', collectionIds)
    .limit(1)
    .maybeSingle()

  if (error) return false
  return Boolean(data)
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

function minorUnitsInput(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return (value / 100).toFixed(2).replace(/\.00$/, '')
}

const WEB_GARMENT_TYPES = [
  'Agbada',
  'Kaftan',
  'Senator / Native set',
  'Iro and Buba',
  'Ankara dress',
  'Ankara co-ord',
  'Suit',
  'Dress shirt',
  'Wedding gown',
  'Evening gown',
  'Abaya',
  'Uniform',
  'Other',
]

const WEB_OCCASION_OPTIONS = [
  'Wedding',
  'Birthday',
  'Event',
  'Everyday',
  'Corporate / work',
  'Naming ceremony',
  'Religious ceremony',
  'Graduation',
  'Other',
]

function defaultDeadlineInput() {
  const date = new Date()
  date.setDate(date.getDate() + 28)
  return date.toISOString().slice(0, 10)
}

function dateInputToIso(value: string) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function linesToUrls(value: string) {
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseInventoryFromSizes(sizes: string[], inventoryValue: string) {
  const fallback = Number.parseInt(inventoryValue, 10)
  const count = Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  return Object.fromEntries(sizes.map((size, index) => [size, index === 0 ? count : 0]))
}

function isPayableOrder(order: AccountOrder) {
  if (
    order.stage === 'FINISHING' &&
    order.delivery_method !== 'LOCAL_COLLECTION' &&
    typeof order.fulfillment_fee === 'number' &&
    order.fulfillment_fee > 0 &&
    !!order.fulfillment_payment_requested_at &&
    !order.fulfillment_payment_paid_at
  ) {
    return true
  }
  if (order.order_kind === 'CUSTOM') {
    return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  if (order.order_kind === 'READY_MADE') {
    return ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  return false
}

function checkoutActionLabel(order: AccountOrder) {
  if (
    order.stage === 'FINISHING' &&
    order.delivery_method !== 'LOCAL_COLLECTION' &&
    !!order.fulfillment_payment_requested_at &&
    !order.fulfillment_payment_paid_at
  ) {
    return order.delivery_method === 'LOCAL_DELIVERY' ? 'Pay delivery fee' : 'Pay shipping fee'
  }
  if (order.stage === 'QUOTE_SENT') return 'Accept quote and pay'
  return 'Start secure checkout'
}

const ORDER_STAGE_VALUES: OrderStage[] = [
  'DRAFT',
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'IN_DISPUTE',
  'REFUNDED',
  'CANCELLED',
]

const ORDER_STAGE_SET = new Set<OrderStage>(ORDER_STAGE_VALUES)
const CUSTOM_TAILOR_STAGE_TARGETS: OrderStage[] = [
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
]

function asOrderStage(value: string | null | undefined): OrderStage | null {
  if (!value || !ORDER_STAGE_SET.has(value as OrderStage)) return null
  return value as OrderStage
}

function filterFulfillmentStage(order: AccountOrder, stage: OrderStage) {
  if (stage === 'READY_FOR_COLLECTION') return order.delivery_method === 'LOCAL_COLLECTION'
  if (stage === 'READY_FOR_DRAPE_DISPATCH') return order.delivery_method !== 'LOCAL_COLLECTION'
  return true
}

function nextStageOptions(order: AccountOrder): OrderStage[] {
  const currentStage = asOrderStage(order.stage)
  if (!currentStage) return []

  if (order.order_kind === 'READY_MADE') {
    if (currentStage === 'CONFIRMED') return ['FINISHING']
    if (currentStage === 'FINISHING') {
      return (['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'] as OrderStage[])
        .filter((stage) => canTransition(currentStage, stage, 'TAILOR'))
        .filter((stage) => filterFulfillmentStage(order, stage))
    }
    return []
  }

  return CUSTOM_TAILOR_STAGE_TARGETS
    .filter((stage) => canTransition(currentStage, stage, 'TAILOR'))
    .filter((stage) => filterFulfillmentStage(order, stage))
}

const CUSTOMER_STAGE_FLOW: OrderStage[] = [
  'PENDING_QUOTE',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
]

const NEEDS_ACTION_STAGES = new Set(['PENDING_QUOTE', 'QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'IN_DISPUTE'])
const PRODUCTION_STAGES = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'])
const DISPATCH_STAGES = new Set(['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY'])
const DONE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE', 'COMPLETED'])
const CLOSED_STAGES = new Set(['DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED'])
const PROBLEM_STAGES = new Set(['PAYMENT_FAILED', 'IN_DISPUTE', 'REFUNDED', 'CANCELLED'])

function stagePillClass(stage: string | null | undefined) {
  if (PROBLEM_STAGES.has(stage ?? '')) return 'border-rust bg-rust text-white'
  if (NEEDS_ACTION_STAGES.has(stage ?? '')) return 'border-rust/18 bg-rust/12 text-rust'
  if (PRODUCTION_STAGES.has(stage ?? '')) return 'border-needle/14 bg-needle/10 text-needle'
  if (DISPATCH_STAGES.has(stage ?? '')) return 'border-sky-200 bg-sky-50 text-sky-700'
  if (DONE_STAGES.has(stage ?? '') || CLOSED_STAGES.has(stage ?? '')) return 'border-ink/8 bg-ink/6 text-ink/54'
  return 'border-ink/8 bg-white text-ink/62'
}

function StagePill({ stage, label }: { stage: string | null | undefined; label?: string }) {
  return (
    <span className={`inline-flex w-fit shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${stagePillClass(stage)}`}>
      {label ?? cleanLabel(stage, 'In progress')}
    </span>
  )
}

function stageProgress(order: AccountOrder) {
  const current = asOrderStage(order.stage)
  if (!current) return 0
  if (CLOSED_STAGES.has(current)) return 100
  const index = CUSTOMER_STAGE_FLOW.indexOf(current)
  if (index < 0) return 12
  return Math.max(8, Math.round(((index + 1) / CUSTOMER_STAGE_FLOW.length) * 100))
}

function StageProgressBar({ order }: { order: AccountOrder }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink/8" aria-hidden="true">
      <div className="h-full rounded-full bg-needle" style={{ width: `${stageProgress(order)}%` }} />
    </div>
  )
}

function StageTimeline({ order }: { order: AccountOrder }) {
  const current = asOrderStage(order.stage)
  const currentIndex = current ? CUSTOMER_STAGE_FLOW.indexOf(current) : -1
  return (
    <div className="rounded-[1.25rem] border border-ink/6 bg-bone/55 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Stage progress</p>
        <StagePill stage={order.stage} />
      </div>
      <div className="mt-4">
        <StageProgressBar order={order} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {CUSTOMER_STAGE_FLOW.map((stage, index) => {
          const reached = currentIndex >= 0 && index <= currentIndex
          const active = current === stage
          return (
            <li
              key={stage}
              className={`rounded-[0.9rem] border px-3 py-2 text-xs font-semibold ${
                active
                  ? 'border-needle bg-needle text-white'
                  : reached
                    ? 'border-needle/16 bg-needle/8 text-needle'
                    : 'border-ink/6 bg-white/72 text-ink/44'
              }`}
            >
              {cleanLabel(stage)}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function orderActionCopy(order: AccountOrder, data: OrderActorData) {
  const stage = order.stage ?? ''
  if (isCustomerOrder(order, data)) {
    if (stage === 'QUOTE_SENT') return 'Review quote'
    if (stage === 'PAYMENT_PENDING' || stage === 'PAYMENT_FAILED') return 'Payment needed'
    if (['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COLLECTED'].includes(stage)) {
      return 'Check handoff'
    }
    if (stage === 'IN_DISPUTE') return 'Support active'
  }
  if (isTailorOrder(order, data)) {
    if (['PENDING_QUOTE', 'CONSULTATION'].includes(stage)) return 'Quote needed'
    if (stage === 'PAYMENT_FAILED') return 'Payment issue'
    if (stage === 'IN_DISPUTE') return 'Dispute active'
    if (nextStageOptions(order).length > 0) return 'Stage update'
  }
  return null
}

function workColumnFor(order: AccountOrder) {
  const stage = order.stage ?? ''
  if (NEEDS_ACTION_STAGES.has(stage)) return 'needs-action'
  if (PRODUCTION_STAGES.has(stage)) return 'production'
  if (DISPATCH_STAGES.has(stage)) return 'dispatched'
  return 'done'
}

function isCustomerOrder(order: AccountOrder, data: Pick<OrderActorData, 'userId'>) {
  return order.customer_id === data.userId
}

function isTailorOrder(order: AccountOrder, data: OrderActorData) {
  return Boolean(data.tailorProfile && (order.tailor_profile_id === data.tailorProfile.id || order.tailor_id === data.userId))
}

function datetimeLocalToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const MESSAGE_PHOTO_MAX_BYTES = 10 * 1024 * 1024
const MESSAGE_PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function validateMessagePhoto(file: File) {
  if (!MESSAGE_PHOTO_CONTENT_TYPES.has(file.type)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  if (file.size > MESSAGE_PHOTO_MAX_BYTES) {
    return 'Choose a photo under 10 MB.'
  }
  return null
}

async function reencodeImageFile(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('The photo could not be prepared for upload.'))
      element.src = objectUrl
    })

    const maxDimension = 2400
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The photo could not be prepared for upload.')
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) resolve(nextBlob)
        else reject(new Error('The photo could not be prepared for upload.'))
      }, 'image/jpeg', 0.88)
    })
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'message-photo'}.jpg`
    return new File([blob], name, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
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

async function uploadPrivateFile(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const filePath = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error('The image could not upload. Try a smaller photo.')
  return filePath
}

async function createMessageMediaSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage.from('message-media').createSignedUrl(storagePath, 3600)
  return data?.signedUrl ?? null
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

async function fetchAccountShellData(userId: string): Promise<AccountShellData> {
  const supabase = createClient()
  let warning: string | null = null

  const [accountRes, customerProfileRes, tailorProfileRes] = await Promise.all([
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
      .select(publicTailorProfileSelect)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const tailorProfile = tailorProfileRes.error ? null : ((tailorProfileRes.data ?? null) as TailorProfile | null)
  const orderFilter = tailorProfile?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfile.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  let activeOrderCount = 0
  let customerActiveOrderCount = 0
  let tailorActiveOrderCount = 0
  let unreadCount = 0
  let checkoutPendingCount = 0
  const ordersRes = await supabase
    .from('orders')
    .select('id, stage, order_kind, seller_item_id, customer_id, tailor_id, tailor_profile_id')
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  if (!ordersRes.error) {
    const orders = (ordersRes.data ?? []) as Array<{
      id: string
      stage: string | null
      order_kind: string | null
      seller_item_id: string | null
      customer_id: string | null
      tailor_id: string | null
      tailor_profile_id: string | null
    }>
    const activeOrders = orders.filter((order) => !isTerminalOrder(order as AccountOrder))
    const visibleCustomerActiveOrders = activeOrders.filter((order) => order.customer_id === userId && !isReadyMadeInquiryOrder(order))
    activeOrderCount = activeOrders.filter((order) => order.customer_id !== userId || !isReadyMadeInquiryOrder(order)).length
    customerActiveOrderCount = visibleCustomerActiveOrders.length
    tailorActiveOrderCount = activeOrders.filter((order) => (
      order.tailor_id === userId || Boolean(tailorProfile?.id && order.tailor_profile_id === tailorProfile.id)
    )).length
    checkoutPendingCount = orders.filter((order) => ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')).length

    const orderIds = orders.map((order) => order.id)
    if (orderIds.length > 0) {
      const messagesRes = await supabase
        .from('messages')
        .select('id, order_id, sender_id, read_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100)

      if (!messagesRes.error) {
        const messages = (messagesRes.data ?? []) as Array<{ sender_id: string | null; read_at: string | null }>
        unreadCount = messages.filter((message) => message.sender_id !== userId && !message.read_at).length
      }
    }
  }

  return {
    userId,
    accountCurrency: accountRes.error ? null : ((accountRes.data as { default_currency?: string | null } | null)?.default_currency ?? null),
    customerProfile: customerProfileRes.error ? null : ((customerProfileRes.data ?? null) as CustomerProfile | null),
    tailorProfile,
    activeOrderCount,
    customerActiveOrderCount,
    tailorActiveOrderCount,
    unreadCount,
    checkoutPendingCount,
    payoutNeedsSetup: Boolean(tailorProfile && (!tailorProfile.payout_account_verified || tailorProfile.payout_reverification_required)),
    warning,
  }
}

async function fetchMeasurementsSurfaceData(userId: string): Promise<MeasurementsSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const [measurementProfilesRes, measurementScansRes] = await Promise.all([
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
  ])

  if (measurementProfilesRes.error || measurementScansRes.error) {
    warning = 'Measurement records could not load. Refresh to retry.'
  }

  return {
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfile[]),
    measurementScans: measurementScansRes.error ? [] : ((measurementScansRes.data ?? []) as MeasurementScan[]),
    warning,
  }
}

async function fetchExploreSurfaceData(userId: string): Promise<ExploreSurfaceData> {
  void userId
  const supabase = createClient()
  let warning: string | null = null

  const exploreTailorsRes = await supabase
    .from('tailor_profiles')
    .select(publicTailorProfileSelect)
    .eq('is_live', true)
    .order('avg_rating', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(24)

  if (exploreTailorsRes.error) {
    warning = 'Explore records could not load. Refresh to retry.'
  }

  return {
    exploreTailors: exploreTailorsRes.error ? [] : ((exploreTailorsRes.data ?? []) as TailorProfile[]),
    exploreItems: [],
    warning,
  }
}

async function fetchOrdersSurfaceData(userId: string, tailorProfileId?: string | null): Promise<OrdersSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Order history could not load. Refresh to retry.'
  }

  let payments: AccountPayment[] = []
  let messages: AccountMessage[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const [paymentsRes, messagesRes] = await Promise.all([
      supabase
        .from('order_payments')
        .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('messages')
        .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (paymentsRes.error || messagesRes.error) {
      warning = warning ?? 'Latest order updates are unavailable. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
      messages = (messagesRes.data ?? []) as AccountMessage[]
    }
  }

  return {
    orders,
    payments,
    messages,
    warning,
  }
}

async function fetchOrderDetailSurfaceData(
  userId: string,
  orderId?: string,
  tailorProfileId?: string | null,
): Promise<OrderDetailSurfaceData> {
  if (!orderId) return emptyOrderDetailSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const orderRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .eq('id', orderId)
    .or(orderFilter)
    .maybeSingle()

  const order = orderRes.error || !orderRes.data
    ? null
    : (await hydrateOrderCustomerProfiles(supabase, [orderRes.data as AccountOrder]))[0] ?? null
  if (orderRes.error) {
    warning = 'Order detail could not load. Refresh to retry.'
  }
  if (!order) {
    return {
      ...emptyOrderDetailSurfaceData,
      warning,
    }
  }

  const [paymentsRes, messagesRes, stageUpdatesRes, productionEvidenceRes, materialAdvancesRes, customOrderDetailRes, reviewsRes] = await Promise.all([
    supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('messages')
      .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_stage_updates')
      .select('id, order_id, stage, note, photo_url, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_production_evidence')
      .select('id, order_id, stage_key, note, photo_urls, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_material_advances')
      .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, receipt_note, customer_response_note, payment_provider, provider_checkout_url, payment_id, created_at, updated_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('custom_order_details')
      .select('order_id, fabric_approval_required, fabric_approval_status, fabric_approval_requested_at, fabric_approved_at, fabric_changes_requested_at')
      .eq('order_id', order.id)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id, order_id, rating, created_at')
      .eq('order_id', order.id)
      .limit(80),
  ])

  if (paymentsRes.error || messagesRes.error || stageUpdatesRes.error || productionEvidenceRes.error || materialAdvancesRes.error || customOrderDetailRes.error || reviewsRes.error) {
    warning = warning ?? 'Latest order updates are unavailable. Refresh to retry.'
  }

  return {
    order,
    payments: paymentsRes.error ? [] : ((paymentsRes.data ?? []) as AccountPayment[]),
    messages: messagesRes.error ? [] : ((messagesRes.data ?? []) as AccountMessage[]),
    stageUpdates: stageUpdatesRes.error ? [] : ((stageUpdatesRes.data ?? []) as StageUpdate[]),
    productionEvidence: productionEvidenceRes.error ? [] : ((productionEvidenceRes.data ?? []) as ProductionEvidence[]),
    materialAdvances: materialAdvancesRes.error ? [] : ((materialAdvancesRes.data ?? []) as MaterialAdvance[]),
    customOrderDetail: customOrderDetailRes.error ? null : ((customOrderDetailRes.data ?? null) as CustomOrderDetail | null),
    reviews: reviewsRes.error ? [] : ((reviewsRes.data ?? []) as AccountReview[]),
    warning,
  }
}

async function fetchSupportSurfaceData(userId: string, tailorProfileId?: string | null): Promise<SupportSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(12)

  if (ordersRes.error) {
    warning = 'Support order context could not load. Refresh to retry.'
  }

  return {
    orders: ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[]),
    warning,
  }
}

async function fetchShopSurfaceData(userId: string, tailorProfileId?: string | null): Promise<ShopSurfaceData> {
  void userId
  const supabase = createClient()

  if (tailorProfileId) {
    const sellerItemsRes = await supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorProfileId)
      .order('updated_at', { ascending: false })
      .limit(30)

    return {
      sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
      exploreItems: [],
      warning: sellerItemsRes.error ? 'Shop records could not load. Refresh to retry.' : null,
    }
  }

  const exploreItemsRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('is_live', true)
    .neq('stock_status', 'SOLD_OUT')
    .neq('stock_status', 'HIDDEN')
    .order('updated_at', { ascending: false })
    .limit(18)

  return {
    sellerItems: [],
    exploreItems: exploreItemsRes.error ? [] : ((exploreItemsRes.data ?? []) as SellerItem[]),
    warning: exploreItemsRes.error ? 'Ready-made pieces could not load. Refresh to retry.' : null,
  }
}

async function fetchWorkSurfaceData(userId: string, tailorProfileId?: string | null): Promise<WorkSurfaceData> {
  if (!tailorProfileId) return emptyWorkSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Work queue could not load. Refresh to retry.'
  }

  let payments: AccountPayment[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const paymentsRes = await supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(80)

    if (paymentsRes.error) {
      warning = warning ?? 'Work payment state could not load. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
    }
  }

  const sellerItemsRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('tailor_profile_id', tailorProfileId)
    .order('updated_at', { ascending: false })
    .limit(30)

  if (sellerItemsRes.error) {
    warning = warning ?? 'Shop records could not load. Refresh to retry.'
  }

  return {
    orders,
    payments,
    sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
    warning,
  }
}

async function fetchBriefSurfaceData(userId: string, tailorId?: string): Promise<BriefSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const [tailorRes, measurementProfilesRes] = await Promise.all([
    tailorId
      ? supabase
          .from('tailor_profiles')
          .select(publicTailorProfileSelect)
          .eq('id', tailorId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('customer_measurement_profiles')
      .select('id, label, relationship, source, unit_preference, measurements, is_default, last_measured_at, updated_at')
      .eq('customer_id', userId)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(10),
  ])

  if (tailorRes.error) {
    warning = 'Tailor profile could not load. Refresh to retry.'
  }
  if (measurementProfilesRes.error) {
    warning = warning ?? 'Measurement records could not load. Refresh to retry.'
  }

  return {
    tailor: tailorRes.error ? null : ((tailorRes.data ?? null) as TailorProfile | null),
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfile[]),
    warning,
  }
}

async function fetchMessagesSurfaceData(userId: string, tailorProfileId?: string | null): Promise<MessagesSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(
      `
        id, reference, order_kind, garment_type, item_title, item_size, stage, total_amount, quoted_amount,
        currency, quoted_currency, special_note, video_call_url, created_at, updated_at, customer_id, tailor_id, tailor_profile_id,
        tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location)
      `,
    )
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Message threads could not load. Refresh to retry.'
  }

  let messages: AccountMessage[] = []
  let reactions: AccountMessageReaction[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const messagesRes = await supabase
      .from('messages')
      .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(100)

    if (messagesRes.error) {
      warning = warning ?? 'Messages could not load. Refresh to retry.'
    } else {
      messages = (messagesRes.data ?? []) as AccountMessage[]
    }

    const messageIds = messages.map((message) => message.id)
    if (messageIds.length > 0) {
      const reactionsRes = await supabase
        .from('message_reactions')
        .select('id, message_id, order_id, user_id, emoji, created_at')
        .in('message_id', messageIds)
        .order('created_at', { ascending: true })
        .limit(500)

      if (reactionsRes.error) {
        console.warn('[messages] Message reactions could not load.', reactionsRes.error.message)
      } else {
        reactions = (reactionsRes.data ?? []) as AccountMessageReaction[]
      }
    }
  }

  return {
    orders,
    messages,
    reactions,
    warning,
  }
}

async function fetchSavedSurfaceData(userId: string): Promise<SavedSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
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
    warning = 'Saved records could not load. Refresh to retry.'
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
        warning = warning ?? 'Wishlist items could not load. Refresh to retry.'
      } else {
        wishlistItems = (wishlistItemsRes.data ?? []) as WishlistItem[]
        const savedTailorIds = uniqueValues(wishlistItems.map((item) => item.tailor_id))
        const savedItemIds = uniqueValues(wishlistItems.map((item) => item.ready_made_item_id))

        if (savedTailorIds.length > 0) {
          const savedTailorsRes = await supabase
            .from('tailor_profiles')
            .select(publicTailorProfileSelect)
            .in('id', savedTailorIds)
            .limit(80)
          if (savedTailorsRes.error) {
            warning = warning ?? 'Saved tailors could not load. Refresh to retry.'
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
            warning = warning ?? 'Saved ready-made items could not load. Refresh to retry.'
          } else {
            savedItems = (savedItemsRes.data ?? []) as SellerItem[]
          }
        }
      }
    }
  }

  return {
    wishlistCollections,
    wishlistItems,
    savedTailors,
    savedItems,
    warning,
  }
}

async function fetchCheckoutSurfaceData(userId: string): Promise<CheckoutSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .eq('customer_id', userId)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Checkout orders could not load. Refresh to retry.'
  }

  const orderIds = orders.map((order) => order.id)
  let payments: AccountPayment[] = []

  if (orderIds.length > 0) {
    const paymentsRes = await supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(80)

    if (paymentsRes.error) {
      warning = warning ?? 'Checkout payment records could not load. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
    }
  }

  return {
    orders,
    payments,
    warning,
  }
}

async function fetchEarningsSurfaceData(userId: string, tailorProfileId?: string | null): Promise<EarningsSurfaceData> {
  if (!tailorProfileId) return emptyEarningsSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const [payoutsRes, ordersRes] = await Promise.all([
    supabase
      .from('payouts')
      .select('id, tailor_profile_id, amount, currency, provider, status, provider_payout_id, blocked_reason, order_id, initiated_at, completed_at, failed_at, processed_at')
      .eq('tailor_profile_id', tailorProfileId)
      .order('initiated_at', { ascending: false, nullsFirst: false })
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(80),
    supabase
      .from('orders')
      .select(accountOrderSelect)
      .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`)
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  if (payoutsRes.error) {
    warning = 'Payout records could not load. Refresh to retry.'
  }
  if (ordersRes.error) {
    warning = warning ?? 'Payout order context could not load. Refresh to retry.'
  }

  return {
    payouts: payoutsRes.error ? [] : ((payoutsRes.data ?? []) as AccountPayout[]),
    orders: ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[]),
    warning,
  }
}

async function fetchProfileSurfaceData(tailorProfileId?: string | null): Promise<ProfileSurfaceData> {
  if (!tailorProfileId) return emptyProfileSurfaceData

  const supabase = createClient()
  const [sellerItemsRes, portfolioItemsRes] = await Promise.all([
    supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorProfileId)
      .order('updated_at', { ascending: false })
      .limit(30),
    supabase
      .from('portfolio_items')
      .select('id, image_url, title, description, category, sort_order, created_at')
      .eq('tailor_profile_id', tailorProfileId)
      .order('sort_order', { ascending: true })
      .limit(20),
  ])

  let warning: string | null = null
  if (sellerItemsRes.error) {
    warning = 'Shop records could not load. Refresh to retry.'
  }
  if (portfolioItemsRes.error) {
    warning = warning ?? 'Portfolio records could not load. Refresh to retry.'
  }

  return {
    sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
    portfolioItems: portfolioItemsRes.error ? [] : ((portfolioItemsRes.data ?? []) as PortfolioItem[]),
    warning,
  }
}

async function fetchSettingsSurfaceData(userId: string, tailorProfileId?: string | null): Promise<SettingsSurfaceData> {
  const supabase = createClient()
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select('currency')
    .or(orderFilter)
    .not('currency', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(3)

  return {
    orderCurrencies: ordersRes.error
      ? []
      : uniqueValues((ordersRes.data ?? []).map((order) => (order as { currency?: string | null }).currency)),
    warning: ordersRes.error ? 'Settings order context could not load. Refresh to retry.' : null,
  }
}

async function fetchTailorDetailSurfaceData(userId: string, tailorId?: string): Promise<TailorDetailSurfaceData> {
  if (!tailorId) return emptyTailorDetailSurfaceData

  const supabase = createClient()
  const [tailorRes, readyMadeRes, tailorReviewsRes, isSaved] = await Promise.all([
    supabase
      .from('tailor_profiles')
      .select(publicTailorProfileSelect)
      .eq('id', tailorId)
      .maybeSingle(),
    supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorId)
      .order('updated_at', { ascending: false })
      .limit(18),
    supabase
      .from('reviews')
      .select('id, tailor_profile_id, rating, body, tags, reviewer_name, tailor_response, created_at, published_at')
      .eq('tailor_profile_id', tailorId)
      .not('published_at', 'is', null)
      .eq('flagged', false)
      .order('created_at', { ascending: false })
      .limit(8),
    isTailorSavedDirectly(userId, tailorId),
  ])

  let warning: string | null = null
  if (tailorRes.error) {
    warning = 'Tailor profile could not load. Refresh to retry.'
  }
  if (readyMadeRes.error) {
    warning = warning ?? 'Ready-made pieces could not load. Refresh to retry.'
  }
  if (tailorReviewsRes.error) {
    warning = warning ?? 'Tailor reviews could not load. Refresh to retry.'
  }

  return {
    tailor: tailorRes.error ? null : ((tailorRes.data ?? null) as TailorProfile | null),
    readyMade: readyMadeRes.error ? [] : ((readyMadeRes.data ?? []) as SellerItem[]),
    tailorReviews: tailorReviewsRes.error ? [] : ((tailorReviewsRes.data ?? []) as TailorReview[]),
    isSaved,
    warning,
  }
}

async function fetchItemDetailSurfaceData(itemId?: string): Promise<ItemDetailSurfaceData> {
  if (!itemId) return emptyItemDetailSurfaceData

  const supabase = createClient()
  const itemRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('id', itemId)
    .maybeSingle()

  return {
    item: itemRes.error ? null : ((itemRes.data ?? null) as SellerItem | null),
    warning: itemRes.error ? 'Ready-made item could not load. Refresh to retry.' : null,
  }
}

type AccountNavIcon =
  | 'briefcase'
  | 'card'
  | 'heart'
  | 'help'
  | 'logout'
  | 'message'
  | 'orders'
  | 'profile'
  | 'ruler'
  | 'search'
  | 'settings'
  | 'wallet'

function AccountNavGlyph({ name }: { name: AccountNavIcon }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0">
      {name === 'search' ? <path {...common} d="m21 21-4.4-4.4M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" /> : null}
      {name === 'orders' ? <path {...common} d="M7 3h10l2 3v15H5V6l2-3Zm-2 3h14M9 10h6M9 14h6M9 18h4" /> : null}
      {name === 'message' ? <path {...common} d="M4 5h16v11H8l-4 4V5Zm4 5h8M8 13h5" /> : null}
      {name === 'ruler' ? <path {...common} d="M4 17 17 4l3 3L7 20l-3-3Zm4-4 2 2m1-5 2 2m1-5 2 2" /> : null}
      {name === 'heart' ? <path {...common} d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1Z" /> : null}
      {name === 'briefcase' ? <path {...common} d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1m-9 0h14v13H5V6Zm0 5h14" /> : null}
      {name === 'card' ? <path {...common} d="M3 6h18v12H3V6Zm0 4h18M7 15h4" /> : null}
      {name === 'wallet' ? <path {...common} d="M4 7h15a2 2 0 0 1 2 2v8H4a2 2 0 0 1-2-2V5a2 2 0 0 0 2 2Zm13 5h4" /> : null}
      {name === 'profile' ? <path {...common} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" /> : null}
      {name === 'settings' ? <path {...common} d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13v3m0 13v3m8.2-15.2-2.1 2.1M5.9 18.1l-2.1 2.1m17.2-8.2h-3M6 12H3m15.2 6.2-2.1-2.1M5.9 5.9 3.8 3.8" /> : null}
      {name === 'help' ? <path {...common} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5h.01M9.5 9a2.7 2.7 0 1 1 4.5 2c-1 .8-2 1.3-2 2.8" /> : null}
      {name === 'logout' ? <path {...common} d="M10 17l5-5-5-5m5 5H3m7-9h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-8" /> : null}
    </svg>
  )
}

function AccountIdentityCard({
  session,
  shellData,
  signingOut,
  onSignOut,
  collapsed = false,
}: {
  session: Session
  shellData: AccountShellData
  signingOut: boolean
  onSignOut: () => void
  collapsed?: boolean
}) {
  const [signOutPending, setSignOutPending] = useState(false)
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function requestSignOut() {
    if (signingOut) return
    if (signOutPending) {
      if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current)
      setSignOutPending(false)
      onSignOut()
      return
    }
    setSignOutPending(true)
    signOutTimerRef.current = setTimeout(() => setSignOutPending(false), 3000)
  }

  function cancelSignOut() {
    if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current)
    setSignOutPending(false)
  }

  const email = session.user.email ?? ''
  const metadata = session.user.user_metadata ?? {}
  const metadataName = typeof metadata.display_name === 'string' ? metadata.display_name : null
  const isTailorRole = !!shellData.tailorProfile
  const customerName = shellData.customerProfile?.display_name ?? null
  const tailorName = shellData.tailorProfile?.business_name || shellData.tailorProfile?.display_name || null
  const displayName = safeEntityName(
    isTailorRole
      ? (tailorName || customerName || metadataName)
      : (customerName || tailorName || metadataName),
    email ? (email.split('@')[0] ?? 'Drapeon') : 'Drapeon',
  )
  const avatarUrl = safeMediaUrl(
    isTailorRole
      ? (shellData.tailorProfile?.avatar_url ?? shellData.customerProfile?.avatar_url)
      : (shellData.customerProfile?.avatar_url ?? shellData.tailorProfile?.avatar_url),
    'avatars',
  )

  return (
    <div className={collapsed ? 'border-t border-white/10 pt-4' : 'border-t border-white/10 px-2 pt-4'}>
      {/* Avatar — always links to settings */}
      <Link
        href="/account/settings"
        title="Account settings"
        className={collapsed ? 'flex justify-center' : 'flex items-center gap-3 rounded-[0.85rem] px-1 py-1 transition hover:bg-white/8'}
      >
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-sm font-semibold text-white ring-2 ring-white/14 transition group-hover:ring-white/28">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            initialsForName(displayName)
          )}
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{displayName}</p>
            {email ? <p className="mt-0.5 truncate text-xs text-white/56">{email}</p> : null}
          </div>
        ) : null}
      </Link>
      {/* Sign out — two-tap confirmation */}
      <div className={collapsed ? 'mx-auto mt-2 flex flex-col items-center gap-1' : 'mt-2 grid gap-1'}>
        <button
          type="button"
          onClick={requestSignOut}
          disabled={signingOut}
          title={signingOut ? 'Signing out' : signOutPending ? 'Tap again to confirm' : 'Sign out'}
          className={
            collapsed
              ? `grid size-11 place-items-center rounded-[0.85rem] border transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  signOutPending
                    ? 'border-rust/40 bg-rust/20 text-rust'
                    : 'border-white/28 bg-white/14 text-white hover:border-white/40 hover:bg-white/20'
                }`
              : `inline-flex w-full items-center gap-3 rounded-[0.85rem] border px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:text-white/30 ${
                  signOutPending
                    ? 'border-rust/30 bg-rust/14 text-rust'
                    : 'border-white/16 bg-white/8 text-white/80 hover:border-white/28 hover:bg-white/14 hover:text-white'
                }`
          }
        >
          <AccountNavGlyph name="logout" />
          {collapsed
            ? <span className="sr-only">{signingOut ? 'Signing out...' : signOutPending ? 'Confirm sign out' : 'Sign out'}</span>
            : <span>{signingOut ? 'Signing out...' : signOutPending ? 'Tap to confirm' : 'Sign out'}</span>}
        </button>
        {signOutPending && !collapsed ? (
          <button
            type="button"
            onClick={cancelSignOut}
            className="w-full rounded-[0.85rem] py-1 text-xs font-semibold text-white/44 transition hover:text-white/70"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}

function AccountRouteShell({
  session,
  data,
  shellData,
  surface,
  children,
}: {
  session: Session
  data: AccountBaseData
  shellData: AccountShellData
  surface: AccountSurface
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const hasTailorWorkspace = !!shellData.tailorProfile
  const tailorSurfaceCopy: Partial<Record<AccountSurface, { eyebrow: string; title: string; body: string }>> = {
    orders: {
      eyebrow: 'Order pipeline',
      title: 'Active, completed, and all orders.',
      body: 'Pending quotes and production orders stay at the top. Search and filter to find any order in your history.',
    },
    shop: {
      eyebrow: 'Your shop',
      title: 'Manage your ready-made catalogue.',
      body: 'Control item visibility, stock, pricing, and sizing. Published items appear to customers immediately.',
    },
    messages: {
      eyebrow: 'Messages',
      title: 'Order conversations with customers.',
      body: 'Every thread is tied to a live order. Reply here or open the app to send photos and updates.',
    },
    earnings: {
      eyebrow: 'Earnings',
      title: 'Pending, blocked, and paid — at a glance.',
      body: 'Payout records tied to each order. Money movement follows provider checks and handoff windows.',
    },
  }
  const copy = (hasTailorWorkspace ? tailorSurfaceCopy[surface] : undefined) ?? surfaceCopy[surface]
  const accountHomeHref = (hasTailorWorkspace ? '/account/work' : '/account/orders') as Route
  const customerActiveOrderCount = shellData.customerActiveOrderCount
  const tailorActiveOrderCount = shellData.tailorActiveOrderCount
  const unreadCount = shellData.unreadCount
  const checkoutPendingCount = shellData.checkoutPendingCount
  const payoutNeedsSetup = shellData.payoutNeedsSetup
  const isOrdersPath = pathname === '/account/orders' || Boolean(pathname?.startsWith('/account/orders/'))

  const groups: Array<{
    title: string
    items: Array<{ label: string; href: Route; icon: AccountNavIcon; badge?: string | null }>
  }> = hasTailorWorkspace
    ? [
        {
          title: 'Workspace',
          items: [
            { label: 'Dashboard', href: '/account/work' as Route, icon: 'briefcase' as const, badge: tailorActiveOrderCount > 0 ? String(tailorActiveOrderCount) : null },
            { label: 'Orders', href: '/account/orders' as Route, icon: 'orders' as const, badge: tailorActiveOrderCount > 0 ? String(tailorActiveOrderCount) : null },
            { label: 'Messages', href: '/account/messages' as Route, icon: 'message' as const, badge: unreadCount > 0 ? String(unreadCount) : null },
            { label: 'Shop', href: '/account/shop' as Route, icon: 'card' as const },
            { label: 'Earnings', href: '/account/earnings' as Route, icon: 'wallet' as const },
            { label: 'Payout', href: '/account/payout' as Route, icon: 'wallet' as const, badge: payoutNeedsSetup ? '!' : null },
            { label: 'Profile', href: '/account/profile' as Route, icon: 'profile' as const },
          ],
        },
        {
          title: 'Account',
          items: [
            { label: 'Settings', href: '/account/settings' as Route, icon: 'settings' as const },
            { label: 'Support', href: '/account/support' as Route, icon: 'help' as const },
          ],
        },
      ]
    : [
        {
          title: 'Buying',
          items: [
            { label: 'Explore', href: '/account/explore' as Route, icon: 'search' as const },
            { label: 'Marketplace', href: '/account/shop' as Route, icon: 'card' as const },
            { label: 'Saved', href: '/account/saved' as Route, icon: 'heart' as const },
            { label: 'Orders', href: '/account/orders' as Route, icon: 'orders' as const, badge: customerActiveOrderCount > 0 ? String(customerActiveOrderCount) : null },
            { label: 'Messages', href: '/account/messages' as Route, icon: 'message' as const, badge: unreadCount > 0 ? String(unreadCount) : null },
            { label: 'Measurements', href: '/account/measurements' as Route, icon: 'ruler' as const },
          ],
        },
        {
          title: 'Account',
          items: [
            { label: 'Settings', href: '/account/settings' as Route, icon: 'settings' as const },
            { label: 'Support', href: '/account/support' as Route, icon: 'help' as const },
          ],
        },
      ]

  function isActive(href: string) {
    if (!pathname) return false
    if (href === '/account/orders') return pathname === href || pathname.startsWith('/account/orders/')
    if (href === '/account/explore') return pathname === href || pathname.startsWith('/account/tailors/')
    if (href === '/account/shop') return pathname === href || pathname.startsWith('/account/items/')
    return pathname === href
  }

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setDrawerOpen(false)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (error) {
      console.warn('[account-shell] Sign out failed.', error)
    }
    clearWebSessionScope()
    setSigningOut(false)
    router.replace('/sign-in?signed_out=1')
    router.refresh()
  }

  function renderNav(collapsed = false) {
    return (
      <nav aria-label="Account navigation" className={collapsed ? 'grid justify-items-center gap-2' : 'grid gap-2'}>
        {groups.map((group, groupIndex) => (
          <div key={group.title} className={collapsed ? 'grid w-full justify-items-center gap-2' : 'grid gap-2'}>
            {groupIndex > 0 ? <hr className={collapsed ? 'my-1 w-10 border-white/10' : 'my-2 border-white/10'} /> : null}
            {group.items.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  title={item.label}
                  className={
                    collapsed
                      ? active
                        ? 'relative grid size-12 place-items-center rounded-[0.95rem] bg-needle text-white shadow-[0_10px_24px_rgba(45,111,82,0.3)]'
                        : 'relative grid size-12 place-items-center rounded-[0.95rem] text-white/70 transition hover:bg-white/10 hover:text-white'
                      : active
                        ? 'relative flex min-h-12 items-center justify-between gap-3 rounded-[0.95rem] bg-needle px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(45,111,82,0.3)]'
                        : 'relative flex min-h-12 items-center justify-between gap-3 rounded-[0.95rem] px-4 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white'
                  }
                >
                  <span className={collapsed ? 'grid place-items-center' : 'flex min-w-0 items-center gap-3'}>
                    <AccountNavGlyph name={item.icon} />
                    {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                  </span>
                  {item.badge && !collapsed ? (
                    <span className={active ? 'rounded-full bg-white/20 px-2 py-0.5 text-xs text-white' : 'rounded-full bg-white/10 px-2 py-0.5 text-xs text-white'}>
                      {item.badge}
                    </span>
                  ) : null}
                  {item.badge && collapsed ? (
                    <span className="absolute right-1 top-1 min-w-4 rounded-full bg-[#ef5b3a] px-1 text-center text-[0.62rem] font-semibold leading-4 text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="w-full px-4 py-4 sm:px-6 lg:px-0 lg:py-0 lg:pr-6">
        <div className="sticky top-2 z-30 rounded-[1rem] border border-white/10 bg-[#0f172a]/96 p-3 shadow-[0_10px_34px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Link href={accountHomeHref} className="flex items-center gap-3 text-2xl font-semibold text-white">
              <Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-[0.85rem]" />
              <span>Drapeon</span>
            </Link>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white"
              aria-expanded={drawerOpen}
              aria-controls="account-mobile-drawer"
            >
              Menu
            </button>
          </div>
        </div>

        {drawerOpen ? (
          <div id="account-mobile-drawer" className="fixed inset-0 z-50 bg-ink/45 p-4 backdrop-blur-sm lg:hidden">
            <div className="flex max-h-full flex-col overflow-y-auto rounded-[1.2rem] border border-white/10 bg-[#0f172a] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.36)]">
              <div className="flex items-center justify-between gap-4">
                <Link href={accountHomeHref} onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 text-2xl font-semibold text-white">
                  <Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-[0.85rem]" />
                  <span>Drapeon</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white"
                >
                  Close
                </button>
              </div>
              <div className="mt-5">{renderNav(false)}</div>
              <div className="mt-5">
                <AccountIdentityCard
                  session={session}
                  shellData={shellData}
                  signingOut={signingOut}
                  onSignOut={() => {
                    void signOut()
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className={sidebarCollapsed ? 'grid gap-4 lg:min-h-screen lg:grid-cols-[5.5rem_minmax(0,1fr)] lg:gap-6' : 'grid gap-4 lg:min-h-screen lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-6'}>
          <aside className={sidebarCollapsed ? 'sticky top-0 hidden h-screen border-r border-white/10 bg-[#0f172a] p-3 lg:block' : 'sticky top-0 hidden h-screen border-r border-white/10 bg-[#0f172a] p-4 lg:block'}>
            <div className="flex h-full flex-col">
              <button
                type="button"
                onClick={() => setSidebarCollapsed((current) => !current)}
                className="absolute -right-4 top-24 z-10 grid size-9 place-items-center rounded-full border border-ink/10 bg-white text-ink shadow-[0_8px_20px_rgba(15,23,42,0.16)] transition hover:bg-bone"
                aria-label={sidebarCollapsed ? 'Expand account menu' : 'Collapse account menu'}
                title={sidebarCollapsed ? 'Expand account menu' : 'Collapse account menu'}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className={sidebarCollapsed ? 'size-4 rotate-180 transition' : 'size-4 transition'}>
                  <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
                </svg>
              </button>
              <Link href={accountHomeHref} className={sidebarCollapsed ? 'flex justify-center' : 'flex items-center gap-3'}>
                <Image src="/icon-192.png" alt="" width={44} height={44} className="size-11 rounded-[0.9rem]" />
                {sidebarCollapsed ? <span className="sr-only">Drapeon</span> : <span className="text-2xl font-semibold text-white">Drapeon</span>}
              </Link>
              <div className={sidebarCollapsed ? 'mt-8 flex-1 overflow-y-auto' : 'mt-8 flex-1 overflow-y-auto pr-1'}>{renderNav(sidebarCollapsed)}</div>
              <div className="mt-4">
                <AccountIdentityCard
                  session={session}
                  shellData={shellData}
                  signingOut={signingOut}
                  collapsed={sidebarCollapsed}
                  onSignOut={() => {
                    void signOut()
                  }}
                />
              </div>
            </div>
          </aside>

          <div className="min-w-0 lg:py-4">
            {surface !== 'messages' ? (
              <section className="py-3 lg:pt-0">
                <div className="rounded-[1rem] border border-ink/8 bg-white/88 p-4 shadow-[0_10px_34px_rgba(22,28,24,0.05)]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-[0.68rem] font-semibold uppercase text-needle/80">{copy.eyebrow}</p>
                      <h1 className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-3xl">{copy.title}</h1>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/64">{copy.body}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {checkoutPendingCount > 0 ? (
                        <Link
                          href="/account/checkout"
                          className="inline-flex min-h-9 items-center rounded-full bg-rust px-3 text-xs font-semibold text-white"
                        >
                          Pay {checkoutPendingCount > 1 ? `(${checkoutPendingCount})` : ''}
                        </Link>
                      ) : null}
                      {!isOrdersPath ? (
                        <Link
                          href="/account/orders"
                          className="inline-flex min-h-9 items-center rounded-full border border-ink/10 bg-white px-3 text-xs font-semibold text-ink"
                        >
                          Orders
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  {data.warning ? (
                    <p className="mt-3 rounded-[0.75rem] border border-rust/18 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
                      {data.warning}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {children}
          </div>
        </div>
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
            Access your protected orders, messages, measurements, payments, and support.
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
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="hidden rounded-[1.5rem] border border-ink/8 bg-white/86 p-4 shadow-[0_18px_60px_rgba(22,28,24,0.06)] lg:block">
          <div className="h-10 w-32 animate-pulse rounded-full bg-ink/8" />
          <div className="mt-10 grid gap-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-11 animate-pulse rounded-[1rem] bg-ink/6" />
            ))}
          </div>
        </div>
        <div className="grid gap-5">
          <div className="rounded-[1.75rem] border border-ink/8 bg-white/86 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
            <div className="h-4 w-28 animate-pulse rounded-full bg-needle/12" />
            <div className="mt-5 h-12 w-2/3 animate-pulse rounded-[1rem] bg-ink/8" />
            <div className="mt-4 h-4 w-full animate-pulse rounded-full bg-ink/6" />
            <div className="mt-2 h-4 w-4/5 animate-pulse rounded-full bg-ink/6" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-[1.45rem] border border-ink/8 bg-white/80 p-5 shadow-sm">
                <div className="h-4 w-24 animate-pulse rounded-full bg-needle/12" />
                <div className="mt-4 h-8 w-3/4 animate-pulse rounded-[0.8rem] bg-ink/8" />
                <div className="mt-4 h-3 w-full animate-pulse rounded-full bg-ink/6" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-ink/6" />
              </div>
            ))}
          </div>
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

function MediaSlideshow({ media, label }: { media: string[]; label: string }) {
  const safeMedia = media.map((src) => safeMediaUrl(src)).filter((src): src is string => !!src)
  const [activeIndex, setActiveIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const activeSrc = safeMedia[activeIndex] ?? null

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-[1.15rem] border border-ink/8 bg-white">
        <PhotoTile src={activeSrc} label={label} />
      </div>
      {safeMedia.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {safeMedia.slice(0, expanded ? safeMedia.length : 5).map((src, index) => (
            <button
              key={`${src}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={
                activeIndex === index
                  ? 'h-14 w-14 overflow-hidden rounded-[0.8rem] border-2 border-needle bg-white'
                  : 'h-14 w-14 overflow-hidden rounded-[0.8rem] border border-ink/10 bg-white opacity-75 transition hover:opacity-100'
              }
              aria-label={`Show ${label} ${index + 1}`}
            >
              <PhotoTile src={src} label={`${label} ${index + 1}`} />
            </button>
          ))}
          {safeMedia.length > 5 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="inline-flex h-10 items-center rounded-full border border-ink/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-bone"
            >
              {expanded ? 'Show less' : `Show all ${safeMedia.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
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

function DisclosurePanel({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string
  summary?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details open={defaultOpen} className="group rounded-[1rem] border border-ink/8 bg-white/84 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:hidden">
        <span>
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {summary ? <span className="mt-1 block text-xs leading-5 text-ink/56">{summary}</span> : null}
        </span>
        <span className="shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-needle group-open:hidden">
          Show
        </span>
        <span className="hidden shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-ink/52 group-open:inline-flex">
          Hide
        </span>
      </summary>
      <div className="border-t border-ink/6 px-4 py-4">
        {children}
      </div>
    </details>
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
  const [declining, setDeclining] = useState(false)
  const [declineArmed, setDeclineArmed] = useState(false)
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

  async function declineQuote() {
    if (order.order_kind !== 'CUSTOM' || order.stage !== 'QUOTE_SENT') return
    setError(null)
    setSuccess(null)
    if (!declineArmed) {
      setDeclineArmed(true)
      setSuccess('Click decline once more to close this quote.')
      return
    }
    setDeclining(true)
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'decline-quote',
        orderId: order.id,
      })
      setDeclineArmed(false)
      setSuccess('Quote declined. This order is now closed.')
      onRefresh()
    } catch (declineError) {
      setError(friendlyActionError(declineError, 'Quote could not be declined. Refresh the order and try again.'))
      setSuccess(null)
    } finally {
      setDeclining(false)
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
        {busy ? 'Preparing checkout...' : checkoutActionLabel(order)}
      </button>
      {order.order_kind === 'CUSTOM' && order.stage === 'QUOTE_SENT' ? (
        <button
          type="button"
          onClick={() => { void declineQuote() }}
          disabled={declining || busy}
          className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
        >
          {declining ? 'Declining...' : declineArmed ? 'Confirm decline' : 'Decline quote'}
        </button>
      ) : null}
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
        {order.stage === 'QUOTE_SENT'
          ? 'Accepting prepares secure payment and moves the quote into payment pending. Production starts only after payment succeeds.'
          : 'If checkout is already processing, Drapeon will reuse the current attempt instead of creating a duplicate charge.'}
      </p>
    </div>
  )
}

type CustomerOrderActionName =
  | 'confirm-measurements'
  | 'cancel-order'
  | 'request-cancellation-review'
  | 'request-delivery-review'
  | 'approve-style-alignment'
  | 'request-style-alignment-change'
  | 'approve-sourced-fabric'
  | 'request-sourced-fabric-change'
  | 'respond-material-issue'
  | 'request-scope-change'
  | 'respond-scope-change'
  | 'open-dispute'
  | 'confirm-receipt'
  | 'complete-order'
  | 'request-aftercare-support'
  | 'request-emergency-support'
  | 'save-fabric-tracking'

const CUSTOMER_CANCELLATION_REASON_OPTIONS = [
  { value: 'CUSTOMER_CHANGED_MIND', label: 'Changed my mind' },
  { value: 'NEED_FULFILLMENT_CHANGE', label: 'Need pickup or delivery changed' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_DELIVERY_REASON_OPTIONS = [
  { value: 'DISPATCH_DELAY', label: 'Dispatch is taking too long' },
  { value: 'DELIVERY_FAILED', label: 'Delivery failed' },
  { value: 'RETURN_TO_SENDER', label: 'Returned to sender' },
  { value: 'MARKED_DELIVERED_NOT_RECEIVED', label: 'Marked delivered, not received' },
  { value: 'WRONG_ITEM_RECEIVED', label: 'Wrong item arrived' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_AFTERCARE_OPTIONS = [
  { value: 'FIT_ISSUE', label: 'Fit issue' },
  { value: 'FINISH_ISSUE', label: 'Finish issue' },
  { value: 'DAMAGE_OR_DEFECT', label: 'Damage or defect' },
  { value: 'ALTERATION_FOLLOW_UP', label: 'Alteration follow-up' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_DISPUTE_REASON_OPTIONS = [
  'Item was not received',
  'Quality or workmanship issue',
  'Delivery or pickup problem',
  'Timeline changed',
  'Wrong item or details',
  'Other',
] as const

function CustomerOrderActions({ order, data, onRefresh }: { order: AccountOrder; data: OrderDetailRenderData; onRefresh: () => void }) {
  const stage = order.stage ?? ''
  const supportMeta = parseOrderSupportMeta(order.special_note)
  const viewerIsCustomer = order.customer_id === data.userId
  const canConfirmMeasurements = orderNeedsMeasurementConfirmation(order)
  const canRespondStyleAlignment = order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
  const canRespondSourcedFabric = order.order_kind === 'CUSTOM' &&
    order.fabric_source === 'TAILOR_SOURCES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    data.customOrderDetail?.fabric_approval_required === true &&
    data.customOrderDetail.fabric_approval_status === 'PENDING_CUSTOMER_APPROVAL'
  const canRespondMaterialIssue = PRE_CUTTING_STAGES.has(stage) && supportMeta.materialIssue?.status === 'OPEN'
  const scopeChangeOpen = supportMeta.scopeChange?.status === 'OPEN'
  const cancellationReviewOpen = supportMeta.cancellationReview?.status === 'OPEN'
  const deliveryReviewOpen = supportMeta.deliveryReview?.status === 'OPEN'
  const canRequestScopeChange = order.order_kind === 'CUSTOM' &&
    SCOPE_CHANGE_STAGES.has(stage) &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen
  const canRespondScopeChange = SCOPE_CHANGE_STAGES.has(stage) &&
    scopeChangeOpen &&
    supportMeta.scopeChange?.requestedBy === 'TAILOR'
  const canCancelScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'CUSTOMER'
  const canSelfCancel = CUSTOMER_SELF_CANCEL_STAGES.has(stage)
  const canRequestCancellationReview = CUSTOMER_CANCELLATION_REVIEW_STAGES.has(stage)
  const canRequestDeliveryReview = CUSTOMER_DELIVERY_REVIEW_STAGES.has(stage)
  const canOpenDispute = CUSTOMER_DISPUTE_STAGES.has(stage)
  const canConfirmReceipt = CUSTOMER_RECEIPT_STAGES.has(stage)
  const canCompleteOrder = CUSTOMER_COMPLETE_STAGES.has(stage)
  const canRequestAftercare = CUSTOMER_AFTERCARE_STAGES.has(stage)
  const canRequestEmergencySupport = !isTerminalOrder(order) || CUSTOMER_AFTERCARE_STAGES.has(stage)
  const canSaveFabricTracking = order.fabric_source === 'CUSTOMER_SUPPLIES' && CUSTOMER_FABRIC_TRACKING_STAGES.has(stage)
  const hasActions =
    canConfirmMeasurements ||
    canRespondStyleAlignment ||
    canRespondSourcedFabric ||
    canRespondMaterialIssue ||
    canRequestScopeChange ||
    canRespondScopeChange ||
    canCancelScopeChange ||
    canSelfCancel ||
    canRequestCancellationReview ||
    canRequestDeliveryReview ||
    canOpenDispute ||
    canConfirmReceipt ||
    canCompleteOrder ||
    canRequestAftercare ||
    canRequestEmergencySupport ||
    canSaveFabricTracking

  const [busyAction, setBusyAction] = useState<CustomerOrderActionName | null>(null)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [fabricTracking, setFabricTracking] = useState(order.fabric_tracking ?? '')
  const [styleChangeNote, setStyleChangeNote] = useState('')
  const [fabricChangeNote, setFabricChangeNote] = useState('')
  const [materialIssueResponse, setMaterialIssueResponse] = useState<(typeof MATERIAL_ISSUE_RESPONSE_OPTIONS)[number]['value']>('REPLACE_FABRIC')
  const [materialIssueNote, setMaterialIssueNote] = useState('')
  const [customerScopeChangeType, setCustomerScopeChangeType] = useState<(typeof SCOPE_CHANGE_TYPE_OPTIONS)[number]['value']>('STYLE_OR_REFERENCE')
  const [customerScopeChangeSummary, setCustomerScopeChangeSummary] = useState('')
  const [customerScopeChangeImpacts, setCustomerScopeChangeImpacts] = useState<string[]>([])
  const [scopeChangeDecision, setScopeChangeDecision] = useState<'ACCEPTED' | 'DECLINED'>('ACCEPTED')
  const [scopeChangeResponseNote, setScopeChangeResponseNote] = useState('')
  const [cancellationReason, setCancellationReason] = useState<(typeof CUSTOMER_CANCELLATION_REASON_OPTIONS)[number]['value']>('CUSTOMER_CHANGED_MIND')
  const [cancellationNote, setCancellationNote] = useState('')
  const [deliveryReason, setDeliveryReason] = useState<(typeof CUSTOMER_DELIVERY_REASON_OPTIONS)[number]['value']>('DISPATCH_DELAY')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [aftercareType, setAftercareType] = useState<(typeof CUSTOMER_AFTERCARE_OPTIONS)[number]['value']>('FIT_ISSUE')
  const [aftercareNote, setAftercareNote] = useState('')
  const [emergencyNote, setEmergencyNote] = useState('')
  const [disputeReason, setDisputeReason] = useState<(typeof CUSTOMER_DISPUTE_REASON_OPTIONS)[number]>('Quality or workmanship issue')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!viewerIsCustomer || !hasActions) return null

  async function runCustomerAction(action: CustomerOrderActionName, body: Record<string, unknown>, successMessage: string) {
    setBusyAction(action)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('customer-order-action', {
        action,
        orderId: order.id,
        ...body,
      })
      setCancelArmed(false)
      setSuccess(successMessage)
      onRefresh()
    } catch (actionError) {
      setError(friendlyActionError(actionError, 'This order action could not finish. Refresh the order and try again.'))
      setSuccess(null)
    } finally {
      setBusyAction(null)
      setUploadStatus(null)
    }
  }

  async function confirmMeasurements() {
    await runCustomerAction('confirm-measurements', {}, 'Measurements confirmed. The tailor can continue when the order stage allows it.')
  }

  async function decideStyleAlignment(action: 'approve-style-alignment' | 'request-style-alignment-change') {
    const note = styleChangeNote.trim()
    const leak = assertNoContactLeak(note, "Style response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (action === 'request-style-alignment-change' && note.length < 5) {
      setError('Tell the tailor what needs to change before cutting.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      action,
      { note: action === 'request-style-alignment-change' ? note : undefined },
      action === 'approve-style-alignment' ? 'Style interpretation approved.' : 'Style clarification sent to the tailor.',
    )
    if (action === 'request-style-alignment-change') setStyleChangeNote('')
  }

  async function decideSourcedFabric(action: 'approve-sourced-fabric' | 'request-sourced-fabric-change') {
    const note = fabricChangeNote.trim()
    const leak = assertNoContactLeak(note, "Fabric response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (action === 'request-sourced-fabric-change' && note.length < 5) {
      setError('Tell the tailor what should change about the sourced fabric.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      action,
      { note: action === 'request-sourced-fabric-change' ? note : undefined },
      action === 'approve-sourced-fabric' ? 'Sourced fabric approved.' : 'Fabric change request sent to the tailor.',
    )
    if (action === 'request-sourced-fabric-change') setFabricChangeNote('')
  }

  async function respondMaterialIssue() {
    const note = materialIssueNote.trim()
    const leak = assertNoContactLeak(note, "Material issue response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'respond-material-issue',
      { materialIssueResponse, note: note || undefined },
      'Material issue response sent to the tailor.',
    )
    setMaterialIssueNote('')
  }

  function toggleCustomerScopeImpact(value: string) {
    setCustomerScopeChangeImpacts((current) =>
      current.includes(value)
        ? current.filter((impact) => impact !== value)
        : [...current, value],
    )
  }

  async function requestCustomerScopeChange() {
    const summary = customerScopeChangeSummary.trim()
    const leak = assertNoContactLeak(summary, "Change requests can't include contact details.")
    setError(null)
    setSuccess(null)
    if (summary.length < 10) {
      setError('Describe what needs to change so the tailor has a clear record.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-scope-change',
      {
        scopeChangeType: customerScopeChangeType,
        scopeChangeSummary: summary,
        scopeChangeImpacts: customerScopeChangeImpacts.length > 0 ? customerScopeChangeImpacts : undefined,
      },
      'Change request sent to the tailor.',
    )
    setCustomerScopeChangeSummary('')
    setCustomerScopeChangeImpacts([])
  }

  async function respondScopeChange(decisionOverride?: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    const decision = decisionOverride ?? scopeChangeDecision
    const note = scopeChangeResponseNote.trim()
    const leak = assertNoContactLeak(note, "Change response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'respond-scope-change',
      { scopeChangeDecision: decision, scopeChangeResponseNote: note || undefined },
      decision === 'ACCEPTED'
        ? 'Order change accepted.'
        : decision === 'DECLINED'
          ? 'Order change declined.'
          : 'Change request cancelled.',
    )
    setScopeChangeResponseNote('')
  }

  async function cancelOrder() {
    if (!cancelArmed) {
      setCancelArmed(true)
      setError(null)
      setSuccess('Click cancel order once more to close this order.')
      return
    }
    await runCustomerAction('cancel-order', {}, 'Order cancelled. Any eligible refund review has started.')
  }

  async function requestCancellationReview() {
    const note = cancellationNote.trim()
    const leak = assertNoContactLeak(note, "Cancellation review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    await runCustomerAction(
      'request-cancellation-review',
      { cancellationReason, note: note || undefined },
      'Cancellation review opened. Drapeon will review the order timeline before handoff continues.',
    )
    setCancellationNote('')
  }

  async function requestDeliveryReview() {
    const note = deliveryNote.trim()
    const leak = assertNoContactLeak(note, "Delivery review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    await runCustomerAction(
      'request-delivery-review',
      { deliveryReason, note: note || undefined },
      'Delivery review opened. Drapeon will check dispatch and handoff evidence.',
    )
    setDeliveryNote('')
  }

  async function openDispute() {
    const description = disputeDescription.trim()
    const leak = assertNoContactLeak(description, "Concern details can't include contact details.")
    setError(null)
    setSuccess(null)
    if (description.length < 10) {
      setError('Add a short description so Drapeon can understand what happened.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'open-dispute',
      { reason: disputeReason, description },
      'Concern opened. The order is paused for review.',
    )
    setDisputeDescription('')
  }

  async function confirmReceipt() {
    setError(null)
    setSuccess(null)
    if (!receiptFile) {
      setError('Add a proof photo before confirming receipt.')
      return
    }
    const photoError = validateMessagePhoto(receiptFile)
    if (photoError) {
      setError(photoError)
      return
    }

    setBusyAction('confirm-receipt')
    try {
      setUploadStatus('Preparing proof photo...')
      const preparedPhoto = await reencodeImageFile(receiptFile)
      setUploadStatus('Uploading proof photo...')
      const receiptPhotoUrl = await uploadPublicFile('order-photos', `receipts/${order.id}`, preparedPhoto)
      await invokeAccountFunction('customer-order-action', {
        action: 'confirm-receipt',
        orderId: order.id,
        receiptPhotoUrl,
      })
      setReceiptFile(null)
      setSuccess('Receipt confirmed. You can review the order once the record refreshes.')
      onRefresh()
    } catch (receiptError) {
      setError(friendlyActionError(receiptError, 'Receipt could not be confirmed. Try a smaller proof photo or refresh the order.'))
      setSuccess(null)
    } finally {
      setBusyAction(null)
      setUploadStatus(null)
    }
  }

  async function completeOrder() {
    await runCustomerAction('complete-order', {}, 'Order marked complete.')
  }

  async function requestAftercare() {
    const note = aftercareNote.trim()
    const leak = assertNoContactLeak(note, "Aftercare notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (note.length < 10) {
      setError('Add a short note about the fit, finish, or defect.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-aftercare-support',
      { aftercareType, note },
      'Aftercare request sent. Drapeon will review the fit or finish issue.',
    )
    setAftercareNote('')
  }

  async function requestEmergencySupport() {
    const description = emergencyNote.trim()
    const leak = assertNoContactLeak(description, "Emergency support notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (description.length < 10) {
      setError('Tell Drapeon what is wrong and when the event or wear date is.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-emergency-support',
      { description },
      'Emergency support request sent. Keep updates inside this order while Drapeon reviews it.',
    )
    setEmergencyNote('')
  }

  async function saveFabricTracking() {
    const value = fabricTracking.trim()
    const leak = assertNoContactLeak(value, "Tracking numbers can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!value) {
      setError('Add the carrier tracking number before saving.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'save-fabric-tracking',
      { fabricTracking: value },
      'Fabric tracking saved on this order.',
    )
  }

  return (
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer actions</p>
          <h2 className="mt-2 text-3xl text-ink">Manage this order.</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-ink/58">
          Actions shown here match the order stage and stay attached to the order record.
        </p>
      </div>
      <div className="mt-5 grid gap-3">
        <ActionNotice error={error} success={uploadStatus ?? success} />

        {canConfirmMeasurements ? (
          <DisclosurePanel
            title="Confirm measurements"
            summary="Let the tailor continue with the measurements attached to this order."
            defaultOpen
          >
            <div className="grid gap-3">
              <p className="text-sm leading-6 text-ink/62">
                Confirm only if these measurements are still correct. Cutting can stay paused until this is done.
              </p>
              <button
                type="button"
                onClick={() => { void confirmMeasurements() }}
                disabled={busyAction === 'confirm-measurements'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'confirm-measurements' ? 'Confirming...' : 'Confirm measurements'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondStyleAlignment ? (
          <DisclosurePanel
            title="Style alignment"
            summary={supportMeta.styleAlignment?.tailorInterpretation ?? 'Review the tailor style interpretation before cutting.'}
            defaultOpen
          >
            <div className="grid gap-3">
              <textarea
                value={styleChangeNote}
                onChange={(event) => setStyleChangeNote(event.target.value)}
                placeholder="Optional change note if this needs clarification."
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { void decideStyleAlignment('approve-style-alignment') }}
                  disabled={busyAction === 'approve-style-alignment'}
                  className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'approve-style-alignment' ? 'Approving...' : 'Approve style'}
                </button>
                <button
                  type="button"
                  onClick={() => { void decideStyleAlignment('request-style-alignment-change') }}
                  disabled={busyAction === 'request-style-alignment-change'}
                  className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'request-style-alignment-change' ? 'Sending...' : 'Request clarification'}
                </button>
              </div>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondSourcedFabric ? (
          <DisclosurePanel
            title="Sourced fabric"
            summary="Approve the tailor-sourced fabric or request a change before cutting."
            defaultOpen
          >
            <div className="grid gap-3">
              <textarea
                value={fabricChangeNote}
                onChange={(event) => setFabricChangeNote(event.target.value)}
                placeholder="Optional change note if the fabric is not right."
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { void decideSourcedFabric('approve-sourced-fabric') }}
                  disabled={busyAction === 'approve-sourced-fabric'}
                  className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'approve-sourced-fabric' ? 'Approving...' : 'Approve fabric'}
                </button>
                <button
                  type="button"
                  onClick={() => { void decideSourcedFabric('request-sourced-fabric-change') }}
                  disabled={busyAction === 'request-sourced-fabric-change'}
                  className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'request-sourced-fabric-change' ? 'Sending...' : 'Request fabric change'}
                </button>
              </div>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondMaterialIssue ? (
          <DisclosurePanel
            title="Material issue"
            summary={supportMeta.materialIssue?.reasonLabel ?? 'Choose how to handle the fabric issue.'}
            defaultOpen
          >
            <div className="grid gap-3">
              {supportMeta.materialIssue?.note ? (
                <p className="text-sm leading-6 text-ink/62">{safeUserText(supportMeta.materialIssue.note, '')}</p>
              ) : null}
              <select
                value={materialIssueResponse}
                onChange={(event) => setMaterialIssueResponse(event.target.value as typeof materialIssueResponse)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              >
                {MATERIAL_ISSUE_RESPONSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={materialIssueNote}
                onChange={(event) => setMaterialIssueNote(event.target.value)}
                placeholder="Optional note for the tailor."
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void respondMaterialIssue() }}
                disabled={busyAction === 'respond-material-issue'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'respond-material-issue' ? 'Sending...' : 'Send material response'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestScopeChange ? (
          <DisclosurePanel
            title="Request change"
            summary="Ask for a formal scope, fit, fabric, style, deadline, or fulfillment change."
          >
            <div className="grid gap-3">
              <select
                value={customerScopeChangeType}
                onChange={(event) => setCustomerScopeChangeType(event.target.value as typeof customerScopeChangeType)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              >
                {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => (
                  <label key={option.value} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/68">
                    <input
                      type="checkbox"
                      checked={customerScopeChangeImpacts.includes(option.value)}
                      onChange={() => toggleCustomerScopeImpact(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <textarea
                value={customerScopeChangeSummary}
                onChange={(event) => setCustomerScopeChangeSummary(event.target.value)}
                placeholder="What needs to change?"
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestCustomerScopeChange() }}
                disabled={busyAction === 'request-scope-change'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-scope-change' ? 'Sending...' : 'Send change request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondScopeChange || canCancelScopeChange ? (
          <DisclosurePanel
            title="Order change"
            summary={supportMeta.scopeChange?.summary ?? 'Review the open change request before work continues.'}
            defaultOpen
          >
            <div className="grid gap-3">
              {canRespondScopeChange ? (
                <>
                  <select
                    value={scopeChangeDecision}
                    onChange={(event) => setScopeChangeDecision(event.target.value as typeof scopeChangeDecision)}
                    className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
                  >
                    <option value="ACCEPTED">Accept change</option>
                    <option value="DECLINED">Decline change</option>
                  </select>
                  <textarea
                    value={scopeChangeResponseNote}
                    onChange={(event) => setScopeChangeResponseNote(event.target.value)}
                    placeholder="Optional response note."
                    className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
                  />
                  <button
                    type="button"
                    onClick={() => { void respondScopeChange() }}
                    disabled={busyAction === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busyAction === 'respond-scope-change' ? 'Saving...' : 'Send change response'}
                  </button>
                </>
              ) : null}
              {canCancelScopeChange ? (
                <button
                  type="button"
                  onClick={() => { void respondScopeChange('CANCELLED') }}
                  disabled={busyAction === 'respond-scope-change'}
                  className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'respond-scope-change' ? 'Cancelling...' : 'Cancel request'}
                </button>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {canSaveFabricTracking ? (
          <DisclosurePanel title="Fabric tracking" summary="Add the carrier tracking number when you are sending fabric to the tailor.">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={fabricTracking}
                onChange={(event) => setFabricTracking(event.target.value)}
                placeholder="Carrier tracking number"
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void saveFabricTracking() }}
                disabled={busyAction === 'save-fabric-tracking' || fabricTracking.trim() === (order.fabric_tracking ?? '')}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'save-fabric-tracking' ? 'Saving...' : 'Save tracking'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canSelfCancel ? (
          <DisclosurePanel title="Cancel order" summary="Close an early order before live production starts.">
            <button
              type="button"
              onClick={() => { void cancelOrder() }}
              disabled={busyAction === 'cancel-order'}
              className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
            >
              {busyAction === 'cancel-order' ? 'Cancelling...' : cancelArmed ? 'Confirm cancellation' : 'Cancel order'}
            </button>
          </DisclosurePanel>
        ) : null}

        {canRequestCancellationReview ? (
          <DisclosurePanel title="Cancellation review" summary="Ask Drapeon to review cancellation after production has started.">
            <div className="grid gap-3">
              <select
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value as typeof cancellationReason)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_CANCELLATION_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={cancellationNote}
                onChange={(event) => setCancellationNote(event.target.value)}
                placeholder="Add context for the review."
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestCancellationReview() }}
                disabled={busyAction === 'request-cancellation-review'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-cancellation-review' ? 'Opening review...' : 'Open cancellation review'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestDeliveryReview ? (
          <DisclosurePanel title="Delivery review" summary="Use this if dispatch, delivery, or handoff looks wrong.">
            <div className="grid gap-3">
              <select
                value={deliveryReason}
                onChange={(event) => setDeliveryReason(event.target.value as typeof deliveryReason)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_DELIVERY_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={deliveryNote}
                onChange={(event) => setDeliveryNote(event.target.value)}
                placeholder="What happened with dispatch or delivery?"
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestDeliveryReview() }}
                disabled={busyAction === 'request-delivery-review'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-delivery-review' ? 'Opening review...' : 'Open delivery review'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canConfirmReceipt ? (
          <DisclosurePanel
            title="Confirm receipt"
            summary="Add proof that the item is in hand before closing delivery."
            defaultOpen
          >
            <div className="grid gap-3">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
              />
              <button
                type="button"
                onClick={() => { void confirmReceipt() }}
                disabled={busyAction === 'confirm-receipt'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'confirm-receipt' ? 'Confirming...' : 'Confirm receipt'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canCompleteOrder ? (
          <DisclosurePanel title="Complete order" summary="Mark the order complete after delivery or collection is settled.">
            <button
              type="button"
              onClick={() => { void completeOrder() }}
              disabled={busyAction === 'complete-order'}
              className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
            >
              {busyAction === 'complete-order' ? 'Completing...' : 'Mark complete'}
            </button>
          </DisclosurePanel>
        ) : null}

        {canRequestAftercare ? (
          <DisclosurePanel title="Aftercare" summary="Raise a fit, finish, damage, or alteration issue after handoff.">
            <div className="grid gap-3">
              <select
                value={aftercareType}
                onChange={(event) => setAftercareType(event.target.value as typeof aftercareType)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_AFTERCARE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={aftercareNote}
                onChange={(event) => setAftercareNote(event.target.value)}
                placeholder="Describe the fit, finish, or defect."
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestAftercare() }}
                disabled={busyAction === 'request-aftercare-support'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-aftercare-support' ? 'Sending...' : 'Send aftercare request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canOpenDispute ? (
          <DisclosurePanel title="Raise a concern" summary="Pause the order for Drapeon review when something is wrong.">
            <div className="grid gap-3">
              <select
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value as typeof disputeReason)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_DISPUTE_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
              <textarea
                value={disputeDescription}
                onChange={(event) => setDisputeDescription(event.target.value)}
                placeholder="Describe what happened."
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void openDispute() }}
                disabled={busyAction === 'open-dispute'}
                className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'open-dispute' ? 'Opening concern...' : 'Raise concern'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestEmergencySupport ? (
          <DisclosurePanel title="Event emergency" summary="Use this for urgent event or wear-date problems.">
            <div className="grid gap-3">
              <textarea
                value={emergencyNote}
                onChange={(event) => setEmergencyNote(event.target.value)}
                placeholder="What is wrong, and when is the event or wear date?"
                className="min-h-24 rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestEmergencySupport() }}
                disabled={busyAction === 'request-emergency-support'}
                className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'request-emergency-support' ? 'Sending...' : 'Request emergency help'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}
      </div>
    </section>
  )
}

function useMessageMediaUrl(raw: string | null | undefined): string | null {
  const immediate = useMemo(() => safeMediaUrl(raw) ?? null, [raw])
  const storagePath = useMemo(() => {
    if (!raw || immediate) return null
    if (raw.startsWith('messages/')) return raw
    if (raw.startsWith('message-media/')) return raw.replace(/^message-media\//, '')
    return null
  }, [immediate, raw])
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!storagePath) return undefined
    let cancelled = false
    void createMessageMediaSignedUrl(storagePath).then((url) => {
      if (!cancelled) setSigned({ path: storagePath, url })
    })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (immediate) return immediate
  if (!storagePath) return null
  return signed?.path === storagePath ? signed.url : null
}

function MessageContent({ message, compact = false }: { message: AccountMessage; compact?: boolean }) {
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const voiceUrl = useMessageMediaUrl(message.voice_url)
  const text = safeUserText(
    message.body,
    photoUrl ? 'Photo message' : voiceUrl ? 'Voice note' : 'Message activity recorded.',
  )

  return (
    <div className="mt-2 grid gap-3">
      <p className={`${compact ? 'line-clamp-3' : ''} text-sm leading-6 text-ink/66`}>
        {text}
      </p>
      {photoUrl ? (
        <a
          href={photoUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-[1rem] border border-ink/8 bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="Order message attachment" className="max-h-64 w-full object-cover" />
          <span className="block px-3 py-2 text-xs font-semibold text-needle">Open full-size photo</span>
        </a>
      ) : null}
      {voiceUrl ? <audio controls src={voiceUrl} className="mt-1 w-full max-w-xs" /> : null}
    </div>
  )
}

const MESSAGE_REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '🙏'] as const

function MessageReactionBar({
  reactions,
  userId,
  mine,
  open,
  onOpenChange,
  onToggle,
}: {
  reactions: AccountMessageReaction[]
  userId: string | null
  mine: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (emoji: string) => void
}) {
  const counts = MESSAGE_REACTION_OPTIONS.map((emoji) => {
    const matching = reactions.filter((reaction) => reaction.emoji === emoji)
    return {
      emoji,
      count: matching.length,
      selected: Boolean(userId && matching.some((reaction) => reaction.user_id === userId)),
    }
  })
  const visibleCounts = counts.filter(({ count }) => count > 0)

  return (
    <div className={`relative mt-2 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
      {visibleCounts.map(({ emoji, count, selected }) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={
            selected
              ? mine
                ? 'rounded-full bg-white/22 px-2 py-1 text-xs font-semibold text-white'
                : 'rounded-full bg-needle/12 px-2 py-1 text-xs font-semibold text-needle'
              : mine
                ? 'rounded-full bg-white/12 px-2 py-1 text-xs font-semibold text-white/78 transition hover:bg-white/22'
                : 'rounded-full bg-ink/5 px-2 py-1 text-xs font-semibold text-ink/64 transition hover:bg-needle/10 hover:text-needle'
          }
          aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
        >
          <span aria-hidden="true">{emoji}</span>
          <span className="ml-1">{count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={
          mine
            ? 'rounded-full px-2 py-1 text-xs font-semibold text-white/48 transition hover:bg-white/12 hover:text-white'
            : 'rounded-full px-2 py-1 text-xs font-semibold text-ink/36 transition hover:bg-ink/5 hover:text-ink'
        }
        aria-expanded={open}
        aria-label={open ? 'Hide reactions' : 'React to message'}
      >
        +
      </button>
      {open ? (
        <div className={`absolute bottom-full z-20 mb-1 flex gap-1 rounded-full border border-ink/8 bg-white p-1 shadow-lg ${mine ? 'right-0' : 'left-0'}`}>
          {counts.map(({ emoji, count, selected }) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggle(emoji)
                onOpenChange(false)
              }}
              className={`rounded-full px-2 py-1 text-sm transition ${selected ? 'bg-needle/12 text-needle' : 'text-ink/64 hover:bg-ink/5 hover:text-ink'}`}
              aria-pressed={selected}
              aria-label={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
            >
              <span aria-hidden="true">{emoji}</span>
              {count > 0 ? <span className="ml-1 text-xs font-semibold">{count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MessageComposer({ order, onRefresh }: { order: AccountOrder; onRefresh: () => void }) {
  const account = useAccountContext()
  const [body, setBody] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [callBusy, setCallBusy] = useState<string | null>(null)
  const [callTime, setCallTime] = useState('')
  const [callReason, setCallReason] = useState('OTHER')
  const [consultationTime, setConsultationTime] = useState('')
  const [consultationNote, setConsultationNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const canMessage = !isTerminalOrder(order)
  const isReadyMade = order.order_kind === 'READY_MADE'
  const isCustomOrder = order.order_kind === 'CUSTOM' || !order.order_kind
  const supportMeta = useMemo(() => parseOrderSupportMeta(order.special_note), [order.special_note])
  const consultationMeta = supportMeta.consultation ?? null
  const orderCallMeta = supportMeta.orderCall ?? null
  const viewerIsCustomer = order.customer_id === account.userId
  const canRequestConsultation = isCustomOrder && viewerIsCustomer && order.stage === 'PENDING_QUOTE'
  const consultationLabel = formatDateTime(consultationMeta?.scheduledStartAt ?? consultationMeta?.proposedStartAt, consultationMeta?.timezone)
  const readyMadeCallLabel = formatDateTime(orderCallMeta?.scheduledStartAt, orderCallMeta?.timezone)

  async function sendMessage() {
    const trimmed = body.trim()
    setError(null)
    setSuccess(null)
    setUploadStatus(null)
    if (!trimmed && !photoFile) {
      setError('Write a message or attach a photo before sending.')
      return
    }
    if (trimmed) {
      const leak = assertNoContactLeak(trimmed)
      if (leak) {
        setError(leak)
        return
      }
    }
    if (photoFile) {
      const photoError = validateMessagePhoto(photoFile)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    setBusy(true)
    try {
      if (photoFile) {
        setUploadStatus('Preparing photo...')
        const preparedPhoto = await reencodeImageFile(photoFile)
        setUploadStatus('Uploading...')
        const storagePath = await uploadPrivateFile('message-media', `messages/${order.id}`, preparedPhoto)
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'PHOTO',
          photoUrl: storagePath,
        })
      }
      if (trimmed) {
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'TEXT',
          body: trimmed,
        })
      }
      setBody('')
      setPhotoFile(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
      setSuccess(photoFile && trimmed ? 'Photo and message sent inside the protected order thread.' : photoFile ? 'Photo sent inside the protected order thread.' : 'Message sent inside the protected order thread.')
      onRefresh()
    } catch (messageError) {
      setError(friendlyActionError(messageError, 'Message could not send. Please try again with a smaller image or text only.'))
    } finally {
      setBusy(false)
      setUploadStatus(null)
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

  async function requestConsultation() {
    const scheduledStartAt = datetimeLocalToIso(consultationTime)
    const note = consultationNote.trim()
    const leak = assertNoContactLeak(note, "Consultation notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!scheduledStartAt) {
      setError('Choose a valid consultation time.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    setCallBusy('consultation')
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'request-consultation',
        orderId: order.id,
        scheduledStartAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        note: note || undefined,
      })
      setConsultationTime('')
      setConsultationNote('')
      setSuccess('Consultation request sent. The tailor can approve, reschedule, price, or decline it from their order view.')
      onRefresh()
    } catch (consultationError) {
      setError(friendlyActionError(consultationError, 'Consultation could not be requested. Choose another time and try again.'))
    } finally {
      setCallBusy(null)
    }
  }

  async function startCall(callType: 'audio' | 'video') {
    setError(null)
    setSuccess(null)
    if (!canStartOrderCall(order)) {
      setError(order.stage === 'PENDING_QUOTE'
        ? 'Request a consultation before starting a call on this custom order.'
        : 'Calls open after payment is confirmed while the order is active.')
      return
    }
    if (isReadyMade && orderCallMeta?.status !== 'SCHEDULED') {
      setError('Schedule this ready-made call first so both sides know when to join.')
      return
    }
    setCallBusy(callType)
    try {
      const functionName = order.stage === 'CONSULTATION' ? 'create-consultation-room' : 'create-order-call-room'
      const result = await invokeAccountFunction<{ url?: string | null; fallback?: string; message?: string }>(functionName, {
        orderId: order.id,
        callType,
      })
      onRefresh()
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer')
        setSuccess(order.stage === 'CONSULTATION' ? `Consultation ${callType} opened in a new tab.` : `Drape ${callType} call opened in a new tab.`)
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
    <div className="grid min-w-0 gap-0 overflow-hidden">
      <ActionNotice error={error} success={success} />

      {/* Toolbar — always visible */}
      <div className="flex items-center gap-1 px-1 pb-2">
        {/* Hidden file input */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null
            const photoError = nextFile ? validateMessagePhoto(nextFile) : null
            setError(photoError)
            setPhotoFile(photoError ? null : nextFile)
            if (photoError && photoInputRef.current) photoInputRef.current.value = ''
          }}
          disabled={busy}
        />
        <button
          type="button"
          title="Attach photo"
          onClick={() => photoInputRef.current?.click()}
          disabled={busy}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base transition ${photoFile ? 'bg-needle/14 text-needle' : 'text-ink/44 hover:bg-ink/6 hover:text-ink'}`}
        >
          &#128206;
        </button>
        <button
          type="button"
          title="Audio call"
          onClick={() => { void startCall('audio') }}
          disabled={!!callBusy}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-base text-ink/44 transition hover:bg-ink/6 hover:text-ink disabled:cursor-not-allowed disabled:text-ink/20"
        >
          {callBusy === 'audio' ? '⏳' : '📞'}
        </button>
        <button
          type="button"
          title="Video call"
          onClick={() => { void startCall('video') }}
          disabled={!!callBusy}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-base text-ink/44 transition hover:bg-ink/6 hover:text-ink disabled:cursor-not-allowed disabled:text-ink/20"
        >
          {callBusy === 'video' ? '⏳' : '📹'}
        </button>
        {uploadStatus ? (
          <span className="ml-1 text-xs font-semibold text-needle">{uploadStatus}</span>
        ) : null}
        {consultationLabel ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">Consultation: {consultationLabel}</span>
        ) : readyMadeCallLabel ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">Call: {readyMadeCallLabel}</span>
        ) : null}
      </div>

      {/* Photo preview */}
      {photoFile ? (
        <div className="mb-2 flex items-center justify-between rounded-[0.75rem] bg-needle/8 px-3 py-2 text-xs text-needle">
          <span className="font-semibold">{photoFile.name}</span>
          <button
            type="button"
            onClick={() => { setPhotoFile(null); if (photoInputRef.current) photoInputRef.current.value = '' }}
            className="font-semibold text-rust"
          >
            Remove
          </button>
        </div>
      ) : null}

      {/* Textarea + send */}
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Reply</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full resize-none rounded-[0.85rem] border border-ink/10 bg-bone/40 px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
            placeholder="Message..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => { void sendMessage() }}
          disabled={busy}
          className="mb-0.5 inline-flex shrink-0 items-center justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          {busy ? '...' : 'Send'}
        </button>
      </div>

      {canRequestConsultation ? (
        <DisclosurePanel
          title="Request consultation"
          summary={consultationTime ? 'Consultation time set' : 'Ask the tailor to meet before quoting.'}
        >
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Preferred date &amp; time</span>
                <input
                  type="datetime-local"
                  value={consultationTime}
                  onChange={(event) => setConsultationTime(event.target.value)}
                  className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
                />
              </label>
              <button
                type="button"
                onClick={() => { void requestConsultation() }}
                disabled={!!callBusy}
                className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {callBusy === 'consultation' ? 'Sending...' : 'Request'}
              </button>
            </div>
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Optional note about fit, fabric, event timing, or questions."
              className="resize-none rounded-[0.85rem] border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
            />
            <p className="text-xs leading-5 text-ink/48">
              Consultation requests are for custom orders before quote. The tailor must approve or reschedule before the call opens.
            </p>
          </div>
        </DisclosurePanel>
      ) : consultationMeta ? (
        <div className="mt-3 rounded-[0.85rem] border border-needle/12 bg-needle/6 px-3 py-2 text-xs leading-5 text-needle">
          {consultationMeta.status === 'REQUESTED'
            ? `Consultation requested${consultationLabel ? ` for ${consultationLabel}` : ''}. The tailor needs to approve it before the call opens.`
            : consultationMeta.status === 'SCHEDULED'
              ? `Consultation scheduled${consultationLabel ? ` for ${consultationLabel}` : ''}. Use the call buttons near the scheduled time.`
              : `Consultation ${cleanLabel(consultationMeta.status, 'requested').toLowerCase()}${consultationLabel ? ` for ${consultationLabel}` : ''}.`}
        </div>
      ) : null}

      {/* Ready-made call schedule */}
      {isReadyMade ? (
        <DisclosurePanel
          title="Schedule call"
          summary={readyMadeCallLabel ? `Scheduled ${readyMadeCallLabel}` : callTime ? 'Call time set' : 'Set a time for a ready-made clarification call.'}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_auto] md:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Date &amp; time</span>
              <input
                type="datetime-local"
                value={callTime}
                onChange={(event) => setCallTime(event.target.value)}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Reason</span>
              <select
                value={callReason}
                onChange={(event) => setCallReason(event.target.value)}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/50"
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
              onClick={() => { void scheduleReadyMadeCall() }}
              disabled={!!callBusy}
              className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20 md:col-auto"
            >
              {callBusy === 'schedule' ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        </DisclosurePanel>
      ) : null}
    </div>
  )
}

function ManualMeasurementEditor({ data, onRefresh }: { data: MeasurementsRenderData; onRefresh: () => void }) {
  const account = useAccountContext()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('Me')
  const [relationship, setRelationship] = useState('SELF')
  const [unit, setUnit] = useState('in')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [customMeasurements, setCustomMeasurements] = useState<Array<{ id: string; name: string; value: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const customMeasurementCounterRef = useRef(0)
  const coreFieldNames = CORE_MEASUREMENT_FIELDS
  const coreFieldKeys = new Set<string>(coreFieldNames.map((field) => field.key))
  const additionalFieldNames = MEASUREMENT_FIELD_KEYS
    .filter((key) => !coreFieldKeys.has(key))
    .map((key) => ({ key, label: MEASUREMENT_FIELD_LABELS[key] }))
  const allFieldNames = [...coreFieldNames, ...additionalFieldNames]

  function customMeasurementId() {
    customMeasurementCounterRef.current += 1
    return `custom_${customMeasurementCounterRef.current}`
  }

  function addCustomMeasurement(name = '', value = '') {
    setCustomMeasurements((current) => [...current, { id: customMeasurementId(), name, value }])
  }

  function updateCustomMeasurement(id: string, field: 'name' | 'value', value: string) {
    setCustomMeasurements((current) => current.map((measurement) => (
      measurement.id === id ? { ...measurement, [field]: value } : measurement
    )))
  }

  function removeCustomMeasurement(id: string) {
    setCustomMeasurements((current) => current.filter((measurement) => measurement.id !== id))
  }

  function startEdit(profile: MeasurementProfile) {
    const nextMeasurements = measurementsForProfile(profile, data.customerProfile)
    setEditingId(profile.id)
    setLabel(profile.label ?? 'Me')
    setRelationship(profile.relationship ?? 'SELF')
    setUnit(profile.unit_preference ?? data.customerProfile?.unit_preference ?? 'in')
    setFields(Object.fromEntries(allFieldNames.map((field) => {
      const value = measurementEditorValue(nextMeasurements, field)
      return [field.key, typeof value === 'number' || typeof value === 'string' ? String(value) : '']
    })))
    setCustomMeasurements(Object.entries(nextMeasurements)
      .filter(([key, value]) => isEditableCustomMeasurementKey(key, value))
      .map(([name, value]) => ({
        id: customMeasurementId(),
        name,
        value: String(value),
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
    setCustomMeasurements([])
  }

  async function saveProfile() {
    setError(null)
    setSuccess(null)
    if (!account.userId) return
    const labelLeak = assertNoContactLeak(label, "Measurement profile names can't include contact details.")
    if (labelLeak) {
      setError(labelLeak)
      return
    }
    const numericMeasurements = Object.fromEntries(
      allFieldNames
        .map((field) => [field.key, Number.parseFloat(fields[field.key] ?? '')] as const)
        .filter(([, value]) => Number.isFinite(value) && value > 0),
    ) as Record<string, number>
    const coreMeasurementCount = coreFieldNames.filter((field) => {
      const value = numericMeasurements[field.key]
      return typeof value === 'number' && Number.isFinite(value) && value > 0
    }).length
    if (coreMeasurementCount < 4) {
      setError('Add at least height, chest, waist, and hips before saving a profile.')
      return
    }
    const customMeasurementPayload: Record<string, number> = {}
    const seenCustomNames = new Set<string>()
    for (const customMeasurement of customMeasurements) {
      const name = customMeasurement.name.trim()
      const rawValue = customMeasurement.value.trim()
      if (!name && !rawValue) continue
      if (!name || !rawValue) {
        setError('Each custom measurement needs both a name and a value.')
        return
      }
      const nameLeak = assertNoContactLeak(name, "Custom measurement names can't include contact details.")
      if (nameLeak) {
        setError(nameLeak)
        return
      }
      if (!isEditableCustomMeasurementKey(name, rawValue)) {
        setError('Use a normal measurement name for custom tape points.')
        return
      }
      const duplicateKey = name.toLowerCase()
      if (seenCustomNames.has(duplicateKey)) {
        setError('Custom measurement names must be unique.')
        return
      }
      const value = Number.parseFloat(rawValue)
      if (!Number.isFinite(value) || value <= 0) {
        setError('Custom measurement values must be positive numbers.')
        return
      }
      seenCustomNames.add(duplicateKey)
      customMeasurementPayload[name] = value
    }
    setBusy(true)
    const supabase = createClient()
    const now = new Date().toISOString()
    const trimmedLabel = label.trim() || 'Me'
    const measurements = buildMeasurementProfileStoragePayload({
      ...numericMeasurements,
      ...customMeasurementPayload,
      unit,
      measurementSource: 'MANUAL',
      measurementProfileLabel: trimmedLabel,
      measurementProfileUpdatedAt: now,
    })
    const payload = {
      label: trimmedLabel,
      relationship,
      unit_preference: unit,
      source: 'MANUAL',
      measurements,
      last_measured_at: now,
      updated_at: now,
    }
    const editingProfile = data.measurementProfiles.find((profile) => profile.id === editingId)
    const shouldMirrorToCustomerProfile = editingId ? editingProfile?.is_default === true : data.measurementProfiles.length === 0
    const result = editingId
      ? await supabase.from('customer_measurement_profiles').update(payload).eq('id', editingId)
      : await supabase.from('customer_measurement_profiles').insert({
          ...payload,
          customer_id: account.userId,
          is_default: data.measurementProfiles.length === 0,
        })
    if (result.error) {
      setBusy(false)
      setError('Measurements could not save. Please refresh and try again.')
      return
    }
    if (shouldMirrorToCustomerProfile) {
      const mirrorResult = await supabase.from('customer_profiles').upsert(
        {
          user_id: account.userId,
          measurements,
          unit_preference: unit,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      )
      if (mirrorResult.error) {
        setBusy(false)
        setError('Measurements saved, but app profile sync could not finish. Refresh and try again.')
        onRefresh()
        return
      }
    }
    setBusy(false)
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
            <option value="SPOUSE">Spouse</option>
            <option value="PARENT">Parent</option>
            <option value="CHILD">Child</option>
            <option value="FRIEND">Friend</option>
            <option value="GROUP_MEMBER">Group member</option>
            <option value="OTHER">Someone else</option>
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
        {coreFieldNames.map((field) => (
          <label key={field.key} className="grid gap-2">
            <span className="text-sm font-semibold text-ink">{field.label}</span>
            <input
              inputMode="decimal"
              value={fields[field.key] ?? ''}
              onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
              className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
          </label>
        ))}
      </div>
      <DisclosurePanel
        title="Additional measurements"
        summary="Add optional body areas or custom tape points a tailor asked for. Blank optional fields stay out of the saved profile."
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {additionalFieldNames.map((field) => (
              <label key={field.key} className="grid gap-2">
                <span className="text-sm font-semibold text-ink">{field.label}</span>
                <input
                  inputMode="decimal"
                  value={fields[field.key] ?? ''}
                  onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
              </label>
            ))}
          </div>
          <div className="grid gap-3 rounded-[1rem] border border-ink/6 bg-bone/35 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Custom tape points</p>
                <p className="mt-1 text-xs leading-5 text-ink/56">Use these for garment-specific points that are not listed above.</p>
              </div>
              <button type="button" onClick={() => addCustomMeasurement()} className="inline-flex w-fit justify-center rounded-full border border-needle/20 bg-white px-4 py-2 text-xs font-semibold text-needle">
                Add custom point
              </button>
            </div>
            {customMeasurements.length > 0 ? (
              <div className="grid gap-2">
                {customMeasurements.map((measurement) => (
                  <div key={measurement.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
                    <input
                      value={measurement.name}
                      onChange={(event) => updateCustomMeasurement(measurement.id, 'name', event.target.value)}
                      placeholder="e.g. Ankle"
                      className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                    />
                    <input
                      inputMode="decimal"
                      value={measurement.value}
                      onChange={(event) => updateCustomMeasurement(measurement.id, 'value', event.target.value)}
                      placeholder={`0 ${unit}`}
                      className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                    />
                    <button type="button" onClick={() => removeCustomMeasurement(measurement.id)} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink/64">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </DisclosurePanel>
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

function SellerItemManager({
  data,
  onRefresh,
}: {
  data: Pick<ShopRenderData, 'userId' | 'tailorProfile' | 'sellerItems'>
  onRefresh: () => void
}) {
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
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  function resetForm() {
    setEditingItemId(null)
    setExistingPhotoUrls([])
    setTitle('')
    setCategory('')
    setDescription('')
    setPrice('')
    setCurrency(data.tailorProfile?.currency ?? 'USD')
    setSizes('M')
    setInventory('1')
    setFitGuide('')
    setFulfillment({ pickup: true, delivery: false, shipping: false })
    setPhotoFile(null)
    setPublish(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  function startEditItem(item: SellerItem) {
    setError(null)
    setSuccess(null)
    if (item.is_live && item.stock_status !== 'SOLD_OUT') {
      setError('Unpublish this item before editing it. This prevents customers from buying while details are changing.')
      return
    }
    setEditingItemId(item.id)
    setExistingPhotoUrls(stringList(item.photo_urls))
    setTitle(item.title ?? '')
    setCategory(item.category ?? '')
    setDescription(item.description ?? '')
    setPrice(minorUnitsInput(item.price_amount))
    setCurrency(item.currency ?? data.tailorProfile?.currency ?? 'USD')
    setSizes(stringList(item.sizes).join(', ') || 'M')
    setInventory(String(item.inventory_quantity ?? 1))
    setFitGuide(sizeGuideNotes(item))
    setFulfillment({
      pickup: item.pickup_available ?? true,
      delivery: item.delivery_available ?? false,
      shipping: item.shipping_available ?? false,
    })
    setPhotoFile(null)
    setPublish(item.is_live ?? false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

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
    if (photoFile) {
      const photoError = validateMessagePhoto(photoFile)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    setBusy(true)
    try {
      const photoUrls = photoFile
        ? [await uploadPublicFile('seller-item-media', data.userId, photoFile)]
        : existingPhotoUrls
      const sizeInventory = parseInventoryFromSizes(nextSizes, inventory)
      await invokeAccountFunction('seller-item-action', {
        action: editingItemId ? 'update-item' : 'create-item',
        itemId: editingItemId ?? undefined,
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
      setSuccess(editingItemId
        ? publish ? 'Ready-made item updated and published.' : 'Ready-made draft updated.'
        : publish ? 'Ready-made item saved and publish checks passed.' : 'Ready-made draft saved.')
      resetForm()
      onRefresh()
    } catch (itemError) {
      setError(friendlyActionError(itemError, 'Ready-made item could not save. Check required fields and try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function runSellerItemAction(action: 'publish-item' | 'hide-item' | 'delete-item', item: SellerItem) {
    setError(null)
    setSuccess(null)
    if (!data.userId || !data.tailorProfile?.id) return
    if (action === 'delete-item') {
      const confirmed = window.confirm('Delete this hidden draft permanently? Items with order history cannot be deleted.')
      if (!confirmed) return
    }
    const busyKey = `${action}:${item.id}`
    setActionBusy(busyKey)
    try {
      await invokeAccountFunction('seller-item-action', {
        action,
        itemId: item.id,
      })
      if (editingItemId === item.id && (action === 'hide-item' || action === 'delete-item')) {
        resetForm()
      }
      setSuccess(action === 'publish-item'
        ? 'Item published after preflight checks.'
        : action === 'hide-item'
          ? 'Item hidden from customers.'
          : 'Hidden draft deleted.')
      onRefresh()
    } catch (itemError) {
      setError(friendlyActionError(itemError, 'Shop item action could not be completed. Refresh and try again.'))
    } finally {
      setActionBusy(null)
    }
  }

  if (!data.tailorProfile) return null

  return (
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Catalogue</p>
          <h2 className="mt-2 text-3xl text-ink">{editingItemId ? 'Edit listing' : 'Add a listing'}</h2>
        </div>
        <p className="text-sm leading-6 text-ink/62">Publishing checks photos, sizes, stock, fit guide, fulfillment, and payout readiness. Unpublish items before editing.</p>
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
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink" />
            <span className="text-xs leading-5 text-ink/52">
              {editingItemId && !photoFile && existingPhotoUrls.length > 0
                ? `${existingPhotoUrls.length} existing photo${existingPhotoUrls.length === 1 ? '' : 's'} will be kept unless you choose a replacement.`
                : 'On iPad or mobile, take a fresh garment photo or choose one from your library.'}
            </span>
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={saveItem} disabled={busy} className="inline-flex w-full justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20 sm:w-auto">
            {busy ? 'Saving...' : editingItemId ? publish ? 'Update and publish' : 'Update draft' : publish ? 'Save and publish' : 'Save draft'}
          </button>
          {editingItemId ? (
            <button type="button" onClick={resetForm} disabled={busy} className="inline-flex w-full justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:text-ink/40 sm:w-auto">
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>
      {data.sellerItems.length > 0 ? (
        <div className="mt-6 border-t border-needle/12 pt-5">
          <h3 className="text-xl font-semibold text-ink">Manage existing listings</h3>
          <div className="mt-4 grid gap-3">
            {data.sellerItems.map((item) => {
              const busyForItem = actionBusy?.endsWith(`:${item.id}`) ?? false
              const canEdit = !item.is_live || item.stock_status === 'SOLD_OUT'
              const isHiddenDraft = !item.is_live && item.stock_status === 'HIDDEN'
              return (
                <div key={item.id} className="rounded-[1rem] border border-ink/8 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                        {safeUserText(item.category, 'Ready-made')} · {item.is_live ? 'Published' : cleanLabel(item.stock_status, 'Draft')}
                      </p>
                      <h4 className="mt-1 font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h4>
                      <p className="mt-1 text-sm text-ink/58">
                        {formatMoney(item.price_amount, item.currency)} · {cleanLabel(item.stock_status, 'In stock')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEditItem(item)}
                        disabled={!canEdit || busy || !!actionBusy}
                        className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/36"
                      >
                        Edit
                      </button>
                      {item.is_live ? (
                        <button
                          type="button"
                          onClick={() => runSellerItemAction('hide-item', item)}
                          disabled={busy || !!actionBusy}
                          className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/36"
                        >
                          {busyForItem ? 'Hiding...' : 'Hide'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => runSellerItemAction('publish-item', item)}
                          disabled={busy || !!actionBusy}
                          className="rounded-full border border-needle/16 bg-needle/8 px-4 py-2 text-sm font-semibold text-needle disabled:cursor-not-allowed disabled:text-ink/36"
                        >
                          {busyForItem ? 'Publishing...' : 'Publish'}
                        </button>
                      )}
                      {isHiddenDraft ? (
                        <button
                          type="button"
                          onClick={() => runSellerItemAction('delete-item', item)}
                          disabled={busy || !!actionBusy}
                          className="rounded-full border border-rust/20 bg-white px-4 py-2 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/36"
                        >
                          {busyForItem ? 'Deleting...' : 'Delete'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {!canEdit ? (
                    <p className="mt-3 text-xs leading-5 text-ink/50">Unpublish this item before editing details, photos, price, sizes, or stock.</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function TailorOrderActions({ order, data, onRefresh }: { order: AccountOrder; data: OrderActorData; onRefresh: () => void }) {
  const supportMeta = parseOrderSupportMeta(order.special_note)
  const consultationMeta = supportMeta.consultation
  const proposedConsultationStart = consultationMeta?.proposedStartAt ?? consultationMeta?.scheduledStartAt ?? null
  const [quoteAmount, setQuoteAmount] = useState('')
  const [quoteCurrency, setQuoteCurrency] = useState(order.currency ?? data.tailorProfile?.currency ?? 'USD')
  const [completionDate, setCompletionDate] = useState('')
  const [quoteNote, setQuoteNote] = useState('')
  const [consultationStart, setConsultationStart] = useState(() => dateTimeLocalInputValue(proposedConsultationStart))
  const [consultationFee, setConsultationFee] = useState(() => minorUnitsInput(consultationMeta?.feeAmount ?? order.consultation_fee))
  const [consultationNote, setConsultationNote] = useState('')
  const [targetStage, setTargetStage] = useState(nextStageOptions(order)[0] ?? '')
  const [stageNote, setStageNote] = useState('')
  const [stageTrackingNumber, setStageTrackingNumber] = useState('')
  const [stageFulfillmentProvider, setStageFulfillmentProvider] = useState('')
  const [stageFulfillmentReference, setStageFulfillmentReference] = useState('')
  const [stageFulfillmentContactName, setStageFulfillmentContactName] = useState('')
  const [stageFulfillmentContactPhone, setStageFulfillmentContactPhone] = useState('')
  const [stageMediaFiles, setStageMediaFiles] = useState<File[]>([])
  const [measurementNote, setMeasurementNote] = useState('')
  const [measurementFields, setMeasurementFields] = useState('')
  const [fitReadinessNote, setFitReadinessNote] = useState('')
  const [styleAlignmentNote, setStyleAlignmentNote] = useState('')
  const [fabricReceiptNote, setFabricReceiptNote] = useState('')
  const [fabricReceiptFile, setFabricReceiptFile] = useState<File | null>(null)
  const [materialIssueReason, setMaterialIssueReason] = useState<(typeof MATERIAL_ISSUE_REASON_OPTIONS)[number]['value']>('POOR_FABRIC_QUALITY')
  const [materialIssueNote, setMaterialIssueNote] = useState('')
  const [scopeChangeType, setScopeChangeType] = useState<(typeof SCOPE_CHANGE_TYPE_OPTIONS)[number]['value']>('STYLE_OR_REFERENCE')
  const [scopeChangeSummary, setScopeChangeSummary] = useState('')
  const [scopeChangeImpacts, setScopeChangeImpacts] = useState<string[]>([])
  const [scopePriceImpact, setScopePriceImpact] = useState('')
  const [scopeDeadlineImpact, setScopeDeadlineImpact] = useState('')
  const [tailorScopeChangeResponseNote, setTailorScopeChangeResponseNote] = useState('')
  const [declineNote, setDeclineNote] = useState('')
  const [declineArmed, setDeclineArmed] = useState(false)
  const [pickupCode, setPickupCode] = useState('')
  const [tailorCancellationReason, setTailorCancellationReason] = useState<(typeof TAILOR_CANCELLATION_REASON_OPTIONS)[number]['value']>('TAILOR_CANNOT_FULFIL')
  const [tailorCancellationNote, setTailorCancellationNote] = useState('')
  const [tailorDeliveryReason, setTailorDeliveryReason] = useState<(typeof TAILOR_DELIVERY_REASON_OPTIONS)[number]['value']>('DISPATCH_DELAY')
  const [tailorDeliveryNote, setTailorDeliveryNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const isTailor = isTailorOrder(order, data)
  const stage = order.stage ?? ''
  const currentOrderStage = asOrderStage(order.stage)
  const measurementSnapshot = measurementSnapshotForOrder(order)
  const stageOptions = nextStageOptions(order)
  const selectedTargetStage = stageOptions.find((stage) => stage === targetStage) ?? stageOptions[0] ?? ''
  const selectedTargetNeedsDispatchMeta = selectedTargetStage === 'READY_FOR_DRAPE_DISPATCH'
  const consultationRequestedByCustomer = order.stage === 'CONSULTATION' &&
    consultationMeta?.requestedBy === 'CUSTOMER' &&
    consultationMeta.status === 'REQUESTED'
  const tailorCanScheduleConsultation = order.order_kind !== 'READY_MADE' &&
    (order.stage === 'PENDING_QUOTE' || consultationRequestedByCustomer)
  const proposedConsultationLabel = formatDateTime(proposedConsultationStart, consultationMeta?.timezone)
  const cancellationPolicy = currentOrderStage
    ? deriveCancellationPolicy({
        orderKind: order.order_kind === 'READY_MADE' ? 'READY_MADE' : 'CUSTOM',
        stage: currentOrderStage,
        deliveryMethod: order.delivery_method,
        consultationFee: order.consultation_fee,
        consultationPaidAt: consultationMeta?.paidAt ?? null,
        consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
        fulfillmentFee: order.fulfillment_fee,
        fulfillmentPaymentRequestedAt: order.fulfillment_payment_requested_at ?? null,
        fulfillmentPaymentPaidAt: order.fulfillment_payment_paid_at ?? null,
        dispatchBookedAt: supportMeta.dispatchRecord?.bookedAt ?? null,
        premiumDispatch: supportMeta.dispatchRecord?.premiumException ?? null,
      })
    : null
  const cancellationReviewOpen = supportMeta.cancellationReview?.status === 'OPEN'
  const deliveryReviewOpen = supportMeta.deliveryReview?.status === 'OPEN'
  const materialIssueOpen = supportMeta.materialIssue?.status === 'OPEN'
  const scopeChangeOpen = supportMeta.scopeChange?.status === 'OPEN'
  const canRequestMeasurementConfirmation = PRE_CUTTING_STAGES.has(stage) && !!measurementSnapshot && Object.keys(measurementSnapshot).length > 0
  const canConfirmFitReadiness = PRE_CUTTING_STAGES.has(stage) && supportMeta.fitProfile?.requiresTailorReview === true
  const canRequestStyleAlignment = order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status !== 'APPROVED' &&
    supportMeta.styleAlignment.status !== 'NOT_REQUIRED'
  const canConfirmFabricReceived = order.fabric_source === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    (!supportMeta.fabricReceivedAt || supportMeta.materialIssue?.response === 'REPLACE_FABRIC')
  const canOpenMaterialIssue = order.order_kind === 'CUSTOM' &&
    order.fabric_source === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    !materialIssueOpen
  const canRequestScopeChange = order.order_kind === 'CUSTOM' &&
    SCOPE_CHANGE_STAGES.has(stage) &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen
  const canRespondScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'CUSTOMER'
  const canCancelScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'TAILOR'
  const canDeclineOrder = cancellationPolicy?.tailorCanDecline === true
  const canRequestCancellationReview = cancellationPolicy?.tailorCanRequestReview === true && !cancellationReviewOpen
  const canRequestDeliveryReview = ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED'].includes(stage) && !deliveryReviewOpen && !cancellationReviewOpen
  const canConfirmCollection = stage === 'READY_FOR_COLLECTION'

  if (!isTailor || isTerminalOrder(order)) return null

  function addStageMedia(files: FileList | null) {
    if (!files?.length) return
    const nextFiles = Array.from(files)
    const photoError = nextFiles.map(validateMessagePhoto).find(Boolean)
    if (photoError) {
      setError(photoError)
      return
    }
    setStageMediaFiles((current) => {
      const combined = [...current, ...nextFiles]
      if (combined.length > 6) {
        setError('Attach up to 6 proof photos for a stage update.')
      }
      return combined.slice(0, 6)
    })
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

  async function saveConsultation(action: 'request-consultation' | 'approve-consultation') {
    const scheduledAt = consultationStart ? new Date(consultationStart) : null
    const leak = assertNoContactLeak(consultationNote, "Consultation notes can't include contact details.")
    const parsedFee = consultationFee.trim() ? parseMinorUnits(consultationFee) : null
    setError(null)
    setSuccess(null)
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      setError('Choose the consultation date and time.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    if (consultationFee.trim() && parsedFee === null) {
      setError('Enter a valid consultation fee or leave it blank.')
      return
    }
    setBusy(action === 'approve-consultation' ? 'consultation-approve' : 'consultation-schedule')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action,
        orderId: order.id,
        scheduledStartAt: scheduledAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        consultationFee: parsedFee,
        currency: quoteCurrency,
        note: consultationNote.trim() || undefined,
      })
      setConsultationNote('')
      setSuccess(action === 'approve-consultation' ? 'Consultation approved and scheduled.' : 'Consultation scheduled for the customer.')
      onRefresh()
    } catch (consultationError) {
      setError(friendlyActionError(consultationError, 'Consultation could not be scheduled. Check the requested time and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function declineConsultation() {
    const leak = assertNoContactLeak(consultationNote, "Consultation notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    setBusy('consultation-decline')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action: 'decline-consultation-request',
        orderId: order.id,
        note: consultationNote.trim() || undefined,
      })
      setConsultationNote('')
      setSuccess('Consultation declined. The order is back in quote review.')
      onRefresh()
    } catch (consultationError) {
      setError(friendlyActionError(consultationError, 'Consultation request could not be declined. Refresh and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function runTailorLifecycleAction(action: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(action)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('tailor-order-action', {
        action,
        orderId: order.id,
        ...body,
      })
      setDeclineArmed(false)
      setSuccess(successMessage)
      onRefresh()
      return true
    } catch (actionError) {
      setError(friendlyActionError(actionError, 'This tailor action could not finish. Refresh the order and try again.'))
      setSuccess(null)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function requestMeasurementConfirmation() {
    const note = measurementNote.trim()
    const leak = assertNoContactLeak([note, measurementFields].join('\n'), "Measurement confirmation notes can't include contact details.")
    if (note.length < 10) {
      setError('Tell the customer what needs confirming before cutting.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const fields = measurementFields
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean)
      .slice(0, 20)
    const ok = await runTailorLifecycleAction(
      'request-measurement-confirmation',
      { note, fields: fields.length > 0 ? fields : undefined },
      'Measurement confirmation requested from the customer.',
    )
    if (ok) {
      setMeasurementNote('')
      setMeasurementFields('')
    }
  }

  async function confirmFitReadiness() {
    const note = fitReadinessNote.trim()
    const leak = assertNoContactLeak(note, "Fit readiness notes can't include contact details.")
    if (note.length < 10) {
      setError('Explain what you reviewed before clearing fit readiness.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction('confirm-fit-readiness', { note }, 'Fit readiness confirmed for this order.')
    if (ok) setFitReadinessNote('')
  }

  async function requestStyleAlignment() {
    const note = styleAlignmentNote.trim()
    const leak = assertNoContactLeak(note, "Style approval notes can't include contact details.")
    if (note.length < 10) {
      setError('Explain the style interpretation before asking for approval.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction('request-style-alignment', { note }, 'Style alignment sent for customer approval.')
    if (ok) setStyleAlignmentNote('')
  }

  async function confirmFabricReceived() {
    const note = fabricReceiptNote.trim()
    const leak = assertNoContactLeak(note, "Fabric receipt notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    if (order.order_kind === 'CUSTOM' && !fabricReceiptFile) {
      setError('Add a fabric receipt photo before confirming customer fabric.')
      return
    }
    if (fabricReceiptFile) {
      const photoError = validateMessagePhoto(fabricReceiptFile)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    setBusy('confirm-fabric-received')
    try {
      const photoUrl = fabricReceiptFile
        ? await uploadPublicFile('order-photos', `fabric-receipts/${order.id}`, await reencodeImageFile(fabricReceiptFile))
        : undefined
      await invokeAccountFunction('tailor-order-action', {
        action: 'confirm-fabric-received',
        orderId: order.id,
        note: note || undefined,
        photoUrl,
      })
      setFabricReceiptNote('')
      setFabricReceiptFile(null)
      setSuccess('Fabric receipt confirmed on the order timeline.')
      onRefresh()
    } catch (fabricError) {
      setError(friendlyActionError(fabricError, 'Fabric receipt could not be confirmed. Add proof and try again.'))
      setSuccess(null)
    } finally {
      setBusy(null)
    }
  }

  async function openMaterialIssue() {
    const note = materialIssueNote.trim()
    const leak = assertNoContactLeak(note, "Material issue notes can't include contact details.")
    if (note.length < 10) {
      setError('Describe the material issue so the customer can choose what to do next.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'open-material-issue',
      { reason: materialIssueReason, note },
      'Material issue opened for the customer.',
    )
    if (ok) setMaterialIssueNote('')
  }

  function toggleScopeImpact(value: string) {
    setScopeChangeImpacts((current) =>
      current.includes(value)
        ? current.filter((impact) => impact !== value)
        : [...current, value],
    )
  }

  async function requestScopeChange() {
    const summary = scopeChangeSummary.trim()
    const deadlineImpact = scopeDeadlineImpact.trim()
    const leak = assertNoContactLeak([summary, deadlineImpact].join('\n'), "Change requests can't include contact details.")
    const parsedPriceImpact = scopePriceImpact.trim() ? parseMinorUnits(scopePriceImpact) : null
    if (summary.length < 10) {
      setError('Explain what changed and what the customer needs to approve.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    if (scopePriceImpact.trim() && parsedPriceImpact === null) {
      setError('Enter a valid added price, or leave price impact blank.')
      setSuccess(null)
      return
    }
    const impacts = Array.from(new Set([
      ...scopeChangeImpacts,
      ...(parsedPriceImpact ? ['PRICE'] : []),
      ...(deadlineImpact ? ['DEADLINE'] : []),
    ]))
    const ok = await runTailorLifecycleAction(
      'request-scope-change',
      {
        scopeChangeType,
        scopeChangeSummary: summary,
        scopeChangeImpacts: impacts.length > 0 ? impacts : undefined,
        priceImpactMinor: parsedPriceImpact ?? undefined,
        deadlineImpact: deadlineImpact || undefined,
      },
      'Change request sent to the customer.',
    )
    if (ok) {
      setScopeChangeSummary('')
      setScopeChangeImpacts([])
      setScopePriceImpact('')
      setScopeDeadlineImpact('')
    }
  }

  async function respondTailorScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    const note = tailorScopeChangeResponseNote.trim()
    const leak = assertNoContactLeak(note, "Change response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    const ok = await runTailorLifecycleAction(
      'respond-scope-change',
      { scopeChangeDecision: decision, scopeChangeResponseNote: note || undefined },
      decision === 'ACCEPTED'
        ? 'Order change accepted.'
        : decision === 'DECLINED'
          ? 'Order change declined.'
          : 'Change proposal cancelled.',
    )
    if (ok) setTailorScopeChangeResponseNote('')
  }

  async function declineOrder() {
    const note = declineNote.trim()
    const leak = assertNoContactLeak(note, "Decline notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    if (!declineArmed) {
      setDeclineArmed(true)
      setSuccess('Click decline once more to close this order request.')
      return
    }
    const ok = await runTailorLifecycleAction('decline-order', { note: note || undefined }, 'Order declined and closed.')
    if (ok) setDeclineNote('')
  }

  async function confirmCollection() {
    const code = pickupCode.replace(/\D/g, '')
    if (!/^\d{4}$/.test(code)) {
      setError('Enter the 4-digit pickup code from the customer.')
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction('confirm-collection', { code }, 'Collection confirmed. Handoff is closed.')
    if (ok) setPickupCode('')
  }

  async function requestTailorCancellationReview() {
    const note = tailorCancellationNote.trim()
    const leak = assertNoContactLeak(note, "Cancellation review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-cancellation-review',
      { reason: tailorCancellationReason, note: note || undefined },
      'Cancellation review opened for Drapeon.',
    )
    if (ok) setTailorCancellationNote('')
  }

  async function requestTailorDeliveryReview() {
    const note = tailorDeliveryNote.trim()
    const leak = assertNoContactLeak(note, "Delivery review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-delivery-review',
      { reason: tailorDeliveryReason, note: note || undefined },
      'Delivery review opened for Drapeon.',
    )
    if (ok) setTailorDeliveryNote('')
  }

  async function advanceStage() {
    const leak = assertNoContactLeak(stageNote, "Stage notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!selectedTargetStage || stageNote.trim().length < 10) {
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
        targetStage: selectedTargetStage,
        note: stageNote.trim(),
        photoUrl: photoUrls[0],
        photoUrls,
        mediaFingerprints,
        trackingNumber: selectedTargetNeedsDispatchMeta ? stageTrackingNumber.trim().toUpperCase() || undefined : undefined,
        fulfillmentProvider: selectedTargetNeedsDispatchMeta ? stageFulfillmentProvider.trim() || undefined : undefined,
        fulfillmentReference: selectedTargetNeedsDispatchMeta ? stageFulfillmentReference.trim().toUpperCase() || undefined : undefined,
        fulfillmentContactName: selectedTargetNeedsDispatchMeta ? stageFulfillmentContactName.trim() || undefined : undefined,
        fulfillmentContactPhone: selectedTargetNeedsDispatchMeta ? stageFulfillmentContactPhone.trim() || undefined : undefined,
      })
      setStageNote('')
      setStageTrackingNumber('')
      setStageFulfillmentProvider('')
      setStageFulfillmentReference('')
      setStageFulfillmentContactName('')
      setStageFulfillmentContactPhone('')
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
    <section id="tailor-actions" className="scroll-mt-28 rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor actions</p>
      <h2 className="mt-2 text-3xl text-ink">Work this order from web</h2>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {tailorCanScheduleConsultation ? (
          <div className="grid gap-3 rounded-[1.2rem] border border-ink/8 bg-white p-4">
            <div>
              <h3 className="text-xl font-semibold text-ink">
                {consultationRequestedByCustomer ? 'Approve consultation request' : 'Schedule consultation'}
              </h3>
              {consultationRequestedByCustomer ? (
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Customer requested {proposedConsultationLabel ?? 'a consultation time'} before quote.
                  {consultationMeta?.requestNote ? ` ${safeUserText(consultationMeta.requestNote, '')}` : ''}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Use this when a quote needs a live fit, scope, or fabric discussion first.
                </p>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_0.7fr_0.45fr]">
              <input
                type="datetime-local"
                value={consultationStart}
                onChange={(event) => setConsultationStart(event.target.value)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              <input
                inputMode="decimal"
                value={consultationFee}
                onChange={(event) => setConsultationFee(event.target.value)}
                placeholder="Optional fee"
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              <select value={quoteCurrency} onChange={(event) => setQuoteCurrency(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              placeholder="Optional consultation note"
              className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { void saveConsultation(consultationRequestedByCustomer ? 'approve-consultation' : 'request-consultation') }}
                disabled={busy === 'consultation-approve' || busy === 'consultation-schedule'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'consultation-approve' || busy === 'consultation-schedule'
                  ? 'Saving...'
                  : consultationRequestedByCustomer
                    ? 'Approve consultation'
                    : 'Schedule consultation'}
              </button>
              {consultationRequestedByCustomer ? (
                <button
                  type="button"
                  onClick={() => { void declineConsultation() }}
                  disabled={busy === 'consultation-decline'}
                  className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-ink/5 disabled:text-ink/38"
                >
                  {busy === 'consultation-decline' ? 'Declining...' : 'Decline'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
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
        {canRequestMeasurementConfirmation || canConfirmFitReadiness || canRequestStyleAlignment || canConfirmFabricReceived || canOpenMaterialIssue ? (
          <DisclosurePanel title="Pre-cutting checks" summary="Resolve fit, style, and fabric blockers before cutting starts.">
            <div className="grid gap-4">
              {canRequestMeasurementConfirmation ? (
                <div className="grid gap-3">
                  <h3 className="font-semibold text-ink">Request measurement confirmation</h3>
                  <input
                    value={measurementFields}
                    onChange={(event) => setMeasurementFields(event.target.value)}
                    placeholder="Optional fields, comma separated"
                    className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <textarea
                    value={measurementNote}
                    onChange={(event) => setMeasurementNote(event.target.value)}
                    rows={2}
                    placeholder="What should the customer confirm?"
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestMeasurementConfirmation() }}
                    disabled={busy === 'request-measurement-confirmation'}
                    className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'request-measurement-confirmation' ? 'Sending...' : 'Request confirmation'}
                  </button>
                </div>
              ) : null}

              {canConfirmFitReadiness ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Confirm fit readiness</h3>
                  <textarea
                    value={fitReadinessNote}
                    onChange={(event) => setFitReadinessNote(event.target.value)}
                    rows={2}
                    placeholder="What did you verify?"
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void confirmFitReadiness() }}
                    disabled={busy === 'confirm-fit-readiness'}
                    className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'confirm-fit-readiness' ? 'Confirming...' : 'Confirm fit readiness'}
                  </button>
                </div>
              ) : null}

              {canRequestStyleAlignment ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Style alignment</h3>
                  <textarea
                    value={styleAlignmentNote}
                    onChange={(event) => setStyleAlignmentNote(event.target.value)}
                    rows={3}
                    placeholder="Explain what can be matched from the references before cutting."
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestStyleAlignment() }}
                    disabled={busy === 'request-style-alignment'}
                    className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'request-style-alignment' ? 'Sending...' : 'Send style alignment'}
                  </button>
                </div>
              ) : null}

              {canConfirmFabricReceived ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Confirm customer fabric</h3>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setFabricReceiptFile(event.target.files?.[0] ?? null)}
                    className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
                  />
                  <textarea
                    value={fabricReceiptNote}
                    onChange={(event) => setFabricReceiptNote(event.target.value)}
                    rows={2}
                    placeholder="Optional fabric receipt note"
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void confirmFabricReceived() }}
                    disabled={busy === 'confirm-fabric-received'}
                    className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'confirm-fabric-received' ? 'Confirming...' : 'Confirm fabric received'}
                  </button>
                </div>
              ) : null}

              {canOpenMaterialIssue ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Material issue</h3>
                  <select
                    value={materialIssueReason}
                    onChange={(event) => setMaterialIssueReason(event.target.value as typeof materialIssueReason)}
                    className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {MATERIAL_ISSUE_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={materialIssueNote}
                    onChange={(event) => setMaterialIssueNote(event.target.value)}
                    rows={2}
                    placeholder="Describe the fabric issue."
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void openMaterialIssue() }}
                    disabled={busy === 'open-material-issue'}
                    className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'open-material-issue' ? 'Opening...' : 'Open material issue'}
                  </button>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestScopeChange ? (
          <DisclosurePanel title="Order change request" summary="Propose a formal scope, price, deadline, fabric, or fit change.">
            <div className="grid gap-3">
              <select
                value={scopeChangeType}
                onChange={(event) => setScopeChangeType(event.target.value as typeof scopeChangeType)}
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => (
                  <label key={option.value} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/68">
                    <input
                      type="checkbox"
                      checked={scopeChangeImpacts.includes(option.value)}
                      onChange={() => toggleScopeImpact(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <textarea
                value={scopeChangeSummary}
                onChange={(event) => setScopeChangeSummary(event.target.value)}
                rows={3}
                placeholder="What changed?"
                className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  inputMode="decimal"
                  value={scopePriceImpact}
                  onChange={(event) => setScopePriceImpact(event.target.value)}
                  placeholder={`Added price (${quoteCurrency})`}
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={scopeDeadlineImpact}
                  onChange={(event) => setScopeDeadlineImpact(event.target.value)}
                  placeholder="Deadline impact"
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
              </div>
              <button
                type="button"
                onClick={() => { void requestScopeChange() }}
                disabled={busy === 'request-scope-change'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'request-scope-change' ? 'Sending...' : 'Send change request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondScopeChange || canCancelScopeChange ? (
          <DisclosurePanel
            title="Open change request"
            summary={supportMeta.scopeChange?.summary ?? 'Review the open change request before production continues.'}
            defaultOpen
          >
            <div className="grid gap-3">
              {supportMeta.scopeChange?.impacts?.length ? (
                <p className="text-sm leading-6 text-ink/62">
                  Affects: {supportMeta.scopeChange.impacts.map((impact) => cleanLabel(impact)).join(', ')}
                </p>
              ) : null}
              {typeof supportMeta.scopeChange?.priceImpactMinor === 'number' && supportMeta.scopeChange.priceImpactMinor !== 0 ? (
                <p className="text-sm leading-6 text-ink/62">
                  Price impact: {formatMoney(Math.abs(supportMeta.scopeChange.priceImpactMinor), order.quoted_currency ?? order.currency)}
                </p>
              ) : null}
              {supportMeta.scopeChange?.deadlineImpact ? (
                <p className="text-sm leading-6 text-ink/62">Deadline: {safeUserText(supportMeta.scopeChange.deadlineImpact, '')}</p>
              ) : null}
              <textarea
                value={tailorScopeChangeResponseNote}
                onChange={(event) => setTailorScopeChangeResponseNote(event.target.value)}
                rows={2}
                placeholder="Optional response note"
                className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              {canRespondScopeChange ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => { void respondTailorScopeChange('ACCEPTED') }}
                    disabled={busy === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'respond-scope-change' ? 'Saving...' : 'Accept change'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void respondTailorScopeChange('DECLINED') }}
                    disabled={busy === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'respond-scope-change' ? 'Saving...' : 'Decline change'}
                  </button>
                </div>
              ) : null}
              {canCancelScopeChange ? (
                <button
                  type="button"
                  onClick={() => { void respondTailorScopeChange('CANCELLED') }}
                  disabled={busy === 'respond-scope-change'}
                  className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busy === 'respond-scope-change' ? 'Cancelling...' : 'Cancel proposal'}
                </button>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {stageOptions.length > 0 ? (
          <div className="grid gap-3 rounded-[1.2rem] border border-ink/8 bg-white p-4">
            <h3 className="text-xl font-semibold text-ink">Update production stage</h3>
            <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
              <select value={selectedTargetStage} onChange={(event) => setTargetStage(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {stageOptions.map((stage) => <option key={stage} value={stage}>{cleanLabel(stage)}</option>)}
              </select>
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="inline-flex cursor-pointer justify-center rounded-full border border-needle/16 bg-needle/8 px-4 py-3 text-sm font-semibold text-needle">
                    Take fresh proof
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(event) => addStageMedia(event.target.files)}
                      className="sr-only"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink">
                    Attach media
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => addStageMedia(event.target.files)}
                      className="sr-only"
                    />
                  </label>
                </div>
                <p className="text-xs leading-5 text-ink/52">
                  Use fresh clothing proof. iPad and mobile browsers can open the camera here; desktop can attach photos.
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
            {selectedTargetNeedsDispatchMeta ? (
              <div className="grid gap-3 rounded-[1rem] border border-needle/12 bg-needle/6 p-3 md:grid-cols-2">
                <input
                  value={stageFulfillmentProvider}
                  onChange={(event) => setStageFulfillmentProvider(event.target.value)}
                  placeholder="Fulfillment provider"
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentReference}
                  onChange={(event) => setStageFulfillmentReference(event.target.value)}
                  placeholder="Fulfillment reference"
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageTrackingNumber}
                  onChange={(event) => setStageTrackingNumber(event.target.value)}
                  placeholder="Tracking number"
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentContactName}
                  onChange={(event) => setStageFulfillmentContactName(event.target.value)}
                  placeholder="Dispatch contact name"
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentContactPhone}
                  onChange={(event) => setStageFulfillmentContactPhone(event.target.value)}
                  placeholder="Dispatch contact phone"
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50 md:col-span-2"
                />
              </div>
            ) : null}
            <textarea value={stageNote} onChange={(event) => setStageNote(event.target.value)} rows={2} placeholder="Tell the customer what changed" className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={advanceStage} disabled={busy === 'stage'} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'stage' ? 'Updating...' : 'Update stage'}
            </button>
          </div>
        ) : null}

        {canConfirmCollection ? (
          <DisclosurePanel title="Confirm collection" summary="Enter the customer pickup code to close local collection.">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={pickupCode}
                onChange={(event) => setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="4-digit pickup code"
                className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              <button
                type="button"
                onClick={() => { void confirmCollection() }}
                disabled={busy === 'confirm-collection'}
                className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'confirm-collection' ? 'Confirming...' : 'Confirm collection'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canDeclineOrder || canRequestCancellationReview || canRequestDeliveryReview ? (
          <DisclosurePanel title="Reviews and exceptions" summary={cancellationPolicy?.tailorMessage ?? 'Use formal review for exceptions that should pause handoff.'}>
            <div className="grid gap-4">
              {canDeclineOrder ? (
                <div className="grid gap-3">
                  <h3 className="font-semibold text-ink">Decline order</h3>
                  <textarea
                    value={declineNote}
                    onChange={(event) => setDeclineNote(event.target.value)}
                    rows={2}
                    placeholder="Optional note"
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void declineOrder() }}
                    disabled={busy === 'decline-order'}
                    className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'decline-order' ? 'Declining...' : declineArmed ? 'Confirm decline' : 'Decline order'}
                  </button>
                </div>
              ) : null}

              {canRequestCancellationReview ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Cancellation review</h3>
                  <select
                    value={tailorCancellationReason}
                    onChange={(event) => setTailorCancellationReason(event.target.value as typeof tailorCancellationReason)}
                    className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {TAILOR_CANCELLATION_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={tailorCancellationNote}
                    onChange={(event) => setTailorCancellationNote(event.target.value)}
                    rows={2}
                    placeholder="Add context for Drapeon."
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestTailorCancellationReview() }}
                    disabled={busy === 'request-cancellation-review'}
                    className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'request-cancellation-review' ? 'Opening...' : 'Open cancellation review'}
                  </button>
                </div>
              ) : null}

              {canRequestDeliveryReview ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Delivery review</h3>
                  <select
                    value={tailorDeliveryReason}
                    onChange={(event) => setTailorDeliveryReason(event.target.value as typeof tailorDeliveryReason)}
                    className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {TAILOR_DELIVERY_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={tailorDeliveryNote}
                    onChange={(event) => setTailorDeliveryNote(event.target.value)}
                    rows={2}
                    placeholder="What went wrong with dispatch or delivery?"
                    className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestTailorDeliveryReview() }}
                    disabled={busy === 'request-delivery-review'}
                    className="inline-flex justify-center rounded-full border border-rust/18 bg-white px-5 py-3 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'request-delivery-review' ? 'Opening...' : 'Open delivery review'}
                  </button>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}
      </div>
    </section>
  )
}

function MaterialAdvancePanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'materialAdvances' | 'userId'>
  onRefresh: () => void
}) {
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

function GeneralSupportForm({ data, onRefresh }: { data: SupportSurfaceData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const linkedOrderId = searchParams.get('orderId')
  const orderOptions = data.orders.slice(0, 12)
  const [category, setCategory] = useState<(typeof SUPPORT_CATEGORIES)[number][0]>('PAYMENT')
  const [orderId, setOrderId] = useState(linkedOrderId && data.orders.some((order) => order.id === linkedOrderId) ? linkedOrderId : '')
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

function SupportIssueForm({ data, onRefresh }: { data: SupportSurfaceData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const linkedOrderId = searchParams.get('orderId')
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order))
  const [orderId, setOrderId] = useState(linkedOrderId && activeOrders.some((order) => order.id === linkedOrderId) ? linkedOrderId : activeOrders[0]?.id ?? '')
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

function ReadyMadeCheckoutForm({ item, data, onRefresh }: { item: SellerItem; data: Pick<ItemDetailRenderData, 'userId'>; onRefresh: () => void }) {
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
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingPreview, setPricingPreview] = useState<ReadyMadeCheckoutPricingPreview | null>(null)
  const [pricingKey, setPricingKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const needsAddress = fulfillment !== 'PICKUP'
  const fallbackFulfillment = fulfillment === 'PICKUP'
    ? item.delivery_available
      ? 'DELIVERY'
      : item.shipping_available
        ? 'SHIPPING'
        : null
    : null
  const previewKey = useMemo(() => JSON.stringify({
    itemId: item.id,
    size: size || '',
    quantity,
    fulfillment,
    address: needsAddress ? address.trim() : '',
    city: needsAddress ? city.trim() : '',
    region: needsAddress ? region.trim() : '',
    postalCode: needsAddress ? postalCode.trim() : '',
    countryCode: needsAddress ? countryCode.trim().toUpperCase() : '',
  }), [address, city, countryCode, fulfillment, item.id, needsAddress, postalCode, quantity, region, size])
  const previewIsFresh = Boolean(pricingPreview && pricingKey === previewKey)

  function validateCheckoutInput() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([address, city, region, recipientName].join('\n'), "Checkout delivery details can't include off-platform contact details.")
    if (leak) {
      setError(leak)
      return null
    }
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 3) {
      setError('Choose a quantity between 1 and 3.')
      return null
    }
    if (needsAddress && (!address.trim() || !recipientName.trim() || !recipientPhone.trim())) {
      setError('Delivery and shipping need recipient details before checkout.')
      return null
    }
    return parsedQuantity
  }

  function handlePickupSetupFallback(message: string) {
    if (!fallbackFulfillment || !/pickup details|finished pickup details/iu.test(message)) {
      return false
    }
    setFulfillment(fallbackFulfillment)
    setPricingPreview(null)
    setPricingKey('')
    setSuccess(null)
    setError(`Pickup is not ready for this seller yet. Checkout has been switched to ${fallbackFulfillment.toLowerCase()}. Add recipient details and preview tax again.`)
    return true
  }

  async function previewCheckout() {
    const parsedQuantity = validateCheckoutInput()
    if (!parsedQuantity) return

    setPricingBusy(true)
    try {
      const result = await invokeAccountFunction<{ pricing?: ReadyMadeCheckoutPricingPreview }>('ready-made-order-action', {
        action: 'preview-checkout',
        sellerItemId: item.id,
        size: size || undefined,
        quantity: parsedQuantity,
        fulfillment,
        address: needsAddress ? address.trim() : undefined,
        city: needsAddress ? city.trim() : undefined,
        region: needsAddress ? region.trim() : undefined,
        postalCode: needsAddress ? postalCode.trim() : undefined,
        countryCode: needsAddress ? countryCode.trim().toUpperCase() : undefined,
      })
      setPricingPreview(result.pricing ?? null)
      setPricingKey(previewKey)
      setSuccess('Tax and total are ready for review.')
    } catch (previewError) {
      setPricingPreview(null)
      setPricingKey('')
      const message = friendlyActionError(previewError, 'We could not calculate tax and totals for this checkout right now.')
      if (!handlePickupSetupFallback(message)) {
        setError(message)
      }
    } finally {
      setPricingBusy(false)
    }
  }

  async function startCheckout() {
    const parsedQuantity = validateCheckoutInput()
    if (!parsedQuantity) return
    if (!previewIsFresh) {
      setError('Review the latest tax and total before creating checkout.')
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
      const message = friendlyActionError(checkoutError, 'Ready-made checkout could not start. Refresh and try again.')
      if (!handlePickupSetupFallback(message)) {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="ready-made-checkout" className="scroll-mt-28 rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
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
        {fulfillment === 'PICKUP' ? (
          <p className="text-sm leading-6 text-ink/58">Exact pickup details are shared only after the seller marks the order ready for collection.</p>
        ) : null}
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
        <div className="rounded-[1.25rem] border border-ink/8 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Tax and total</p>
          {pricingPreview ? (
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">Item subtotal</span>
                <span className="font-semibold text-ink">{formatMoney(pricingPreview.subtotalAmount, pricingPreview.currency)}</span>
              </div>
              {pricingPreview.shippingAmount > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-ink/58">Drapeon fulfillment</span>
                  <span className="font-semibold text-ink">{formatMoney(pricingPreview.shippingAmount, pricingPreview.currency)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">{pricingPreview.taxFallback ? 'Estimated tax' : pricingPreview.taxLabel || 'Tax'}</span>
                <span className="font-semibold text-ink">{formatMoney(pricingPreview.taxAmount, pricingPreview.currency)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 border-t border-ink/8 pt-3">
                <span className="font-semibold text-ink">Total</span>
                <span className="text-lg font-semibold text-needle">{formatMoney(pricingPreview.totalAmount, pricingPreview.currency)}</span>
              </div>
              {pricingPreview.taxFallback ? (
                <p className="text-xs leading-5 text-rust">Tax is estimated because live tax lookup was unavailable for this address.</p>
              ) : null}
              {!previewIsFresh ? (
                <p className="text-xs leading-5 text-rust">Checkout details changed. Refresh the tax preview before creating checkout.</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink/62">Calculate the checkout preview to see locked tax and total before payment starts.</p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => { void previewCheckout() }} disabled={pricingBusy || busy || !data.userId} className="inline-flex justify-center rounded-full border border-needle/18 bg-white px-5 py-3 text-sm font-semibold text-needle disabled:cursor-not-allowed disabled:text-ink/30">
            {pricingBusy ? 'Calculating...' : 'Preview tax and total'}
          </button>
          <button type="button" onClick={startCheckout} disabled={busy || pricingBusy || !data.userId || !previewIsFresh} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Starting checkout...' : 'Create checkout'}
          </button>
        </div>
      </div>
    </section>
  )
}

function ProfileSettingsEditor({ data, session, onRefresh }: { data: SettingsRenderData; session: Session | null; onRefresh: () => void }) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
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

function AvatarUploadPanel({ data, session, onRefresh }: { data: Pick<SettingsRenderData, 'userId' | 'customerProfile' | 'tailorProfile'>; session: Session | null; onRefresh: () => void }) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const currentAvatar = safeMediaUrl(data.tailorProfile?.avatar_url ?? data.customerProfile?.avatar_url, 'avatars')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const displayAvatar = previewUrl ?? currentAvatar

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  function setSelectedAvatarFile(nextFile: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setFile(nextFile)
    if (!nextFile) {
      setPreviewUrl(null)
      return
    }
    const nextPreviewUrl = URL.createObjectURL(nextFile)
    previewUrlRef.current = nextPreviewUrl
    setPreviewUrl(nextPreviewUrl)
  }

  async function saveAvatar() {
    setError(null)
    setSuccess(null)
    if (!data.userId || !file) {
      setError('Choose a profile photo first.')
      return
    }
    const photoError = validateMessagePhoto(file)
    if (photoError) {
      setError(photoError)
      return
    }
    setBusy(true)
    try {
      const prepared = await reencodeImageFile(file)
      const avatarUrl = await uploadPublicFile('avatars', data.userId, prepared)
      await invokeAccountFunction('account-profile-action', {
        action: 'update-avatar',
        role,
        avatarUrl,
      })
      setSelectedAvatarFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setSuccess('Profile photo updated.')
      onRefresh()
    } catch (avatarError) {
      setError(friendlyActionError(avatarError, 'Profile photo could not update.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
      <div className="grid gap-5 md:grid-cols-[120px_1fr] md:items-center">
        <div className="relative h-28 w-28 overflow-hidden rounded-[1.25rem] border border-ink/8 bg-bone">
          {displayAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayAvatar} alt={previewUrl ? 'Selected profile preview' : 'Current profile'} className="h-full w-full object-cover" />
          ) : null}
          {previewUrl ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-ink/72 px-2 py-1 text-[0.68rem] font-semibold text-white">
              Preview
            </span>
          ) : null}
        </div>
        <div className="grid gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Profile photo</p>
          <h2 className="text-3xl text-ink">Update avatar</h2>
          <ActionNotice error={error} success={success} />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              setError(null)
              setSuccess(null)
              setSelectedAvatarFile(event.target.files?.[0] ?? null)
            }}
            className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
          />
          <button type="button" onClick={saveAvatar} disabled={busy || !file} className="inline-flex w-fit justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Uploading...' : 'Save profile photo'}
          </button>
        </div>
      </div>
    </section>
  )
}

function PortfolioManager({ data, onRefresh }: { data: Pick<ProfileRenderData, 'userId' | 'tailorProfile' | 'portfolioItems'>; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingItem = data.portfolioItems.find((item) => item.id === editingId) ?? null
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  if (!data.tailorProfile) return null

  function startEdit(item: PortfolioItem) {
    setEditingId(item.id)
    setTitle(item.title ?? '')
    setCategory(item.category ?? '')
    setDescription(item.description ?? '')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setCategory('')
    setDescription('')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function savePortfolioItem() {
    setError(null)
    setSuccess(null)
    if (!data.userId) return
    const leak = assertNoContactLeak([title, category, description].join('\n'), "Portfolio items can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!title.trim()) {
      setError('Add a portfolio title.')
      return
    }
    if (!editingItem && !file) {
      setError('Choose a portfolio image.')
      return
    }
    if (file) {
      const photoError = validateMessagePhoto(file)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    setBusy('save')
    try {
      const imageUrl = file
        ? await uploadPublicFile('portfolio-photos', `portfolio/${data.userId}`, await reencodeImageFile(file))
        : editingItem?.image_url
      if (!imageUrl) throw new Error('Choose a portfolio image.')
      await invokeAccountFunction('portfolio-item-action', editingId
        ? {
            action: 'update-item',
            itemId: editingId,
            item: {
              imageUrl,
              title: title.trim(),
              category: category.trim() || null,
              description: description.trim() || null,
            },
          }
        : {
            action: 'create-item',
            item: {
              imageUrl,
              title: title.trim(),
              category: category.trim() || null,
              description: description.trim() || null,
            },
          })
      setSuccess(editingId ? 'Portfolio item updated.' : 'Portfolio item added.')
      resetForm()
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio item could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function runPortfolioAction(action: 'delete-item' | 'set-cover', itemId: string) {
    setError(null)
    setSuccess(null)
    setBusy(`${action}:${itemId}`)
    try {
      await invokeAccountFunction('portfolio-item-action', { action, itemId })
      setSuccess(action === 'set-cover' ? 'Cover photo updated.' : 'Portfolio item deleted.')
      if (editingId === itemId) resetForm()
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio action could not finish.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Portfolio</p>
          <h2 className="mt-2 text-3xl text-ink">Manage public work</h2>
        </div>
        {editingId ? (
          <button type="button" onClick={resetForm} className="text-sm font-semibold text-rust">Cancel edit</button>
        ) : null}
      </div>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink md:col-span-2" />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Short description" className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50 md:col-span-2" />
        </div>
        <button type="button" onClick={savePortfolioItem} disabled={busy === 'save'} className="inline-flex w-fit justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy === 'save' ? 'Saving...' : editingId ? 'Update portfolio item' : 'Add portfolio item'}
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.portfolioItems.length === 0 ? (
          <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62 md:col-span-2 xl:col-span-3">
            No editable portfolio rows yet. Add one to make your public profile stronger.
          </p>
        ) : data.portfolioItems.map((item, index) => (
          <article key={item.id} className="rounded-[1.2rem] border border-ink/8 bg-bone/45 p-4">
            <PhotoTile src={item.image_url} label="Portfolio item" />
            <h3 className="mt-3 text-xl font-semibold text-ink">{safeUserText(item.title, `Portfolio ${index + 1}`)}</h3>
            <p className="mt-2 text-sm leading-6 text-ink/62">{safeUserText(item.description, safeUserText(item.category, 'Portfolio work'))}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => startEdit(item)} className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink">Edit</button>
              <button type="button" onClick={() => runPortfolioAction('set-cover', item.id)} disabled={!!busy} className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:text-ink/40">Set cover</button>
              <button type="button" onClick={() => runPortfolioAction('delete-item', item.id)} disabled={!!busy} className="rounded-full border border-rust/20 bg-white px-4 py-2 text-sm font-semibold text-rust disabled:text-ink/40">Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function RenderExplore({ data }: { data: ExploreRenderData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasInitialFilters = searchParams.toString().length > 0
  const initialSort = searchParams.get('sort')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(hasInitialFilters)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [specialty, setSpecialty] = useState(searchParams.get('specialty') ?? 'all')
  const [location, setLocation] = useState(searchParams.get('location') ?? 'all')
  const [availability, setAvailability] = useState(searchParams.get('availability') ?? 'all')
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') ?? '')
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') ?? '')
  const [sort, setSort] = useState(initialSort === 'recent' ? 'popular' : initialSort ?? 'rating')
  const [customOnly, setCustomOnly] = useState(searchParams.get('custom') === '1')
  const specialties = uniqueValues(data.exploreTailors.flatMap((tailor) => stringList(tailor.specialty_tags))).slice(0, 18)
  const locations = uniqueValues(data.exploreTailors.map((tailor) => tailor.location).filter((value): value is string => !!value)).slice(0, 18)
  const normalizedCurrency = normalizeAccountCurrency(data.accountCurrency)
  const priceCurrencyLabel = normalizedCurrency ? `${currencySymbol(normalizedCurrency)} ${normalizedCurrency}` : 'currency'
  const parsedMinPrice = minPrice.trim() ? Number.parseFloat(minPrice.replace(/[^\d.]/g, '')) : null
  const parsedMaxPrice = maxPrice.trim() ? Number.parseFloat(maxPrice.replace(/[^\d.]/g, '')) : null

  useEffect(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (specialty !== 'all') params.set('specialty', specialty)
    if (location !== 'all') params.set('location', location)
    if (availability !== 'all') params.set('availability', availability)
    if (minPrice.trim()) params.set('minPrice', minPrice.trim())
    if (maxPrice.trim()) params.set('maxPrice', maxPrice.trim())
    if (sort !== 'rating') params.set('sort', sort)
    if (customOnly) params.set('custom', '1')
    const nextQuery = params.toString()
    const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname
    router.replace(nextHref as Route, { scroll: false })
  }, [availability, customOnly, location, maxPrice, minPrice, pathname, router, search, sort, specialty])

  const filteredTailors = data.exploreTailors.filter((tailor) => {
    const haystack = [
      tailor.display_name,
      tailor.business_name,
      tailor.bio,
      tailor.location,
      ...stringList(tailor.specialty_tags),
    ].join(' ').toLowerCase()
    if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false
    if (specialty !== 'all' && !stringList(tailor.specialty_tags).includes(specialty)) return false
    if (location !== 'all' && tailor.location !== location) return false
    if (availability !== 'all' && tailor.availability !== availability) return false
    if (customOnly && !tailor.supports_custom_orders) return false
    if (parsedMinPrice && Number.isFinite(parsedMinPrice) && tailor.price_range_max && tailor.price_range_max / 100 < parsedMinPrice) return false
    if (parsedMaxPrice && Number.isFinite(parsedMaxPrice) && tailor.price_range_min && tailor.price_range_min / 100 > parsedMaxPrice) return false
    return true
  }).sort((a, b) => {
    if (sort === 'price') return (a.price_range_min ?? Number.MAX_SAFE_INTEGER) - (b.price_range_min ?? Number.MAX_SAFE_INTEGER)
    if (sort === 'popular') return (b.total_orders ?? 0) - (a.total_orders ?? 0)
    const ratingDelta = (b.avg_rating ?? 0) - (a.avg_rating ?? 0)
    if (ratingDelta !== 0) return ratingDelta
    return (b.total_orders ?? 0) - (a.total_orders ?? 0)
  })
  const availabilityOptions = uniqueValues(data.exploreTailors.map((tailor) => tailor.availability).filter((value): value is string => !!value))
  const activeFilterCount = [
    specialty !== 'all',
    location !== 'all',
    availability !== 'all',
    minPrice.trim(),
    maxPrice.trim(),
    sort !== 'rating',
    customOnly,
  ].filter(Boolean).length

  function clearFilters() {
    setSearch('')
    setSpecialty('all')
    setLocation('all')
    setAvailability('all')
    setMinPrice('')
    setMaxPrice('')
    setSort('rating')
    setCustomOnly(false)
  }

  const filterSidebar = (
    <div className="grid gap-5">
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Sort</p>
        <div className="grid gap-1">
          {([['rating', 'Top rated'], ['popular', 'Most orders'], ['price', 'Lowest price']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setSort(value)}
              className={sort === value
                ? 'rounded-[0.65rem] bg-needle px-3 py-2 text-left text-sm font-semibold text-white'
                : 'rounded-[0.65rem] px-3 py-2 text-left text-sm font-semibold text-ink/62 hover:bg-ink/5 hover:text-ink'}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <hr className="border-ink/6" />
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Specialty</p>
        <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="w-full rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="all">All specialties</option>
          {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Location</p>
        <select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="all">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Availability</p>
        <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="w-full rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="all">Any availability</option>
          {availabilityOptions.map((a) => <option key={a} value={a}>{cleanLabel(a)}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Price <span className="normal-case font-normal text-ink/38">({priceCurrencyLabel})</span></p>
        <div className="flex items-center gap-2">
          <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} inputMode="decimal" placeholder="Min" className="w-full rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
          <span className="text-xs text-ink/36">–</span>
          <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} inputMode="decimal" placeholder="Max" className="w-full rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-[0.75rem] border border-ink/8 bg-white/72 px-3 py-2.5">
        <input type="checkbox" checked={customOnly} onChange={(e) => setCustomOnly(e.target.checked)} className="h-4 w-4 rounded accent-needle" />
        <span className="text-sm font-semibold text-ink">Custom orders only</span>
      </label>
      {activeFilterCount > 0 ? (
        <button type="button" onClick={clearFilters} className="rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink/66 hover:text-ink">
          Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
        </button>
      ) : null}
    </div>
  )

  return (
    <div className="grid gap-4">
      {/* Search + mobile filters toggle */}
      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by tailor, style, or location..."
          className="min-w-0 flex-1 rounded-full border border-ink/10 bg-white px-5 py-3 text-sm text-ink shadow-sm outline-none focus:border-needle/40"
        />
        <button
          type="button"
          onClick={() => setMobileFiltersOpen((o) => !o)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-3 text-sm font-semibold lg:hidden ${activeFilterCount > 0 ? 'border-needle/30 bg-needle text-white' : 'border-ink/10 bg-white text-ink'}`}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {/* Mobile filter panel */}
      {mobileFiltersOpen ? (
        <div className="rounded-[1.25rem] border border-ink/8 bg-white/88 p-5 shadow-sm lg:hidden">
          {filterSidebar}
        </div>
      ) : null}

      {/* Specialty quick chips */}
      <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
        {(['all', ...specialties.slice(0, 10)] as string[]).map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => setSpecialty(tag)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${specialty === tag ? 'bg-needle text-white' : 'border border-ink/10 bg-white text-ink/66 hover:bg-ink/5 hover:text-ink'}`}
          >
            {tag === 'all' ? 'All tailors' : tag}
          </button>
        ))}
      </div>

      {/* Two-column layout: sidebar + results */}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 rounded-[1.25rem] border border-ink/8 bg-white/88 p-5 shadow-sm">
            {filterSidebar}
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-ink/52">
              {filteredTailors.length} tailor{filteredTailors.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 ? ' matching filters' : ''}
            </p>
            <Link href="/account/shop" className="text-sm font-semibold text-needle">
              Ready-made pieces →
            </Link>
          </div>

          {filteredTailors.length === 0 ? (
            <EmptyState title="No tailors match these filters." body="Adjust filters or clear them to see all tailors." />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredTailors.map((tailor) => {
                const photo = tailorPhoto(tailor)
                const safeSrc = safeMediaUrl(photo)
                const specialtyTags = stringList(tailor.specialty_tags).slice(0, 3)
                const ratingText = tailor.total_reviews
                  ? `${Number(tailor.avg_rating ?? 0).toFixed(1)} (${tailor.total_reviews})`
                  : null
                const priceFrom = tailor.price_range_min ? `from ${formatMoney(tailor.price_range_min, tailor.currency)}` : null
                return (
                  <article key={tailor.id} className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_12px_36px_rgba(22,28,24,0.10)]">
                    {/* Edge-to-edge photo with overlaid badges */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-needle/10">
                      {safeSrc ? (
                        <Image src={safeSrc} alt={safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/60">
                          {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      {/* Overlaid badges */}
                      <div className="absolute inset-x-3 top-3 flex items-start justify-between">
                        {tailor.is_verified ? (
                          <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-needle shadow-sm backdrop-blur-sm">
                            Verified
                          </span>
                        ) : <span />}
                        {ratingText ? (
                          <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">
                            ★ {ratingText}
                          </span>
                        ) : null}
                      </div>
                      {/* Availability + price overlaid at bottom */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/78 to-transparent px-4 pb-3 pt-10">
                        <p className="text-xs font-semibold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                          {cleanLabel(tailor.availability, 'Check availability')}{priceFrom ? ` · ${priceFrom}` : ''}
                        </p>
                      </div>
                    </div>
                    {/* Card body */}
                    <div className="p-4">
                      <h3 className="text-xl font-semibold text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h3>
                      <p className="mt-0.5 text-sm text-ink/52">{safeUserText(tailor.location, 'Location pending')}</p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/62">
                        {safeUserText(tailor.bio, safeList(tailor.specialty_tags, 'Custom tailoring on Drapeon.'))}
                      </p>
                      {specialtyTags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {specialtyTags.map((tag) => (
                            <span key={tag} className="rounded-full bg-needle/8 px-2.5 py-1 text-xs font-semibold text-needle">{tag}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                          View profile
                        </Link>
                        {tailor.supports_custom_orders ? (
                          <Link href={accountRoute(`/account/brief/${tailor.id}`)} className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white">
                            Request brief
                          </Link>
                        ) : (
                          <OpenAppButton label="Start in app" className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white" />
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function measurementSnapshotForChoice(data: Pick<BriefRenderData, 'customerProfile' | 'measurementProfiles'>, choice: string) {
  if (choice === 'legacy' && data.customerProfile?.measurements) {
    return {
      ...data.customerProfile.measurements,
      measurementSource: 'web_legacy_customer_profile',
      unit: data.customerProfile.unit_preference ?? (data.customerProfile.measurements.unit as string | undefined) ?? 'in',
      measurementProfileLabel: 'Customer profile',
      measurementProfileUpdatedAt: data.customerProfile.updated_at,
    }
  }
  const profile = data.measurementProfiles.find((entry) => entry.id === choice)
  if (!profile?.measurements) return null
  return {
    ...profile.measurements,
    measurementSource: `web_${profile.source ?? 'measurement_profile'}`,
    unit: profile.unit_preference ?? (profile.measurements.unit as string | undefined) ?? 'in',
    measurementProfileId: profile.id,
    measurementProfileLabel: profile.label ?? 'Saved measurement profile',
    measurementProfileUpdatedAt: profile.updated_at ?? profile.last_measured_at,
  }
}

function measurementTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  for (const field of ['measurementProfileUpdatedAt', 'capturedAt', 'confirmedAt']) {
    const raw = snapshot[field]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const date = new Date(raw)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}

function measurementAgeFromSnapshot(value: unknown, now = new Date()) {
  const lastUpdated = measurementTimestamp(value)
  if (!lastUpdated) return null
  const ageMonths = Math.max(0, Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
  return {
    lastUpdatedAt: lastUpdated.toISOString(),
    ageMonths,
    stale: ageMonths >= 6,
    warningShown: ageMonths >= 6,
  }
}

function defaultDeliveryMethodForTailor(tailor: TailorProfile | null | undefined) {
  if (tailor?.pickup_available) return 'LOCAL_COLLECTION'
  if (tailor?.delivery_available) return 'LOCAL_DELIVERY'
  return 'SHIPPING'
}

function RenderBrief({ data, tailorId, onRefresh }: { data: BriefRenderData; tailorId?: string; onRefresh: () => void }) {
  const router = useRouter()
  const tailor = data.tailor
  const firstMeasurementId = data.measurementProfiles[0]?.id ?? (data.customerProfile?.measurements ? 'legacy' : 'fallback')
  const [garmentType, setGarmentType] = useState('Agbada')
  const [garmentTypeOther, setGarmentTypeOther] = useState('')
  const [genderPresentation, setGenderPresentation] = useState<'Menswear' | 'Womenswear' | 'Unisex'>('Unisex')
  const [description, setDescription] = useState('')
  const [occasion, setOccasion] = useState('Event')
  const [occasionOther, setOccasionOther] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadlineInput)
  const [wearerMode, setWearerMode] = useState<'SELF' | 'OTHER' | 'GROUP'>('SELF')
  const [wearerName, setWearerName] = useState('')
  const [bulkRecipientCount, setBulkRecipientCount] = useState('')
  const [bulkLabel, setBulkLabel] = useState('')
  const [bulkMemberNames, setBulkMemberNames] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [styleLinks, setStyleLinks] = useState('')
  const [styleNotes, setStyleNotes] = useState('')
  const [fitNote, setFitNote] = useState('')
  const [measurementChoice, setMeasurementChoice] = useState(firstMeasurementId)
  const [referencePhotos, setReferencePhotos] = useState<File[]>([])
  const [fabricSource, setFabricSource] = useState<'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'>('TAILOR_SOURCES')
  const [fabricDescription, setFabricDescription] = useState('')
  const [fabricBudget, setFabricBudget] = useState('')
  const [fabricSourcingDeadlineDays, setFabricSourcingDeadlineDays] = useState(CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS)
  const [deliveryMethod, setDeliveryMethod] = useState<'LOCAL_COLLECTION' | 'LOCAL_DELIVERY' | 'SHIPPING'>(defaultDeliveryMethodForTailor(tailor))
  const [shippingPreference, setShippingPreference] = useState<'STANDARD' | 'EXPRESS'>('STANDARD')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [recipientName, setRecipientName] = useState(data.customerProfile?.display_name ?? '')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryRegion, setDeliveryRegion] = useState('')
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('')
  const [deliveryCountryCode, setDeliveryCountryCode] = useState('US')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  if (!tailor || !tailorId) {
    return (
      <EmptyState
        title="Tailor not found."
        body="Choose a tailor before starting a custom brief."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }

  if (tailor.supports_custom_orders !== true) {
    return (
      <EmptyState
        title="Custom orders are not listed for this tailor."
        body="Browse ready-made pieces or open the app if you already have an active order with this tailor."
        action={<Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="font-semibold text-needle">Back to profile</Link>}
      />
    )
  }

  const selectedTailor = tailor
  const baseMeasurementSnapshot = measurementChoice === 'fallback' ? null : measurementSnapshotForChoice(data, measurementChoice)
  const styleReferenceLinks = linesToUrls(styleLinks)
  const needsDeliveryDetails = deliveryMethod !== 'LOCAL_COLLECTION'
  const fabricBudgetAmount = parseMinorUnits(fabricBudget)
  const orderCurrency = data.accountCurrency ?? selectedTailor.currency ?? 'USD'

  async function submitBrief() {
    setError(null)
    setSuccess(null)
    setCreatedOrderId(null)

    const textToCheck = [
      description,
      styleNotes,
      fitNote,
      fabricDescription,
      wearerName,
      bulkLabel,
      bulkMemberNames,
      bulkNotes,
      deliveryInstructions,
      deliveryAddress,
      deliveryCity,
      deliveryRegion,
      recipientName,
      recipientPhone,
    ].join('\n')
    const leak = assertNoContactLeak(textToCheck, "Briefs can't include phone numbers, emails, links, social handles, or off-platform contact instructions.")
    if (leak) {
      setError(leak)
      return
    }
    if (!description.trim() || description.trim().length < 80) {
      setError('Write one clear paragraph, or at least 3 short lines, describing the garment.')
      return
    }
    if (garmentType === 'Other' && !garmentTypeOther.trim()) {
      setError('Describe the garment type when choosing Other.')
      return
    }
    if (styleReferenceLinks.length > CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setError(`Add no more than ${CUSTOM_ORDER_MAX_STYLE_LINKS} style links. Remove extra links before submitting.`)
      return
    }
    if (styleReferenceLinks.length === 0 && referencePhotos.length === 0) {
      setError('Add at least one Instagram, Pinterest, or TikTok reference link, or attach a reference photo.')
      return
    }
    if (wearerMode === 'OTHER' && wearerName.trim().length < 2) {
      setError('Add the wearer name for this brief.')
      return
    }
    const bulkCount = Number.parseInt(bulkRecipientCount, 10)
    if (wearerMode === 'GROUP' && (!Number.isFinite(bulkCount) || bulkCount < 2)) {
      setError('Add at least 2 wearers for a group order.')
      return
    }
    if (!baseMeasurementSnapshot && fitNote.trim().length < 24) {
      setError('Add saved measurements, or write a fit note telling the tailor to follow up before quoting.')
      return
    }
    if (fabricSource === 'TAILOR_SOURCES' && fabricDescription.trim().length < 8) {
      setError('Describe the fabric the tailor should source.')
      return
    }
    for (const photo of referencePhotos) {
      const photoError = validateMessagePhoto(photo)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    if (needsDeliveryDetails && (!recipientName.trim() || !recipientPhone.trim() || !deliveryAddress.trim())) {
      setError('Add recipient name, phone, and address for delivery or shipping.')
      return
    }
    if (!acknowledged) {
      setError('Review and acknowledge the cancellation and handoff policy before submitting.')
      return
    }

    const wearerLabel = wearerMode === 'GROUP'
      ? bulkLabel.trim() || 'Group order'
      : wearerMode === 'SELF'
        ? data.customerProfile?.display_name ?? 'Me'
        : wearerName.trim()
    const wearerContext = {
      mode: wearerMode,
      label: wearerLabel,
      measurementProfileLabel: wearerMode === 'GROUP'
        ? wearerLabel
        : measurementChoice === 'fallback'
          ? 'Tailor follow-up needed'
          : wearerLabel,
      relationship: wearerMode === 'GROUP' ? 'GROUP' : wearerMode === 'SELF' ? 'BUYER' : 'NAMED_OTHER',
      selectedAt: new Date().toISOString(),
      note: wearerMode === 'GROUP'
        ? 'Group order measurements are handled per wearer before quote acceptance.'
        : wearerMode === 'OTHER'
          ? 'Customer confirmed the attached measurements are for this named wearer.'
          : null,
    }
    const measurementSnapshot = baseMeasurementSnapshot
      ? {
          ...baseMeasurementSnapshot,
          wearerContext,
          measurementProfileLabel: wearerContext.measurementProfileLabel,
        }
      : null
    const measurementAge = measurementAgeFromSnapshot(measurementSnapshot)
    const fabricPolicy = fabricSource === 'CUSTOMER_SUPPLIES'
      ? {
          approvalRequiredForTailorSourcing: true,
          rejectionReasons: [
            'Poor fabric quality',
            'Insufficient yardage',
            'Wrong fabric type',
            'Fabric damaged or mismatched',
            'Non-continuous remnants or unusable width',
          ],
          lateFabricRule: 'Production stays paused until the tailor confirms fabric receipt.',
          missingFabricRule: 'If the fabric never arrives, the customer can resend, ask the tailor to source, revise the design, or request cancellation review.',
          replacementRule: 'Replacement fabric must be confirmed inside the order before cutting resumes.',
          disagreementRule: 'If fabric suitability is disputed, Drapeon reviews the timeline before work continues.',
          prepRequirements: [
            'Share the handoff plan before the order is submitted',
            'Keep any shipping reference inside the order thread',
            'Keep receipt or dropoff proof in Drapeon if fabric value is material',
            'Do not expect cutting to start before receipt is confirmed',
          ],
        }
      : {
          approvalRequiredForTailorSourcing: true,
          replacementRule: 'Tailor-sourced fabric should only be replaced after customer approval inside Drapeon.',
          disagreementRule: 'If sourcing changes the agreed design or budget, Drapeon should review before work continues.',
          prepRequirements: [
            'Fabric sourcing is covered by the accepted quote',
            'Tailor should not buy replacement fabric without approval',
            'Fabric proof should be photographed in natural light when color matters',
          ],
        }
    const bulkMembers = bulkMemberNames
      .split(/\n|,/u)
      .map((name) => name.trim())
      .filter(Boolean)
    const bulkOrder = wearerMode === 'GROUP'
      ? {
          enabled: true,
          mode: 'OPS_MANAGED_SPECIAL_CASE',
          label: bulkLabel.trim() || null,
          recipientCount: bulkCount,
          memberNames: bulkMembers.length > 0 ? bulkMembers : null,
          memberMeasurementPolicy: 'Each wearer needs their own measurement profile before quote acceptance. Do not reuse the buyer profile unless the buyer is also that wearer.',
          payerModel: 'SINGLE_PAYER',
          measurementPrivacy: 'TAILOR_ONLY',
          statusPolicy: 'OPS_MANAGED_LINKED_CHILDREN',
          dyeLotConsistencyRequired: true,
          notes: bulkNotes.trim() || null,
        }
      : null
    const styleAlignment = {
      requiredBeforeCutting: true,
      referencePhotoCount: referencePhotos.length,
      styleReferenceLinkCount: styleReferenceLinks.length,
      instruction: 'Before cutting, confirm what can and cannot be matched from the customer references inside Drapeon.',
      customerExpectation: 'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.',
    }
    const supportMeta = {
      source: 'web',
      wearerContext,
      bulkOrder,
      fabricPolicy,
      measurementAge,
      styleAlignment,
      measurementFallback: !measurementSnapshot
        ? { requiredBeforeQuote: true, note: fitNote.trim() }
        : null,
      fabricHandoffMode: fabricSource === 'CUSTOMER_SUPPLIES' ? 'CUSTOMER_TO_TAILOR' : 'NO_CUSTOMER_HANDOFF_REQUIRED',
      fabricHandoffLabel: fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer will coordinate fabric handoff in Drapeon' : 'No customer fabric handoff required',
      fabricSourcing: fabricSource === 'TAILOR_SOURCES'
        ? {
            description: fabricDescription.trim() || null,
            budgetAmount: fabricBudgetAmount,
            budgetCurrency: fabricBudgetAmount ? orderCurrency : null,
            deadlineBusinessDays: fabricSourcingDeadlineDays,
          }
        : null,
      webBrief: {
        createdAt: new Date().toISOString(),
        styleReferenceLinkCount: styleReferenceLinks.length,
        referencePhotoCount: referencePhotos.length,
        hasReferencePhoto: referencePhotos.length > 0,
      },
    }

    const buildPayload = (action: 'preflight-create-order' | 'create-order', uploadedReferencePhotoUrls: string[]) => ({
      action,
      tailorProfileId: selectedTailor.id,
      garmentType,
      garmentTypeOther: garmentType === 'Other' ? garmentTypeOther.trim() : null,
      genderPresentation,
      description: description.trim(),
      occasion: occasion === 'Other' ? occasionOther.trim() || 'Other' : occasion || null,
      deadline: dateInputToIso(deadline),
      referencePhotos: uploadedReferencePhotoUrls,
      referencePhotoCount: action === 'preflight-create-order' ? referencePhotos.length : uploadedReferencePhotoUrls.length,
      styleReferenceLinks,
      styleNotes: styleNotes.trim() || null,
      customerMeasurementsSnapshot: measurementSnapshot,
      fitNote: fitNote.trim() || null,
      bodyNote: fitNote.trim() || null,
      fabricSource,
      fabricDescription: fabricSource === 'TAILOR_SOURCES' ? fabricDescription.trim() : null,
      fabricBudgetAmount,
      fabricBudgetCurrency: fabricBudgetAmount ? orderCurrency : null,
      fabricSourcingDeadlineDays: fabricSource === 'TAILOR_SOURCES' ? fabricSourcingDeadlineDays : null,
      supportMeta,
      deliveryMethod,
      shippingPreference: deliveryMethod === 'SHIPPING' ? shippingPreference : null,
      deliveryInstructions: deliveryInstructions.trim() || null,
      deliveryAddress: needsDeliveryDetails ? deliveryAddress.trim() : null,
      deliveryCity: needsDeliveryDetails ? deliveryCity.trim() : null,
      deliveryRegion: needsDeliveryDetails ? deliveryRegion.trim() : null,
      deliveryPostalCode: needsDeliveryDetails ? deliveryPostalCode.trim() : null,
      deliveryCountryCode: needsDeliveryDetails ? deliveryCountryCode.trim().toUpperCase() : null,
      recipientName: needsDeliveryDetails ? recipientName.trim() : null,
      recipientPhone: needsDeliveryDetails ? recipientPhone.trim() : null,
      cancellationPolicyAcknowledged: acknowledged,
    })

    setBusy(true)
    try {
      await invokeAccountFunction('custom-order-action', buildPayload('preflight-create-order', []))
      const uploadedReferencePhotos: string[] = []
      for (const photo of referencePhotos) {
        const preparedPhoto = await reencodeImageFile(photo)
        uploadedReferencePhotos.push(await uploadPublicFile('order-photos', `brief/${data.userId}`, preparedPhoto))
      }
      const result = await invokeAccountFunction<{ orderId?: string }>('custom-order-action', buildPayload('create-order', uploadedReferencePhotos))
      setCreatedOrderId(result.orderId ?? null)
      setSuccess('Custom brief sent. Opening the new order so you can track the quote.')
      setDescription('')
      setStyleLinks('')
      setStyleNotes('')
      setFitNote('')
      setOccasionOther('')
      setWearerName('')
      setBulkRecipientCount('')
      setBulkLabel('')
      setBulkMemberNames('')
      setBulkNotes('')
      setDeliveryInstructions('')
      setReferencePhotos([])
      if (photoInputRef.current) photoInputRef.current.value = ''
      onRefresh()
      if (result.orderId) {
        router.push(accountRoute(`/account/orders/${result.orderId}`))
      }
    } catch (briefError) {
      setError(friendlyActionError(briefError, 'Custom brief could not be submitted. Check required fields and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const deliveryOptions = [
    selectedTailor.pickup_available ? ['LOCAL_COLLECTION', 'Local collection'] : null,
    selectedTailor.delivery_available ? ['LOCAL_DELIVERY', 'Local delivery'] : null,
    selectedTailor.shipping_available ? ['SHIPPING', 'Shipping'] : null,
  ].filter((entry): entry is [string, string] => !!entry)
  if (deliveryOptions.length === 0) deliveryOptions.push(['LOCAL_COLLECTION', 'Local collection'])

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)] lg:items-start">
        <div className="rounded-[1.1rem] border border-ink/8 bg-white/84 p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start lg:block">
            <PhotoTile src={tailorPhoto(selectedTailor)} label="Tailor profile" />
            <div>
              <h2 className="mt-3 text-2xl font-semibold text-ink sm:mt-0 lg:mt-4">{safeEntityName(selectedTailor.business_name || selectedTailor.display_name, 'Tailor')}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink/62">
                {safeUserText(selectedTailor.location, 'Location pending')} · {safeList(selectedTailor.specialty_tags, 'Custom clothing')}
              </p>
              <p className="mt-3 w-fit rounded-full bg-bone/70 px-3 py-1.5 text-xs font-semibold text-needle">
                Availability: {cleanLabel(selectedTailor.availability, 'Ask before booking')}
              </p>
            </div>
          </div>
        </div>
        <div className="self-start rounded-[1.1rem] border border-needle/12 bg-needle/8 p-4 shadow-sm sm:p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-needle/80">Before quote</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-ink sm:text-2xl">The tailor reviews this before pricing.</h2>
          <p className="mt-2 text-sm leading-6 text-ink/66">
            This sends a pending-quote order. If measurements are missing, the brief tells the tailor to follow up before quoting.
          </p>
        </div>
      </section>

      <section className="rounded-[1.1rem] border border-ink/8 bg-white/84 p-4 shadow-sm sm:p-5">
        <div className="grid gap-5">
          <ActionNotice error={error} success={success} />
          {createdOrderId ? (
            <Link href={accountRoute(`/account/orders/${createdOrderId}`)} className="inline-flex w-fit rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
              Open submitted order
            </Link>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Garment</span>
              <select value={garmentType} onChange={(event) => setGarmentType(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {WEB_GARMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fit category</span>
              <select value={genderPresentation} onChange={(event) => setGenderPresentation(event.target.value as typeof genderPresentation)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="Unisex">Unisex</option>
                <option value="Menswear">Menswear</option>
                <option value="Womenswear">Womenswear</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Target date</span>
              <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          </div>
          {garmentType === 'Other' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Garment type details</span>
              <input value={garmentTypeOther} onChange={(event) => setGarmentTypeOther(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          ) : null}
          <div className="grid gap-4 rounded-[1rem] border border-ink/6 bg-bone/35 p-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Wearer</span>
              <select value={wearerMode} onChange={(event) => setWearerMode(event.target.value as typeof wearerMode)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="SELF">Me</option>
                <option value="OTHER">Someone else</option>
                <option value="GROUP">Group order</option>
              </select>
            </label>
            {wearerMode === 'OTHER' ? (
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Wearer name</span>
                <input value={wearerName} onChange={(event) => setWearerName(event.target.value)} placeholder="Name used for this measurement profile" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            ) : null}
            {wearerMode === 'GROUP' ? (
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Group name</span>
                  <input value={bulkLabel} onChange={(event) => setBulkLabel(event.target.value)} placeholder="Wedding party, choir..." className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Wearers</span>
                  <input value={bulkRecipientCount} onChange={(event) => setBulkRecipientCount(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="2+" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
                <label className="grid gap-2 md:col-span-3">
                  <span className="text-sm font-semibold text-ink">Members and notes</span>
                  <textarea value={`${bulkMemberNames}${bulkNotes ? `\n\n${bulkNotes}` : ''}`} onChange={(event) => {
                    const [members = '', ...notes] = event.target.value.split(/\n\n/u)
                    setBulkMemberNames(members)
                    setBulkNotes(notes.join('\n\n'))
                  }} rows={3} placeholder="Names separated by commas or lines, then optional notes." className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
              </>
            ) : null}
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Brief</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={1200} placeholder="Describe the outfit, silhouette, occasion, fabric expectations, and anything the tailor must know." className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Occasion</span>
              <select value={occasion} onChange={(event) => setOccasion(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {WEB_OCCASION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Reference photos</span>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  if (files.length > CUSTOM_ORDER_MAX_REFERENCE_PHOTOS) {
                    setReferencePhotos(files.slice(0, CUSTOM_ORDER_MAX_REFERENCE_PHOTOS))
                    setError(`Only the first ${CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} reference photos were selected.`)
                    return
                  }
                  setReferencePhotos(files)
                  setError(null)
                }}
                className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
              />
              <span className="text-xs leading-5 text-ink/52">{referencePhotos.length}/{CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} photos selected.</span>
            </label>
          </div>
          {occasion === 'Other' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Occasion details</span>
              <input value={occasionOther} onChange={(event) => setOccasionOther(event.target.value)} placeholder="Naming ceremony, corporate gala, festival..." className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          ) : null}
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Style links</span>
            <input value={styleLinks} onChange={(event) => setStyleLinks(event.target.value)} placeholder="Instagram, Pinterest, or TikTok links" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <span className="text-xs leading-5 text-ink/52">
              Add up to {CUSTOM_ORDER_MAX_STYLE_LINKS} supported links. Extra links must be removed before submitting.
            </span>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Style notes</span>
            <textarea value={styleNotes} onChange={(event) => setStyleNotes(event.target.value)} rows={3} maxLength={1200} className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Measurements</span>
              <select value={measurementChoice} onChange={(event) => setMeasurementChoice(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {data.measurementProfiles.map((profile) => <option key={profile.id} value={profile.id}>{safeUserText(profile.label, 'Saved profile')}</option>)}
                {data.customerProfile?.measurements ? <option value="legacy">Customer profile</option> : null}
                <option value="fallback">No measurements yet</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fit note</span>
              <input value={fitNote} onChange={(event) => setFitNote(event.target.value)} placeholder="Fit preference or tailor follow-up note" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <span className="text-xs leading-5 text-ink/52">
                If you choose no measurements, tell the tailor what to ask before quoting. The tailor should confirm measurements before production starts.
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fabric</span>
              <select value={fabricSource} onChange={(event) => setFabricSource(event.target.value as typeof fabricSource)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="TAILOR_SOURCES">Tailor sources fabric</option>
                <option value="CUSTOMER_SUPPLIES">Customer supplies fabric</option>
              </select>
            </label>
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-semibold text-ink">Fabric details</span>
              <input value={fabricDescription} onChange={(event) => setFabricDescription(event.target.value)} placeholder={fabricSource === 'TAILOR_SOURCES' ? 'Fabric type, color, weight, budget notes' : 'What you already have and how it will be handed off'} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
            {fabricSource === 'TAILOR_SOURCES' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric budget</span>
                <input value={fabricBudget} onChange={(event) => setFabricBudget(event.target.value)} inputMode="decimal" placeholder={`Optional ${orderCurrency}`} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            ) : null}
            {fabricSource === 'TAILOR_SOURCES' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Sourcing update</span>
                <select value={fabricSourcingDeadlineDays} onChange={(event) => setFabricSourcingDeadlineDays(Number.parseInt(event.target.value, 10))} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  {[3, CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS, 7, 10].map((days) => (
                    <option key={days} value={days}>{days} business days</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fulfillment</span>
              <select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value as typeof deliveryMethod)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {deliveryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {deliveryMethod === 'SHIPPING' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Shipping speed</span>
                <select value={shippingPreference} onChange={(event) => setShippingPreference(event.target.value as typeof shippingPreference)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="STANDARD">Standard</option>
                  <option value="EXPRESS">Express</option>
                </select>
              </label>
            ) : null}
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-semibold text-ink">Instructions</span>
              <input value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} placeholder="Gate, handoff, or shipping notes without contact details" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          </div>

          {needsDeliveryDetails ? (
            <div className="grid gap-4 rounded-[1.25rem] border border-ink/6 bg-bone/45 p-4 md:grid-cols-2">
              <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Recipient name" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder="Recipient phone" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Address" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50 md:col-span-2" />
              <input value={deliveryCity} onChange={(event) => setDeliveryCity(event.target.value)} placeholder="City" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <input value={deliveryRegion} onChange={(event) => setDeliveryRegion(event.target.value)} placeholder="State / region" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <input value={deliveryPostalCode} onChange={(event) => setDeliveryPostalCode(event.target.value)} placeholder="Postal code" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <input value={deliveryCountryCode} onChange={(event) => setDeliveryCountryCode(event.target.value.toUpperCase().slice(0, 2))} placeholder="Country code" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            </div>
          ) : null}

          <label className="flex items-start gap-3 rounded-[1rem] border border-ink/8 bg-bone/55 p-4 text-sm leading-6 text-ink/66">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
            <span>
              This sends a brief for quote review, not an automatic charge. Pricing, payment, cancellation, and handoff terms stay inside Drapeon once the tailor responds.
            </span>
          </label>
          <button type="button" onClick={submitBrief} disabled={busy} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Submitting brief...' : 'Submit custom brief'}
          </button>
        </div>
      </section>
    </div>
  )
}

function OrderCard({ order, data }: { order: AccountOrder; data: OrdersRenderData }) {
  const payment = latestPayment(order.id, data.payments)
  const message = latestMessage(order.id, data.messages)
  const action = orderActionCopy(order, data)
  const progress = stageProgress(order)
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="block overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_14px_40px_rgba(22,28,24,0.10)]"
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/68">{cleanLabel(order.order_kind, 'Order')}</span>
              <StagePill stage={order.stage} />
              {action ? (
                <span className="rounded-full bg-rust/10 px-2.5 py-0.5 text-xs font-semibold text-rust">{action}</span>
              ) : null}
            </div>
            <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
            <p className="mt-1 text-sm text-ink/52">
              {partyName(order, data.userId)} · {cleanLabel(order.delivery_method, 'Fulfillment')}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xl font-semibold text-ink">{orderAmount(order)}</p>
            <p className="mt-0.5 text-xs text-ink/48">{cleanLabel(payment?.status, 'Payment pending')}</p>
            <p className="mt-0.5 text-xs text-ink/36">{formatRelative(order.updated_at ?? order.created_at)}</p>
          </div>
        </div>
        {message ? (
          <p className="mt-3 line-clamp-1 rounded-[0.7rem] bg-ink/4 px-3 py-2 text-sm text-ink/52">
            {safeUserText(message.body, message.photo_url || message.voice_url ? 'Media attached.' : 'Message recorded.')}
          </p>
        ) : null}
      </div>
      <div className="h-1 bg-ink/6">
        <div className="h-full rounded-r-full bg-needle" style={{ width: `${progress}%` }} />
      </div>
    </Link>
  )
}

function OrderReviewPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'reviews' | 'userId' | 'customerProfile' | 'tailorProfile'>
  onRefresh: () => void
}) {
  const existingReview = data.reviews.find((review) => review.order_id === order.id)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('Fit matched, Clear communication')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const readyForReview = isCustomerOrder(order, data) && ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage ?? '')

  if (!readyForReview) return null

  if (existingReview) {
    return (
      <section className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Review submitted</p>
        <h2 className="mt-2 text-3xl text-ink">Thanks for rating this order.</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          Your review helps future customers understand the tailor’s fit, communication, and delivery reliability.
        </p>
      </section>
    )
  }

  async function submitReview() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([body, tags].join('\n'), "Reviews can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    const reviewerName =
      data.customerProfile?.display_name ||
      data.tailorProfile?.display_name ||
      'Drapeon customer'
    setBusy(true)
    try {
      await invokeAccountFunction('review-action', {
        action: 'submit-tailor-review',
        orderId: order.id,
        reviewerName,
        rating,
        body: body.trim() || undefined,
        tags: splitList(tags),
      })
      setSuccess('Review submitted. It may be held briefly if moderation needs to check the text.')
      setBody('')
      onRefresh()
    } catch (reviewError) {
      setError(friendlyActionError(reviewError, 'Review could not be submitted.'))
    } finally {
      setBusy(false)
    }
  }

  const ratingLabels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent']
  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-ink/8 bg-white shadow-sm">
      <div className="bg-needle/6 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Leave a review</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink">Rate this tailor</h2>
        <p className="mt-1.5 text-sm leading-6 text-ink/62">
          Your review helps future customers understand fit quality, communication, and delivery.
        </p>
      </div>
      <div className="p-6">
        <div className="grid gap-5">
          <ActionNotice error={error} success={success} />
          <div>
            <p className="text-sm font-semibold text-ink">Rating</p>
            <div className="mt-2 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`p-0.5 text-3xl leading-none transition ${star <= rating ? 'text-amber-400' : 'text-ink/16 hover:text-amber-200'}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-sm font-semibold text-ink/52">{ratingLabels[rating]}</span>
            </div>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Tags <span className="font-normal text-ink/40">(comma-separated)</span></span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Fit matched, Clear communication" className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Review <span className="font-normal text-ink/40">(optional)</span></span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={1000} placeholder="Share your experience..." className="resize-none rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <button type="button" onClick={submitReview} disabled={busy} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Submitting...' : 'Submit review'}
          </button>
        </div>
      </div>
    </section>
  )
}

function RenderOrders({ data }: { data: OrdersRenderData }) {
  const [filter, setFilter] = useState<'active' | 'action' | 'completed' | 'all'>('active')
  const [search, setSearch] = useState('')
  const orderRows = data.orders.filter((order) => showOrderInOrdersSurface(order, data))
  const activeOrders = orderRows.filter((order) => !isTerminalOrder(order))
  const pastOrders = orderRows.filter(isTerminalOrder)
  const actionOrders = orderRows.filter((order) => orderActionCopy(order, data))
  const byFilter =
    filter === 'active'
      ? activeOrders
      : filter === 'action'
        ? actionOrders
        : filter === 'completed'
          ? pastOrders
          : orderRows
  const visibleOrders = search.trim()
    ? byFilter.filter((order) => {
        const hay = [orderTitle(order), partyName(order, data.userId), cleanLabel(order.stage), cleanLabel(order.order_kind)].join(' ').toLowerCase()
        return hay.includes(search.trim().toLowerCase())
      })
    : byFilter
  const tabs: Array<[typeof filter, string, number]> = [
    ['active', 'Active', activeOrders.length],
    ['action', 'Needs action', actionOrders.length],
    ['completed', 'Completed', pastOrders.length],
    ['all', 'All', orderRows.length],
  ]
  return (
    <div className="grid gap-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Active', activeOrders.length],
          ['Needs action', actionOrders.length],
          ['Completed', pastOrders.length],
        ].map(([label, count]) => (
          <div key={String(label)} className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
            <p className="text-2xl font-semibold text-ink">{String(count)}</p>
            <p className="text-xs text-ink/52">{String(label)}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search orders by title, party, or stage..."
        className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm text-ink shadow-sm outline-none focus:border-needle/40"
      />

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto rounded-[1.25rem] border border-ink/6 bg-white/72 p-1.5 [scrollbar-width:none]">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={
              filter === key
                ? 'whitespace-nowrap rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white'
                : 'whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold text-ink/58 transition hover:bg-ink/5 hover:text-ink'
            }
          >
            {label}
            {count > 0 ? <span className={`ml-1.5 ${filter === key ? 'opacity-70' : 'text-ink/40'}`}>{count}</span> : null}
          </button>
        ))}
      </div>

      {/* Order list */}
      <div className="grid gap-3">
        {visibleOrders.length === 0 ? (
          <EmptyState
            title={search.trim() ? 'No orders match that search.' : filter === 'action' ? 'No orders need action.' : filter === 'completed' ? 'No completed orders yet.' : 'No orders here.'}
            body="Custom and ready-made orders appear here after they are created in the app or on web."
            action={data.tailorProfile
              ? <Link href="/account/work" className="font-semibold text-needle">Back to dashboard</Link>
              : <Link href="/account/explore" className="font-semibold text-needle">Browse tailors</Link>
            }
          />
        ) : (
          visibleOrders.map((order) => <OrderCard key={order.id} order={order} data={data} />)
        )}
      </div>
    </div>
  )
}

function RenderOrderDetail({ data, onRefresh }: { data: OrderDetailRenderData; onRefresh: () => void }) {
  const order = data.order
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
    return timestampMs(a.created_at) - timestampMs(b.created_at)
  })
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const messages = data.messages.filter((message) => message.order_id === order.id)
  const proofEvidence = productionEvidenceFor(order.id, data.productionEvidence)
  const proofMediaUrls = Array.from(new Set(
    proofEvidence
      .flatMap((item) => stringList(item.photo_urls))
      .map((src) => safeMediaUrl(src))
      .filter((src): src is string => !!src),
  ))
  const viewerIsCustomer = isCustomerOrder(order, data)
  const viewerIsTailor = isTailorOrder(order, data)
  const customerCanCheckout = viewerIsCustomer && isPayableOrder(order)
  const paymentConfirmed = payments.some((payment) => ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? ''))
  const paymentFailed = order.stage === 'PAYMENT_FAILED' || payments.some((payment) => ['FAILED', 'PAYMENT_FAILED'].includes(payment.status ?? ''))
  const autoRelease = autoReleaseLabel(order.auto_release_at)
  const collectionCode = readableCode(order.collection_code)
  const shouldShowHandoffState = viewerIsCustomer && isHandoffStage(order.stage)
  const tailorCanQuote = viewerIsTailor && ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '')
  const tailorCanAdvance = viewerIsTailor && nextStageOptions(order).length > 0
  const nextActionTitle = customerCanCheckout
    ? 'Complete secure checkout.'
    : tailorCanQuote
      ? 'Send the customer a quote.'
      : tailorCanAdvance
        ? 'Update production progress.'
        : paymentConfirmed
          ? 'Review order progress.'
          : 'Review order state.'
  const nextActionBody = customerCanCheckout
    ? 'This order is ready for customer payment. Web checkout reuses any existing provider attempt so a refresh or double tap does not create a duplicate charge.'
    : viewerIsTailor
      ? 'Quotes, production stages, proof media, messages, and support context stay attached to this order.'
      : 'Payment, messages, consultation requests, stage updates, and proof media stay attached to this order. Drapeon Vision capture is available in the app when body scanning is needed.'
  const nextActionPrimary = customerCanCheckout ? (
      <Link href={`/account/checkout/${order.id}`} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
        Pay now
      </Link>
  ) : viewerIsTailor && (tailorCanQuote || tailorCanAdvance) ? (
    <a href="#tailor-actions" className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
      Work this order
    </a>
  ) : (
    <OpenAppButton label="Open order in app" />
  )
  const nextActionSecondary = customerCanCheckout ? (
    <OpenAppButton label="Open order in app" className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink" />
  ) : (
    <Link href="/account/support" className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
      Open support
    </Link>
  )

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
          <div className="mt-5">
            <StageTimeline order={order} />
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Next best action</p>
          <h3 className="mt-3 text-3xl text-ink">{nextActionTitle}</h3>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {nextActionBody}
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {nextActionPrimary}
            {nextActionSecondary}
          </div>
        </div>
      </section>

      <OrderReviewPanel order={order} data={data} onRefresh={onRefresh} />
      <CustomerOrderActions order={order} data={data} onRefresh={onRefresh} />

      {(paymentFailed || shouldShowHandoffState || autoRelease) ? (
        <section className="grid gap-4 rounded-[1.6rem] border border-rust/14 bg-white/86 p-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Order safeguards</p>
            <h2 className="mt-2 text-3xl text-ink">Important order state.</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {paymentFailed ? (
              <div className="rounded-[1.1rem] border border-rust/18 bg-rust/8 p-4">
                <h3 className="font-semibold text-ink">Payment needs attention</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  The latest payment attempt did not complete. Retry checkout before production continues.
                </p>
                <Link href={accountRoute(`/account/checkout/${order.id}`)} className="mt-4 inline-flex rounded-full bg-rust px-4 py-2.5 text-sm font-semibold text-white">
                  Retry payment
                </Link>
              </div>
            ) : null}
            {shouldShowHandoffState ? (
              <div className="rounded-[1.1rem] border border-needle/14 bg-needle/8 p-4">
                <h3 className="font-semibold text-ink">Handoff and pickup</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  {order.delivery_method === 'LOCAL_COLLECTION'
                    ? collectionCode
                      ? 'Bring this code to pickup and inspect the garment before handoff is closed.'
                      : 'Your pickup code appears here once the tailor marks the order ready for collection.'
                    : 'Track delivery here and raise a concern before auto-release if something is wrong.'}
                </p>
                {collectionCode ? (
                  <p className="mt-4 rounded-[0.9rem] bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.2em] text-needle">
                    {collectionCode}
                  </p>
                ) : null}
                {order.collection_code_expiry ? (
                  <p className="mt-2 text-xs text-ink/50">Code expires {autoReleaseLabel(order.collection_code_expiry)}.</p>
                ) : null}
              </div>
            ) : null}
            {autoRelease ? (
              <div className="rounded-[1.1rem] border border-ink/8 bg-bone/60 p-4">
                <h3 className="font-semibold text-ink">Auto-release timing</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Unless a concern is raised, this order can auto-confirm {autoRelease}.
                </p>
                <Link href={accountRoute(`/account/support?orderId=${order.id}`)} className="mt-4 inline-flex rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                  Raise a concern
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {order.customer_id === data.userId && isPayableOrder(order) ? (
        <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Checkout</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Start the real provider checkout from web. If this is an extra delivery or shipping fee, Drapeon uses the existing fulfillment payment request.
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
                    {message.sender_id === data.userId ? 'You' : 'Other party'} · {formatMessageRelative(message.created_at)}
                  </p>
                  <MessageContent message={message} />
                  {message.sender_id === data.userId ? (
                    <p className="mt-3 text-xs font-semibold text-ink/42">
                      {message.read_at ? `Read ${formatMessageRelative(message.read_at)}` : 'Sent'}
                    </p>
                  ) : null}
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

type MessageThreadFilter = 'active' | 'completed' | 'archived'

function currentNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

type AccountRealtimeNotice = {
  key: string
  orderId: string | null
  title: string
  body: string
}

function realtimeRecordValue(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function fallbackOrderTitle(orderId: string | null, ordersById: Map<string, AccountOrder>) {
  if (!orderId) return 'Drapeon order'
  return ordersById.get(orderId) ? orderTitle(ordersById.get(orderId)!) : 'Drapeon order'
}

function buildAccountRealtimeNotice({
  table,
  event,
  payload,
  ordersById,
  userId,
}: {
  table: string
  event: string
  payload: unknown
  ordersById: Map<string, AccountOrder>
  userId: string
}): AccountRealtimeNotice | null {
  const typedPayload = payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }
  const record = typedPayload.new ?? typedPayload.old ?? null
  if (!record) return null

  const recordId = realtimeRecordValue(record, 'id')
  const orderId = realtimeRecordValue(record, table === 'orders' ? 'id' : 'order_id')
  const orderCopy = fallbackOrderTitle(orderId, ordersById)
  const key = `${table}:${event}:${recordId ?? orderId ?? Date.now().toString()}`

  if (table === 'messages') {
    if (event !== 'INSERT' || realtimeRecordValue(record, 'sender_id') === userId) return null
    return {
      key,
      orderId,
      title: `New message: ${orderCopy}`,
      body: safeUserText(
        realtimeRecordValue(record, 'body'),
        realtimeRecordValue(record, 'photo_url') || realtimeRecordValue(record, 'voice_url')
          ? 'New media message'
          : 'New order message',
      ),
    }
  }

  if (table === 'orders') {
    if (event === 'INSERT') {
      return {
        key,
        orderId,
        title: realtimeRecordValue(record, 'tailor_id') === userId ? 'New order request' : 'Order created',
        body: `${orderCopy} is now ${cleanLabel(realtimeRecordValue(record, 'stage'), 'in progress')}.`,
      }
    }
    if (event === 'UPDATE') {
      return {
        key,
        orderId,
        title: `Order updated: ${orderCopy}`,
        body: `${orderCopy} is now ${cleanLabel(realtimeRecordValue(record, 'stage'), 'in progress')}.`,
      }
    }
    return null
  }

  if (table === 'order_stage_updates' && event === 'INSERT') {
    return {
      key,
      orderId,
      title: `Stage update: ${orderCopy}`,
      body: safeUserText(realtimeRecordValue(record, 'note'), cleanLabel(realtimeRecordValue(record, 'stage'), 'Order stage updated')),
    }
  }

  if (table === 'order_payments' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Payment update: ${orderCopy}`,
      body: `${cleanLabel(realtimeRecordValue(record, 'phase'), 'Payment')} is ${cleanLabel(realtimeRecordValue(record, 'status'), 'pending')}.`,
    }
  }

  if (table === 'order_material_advances' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Material advance update: ${orderCopy}`,
      body: `${cleanLabel(realtimeRecordValue(record, 'title'), 'Material advance')} is ${cleanLabel(realtimeRecordValue(record, 'status'), 'pending')}.`,
    }
  }

  if (table === 'order_production_evidence' && event === 'INSERT') {
    return {
      key,
      orderId,
      title: `Production update: ${orderCopy}`,
      body: 'New production proof was added to the order.',
    }
  }

  if (table === 'reviews' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Review update: ${orderCopy}`,
      body: 'Review activity changed on this order.',
    }
  }

  if (table === 'custom_order_details' && event === 'UPDATE') {
    return {
      key,
      orderId,
      title: `Brief updated: ${orderCopy}`,
      body: 'Custom order details changed.',
    }
  }

  return null
}

function AccountDesktopAlertsPrompt({
  permission,
  onEnable,
}: {
  permission: NotificationPermission | 'unsupported'
  onEnable: () => void
}) {
  if (permission !== 'default') return null

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-[1rem] border border-needle/12 bg-white/82 px-4 py-3 text-sm text-ink/66 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <span>Enable desktop alerts for order messages, stage changes, and payment updates while web is open.</span>
      <button
        type="button"
        onClick={onEnable}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-needle px-4 py-2 text-xs font-semibold text-white transition hover:bg-needle-600"
      >
        Enable alerts
      </button>
    </div>
  )
}

function readArchivedMessageOrderIds(storageKey: string | null) {
  if (!storageKey || typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function RenderMessages({ data, onRefresh }: { data: MessagesRenderData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const requestedOrderId = searchParams.get('orderId')
  const [realtimeMessages, setRealtimeMessages] = useState<AccountMessage[]>([])
  const [reactionPatchState, setReactionPatchState] = useState<{
    upserts: AccountMessageReaction[]
    deletedIds: Set<string>
  }>({ upserts: [], deletedIds: new Set() })
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [filter, setFilter] = useState<MessageThreadFilter>('active')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(() => requestedOrderId)
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null)
  const [archiveRevision, setArchiveRevision] = useState(0)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => currentNotificationPermission())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set())
  const notificationPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const markedReadRef = useRef<Set<string>>(new Set())
  const orderIds = useMemo(() => data.orders.map((order) => order.id), [data.orders])
  const ordersById = useMemo(() => new Map(data.orders.map((order) => [order.id, order])), [data.orders])
  const archiveStorageKey = data.userId ? `drapeon:web:archived-message-orders:${data.userId}` : null
  const archivedOrderIds = useMemo(() => {
    void archiveRevision
    return readArchivedMessageOrderIds(archiveStorageKey)
  }, [archiveRevision, archiveStorageKey])
  const liveMessages = useMemo(() => {
    const seen = new Set<string>()
    return [...realtimeMessages, ...data.messages].filter((message) => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [data.messages, realtimeMessages])
  const liveReactionMessageIds = useMemo(() => new Set(liveMessages.map((message) => message.id)), [liveMessages])
  const liveReactions = useMemo(() => {
    const reactions = new Map<string, AccountMessageReaction>()
    for (const reaction of data.reactions) {
      if (!liveReactionMessageIds.has(reaction.message_id) || reactionPatchState.deletedIds.has(reaction.id)) continue
      reactions.set(reaction.id, reaction)
    }
    for (const reaction of reactionPatchState.upserts) {
      if (!liveReactionMessageIds.has(reaction.message_id) || reactionPatchState.deletedIds.has(reaction.id)) continue
      reactions.set(reaction.id, reaction)
    }
    return [...reactions.values()]
  }, [data.reactions, liveReactionMessageIds, reactionPatchState])
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, AccountMessageReaction[]>()
    for (const reaction of liveReactions) {
      const current = map.get(reaction.message_id) ?? []
      current.push(reaction)
      map.set(reaction.message_id, current)
    }
    return map
  }, [liveReactions])

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission
  }, [notificationPermission])

  useEffect(() => {
    if (orderIds.length === 0) {
      return
    }
    const supabase = createClient()
    const orderIdSet = new Set(orderIds)
    const channel = supabase
      .channel(`account-messages:${data.userId ?? 'anonymous'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const next = payload.new as AccountMessage
        if (!orderIdSet.has(next.order_id)) return
        setRealtimeMessages((current) => current.some((message) => message.id === next.id) ? current : [next, ...current])
        const threadOrder = ordersById.get(next.order_id)
        if (
          typeof window !== 'undefined' &&
          notificationPermissionRef.current === 'granted' &&
          next.sender_id !== data.userId &&
          document.visibilityState !== 'visible'
        ) {
          const notice = new Notification(`New message: ${threadOrder ? orderTitle(threadOrder) : 'Order thread'}`, {
            body: safeUserText(next.body, next.photo_url || next.voice_url ? 'New media message' : 'New order message'),
            icon: '/icon-192.png',
          })
          notice.onclick = () => {
            window.focus()
            setSelectedOrderId(next.order_id)
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (payload) => {
        const next = payload.new as AccountMessageReaction
        if (!orderIdSet.has(next.order_id)) return
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.delete(next.id)
          return {
            deletedIds,
            upserts: [...current.upserts.filter((reaction) => reaction.id !== next.id), next],
          }
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (payload) => {
        const old = payload.old as Partial<AccountMessageReaction>
        if (!old.id) return
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.add(old.id!)
          return {
            deletedIds,
            upserts: current.upserts.filter((reaction) => reaction.id !== old.id),
          }
        })
      })
      .subscribe((status) => {
        setRealtimeStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'offline' : 'connecting')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [data.userId, orderIds, ordersById])

  function persistArchived(next: Set<string>) {
    if (archiveStorageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(archiveStorageKey, JSON.stringify([...next]))
    }
  }

  function setThreadArchived(orderId: string, archived: boolean) {
    const order = ordersById.get(orderId)
    const next = new Set(archivedOrderIds)
    if (archived) next.add(orderId)
    else next.delete(orderId)
    persistArchived(next)
    setArchiveRevision((current) => current + 1)
    setSelectedOrderId(null)
    setFilter(archived ? 'archived' : order && isActiveConversationOrder(order, data.userId) ? 'active' : 'completed')
  }

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const threads = useMemo(() => {
    return data.orders
      .map((order) => {
        const messages = liveMessages
          .filter((message) => message.order_id === order.id)
          .sort((a, b) => timestampMs(b.created_at) - timestampMs(a.created_at))
        const latest = messages[0] ?? null
        const unread = messages.filter((message) => message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id)).length
        const archived = archivedOrderIds.has(order.id)
        const completed = !isActiveConversationOrder(order, data.userId)
        return {
          order,
          messages,
          latest,
          unread,
          archived,
          completed,
          searchable: [
            orderTitle(order),
            partyName(order, data.userId),
            cleanLabel(order.stage, 'Order'),
            safeUserText(latest?.body, ''),
          ].join(' ').toLowerCase(),
        }
      })
      .sort((a, b) => {
        if (a.unread > 0 && b.unread === 0) return -1
        if (b.unread > 0 && a.unread === 0) return 1
        const aTime = timestampMs(a.latest?.created_at ?? a.order.updated_at ?? a.order.created_at)
        const bTime = timestampMs(b.latest?.created_at ?? b.order.updated_at ?? b.order.created_at)
        return bTime - aTime
      })
  }, [archivedOrderIds, data.orders, data.userId, liveMessages, localReadIds])
  const normalizedSearch = search.trim().toLowerCase()
  const activeThreads = threads.filter((thread) => !thread.archived && !thread.completed)
  const completedThreads = threads.filter((thread) => !thread.archived && thread.completed)
  const archivedThreads = threads.filter((thread) => thread.archived)
  const baseThreads = filter === 'active' ? activeThreads : filter === 'completed' ? completedThreads : archivedThreads
  const filteredThreads = baseThreads.filter((thread) => !normalizedSearch || thread.searchable.includes(normalizedSearch))

  const groups = (() => {
    const map = new Map<string, { key: string; name: string; avatarSrc: string | null; threads: typeof filteredThreads }>()
    for (const thread of filteredThreads) {
      const key = partyKey(thread.order, data.userId)
      if (!map.has(key)) {
        map.set(key, { key, name: partyName(thread.order, data.userId), avatarSrc: partyAvatar(thread.order, data.userId), threads: [] })
      }
      map.get(key)!.threads.push(thread)
    }
    return [...map.values()].map((group) => {
      const unread = group.threads.reduce((sum, t) => sum + t.unread, 0)
      const latestTime = Math.max(...group.threads.map((t) => timestampMs(t.latest?.created_at ?? t.order.updated_at ?? t.order.created_at)))
      const latestPreview = group.threads.reduce<typeof threads[0]['latest']>((best, t) => {
        if (!best) return t.latest
        if (!t.latest) return best
        return timestampMs(t.latest.created_at) > timestampMs(best.created_at) ? t.latest : best
      }, null)
      return { ...group, unread, latestTime, latestPreview }
    }).sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1
      if (b.unread > 0 && a.unread === 0) return 1
      return b.latestTime - a.latestTime
    })
  })()

  const selectedThread = threads.find((thread) => thread.order.id === selectedOrderId) ?? null
  const selectedMessages = selectedThread
    ? [...selectedThread.messages].sort((a, b) => timestampMs(a.created_at) - timestampMs(b.created_at))
    : []
  const selectedUnreadIds = selectedMessages
    .filter((message) => data.userId && message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id))
    .map((message) => message.id)
  const selectedUnreadKey = selectedUnreadIds.join('|')
  const unreadMessageIds = useMemo(() => {
    if (!data.userId) return []
    return liveMessages
      .filter((message) => message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id))
      .map((message) => message.id)
  }, [data.userId, liveMessages, localReadIds])
  const totalUnread = unreadMessageIds.length

  useEffect(() => {
    if (!data.userId || !selectedUnreadKey) return
    const ids = selectedUnreadKey.split('|').filter((id) => id && !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    const supabase = createClient()
    void supabase
      .from('messages')
      .update({ read_at: now })
      .in('id', ids)
      .then(({ error }) => {
        if (error) {
          ids.forEach((id) => markedReadRef.current.delete(id))
          setLocalReadIds((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
          })
          return
        }
        onRefresh()
      })
  }, [data.userId, onRefresh, selectedUnreadKey])

  async function markAllRead() {
    if (!data.userId || unreadMessageIds.length === 0 || markingAllRead) return
    const ids = unreadMessageIds.filter((id) => !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    setMarkingAllRead(true)
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    try {
      const supabase = createClient()
      const { error } = await supabase.from('messages').update({ read_at: now }).in('id', ids)
      if (error) throw error
      onRefresh()
    } catch (readError) {
      console.warn('[messages] Mark all read failed.', readError)
      ids.forEach((id) => markedReadRef.current.delete(id))
      setLocalReadIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } finally {
      setMarkingAllRead(false)
    }
  }

  async function toggleMessageReaction(message: AccountMessage, emoji: string) {
    if (!data.userId) return
    const existing = liveReactions.find((reaction) => (
      reaction.message_id === message.id &&
      reaction.user_id === data.userId &&
      reaction.emoji === emoji
    ))
    const supabase = createClient()

    if (existing) {
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(existing.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== existing.id),
        }
      })
      const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
      if (error) {
        console.warn('[messages] Reaction delete failed.', error.message)
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.delete(existing.id)
          return {
            deletedIds,
            upserts: [...current.upserts.filter((reaction) => reaction.id !== existing.id), existing],
          }
        })
      }
      return
    }

    const tempReaction: AccountMessageReaction = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `local-${Date.now()}`,
      message_id: message.id,
      order_id: message.order_id,
      user_id: data.userId,
      emoji,
      created_at: new Date().toISOString(),
    }
    setReactionPatchState((current) => ({
      deletedIds: new Set([...current.deletedIds].filter((id) => id !== tempReaction.id)),
      upserts: [...current.upserts, tempReaction],
    }))
    const { data: inserted, error } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        order_id: message.order_id,
        user_id: data.userId,
        emoji,
      })
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .single()

    if (error) {
      console.warn('[messages] Reaction insert failed.', error.message)
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(tempReaction.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== tempReaction.id),
        }
      })
      return
    }
    setReactionPatchState((current) => {
      const insertedReaction = inserted as AccountMessageReaction
      const deletedIds = new Set(current.deletedIds)
      deletedIds.add(tempReaction.id)
      deletedIds.delete(insertedReaction.id)
      return {
        deletedIds,
        upserts: [
          ...current.upserts.filter((reaction) => reaction.id !== tempReaction.id && reaction.id !== insertedReaction.id),
          insertedReaction,
        ],
      }
    })
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        title="No conversations yet."
        body="Your order conversations appear here once you start or receive an order."
        action={<Link href="/account/orders" className="font-semibold text-needle">View orders</Link>}
      />
    )
  }

  return (
    <section className="overflow-hidden rounded-[1.2rem] border border-ink/8 bg-white/86 shadow-sm lg:flex lg:h-[calc(100vh-2rem)]">

      {/* ── Sidebar ── */}
      {!sidebarCollapsed ? (
        <aside className="flex w-full shrink-0 flex-col border-b border-ink/8 lg:w-72 lg:border-b-0 lg:border-r">
          {/* Search + filters */}
          <div className="border-b border-ink/8 p-3">
            <label className="sr-only" htmlFor="message-search">Search conversations</label>
            <input
              id="message-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-[0.7rem] border border-ink/8 bg-white/80 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/36 focus:border-needle/40"
              placeholder="Search..."
            />
            <div className="mt-2 flex gap-1">
              {(['active', 'completed', 'archived'] as const).map((key) => {
                const unreadCounts = {
                  active: activeThreads.reduce((sum, t) => sum + t.unread, 0),
                  completed: completedThreads.reduce((sum, t) => sum + t.unread, 0),
                  archived: archivedThreads.reduce((sum, t) => sum + t.unread, 0),
                }
                const labels = { active: 'Active', completed: 'Done', archived: 'Archived' }
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setFilter(key); setSelectedOrderId(null) }}
                    className={`relative flex-1 rounded-[0.6rem] py-1.5 text-xs font-semibold transition ${filter === key ? 'bg-needle text-white' : 'text-ink/52 hover:bg-ink/5 hover:text-ink'}`}
                  >
                    {labels[key]}
                    {unreadCounts[key] > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rust text-[0.6rem] font-bold text-white">
                        {unreadCounts[key] > 9 ? '9+' : unreadCounts[key]}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {notificationPermission === 'default' ? (
              <div className="mt-2">
                <button type="button" onClick={() => { void requestNotifications() }} className="text-xs font-semibold text-needle">Enable alerts</button>
              </div>
            ) : null}
          </div>

          {/* Grouped conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="p-4 text-sm text-ink/48">{search ? 'No conversations match.' : 'Nothing here.'}</p>
            ) : groups.map((group) => {
              const isExpanded = expandedGroupKeys.has(group.key) || group.threads.length === 1
              const groupActive = group.threads.some((t) => t.order.id === selectedThread?.order.id)
              return (
                <div key={group.key}>
                  {/* Group header row */}
                  <button
                    type="button"
                    onClick={() => {
                      if (group.threads.length === 1) {
                        setSelectedOrderId(group.threads[0]!.order.id)
                      } else {
                        setExpandedGroupKeys((prev) => {
                          const next = new Set(prev)
                          if (next.has(group.key)) next.delete(group.key)
                          else next.add(group.key)
                          return next
                        })
                        if (!isExpanded) setSelectedOrderId(group.threads[0]!.order.id)
                      }
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${groupActive && group.threads.length === 1 ? 'bg-needle/8' : 'hover:bg-ink/4'}`}
                  >
                    <div className="relative shrink-0">
                      <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-needle/14 text-sm font-semibold text-needle">
                        {group.avatarSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={group.avatarSrc} alt="" className="h-full w-full object-cover" />
                        ) : initialsForName(group.name)}
                      </div>
                      {group.unread > 0 ? (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-0.5 text-[0.6rem] font-bold text-white">
                          {group.unread > 9 ? '9+' : group.unread}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`truncate text-sm ${group.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{group.name}</p>
                        <p className="shrink-0 text-[0.65rem] text-ink/38">{formatMessageRelative(group.latestPreview?.created_at ?? null)}</p>
                      </div>
                      <p className={`mt-0.5 truncate text-xs ${group.unread > 0 ? 'font-semibold text-ink/80' : 'text-ink/44'}`}>
                        {group.threads.length > 1
                          ? `${group.threads.length} orders`
                          : group.latestPreview
                            ? safeUserText(group.latestPreview.body, group.latestPreview.photo_url || group.latestPreview.voice_url ? 'Sent media' : 'No messages yet')
                            : 'No messages yet'}
                      </p>
                    </div>
                    {group.threads.length > 1 ? (
                      <span className="shrink-0 text-[0.65rem] text-ink/36">{isExpanded ? '▲' : '▼'}</span>
                    ) : null}
                  </button>

                  {/* Sub-threads (shown when group expanded and has >1 order) */}
                  {isExpanded && group.threads.length > 1 ? group.threads.map((thread) => {
                    const subActive = thread.order.id === selectedThread?.order.id
                    return (
                      <button
                        key={thread.order.id}
                        type="button"
                        onClick={() => setSelectedOrderId(thread.order.id)}
                        className={`flex w-full items-center gap-2 border-l-2 py-2 pl-16 pr-3 text-left transition ${subActive ? 'border-needle bg-needle/6' : 'border-ink/8 hover:bg-ink/4'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs font-semibold ${subActive ? 'text-needle' : 'text-ink/70'}`}>{orderTitle(thread.order)}</p>
                          <p className="mt-0.5 truncate text-[0.65rem] text-ink/44">{cleanLabel(thread.order.stage, 'Order')}</p>
                        </div>
                        {thread.unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-rust px-1.5 py-0.5 text-[0.6rem] font-bold text-white">{thread.unread}</span>
                        ) : null}
                      </button>
                    )
                  }) : null}
                </div>
              )
            })}
            {totalUnread > 0 ? (
              <div className="border-t border-ink/6 p-3">
                <button type="button" onClick={() => { void markAllRead() }} disabled={markingAllRead} className="text-xs font-semibold text-needle disabled:text-ink/36">
                  {markingAllRead ? 'Marking...' : 'Mark all read'}
                </button>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* ── Chat pane ── */}
      {!selectedThread ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-needle/10">
              <span className="text-2xl">💬</span>
            </div>
            <p className="text-sm font-semibold text-ink">Pick a conversation</p>
            <p className="mt-1 text-xs text-ink/44">Select a thread from the list to open it.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-ink/8 bg-white/70 px-3 py-2.5">
            {/* Collapse toggle */}
            <button
              type="button"
              title={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="hidden shrink-0 rounded-[0.5rem] px-2 py-1.5 text-xs font-semibold text-ink/44 transition hover:bg-ink/6 hover:text-ink lg:inline-flex"
            >
              {sidebarCollapsed ? '☰' : '←'}
            </button>
            {/* Avatar + name */}
            {(() => {
              const name = partyName(selectedThread.order, data.userId)
              const avatarSrc = partyAvatar(selectedThread.order, data.userId)
              return (
                <>
                  <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/14 text-xs font-semibold text-needle">
                    {avatarSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                    ) : initialsForName(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    <p className="truncate text-xs text-ink/44">{orderTitle(selectedThread.order)}</p>
                  </div>
                </>
              )
            })()}
            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              {selectedThread.order.video_call_url ? (
                <a
                  href={selectedThread.order.video_call_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-needle/14 px-2.5 py-1.5 text-xs font-semibold text-needle"
                >
                  Join call
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => setThreadArchived(selectedThread.order.id, !selectedThread.archived)}
                className="px-2 py-1.5 text-xs font-semibold text-ink/44 transition hover:text-rust"
              >
                {selectedThread.archived ? 'Unarchive' : 'Archive'}
              </button>
              <Link href={`/account/orders/${selectedThread.order.id}`} className="rounded-full bg-needle px-3 py-1.5 text-xs font-semibold text-white">
                Order
              </Link>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-white/50 p-4">
            {selectedMessages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="rounded-[1rem] bg-bone/60 px-5 py-4 text-sm leading-6 text-ink/52">No messages yet.</p>
              </div>
            ) : selectedMessages.map((message) => {
              const mine = message.sender_id === data.userId
              return (
                <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] ${mine ? 'rounded-[1.1rem] rounded-br-[0.25rem] bg-needle px-4 py-2.5' : 'rounded-[1.1rem] rounded-bl-[0.25rem] border border-ink/8 bg-white px-4 py-2.5'}`}>
                    <div className={mine ? '[&_p]:text-white/90 [&_a]:text-white [&_audio]:opacity-80' : ''}>
                      <MessageContent message={message} />
                    </div>
                    <p title={parseDateValue(message.created_at)?.toISOString()} className={`mt-1.5 text-[0.65rem] ${mine ? 'text-white/52' : 'text-ink/36'}`}>
                      {formatMessageRelative(message.created_at)}{mine && message.read_at ? ' · Read' : ''}
                    </p>
                    <MessageReactionBar
                      reactions={reactionsByMessageId.get(message.id) ?? []}
                      userId={data.userId}
                      mine={mine}
                      open={openReactionMessageId === message.id}
                      onOpenChange={(open) => setOpenReactionMessageId(open ? message.id : null)}
                      onToggle={(emoji) => { void toggleMessageReaction(message, emoji) }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Composer */}
          <div className="border-t border-ink/8 bg-white/90 px-3 pb-3 pt-2">
            <MessageComposer order={selectedThread.order} onRefresh={onRefresh} />
          </div>
        </div>
      )}
    </section>
  )
}

function RenderMeasurements({ data, onRefresh }: { data: MeasurementsRenderData; onRefresh: () => void }) {
  const legacyMeasurementCount = hasMeasurements(data.customerProfile) ? 1 : 0
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryLine label="Named profiles" value={`${data.measurementProfiles.length}`} />
        <SummaryLine label="Drapeon Vision scans" value={`${data.measurementScans.length}`} />
        <SummaryLine label="Profile units" value={data.customerProfile?.unit_preference || data.measurementProfiles[0]?.unit_preference || 'Not set'} />
      </section>
      <ManualMeasurementEditor data={data} onRefresh={onRefresh} />
      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Wearer profiles</h2>
          <div className="mt-5 grid gap-3">
            {data.measurementProfiles.length === 0 && legacyMeasurementCount === 0 ? (
              <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No measurement profiles yet. Add manual measurements or use Drapeon Vision in the app before starting a custom order.
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
                    {(() => {
                      const profileMeasurements = measurementsForProfile(profile, data.customerProfile)
                      const completeness = measurementCompleteness(profileMeasurements)
                      const values = coreMeasurementSummary(profileMeasurements)
                      return (
                        <>
                          <div className="mt-3 rounded-[0.9rem] bg-bone/60 px-3 py-2 text-xs leading-5 text-ink/58">
                            <span className="font-semibold text-ink">{completeness.present.length}/{CORE_MEASUREMENT_FIELDS.length} core fields saved.</span>
                            {completeness.missing.length > 0 ? ` Missing: ${completeness.missing.map((field) => field.label).join(', ')}.` : ' Ready for briefs.'}
                          </div>
                          {values.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {values.slice(0, 7).map((value) => (
                                <span key={value} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )
                    })()}
                    <p className="mt-3 text-xs text-ink/46">
                      Last measured {formatDate(profile.last_measured_at ?? profile.updated_at) ?? 'recently'}
                    </p>
                  </div>
                ))}
                {legacyMeasurementCount > 0 ? (
                  <div className="rounded-[1.1rem] border border-ink/6 bg-white p-4">
                    <h3 className="font-semibold text-ink">Main customer measurements</h3>
                    <p className="mt-1 text-sm text-ink/60">Legacy profile · {fitPreferenceFromProfile(data.customerProfile)}</p>
                    {(() => {
                      const completeness = measurementCompleteness(data.customerProfile?.measurements)
                      const values = coreMeasurementSummary(data.customerProfile?.measurements)
                      return (
                        <>
                          <div className="mt-3 rounded-[0.9rem] bg-bone/60 px-3 py-2 text-xs leading-5 text-ink/58">
                            <span className="font-semibold text-ink">{completeness.present.length}/{CORE_MEASUREMENT_FIELDS.length} core fields saved.</span>
                            {completeness.missing.length > 0 ? ` Missing: ${completeness.missing.map((field) => field.label).join(', ')}.` : ' Ready for briefs.'}
                          </div>
                          {values.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {values.slice(0, 7).map((value) => (
                                <span key={value} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )
                    })()}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-needle/12 bg-needle/8 p-6 shadow-sm">
          <h2 className="text-3xl text-ink">Drapeon Vision</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Drapeon Vision capture needs camera guidance, privacy prompts, retake paths, and proof review.
          </p>
          <div className="mt-5 grid gap-3">
            {data.measurementScans.length === 0 ? (
              <p className="rounded-[1rem] bg-white/70 p-4 text-sm leading-6 text-ink/62">No scan records yet.</p>
            ) : (
              data.measurementScans.map((scan) => (
                <SummaryLine
                  key={scan.id}
                  label={cleanLabel(scan.capture_method, 'Scan')}
                  value={`${cleanLabel(scan.status, 'Captured')} · ${scanConfidenceLabel(scan.confidence_overall)}`}
                />
              ))
            )}
          </div>
          <div className="mt-5">
            <OpenAppButton label="Open Drapeon Vision" />
          </div>
        </div>
      </section>
    </div>
  )
}

function RenderShop({ data, onRefresh }: { data: ShopRenderData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const allItems = isTailor ? data.sellerItems : data.exploreItems
  const [shopSearch, setShopSearch] = useState('')
  const [shopCategory, setShopCategory] = useState('all')
  const [shopSort, setShopSort] = useState('newest')

  const categories = uniqueValues(allItems.map((item) => item.category).filter((c): c is string => !!c)).slice(0, 12)

  const filteredItems = allItems.filter((item) => {
    if (shopSearch.trim()) {
      const hay = [item.title, item.description, item.category, firstJoinedRow(item.tailor_profiles)?.display_name, firstJoinedRow(item.tailor_profiles)?.business_name].join(' ').toLowerCase()
      if (!hay.includes(shopSearch.trim().toLowerCase())) return false
    }
    if (shopCategory !== 'all' && item.category !== shopCategory) return false
    return true
  }).sort((a, b) => {
    if (shopSort === 'price-asc') return (a.price_amount ?? 0) - (b.price_amount ?? 0)
    if (shopSort === 'price-desc') return (b.price_amount ?? 0) - (a.price_amount ?? 0)
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  })

  if (isTailor) {
    return (
      <div className="grid gap-6">
        <section className="grid grid-cols-3 gap-3">
          {[
            ['Total items', data.sellerItems.length],
            ['Published', data.sellerItems.filter((item) => item.is_live).length],
            ['Payout', data.tailorProfile?.payout_account_verified ? 'Ready' : 'Setup needed'],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
              <p className="text-2xl font-semibold text-ink">{String(value)}</p>
              <p className="text-xs text-ink/52">{String(label)}</p>
            </div>
          ))}
        </section>
        <SellerItemManager data={data} onRefresh={onRefresh} />
      </div>
    )
  }

  // Customer marketplace view
  return (
    <div className="grid gap-4">
      {/* Search + sort bar */}
      <div className="flex gap-2">
        <input
          value={shopSearch}
          onChange={(e) => setShopSearch(e.target.value)}
          placeholder="Search pieces, categories, or tailors..."
          className="min-w-0 flex-1 rounded-full border border-ink/10 bg-white px-5 py-3 text-sm text-ink shadow-sm outline-none focus:border-needle/40"
        />
        <select value={shopSort} onChange={(e) => setShopSort(e.target.value)} className="hidden rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/40 sm:block">
          <option value="newest">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>

      {/* Category chips */}
      {categories.length > 0 ? (
        <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
          {(['all', ...categories] as string[]).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setShopCategory(cat)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${shopCategory === cat ? 'bg-needle text-white' : 'border border-ink/10 bg-white text-ink/66 hover:bg-ink/5 hover:text-ink'}`}
            >
              {cat === 'all' ? 'All pieces' : cat}
            </button>
          ))}
        </div>
      ) : null}

      {/* Explore tailors link */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/52">
          {filteredItems.length} piece{filteredItems.length !== 1 ? 's' : ''}
        </p>
        <Link href="/account/explore" className="text-sm font-semibold text-needle">
          Browse tailors →
        </Link>
      </div>

      {/* Item grid */}
      {filteredItems.length === 0 ? (
        <EmptyState
          title="No pieces match your search."
          body="Try a different category or clear the search."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const tailor = firstJoinedRow(item.tailor_profiles)
            const photo = itemPhoto(item)
            const safeSrc = safeMediaUrl(photo)
            const tailorAvatarSrc = safeMediaUrl(tailor?.avatar_url, 'avatars')
            return (
              <article key={item.id} className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_12px_36px_rgba(22,28,24,0.10)]">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-needle/8">
                  {safeSrc ? (
                    <Image src={safeSrc} alt={safeUserText(item.title, 'Item')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">No photo</div>
                  )}
                  {item.category ? (
                    <div className="absolute left-3 top-3">
                      <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">{item.category}</span>
                    </div>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 to-transparent px-4 pb-3 pt-10">
                    <p className="text-sm font-semibold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{formatMoney(item.price_amount, item.currency)}</p>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-xl font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                  {tailor ? (
                    <Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="mt-1 inline-flex items-center gap-1.5 text-sm text-needle hover:underline">
                      {tailorAvatarSrc ? (
                        <span className="relative inline-block h-5 w-5 overflow-hidden rounded-full bg-needle/10">
                          <Image src={tailorAvatarSrc} alt="" fill className="object-cover" unoptimized />
                        </span>
                      ) : null}
                      {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                    </Link>
                  ) : null}
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/58">{fulfillmentSummary(item)}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Link href={accountRoute(`/account/items/${item.id}`)} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                      View item
                    </Link>
                    {tailor?.id ? (
                      <Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="inline-flex justify-center rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white">
                        View tailor
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RenderWork({ data, onRefresh }: { data: WorkRenderData; onRefresh: () => void }) {
  const [colsOpen, setColsOpen] = useState([false, false, false, false])
  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor workspace not set up."
        body="Apply for tailor access before the web work queue can show orders, shop, payout state, and client context."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  const tailorOrders = data.orders.filter((order) => order.tailor_profile_id === data.tailorProfile?.id || order.tailor_id === data.userId)
  const activeOrders = tailorOrders.filter((order) => !isTerminalOrder(order))
  const pendingReplyOrders = activeOrders.filter((order) => ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? ''))
  const columns = [
    { key: 'needs-action', title: 'Needs action', body: 'Quotes, payment issues, and disputes.', orders: activeOrders.filter((order) => workColumnFor(order) === 'needs-action') },
    { key: 'production', title: 'In production', body: 'Confirmed work moving through stages.', orders: activeOrders.filter((order) => workColumnFor(order) === 'production') },
    { key: 'dispatched', title: 'Dispatched', body: 'Collection, dispatch, and delivery handoff.', orders: activeOrders.filter((order) => workColumnFor(order) === 'dispatched') },
    { key: 'done', title: 'Done / recent', body: 'Closed or waiting on final review.', orders: tailorOrders.filter((order) => isTerminalOrder(order) || workColumnFor(order) === 'done').slice(0, 8) },
  ] as const

  const availability = data.tailorProfile.availability ?? 'OPEN'
  const availLabel = availability === 'OPEN' ? 'Open for orders' : availability === 'LIMITED' ? 'Limited availability' : 'Fully booked'
  const availHint = availability === 'OPEN' ? 'Customers can find and book you.' : availability === 'LIMITED' ? 'Visible with a slower-reply notice.' : 'New bookings paused; active orders unaffected.'
  const availDotColor = availability === 'OPEN' ? 'bg-emerald-500' : availability === 'LIMITED' ? 'bg-amber-400' : 'bg-rust'
  const payoutVerified = Boolean(data.tailorProfile.payout_account_verified) && !data.tailorProfile.payout_reverification_required
  const payoutLabel = payoutVerified ? 'Payout ready' : data.tailorProfile.payout_reverification_required ? 'Reverification needed' : 'Not set up'
  const payoutHint = payoutVerified
    ? (data.tailorProfile.payout_bank_name ?? data.tailorProfile.payout_provider ?? 'Account verified')
    : data.tailorProfile.payout_reverification_required
      ? 'Open Payout to re-verify your account.'
      : 'Set up payouts before earnings can release.'
  const payoutBadgeStyle = payoutVerified
    ? 'bg-needle/10 text-needle'
    : data.tailorProfile.payout_reverification_required
      ? 'bg-rust/10 text-rust'
      : 'bg-amber-400/15 text-amber-600'

  const todayFocus: { tone: 'warning' | 'default' | 'success'; eyebrow: string; title: string; body: string; action: string; actionHref: Route } = (() => {
    if (pendingReplyOrders.length > 0) {
      return {
        tone: 'warning',
        eyebrow: 'Today',
        title: `${pendingReplyOrders.length} quote${pendingReplyOrders.length === 1 ? '' : 's'} waiting`,
        body: 'Send clear pricing or request a consultation before the customer cools off.',
        action: 'Review orders',
        actionHref: '/account/orders' as Route,
      }
    }
    if (activeOrders.length > 0) {
      const next = activeOrders[0]
      if (next) {
        return {
          tone: 'default',
          eyebrow: 'Today',
          title: orderTitle(next),
          body: orderActionCopy(next, data) ?? 'Check the order for the next step.',
          action: 'Open active orders',
          actionHref: '/account/orders' as Route,
        }
      }
    }
    if (!payoutVerified) {
      return {
        tone: 'default',
        eyebrow: 'Today',
        title: payoutLabel,
        body: payoutHint,
        action: 'Set up payout',
        actionHref: '/account/payout' as Route,
      }
    }
    return {
      tone: 'success',
      eyebrow: 'Today',
      title: 'No urgent actions',
      body: 'Your queue is clear. Update your availability or review your shop while it stays quiet.',
      action: 'Manage availability',
      actionHref: '/account/profile' as Route,
    }
  })()

  function WorkOrderCard({ order }: { order: AccountOrder }) {
    const action = orderActionCopy(order, data)
    return (
      <Link
        href={`/account/orders/${order.id}`}
        className="block rounded-[1.1rem] border border-ink/8 bg-white/86 p-3.5 shadow-sm transition hover:bg-white hover:shadow-[0_6px_20px_rgba(22,28,24,0.08)]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-needle/70">
            {cleanLabel(order.order_kind, 'Order')}
          </span>
          <StagePill stage={order.stage} />
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
        <p className="mt-0.5 truncate text-xs text-ink/52">
          {partyName(order, data.userId)} · {orderAmount(order)}
        </p>
        <div className="mt-2.5">
          <StageProgressBar order={order} />
        </div>
        <p className={`mt-2 text-xs leading-4 ${action ? 'text-amber-700' : 'text-ink/38'}`}>
          {action ?? formatRelative(order.updated_at ?? order.created_at)}
        </p>
      </Link>
    )
  }

  return (
    <div className="grid gap-6">

      {/* ── Cockpit card ── */}
      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor cockpit</p>
            <h2 className="mt-2 text-3xl text-ink">{safeEntityName(data.tailorProfile.business_name || data.tailorProfile.display_name, 'Dashboard')}</h2>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${data.tailorProfile.is_live ? 'bg-needle/10 text-needle' : 'bg-ink/8 text-ink/52'}`}>
            {data.tailorProfile.is_live ? '● Live' : 'Hidden'}
          </span>
        </div>

        {/* Metrics row */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
            <p className="text-2xl font-semibold text-ink">{activeOrders.length}</p>
            <p className="mt-0.5 text-xs text-ink/52">Active</p>
          </div>
          <div className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
            <p className={`text-2xl font-semibold ${pendingReplyOrders.length > 0 ? 'text-amber-600' : 'text-ink'}`}>{pendingReplyOrders.length}</p>
            <p className="mt-0.5 text-xs text-ink/52">Needs reply</p>
          </div>
          <div className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
            <p className="text-2xl font-semibold text-ink">{data.tailorProfile.total_orders ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/52">Completed</p>
          </div>
        </div>

        {/* Status tiles */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Link href="/account/profile" className="rounded-[1.1rem] bg-needle/8 p-3 transition hover:bg-needle/12">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${availDotColor}`} />
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-needle/70">Availability</span>
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink">{availLabel}</p>
            <p className="mt-0.5 text-xs leading-4 text-ink/52">{availHint}</p>
          </Link>
          <Link href="/account/payout" className="rounded-[1.1rem] bg-needle/8 p-3 transition hover:bg-needle/12">
            <div className="flex items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${payoutBadgeStyle}`}>{payoutLabel}</span>
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink">Payout</p>
            <p className="mt-0.5 text-xs leading-4 text-ink/52">{payoutHint}</p>
          </Link>
        </div>

        {/* Today focus card */}
        <div className={`mt-3 rounded-[1.1rem] border p-4 ${
          todayFocus.tone === 'warning'
            ? 'border-amber-300/40 bg-amber-400/8'
            : todayFocus.tone === 'success'
              ? 'border-needle/16 bg-needle/6'
              : 'border-ink/8 bg-bone/60'
        }`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/70">{todayFocus.eyebrow}</p>
          <p className="mt-1.5 text-base font-semibold text-ink">{todayFocus.title}</p>
          <p className="mt-1 text-xs leading-5 text-ink/56">{todayFocus.body}</p>
          <Link href={todayFocus.actionHref} className="mt-3 inline-flex rounded-full bg-needle px-4 py-2 text-xs font-semibold text-white">
            {todayFocus.action}
          </Link>
        </div>
      </section>

      {/* ── Active order queue (mobile) ── */}
      <section className="lg:hidden">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Order queue</p>
          {activeOrders.length > 0 && (
            <span className="rounded-full bg-needle/10 px-2.5 py-0.5 text-xs font-semibold text-needle">{activeOrders.length}</span>
          )}
        </div>
        {activeOrders.length === 0 ? (
          <EmptyState
            title="No active work right now."
            body="New custom briefs and ready-made orders will appear here when customers place them."
            action={<Link href="/account/shop" className="font-semibold text-needle">Review shop</Link>}
          />
        ) : (
          <div className="grid gap-2.5">
            {activeOrders.map((order) => <WorkOrderCard key={order.id} order={order} />)}
          </div>
        )}
      </section>

      {/* ── Desktop kanban ── */}
      <section className="hidden gap-3 lg:grid lg:grid-cols-4">
        {columns.map((column, i) => {
          const isOpen = colsOpen[i] ?? true
          const count = column.orders.length
          return (
            <div key={column.key} className="overflow-hidden rounded-[1.4rem] border border-ink/8 bg-white/64">
              <button
                type="button"
                onClick={() => setColsOpen((prev) => prev.map((v, idx) => idx === i ? !v : v))}
                className="flex w-full items-start justify-between gap-2 px-4 py-3.5 text-left transition hover:bg-ink/3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{column.title}</span>
                    {count > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${column.key === 'needs-action' ? 'bg-amber-400/20 text-amber-700' : 'bg-needle/10 text-needle'}`}>{count}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-ink/44">{column.body}</p>
                </div>
                <span className={`mt-0.5 shrink-0 text-[10px] text-ink/30 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {isOpen && (
                <div className="grid gap-2.5 border-t border-ink/6 p-3">
                  {count === 0 ? (
                    <p className="rounded-[0.9rem] bg-bone/60 px-3 py-2.5 text-xs text-ink/42">Nothing here.</p>
                  ) : (
                    column.orders.map((order) => <WorkOrderCard key={`${column.key}-${order.id}`} order={order} />)
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

    </div>
  )
}

function RenderCheckout({ data, orderId, onRefresh }: { data: CheckoutRenderData; orderId?: string; onRefresh: () => void }) {
  const customerOrders = data.orders.filter((entry) => isCustomerOrder(entry, data))
  const order = orderId
    ? data.orders.find((entry) => entry.id === orderId) ?? null
    : customerOrders.find(isPayableOrder) ?? customerOrders[0] ?? null
  if (!order) {
    return (
      <EmptyState
        title="No payment is waiting."
        body="Orders appear here when a quote, ready-made purchase, or retry needs customer payment. Otherwise, keep using Orders."
        action={<Link href="/account/orders" className="font-semibold text-needle">View orders</Link>}
      />
    )
  }
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const confirmed = payments.some((payment) => ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? ''))
  const viewerIsCustomer = isCustomerOrder(order, data)
  const checkoutAvailable = viewerIsCustomer && isPayableOrder(order)

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          {confirmed ? 'Payment confirmed' : checkoutAvailable ? 'Payment needed' : 'Payment unavailable'}
        </p>
        <h2 className="mt-3 text-4xl text-ink">{orderTitle(order)}</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          {confirmed
            ? 'This payment is recorded. Continue tracking production, handoff, and support from the order.'
            : checkoutAvailable
              ? 'Pay through the provider when the order is ready. If a payment is already processing, Drapeon reuses that attempt instead of creating a duplicate charge.'
              : viewerIsCustomer
                ? 'This customer order is not awaiting payment right now. Check the order timeline for the current stage.'
                : 'Payment actions are customer-only. Tailor work belongs in the work queue and order detail action panel.'}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SummaryLine label="Order total" value={orderAmount(order)} />
          <SummaryLine label="Provider" value={cleanLabel(order.payment_provider, 'Provider selected at payment')} />
          <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
          <SummaryLine label="Status" value={cleanLabel(order.stage, 'In progress')} />
        </div>
        <div className="mt-6">
          {viewerIsCustomer ? (
            <CheckoutAction order={order} onRefresh={onRefresh} />
          ) : (
            <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              You are viewing this as the tailor, so payment collection stays locked to the customer account.
            </p>
          )}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <OpenAppButton label="Open in app" />
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
              No provider payment has been recorded yet. If you already paid, do not pay again; open Support or the order thread.
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

function RenderSaved({ data }: { data: SavedSurfaceData }) {
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set())
  const tailorById = new Map(data.savedTailors.map((tailor) => [tailor.id, tailor]))
  const itemById = new Map(data.savedItems.map((item) => [item.id, item]))

  function toggleCollection(id: string) {
    setExpandedCollectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          body="Save tailors from Explore and ready-made pieces from Marketplace while planning an event or comparing options."
          action={<Link href="/account/explore" className="font-semibold text-needle">Browse Explore</Link>}
        />
      ) : null}

      {data.wishlistCollections.length > 0 ? (
        <section className="grid gap-5 md:grid-cols-2">
          {data.wishlistCollections.map((collection) => {
            const allItems = data.wishlistItems.filter((item) => item.collection_id === collection.id)
            const isExpanded = expandedCollectionIds.has(collection.id)
            const visibleItems = isExpanded ? allItems : allItems.slice(0, 4)
            const fallbackPhoto =
              collection.cover_image_url ||
              allItems
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
                <button
                  type="button"
                  onClick={() => toggleCollection(collection.id)}
                  className="flex w-full items-start justify-between gap-4 text-left"
                >
                  <div className={fallbackPhoto ? 'grid flex-1 gap-4 sm:grid-cols-[0.38fr_0.62fr]' : 'flex-1'}>
                    {fallbackPhoto ? (
                      <PhotoTile src={fallbackPhoto} label="Wishlist collection" />
                    ) : null}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Wishlist</p>
                      <h2 className="mt-2 text-2xl font-semibold text-ink">{safeUserText(collection.name, 'Wishlist')}</h2>
                      <p className="mt-2 text-sm text-ink/58">
                        {collection.item_count ?? allItems.length} {(collection.item_count ?? allItems.length) === 1 ? 'item' : 'items'} · Updated {formatRelative(collection.updated_at)}
                      </p>
                    </div>
                  </div>
                  <span className="mt-1 shrink-0 text-xs font-semibold text-needle/70">
                    {isExpanded ? 'Collapse' : 'Open'}
                  </span>
                </button>
                {isExpanded ? (
                  <div className="mt-4 grid gap-2">
                    {visibleItems.length === 0 ? (
                      <p className="rounded-[0.9rem] bg-bone/70 px-4 py-3 text-sm leading-6 text-ink/62">
                        Save a tailor from Explore or a ready-made piece from Marketplace to add it here.
                      </p>
                    ) : (
                      visibleItems.map((entry) => {
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
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {data.savedTailors.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Saved tailors</p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedTailors.map((tailor) => {
              const photo = tailorPhoto(tailor)
              const safeSrc = safeMediaUrl(photo)
              const specialtyTags = stringList(tailor.specialty_tags).slice(0, 3)
              return (
                <Link key={tailor.id} href={accountRoute(`/account/tailors/${tailor.id}`)} className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_12px_36px_rgba(22,28,24,0.10)]">
                  <div className="relative aspect-[4/3] overflow-hidden bg-needle/8">
                    {safeSrc ? (
                      <Image src={safeSrc} alt={safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">{safeEntityName(tailor.business_name || tailor.display_name, 'T').slice(0, 2).toUpperCase()}</div>
                    )}
                    {tailor.is_verified ? (
                      <div className="absolute left-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-needle shadow-sm backdrop-blur-sm">Verified</span>
                      </div>
                    ) : null}
                    {tailor.avg_rating ? (
                      <div className="absolute right-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">★ {Number(tailor.avg_rating).toFixed(1)}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h3>
                    <p className="mt-0.5 text-sm text-ink/50">{safeUserText(tailor.location, 'Location pending')}</p>
                    {specialtyTags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {specialtyTags.map((tag) => (
                          <span key={tag} className="rounded-full bg-needle/8 px-2.5 py-0.5 text-xs font-semibold text-needle">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      {data.savedItems.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Saved ready-made</p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedItems.map((item) => {
              const photo = itemPhoto(item)
              const safeSrc = safeMediaUrl(photo)
              return (
                <Link key={item.id} href={accountRoute(`/account/items/${item.id}`)} className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_12px_36px_rgba(22,28,24,0.10)]">
                  <div className="relative aspect-[4/3] overflow-hidden bg-needle/8">
                    {safeSrc ? (
                      <Image src={safeSrc} alt={safeUserText(item.title, 'Item')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">No photo</div>
                    )}
                    {item.category ? (
                      <div className="absolute left-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">{item.category}</span>
                      </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 to-transparent px-4 pb-3 pt-8">
                      <p className="text-sm font-semibold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{formatMoney(item.price_amount, item.currency)}</p>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                    <p className="mt-0.5 text-sm font-semibold text-rust">{stockCopy(item)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function payoutStatusLabel(profile: TailorProfile | null) {
  if (!profile) return 'No tailor profile'
  if (profile.manual_bank_entry) return `Manual bank ${cleanLabel(profile.manual_bank_verification_status, 'pending ops review')}`
  if (profile.payout_account_verified && !profile.payout_reverification_required) return 'Ready'
  if (profile.payout_account_type === 'STRIPE_CONNECT' && profile.stripe_connect_account_id) return 'Stripe review needed'
  if (profile.payout_account_type === 'PAYSTACK' && profile.paystack_recipient_code) return 'Paystack review needed'
  return 'Needs setup'
}

function RenderEarnings({ data }: { data: EarningsRenderData }) {
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('90')
  const [now] = useState(() => Date.now())
  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor earnings need a tailor profile."
        body="Apply for tailor access before web can show payout records, status breakdowns, and order-linked earnings."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  const filteredPayouts = data.payouts.filter((payout) => {
    if (range === 'all') return true
    const dateValue = payout.completed_at ?? payout.processed_at ?? payout.initiated_at
    if (!dateValue) return true
    const timestamp = new Date(dateValue).getTime()
    if (Number.isNaN(timestamp)) return true
    return now - timestamp <= Number(range) * 24 * 60 * 60 * 1000
  })
  const sum = (statuses: string[]) => filteredPayouts
    .filter((payout) => statuses.includes((payout.status ?? '').toUpperCase()))
    .reduce((total, payout) => total + (payout.amount ?? 0), 0)
  const currency = filteredPayouts[0]?.currency ?? data.tailorProfile.payout_currency ?? data.tailorProfile.currency ?? 'USD'
  const csvRows = [
    ['id', 'order_id', 'status', 'provider', 'amount', 'currency', 'blocked_reason', 'completed_at', 'initiated_at'],
    ...filteredPayouts.map((payout) => [
      payout.id,
      payout.order_id ?? '',
      payout.status ?? '',
      payout.provider ?? '',
      String((payout.amount ?? 0) / 100),
      payout.currency ?? '',
      payout.blocked_reason ?? '',
      payout.completed_at ?? '',
      payout.initiated_at ?? '',
    ]),
  ]
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n'))}`

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Pending', formatMoney(sum(['PENDING', 'PROCESSING', 'INITIATED']), currency)],
          ['Blocked / failed', formatMoney(sum(['BLOCKED', 'FAILED']), currency)],
          ['Paid out', formatMoney(sum(['PAID', 'COMPLETED', 'SUCCEEDED']), currency)],
          ['Payout setup', payoutStatusLabel(data.tailorProfile)],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
            <p className="text-base font-semibold text-ink">{String(value)}</p>
            <p className="mt-0.5 text-xs text-ink/52">{String(label)}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Earnings</p>
            <h2 className="mt-2 text-3xl text-ink">Payout history</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['30', '90', '365', 'all'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={range === key ? 'rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white' : 'rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink/62'}
              >
                {key === 'all' ? 'All' : `${key}D`}
              </button>
            ))}
            <a href={csvHref} download="drapeon-payouts.csv" className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink">
              Export CSV
            </a>
          </div>
        </div>
        <div className="mt-5 grid gap-3">
          {filteredPayouts.length === 0 ? (
            <p className="rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No payout records in this range yet. Once orders pay out, records appear here with order and provider context.
            </p>
          ) : (
            <div className="overflow-hidden rounded-[1.25rem] border border-ink/8 bg-white">
              {filteredPayouts.map((payout, index) => {
                const order = payout.order_id ? data.orders.find((entry) => entry.id === payout.order_id) : null
                return (
                  <div key={payout.id} className={`flex items-start gap-4 px-5 py-4 ${index > 0 ? 'border-t border-ink/6' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StagePill stage={payout.status} label={cleanLabel(payout.status, 'Payout')} />
                        <span className="text-xs text-ink/38">{cleanLabel(payout.provider, 'Provider')}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-ink/56">
                        {order ? `${orderTitle(order)} · #${order.reference ?? order.id.slice(0, 8)}` : payout.order_id ?? 'Standalone payout'}
                      </p>
                      {payout.blocked_reason ? (
                        <p className="mt-2 rounded-[0.65rem] bg-rust/8 px-3 py-1.5 text-xs text-rust">{cleanLabel(payout.blocked_reason, 'Blocked')}</p>
                      ) : null}
                      <p className="mt-1.5 text-xs text-ink/38">
                        Completed {formatDate(payout.completed_at) ?? 'not yet'} · initiated {formatRelative(payout.initiated_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-semibold text-ink">{formatMoney(payout.amount, payout.currency)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function RenderPayout({ data, onRefresh }: { data: PayoutRenderData; onRefresh: () => void }) {
  const profile = data.tailorProfile
  const [payoutCurrency, setPayoutCurrency] = useState(profile?.payout_currency ?? profile?.currency ?? 'USD')
  const [countryCode, setCountryCode] = useState(profile?.payout_country_code ?? 'US')
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [banks, setBanks] = useState<Array<{ code: string; name: string; country?: string | null; currency?: string | null }>>([])
  const [verification, setVerification] = useState<{ resolvedAccountName: string; maskedAccountNumber: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const paystackCurrency = ['NGN', 'GHS', 'KES'].includes(payoutCurrency)
  const stripeCurrency = ['USD', 'GBP', 'EUR', 'CAD'].includes(payoutCurrency)

  if (!profile) {
    return (
      <EmptyState
        title="Payout setup needs a tailor profile."
        body="Tailor payout setup is only available after this account has approved tailor access and a tailor profile."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  async function loadBanks() {
    setBusy('banks')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{ banks?: Array<{ code: string; name: string; country?: string | null; currency?: string | null }>; warning?: string | null }>('payout-account-action', {
        action: 'list-paystack-banks',
        payoutCurrency,
        countryCode,
      })
      setBanks(result.banks ?? [])
      setSuccess(result.warning ?? 'Bank directory loaded.')
    } catch (loadError) {
      setError(friendlyActionError(loadError, 'Bank directory could not load.'))
    } finally {
      setBusy(null)
    }
  }

  async function verifyPaystack() {
    setBusy('verify')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{ verification?: { resolvedAccountName: string; maskedAccountNumber: string } }>('payout-account-action', {
        action: 'verify-paystack-account',
        payoutCurrency,
        countryCode,
        bankCode,
        bankName,
        accountNumber,
        accountName: accountName.trim() || undefined,
      })
      setVerification(result.verification ?? null)
      setSuccess(result.verification ? `Verified account name: ${result.verification.resolvedAccountName}` : 'Account verified.')
    } catch (verifyError) {
      setError(friendlyActionError(verifyError, 'Account could not be verified.'))
    } finally {
      setBusy(null)
    }
  }

  async function savePaystack() {
    if (!verification) {
      setError('Verify the account before saving it.')
      return
    }
    setBusy('save-paystack')
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('payout-account-action', {
        action: 'confirm-paystack-account',
        payoutCurrency,
        countryCode,
        bankCode,
        bankName,
        accountNumber,
        accountName: verification.resolvedAccountName,
      })
      setSuccess('Paystack payout account saved and verified.')
      onRefresh()
    } catch (saveError) {
      setError(friendlyActionError(saveError, 'Payout account could not be saved.'))
    } finally {
      setBusy(null)
    }
  }

  async function startStripe() {
    if (typeof window === 'undefined') return
    setBusy('stripe')
    setError(null)
    setSuccess(null)
    try {
      const returnUrl = `${window.location.origin}/account/payout?setup=complete`
      const result = await invokeAccountFunction<{ onboarding?: { url?: string | null } }>('payout-account-action', {
        action: 'start-stripe-connect',
        payoutCurrency,
        countryCode,
        returnUrl,
        refreshUrl: `${window.location.origin}/account/payout?setup=refresh`,
      })
      if (result.onboarding?.url) {
        window.location.assign(result.onboarding.url)
        return
      }
      setSuccess('Stripe onboarding started. Continue from the provider window.')
    } catch (stripeError) {
      setError(friendlyActionError(stripeError, 'Stripe onboarding could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function refreshStripe() {
    setBusy('refresh-stripe')
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('payout-account-action', { action: 'refresh-stripe-connect-status' })
      setSuccess('Stripe payout status refreshed.')
      onRefresh()
    } catch (refreshError) {
      setError(friendlyActionError(refreshError, 'Stripe payout status could not refresh.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Status', payoutStatusLabel(profile)],
          ['Provider', cleanLabel(profile.payout_provider ?? profile.payout_account_type, 'Not set')],
          ['Currency', profile.payout_currency ?? 'Not set'],
          ['Hold until', formatDate(profile.payout_destination_hold_until) ?? 'No hold'],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
            <p className="text-base font-semibold text-ink">{String(value)}</p>
            <p className="mt-0.5 text-xs text-ink/52">{String(label)}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Current destination</p>
        <h2 className="mt-2 text-2xl text-ink">Where earnings are sent</h2>
        <div className="mt-4 divide-y divide-ink/6">
          {[
            ['Bank', profile.payout_bank_name ?? profile.manual_bank_name ?? 'Not set'],
            ['Account', profile.payout_account_masked ?? 'Not set'],
            ['Account name', profile.payout_account_name ?? profile.manual_bank_account_name ?? 'Not set'],
            ['Paystack recipient', profile.paystack_recipient_code ? 'Saved' : 'Not saved'],
            ['Stripe Connect', profile.stripe_connect_account_id ? 'Connected' : 'Not started'],
            ['Manual bank', profile.manual_bank_entry ? cleanLabel(profile.manual_bank_verification_status, 'Pending ops review') : 'Not used'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center justify-between gap-4 py-3">
              <span className="text-xs font-semibold text-ink/42">{String(label)}</span>
              <span className="text-right text-sm font-semibold text-ink">{String(value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Provider setup</p>
            <h2 className="mt-2 text-3xl text-ink">Use an automated payout route.</h2>
            <p className="mt-3 text-sm leading-7 text-ink/66">
              Stripe Connect handles USD, GBP, EUR, and CAD. Paystack handles NGN, GHS, and KES. Manual bank entry is intentionally unavailable on web until ops resolution exists.
            </p>
          </div>
          <ActionNotice error={error} success={success} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Payout currency</span>
            <select value={payoutCurrency} onChange={(event) => { setPayoutCurrency(event.target.value); setVerification(null) }} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50">
              {['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Country code</span>
            <input value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase().slice(0, 2))} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50" placeholder="US" />
          </label>
          <div className="flex items-end">
            {stripeCurrency ? (
              <button type="button" onClick={startStripe} disabled={!!busy} className="inline-flex w-full justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                {busy === 'stripe' ? 'Opening Stripe...' : 'Start Stripe Connect'}
              </button>
            ) : (
              <button type="button" onClick={loadBanks} disabled={!!busy || !paystackCurrency} className="inline-flex w-full justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                {busy === 'banks' ? 'Loading banks...' : 'Load Paystack banks'}
              </button>
            )}
          </div>
        </div>

        {profile.stripe_connect_account_id ? (
          <button type="button" onClick={refreshStripe} disabled={!!busy} className="mt-4 inline-flex rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/40">
            {busy === 'refresh-stripe' ? 'Refreshing...' : 'Refresh Stripe status'}
          </button>
        ) : null}

        {paystackCurrency ? (
          <div className="mt-6 grid gap-4 rounded-[1.25rem] border border-ink/6 bg-bone/45 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Bank</span>
                <select
                  value={bankCode}
                  onChange={(event) => {
                    const next = banks.find((bank) => bank.code === event.target.value)
                    setBankCode(event.target.value)
                    setBankName(next?.name ?? '')
                    setVerification(null)
                  }}
                  className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                >
                  <option value="">Select bank</option>
                  {banks.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Account number</span>
                <input value={accountNumber} onChange={(event) => { setAccountNumber(event.target.value); setVerification(null) }} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Expected account name</span>
                <input value={accountName} onChange={(event) => setAccountName(event.target.value)} className="rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            </div>
            {verification ? (
              <p className="rounded-[1rem] border border-needle/14 bg-needle/8 p-4 text-sm leading-6 text-needle">
                Verified: {verification.resolvedAccountName} · {verification.maskedAccountNumber}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={verifyPaystack} disabled={!!busy || !bankCode || !accountNumber} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/40">
                {busy === 'verify' ? 'Verifying...' : 'Verify account'}
              </button>
              <button type="button" onClick={savePaystack} disabled={!!busy || !verification} className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                {busy === 'save-paystack' ? 'Saving...' : 'Save verified Paystack account'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-[1.6rem] border border-rust/14 bg-rust/8 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Manual bank entry</p>
        <h2 className="mt-2 text-3xl text-ink">Manual bank setup is not exposed on web.</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          Manual bank details require an ops review and manual payout recording workflow before they can be used safely. Use Stripe or Paystack for automated setup, or contact payouts if your bank is not supported.
        </p>
        <a href={mailto(CONTACTS.payouts, 'Manual payout setup question')} className="mt-5 inline-flex rounded-full border border-rust/20 bg-white px-5 py-3 text-sm font-semibold text-rust">
          Contact payouts
        </a>
      </section>
    </div>
  )
}

function RenderProfile({ data, onRefresh }: { data: ProfileRenderData; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false)
  const profile = data.tailorProfile
  if (!profile) {
    return (
      <EmptyState
        title="Tailor profile not found."
        body="Customer accounts can still use orders, messages, measurements, and saved items. Tailor profile editing appears after tailor access is approved and setup is started."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  const profileId = profile.id
  function handleShareProfile() {
    void navigator.clipboard?.writeText(`https://drapeon.co/tailors/${profileId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const availPillStyle = profile.availability === 'OPEN'
    ? 'bg-bone text-ink'
    : profile.availability === 'LIMITED'
      ? 'bg-amber-400/15 text-amber-700'
      : 'bg-rust/10 text-rust'
  const availDotStyle = profile.availability === 'OPEN'
    ? 'bg-emerald-500'
    : profile.availability === 'LIMITED'
      ? 'bg-amber-400'
      : 'bg-rust'
  const availText = profile.availability === 'OPEN'
    ? 'Available'
    : profile.availability === 'LIMITED'
      ? 'Limited'
      : 'Fully booked'

  const sellingSetupRows = [
    {
      label: 'Offers',
      value: [profile.supports_custom_orders && 'Custom orders', profile.supports_ready_made && 'Ready-made'].filter(Boolean).join(' + ') || 'No offers enabled',
    },
    {
      label: 'Fulfillment',
      value: [profile.pickup_available && 'Pickup', profile.delivery_available && 'Delivery', profile.shipping_available && 'Shipping'].filter(Boolean).join(' · ') || 'Not configured',
    },
    { label: 'Specialties', value: safeList(profile.specialty_tags, 'Not set') },
    { label: 'Languages', value: safeList(profile.languages, 'Not set') },
    { label: 'Payout', value: payoutStatusLabel(profile) },
  ]

  return (
    <div className="grid gap-6">

      {/* ── Hero card ── */}
      <section className="overflow-hidden rounded-[1.6rem] border border-ink/8 bg-white/84 shadow-sm">
        <div className="flex items-start gap-5 p-6 pb-4">
          {/* Avatar with live dot */}
          <div className="relative shrink-0">
            <div className="h-[76px] w-[76px] overflow-hidden rounded-full border border-ink/10 bg-needle/10">
              {safeMediaUrl(profile.avatar_url, 'avatars') ? (
                <Image
                  src={safeMediaUrl(profile.avatar_url, 'avatars') ?? ''}
                  alt=""
                  width={76}
                  height={76}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-needle">
                  {(profile.business_name || profile.display_name || '?')[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            </div>
            <span className={`absolute left-1 top-1 h-3 w-3 rounded-full border-2 border-white ${profile.is_live ? 'bg-emerald-500' : 'bg-ink/30'}`} />
          </div>

          {/* Name, location, status pills */}
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="truncate text-2xl text-ink">
              {safeEntityName(profile.business_name || profile.display_name, 'Tailor profile')}
            </h2>
            {profile.location ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/52">
                <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                {profile.location}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${availPillStyle}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${availDotStyle}`} />
                {availText}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${profile.is_live ? 'bg-needle/10 text-needle' : 'bg-ink/8 text-ink/50'}`}>
                {profile.is_live ? '● Live' : 'Not live'}
              </span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-px border-t border-ink/6 bg-ink/6">
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">
              {(profile.avg_rating ?? 0) > 0 ? (profile.avg_rating ?? 0).toFixed(1) : '—'}
            </p>
            <p className="mt-0.5 text-xs text-ink/48">★ Rating</p>
          </div>
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">{profile.total_reviews ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/48">Reviews</p>
          </div>
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">{profile.total_orders ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/48">Orders</p>
          </div>
        </div>
      </section>

      {/* ── Selling setup ── */}
      <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-xl text-ink">Selling setup</h3>
          <OpenAppButton label="Edit in app" className="text-xs font-semibold text-needle" />
        </div>
        <div className="mt-4 divide-y divide-ink/6">
          {sellingSetupRows.map((row) => (
            <div key={row.label} className="flex items-start gap-3 py-3">
              <span className="mt-0.5 w-24 shrink-0 text-xs font-semibold text-ink/42">{row.label}</span>
              <span className="flex-1 text-right text-xs font-semibold text-ink">{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Portfolio ── */}
      <PortfolioManager data={data} onRefresh={onRefresh} />

      {/* ── Action list ── */}
      <section className="overflow-hidden rounded-[1.6rem] border border-ink/8 bg-white/84 shadow-sm">
        {profile.is_live ? (
          <button
            type="button"
            onClick={handleShareProfile}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-ink/6 px-5 py-3.5 text-left text-sm font-semibold text-ink transition hover:bg-bone/60"
          >
            {copied ? 'Link copied!' : 'Share my live profile'}
            <span className="text-ink/30">→</span>
          </button>
        ) : null}
        <Link
          href="/account/payout"
          className="flex min-h-[52px] items-center justify-between gap-3 border-b border-ink/6 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60"
        >
          Review payout setup
          <span className="text-ink/30">→</span>
        </Link>
        <Link
          href="/account/earnings"
          className="flex min-h-[52px] items-center justify-between gap-3 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60"
        >
          View earnings
          <span className="text-ink/30">→</span>
        </Link>
      </section>

      {/* ── App-only trust steps ── */}
      <section className="rounded-[1.6rem] border border-needle/12 bg-needle/6 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">App-only trust steps</p>
        <p className="mt-2 text-sm leading-6 text-ink/66">
          Bio editing, private pickup details, identity verification, and sensitive payout changes still use the app&apos;s camera and reauth controls. Portfolio, shop, payouts, and order work are available on web.
        </p>
        <div className="mt-4">
          <OpenAppButton label="Edit profile in app" className="inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white" />
        </div>
      </section>

    </div>
  )
}

function PasswordChangePanel({ session }: { session: Session | null }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null
  const sessionEmail = session.user.email

  async function changePassword() {
    setError(null); setSuccess(null)
    if (!currentPassword) { setError('Enter your current password first.'); return }
    const passwordError = validatePasswordStrength(newPassword, { forbiddenValues: [sessionEmail] })
    if (passwordError) { setError(passwordError); return }
    if (newPassword !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'PASSWORD_CHANGE')
      const result = await invokeAccountFunction<{ emailQueued?: boolean }>('account-security-action', {
        action: 'change-password',
        reauthProof: proof.proof,
        newPassword,
      })
      setSuccess(result.emailQueued ? 'Password updated. We sent a security receipt to your email.' : 'Password updated. Use it next time you sign in.')
      setCurrentPassword(''); setNewPassword(''); setConfirm(''); setShow(false)
    } catch (err) {
      setError(friendlyActionError(err, 'Password could not update. Confirm your current password and try again.'))
    } finally { setBusy(false) }
  }

  if (!show) {
    return (
      <button type="button" onClick={() => setShow(true)} className="text-sm font-semibold text-needle">
        Change password →
      </button>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" className="rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (8+ chars)" className="rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" className="rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={changePassword} disabled={busy} className="inline-flex rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy ? 'Updating...' : 'Update password'}
        </button>
        <button type="button" onClick={() => { setShow(false); setCurrentPassword(''); setNewPassword(''); setConfirm(''); setError(null); setSuccess(null) }} className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
          Cancel
        </button>
        <Link href="/account/recovery" className="inline-flex items-center text-sm text-needle">
          Forgot current password →
        </Link>
      </div>
    </div>
  )
}

function EmailChangePanel({ session }: { session: Session | null }) {
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const currentEmail = session?.user.email

  if (!session) return null

  async function changeEmail() {
    setError(null); setSuccess(null)
    if (!newEmail.trim() || !newEmail.includes('@')) { setError('Enter a valid email address.'); return }
    if (newEmail.trim().toLowerCase() === currentEmail?.toLowerCase()) { setError('That is already your current email.'); return }
    if (!currentPassword) { setError('Enter your current password first.'); return }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'EMAIL_CHANGE')
      const result = await invokeAccountFunction<{ currentEmailQueued?: boolean; newEmailQueued?: boolean }>('account-security-action', {
        action: 'start-email-change',
        reauthProof: proof.proof,
        newEmail: newEmail.trim(),
      })
      setSuccess(result.currentEmailQueued === false || result.newEmailQueued === false
        ? 'Email change started, but one confirmation email may be delayed. Check both inboxes before retrying.'
        : `Confirmation sent to ${newEmail.trim()} and ${currentEmail}. Click both links to complete the change.`)
      setNewEmail(''); setCurrentPassword(''); setShow(false)
    } catch (err) {
      setError(friendlyActionError(err, 'Email could not update. Confirm your current password and try again.'))
    } finally { setBusy(false) }
  }

  if (!show) {
    return (
      <button type="button" onClick={() => setShow(true)} className="text-sm font-semibold text-needle">
        Change email →
      </button>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" className="rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
      <div className="flex gap-2">
        <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email address" className="min-w-0 flex-1 rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
        <button type="button" onClick={changeEmail} disabled={busy} className="inline-flex rounded-full bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
          {busy ? 'Sending...' : 'Send confirmation'}
        </button>
        <button type="button" onClick={() => { setShow(false); setNewEmail(''); setCurrentPassword(''); setError(null) }} className="inline-flex rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
          Cancel
        </button>
      </div>
      <p className="text-xs text-ink/44">Drapeon sends confirmation to both addresses. You must click both links.</p>
    </div>
  )
}

type WebNotificationPrefs = {
  orderUpdates: boolean
  messages: boolean
  quotes: boolean
  paymentConfirmations: boolean
  newOrders: boolean
  paymentReleased: boolean
  lowStockAlerts: boolean
  reviews: boolean
  platformUpdates: boolean
  promotions: boolean
}

const defaultWebNotificationPrefs: WebNotificationPrefs = {
  orderUpdates: true,
  messages: true,
  quotes: true,
  paymentConfirmations: true,
  newOrders: true,
  paymentReleased: true,
  lowStockAlerts: true,
  reviews: true,
  platformUpdates: false,
  promotions: false,
}

function boolPref(source: Record<string, unknown>, key: string) {
  return typeof source[key] === 'boolean' ? source[key] as boolean : undefined
}

function normalizeWebNotificationPrefs(metadata: Record<string, unknown> | null | undefined): WebNotificationPrefs {
  const canonical = metadata?.notif_prefs && typeof metadata.notif_prefs === 'object'
    ? metadata.notif_prefs as Record<string, unknown>
    : {}
  const legacy = metadata?.notification_prefs && typeof metadata.notification_prefs === 'object'
    ? metadata.notification_prefs as Record<string, unknown>
    : {}

  return {
    ...defaultWebNotificationPrefs,
    orderUpdates: boolPref(canonical, 'orderUpdates') ?? boolPref(legacy, 'email_order_updates') ?? defaultWebNotificationPrefs.orderUpdates,
    messages: boolPref(canonical, 'messages') ?? boolPref(legacy, 'email_messages') ?? defaultWebNotificationPrefs.messages,
    quotes: boolPref(canonical, 'quotes') ?? defaultWebNotificationPrefs.quotes,
    paymentConfirmations: boolPref(canonical, 'paymentConfirmations') ?? boolPref(legacy, 'email_payment') ?? defaultWebNotificationPrefs.paymentConfirmations,
    newOrders: boolPref(canonical, 'newOrders') ?? boolPref(legacy, 'email_order_updates') ?? defaultWebNotificationPrefs.newOrders,
    paymentReleased: boolPref(canonical, 'paymentReleased') ?? boolPref(legacy, 'email_payment') ?? defaultWebNotificationPrefs.paymentReleased,
    lowStockAlerts: boolPref(canonical, 'lowStockAlerts') ?? defaultWebNotificationPrefs.lowStockAlerts,
    reviews: boolPref(canonical, 'reviews') ?? defaultWebNotificationPrefs.reviews,
    platformUpdates: boolPref(canonical, 'platformUpdates') ?? boolPref(canonical, 'promotions') ?? boolPref(legacy, 'email_marketing') ?? defaultWebNotificationPrefs.platformUpdates,
    promotions: boolPref(canonical, 'promotions') ?? boolPref(canonical, 'platformUpdates') ?? boolPref(legacy, 'email_marketing') ?? defaultWebNotificationPrefs.promotions,
  }
}

function legacyNotificationPrefs(prefs: WebNotificationPrefs) {
  return {
    email_order_updates: prefs.orderUpdates || prefs.newOrders,
    email_messages: prefs.messages,
    email_payment: prefs.paymentConfirmations || prefs.paymentReleased,
    email_marketing: prefs.promotions || prefs.platformUpdates,
  }
}

function NotificationPrefsPanel({ session, onRefresh }: { session: Session | null; onRefresh: () => void }) {
  const [prefs, setPrefs] = useState<WebNotificationPrefs>(() => normalizeWebNotificationPrefs(session?.user.user_metadata))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null

  async function savePrefs() {
    setBusy(true); setError(null); setSuccess(null)
    try {
      const { error: updateError } = await createClient().auth.updateUser({
        data: {
          notif_prefs: prefs,
          notification_prefs: legacyNotificationPrefs(prefs),
        },
      })
      if (updateError) throw updateError
      setSuccess('Notification preferences saved.')
      onRefresh()
    } catch (err) {
      setError(friendlyActionError(err, 'Preferences could not save.'))
    } finally { setBusy(false) }
  }

  const toggles: Array<[keyof WebNotificationPrefs, string, string]> = [
    ['orderUpdates', 'Order updates', 'Stage changes, delivery, handoff readiness, and auto-release notices.'],
    ['messages', 'Messages and calls', 'New order messages, voice notes, photos, call activity, and consultations.'],
    ['quotes', 'Quotes', 'Quote sent, accepted, declined, or expired updates.'],
    ['paymentConfirmations', 'Customer payments', 'Checkout, refunds, receipts, and failed payment notices.'],
    ['newOrders', 'Tailor order requests', 'New custom briefs, ready-made orders, and customer requests.'],
    ['paymentReleased', 'Tailor earnings', 'Payout, release, and blocked payment notices.'],
    ['lowStockAlerts', 'Stock alerts', 'Low stock, sold out, and inventory notices.'],
    ['reviews', 'Reviews', 'Customer or tailor review activity.'],
    ['platformUpdates', 'Platform updates', 'Policy, feature, and operational announcements.'],
  ]

  return (
    <div className="grid gap-3">
      {toggles.map(([key, label, body]) => (
        <label key={key} className="flex cursor-pointer items-start gap-3 rounded-[0.85rem] border border-ink/6 bg-bone/40 px-4 py-3 hover:bg-ink/4">
          <input type="checkbox" checked={prefs[key]} onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded accent-needle" />
          <div>
            <p className="text-sm font-semibold text-ink">{label}</p>
            <p className="mt-0.5 text-xs text-ink/48">{body}</p>
          </div>
        </label>
      ))}
      <ActionNotice error={error} success={success} />
      <button type="button" onClick={savePrefs} disabled={busy} className="inline-flex w-fit rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
        {busy ? 'Saving...' : 'Save preferences'}
      </button>
    </div>
  )
}

function SessionPanel({ session }: { session: Session | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const lastSignIn = session?.user.last_sign_in_at

  if (!session) return null

  async function signOutOtherDevices() {
    setBusy(true); setError(null); setSuccess(null)
    try {
      const { error: err } = await createClient().auth.signOut({ scope: 'others' })
      if (err) throw err
      setSuccess('All other sessions ended. You remain signed in on this device.')
    } catch (err) {
      setError(friendlyActionError(err, 'Could not sign out other devices. Try again.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      {lastSignIn ? <p className="text-xs text-ink/44">Last sign-in: {formatRelative(lastSignIn)}</p> : null}
      <ActionNotice error={error} success={success} />
      <button type="button" onClick={signOutOtherDevices} disabled={busy} className="inline-flex w-fit rounded-full border border-rust/18 bg-rust/6 px-4 py-2.5 text-sm font-semibold text-rust transition hover:bg-rust/10 disabled:cursor-not-allowed disabled:text-ink/40">
        {busy ? 'Signing out...' : 'Sign out all other devices'}
      </button>
    </div>
  )
}

function AccountDeletionPanel({ session, onRefresh }: { session: Session | null; onRefresh: () => void }) {
  const [confirm, setConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null

  async function requestDeletion() {
    if (confirm.toLowerCase() !== 'delete') { setError('Type "delete" exactly to confirm.'); return }
    if (!currentPassword) { setError('Enter your current password first.'); return }
    setError(null); setSuccess(null); setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'ACCOUNT_DELETION')
      const result = await invokeAccountFunction<{
        alreadyPending?: boolean
        activeOrderCount?: number
        deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
      }>('request-account-deletion', {
        confirmationText: 'DELETE',
        reauthProof: proof.proof,
        reason: reason.trim() || undefined,
      })
      setSuccess(result.alreadyPending
        ? 'A deletion request is already pending for this account.'
        : result.activeOrderCount && result.activeOrderCount > 0
          ? `Deletion request submitted. Ops will review ${result.activeOrderCount} active order${result.activeOrderCount === 1 ? '' : 's'} before deletion proceeds.`
          : 'Deletion request submitted. Ops will confirm privacy review by email.')
      setConfirm('')
      setCurrentPassword('')
      setReason('')
      onRefresh()
    } catch (err) {
      setError(friendlyActionError(err, `Deletion request could not submit. Email ${CONTACTS.privacy} directly.`))
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-ink/50">
        This starts the guarded account deletion workflow. Active orders, disputes, payouts, or legal retention obligations must be resolved first. Type <span className="font-mono font-semibold text-rust">delete</span> and confirm your current password.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Optional note for privacy review"
        className="resize-none rounded-[1rem] border border-rust/18 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-rust/40"
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder='Type "delete" to confirm'
          className="min-w-0 flex-1 rounded-full border border-rust/18 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-rust/40"
        />
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="min-w-0 flex-1 rounded-full border border-rust/18 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-rust/40"
        />
        <button
          type="button"
          onClick={requestDeletion}
          disabled={busy || confirm.toLowerCase() !== 'delete' || !currentPassword}
          className="inline-flex rounded-full bg-rust px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          {busy ? 'Submitting...' : 'Request deletion'}
        </button>
      </div>
      <ActionNotice error={error} success={success} />
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
      <div className="border-b border-ink/6 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">{title}</p>
      </div>
      <div className="divide-y divide-ink/6">
        {children}
      </div>
    </section>
  )
}

function SettingsRow({ label, sublabel, children }: { label: string; sublabel?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        {sublabel ? <p className="mt-0.5 text-xs text-ink/48">{sublabel}</p> : null}
      </div>
      {children ? <div className="sm:text-right">{children}</div> : null}
    </div>
  )
}

function RenderSettings({ data, session, onRefresh }: { data: SettingsRenderData; session: Session | null; onRefresh: () => void }) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const displayName = safeEntityName(
    data.customerProfile?.display_name || data.tailorProfile?.business_name || data.tailorProfile?.display_name,
    'Drapeon member',
  )
  const currency =
    data.accountCurrency ||
    data.tailorProfile?.currency ||
    data.orderCurrencies[0] ||
    'USD'

  return (
    <div className="grid gap-5">
      {/* ── Profile ── */}
      <SettingsSection title="Profile">
        <div className="px-5 py-4">
          <AvatarUploadPanel data={data} session={session} onRefresh={onRefresh} />
        </div>
        <div className="px-5 py-4">
          <ProfileSettingsEditor
            key={`${data.customerProfile?.display_name ?? ''}:${data.tailorProfile?.display_name ?? ''}:${data.tailorProfile?.business_name ?? ''}:${data.accountCurrency ?? data.tailorProfile?.currency ?? ''}`}
            data={data}
            session={session}
            onRefresh={onRefresh}
          />
        </div>
        <SettingsRow
          label="Workspace"
          sublabel={role === 'TAILOR' ? 'Tailor workspace active. Customer tools remain available.' : 'Customer account active. Tailor access requires setup.'}
        >
          {role === 'TAILOR' ? (
            <Link href="/account/work" className="text-sm font-semibold text-needle">Open work queue →</Link>
          ) : (
            <Link href="/apply?source=account" className="text-sm font-semibold text-needle">Apply as a tailor →</Link>
          )}
        </SettingsRow>
      </SettingsSection>

      {/* ── Security ── */}
      <SettingsSection title="Security">
        <SettingsRow
          label="Password"
          sublabel="Change the password used to sign in. You'll need to be signed in to update it."
        >
          <PasswordChangePanel session={session} />
        </SettingsRow>
        <SettingsRow
          label="Email address"
          sublabel={session?.user.email ?? 'Email unavailable'}
        >
          <EmailChangePanel session={session} />
        </SettingsRow>
        <SettingsRow
          label="Two-factor and OTP"
          sublabel="Phone OTP and SSO reauth are managed through the app or recovery flow."
        >
          <Link href="/account/recovery" className="text-sm font-semibold text-needle">
            Account recovery →
          </Link>
        </SettingsRow>
        <SettingsRow label="Active sessions">
          <SessionPanel session={session} />
        </SettingsRow>
      </SettingsSection>

      {/* ── Preferences ── */}
      <SettingsSection title="Preferences">
        <SettingsRow
          label="Currency"
          sublabel="Used for price display. Checkout still routes by order and provider."
        />
        <div className="px-5 pb-4">
          <NotificationPrefsPanel session={session} onRefresh={onRefresh} />
        </div>
      </SettingsSection>

      {/* ── Account & data ── */}
      <SettingsSection title="Account and data">
        <SettingsRow
          label="Privacy and data"
          sublabel="Measurements, order records, and messages are protected account data. Data access requests go to privacy@."
        >
          <a href={`mailto:${CONTACTS.privacy}?subject=Data access request`} className="text-sm font-semibold text-needle">
            {CONTACTS.privacy} →
          </a>
        </SettingsRow>
        <SettingsRow
          label="Payout setup"
          sublabel={role === 'TAILOR' ? 'Stripe Connect and Paystack automated payout routes.' : 'Payout setup is for tailor accounts.'}
        >
          {role === 'TAILOR' ? (
            <Link href="/account/payout" className="text-sm font-semibold text-needle">Payout setup →</Link>
          ) : null}
        </SettingsRow>
        <div className="border-t border-rust/8 bg-rust/4 px-5 py-4">
          <p className="mb-3 text-sm font-semibold text-rust">Delete account</p>
          <AccountDeletionPanel session={session} onRefresh={onRefresh} />
        </div>
      </SettingsSection>
    </div>
  )
}

function RenderSupport({ data, onRefresh }: { data: SupportRenderData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order)).slice(0, 5)

  const issueRoutes: Array<[string, string, string]> = isTailor
    ? [
        ['Payout or earnings issue', CONTACTS.payouts, 'Tailor payout help'],
        ['Order or customer dispute', CONTACTS.support, 'Order dispute help'],
        ['Account or security issue', CONTACTS.security, 'Account security help'],
        ['Platform or listing question', CONTACTS.support, 'Platform help'],
      ]
    : [
        ['Payment issue', CONTACTS.support, 'Payment help'],
        ['Fit issue', CONTACTS.support, 'Fit help'],
        ['Delivery or handoff issue', CONTACTS.support, 'Delivery help'],
        ['Account or security issue', CONTACTS.security, 'Account security help'],
        ['Tailor payout or setup issue', CONTACTS.payouts, 'Tailor payout help'],
      ]

  const tailorFaqItems: Array<[string, string]> = [
    ['How do I respond to a custom order brief?', 'Go to Orders and open the brief. Tap "Send quote" to enter your price, estimated completion date, and a note. You can also request a consultation before quoting. Respond within 48 hours — customers see a response timer on their end.'],
    ['How does payout work?', 'Earnings are released after the customer confirms delivery or 7 days after dispatch if they do not respond. Funds route to your Stripe or Paystack account automatically. Manual bank routes require an ops handoff — email payouts@drapeon.co to initiate.'],
    ['Why is my payout showing "blocked"?', 'Blocked payouts are held pending dispute resolution, identity checks, or a missing reverification step. Go to Payout to check the status. If the block is unclear, email payouts@drapeon.co with your order reference.'],
    ['How do I change my availability?', 'Go to Profile and look at the Selling setup section. Tap "Edit →" to open Settings where availability can be set to Open, Limited, or Fully booked. Changes apply immediately and affect how you appear in customer search.'],
    ['How do I mark an order as dispatched?', 'Open the order in Orders, scroll to the Actions section, and select the dispatch stage. You will need to enter a fulfillment method and optionally a tracking number. Collection and self-delivery orders use different stage flows.'],
    ['How do I handle a scope change from a customer?', 'Customers can request scope changes on active briefs. Go to the order in Orders — an action card will appear asking you to approve or decline the change. You can adjust the price and timeline before accepting.'],
    ['Why is my account or listing restricted?', 'Restrictions are triggered by unresolved disputes, payment failures, or identity verification requirements. Open a support request using "Account or security issue" below and ops will review within 1 business day.'],
  ]

  const customerFaqItems: Array<[string, string]> = [
    ['How do I cancel an order?', 'Orders can be cancelled from the order detail page before production begins. Once a tailor has confirmed and started production, cancellation requires ops review. Open a support request with the order attached and select "Payment issue" as the category.'],
    ['When will I get my refund?', 'Refunds are processed within 3–7 business days after an order is cancelled or a dispute is resolved in your favour. Payout timing depends on your bank or card provider. Open a support request if a refund has not appeared after 10 days.'],
    ['How do I change my delivery address?', 'Delivery address changes must happen before a tailor marks the order dispatched. Open the order in Messages and ask the tailor directly, or open a support request so ops can update it.'],
    ['My item arrived with a fit issue — what do I do?', 'Message the tailor through the order thread first. Most fit issues are resolved with a free alteration. If the tailor is unresponsive, open a support request with "Fit or alteration issue" and attach the order. Drapeon ops will step in.'],
    ['How do I set up payout as a tailor?', 'Go to Payout in the account navigation. Stripe Connect handles GBP, USD, EUR, and CAD. Paystack handles NGN, GHS, and KES. Manual bank entry requires ops verification — email payouts@drapeon.co if your bank is not listed.'],
    ['Why is my account restricted?', 'Accounts can be restricted for unresolved disputes, payment failures, or identity verification requirements. Open a support request with "Account or security issue" and ops will review within 1 business day.'],
    ['How do I update my measurements?', 'Use Measurements on web to add or edit manual profiles and custom tape points. Drapeon Vision body scans still run in the mobile app.'],
  ]

  const faqItems = isTailor ? tailorFaqItems : customerFaqItems

  return (
    <div className="grid gap-5">
      {/* ── FAQ ── */}
      <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
        <div className="border-b border-ink/6 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Common questions</p>
        </div>
        {faqItems.map(([question, answer], index) => (
          <details key={question} className={`group ${index > 0 ? 'border-t border-ink/6' : ''}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
              <span className="text-sm font-semibold text-ink">{question}</span>
              <span className="shrink-0 text-xs text-ink/36 transition group-open:rotate-180">▾</span>
            </summary>
            <div className="border-t border-ink/6 bg-bone/40 px-5 py-4">
              <p className="text-sm leading-6 text-ink/62">{answer}</p>
            </div>
          </details>
        ))}
      </section>

      {/* ── Support request form ── */}
      <GeneralSupportForm data={data} onRefresh={onRefresh} />

      {/* ── Handoff help (only when active orders exist) ── */}
      <SupportIssueForm data={data} onRefresh={onRefresh} />

      {/* ── Order-aware help ── */}
      {activeOrders.length > 0 ? (
        <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
          <div className="border-b border-ink/6 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Your active orders</p>
            <p className="mt-0.5 text-sm text-ink/52">Select an order to get help specific to that order&apos;s payment, stage, or delivery.</p>
          </div>
          {activeOrders.map((order, index) => (
            <div key={order.id} className={`flex items-center gap-4 px-5 py-4 ${index > 0 ? 'border-t border-ink/6' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <StagePill stage={order.stage} />
                  <span className="text-xs text-ink/46">{partyName(order, data.userId)}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={accountRoute(`/account/orders/${order.id}`)} className="inline-flex items-center rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">
                  View order
                </Link>
                <a href={mailto(CONTACTS.support, `Help with order: ${order.reference ?? order.id}`)} className="inline-flex items-center rounded-full bg-needle px-3 py-1.5 text-xs font-semibold text-white">
                  Email support
                </a>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* ── Direct contact routes ── */}
      <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
        <div className="border-b border-ink/6 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Direct contacts</p>
          <p className="mt-0.5 text-sm text-ink/52">Route to the right inbox for faster resolution.</p>
        </div>
        {issueRoutes.map(([title, email, subject], index) => (
          <a key={title} href={mailto(email, subject)} className={`flex items-center gap-4 px-5 py-4 transition hover:bg-ink/3 ${index > 0 ? 'border-t border-ink/6' : ''}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-xs font-semibold text-needle">{email}</p>
            </div>
            <span className="shrink-0 text-xs text-ink/36">→</span>
          </a>
        ))}
        <div className="border-t border-ink/6 px-5 py-4">
          <p className="text-xs text-ink/44">Response within 1 business day for most issues. Active order disputes are reviewed within 4 hours.</p>
        </div>
      </section>
    </div>
  )
}

function RenderTailorDetail({ data, onRefresh }: { data: TailorDetailSurfaceData; onRefresh: () => void }) {
  const account = useAccountContext()
  const tailor = data.tailor
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!tailor) {
    return (
      <EmptyState
        title="Tailor profile not available."
        body="This profile may be hidden, may belong to another account context, or may still be loading."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }
  const portfolio = stringList(tailor.portfolio_photo_urls)
    .map((src) => safeMediaUrl(src, 'portfolio-photos'))
    .filter((src): src is string => !!src)
  const profileMedia = uniqueValues([tailorPhoto(tailor), ...portfolio])
  const readyMade = data.readyMade
  const isSaved = savedOverride ?? data.isSaved

  async function toggleSaved() {
    if (!tailor || busy) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      try {
        await invokeAccountFunction('saved-tailor-action', {
          action: isSaved ? 'unsave-by-profile' : 'save-tailor',
          tailorProfileId: tailor.id,
        })
      } catch {
        if (isSaved) {
          await removeSavedTailorDirectly(account.userId, tailor.id)
        } else {
          await saveTailorDirectly(account.userId, tailor.id)
        }
      }
      setSavedOverride(!isSaved)
      setSuccess(isSaved ? 'Removed from saved.' : 'Saved to your wishlist.')
      onRefresh()
    } catch (saveError) {
      setError(friendlyActionError(saveError, 'Wishlist could not update. Refresh and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const specialties = stringList(tailor.specialty_tags)
  const languages = stringList(tailor.languages)
  const heroStars = Math.round(Number(tailor.avg_rating ?? 0))

  return (
    <div className="grid gap-5">
      {/* Immersive hero card */}
      <section className="overflow-hidden rounded-[1.8rem] border border-ink/8 shadow-sm">
        <div className="relative h-52 bg-bone sm:h-64 md:h-80">
          {profileMedia[0] ? (
            <Image src={profileMedia[0]} alt="Tailor cover" fill sizes="100vw" className="object-cover" unoptimized />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/88 via-ink/30 to-ink/0" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/60" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{cleanLabel(tailor.tier, 'Tailor')}</p>
                <h2 className="mt-1 truncate text-2xl font-semibold text-white sm:text-3xl" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}>{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                  {tailor.location ? <span>{tailor.location}</span> : null}
                  {tailor.avg_rating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-amber-300 leading-none">{'★'.repeat(heroStars)}{'☆'.repeat(5 - heroStars)}</span>
                      <span>{Number(tailor.avg_rating).toFixed(1)} ({tailor.total_reviews ?? 0})</span>
                    </span>
                  ) : null}
                </div>
              </div>
              {tailor.is_verified ? (
                <span className="shrink-0 rounded-full bg-needle px-3 py-1 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]">Verified</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="bg-white p-6">
          <p className="text-sm leading-7 text-ink/66">{safeUserText(tailor.bio, 'Portfolio, fit guidance, and order context stay connected through Drapeon.')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">{priceRange(tailor)}</span>
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">{fulfillmentSummary(tailor)}</span>
            {tailor.supports_custom_orders ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">Custom orders</span>
            ) : null}
            {tailor.supports_ready_made ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">Ready-made</span>
            ) : null}
          </div>

          <ActionNotice error={error} success={success} />

          <div className="mt-5 flex flex-wrap gap-3">
            {tailor.supports_custom_orders ? (
              <Link href={accountRoute(`/account/brief/${tailor.id}`)} className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
                Request custom order
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => { void toggleSaved() }}
              disabled={busy}
              className={isSaved
                ? 'inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust disabled:opacity-50'
                : 'inline-flex items-center justify-center rounded-full border border-needle/20 bg-needle/8 px-5 py-3 text-sm font-semibold text-needle disabled:opacity-50'}
            >
              {busy ? 'Updating...' : isSaved ? 'Remove from saved' : 'Save tailor'}
            </button>
            <OpenAppButton label="Open in app" className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink" />
          </div>
        </div>
      </section>

      {/* Portfolio strip */}
      {profileMedia.length > 1 ? (
        <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
          <p className="px-6 pt-5 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Portfolio</p>
          <div className="flex gap-3 overflow-x-auto px-6 pb-5 pt-3">
            {profileMedia.slice(1).map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                <div className="relative h-36 w-36 overflow-hidden rounded-[1rem] bg-bone">
                  <Image src={src} alt={`Portfolio ${i + 2}`} fill sizes="144px" className="object-cover" unoptimized />
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Craft profile */}
        <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
          <div className="p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Craft profile</p>
            {specialties.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2.5 text-xs font-semibold text-ink/50">Specialties</p>
                <div className="flex flex-wrap gap-2">
                  {specialties.map((s) => (
                    <span key={s} className="rounded-full bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">{s}</span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink/44">Specialties not listed yet.</p>
            )}
            {languages.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2.5 text-xs font-semibold text-ink/50">Languages</p>
                <div className="flex flex-wrap gap-2">
                  {languages.map((l) => (
                    <span key={l} className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/66">{l}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Reviews */}
        <section className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
          <div className="p-6 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Reviews</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">
              {Number(tailor.avg_rating ?? 0).toFixed(1)}
              <span className="ml-2 text-sm font-normal text-ink/44">({tailor.total_reviews ?? 0} reviews)</span>
            </p>
          </div>
          {data.tailorReviews.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-ink/44">Public reviews will appear here after completed Drapeon orders.</p>
          ) : (
            <div className="divide-y divide-ink/6 max-h-[420px] overflow-y-auto">
              {data.tailorReviews.map((review) => {
                const reviewStars = Math.round(Number(review.rating ?? 0))
                return (
                  <div key={review.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-base leading-none text-amber-400">{'★'.repeat(reviewStars)}{'☆'.repeat(5 - reviewStars)}</span>
                          <span className="text-xs font-semibold text-ink/44">{Number(review.rating ?? 0).toFixed(1)}</span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-ink">{safeEntityName(review.reviewer_name, 'Customer')}</p>
                      </div>
                      <p className="shrink-0 text-xs text-ink/38">{formatRelative(review.created_at ?? review.published_at)}</p>
                    </div>
                    {stringList(review.tags).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {stringList(review.tags).map((tag) => (
                          <span key={tag} className="rounded-full bg-needle/8 px-2.5 py-0.5 text-xs font-semibold text-needle">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {review.body ? <p className="mt-2 text-sm leading-6 text-ink/62">{safeUserText(review.body)}</p> : null}
                    {review.tailor_response ? (
                      <div className="mt-3 rounded-[0.85rem] bg-needle/4 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-needle/70">Tailor response</p>
                        <p className="mt-1 text-sm leading-6 text-ink/66">{safeUserText(review.tailor_response)}</p>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Ready-made from this tailor */}
      {readyMade.length > 0 ? (
        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Ready-made from this tailor</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {readyMade.map((item) => (
              <Link
                key={item.id}
                href={accountRoute(`/account/items/${item.id}`)}
                className="group overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_14px_40px_rgba(22,28,24,0.10)]"
              >
                <div className="relative aspect-[4/3] bg-bone">
                  {itemPhoto(item) ? (
                    <Image src={itemPhoto(item)!} alt={safeUserText(item.title, 'Ready-made item')} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover transition group-hover:scale-[1.03]" unoptimized />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <p className="text-sm font-semibold leading-snug text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{safeUserText(item.title, 'Ready-made item')}</p>
                    <p className="mt-0.5 text-xs font-semibold text-white/80" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{formatMoney(item.price_amount, item.currency)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function RenderItemDetail({ data, onRefresh }: { data: ItemDetailRenderData; onRefresh: () => void }) {
  const router = useRouter()
  const item = data.item
  const [inquiryBusy, setInquiryBusy] = useState(false)
  const [inquiryError, setInquiryError] = useState<string | null>(null)
  const [inquirySuccess, setInquirySuccess] = useState<string | null>(null)
  if (!item) {
    return (
      <EmptyState
        title="Ready-made item not available."
        body="This item may be sold out, hidden, or still loading. Return to Marketplace to browse available pieces."
        action={<Link href="/account/shop" className="font-semibold text-needle">Back to Marketplace</Link>}
      />
    )
  }
  const readyMadeItemId = item.id
  const tailor = firstJoinedRow(item.tailor_profiles)
  const gallery = stringList(item.photo_urls)
    .map((src) => safeMediaUrl(src, 'seller-item-media'))
    .filter((src): src is string => !!src)
  const canStartWebCheckout = Boolean(data.userId && data.tailorProfile?.id !== item.tailor_profile_id && item.is_live)

  const sizes = stringList(item.sizes)
  const tailorAvatarSrc = safeMediaUrl(tailor?.avatar_url, 'avatars') ?? null

  async function startReadyMadeInquiry() {
    if (!data.userId || inquiryBusy) return
    setInquiryError(null)
    setInquirySuccess(null)
    setInquiryBusy(true)
    try {
      const result = await invokeAccountFunction<{ orderId?: string }>('ready-made-order-action', {
        action: 'start-inquiry',
        sellerItemId: readyMadeItemId,
      })
      onRefresh()
      if (result.orderId) {
        setInquirySuccess('Opening the protected seller thread.')
        router.push(accountRoute(`/account/messages?orderId=${encodeURIComponent(result.orderId)}`))
        return
      }
      setInquirySuccess('Inquiry started. Open Messages to continue.')
    } catch (inquiryError) {
      setInquiryError(friendlyActionError(inquiryError, 'Could not start this seller conversation.'))
    } finally {
      setInquiryBusy(false)
    }
  }

  return (
    <div className="grid gap-5">
      {/* Hero card */}
      <section className="overflow-hidden rounded-[1.8rem] border border-ink/8 shadow-sm">
        <div className="relative h-52 bg-bone sm:h-64 md:aspect-[16/9] md:h-auto">
          {gallery[0] ? (
            <Image src={gallery[0]} alt={safeUserText(item.title, 'Ready-made item')} fill sizes="100vw" className="object-cover" unoptimized />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/88 via-ink/30 to-ink/0" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/60" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{safeUserText(item.category, 'Ready-made')}</p>
            <h2 className="mt-1 text-2xl font-semibold text-white sm:text-3xl" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}>{safeUserText(item.title, 'Ready-made item')}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
              <span className="text-xl font-semibold text-white sm:text-2xl">{formatMoney(item.price_amount, item.currency)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.4)] ${item.is_live ? 'bg-emerald-500/30 text-emerald-100' : 'bg-white/15 text-white/60'}`}>
                {stockCopy(item)}
              </span>
            </div>
          </div>
        </div>

        {/* Gallery strip */}
        {gallery.length > 1 ? (
          <div className="flex gap-3 overflow-x-auto bg-bone/40 px-6 py-4">
            {gallery.slice(1).map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                <div className="relative h-20 w-20 overflow-hidden rounded-[0.85rem] bg-bone">
                  <Image src={src} alt={`Item image ${i + 2}`} fill sizes="80px" className="object-cover" unoptimized />
                </div>
              </a>
            ))}
          </div>
        ) : null}

        {/* Info body */}
        <div className="bg-white p-6">
          <p className="text-sm leading-7 text-ink/66">{safeUserText(item.description, 'Review size, stock, fulfillment, and checkout before purchase.')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">{fulfillmentSummary(item)}</span>
            {sizes.map((s) => (
              <span key={s} className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">{s}</span>
            ))}
            {sizes.length === 0 ? (
              <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/44">Confirm sizes in app</span>
            ) : null}
          </div>

          <ActionNotice error={inquiryError} success={inquirySuccess} />

          <div className="mt-6 flex flex-wrap gap-3">
            {canStartWebCheckout ? (
              <a href="#ready-made-checkout" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
                Start web checkout
              </a>
            ) : (
              <OpenAppButton label="Open in app" />
            )}
            {canStartWebCheckout ? (
              <button
                type="button"
                onClick={() => { void startReadyMadeInquiry() }}
                disabled={inquiryBusy}
                className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38"
              >
                {inquiryBusy ? 'Opening thread...' : 'Ask seller'}
              </button>
            ) : null}
            {item.tailor_profile_id ? (
              <Link href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)} className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
                View tailor
              </Link>
            ) : null}
            {canStartWebCheckout ? (
              <OpenAppButton label="Open in app" className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink" />
            ) : null}
          </div>
        </div>
      </section>

      {canStartWebCheckout ? (
        <ReadyMadeCheckoutForm item={item} data={data} onRefresh={onRefresh} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        {/* Tailor mini-card */}
        <div className="overflow-hidden rounded-[1.5rem] border border-ink/8 bg-white shadow-sm">
          <div className="relative h-24 bg-needle/8">
            {tailorAvatarSrc ? (
              <Image src={tailorAvatarSrc} alt="Tailor" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" unoptimized />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/75 to-transparent" />
          </div>
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Tailor</p>
            <p className="mt-1.5 text-xl font-semibold text-ink">{safeEntityName(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')}</p>
            {tailor?.location ? <p className="mt-0.5 text-xs text-ink/44">{tailor.location}</p> : null}
            {item.tailor_profile_id ? (
              <Link
                href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)}
                className="mt-4 inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
              >
                View profile
              </Link>
            ) : null}
          </div>
        </div>

        {/* Fit guidance */}
        <div className="rounded-[1.5rem] border border-ink/8 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Fit guidance</p>
          <p className="mt-3 text-sm leading-7 text-ink/66">{sizeGuideSummary(item.size_guide)}</p>
          <p className="mt-4 rounded-[1rem] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
            Checkout keeps payment state, fulfillment, and order handoff together. Native push and camera-guided proof are available in the app when needed.
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
  const [cachedSnapshot] = useState(readCachedShellSnapshot)
  const [session, setSession] = useState<Session | null>(cachedSnapshot?.session ?? null)
  const [data, setData] = useState<AccountBaseData>(cachedSnapshot ? accountDataFromShell(cachedSnapshot.shellData) : emptyData)
  const [shellData, setShellData] = useState<AccountShellData>(cachedSnapshot?.shellData ?? emptyShellData)
  const [measurementsData, setMeasurementsData] = useState<MeasurementsSurfaceData>(emptyMeasurementsSurfaceData)
  const [exploreData, setExploreData] = useState<ExploreSurfaceData>(emptyExploreSurfaceData)
  const [ordersData, setOrdersData] = useState<OrdersSurfaceData>(emptyOrdersSurfaceData)
  const [orderDetailData, setOrderDetailData] = useState<OrderDetailSurfaceData>(emptyOrderDetailSurfaceData)
  const [supportData, setSupportData] = useState<SupportSurfaceData>(emptySupportSurfaceData)
  const [shopData, setShopData] = useState<ShopSurfaceData>(emptyShopSurfaceData)
  const [workData, setWorkData] = useState<WorkSurfaceData>(emptyWorkSurfaceData)
  const [briefData, setBriefData] = useState<BriefSurfaceData>(emptyBriefSurfaceData)
  const [messagesData, setMessagesData] = useState<MessagesSurfaceData>(emptyMessagesSurfaceData)
  const [savedData, setSavedData] = useState<SavedSurfaceData>(emptySavedSurfaceData)
  const [checkoutData, setCheckoutData] = useState<CheckoutSurfaceData>(emptyCheckoutSurfaceData)
  const [earningsData, setEarningsData] = useState<EarningsSurfaceData>(emptyEarningsSurfaceData)
  const [profileData, setProfileData] = useState<ProfileSurfaceData>(emptyProfileSurfaceData)
  const [settingsData, setSettingsData] = useState<SettingsSurfaceData>(emptySettingsSurfaceData)
  const [tailorDetailData, setTailorDetailData] = useState<TailorDetailSurfaceData>(emptyTailorDetailSurfaceData)
  const [itemDetailData, setItemDetailData] = useState<ItemDetailSurfaceData>(emptyItemDetailSurfaceData)
  const [loading, setLoading] = useState(!cachedSnapshot)
  const [reloadKey, setReloadKey] = useState(0)
  const [orderNotificationPermission, setOrderNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => currentNotificationPermission())
  const orderNotificationPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const orderRealtimeNoticeKeysRef = useRef<Set<string>>(new Set())
  const accountWebPushRegistrationRef = useRef(false)
  const accountUserId = session?.user.id ?? null
  const orderRealtimeIdsKey = useMemo(() => {
    if (surface === 'order-detail') {
      return uniqueRealtimeOrderIds([orderId, orderDetailData.order?.id]).join(',')
    }
    if (surface === 'orders') {
      return uniqueRealtimeOrderIds(ordersData.orders.map((order) => order.id)).join(',')
    }
    if (surface === 'work') {
      return uniqueRealtimeOrderIds(workData.orders.map((order) => order.id)).join(',')
    }
    if (surface === 'checkout') {
      return uniqueRealtimeOrderIds([orderId, ...checkoutData.orders.map((order) => order.id)]).join(',')
    }
    return ''
  }, [checkoutData.orders, orderDetailData.order?.id, orderId, ordersData.orders, surface, workData.orders])
  const realtimeOrdersById = useMemo(() => {
    const orders = [
      ...ordersData.orders,
      ...workData.orders,
      ...checkoutData.orders,
      ...(orderDetailData.order ? [orderDetailData.order] : []),
    ]
    return new Map(orders.map((order) => [order.id, order]))
  }, [checkoutData.orders, orderDetailData.order, ordersData.orders, workData.orders])

  useEffect(() => {
    orderNotificationPermissionRef.current = orderNotificationPermission
  }, [orderNotificationPermission])

  const saveAccountWebPushSubscription = useCallback(async () => {
    if (!accountUserId) return
    const registration = await registerWebPushSubscription('/account')
    if (!registration.ok) {
      if (registration.reason !== 'not-configured') {
        console.warn('[web push] Account subscription not registered.', registration.reason)
      }
      return
    }

    const { endpoint, keys } = registration.subscription
    const { error } = await createClient()
      .from('web_push_subscriptions')
      .upsert(
        {
          audience: 'ACCOUNT',
          user_id: accountUserId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: window.navigator.userAgent,
          enabled: true,
          last_seen_at: new Date().toISOString(),
          failed_at: null,
          failure_reason: null,
        },
        { onConflict: 'endpoint' },
      )
      .select('id')
      .maybeSingle()

  if (error) {
      console.warn('[web push] Account subscription could not be saved.', error.message)
    }
  }, [accountUserId])

  async function requestOrderNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setOrderNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setOrderNotificationPermission(permission)
    if (permission !== 'granted') return
    accountWebPushRegistrationRef.current = true
    await saveAccountWebPushSubscription()
  }

  useEffect(() => {
    if (
      !accountUserId ||
      !ORDER_REALTIME_SURFACES.has(surface) ||
      orderNotificationPermission !== 'granted' ||
      accountWebPushRegistrationRef.current
    ) {
      return
    }

    accountWebPushRegistrationRef.current = true
    void saveAccountWebPushSubscription()
  }, [accountUserId, orderNotificationPermission, saveAccountWebPushSubscription, surface])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return
      _lastKnownSession = sessionData.session
      setSession(sessionData.session)
      if (!sessionData.session?.user.id) {
        setData(emptyData)
        setShellData(emptyShellData)
        setMeasurementsData(emptyMeasurementsSurfaceData)
        setExploreData(emptyExploreSurfaceData)
        setOrdersData(emptyOrdersSurfaceData)
        setOrderDetailData(emptyOrderDetailSurfaceData)
        setSupportData(emptySupportSurfaceData)
        setShopData(emptyShopSurfaceData)
        setWorkData(emptyWorkSurfaceData)
        setBriefData(emptyBriefSurfaceData)
        setMessagesData(emptyMessagesSurfaceData)
        setSavedData(emptySavedSurfaceData)
        setCheckoutData(emptyCheckoutSurfaceData)
        setEarningsData(emptyEarningsSurfaceData)
        setProfileData(emptyProfileSurfaceData)
        setSettingsData(emptySettingsSurfaceData)
        setTailorDetailData(emptyTailorDetailSurfaceData)
        setItemDetailData(emptyItemDetailSurfaceData)
        setLoading(false)
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession?.user.id) {
        setData(emptyData)
        setShellData(emptyShellData)
        setMeasurementsData(emptyMeasurementsSurfaceData)
        setExploreData(emptyExploreSurfaceData)
        setOrdersData(emptyOrdersSurfaceData)
        setOrderDetailData(emptyOrderDetailSurfaceData)
        setSupportData(emptySupportSurfaceData)
        setShopData(emptyShopSurfaceData)
        setWorkData(emptyWorkSurfaceData)
        setBriefData(emptyBriefSurfaceData)
        setMessagesData(emptyMessagesSurfaceData)
        setSavedData(emptySavedSurfaceData)
        setCheckoutData(emptyCheckoutSurfaceData)
        setEarningsData(emptyEarningsSurfaceData)
        setProfileData(emptyProfileSurfaceData)
        setSettingsData(emptySettingsSurfaceData)
        setTailorDetailData(emptyTailorDetailSurfaceData)
        setItemDetailData(emptyItemDetailSurfaceData)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id || !ORDER_REALTIME_SURFACES.has(surface)) return
    const watchedOrderIds = orderRealtimeIdsKey ? orderRealtimeIdsKey.split(',') : []
    if (surface === 'order-detail' && watchedOrderIds.length === 0) return

    const userId = session.user.id
    const tailorProfileId = shellData.tailorProfile?.id ?? data.tailorProfile?.id ?? null
    const watchCustomerOrders = surface === 'orders' || surface === 'checkout'
    const watchTailorOrders = surface === 'orders' || surface === 'work'
    const supabase = createClient()
    const channel = supabase.channel(`account-order-sync:${surface}:${userId}:${orderRealtimeIdsKey || 'all'}`)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRealtimeRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        setReloadKey((current) => current + 1)
      }, 350)
    }

    const maybeNotify = (table: string, event: string, payload: unknown) => {
      if (
        typeof window === 'undefined' ||
        orderNotificationPermissionRef.current !== 'granted' ||
        document.visibilityState === 'visible'
      ) {
        return
      }
      const notice = buildAccountRealtimeNotice({
        table,
        event,
        payload,
        ordersById: realtimeOrdersById,
        userId,
      })
      if (!notice || orderRealtimeNoticeKeysRef.current.has(notice.key)) return
      orderRealtimeNoticeKeysRef.current.add(notice.key)
      const desktopNotice = new Notification(notice.title, {
        body: notice.body,
        icon: '/icon-192.png',
        tag: notice.key,
      })
      desktopNotice.onclick = () => {
        window.focus()
        if (notice.orderId) window.location.href = `/account/orders/${notice.orderId}`
      }
    }

    const watchTableFilter = (table: string, filter: string) => {
      for (const event of ORDER_REALTIME_ROW_EVENTS) {
        channel.on('postgres_changes', { event, schema: 'public', table, filter }, (payload) => {
          maybeNotify(table, event, payload)
          scheduleRealtimeRefresh()
        })
      }
    }

    if (surface === 'order-detail') {
      for (const id of watchedOrderIds) {
        watchTableFilter('orders', `id=eq.${id}`)
      }
    } else {
      if (watchCustomerOrders && isRealtimeFilterValue(userId)) {
        watchTableFilter('orders', `customer_id=eq.${userId}`)
      }
      if (watchTailorOrders && isRealtimeFilterValue(userId)) {
        watchTableFilter('orders', `tailor_id=eq.${userId}`)
      }
      if (watchTailorOrders && isRealtimeFilterValue(tailorProfileId)) {
        watchTableFilter('orders', `tailor_profile_id=eq.${tailorProfileId}`)
      }
    }

    for (const id of watchedOrderIds) {
      const childTables = surface === 'order-detail'
        ? ORDER_REALTIME_CHILD_TABLES
        : surface === 'checkout'
          ? (['order_payments'] as const)
          : []
      for (const table of childTables) {
        watchTableFilter(table, `order_id=eq.${id}`)
      }
    }

    channel.subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [data.tailorProfile?.id, orderRealtimeIdsKey, realtimeOrdersById, session?.user.id, shellData.tailorProfile?.id, surface])

  useEffect(() => {
    if (!session?.user.id) return
    const currentUserId = session.user.id
    let active = true

    async function loadSurfaceData() {
      const userId = currentUserId
      if (surface === 'measurements') {
        const [nextShellData, nextMeasurementsData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchMeasurementsSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setMeasurementsData(nextMeasurementsData)
        setData(accountDataFromShell(nextShellData, nextMeasurementsData.warning))
        return
      }
      if (surface === 'explore') {
        const [nextShellData, nextExploreData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchExploreSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setExploreData(nextExploreData)
        setData(accountDataFromShell(nextShellData, nextExploreData.warning))
        return
      }
      if (surface === 'orders') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextOrdersData = await fetchOrdersSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setOrdersData(nextOrdersData)
        setData(accountDataFromShell(nextShellData, nextOrdersData.warning))
        return
      }
      if (surface === 'order-detail') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextOrderDetailData = await fetchOrderDetailSurfaceData(userId, orderId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setOrderDetailData(nextOrderDetailData)
        setData(accountDataFromShell(nextShellData, nextOrderDetailData.warning))
        return
      }
      if (surface === 'messages') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextMessagesData = await fetchMessagesSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setMessagesData(nextMessagesData)
        setData(accountDataFromShell(nextShellData, nextMessagesData.warning))
        return
      }
      if (surface === 'payout') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        if (!active) return
        setShellData(nextShellData)
        setData(accountDataFromShell(nextShellData))
        return
      }
      if (surface === 'support') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextSupportData = await fetchSupportSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setSupportData(nextSupportData)
        setData(accountDataFromShell(nextShellData, nextSupportData.warning))
        return
      }
      if (surface === 'shop') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextShopData = await fetchShopSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setShopData(nextShopData)
        setData(accountDataFromShell(nextShellData, nextShopData.warning))
        return
      }
      if (surface === 'work') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextWorkData = await fetchWorkSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setWorkData(nextWorkData)
        setData(accountDataFromShell(nextShellData, nextWorkData.warning))
        return
      }
      if (surface === 'brief') {
        const [nextShellData, nextBriefData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchBriefSurfaceData(userId, tailorId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setBriefData(nextBriefData)
        setData(accountDataFromShell(nextShellData, nextBriefData.warning))
        return
      }
      if (surface === 'saved') {
        const [nextShellData, nextSavedData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchSavedSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setSavedData(nextSavedData)
        setData(accountDataFromShell(nextShellData, nextSavedData.warning))
        return
      }
      if (surface === 'checkout') {
        const [nextShellData, nextCheckoutData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchCheckoutSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setCheckoutData(nextCheckoutData)
        setData(accountDataFromShell(nextShellData, nextCheckoutData.warning))
        return
      }
      if (surface === 'earnings') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextEarningsData = await fetchEarningsSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setEarningsData(nextEarningsData)
        setData(accountDataFromShell(nextShellData, nextEarningsData.warning))
        return
      }
      if (surface === 'profile') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextProfileData = await fetchProfileSurfaceData(nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setProfileData(nextProfileData)
        setData(accountDataFromShell(nextShellData, nextProfileData.warning))
        return
      }
      if (surface === 'settings') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextSettingsData = await fetchSettingsSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setSettingsData(nextSettingsData)
        setData(accountDataFromShell(nextShellData, nextSettingsData.warning))
        return
      }
      if (surface === 'tailor-detail') {
        const [nextShellData, nextTailorDetailData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchTailorDetailSurfaceData(userId, tailorId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setTailorDetailData(nextTailorDetailData)
        setData(accountDataFromShell(nextShellData, nextTailorDetailData.warning))
        return
      }
      if (surface === 'item-detail') {
        const [nextShellData, nextItemDetailData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchItemDetailSurfaceData(itemId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setItemDetailData(nextItemDetailData)
        setData(accountDataFromShell(nextShellData, nextItemDetailData.warning))
      }
    }

    loadSurfaceData()
      .catch(() => {
        if (!active) return
        const fallbackShellData: AccountShellData = {
          ...emptyShellData,
          userId: currentUserId,
          warning: 'Account data could not load. Refresh to retry.',
        }
        setShellData(fallbackShellData)
        setData(accountDataFromShell(fallbackShellData))
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [itemId, orderId, reloadKey, session?.user.id, surface, tailorId])

  const content = useMemo(() => {
    const onRefresh = () => {
      if (session?.user.id) shellCacheDelete(session.user.id)
      setReloadKey((current) => current + 1)
    }
    switch (surface) {
      case 'explore':
        return <RenderExplore data={{ ...exploreData, accountCurrency: shellData.accountCurrency ?? data.accountCurrency }} />
      case 'orders':
        return <RenderOrders data={{ ...ordersData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} />
      case 'order-detail':
        return (
          <RenderOrderDetail
            data={{
              ...orderDetailData,
              userId: shellData.userId ?? data.userId,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            onRefresh={onRefresh}
          />
        )
      case 'messages':
        return <RenderMessages data={{ ...messagesData, userId: shellData.userId ?? data.userId }} onRefresh={onRefresh} />
      case 'measurements':
        return <RenderMeasurements data={{ ...measurementsData, customerProfile: shellData.customerProfile }} onRefresh={onRefresh} />
      case 'brief':
        return (
          <RenderBrief
            data={{
              ...briefData,
              userId: shellData.userId ?? data.userId,
              accountCurrency: shellData.accountCurrency ?? data.accountCurrency,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
            }}
            tailorId={tailorId}
            onRefresh={onRefresh}
          />
        )
      case 'shop':
        return <RenderShop data={{ ...shopData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      case 'work':
        return <RenderWork data={{ ...workData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      case 'earnings':
        return <RenderEarnings data={{ ...earningsData, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} />
      case 'payout':
        return <RenderPayout data={{ tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      case 'profile':
        return <RenderProfile data={{ ...profileData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      case 'checkout':
        return <RenderCheckout data={{ ...checkoutData, userId: shellData.userId ?? data.userId }} orderId={orderId} onRefresh={onRefresh} />
      case 'saved':
        return <RenderSaved data={savedData} />
      case 'settings':
        return (
          <RenderSettings
            data={{
              ...settingsData,
              userId: shellData.userId ?? data.userId,
              accountCurrency: shellData.accountCurrency ?? data.accountCurrency,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            session={session}
            onRefresh={onRefresh}
          />
        )
      case 'support':
        return <RenderSupport data={{ ...supportData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile }} onRefresh={onRefresh} />
      case 'tailor-detail':
        return <RenderTailorDetail key={tailorId ?? 'tailor-detail'} data={tailorDetailData} onRefresh={onRefresh} />
      case 'item-detail':
        return <RenderItemDetail data={{ ...itemDetailData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      default:
        return null
    }
  }, [briefData, checkoutData, data, earningsData, exploreData, itemDetailData, measurementsData, messagesData, orderDetailData, orderId, ordersData, profileData, savedData, session, settingsData, shellData.accountCurrency, shellData.customerProfile, shellData.tailorProfile, shellData.userId, shopData, supportData, surface, tailorDetailData, tailorId, workData])

  const accountContextValue = useMemo<AccountContextValue | null>(() => {
    const userId = session?.user.id ?? shellData.userId ?? data.userId
    if (!userId) return null

    const customerProfile = shellData.customerProfile ?? data.customerProfile
    const tailorProfile = shellData.tailorProfile ?? data.tailorProfile
    const role = tailorProfile ? 'TAILOR' : 'CUSTOMER'

    return {
      userId,
      role,
      defaultCurrency: shellData.accountCurrency ?? data.accountCurrency,
      customerProfile: customerProfile
        ? {
            userId: customerProfile.user_id,
            displayName: safeEntityName(customerProfile.display_name, '') || null,
            avatarUrl: customerProfile.avatar_url,
          }
        : null,
      tailorProfile: tailorProfile
        ? {
            id: tailorProfile.id,
            userId: tailorProfile.user_id,
            displayName: safeEntityName(tailorProfile.display_name, '') || null,
            businessName: safeEntityName(tailorProfile.business_name, '') || null,
            avatarUrl: tailorProfile.avatar_url,
          }
        : null,
    }
  }, [
    data.accountCurrency,
    data.customerProfile,
    data.tailorProfile,
    data.userId,
    session?.user.id,
    shellData.accountCurrency,
    shellData.customerProfile,
    shellData.tailorProfile,
    shellData.userId,
  ])

  if (loading || (session?.user.id && data.userId !== session.user.id)) return <LoadingCard />
  if (!session) return <AuthRequiredCard />
  if (!accountContextValue) return <LoadingCard />

  return (
    <AccountContextProvider value={accountContextValue}>
      <AccountRouteShell session={session} data={data} shellData={shellData} surface={surface}>
        {ORDER_REALTIME_SURFACES.has(surface) ? (
          <AccountDesktopAlertsPrompt
            permission={orderNotificationPermission}
            onEnable={() => { void requestOrderNotifications() }}
          />
        ) : null}
        {content}
      </AccountRouteShell>
    </AccountContextProvider>
  )
}
