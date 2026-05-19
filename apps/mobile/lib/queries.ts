/**
 * React Query hooks for all server-state data fetches.
 *
 * Usage:
 *   const { data: orders = [], isLoading, refetch } = useCustomerOrders(user?.id, tab)
 *
 * Stale times:
 *   - Order detail    : 0s   (always fresh — user tracks live progress)
 *   - Order lists     : 30s  (frequent navigation but not real-time)
 *   - Profiles        : 5min (rarely changes mid-session)
 *   - Saved tailors   : 2min
 *
 * Realtime subscriptions: not implemented in V1.
 * All screens use useRefreshOnFocus + pull-to-refresh for data freshness.
 * Supabase Realtime can be added later per-screen if live updates are needed.
 */

import { useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFocusEffect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import type { OrderStage } from '@drape/shared/order-machine'
import type { CurrencyCode } from '@/lib/currency'
import {
  CUSTOMER_ACTIVE_ORDER_STAGES,
  CUSTOMER_COMPLETED_ORDER_STAGES,
  TAILOR_ACTIVE_ORDER_STAGES,
  TAILOR_COMPLETED_ORDER_STAGES,
  isReadyMadeInquiryOrder,
} from '@/lib/order-flow'
import { buildTailorStockAlert, normalizeSizeInventory, type SizeInventory, type TailorStockAlert } from '@/lib/ready-made-stock'

// ─── Query Key Factory ───────────────────────────────────────────────────────

export const qk = {
  customerOrders:   (userId: string, tab: 'active' | 'completed') =>
    ['customer-orders', userId, tab] as const,
  customerOrder:    (orderId: string) =>
    ['customer-order', orderId] as const,
  customerProfile:  (userId: string) =>
    ['customer-profile', userId] as const,
  tailorOrders:     (userId: string, tab: 'active' | 'completed') =>
    ['tailor-orders', userId, tab] as const,
  tailorOrder:      (orderId: string) =>
    ['tailor-order', orderId] as const,
  tailorPublic:     (tailorId: string) =>
    ['tailor-public', tailorId] as const,
  tailorShop:       (tailorId: string) =>
    ['tailor-shop', tailorId] as const,
  sellerItem:       (itemId: string) =>
    ['seller-item', itemId] as const,
  customerMeasurements: (userId: string) =>
    ['customer-measurements', userId] as const,
  savedTailors:     (userId: string) =>
    ['saved-tailors', userId] as const,
  wishlistCollections: (userId: string) =>
    ['wishlist-collections', userId] as const,
  tailorDashboard:  (userId: string) =>
    ['tailor-dashboard', userId] as const,
  customerProfileOverview: (userId: string) =>
    ['customer-profile-overview', userId] as const,
  customerMessageOrder: (orderId: string, userId: string) =>
    ['customer-message-order', orderId, userId] as const,
  notifCount:       (userId: string) =>
    ['notif-count', userId] as const,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isMissingInventoryColumnError(error: any) {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  const details = typeof error?.details === 'string' ? error.details.toLowerCase() : ''
  const hint = typeof error?.hint === 'string' ? error.hint.toLowerCase() : ''
  return [message, details, hint].some((value) =>
    value.includes('inventory_quantity') || value.includes('size_inventory') || value.includes('size_guide'),
  )
}

function fallbackInventoryQuantity(stockStatus: string | null | undefined, isLive = true) {
  if (!isLive || stockStatus === 'SOLD_OUT' || stockStatus === 'HIDDEN') return 0
  if (stockStatus === 'LOW_STOCK') return 1
  return 1
}

/**
 * Refetches whenever the screen comes back into focus (after the first mount).
 * Drop-in replacement for `useFocusEffect` + manual setState pattern.
 */
export function useRefreshOnFocus(refetch: () => void, minIntervalMs = 45_000) {
  const firstRender = useRef(true)
  const lastRefreshAt = useRef(0)
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  useFocusEffect(
    useCallback(() => {
      if (firstRender.current) {
        firstRender.current = false
        lastRefreshAt.current = Date.now()
        return
      }
      const now = Date.now()
      if (now - lastRefreshAt.current < minIntervalMs) {
        return
      }
      lastRefreshAt.current = now
      refetchRef.current()
    }, [minIntervalMs])
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CustomerOrderRow = {
  id: string
  reference: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  stage: OrderStage
  tailorName: string
  tailorId: string
  estimatedDate: string | null
  createdAt: string
  quotedAmount: number | null
  quotedCurrency: string
  hasReview: boolean
}

export type TailorOrderRow = {
  id: string
  reference: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  sellerItemId: string | null
  customerId: string | null
  stage: OrderStage
  customerName: string
  estimatedDate: string | null
  quotedAmount: number | null
  quotedCurrency: string
  videoCallUrl: string | null
  createdAt: string
}

export type CustomerOrderDetail = {
  id: string
  reference: string
  garmentType: string
  garmentDescription: string | null
  stage: OrderStage
  tailorId: string
  tailorName: string
  quotedAmount: number | null
  quotedCurrency: CurrencyCode
  quotedCompletionDate: string | null
  fabricSource: string
  deliveryMethod: string
  fabricTracking: string | null
  collectionCode: string | null
  videoCallUrl: string | null
  stageUpdates: Array<{
    id: string
    stage: string
    note: string | null
    photoUrl: string | null
    createdAt: string
  }>
  createdAt: string
}

export type CustomerProfileData = {
  measurements: {
    chest: number | null
    waist: number | null
    hips: number | null
    shoulderWidth: number | null
    inseam: number | null
    sleeveLength: number | null
    neckCircumference: number | null
    height: number | null
    backLength?: number | null
    outseam?: number | null
    thighCircumference?: number | null
    kneeCircumference?: number | null
    torsoLength?: number | null
    unit: 'in' | 'cm'
  } | null
  avatarUrl: string | null
  createdAt: string | null
  recentOrders: Array<{
    id: string
    reference: string
    garmentType: string
    orderKind: 'CUSTOM' | 'READY_MADE'
    stage: OrderStage
    tailorName: string
    createdAt: string
  }>
}

export type SavedTailor = {
  savedId: string
  id: string
  displayName: string
  location: string
  tier: string
  avgRating: number
  totalReviews: number
  availability: string
  avatarUrl: string | null
  portfolioPhoto: string | null
}

export type WishlistCollection = {
  id: string
  name: string
  coverImageUrl: string | null
  itemCount: number
  createdAt: string
  updatedAt: string
  items: WishlistItem[]
}

export type WishlistItem =
  | {
      id: string
      itemType: 'TAILOR'
      note: string | null
      createdAt: string
      tailor: {
        id: string
        displayName: string
        location: string
        tier: string
        avgRating: number
        totalReviews: number
        portfolioPhoto: string | null
      }
      readyMadeItem: null
    }
  | {
      id: string
      itemType: 'READY_MADE_ITEM'
      note: string | null
      createdAt: string
      tailor: null
      readyMadeItem: {
        id: string
        title: string
        category: string | null
        currency: CurrencyCode
        priceAmount: number
        photoUrl: string | null
        tailorProfileId: string
        sellerName: string
        stockStatus: string
        inventoryQuantity: number
        isLive: boolean
        updatedAt: string | null
      }
    }

export type TailorDashboardData = {
  stats: {
    activeOrders: number
    pendingQuotes: number
    itemInquiries: number
    completedOrders: number
    monthEarnings: number
    monthEarningsByCurrency: Array<{ currency: string; amount: number }>
    avgRating: number
    tier: string | null
    displayName: string
    availability: 'OPEN' | 'LIMITED' | 'FULLY_BOOKED'
    currency: string
    isLive: boolean
    idVerificationStatus: string
    profileId: string | null
    profileCompleted: boolean
    stripeAccountId: string | null
    paystackAccountId: string | null
    payoutCurrency: string | null
    payoutProvider: 'PAYSTACK' | 'STRIPE' | null
    payoutReverificationRequired: boolean | null
    payoutAccountVerified: boolean | null
    payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
    paystackRecipientCode: string | null
    stripeConnectAccountId: string | null
  } | null
  orders: Array<{
    id: string
    reference: string
    garmentType: string
    orderKind: 'CUSTOM' | 'READY_MADE'
    sellerItemId: string | null
    customerId: string | null
    stage: OrderStage
    customerName: string
    estimatedDate: string | null
    quotedAmount: number | null
  }>
  stockAlerts: TailorStockAlert[]
}

export type CustomerProfileOverview = {
  measurements: {
    chest: number | null
    waist: number | null
    hips: number | null
    shoulderWidth: number | null
    inseam: number | null
    sleeveLength: number | null
    neckCircumference: number | null
    height: number | null
    backLength?: number | null
    outseam?: number | null
    thighCircumference?: number | null
    kneeCircumference?: number | null
    torsoLength?: number | null
    unit: 'in' | 'cm'
  } | null
  createdAt: string | null
  avatarUrl: string | null
  notifCount: number
  reviewCount: number
  averageRating: number | null
  recentOrders: Array<{
    id: string
    reference: string
    garmentType: string
    stage: OrderStage
    tailorName: string
    createdAt: string
  }>
}

export type CustomerMessageOrderInfo = {
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  sellerItemId: string | null
  tailorName: string
  tailorId: string
  customerId: string
  customerName: string
  stage: OrderStage
  videoCallUrl: string | null
  resolvedOrderId: string
} | null

export type PublicReview = {
  id: string
  rating: number
  body: string | null
  tags: string[]
  reviewerName: string
  reviewerAvatarUrl: string | null
  response: string | null
  createdAt: string
}

export type TailorPublicProfile = {
  id: string
  displayName: string
  location: string
  tier: string
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  avgRating: number
  totalReviews: number
  totalOrders: number
  avgResponseHours: number | null
  availability: string
  bio: string | null
  specialtyTags: string[]
  languages: string[]
  currency: string
  priceRangeMin: number | null
  priceRangeMax: number | null
  avatarUrl: string | null
  portfolioPhotos: string[]
  portfolioVideos: string[]
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
}

export type TailorPublicData = {
  profile: TailorPublicProfile | null
  reviews: PublicReview[]
  isSaved: boolean
}

export type SellerShopItem = {
  id: string
  title: string
  category: string | null
  priceAmount: number
  currency: string
  photoUrls: string[]
  stockStatus: string
  inventoryQuantity: number
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
}

export type TailorShopData = {
  tailorName: string
  sellerAvailability: string | null
  sellerLive: boolean
  supportsCustomOrders: boolean
  items: SellerShopItem[]
}

export type SellerItemDetail = {
  id: string
  tailorProfileId: string
  tailorUserId: string | null
  sellerName: string
  sellerLocation: string | null
  sellerAvailability: string | null
  sellerLive: boolean
  title: string
  description: string | null
  category: string | null
  sizes: string[]
  sizeInventory: SizeInventory
  sizeGuide: Record<string, unknown> | null
  currency: string
  priceAmount: number
  photoUrls: string[]
  stockStatus: string
  inventoryQuantity: number
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
}

function isPubliclyAvailableReadyMade(input: {
  stockStatus: string | null | undefined
  inventoryQuantity: number
}) {
  const normalizedStatus = (input.stockStatus ?? 'IN_STOCK').toUpperCase()
  if (normalizedStatus === 'SOLD_OUT' || normalizedStatus === 'HIDDEN') return false
  return input.inventoryQuantity > 0
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function readyMadePurchaseKey(input: {
  customerId?: string | null
  sellerItemId?: string | null
}) {
  if (!input.customerId || !input.sellerItemId) return null
  return `${input.customerId}:${input.sellerItemId}`
}

function normalizeReadyMadeGarmentType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function readyMadePurchaseFallbackKey(input: {
  customerId?: string | null
  garmentType?: string | null
}) {
  const garmentType = normalizeReadyMadeGarmentType(input.garmentType)
  if (!input.customerId || !garmentType) return null
  return `${input.customerId}:garment:${garmentType}`
}

function readyMadePurchaseKeysForRow(input: {
  customerId?: string | null
  sellerItemId?: string | null
  garmentType?: string | null
}) {
  const keys = [
    readyMadePurchaseKey({ customerId: input.customerId, sellerItemId: input.sellerItemId }),
    readyMadePurchaseFallbackKey({ customerId: input.customerId, garmentType: input.garmentType }),
  ]

  return keys.filter((value): value is string => !!value)
}

function hasMatchingReadyMadePurchase(
  keys: Set<string>,
  input: { customerId?: string | null; sellerItemId?: string | null; garmentType?: string | null },
) {
  return readyMadePurchaseKeysForRow(input).some((key) => keys.has(key))
}

async function fetchReadyMadePurchaseKeysForTailor(
  tailorUserId: string,
  inquiryRows: Array<{ customer_id?: string | null; seller_item_id?: string | null; garment_type?: string | null }>,
) {
  const customerIds = Array.from(
    new Set(
      inquiryRows
        .map((row) => row.customer_id ?? '')
        .filter((value) => value.length > 0),
    ),
  )
  const garmentTypes = Array.from(
    new Set(
      inquiryRows
        .map((row) => normalizeReadyMadeGarmentType(row.garment_type))
        .filter((value) => value.length > 0),
    ),
  )

  if (customerIds.length === 0 || (garmentTypes.length === 0 && inquiryRows.every((row) => !row.seller_item_id))) {
    return new Set<string>()
  }

  let query = supabase
    .from('orders')
    .select('customer_id, seller_item_id, garment_type')
    .eq('tailor_id', tailorUserId)
    .eq('order_kind', 'READY_MADE')
    .neq('stage', 'PENDING_QUOTE')
    .in('customer_id', customerIds)

  const { data, error } = await query

  if (error) return new Set<string>()

  return new Set(
    (data ?? []).flatMap((row: any) =>
      readyMadePurchaseKeysForRow({
        customerId: row.customer_id,
        sellerItemId: row.seller_item_id,
        garmentType: row.garment_type,
      }),
    ),
  )
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchCustomerOrders(
  userId: string,
  tab: 'active' | 'completed',
): Promise<CustomerOrderRow[]> {
  const stages = tab === 'active' ? CUSTOMER_ACTIVE_ORDER_STAGES : CUSTOMER_COMPLETED_ORDER_STAGES
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, order_kind, stage, quoted_completion_date, created_at, quoted_amount, currency, quoted_currency,
      tailor_profiles!tailor_profile_id(id, display_name),
      reviews!order_id(id)
    `)
    .eq('customer_id', userId)
    .in('stage', stages)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error

  return ((data ?? []) as any[])
    .filter((o) => !isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage }))
    .map((o: any) => ({
    id: o.id,
    reference: o.reference,
    garmentType: o.garment_type,
    orderKind: o.order_kind ?? 'CUSTOM',
    stage: o.stage,
    tailorName: o.tailor_profiles?.display_name ?? '',
    tailorId: o.tailor_profiles?.id ?? '',
    estimatedDate: o.quoted_completion_date,
    createdAt: o.created_at,
    quotedAmount: o.quoted_amount,
    quotedCurrency: o.currency ?? o.quoted_currency ?? 'USD',
    hasReview: (o.reviews ?? []).length > 0,
  }))
}

async function fetchTailorOrders(
  userId: string,
  tab: 'active' | 'completed',
): Promise<TailorOrderRow[]> {
  const stages = tab === 'active' ? TAILOR_ACTIVE_ORDER_STAGES : TAILOR_COMPLETED_ORDER_STAGES
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, order_kind, seller_item_id, customer_id, stage, quoted_completion_date, quoted_amount, currency, quoted_currency, video_call_url, created_at,
      customer_profiles!customer_id(display_name)
    `)
    .eq('tailor_id', userId)
    .in('stage', stages)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error

  const rows = (data ?? []) as any[]
  const inquiryRows = rows.filter((o) => {
    if (o.stage !== 'PENDING_QUOTE') return false
    if (o.order_kind === 'READY_MADE') return true
    if (typeof o.seller_item_id === 'string' && o.seller_item_id.length > 0) return true
    return false
  })
  const readyMadePurchasedKeys = await fetchReadyMadePurchaseKeysForTailor(userId, inquiryRows)

  return rows
    .filter((o) => {
      if (o.stage !== 'PENDING_QUOTE') return true
      const matchesPurchase = hasMatchingReadyMadePurchase(readyMadePurchasedKeys, {
        customerId: o.customer_id,
        sellerItemId: o.seller_item_id,
        garmentType: o.garment_type,
      })
      const looksLikeReadyMadeInquiry =
        o.order_kind === 'READY_MADE' ||
        (typeof o.seller_item_id === 'string' && o.seller_item_id.length > 0) ||
        matchesPurchase
      if (!looksLikeReadyMadeInquiry) return true
      return !matchesPurchase
    })
    .map((o: any) => ({
    id: o.id,
    reference: o.reference,
    garmentType: o.garment_type,
    orderKind: o.order_kind ?? 'CUSTOM',
    sellerItemId: o.seller_item_id ?? null,
    customerId: o.customer_id ?? null,
    stage: o.stage,
    customerName: o.customer_profiles?.display_name ?? 'Customer',
    estimatedDate: o.quoted_completion_date,
    quotedAmount: o.quoted_amount,
    quotedCurrency: o.currency ?? o.quoted_currency ?? 'USD',
    videoCallUrl: o.video_call_url ?? null,
    createdAt: o.created_at,
  }))
}

async function fetchCustomerOrderDetail(
  orderId: string,
  userId: string,
): Promise<CustomerOrderDetail | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, garment_description, stage,
      tailor_id, tailor_profile_id, quoted_amount, currency, quoted_currency, quoted_completion_date,
      fabric_source, delivery_method, fabric_tracking,
      collection_code, video_call_url, created_at,
      tailor_profiles!tailor_profile_id(display_name),
      order_stage_updates(id, stage, note, photo_url, created_at)
    `)
    .eq('id', orderId)
    .eq('customer_id', userId)
    .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const d = data as any
  return {
    id: d.id,
    reference: d.reference,
    garmentType: d.garment_type,
    garmentDescription: d.garment_description,
    stage: d.stage,
    tailorId: d.tailor_id,
    tailorName: d.tailor_profiles?.display_name ?? '',
    quotedAmount: d.quoted_amount,
    quotedCurrency: (d.currency ?? d.quoted_currency ?? 'USD') as CurrencyCode,
    quotedCompletionDate: d.quoted_completion_date,
    fabricSource: d.fabric_source,
    deliveryMethod: d.delivery_method,
    fabricTracking: d.fabric_tracking,
    collectionCode: d.collection_code,
    videoCallUrl: d.video_call_url ?? null,
    stageUpdates: (d.order_stage_updates ?? []).map((u: any) => ({
        id: u.id,
        stage: u.stage,
        note: u.note,
        photoUrl: u.photo_url,
        createdAt: u.created_at,
      })),
    createdAt: d.created_at,
  }
}

async function fetchCustomerProfile(userId: string): Promise<CustomerProfileData> {
  const [profileRes, ordersRes] = await Promise.allSettled([
    supabase
      .from('customer_profiles')
      .select('measurements, created_at, avatar_url')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('orders')
      .select('id, reference, garment_type, order_kind, stage, created_at, tailor_profiles!tailor_profile_id(display_name)')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const profileFailed =
    profileRes.status === 'rejected' ||
    (profileRes.status === 'fulfilled' && !!profileRes.value.error)
  const ordersFailed =
    ordersRes.status === 'rejected' ||
    (ordersRes.status === 'fulfilled' && !!ordersRes.value.error)

  if (profileFailed && ordersFailed) {
    throw new Error('Unable to load customer profile')
  }

  const profile =
    profileRes.status === 'fulfilled' && !profileRes.value.error
      ? profileRes.value.data
      : null
  const orders =
    ordersRes.status === 'fulfilled' && !ordersRes.value.error
      ? ((ordersRes.value.data ?? []) as any[])
      : []
  const visibleOrders = orders
    .filter((o) => !isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage }))
    .slice(0, 3)

  return {
    measurements: (profile?.measurements as CustomerProfileData['measurements']) ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: profile?.created_at ?? null,
    recentOrders: visibleOrders.map((o) => ({
      id: o.id,
      reference: o.reference,
      garmentType: o.garment_type,
      orderKind: o.order_kind ?? 'CUSTOM',
      stage: o.stage as OrderStage,
      tailorName: (o.tailor_profiles as any)?.display_name ?? 'Tailor',
      createdAt: o.created_at,
    })),
  }
}

async function fetchSavedTailors(userId: string): Promise<SavedTailor[]> {
  const { data, error } = await supabase
    .from('saved_tailors')
    .select(`
      id,
      tailor_profiles!tailor_profile_id(
        id, display_name, location, tier, avg_rating, total_reviews, availability, avatar_url, portfolio_photo_urls
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? [])
    .filter((row: any) => row?.tailor_profiles)
    .map((row: any) => {
    const t = row.tailor_profiles
    const portfolioPhotos = asStringList(t.portfolio_photo_urls)
    return {
      savedId: row.id,
      id: t.id,
      displayName: t.display_name,
      location: t.location,
      tier: t.tier,
      avgRating: t.avg_rating,
      totalReviews: t.total_reviews,
      availability: t.availability,
      avatarUrl: t.avatar_url ?? null,
      portfolioPhoto: portfolioPhotos[0] ?? t.avatar_url ?? null,
    }
  })
}

async function fetchWishlistCollections(userId: string): Promise<WishlistCollection[]> {
  const { data: collectionRows, error: collectionError } = await supabase
    .from('wishlist_collections')
    .select('id, name, cover_image_url, item_count, created_at, updated_at')
    .eq('customer_id', userId)
    .order('updated_at', { ascending: false })

  if (collectionError) throw collectionError

  const collections = (collectionRows ?? []) as any[]
  if (collections.length === 0) return []

  const collectionIds = collections.map((row) => row.id)
  const { data: itemRows, error: itemError } = await supabase
    .from('wishlist_items')
    .select('id, collection_id, item_type, tailor_id, ready_made_item_id, note, created_at')
    .in('collection_id', collectionIds)
    .order('created_at', { ascending: false })

  if (itemError) throw itemError

  const items = (itemRows ?? []) as any[]
  const tailorIds = items
    .filter((row) => row.item_type === 'TAILOR' && typeof row.tailor_id === 'string')
    .map((row) => row.tailor_id)
  const readyMadeIds = items
    .filter((row) => row.item_type === 'READY_MADE_ITEM' && typeof row.ready_made_item_id === 'string')
    .map((row) => row.ready_made_item_id)

  const [tailorsRes, readyMadeRes] = await Promise.all([
    tailorIds.length > 0
      ? supabase
          .from('tailor_profiles')
          .select('id, display_name, location, tier, avg_rating, total_reviews, avatar_url, portfolio_photo_urls')
          .in('id', tailorIds)
      : Promise.resolve({ data: [], error: null }),
    readyMadeIds.length > 0
      ? supabase
          .from('seller_items')
          .select('id, title, category, currency, price_amount, photo_urls, tailor_profile_id, stock_status, inventory_quantity, is_live, updated_at, tailor_profiles(display_name)')
          .in('id', readyMadeIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (tailorsRes.error) throw tailorsRes.error
  if (readyMadeRes.error) throw readyMadeRes.error

  const tailorById = new Map(
    ((tailorsRes.data ?? []) as any[]).map((tailor) => {
      const portfolioPhotos = asStringList(tailor.portfolio_photo_urls)
      return [
        tailor.id,
        {
          id: tailor.id,
          displayName: tailor.display_name,
          location: tailor.location,
          tier: tailor.tier,
          avgRating: tailor.avg_rating ?? 0,
          totalReviews: tailor.total_reviews ?? 0,
          avatarUrl: tailor.avatar_url ?? null,
          portfolioPhoto: portfolioPhotos[0] ?? tailor.avatar_url ?? null,
        },
      ]
    }),
  )

  const readyMadeById = new Map(
    ((readyMadeRes.data ?? []) as any[]).map((item) => {
      const photoUrls = asStringList(item.photo_urls)
      return [
        item.id,
        {
          id: item.id,
          title: item.title,
          category: item.category ?? null,
          currency: item.currency as CurrencyCode,
          priceAmount: item.price_amount,
          photoUrl: photoUrls[0] ?? null,
          tailorProfileId: item.tailor_profile_id,
          sellerName: item.tailor_profiles?.display_name ?? 'Tailor',
          stockStatus: item.stock_status ?? 'IN_STOCK',
          inventoryQuantity:
            typeof item.inventory_quantity === 'number'
              ? item.inventory_quantity
              : fallbackInventoryQuantity(item.stock_status, item.is_live ?? true),
          isLive: item.is_live ?? true,
          updatedAt: item.updated_at ?? null,
        },
      ]
    }),
  )

  const itemsByCollection = new Map<string, WishlistItem[]>()
  for (const row of items) {
    let mapped: WishlistItem | null = null

    if (row.item_type === 'TAILOR') {
      const tailor = tailorById.get(row.tailor_id)
      if (tailor) {
        mapped = {
          id: row.id,
          itemType: 'TAILOR',
          note: row.note ?? null,
          createdAt: row.created_at,
          tailor,
          readyMadeItem: null,
        }
      }
    } else if (row.item_type === 'READY_MADE_ITEM') {
      if (typeof row.ready_made_item_id !== 'string') continue

      const readyMadeItem =
        readyMadeById.get(row.ready_made_item_id) ??
        {
          id: row.ready_made_item_id,
          title: 'Saved item',
          category: null,
          currency: 'USD' as CurrencyCode,
          priceAmount: 0,
          photoUrl: null,
          tailorProfileId: '',
          sellerName: 'Tailor',
          stockStatus: 'HIDDEN',
          inventoryQuantity: 0,
          isLive: false,
          updatedAt: null,
        }

      mapped = {
        id: row.id,
        itemType: 'READY_MADE_ITEM',
        note: row.note ?? null,
        createdAt: row.created_at,
        tailor: null,
        readyMadeItem,
      }
    }

    if (!mapped) continue
    const existing = itemsByCollection.get(row.collection_id) ?? []
    existing.push(mapped)
    itemsByCollection.set(row.collection_id, existing)
  }

  return collections.map((row) => {
    const collectionItems = itemsByCollection.get(row.id) ?? []
    const firstItemCover =
      collectionItems.find((item) => item.itemType === 'TAILOR')?.tailor?.portfolioPhoto ??
      collectionItems.find((item) => item.itemType === 'READY_MADE_ITEM')?.readyMadeItem?.photoUrl ??
      null

    return {
      id: row.id,
      name: row.name,
      coverImageUrl: row.cover_image_url ?? firstItemCover,
      itemCount: row.item_count ?? collectionItems.length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: collectionItems,
    }
  })
}

async function fetchTailorPublic(tailorId: string, userId?: string): Promise<TailorPublicData> {
  const queries = [
    supabase
      .from('tailor_profiles')
      .select('id, display_name, location, seller_type, tier, avg_rating, total_reviews, total_orders, avg_response_hours, availability, bio, specialty_tags, languages, currency, price_range_min, price_range_max, avatar_url, portfolio_photo_urls, portfolio_video_urls, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available')
      .eq('id', tailorId)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id, rating, body, tags, created_at, reviewer_name, tailor_response, orders!order_id(customer_profiles!customer_id(avatar_url))')
      .eq('tailor_profile_id', tailorId)
      .eq('flagged', false)
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('portfolio_items')
      .select('image_url, sort_order')
      .eq('tailor_profile_id', tailorId)
      .order('sort_order', { ascending: true }),
  ] as const

  const [profileRes, reviewsRes, portfolioRes, savedRes] = await Promise.allSettled([
    ...queries,
    userId
      ? supabase
          .from('saved_tailors')
          .select('id')
          .eq('user_id', userId)
          .eq('tailor_profile_id', tailorId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const profileData =
    profileRes.status === 'fulfilled' && !profileRes.value.error
      ? (profileRes.value.data as any)
      : null
  const reviewsData =
    reviewsRes.status === 'fulfilled' && !reviewsRes.value.error
      ? ((reviewsRes.value.data ?? []) as any[])
      : []
  const portfolioData =
    portfolioRes.status === 'fulfilled' && !portfolioRes.value.error
      ? ((portfolioRes.value.data ?? []) as any[])
      : []
  const savedData =
    savedRes.status === 'fulfilled' && !savedRes.value.error
      ? savedRes.value.data
      : null

  if (
    (profileRes.status === 'rejected' || (profileRes.status === 'fulfilled' && profileRes.value.error)) &&
    (reviewsRes.status === 'rejected' || (reviewsRes.status === 'fulfilled' && reviewsRes.value.error))
  ) {
    throw new Error('Unable to load seller profile')
  }

  const derivedReviewCount = reviewsData.length
  const derivedAverageRating =
    derivedReviewCount > 0
      ? reviewsData.reduce((sum, row) => sum + (row.rating ?? 0), 0) / derivedReviewCount
      : null
  const portfolioPhotosFromItems = portfolioData
    .map((row: any) => row.image_url)
    .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)

  return {
    profile: profileData
      ? {
          id: profileData.id,
          displayName: profileData.display_name,
          location: profileData.location,
          sellerType: profileData.seller_type ?? 'TAILOR',
          tier: profileData.tier,
          avgRating: derivedAverageRating ?? profileData.avg_rating ?? 0,
          totalReviews: derivedReviewCount || profileData.total_reviews || 0,
          totalOrders: profileData.total_orders,
          avgResponseHours: profileData.avg_response_hours ?? null,
          availability: profileData.availability,
          bio: profileData.bio ?? null,
          specialtyTags: asStringList(profileData.specialty_tags),
          languages: asStringList(profileData.languages),
          currency: profileData.currency ?? 'USD',
          priceRangeMin: profileData.price_range_min ?? null,
          priceRangeMax: profileData.price_range_max ?? null,
          avatarUrl: profileData.avatar_url ?? null,
          portfolioPhotos:
            portfolioPhotosFromItems.length > 0
              ? portfolioPhotosFromItems
              : asStringList(profileData.portfolio_photo_urls),
          portfolioVideos: asStringList(profileData.portfolio_video_urls),
          supportsCustomOrders: profileData.supports_custom_orders ?? true,
          supportsReadyMade: profileData.supports_ready_made ?? false,
          pickupAvailable: profileData.pickup_available ?? false,
          deliveryAvailable: profileData.delivery_available ?? false,
          shippingAvailable: profileData.shipping_available ?? false,
        }
      : null,
    reviews: reviewsData.map((r: any) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      tags: asStringList(r.tags),
      reviewerName: r.reviewer_name ?? 'Customer',
      reviewerAvatarUrl: r.orders?.customer_profiles?.avatar_url ?? null,
      response: r.tailor_response ?? null,
      createdAt: r.created_at,
    })),
    isSaved: !!savedData,
  }
}

async function fetchTailorShop(tailorId: string): Promise<TailorShopData> {
  const [{ data: profileData, error: profileError }, { data: itemsData, error: itemsError }] = await Promise.all([
    supabase.from('tailor_profiles').select('display_name, availability, is_live, supports_custom_orders').eq('id', tailorId).maybeSingle(),
    supabase
      .from('seller_items')
      .select('id, title, category, price_amount, currency, photo_urls, stock_status, inventory_quantity, pickup_available, delivery_available, shipping_available')
      .eq('tailor_profile_id', tailorId)
      .eq('is_live', true)
      .gt('inventory_quantity', 0)
      .neq('stock_status', 'SOLD_OUT')
      .neq('stock_status', 'HIDDEN')
      .order('updated_at', { ascending: false }),
  ])

  let resolvedItemsData = itemsData
  let resolvedItemsError = itemsError

  if (itemsError && isMissingInventoryColumnError(itemsError)) {
    const fallback = await supabase
      .from('seller_items')
      .select('id, title, category, price_amount, currency, photo_urls, stock_status, pickup_available, delivery_available, shipping_available')
      .eq('tailor_profile_id', tailorId)
      .eq('is_live', true)
      .neq('stock_status', 'SOLD_OUT')
      .neq('stock_status', 'HIDDEN')
      .order('updated_at', { ascending: false })

    resolvedItemsData = fallback.data as any
    resolvedItemsError = fallback.error
  }

  if (profileError && resolvedItemsError) throw profileError
  if (resolvedItemsError) throw resolvedItemsError

  const items = (resolvedItemsData ?? [])
    .map((row: any) => ({
      id: row.id,
      title: row.title,
      category: row.category ?? null,
      priceAmount: row.price_amount,
      currency: row.currency,
      photoUrls: asStringList(row.photo_urls),
      stockStatus: row.stock_status ?? 'IN_STOCK',
      inventoryQuantity:
        typeof row.inventory_quantity === 'number'
          ? row.inventory_quantity
          : fallbackInventoryQuantity(row.stock_status, true),
      pickupAvailable: row.pickup_available ?? false,
      deliveryAvailable: row.delivery_available ?? false,
      shippingAvailable: row.shipping_available ?? false,
    }))
    .filter((item) =>
      isPubliclyAvailableReadyMade({
        stockStatus: item.stockStatus,
        inventoryQuantity: item.inventoryQuantity,
      })
    )

  return {
    tailorName: (profileData as any)?.display_name ?? 'This seller',
    sellerAvailability: (profileData as any)?.availability ?? null,
    sellerLive: (profileData as any)?.is_live === true,
    supportsCustomOrders: (profileData as any)?.supports_custom_orders ?? true,
    items,
  }
}

async function fetchSellerItem(itemId: string): Promise<SellerItemDetail | null> {
  let { data, error } = await supabase
    .from('seller_items')
    .select(`
      id,
      tailor_profile_id,
      title,
      description,
      category,
      sizes,
      size_guide,
      size_inventory,
      currency,
      price_amount,
      photo_urls,
      stock_status,
      inventory_quantity,
      pickup_available,
      delivery_available,
      shipping_available,
      tailor_profiles(display_name, user_id, location, availability, is_live)
    `)
    .eq('id', itemId)
    .eq('is_live', true)
    .gt('inventory_quantity', 0)
    .neq('stock_status', 'HIDDEN')
    .neq('stock_status', 'SOLD_OUT')
    .maybeSingle()

  if (error && isMissingInventoryColumnError(error)) {
    const fallback = await supabase
      .from('seller_items')
      .select(`
        id,
        tailor_profile_id,
        title,
        description,
        category,
        sizes,
        currency,
        price_amount,
        photo_urls,
        stock_status,
        pickup_available,
        delivery_available,
        shipping_available,
        tailor_profiles(display_name, user_id, location, availability, is_live)
      `)
      .eq('id', itemId)
      .eq('is_live', true)
      .neq('stock_status', 'HIDDEN')
      .neq('stock_status', 'SOLD_OUT')
      .maybeSingle()

    data = fallback.data as any
    error = fallback.error as any
  }

  if (error) throw error
  if (!data) return null

  const row: any = data
  const detail = {
    id: row.id,
    tailorProfileId: row.tailor_profile_id,
    tailorUserId: row.tailor_profiles?.user_id ?? null,
    sellerName: row.tailor_profiles?.display_name ?? 'This seller',
    sellerLocation: row.tailor_profiles?.location ?? null,
    sellerAvailability: row.tailor_profiles?.availability ?? null,
    sellerLive: row.tailor_profiles?.is_live === true,
    title: row.title,
    description: row.description ?? null,
    category: row.category ?? null,
    sizes: asStringList(row.sizes),
    sizeGuide:
      row.size_guide && typeof row.size_guide === 'object' && !Array.isArray(row.size_guide)
        ? row.size_guide
        : null,
    sizeInventory: normalizeSizeInventory(
      asStringList(row.sizes),
      row.size_inventory,
      typeof row.inventory_quantity === 'number' ? row.inventory_quantity : fallbackInventoryQuantity(row.stock_status, true),
    ),
    currency: row.currency,
    priceAmount: row.price_amount,
    photoUrls: asStringList(row.photo_urls),
    stockStatus: row.stock_status ?? 'IN_STOCK',
    inventoryQuantity:
      typeof row.inventory_quantity === 'number'
        ? row.inventory_quantity
        : fallbackInventoryQuantity(row.stock_status, true),
    pickupAvailable: row.pickup_available ?? false,
    deliveryAvailable: row.delivery_available ?? false,
    shippingAvailable: row.shipping_available ?? false,
  }

  if (!isPubliclyAvailableReadyMade({ stockStatus: detail.stockStatus, inventoryQuantity: detail.inventoryQuantity })) {
    return null
  }

  return detail
}

async function fetchCustomerMeasurements(userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('measurements')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data?.measurements || typeof data.measurements !== 'object' || Array.isArray(data.measurements)) return null
  return data.measurements as Record<string, unknown>
}

async function fetchTailorDashboard(userId: string, fallbackDisplayName = ''): Promise<TailorDashboardData> {
  const [profileRes, ordersRes, completedRes] = await Promise.allSettled([
    supabase
      .from('tailor_profiles')
      .select('id, display_name, tier, avg_rating, availability, currency, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type, is_live, id_verification_status, profile_completed')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('orders')
      .select(`
      id, reference, garment_type, order_kind, seller_item_id, customer_id, stage, quoted_completion_date, quoted_amount,
        customer_profiles!customer_id(display_name)
      `)
      .eq('tailor_id', userId)
      .in('stage', TAILOR_ACTIVE_ORDER_STAGES)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tailor_id', userId)
      .in('stage', ['COMPLETE', 'DELIVERED', 'COLLECTED']),
  ])

  const profile =
    profileRes.status === 'fulfilled' && !profileRes.value.error
      ? (profileRes.value.data as any)
      : null
  const orderList =
    ordersRes.status === 'fulfilled' && !ordersRes.value.error
      ? ((ordersRes.value.data ?? []) as any[])
      : []
  const inquiryRows = orderList.filter((o) =>
    isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage }),
  )
  const readyMadePurchasedKeys = await fetchReadyMadePurchaseKeysForTailor(userId, inquiryRows)
  const visibleOrderList = (() => {
    return orderList.filter((o) => {
      if (!isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage })) return true
      return !hasMatchingReadyMadePurchase(readyMadePurchasedKeys, {
        customerId: o.customer_id,
        sellerItemId: o.seller_item_id,
        garmentType: o.garment_type,
      })
    })
  })()
  const completedOrders =
    completedRes.status === 'fulfilled' && !completedRes.value.error
      ? (completedRes.value.count ?? 0)
      : 0
  let stockAlerts: TailorStockAlert[] = []

  if (
    (profileRes.status === 'rejected' || (profileRes.status === 'fulfilled' && profileRes.value.error)) &&
    (ordersRes.status === 'rejected' || (ordersRes.status === 'fulfilled' && ordersRes.value.error))
  ) {
    throw new Error('Unable to load tailor dashboard')
  }

  const pendingQuotes = visibleOrderList.filter((o) => o.stage === 'PENDING_QUOTE' && (o.order_kind ?? 'CUSTOM') !== 'READY_MADE').length
  const itemInquiries = visibleOrderList.filter((o) => isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage, sellerItemId: o.seller_item_id })).length
  const activeOrders = visibleOrderList.filter((o) =>
    TAILOR_ACTIVE_ORDER_STAGES.includes(o.stage as OrderStage) &&
    !isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage, sellerItemId: o.seller_item_id }),
  ).length
  const displayCurrency = (profile?.currency ?? 'GBP') as CurrencyCode

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  let monthEarnings = 0
  let monthEarningsByCurrency: Array<{ currency: string; amount: number }> = []
  const { data: monthOrders, error: monthOrdersError } = await supabase
    .from('orders')
    .select('quoted_amount, currency, quoted_currency')
    .eq('tailor_id', userId)
    .in('stage', ['COMPLETE', 'DELIVERED', 'COLLECTED'])
    .gte('updated_at', monthStart.toISOString())

  if (!monthOrdersError) {
    const earningsByCurrency = new Map<string, number>()
    ;(monthOrders ?? []).forEach((o: any) => {
      const amountMinorUnits = o.quoted_amount ?? 0
      const currency = String(o.currency ?? o.quoted_currency ?? displayCurrency).toUpperCase()
      earningsByCurrency.set(currency, (earningsByCurrency.get(currency) ?? 0) + amountMinorUnits)
    })
    monthEarningsByCurrency = Array.from(earningsByCurrency, ([currency, amount]) => ({ currency, amount }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => {
        if (a.currency === displayCurrency && b.currency !== displayCurrency) return -1
        if (b.currency === displayCurrency && a.currency !== displayCurrency) return 1
        return b.amount - a.amount
      })
    monthEarnings = monthEarningsByCurrency.find((row) => row.currency === displayCurrency)?.amount ?? 0
  }

  if (profile?.id) {
    const primaryStockItems = await supabase
      .from('seller_items')
      .select('id, title, sizes, size_inventory, inventory_quantity, stock_status, is_live')
      .eq('tailor_profile_id', profile.id)
      .order('updated_at', { ascending: false })

    let stockRows: any[] | null = primaryStockItems.data as any[] | null
    let stockError: any = primaryStockItems.error

    if (stockError && isMissingInventoryColumnError(stockError)) {
      const fallbackStockItems = await supabase
        .from('seller_items')
        .select('id, title, sizes, inventory_quantity, stock_status, is_live')
        .eq('tailor_profile_id', profile.id)
        .order('updated_at', { ascending: false })

      stockRows = fallbackStockItems.data as any[] | null
      stockError = fallbackStockItems.error
    }

    if (!stockError) {
      stockAlerts = (stockRows ?? [])
        .map((row: any) =>
          buildTailorStockAlert({
            itemId: row.id,
            title: row.title ?? 'This item',
            sizes: asStringList(row.sizes),
            sizeInventory: normalizeSizeInventory(
              asStringList(row.sizes),
              row.size_inventory,
              typeof row.inventory_quantity === 'number'
                ? row.inventory_quantity
                : fallbackInventoryQuantity(row.stock_status, row.is_live ?? true),
            ),
            inventoryQuantity:
              typeof row.inventory_quantity === 'number'
                ? row.inventory_quantity
                : fallbackInventoryQuantity(row.stock_status, row.is_live ?? true),
            isLive: row.is_live ?? false,
            stockStatus: row.stock_status ?? 'IN_STOCK',
          }),
        )
        .filter((value): value is TailorStockAlert => !!value)
        .slice(0, 3)
    }
  }

  return {
    stats: {
      activeOrders,
      pendingQuotes,
      itemInquiries,
      completedOrders,
      monthEarnings,
      monthEarningsByCurrency,
      avgRating: profile?.avg_rating ?? 0,
      tier: profile?.tier ?? null,
      displayName: profile?.display_name ?? fallbackDisplayName,
      availability: profile?.availability ?? 'OPEN',
      currency: displayCurrency,
      isLive: profile?.is_live ?? false,
      idVerificationStatus: profile?.id_verification_status ?? 'NOT_SUBMITTED',
      profileId: profile?.id ?? null,
      profileCompleted: profile?.profile_completed ?? false,
      stripeAccountId: null,
      paystackAccountId: null,
      payoutCurrency: profile?.payout_currency ?? null,
      payoutProvider: profile?.payout_provider ?? null,
      payoutReverificationRequired: profile?.payout_reverification_required ?? null,
      payoutAccountVerified: profile?.payout_account_verified ?? null,
      payoutAccountType: profile?.payout_account_type ?? null,
      paystackRecipientCode: null,
      stripeConnectAccountId: null,
    },
    orders: visibleOrderList.map((o) => ({
      id: o.id,
      reference: o.reference,
      garmentType: o.garment_type,
      orderKind: o.order_kind ?? 'CUSTOM',
      sellerItemId: o.seller_item_id ?? null,
      customerId: o.customer_id ?? null,
      stage: o.stage,
      customerName: o.customer_profiles?.display_name ?? 'Customer',
      estimatedDate: o.quoted_completion_date,
      quotedAmount: o.quoted_amount,
    })),
    stockAlerts,
  }
}

