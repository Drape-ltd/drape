'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import type { Session } from '@supabase/supabase-js'
import { formatDatabaseEnumLabel, formatOrderPaymentPhase } from '@drape/shared'
import { createClient } from '../lib/supabase'
import { safeEntityName, safeUserText } from '../lib/safe-display'
import { OpenAppButton } from './open-app-button'
import {
  bootstrapWebOnboarding,
  webOnboardingFromUser,
} from '../lib/account-bootstrap'
import { signOutWebSession } from '../lib/web-auth-session'
import { invalidateWebAccountCaches } from '../lib/web-account-cache-events'
import { GettingStartedCard } from './getting-started-card'
import { StatusChip } from './ui/status-chip'

type DrapeRole = 'CUSTOMER' | 'TAILOR'
type JoinedProfile = { display_name?: string | null }
type DashboardOrder = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  item_size: string | null
  stage: string | null
  delivery_method: string | null
  quoted_amount: number | null
  total_amount: number | null
  currency: string | null
  quoted_currency: string | null
  created_at: string | null
  updated_at: string | null
  quoted_completion_date: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
  customer_profiles?: JoinedProfile | JoinedProfile[] | null
}
type DashboardPayment = {
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
type DashboardMessage = {
  id: string
  order_id: string
  sender_id: string | null
  type: string | null
  body: string | null
  photo_url: string | null
  voice_url: string | null
  read_at: string | null
  created_at: string | null
}
type DashboardStageUpdate = {
  id: string
  order_id: string
  stage: string | null
  note: string | null
  photo_url: string | null
  created_at: string | null
}
type CustomerProfileSummary = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  updated_at: string | null
}
type TailorProfileSummary = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
  avatar_url: string | null
  availability: string | null
  is_live: boolean | null
  is_verified: boolean | null
  profile_completed: boolean | null
  total_orders: number | null
  avg_rating: number | null
  currency: string | null
  payout_account_verified: boolean | null
  payout_reverification_required: boolean | null
}
type MeasurementProfileSummary = {
  id: string
  label: string | null
  relationship: string | null
  source: string | null
  unit_preference: string | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}
type MeasurementScanSummary = {
  id: string
  capture_method: string | null
  status: string | null
  confidence_overall: string | null
  created_at: string | null
}
type WishlistCollectionSummary = {
  id: string
  name: string | null
  item_count: number | null
  cover_image_url: string | null
  updated_at: string | null
}
type SellerItemSummary = {
  id: string
  title: string | null
  price_amount: number | null
  currency: string | null
  stock_status: string | null
  is_live: boolean | null
  updated_at: string | null
}
type AccountActivity = {
  userId: string | null
  orders: DashboardOrder[]
  payments: DashboardPayment[]
  messages: DashboardMessage[]
  stageUpdates: DashboardStageUpdate[]
  customerProfile: CustomerProfileSummary | null
  tailorProfile: TailorProfileSummary | null
  measurementProfiles: MeasurementProfileSummary[]
  measurementScans: MeasurementScanSummary[]
  wishlistCollections: WishlistCollectionSummary[]
  sellerItems: SellerItemSummary[]
  warning: string | null
}
type AccountNextAction = {
  eyebrow: string
  title: string
  body: string
  cta: string
  href: Route | 'drape://'
}

const emptyActivity: AccountActivity = {
  userId: null,
  orders: [],
  payments: [],
  messages: [],
  stageUpdates: [],
  customerProfile: null,
  tailorProfile: null,
  measurementProfiles: [],
  measurementScans: [],
  wishlistCollections: [],
  sellerItems: [],
  warning: null,
}

function roleFromSession(session: Session | null): DrapeRole | null {
  const role = session?.user.user_metadata?.role
  return role === 'CUSTOMER' || role === 'TAILOR' ? role : null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function cleanLabel(value: string | null | undefined, fallback: string) {
  return formatDatabaseEnumLabel(value, fallback)
}

function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined) {
  if (typeof amountMinor !== 'number') return 'Quote pending'
  const normalizedCurrency = currency || 'USD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalizedCurrency,
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
  const deltaMs = date.getTime() - Date.now()
  const deltaMinutes = Math.round(deltaMs / 60_000)
  const absMinutes = Math.abs(deltaMinutes)
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

  if (absMinutes < 60) return formatter.format(deltaMinutes, 'minute')
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, 'hour')
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 30) return formatter.format(deltaDays, 'day')

  return formatDate(value) ?? 'Recently'
}

