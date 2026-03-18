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
  savedTailors:     (userId: string) =>
    ['saved-tailors', userId] as const,
  notifCount:       (userId: string) =>
    ['notif-count', userId] as const,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Refetches whenever the screen comes back into focus (after the first mount).
 * Drop-in replacement for `useFocusEffect` + manual setState pattern.
 */
export function useRefreshOnFocus(refetch: () => void) {
  const firstRender = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (firstRender.current) {
        firstRender.current = false
        return
      }
      refetch()
    }, [refetch])
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CustomerOrderRow = {
  id: string
  reference: string
  garmentType: string
  stage: OrderStage
  tailorName: string
  tailorId: string
  estimatedDate: string | null
  createdAt: string
  quotedAmount: number | null
  quotedCurrency: string
}

export type TailorOrderRow = {
  id: string
  reference: string
  garmentType: string
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

// ─── Fetchers ────────────────────────────────────────────────────────────────

const ACTIVE_STAGES: OrderStage[] = [
  'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING',
  'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING',
  'SHIPPED', 'READY_FOR_COLLECTION', 'IN_DISPUTE',
]
const TERMINAL_STAGES: OrderStage[] = [
  'COMPLETE', 'DELIVERED', 'COLLECTED', 'DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED',
]

async function fetchCustomerOrders(
  userId: string,
  tab: 'active' | 'completed',
): Promise<CustomerOrderRow[]> {
  const stages = tab === 'active' ? ACTIVE_STAGES : TERMINAL_STAGES
  const { data } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, stage, quoted_completion_date, created_at, quoted_amount, quoted_currency,
      tailor_profiles!tailor_profile_id(id, display_name)
    `)
    .eq('customer_id', userId)
    .in('stage', stages)
    .order('created_at', { ascending: false })
    .limit(50)

  return (data ?? []).map((o: any) => ({
    id: o.id,
    reference: o.reference,
    garmentType: o.garment_type,
    stage: o.stage,
    tailorName: o.tailor_profiles?.display_name ?? '',
    tailorId: o.tailor_profiles?.id ?? '',
    estimatedDate: o.quoted_completion_date,
    createdAt: o.created_at,
    quotedAmount: o.quoted_amount,
    quotedCurrency: o.quoted_currency ?? 'USD',
  }))
}

async function fetchTailorOrders(
  userId: string,
  tab: 'active' | 'completed',
): Promise<TailorOrderRow[]> {
  const stages = tab === 'active' ? ACTIVE_STAGES : TERMINAL_STAGES
  const { data } = await supabase
    .from('orders')
    .select(`
      id, reference, garment_type, stage, quoted_completion_date, quoted_amount, quoted_currency, video_call_url, created_at,
      customer_profiles!customer_id(display_name)
    `)
    .eq('tailor_id', userId)
    .in('stage', stages)
    .order('created_at', { ascending: false })
    .limit(50)

  return (data ?? []).map((o: any) => ({
    id: o.id,
    reference: o.reference,
    garmentType: o.garment_type,
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
  const { data } = await supabase
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
    .single()

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
    stageUpdates: (d.order_stage_updates ?? [])
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((u: any) => ({
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
  const [profileRes, ordersRes] = await Promise.all([
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

  return {
    measurements: (profileRes.data?.measurements as CustomerProfileData['measurements']) ?? null,
    avatarUrl: profileRes.data?.avatar_url ?? null,
    createdAt: profileRes.data?.created_at ?? null,
    recentOrders: ((ordersRes.data ?? []) as any[]).map((o) => ({
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
  const { data } = await supabase
    .from('saved_tailors')
    .select(`
      id,
      tailor_profiles!tailor_profile_id(
        id, display_name, location, tier, avg_rating, total_reviews, availability, portfolio_photo_urls
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return (data ?? []).map((row: any) => {
    const t = row.tailor_profiles
    return {
      savedId: row.id,
      id: t.id,
      displayName: t.display_name,
      location: t.location,
      tier: t.tier,
      avgRating: t.avg_rating,
      totalReviews: t.total_reviews,
      availability: t.availability,
      portfolioPhoto: (t.portfolio_photo_urls ?? [])[0] ?? null,
    }
  })
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useCustomerOrders(userId: string | undefined, tab: 'active' | 'completed') {
  return useQuery({
    queryKey: qk.customerOrders(userId ?? '', tab),
    queryFn: () => fetchCustomerOrders(userId!, tab),
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useTailorOrders(userId: string | undefined, tab: 'active' | 'completed') {
  return useQuery({
    queryKey: qk.tailorOrders(userId ?? '', tab),
    queryFn: () => fetchTailorOrders(userId!, tab),
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useCustomerOrderDetail(orderId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: qk.customerOrder(orderId ?? ''),
    queryFn: () => fetchCustomerOrderDetail(orderId!, userId!),
    enabled: !!orderId && !!userId,
    staleTime: 0,  // always fresh — user actively tracks this
  })
}

export function useCustomerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.customerProfile(userId ?? ''),
    queryFn: () => fetchCustomerProfile(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,  // 5 min — profile changes infrequently
  })
}

export function useSavedTailors(userId: string | undefined) {
  return useQuery({
    queryKey: qk.savedTailors(userId ?? ''),
    queryFn: () => fetchSavedTailors(userId!),
    enabled: !!userId,
    staleTime: 2 * 60_000,
  })
}