async function fetchCustomerProfileOverview(
  userId: string,
  lastNotifCheck: string,
): Promise<CustomerProfileOverview> {
  const [profileRes, ordersRes, reviewsRes] = await Promise.allSettled([
    supabase
      .from('customer_profiles')
      .select('measurements, created_at, avatar_url')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('orders')
      .select('id, reference, garment_type, order_kind, stage, created_at, tailor_profiles!tailor_profile_id(display_name)')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('customer_reviews')
      .select('rating')
      .eq('customer_id', userId),
  ])

  const profileFailed =
    profileRes.status === 'rejected' ||
    (profileRes.status === 'fulfilled' && !!profileRes.value.error)
  const ordersFailed =
    ordersRes.status === 'rejected' ||
    (ordersRes.status === 'fulfilled' && !!ordersRes.value.error)
  const reviewsFailed =
    reviewsRes.status === 'rejected' ||
    (reviewsRes.status === 'fulfilled' && !!reviewsRes.value.error)

  if (profileFailed && ordersFailed && reviewsFailed) {
    throw new Error('Unable to load customer profile overview')
  }

  const profile =
    profileRes.status === 'fulfilled' && !profileRes.value.error
      ? profileRes.value.data
      : null
  const orders =
    ordersRes.status === 'fulfilled' && !ordersRes.value.error
      ? ((ordersRes.value.data ?? []) as any[])
      : []
  const visibleOrders = orders
    .filter((o) => !isReadyMadeInquiryOrder({ orderKind: o.order_kind ?? 'CUSTOM', stage: o.stage }))
    .slice(0, 3)
  const reviews =
    reviewsRes.status === 'fulfilled' && !reviewsRes.value.error
      ? ((reviewsRes.value.data ?? []) as Array<{ rating: number | null }>)
      : []

  let notifCount = 0
  if (visibleOrders.length > 0) {
    const { count } = await supabase
      .from('order_stage_updates')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', lastNotifCheck)
      .in('order_id', visibleOrders.map((o) => o.id))
    notifCount = count ?? 0
  }

  return {
    measurements: (profile?.measurements as CustomerProfileOverview['measurements']) ?? null,
    createdAt: profile?.created_at ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    notifCount,
    reviewCount: reviews.length,
    averageRating: reviews.length > 0
      ? reviews.reduce((sum, row) => sum + (row.rating ?? 0), 0) / reviews.length
      : null,
    recentOrders: visibleOrders.map((o) => ({
      id: o.id,
      reference: o.reference,
      garmentType: o.garment_type,
      stage: o.stage as OrderStage,
      tailorName: (o.tailor_profiles as any)?.display_name ?? 'Tailor',
      createdAt: o.created_at,
    })),
  }
}