function orderTitle(order: DashboardOrder) {
  return safeUserText(order.item_title || order.garment_type, 'Order')
}

function orderAmount(order: DashboardOrder) {
  return formatMoney(order.total_amount ?? order.quoted_amount, order.currency ?? order.quoted_currency)
}

function orderCounterparty(order: DashboardOrder, userId: string) {
  if (order.customer_id === userId) {
    return safeEntityName(firstJoinedRow(order.tailor_profiles)?.display_name, 'Tailor')
  }
  return safeEntityName(firstJoinedRow(order.customer_profiles)?.display_name, 'Customer')
}

function profileName(activity: AccountActivity, fallback: string) {
  return (
    safeEntityName(
      activity.customerProfile?.display_name ||
        activity.tailorProfile?.business_name ||
        activity.tailorProfile?.display_name,
      fallback,
    )
  )
}

function initialsForName(value: string | null | undefined) {
  const parts = safeEntityName(value, 'Drapeon')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return 'D'
  if (parts.length === 1) return (parts[0] ?? 'D').slice(0, 2).toUpperCase()
  return `${parts[0]?.charAt(0) ?? 'D'}${parts[parts.length - 1]?.charAt(0) ?? ''}`.toUpperCase()
}

function safeAvatarUrl(value: string | null | undefined) {
  if (!value) return null
  if (value.startsWith('/') || value.startsWith('https://')) return value
  return null
}

function orderDetailRoute(orderId: string): Route {
  return `/account/orders/${orderId}` as Route
}

function itemDetailRoute(itemId: string): Route {
  return `/account/items/${itemId}` as Route
}

function hasMeasurements(profile: CustomerProfileSummary | null) {
  return !!profile?.measurements && Object.keys(profile.measurements).length > 0
}

function latestStageUpdateFor(orderId: string, stageUpdates: DashboardStageUpdate[]) {
  return stageUpdates.find((update) => update.order_id === orderId) ?? null
}

function buildNextAction({
  role,
  activity,
  customerOrders,
  tailorOrders,
  measurementCount,
  unreadMessages,
}: {
  role: DrapeRole | null
  activity: AccountActivity
  customerOrders: DashboardOrder[]
  tailorOrders: DashboardOrder[]
  measurementCount: number
  unreadMessages: number
}): AccountNextAction {
  if (role === 'TAILOR') {
    if (!activity.tailorProfile) {
      return {
        eyebrow: 'Setup',
        title: 'Request tailor access.',
        body: 'Apply first so Drapeon can review your craft and keep tailor setup, identity checks, payout readiness, and shop access intentional.',
        cta: 'Apply as a tailor',
        href: '/apply?source=account',
      }
    }
    if (!activity.tailorProfile.profile_completed) {
      return {
        eyebrow: 'Profile',
        title: 'Complete your tailor profile.',
        body: 'A complete profile gives customers the context they need before sending a brief.',
        cta: 'Continue setup',
        href: '/account/profile',
      }
    }
    if (!activity.tailorProfile.payout_account_verified || activity.tailorProfile.payout_reverification_required) {
      return {
        eyebrow: 'Payouts',
        title: 'Check payout readiness.',
        body: 'Keep payout details current before production work starts moving through escrow.',
        cta: 'Open payouts',
        href: '/account/payout',
      }
    }
    if (activity.sellerItems.length === 0) {
      return {
        eyebrow: 'Shop',
        title: 'Add your first ready-made piece.',
        body: 'Ready-made items help customers understand your taste and buy without a custom brief.',
        cta: 'Review shop',
        href: '/account/shop',
      }
    }
    if (tailorOrders.length === 0) {
      return {
        eyebrow: 'Discovery',
        title: 'Share your profile to get your first order.',
        body: 'Once orders arrive, web becomes your command center for work, messages, shop, and money.',
        cta: 'Open profile',
        href: '/account/profile',
      }
    }
    return {
      eyebrow: 'Today',
      title: 'Review active work.',
      body: 'Quotes, messages, stage updates, and ready-made shop work are ready to review.',
      cta: 'View work queue',
      href: '/account/work',
    }
  }

  if (!activity.customerProfile) {
    return {
      eyebrow: 'Setup',
      title: 'Finish your customer profile.',
      body: 'Add basic profile details, then save measurements before placing your first order.',
      cta: 'Open settings',
      href: '/account/settings',
    }
  }
  if (measurementCount === 0) {
    return {
      eyebrow: 'Fit',
      title: 'Add measurements before ordering.',
      body: 'Use manual measurements on web or Drapeon Vision in the app so tailors have the right fit context.',
      cta: 'Review measurements',
      href: '/account/measurements',
    }
  }
  if (customerOrders.length === 0) {
    return {
      eyebrow: 'Order',
      title: 'Find a tailor and start your first brief.',
      body: 'Explore tailors, save favorites, start a custom brief, or begin ready-made checkout.',
      cta: 'Open Explore',
      href: '/account/explore',
    }
  }
  if (unreadMessages > 0) {
    return {
      eyebrow: 'Messages',
      title: 'You have order messages waiting.',
      body: 'Reply in the order thread so decisions, photos, and call requests stay attached to the work.',
      cta: 'Review messages',
      href: '/account/messages',
    }
  }
  return {
    eyebrow: 'Today',
    title: 'Review your orders.',
    body: 'Checkout, messages, calls, and support are available where the order stage allows it.',
    cta: 'Review orders',
    href: '/account/orders',
  }
}

