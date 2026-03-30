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
  savedTailors:     (userId: string) =>
    ['saved-tailors', userId] as const,
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

/**
 * Refetches whenever the screen comes back into focus (after the first mount).
 * Drop-in replacement for `useFocusEffect` + manual setState pattern.
 */
export function useRefreshOnFocus(refetch: () => void, minIntervalMs = 45_000) {
  const firstRender = useRef(true)
  const lastRefreshAt = useRef(0)
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
      refetch()
    }, [refetch, minIntervalMs])
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
    unit: 'in' | 'cm'
  } | null
  avatarUrl: string | null
  createdAt: string | null
  recentOrders: Array<{
    id: string
    reference: string
    garmentType: string
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
  portfolioPhoto: string | null
}

export type TailorDashboardData = {
  stats: {
    activeOrders: number
    pendingQuotes: number
    completedOrders: number
    monthEarnings: number
    avgRating: number
    tier: string | null
    displayName: string
    availability: 'OPEN' | 'LIMITED' | 'FULLY_BOOKED'
    currency: string
    isLive: boolean
    idVerificationStatus: string
    profileId: string | null
  } | null
  orders: Array<{
    id: string
    reference: string
    garmentType: string
    orderKind: 'CUSTOM' | 'READY_MADE'
    stage: OrderStage
    customerName: string
    estimatedDate: string | null
    quotedAmount: number | null
  }>
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
  priceRangeMin: number | null
  priceRangeMax: number | null
  portfolioPhotos: string[]
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
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
}

export type TailorShopData = {
  tailorName: string
  items: SellerShopItem[]
}

export type SellerItemDetail = {
  id: string
  tailorProfileId: string
  tailorUserId: string | null
  sellerName: string
  title: string
  description: string | null
  category: string | null
  sizes: string[]
  currency: string
  priceAmount: number
  photoUrls: string[]
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

const ACTIVE_STAGES: OrderStage[] = [
  'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING',
  'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING',
  'SHIPPED', 'READY_FOR_COLLECTION', 'DELIVERED', 'COLLECTED', 'IN_DISPUTE',
]
const TERMINAL_STAGES: OrderStage[] = [
  'COMPLETE', 'DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED',
]

async function fetchCustomerOrders(
  userId: string,
  tab: 'active' | 'completed',
): Promise<CustomerOrderRow[]> {
  const stages = tab === 'active' ? ACTIVE_STAGES : TERMINAL_STAGES
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, order_kind, stage, quoted_completion_date, created_at, quoted_amount, quoted_currency,
      tailor_profiles!tailor_profile_id(id, display_name),
      reviews!order_id(id)
    `)
    .eq('customer_id', userId)
    .in('stage', stages)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error

  return (data ?? []).map((o: any) => ({
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
    quotedCurrency: o.quoted_currency ?? 'USD',
    hasReview: (o.reviews ?? []).length > 0,
  }))
}

async function fetchTailorOrders(
  userId: string,
  tab: 'active' | 'completed',
): Promise<TailorOrderRow[]> {
  const stages = tab === 'active' ? ACTIVE_STAGES : TERMINAL_STAGES
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, order_kind, stage, quoted_completion_date, quoted_amount, quoted_currency, video_call_url, created_at,
      customer_profiles!customer_id(display_name)
    `)
    .eq('tailor_id', userId)
    .in('stage', stages)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error

  return (data ?? []).map((o: any) => ({
    id: o.id,
    reference: o.reference,
    garmentType: o.garment_type,
    orderKind: o.order_kind ?? 'CUSTOM',
    stage: o.stage,
    customerName: o.customer_profiles?.display_name ?? 'Customer',
    estimatedDate: o.quoted_completion_date,
    quotedAmount: o.quoted_amount,
    quotedCurrency: o.quoted_currency ?? 'USD',
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
      tailor_id, tailor_profile_id, quoted_amount, quoted_currency, quoted_completion_date,
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
    quotedCurrency: (d.quoted_currency ?? 'USD') as CurrencyCode,
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
      .select('id, reference, garment_type, stage, created_at, tailor_profiles!tailor_profile_id(display_name)')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),
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

  return {
    measurements: (profile?.measurements as CustomerProfileData['measurements']) ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: profile?.created_at ?? null,
    recentOrders: orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      garmentType: o.garment_type,
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
        id, display_name, location, tier, avg_rating, total_reviews, availability, portfolio_photo_urls
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
      portfolioPhoto: portfolioPhotos[0] ?? null,
    }
  })
}