async function fetchCustomerMessageOrderInfo(
  orderId: string,
  userId: string,
  fallbackDisplayName = 'Customer',
): Promise<CustomerMessageOrderInfo> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      id, garment_type, order_kind, seller_item_id, stage, customer_id, video_call_url,
      tailor_profiles!tailor_profile_id(id, display_name),
      customer_profiles!customer_id(display_name)
    `)
    .eq('id', orderId)
    .eq('customer_id', userId)
    .maybeSingle()

  if (order) {
    const o = order as any
    return {
      garmentType: o.garment_type,
      orderKind: o.order_kind ?? 'CUSTOM',
      sellerItemId: o.seller_item_id ?? null,
      tailorName: o.tailor_profiles?.display_name ?? 'Tailor',
      tailorId: o.tailor_profiles?.id,
      customerId: o.customer_id,
      customerName: o.customer_profiles?.display_name ?? fallbackDisplayName,
      stage: o.stage,
      videoCallUrl: o.video_call_url ?? null,
      resolvedOrderId: o.id,
    }
  }

  if (orderError) {
    throw orderError
  }

  const { data: found, error: foundError } = await supabase
    .from('orders')
    .select(`
      id, garment_type, order_kind, seller_item_id, stage, customer_id, video_call_url,
      tailor_profiles!inner(id, display_name),
      customer_profiles(display_name)
    `)
    .eq('customer_id', userId)
    .eq('tailor_id', orderId)
    .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","CANCELLED","REFUNDED")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (foundError) {
    throw foundError
  }

  if (!found) return null

  const o = found as any
  return {
    garmentType: o.garment_type,
    orderKind: o.order_kind ?? 'CUSTOM',
    sellerItemId: o.seller_item_id ?? null,
    tailorName: o.tailor_profiles?.display_name ?? 'Tailor',
    tailorId: o.tailor_profiles?.id,
    customerId: o.customer_id,
    customerName: o.customer_profiles?.display_name ?? fallbackDisplayName,
    stage: o.stage,
    videoCallUrl: o.video_call_url ?? null,
    resolvedOrderId: o.id,
  }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useCustomerOrders(userId: string | undefined, tab: 'active' | 'completed') {
  return useQuery({
    queryKey: qk.customerOrders(userId ?? '', tab),
    queryFn: () => fetchCustomerOrders(userId!, tab),
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  })
}

export function useTailorOrders(userId: string | undefined, tab: 'active' | 'completed') {
  return useQuery({
    queryKey: qk.tailorOrders(userId ?? '', tab),
    queryFn: () => fetchTailorOrders(userId!, tab),
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  })
}

export function useCustomerOrderDetail(orderId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: qk.customerOrder(orderId ?? ''),
    queryFn: () => fetchCustomerOrderDetail(orderId!, userId!),
    enabled: !!orderId && !!userId,
    staleTime: 15_000,  // short-lived freshness for live tracking without full cold reloads
  })
}

export function useCustomerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.customerProfile(userId ?? ''),
    queryFn: () => fetchCustomerProfile(userId!),
    enabled: !!userId,
    staleTime: 10 * 60_000,  // profile changes infrequently and should feel instant on revisit
  })
}

export function useSavedTailors(userId: string | undefined) {
  return useQuery({
    queryKey: qk.savedTailors(userId ?? ''),
    queryFn: () => fetchSavedTailors(userId!),
    enabled: !!userId,
    staleTime: 10 * 60_000,
  })
}

export function useWishlistCollections(userId: string | undefined) {
  return useQuery({
    queryKey: qk.wishlistCollections(userId ?? ''),
    queryFn: () => fetchWishlistCollections(userId!),
    enabled: !!userId,
    staleTime: 2 * 60_000,
  })
}

export function useTailorDashboard(userId: string | undefined, fallbackDisplayName?: string) {
  return useQuery({
    queryKey: qk.tailorDashboard(userId ?? ''),
    queryFn: () => fetchTailorDashboard(userId!, fallbackDisplayName),
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function useTailorPublic(tailorId: string | undefined, userId?: string) {
  return useQuery({
    queryKey: [...qk.tailorPublic(tailorId ?? ''), userId ?? 'guest'],
    queryFn: () => fetchTailorPublic(tailorId!, userId),
    enabled: !!tailorId,
    staleTime: 10 * 60_000,
  })
}

export function useTailorShop(tailorId: string | undefined) {
  return useQuery({
    queryKey: qk.tailorShop(tailorId ?? ''),
    queryFn: () => fetchTailorShop(tailorId!),
    enabled: !!tailorId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useSellerItem(itemId: string | undefined) {
  return useQuery({
    queryKey: qk.sellerItem(itemId ?? ''),
    queryFn: () => fetchSellerItem(itemId!),
    enabled: !!itemId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useCustomerMeasurements(userId: string | undefined) {
  return useQuery({
    queryKey: qk.customerMeasurements(userId ?? ''),
    queryFn: () => fetchCustomerMeasurements(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function useCustomerProfileOverview(userId: string | undefined, lastNotifCheck: string) {
  return useQuery({
    queryKey: qk.customerProfileOverview(userId ?? ''),
    queryFn: () => fetchCustomerProfileOverview(userId!, lastNotifCheck),
    enabled: !!userId,
    staleTime: 90_000,
  })
}

export function useCustomerMessageOrderInfo(orderId: string | undefined, userId: string | undefined, fallbackDisplayName?: string) {
  return useQuery({
    queryKey: qk.customerMessageOrder(orderId ?? '', userId ?? ''),
    queryFn: () => fetchCustomerMessageOrderInfo(orderId!, userId!, fallbackDisplayName),
    enabled: !!orderId && !!userId,
    staleTime: 45_000,
  })
}