async function fetchAccountActivity(userId: string): Promise<AccountActivity> {
  const supabase = createClient()
  const [
    customerProfileRes,
    tailorProfileRes,
    measurementProfilesRes,
    measurementScansRes,
    wishlistCollectionsRes,
  ] = await Promise.all([
    supabase
      .from('customer_profiles')
      .select('user_id, display_name, avatar_url, measurements, unit_preference, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select('id, user_id, display_name, business_name, avatar_url, availability, is_live, is_verified, profile_completed, total_orders, avg_rating, currency, payout_account_verified, payout_reverification_required')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('customer_measurement_profiles')
      .select('id, label, relationship, source, unit_preference, is_default, last_measured_at, updated_at')
      .eq('customer_id', userId)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('measurement_scans')
      .select('id, capture_method, status, confidence_overall, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('wishlist_collections')
      .select('id, name, item_count, cover_image_url, updated_at')
      .eq('customer_id', userId)
      .order('updated_at', { ascending: false })
      .limit(6),
  ])

  const tailorProfile = tailorProfileRes.error ? null : ((tailorProfileRes.data ?? null) as TailorProfileSummary | null)
  const orderFilter = tailorProfile?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfile.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(`
      id, reference, order_kind, garment_type, item_title, item_size, stage, delivery_method,
      quoted_amount, total_amount, currency, quoted_currency, created_at, updated_at, quoted_completion_date,
      customer_id, tailor_id, tailor_profile_id,
      tailor_profiles!tailor_profile_id(display_name),
      customer_profiles!customer_id(display_name)
    `)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(12)

  let warning: string | null = null
  if (
    customerProfileRes.error ||
    tailorProfileRes.error ||
    ordersRes.error ||
    measurementProfilesRes.error ||
    measurementScansRes.error ||
    wishlistCollectionsRes.error
  ) {
    warning = 'Some account history could not load. Refresh to retry.'
  }

  const orders = ordersRes.error ? [] : ((ordersRes.data ?? []) as DashboardOrder[])
  const orderIds = orders.map((order) => order.id)
  let payments: DashboardPayment[] = []
  let messages: DashboardMessage[] = []
  let stageUpdates: DashboardStageUpdate[] = []
  if (orderIds.length > 0) {
    const [paymentsRes, messagesRes, stageUpdatesRes] = await Promise.all([
      supabase
        .from('order_payments')
        .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('messages')
        .select('id, order_id, sender_id, type, body, photo_url, voice_url, read_at, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('order_stage_updates')
        .select('id, order_id, stage, note, photo_url, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(12),
    ])
    if (paymentsRes.error || messagesRes.error || stageUpdatesRes.error) {
      warning = 'Latest order updates are unavailable. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as DashboardPayment[]
      messages = (messagesRes.data ?? []) as DashboardMessage[]
      stageUpdates = (stageUpdatesRes.data ?? []) as DashboardStageUpdate[]
    }
  }

  let sellerItems: SellerItemSummary[] = []
  if (tailorProfile?.id) {
    const { data, error } = await supabase
      .from('seller_items')
      .select('id, title, price_amount, currency, stock_status, is_live, updated_at')
      .eq('tailor_profile_id', tailorProfile.id)
      .order('updated_at', { ascending: false })
      .limit(8)

    if (error) {
      warning = 'Some shop history could not load. Refresh to retry.'
    } else {
      sellerItems = (data ?? []) as SellerItemSummary[]
    }
  }

  return {
    userId,
    orders,
    payments,
    messages,
    stageUpdates,
    customerProfile: customerProfileRes.error ? null : ((customerProfileRes.data ?? null) as CustomerProfileSummary | null),
    tailorProfile,
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfileSummary[]),
    measurementScans: measurementScansRes.error ? [] : ((measurementScansRes.data ?? []) as MeasurementScanSummary[]),
    wishlistCollections: wishlistCollectionsRes.error ? [] : ((wishlistCollectionsRes.data ?? []) as WishlistCollectionSummary[]),
    sellerItems,
    warning,
  }
}

export function AccountDashboard(): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<AccountActivity>(emptyActivity)
  const [savingRole, setSavingRole] = useState<DrapeRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id) {
      return
    }

    let active = true
    const supabase = createClient()
    const onboarding = webOnboardingFromUser(session.user)

    Promise.resolve()
      .then(async () => {
        if (onboarding) {
          await bootstrapWebOnboarding(supabase, {
            userId: session.user.id,
            onboarding,
          })
        }
      })
      .then(() => fetchAccountActivity(session.user.id))
      .then((nextActivity) => {
        if (!active) return
        setActivity(nextActivity)
      })
      .catch(() => {
        if (!active) return
        setActivity({
          ...emptyActivity,
          userId: session.user.id,
          warning: 'Account history could not load. Refresh to retry.',
        })
      })

    return () => {
      active = false
    }
  }, [session?.user])

  async function setRole(role: DrapeRole) {
    setError(null)
    setSavingRole(role)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ data: { role } })
    if (error) {
      setError('We could not switch your Drapeon mode right now. Try again in a moment.')
      setSavingRole(null)
      return
    }
    if (session?.user.id) {
      await supabase
        .from('users')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', session.user.id)
    }
    const { data } = await supabase.auth.refreshSession()
    invalidateWebAccountCaches('role-change')
    setSession(data.session)
    setSavingRole(null)
  }

  async function signOut() {
    await signOutWebSession({
      reason: 'manual',
      redirectTo: '/sign-in',
      scope: 'local',
    })
  }

  if (loading) {
    return (
      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <p className="text-sm font-semibold text-ink/62">Loading account...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Account</p>
        <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Sign in to continue.</h1>
        <p className="mt-4 text-sm leading-7 text-ink/66">
          Use your Drapeon account to review orders, messages, measurements, payments, and support.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/sign-in" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
            Sign in
          </Link>
          <Link href="/sign-up" className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
            Create account
          </Link>
        </div>
      </div>
    )
  }

  const role = roleFromSession(session)
  const email = session.user.email ?? 'Account email unavailable'
  const userId = session.user.id
  const activityLoading = activity.userId !== userId
  const activeOrders = activity.orders.filter((order) => {
    const stage = order.stage ?? ''
    return !['COMPLETE', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(stage)
  })
  const completedOrders = activity.orders.length - activeOrders.length
  const displayName = profileName(activity, email)
  const customerOrders = activity.orders.filter((order) => order.customer_id === userId)
  const tailorOrders = activity.orders.filter(
    (order) => order.tailor_id === userId || order.tailor_profile_id === activity.tailorProfile?.id,
  )
  const latestMessage = activity.messages[0] ?? null
  const unreadMessages = activity.messages.filter((message) => message.sender_id !== userId && !message.read_at).length
  const liveSellerItems = activity.sellerItems.filter((item) => item.is_live).length
  const hasTailorProfile = Boolean(activity.tailorProfile)
  const workspaceRole: DrapeRole = role === 'TAILOR' && hasTailorProfile ? 'TAILOR' : 'CUSTOMER'
  const avatarUrl = safeAvatarUrl(
    workspaceRole === 'TAILOR'
      ? (activity.tailorProfile?.avatar_url ?? activity.customerProfile?.avatar_url)
      : (activity.customerProfile?.avatar_url ?? activity.tailorProfile?.avatar_url),
  )
  const measurementCount =
    activity.measurementProfiles.length +
    activity.measurementScans.length +
    (hasMeasurements(activity.customerProfile) && activity.measurementProfiles.length === 0 ? 1 : 0)
  const nextAction = buildNextAction({
    role,
    activity,
    customerOrders,
    tailorOrders,
    measurementCount,
    unreadMessages,
  })
  const accountLinks: Array<[string, Route]> = [
    ['Orders', '/account/orders'],
    ['Messages', '/account/messages'],
    ['Measurements', '/account/measurements'],
    ['Saved', '/account/saved'],
    ['Explore', '/account/explore'],
    ['Settings', '/account/settings'],
    ['Support', '/account/support'],
  ]
  if (hasTailorProfile) {
    accountLinks.push(['Shop', '/account/shop'], ['Work queue', '/account/work'])
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-ink/8 bg-white/88 p-4 shadow-[0_10px_34px_rgba(22,28,24,0.05)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Drapeon account</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-needle/14 bg-needle/8 text-sm font-semibold text-needle">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="size-full object-cover" />
                ) : initialsForName(displayName)}
              </div>
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-semibold text-ink sm:text-3xl">{displayName}</h1>
                <p className="mt-1 truncate text-sm text-ink/58">{email}</p>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/66">
              Review orders, fit records, messages, saved items, shop work, and payments.
            </p>
          </div>
          <div className="rounded-lg border border-ink/6 bg-bone/70 px-3 py-2 lg:min-w-56">
            <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Viewing</p>
            <p className="mt-1 text-base font-semibold text-ink">
              {workspaceRole === 'TAILOR' ? 'Tailor workspace' : 'Customer account'}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink/62">
              {workspaceRole === 'TAILOR'
                ? 'Orders, shop, client context, and payout readiness.'
                : 'Orders, fit, wishlist, messages, and payment history.'}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {workspaceRole === 'TAILOR' ? (
                <button
                  type="button"
                  onClick={() => {
                    void setRole('CUSTOMER')
                  }}
                  disabled={savingRole === 'CUSTOMER'}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:text-ink/40"
                >
                  {savingRole === 'CUSTOMER' ? 'Switching...' : 'Use customer account'}
                </button>
              ) : hasTailorProfile ? (
                <button
                  type="button"
                  onClick={() => {
                    void setRole('TAILOR')
                  }}
                  disabled={savingRole === 'TAILOR'}
                  className="inline-flex min-h-10 items-center justify-center rounded-full bg-needle px-3 py-2 text-xs font-semibold text-white transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
                >
                  {savingRole === 'TAILOR' ? 'Switching...' : 'Use tailor workspace'}
                </button>
              ) : (
                <Link href="/apply?source=account" className="inline-flex min-h-10 items-center justify-center rounded-full bg-needle px-3 py-2 text-xs font-semibold text-white transition hover:bg-needle-600">
                  Apply as a tailor
                </Link>
              )}
            </div>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded-lg border border-rust/18 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
            {error}
          </div>
        ) : null}
        {activity.warning ? (
          <div className="mt-3 rounded-lg border border-rust/18 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
            {activity.warning}
          </div>
        ) : null}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {accountLinks.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="whitespace-nowrap rounded-full border border-ink/8 bg-white px-3 py-2 text-sm font-semibold text-ink/72 transition hover:bg-bone hover:text-ink"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <GettingStartedCard
        role={workspaceRole}
        userId={userId}
        hasCustomerProfile={Boolean(activity.customerProfile)}
        hasMeasurements={measurementCount > 0}
        hasCustomerOrder={customerOrders.length > 0}
        hasTailorProfileComplete={Boolean(activity.tailorProfile?.profile_completed)}
        hasPayoutVerified={Boolean(activity.tailorProfile?.payout_account_verified) && !activity.tailorProfile?.payout_reverification_required}
        hasSellerItem={activity.sellerItems.length > 0}
        hasTailorOrder={tailorOrders.length > 0}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-ink/6 bg-white/84 p-4 shadow-sm">
          <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Orders</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {activityLoading ? <span className="text-base font-semibold text-ink/46">Loading</span> : activity.orders.length}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {activeOrders.length} active, {completedOrders} completed
          </p>
        </div>
        <div className="rounded-lg border border-ink/6 bg-white/84 p-4 shadow-sm">
          <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Messages</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {activityLoading ? <span className="text-base font-semibold text-ink/46">Loading</span> : activity.messages.length}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {unreadMessages > 0 ? `${unreadMessages} unread` : 'Threads are caught up'}
          </p>
        </div>
        <div className="rounded-lg border border-ink/6 bg-white/84 p-4 shadow-sm">
          <p className="text-[0.68rem] font-semibold uppercase text-needle/80">{workspaceRole === 'TAILOR' ? 'Shop' : 'Fit'}</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {activityLoading ? <span className="text-base font-semibold text-ink/46">Loading</span> : workspaceRole === 'TAILOR' ? liveSellerItems : measurementCount}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {workspaceRole === 'TAILOR' ? `${activity.sellerItems.length} ready-made records` : 'Measurement records on file'}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-needle/14 bg-needle/8 p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase text-needle/80">{nextAction.eyebrow}</p>
            <h2 className="mt-1 text-xl font-semibold text-ink sm:text-2xl">{nextAction.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/66">{nextAction.body}</p>
          </div>
          {nextAction.href.startsWith('/') ? (
            <Link
              href={nextAction.href}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)]"
            >
              {nextAction.cta}
            </Link>
          ) : (
            <OpenAppButton
              label={nextAction.cta}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)]"
            />
          )}
        </div>
      </div>

      {workspaceRole === 'TAILOR' ? (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor cockpit</p>
                <h2 className="mt-2 text-2xl font-semibold text-ink">Your work queue</h2>
              </div>
              <p className="text-sm leading-6 text-ink/62">{tailorOrders.length} tailor-side orders</p>
            </div>
            <div className="mt-5 grid gap-3">
              {activityLoading ? (
                <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
                  Loading tailor orders...
                </div>
              ) : tailorOrders.length === 0 ? (
                <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                  No tailor orders yet. New briefs, ready-made orders, consultations, and production work will appear here.
                </div>
              ) : (
                tailorOrders.slice(0, 4).map((order) => {
                  const latestUpdate = latestStageUpdateFor(order.id, activity.stageUpdates)
                  return (
                    <Link key={order.id} href={orderDetailRoute(order.id)} className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                            {cleanLabel(order.order_kind, 'Custom order')}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/62">
                            <span>{orderCounterparty(order, userId)}</span>
                            <StatusChip status={order.stage} fallback="In progress" />
                          </div>
                          {latestUpdate?.note ? (
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/58">{safeUserText(latestUpdate.note)}</p>
                          ) : null}
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-semibold text-ink">{orderAmount(order)}</p>
                          <p className="mt-1 text-xs text-ink/50">{formatRelative(order.updated_at ?? order.created_at)}</p>
                        </div>
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Profile readiness</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">
                {safeEntityName(activity.tailorProfile?.business_name || activity.tailorProfile?.display_name, 'Tailor profile')}
              </h2>
              <div className="mt-5 grid gap-2 text-sm leading-6 text-ink/66">
                <p>Profile: <span className="font-semibold text-ink">{activity.tailorProfile?.profile_completed ? 'Complete' : 'Setup in progress'}</span></p>
                <p>Verification: <span className="font-semibold text-ink">{activity.tailorProfile?.is_verified ? 'Verified' : 'Not verified yet'}</span></p>
                <div className="flex flex-wrap items-center gap-2">Availability: <StatusChip status={activity.tailorProfile?.availability} fallback="Not set" /></div>
                <p>Payout: <span className="font-semibold text-ink">{activity.tailorProfile?.payout_account_verified ? 'Ready' : 'Needs setup'}</span></p>
              </div>
              <Link href="/account/profile" className="mt-5 inline-flex min-h-10 items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone">
                Edit profile
              </Link>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Ready-made shop</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">{liveSellerItems} live</h2>
              <div className="mt-5 grid gap-3">
                {activityLoading ? (
                  <p className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
                    Loading shop items...
                  </p>
                ) : activity.sellerItems.length === 0 ? (
                  <p className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                    Ready-made shop items will appear here with stock and live status.
                  </p>
                ) : (
                  activity.sellerItems.slice(0, 4).map((item) => (
                    <Link key={item.id} href={itemDetailRoute(item.id)} className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusChip status={item.stock_status} fallback="Stock" />
                            <StatusChip status={item.is_live ? 'LIVE' : 'DRAFT'} />
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-ink">{formatMoney(item.price_amount, item.currency)}</p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer account</p>
                <h2 className="mt-2 text-2xl font-semibold text-ink">Orders and fit travel together</h2>
              </div>
              <p className="text-sm leading-6 text-ink/62">{customerOrders.length} customer-side orders</p>
            </div>
            <div className="mt-5 grid gap-3">
              {activityLoading ? (
                <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
                  Loading customer orders...
                </div>
              ) : customerOrders.length === 0 ? (
                <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                  No customer orders yet. Once you place a custom order or start ready-made checkout, the status appears here.
                </div>
              ) : (
                customerOrders.slice(0, 4).map((order) => {
                  const latestUpdate = latestStageUpdateFor(order.id, activity.stageUpdates)
                  return (
                    <Link key={order.id} href={orderDetailRoute(order.id)} className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                            {cleanLabel(order.order_kind, 'Custom order')}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/62">
                            <span>{orderCounterparty(order, userId)}</span>
                            <StatusChip status={order.stage} fallback="In progress" />
                          </div>
                          <p className="mt-2 text-sm leading-6 text-ink/58">
                            {safeUserText(latestUpdate?.note, 'The next timeline update will appear here.')}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-semibold text-ink">{orderAmount(order)}</p>
                          <p className="mt-1 text-xs text-ink/50">{formatRelative(order.updated_at ?? order.created_at)}</p>
                        </div>
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Measurement profiles</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">{measurementCount} records</h2>
              <div className="mt-5 grid gap-3">
                {activityLoading ? (
                  <p className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
                    Loading measurements...
                  </p>
                ) : activity.measurementProfiles.length === 0 && activity.measurementScans.length === 0 ? (
                  <p className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                    Add manual measurements on web, or use Drapeon Vision in the app. Saved profile age and source appear here.
                  </p>
                ) : (
                  <>
                    {activity.measurementProfiles.slice(0, 3).map((profile) => (
                      <Link key={profile.id} href="/account/measurements" className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-semibold text-ink">{safeUserText(profile.label, 'Measurement profile')}</h3>
                            <p className="mt-1 text-sm text-ink/60">
                              {cleanLabel(profile.relationship, 'Wearer')} · {cleanLabel(profile.source, 'Manual')}
                            </p>
                          </div>
                          <p className="text-xs font-semibold text-needle">{profile.is_default ? 'Default' : profile.unit_preference}</p>
                        </div>
                      </Link>
                    ))}
                    {activity.measurementScans.slice(0, 2).map((scan) => (
                      <Link key={scan.id} href="/account/measurements" className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                        <h3 className="font-semibold text-ink">Drapeon Vision scan</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/60">
                          <StatusChip status={scan.status} fallback="Captured" />
                          <span>{cleanLabel(scan.confidence_overall, 'Confidence pending')}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelative(scan.created_at)}</span>
                        </div>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Wishlist</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">{activity.wishlistCollections.length} collections</h2>
              <div className="mt-5 grid gap-3">
                {activityLoading ? (
                  <p className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
                    Loading saved items...
                  </p>
                ) : activity.wishlistCollections.length === 0 ? (
                  <p className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                    Saved tailors and ready-made items will appear here.
                  </p>
                ) : (
                  activity.wishlistCollections.slice(0, 4).map((collection) => (
                    <Link key={collection.id} href="/account/saved" className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-ink">{safeUserText(collection.name, 'Wishlist')}</h3>
                          <p className="mt-1 text-sm text-ink/60">{formatRelative(collection.updated_at)}</p>
                        </div>
                        <p className="text-sm font-semibold text-ink">{collection.item_count ?? 0} items</p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Messages</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Order conversations</h2>
          </div>
          <p className="text-sm leading-6 text-ink/62">
            {latestMessage ? `Latest ${formatRelative(latestMessage.created_at)}` : 'No recent thread activity'}
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {activityLoading ? (
            <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
              Loading messages...
            </div>
          ) : activity.messages.length === 0 ? (
            <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62 md:col-span-2">
              Messages unlock around orders. When you or a tailor sends a note, call request, voice note, or photo update, the thread appears here.
            </div>
          ) : (
            activity.messages.slice(0, 4).map((message) => {
              const order = activity.orders.find((entry) => entry.id === message.order_id)
              const sentByUser = message.sender_id === userId
              return (
                <Link key={message.id} href={order ? orderDetailRoute(order.id) : '/account/messages'} className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                    {sentByUser ? 'You sent' : 'Received'} · {cleanLabel(message.type, 'Message')}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">{order ? orderTitle(order) : 'Order thread'}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/62">
                    {safeUserText(message.body, message.photo_url || message.voice_url ? 'Media message attached.' : 'Message activity recorded.')}
                  </p>
                  <p className="mt-3 text-xs text-ink/48">{formatRelative(message.created_at)}</p>
                </Link>
              )
            })
          )}
        </div>
      </div>

      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">App history</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Recent orders</h2>
          </div>
          <p className="text-sm leading-6 text-ink/62">Current status, payment state, and next steps.</p>
        </div>
        <div className="mt-5 grid gap-3">
          {activityLoading ? (
            <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
              Loading your orders...
            </div>
          ) : activity.orders.length === 0 ? (
            <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
              No orders yet. When you place, receive, or start an order, it will appear here.
            </div>
          ) : (
            activity.orders.slice(0, 6).map((order) => {
              const side = order.customer_id === userId ? 'Customer order' : 'Tailor order'
              return (
                <Link key={order.id} href={orderDetailRoute(order.id)} className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">{side}</p>
                      <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/62">
                        <span>{orderCounterparty(order, userId)}</span>
                        <StatusChip status={order.stage} fallback="In progress" />
                        {order.delivery_method ? <span>{cleanLabel(order.delivery_method, 'Fulfillment')}</span> : null}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold text-ink">{orderAmount(order)}</p>
                      <p className="mt-1 text-xs text-ink/50">{formatDate(order.created_at) ?? order.reference ?? 'Recent'}</p>
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>

      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Money</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Recent payments</h2>
          </div>
          <p className="text-sm leading-6 text-ink/62">Read-only web view for checkout and refund records.</p>
        </div>
        <div className="mt-5 grid gap-3">
          {activityLoading ? (
            <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
              Loading payment history...
            </div>
          ) : activity.payments.length === 0 ? (
            <div className="rounded-[8px] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
              No payment records yet. Successful checkouts and refunds will appear here.
            </div>
          ) : (
            activity.payments.slice(0, 6).map((payment) => (
              <Link key={payment.id} href={orderDetailRoute(payment.order_id)} className="block rounded-[8px] border border-ink/6 bg-white p-4 shadow-sm transition hover:border-needle/24 hover:bg-white">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{formatOrderPaymentPhase(payment.phase)}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/62">
                      <StatusChip status={payment.status} fallback="Pending" />
                      <span>{cleanLabel(payment.provider, 'Provider')}</span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold text-ink">{formatMoney(payment.amount, payment.currency)}</p>
                    <p className="mt-1 text-xs text-ink/50">{formatDate(payment.confirmed_at ?? payment.refunded_at ?? payment.created_at) ?? 'Recent'}</p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      <section className="rounded-[8px] border border-ink/6 bg-white/86 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Account access</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">
              {workspaceRole === 'TAILOR' ? 'Tailor workspace active.' : 'Customer account active.'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/62">
              {workspaceRole === 'TAILOR'
                ? 'Manage work, shop, earnings, payouts, and customer order context.'
                : 'Browse, order, track, message, confirm handoff, and manage fit.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            {workspaceRole === 'CUSTOMER' ? (
              <Link href="/account/orders" className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone">
                Review orders
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void setRole('CUSTOMER')
                }}
                disabled={savingRole === 'CUSTOMER'}
                className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:text-ink/40"
              >
                {savingRole === 'CUSTOMER' ? 'Switching...' : 'Use customer account'}
              </button>
            )}
            {hasTailorProfile ? (
              workspaceRole === 'TAILOR' ? (
                <Link href="/account/work" className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-needle px-4 py-2 text-sm font-semibold text-white transition hover:bg-needle-600">
                  Open work queue
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void setRole('TAILOR')
                  }}
                  disabled={savingRole === 'TAILOR'}
                  className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-needle px-4 py-2 text-sm font-semibold text-white transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
                >
                  {savingRole === 'TAILOR' ? 'Switching...' : 'Use tailor workspace'}
                </button>
              )
            ) : (
              <Link href="/apply?source=account" className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-needle px-4 py-2 text-sm font-semibold text-white transition hover:bg-needle-600">
                Apply as a tailor
              </Link>
            )}
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-ink/6 bg-bone/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">Current role</p>
            <p className="mt-2 text-sm font-semibold text-ink">{workspaceRole === 'TAILOR' ? 'Tailor' : 'Customer'}</p>
          </div>
          <div className="rounded-lg border border-ink/6 bg-bone/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">Tailor access</p>
            <p className="mt-2 text-sm font-semibold text-ink">{hasTailorProfile ? 'Profile found' : 'Not set up'}</p>
          </div>
          <div className="rounded-lg border border-ink/6 bg-bone/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">Native tools</p>
            <div className="mt-2">
              <OpenAppButton label="Open app" className="inline-flex rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-bone" />
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-5 text-sm text-ink/66 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-4">
          <Link href="/account/recovery" className="font-semibold text-needle">Recovery</Link>
          <Link href="/account-deletion" className="font-semibold text-needle">Account deletion</Link>
          <Link href="/help" className="font-semibold text-needle">Help</Link>
        </div>
        <button
          type="button"
          onClick={() => {
            void signOut()
          }}
          className="font-semibold text-ink"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