async function fetchTailorPublic(tailorId: string, userId?: string): Promise<TailorPublicData> {
  const queries = [
    supabase
      .from('tailor_profiles')
      .select('id, display_name, location, seller_type, tier, avg_rating, total_reviews, total_orders, avg_response_hours, availability, bio, specialty_tags, languages, price_range_min, price_range_max, portfolio_photo_urls, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available')
      .eq('id', tailorId)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id, rating, body, tags, created_at, reviewer_name, tailor_response, orders!order_id(customer_profiles!customer_id(avatar_url))')
      .eq('tailor_profile_id', tailorId)
      .order('created_at', { ascending: false })
      .limit(10),
  ] as const

  const [profileRes, reviewsRes, savedRes] = await Promise.allSettled([
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
          priceRangeMin: profileData.price_range_min ?? null,
          priceRangeMax: profileData.price_range_max ?? null,
          portfolioPhotos: asStringList(profileData.portfolio_photo_urls),
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
    supabase.from('tailor_profiles').select('display_name').eq('id', tailorId).maybeSingle(),
    supabase
      .from('seller_items')
      .select('id, title, category, price_amount, currency, photo_urls, pickup_available, delivery_available, shipping_available')
      .eq('tailor_profile_id', tailorId)
      .eq('is_live', true)
      .neq('stock_status', 'SOLD_OUT')
      .neq('stock_status', 'HIDDEN')
      .order('updated_at', { ascending: false }),
  ])

  if (profileError && itemsError) throw profileError

  return {
    tailorName: (profileData as any)?.display_name ?? 'This seller',
    items: (itemsData ?? []).map((row: any) => ({
      id: row.id,
      title: row.title,
      category: row.category ?? null,
      priceAmount: row.price_amount,
      currency: row.currency,
      photoUrls: asStringList(row.photo_urls),
      pickupAvailable: row.pickup_available ?? false,
      deliveryAvailable: row.delivery_available ?? false,
      shippingAvailable: row.shipping_available ?? false,
    })),
  }
}

async function fetchSellerItem(itemId: string): Promise<SellerItemDetail | null> {
  const { data, error } = await supabase
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
      pickup_available,
      delivery_available,
      shipping_available,
      tailor_profiles(display_name, user_id)
    `)
    .eq('id', itemId)
    .eq('is_live', true)
    .neq('stock_status', 'SOLD_OUT')
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row: any = data
  return {
    id: row.id,
    tailorProfileId: row.tailor_profile_id,
    tailorUserId: row.tailor_profiles?.user_id ?? null,
    sellerName: row.tailor_profiles?.display_name ?? 'This seller',
    title: row.title,
    description: row.description ?? null,
    category: row.category ?? null,
    sizes: asStringList(row.sizes),
    currency: row.currency,
    priceAmount: row.price_amount,
    photoUrls: asStringList(row.photo_urls),
    pickupAvailable: row.pickup_available ?? false,
    deliveryAvailable: row.delivery_available ?? false,
    shippingAvailable: row.shipping_available ?? false,
  }
}

async function fetchTailorDashboard(userId: string, fallbackDisplayName = ''): Promise<TailorDashboardData> {
  const [profileRes, ordersRes, completedRes] = await Promise.allSettled([
    supabase
      .from('tailor_profiles')
      .select('id, display_name, tier, avg_rating, availability, currency, is_live, id_verification_status')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('orders')
      .select(`
        id, reference, garment_type, order_kind, stage, quoted_completion_date, quoted_amount,
        customer_profiles!customer_id(display_name)
      `)
      .eq('tailor_id', userId)
      .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","CANCELLED","REFUNDED")')
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
  const completedOrders =
    completedRes.status === 'fulfilled' && !completedRes.value.error
      ? (completedRes.value.count ?? 0)
      : 0

  if (
    (profileRes.status === 'rejected' || (profileRes.status === 'fulfilled' && profileRes.value.error)) &&
    (ordersRes.status === 'rejected' || (ordersRes.status === 'fulfilled' && ordersRes.value.error))
  ) {
    throw new Error('Unable to load tailor dashboard')
  }

  const pendingQuotes = orderList.filter((o) => o.stage === 'PENDING_QUOTE').length
  const activeOrders = orderList.filter((o) => o.stage !== 'PENDING_QUOTE').length

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  let monthEarnings = 0
  const { data: monthOrders, error: monthOrdersError } = await supabase
    .from('orders')
    .select('quoted_amount')
    .eq('tailor_id', userId)
    .in('stage', ['COMPLETE', 'DELIVERED', 'COLLECTED'])
    .gte('updated_at', monthStart.toISOString())

  if (!monthOrdersError) {
    monthEarnings = (monthOrders ?? []).reduce((sum: number, o: any) => sum + (o.quoted_amount ?? 0), 0)
  }

  return {
    stats: {
      activeOrders,
      pendingQuotes,
      completedOrders,
      monthEarnings,
      avgRating: profile?.avg_rating ?? 0,
      tier: profile?.tier ?? null,
      displayName: profile?.display_name ?? fallbackDisplayName,
      availability: profile?.availability ?? 'OPEN',
      currency: profile?.currency ?? 'GBP',
      isLive: profile?.is_live ?? false,
      idVerificationStatus: profile?.id_verification_status ?? 'NOT_SUBMITTED',
      profileId: profile?.id ?? null,
    },
    orders: orderList.map((o) => ({
      id: o.id,
      reference: o.reference,
      garmentType: o.garment_type,
      orderKind: o.order_kind ?? 'CUSTOM',
      stage: o.stage,
      customerName: o.customer_profiles?.display_name ?? 'Customer',
      estimatedDate: o.quoted_completion_date,
      quotedAmount: o.quoted_amount,
    })),
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
      .select('id, reference, garment_type, stage, created_at, tailor_profiles!tailor_profile_id(display_name)')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),
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
  const reviews =
    reviewsRes.status === 'fulfilled' && !reviewsRes.value.error
      ? ((reviewsRes.value.data ?? []) as Array<{ rating: number | null }>)
      : []

  let notifCount = 0
  if (orders.length > 0) {
    const { count } = await supabase
      .from('order_stage_updates')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', lastNotifCheck)
      .in('order_id', orders.map((o) => o.id))
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
    recentOrders: orders.map((o) => ({
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
      id, garment_type, stage, customer_id, video_call_url,
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
      id, garment_type, stage, customer_id, video_call_url,
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
    staleTime: 90_000,
  })
}

export function useTailorOrders(userId: string | undefined, tab: 'active' | 'completed') {
  return useQuery({
    queryKey: qk.tailorOrders(userId ?? '', tab),
    queryFn: () => fetchTailorOrders(userId!, tab),
    enabled: !!userId,
    staleTime: 90_000,
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
    staleTime: 10 * 60_000,
  })
}

export function useSellerItem(itemId: string | undefined) {
  return useQuery({
    queryKey: qk.sellerItem(itemId ?? ''),
    queryFn: () => fetchSellerItem(itemId!),
    enabled: !!itemId,
    staleTime: 10 * 60_000,
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
