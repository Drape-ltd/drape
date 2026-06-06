'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '../lib/supabase'

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
  content: string | null
  media_url: string | null
  blocked: boolean | null
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
  fit_style: string | null
  updated_at: string | null
}
type TailorProfileSummary = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
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
  href: string
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
  if (!value) return fallback
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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
  return order.item_title || order.garment_type || 'Order'
}

function orderAmount(order: DashboardOrder) {
  return formatMoney(order.total_amount ?? order.quoted_amount, order.currency ?? order.quoted_currency)
}

function orderCounterparty(order: DashboardOrder, userId: string) {
  if (order.customer_id === userId) {
    return firstJoinedRow(order.tailor_profiles)?.display_name || 'Tailor'
  }
  return firstJoinedRow(order.customer_profiles)?.display_name || 'Customer'
}

function profileName(activity: AccountActivity, fallback: string) {
  return (
    activity.customerProfile?.display_name ||
    activity.tailorProfile?.business_name ||
    activity.tailorProfile?.display_name ||
    fallback
  )
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
        title: 'Finish tailor setup in the app.',
        body: 'Add your profile, verification details, payout setup, shop, and portfolio before customers can trust the work.',
        cta: 'Open tailor setup',
        href: 'drape://',
      }
    }
    if (!activity.tailorProfile.profile_completed) {
      return {
        eyebrow: 'Profile',
        title: 'Complete your tailor profile.',
        body: 'A complete profile gives customers the context they need before sending a brief.',
        cta: 'Continue setup',
        href: 'drape://',
      }
    }
    if (!activity.tailorProfile.payout_account_verified || activity.tailorProfile.payout_reverification_required) {
      return {
        eyebrow: 'Payouts',
        title: 'Check payout readiness.',
        body: 'Keep payout details current before production work starts moving through escrow.',
        cta: 'Open payouts',
        href: 'drape://',
      }
    }
    if (activity.sellerItems.length === 0) {
      return {
        eyebrow: 'Shop',
        title: 'Add your first ready-made piece.',
        body: 'Ready-made items help customers understand your taste and buy without a custom brief.',
        cta: 'Add shop item',
        href: 'drape://',
      }
    }
    if (tailorOrders.length === 0) {
      return {
        eyebrow: 'Discovery',
        title: 'Share your profile to get your first order.',
        body: 'Once orders arrive, this web dashboard becomes your read-only command center for work, messages, and money.',
        cta: 'Open profile',
        href: 'drape://',
      }
    }
    return {
      eyebrow: 'Today',
      title: 'Review active work in the app.',
      body: 'Production photos, proof uploads, consultation calls, and stage actions stay in the app for launch.',
      cta: 'Open work queue',
      href: 'drape://',
    }
  }

  if (!activity.customerProfile) {
    return {
      eyebrow: 'Setup',
      title: 'Finish your customer profile.',
      body: 'Add fit preferences and basic profile details before placing your first order.',
      cta: 'Open profile',
      href: 'drape://',
    }
  }
  if (measurementCount === 0) {
    return {
      eyebrow: 'Fit',
      title: 'Add measurements before ordering.',
      body: 'Use Drape Vision on iOS or manual measurements so tailors have the right fit context.',
      cta: 'Add measurements',
      href: 'drape://',
    }
  }
  if (customerOrders.length === 0) {
    return {
      eyebrow: 'Order',
      title: 'Find a tailor and start your first brief.',
      body: 'Explore tailors, save favorites, and place custom or ready-made orders in the mobile app.',
      cta: 'Open Explore',
      href: 'drape://',
    }
  }
  if (unreadMessages > 0) {
    return {
      eyebrow: 'Messages',
      title: 'You have order messages waiting.',
      body: 'Reply in the app so the order record stays protected on Drapeon.',
      cta: 'Open messages',
      href: 'drape://',
    }
  }
  return {
    eyebrow: 'Today',
    title: 'Review your orders in the app.',
    body: 'Checkout, calls, proof photos, handoff confirmation, and support actions stay in the app for launch.',
    cta: 'Open orders',
    href: 'drape://',
  }
}

async function fetchAccountActivity(userId: string): Promise<AccountActivity> {
  const supabase = createClient()
  const [
    customerProfileRes,
    tailorProfileRes,
    ordersRes,
    measurementProfilesRes,
    measurementScansRes,
    wishlistCollectionsRes,
  ] = await Promise.all([
    supabase
      .from('customer_profiles')
      .select('user_id, display_name, avatar_url, measurements, unit_preference, fit_style, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select('id, user_id, display_name, business_name, availability, is_live, is_verified, profile_completed, total_orders, avg_rating, currency, payout_account_verified, payout_reverification_required')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('orders')
      .select(`
        id, reference, order_kind, garment_type, item_title, item_size, stage, delivery_method,
        quoted_amount, total_amount, currency, quoted_currency, created_at, updated_at, quoted_completion_date,
        customer_id, tailor_id,
        tailor_profiles!tailor_profile_id(display_name),
        customer_profiles!customer_id(display_name)
      `)
      .or(`customer_id.eq.${userId},tailor_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(12),
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

  let warning: string | null = null
  if (
    customerProfileRes.error ||
    tailorProfileRes.error ||
    ordersRes.error ||
    measurementProfilesRes.error ||
    measurementScansRes.error ||
    wishlistCollectionsRes.error
  ) {
    warning = 'Some account history could not load. Refresh in a moment; your app data is still safe.'
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
        .select('id, order_id, sender_id, type, content, media_url, blocked, read_at, created_at')
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
      warning = 'Some order activity could not load. Refresh in a moment; your app data is still safe.'
    } else {
      payments = (paymentsRes.data ?? []) as DashboardPayment[]
      messages = (messagesRes.data ?? []) as DashboardMessage[]
      stageUpdates = (stageUpdatesRes.data ?? []) as DashboardStageUpdate[]
    }
  }

  let sellerItems: SellerItemSummary[] = []
  const tailorProfile = tailorProfileRes.error ? null : ((tailorProfileRes.data ?? null) as TailorProfileSummary | null)
  if (tailorProfile?.id) {
    const { data, error } = await supabase
      .from('seller_items')
      .select('id, title, price_amount, currency, stock_status, is_live, updated_at')
      .eq('tailor_profile_id', tailorProfile.id)
      .order('updated_at', { ascending: false })
      .limit(8)

    if (error) {
      warning = 'Some shop history could not load. Refresh in a moment; your app data is still safe.'
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
  const router = useRouter()
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
    fetchAccountActivity(session.user.id)
      .then((nextActivity) => {
        if (!active) return
        setActivity(nextActivity)
      })
      .catch(() => {
        if (!active) return
        setActivity({
          ...emptyActivity,
          userId: session.user.id,
          warning: 'Account history could not load. Refresh in a moment; your app data is still safe.',
        })
      })

    return () => {
      active = false
    }
  }, [session?.user.id])

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
    setSession(data.session)
    setSavingRole(null)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/sign-in')
  }

  if (loading) {
    return (
      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <p className="text-sm font-semibold text-ink/62">Loading account...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Account</p>
        <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Sign in to continue.</h1>
        <p className="mt-4 text-sm leading-7 text-ink/66">
          Use your Drapeon account to open the right app workspace.
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
  const email = session.user.email ?? 'Signed in account'
  const userId = session.user.id
  const activityLoading = activity.userId !== userId
  const activeOrders = activity.orders.filter((order) => {
    const stage = order.stage ?? ''
    return !['COMPLETE', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(stage)
  })
  const completedOrders = activity.orders.length - activeOrders.length
  const displayName = profileName(activity, email)
  const customerOrders = activity.orders.filter((order) => order.customer_id === userId)
  const tailorOrders = activity.orders.filter((order) => order.tailor_id === userId)
  const latestMessage = activity.messages[0] ?? null
  const unreadMessages = activity.messages.filter((message) => message.sender_id !== userId && !message.read_at).length
  const liveSellerItems = activity.sellerItems.filter((item) => item.is_live).length
  const measurementCount =
    activity.measurementProfiles.length + activity.measurementScans.length + (hasMeasurements(activity.customerProfile) ? 1 : 0)
  const nextAction = buildNextAction({
    role,
    activity,
    customerOrders,
    tailorOrders,
    measurementCount,
    unreadMessages,
  })

  return (
    <div className="grid gap-5">
      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Drapeon account</p>
            <h1 className="mt-3 break-words text-4xl text-ink sm:text-5xl">{displayName}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-ink/66">
              You are signed in as <span className="font-semibold text-ink">{email}</span>. This web workspace reads the
              same account, order, fit, message, shop, and money records used by the mobile app.
            </p>
          </div>
          <div className="rounded-[1.2rem] border border-ink/6 bg-bone/70 p-4 lg:min-w-64">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Viewing</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {role === 'TAILOR' ? 'Tailor workspace' : role === 'CUSTOMER' ? 'Customer workspace' : 'Choose a mode'}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink/62">
              {role === 'TAILOR'
                ? 'Orders, shop, client context, and payout readiness.'
                : 'Orders, fit, wishlist, messages, and payment history.'}
            </p>
          </div>
        </div>
        {error ? (
          <div className="mt-5 rounded-[1rem] border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
            {error}
          </div>
        ) : null}
        {activity.warning ? (
          <div className="mt-5 rounded-[1rem] border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
            {activity.warning}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[1.35rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Orders</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{activityLoading ? '...' : activity.orders.length}</p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {activeOrders.length} active, {completedOrders} completed
          </p>
        </div>
        <div className="rounded-[1.35rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Messages</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{activityLoading ? '...' : activity.messages.length}</p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {unreadMessages > 0 ? `${unreadMessages} unread` : 'Threads are caught up'}
          </p>
        </div>
        <div className="rounded-[1.35rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{role === 'TAILOR' ? 'Shop' : 'Fit'}</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{activityLoading ? '...' : role === 'TAILOR' ? liveSellerItems : measurementCount}</p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {role === 'TAILOR' ? `${activity.sellerItems.length} ready-made records` : 'Measurement records on file'}
          </p>
        </div>
      </div>

      <div className="rounded-[1.6rem] border border-needle/14 bg-needle/8 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.05)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{nextAction.eyebrow}</p>
            <h2 className="mt-2 text-3xl text-ink">{nextAction.title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/66">{nextAction.body}</p>
          </div>
          <a
            href={nextAction.href}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)]"
          >
            {nextAction.cta}
          </a>
        </div>
      </div>

      {role === 'TAILOR' ? (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor cockpit</p>
                <h2 className="mt-2 text-3xl text-ink">Your work queue</h2>
              </div>
              <p className="text-sm leading-6 text-ink/62">{tailorOrders.length} tailor-side orders</p>
            </div>
            <div className="mt-5 grid gap-3">
              {tailorOrders.length === 0 ? (
                <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                  No tailor orders yet. New briefs, ready-made orders, consultations, and production work will appear here.
                </div>
              ) : (
                tailorOrders.slice(0, 4).map((order) => {
                  const latestUpdate = latestStageUpdateFor(order.id, activity.stageUpdates)
                  return (
                    <div key={order.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                            {cleanLabel(order.order_kind, 'Custom order')}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
                          <p className="mt-1 text-sm leading-6 text-ink/62">
                            {orderCounterparty(order, userId)} · {cleanLabel(order.stage, 'In progress')}
                          </p>
                          {latestUpdate?.note ? (
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/58">{latestUpdate.note}</p>
                          ) : null}
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-semibold text-ink">{orderAmount(order)}</p>
                          <p className="mt-1 text-xs text-ink/50">{formatRelative(order.updated_at ?? order.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Profile readiness</p>
              <h2 className="mt-2 text-3xl text-ink">
                {activity.tailorProfile?.business_name || activity.tailorProfile?.display_name || 'Tailor profile'}
              </h2>
              <div className="mt-5 grid gap-2 text-sm leading-6 text-ink/66">
                <p>Profile: <span className="font-semibold text-ink">{activity.tailorProfile?.profile_completed ? 'Complete' : 'Setup in progress'}</span></p>
                <p>Verification: <span className="font-semibold text-ink">{activity.tailorProfile?.is_verified ? 'Verified' : 'Not verified yet'}</span></p>
                <p>Availability: <span className="font-semibold text-ink">{cleanLabel(activity.tailorProfile?.availability, 'Not set')}</span></p>
                <p>Payout: <span className="font-semibold text-ink">{activity.tailorProfile?.payout_account_verified ? 'Ready' : 'Needs setup'}</span></p>
              </div>
            </div>
            <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Ready-made shop</p>
              <h2 className="mt-2 text-3xl text-ink">{liveSellerItems} live</h2>
              <div className="mt-5 grid gap-3">
                {activity.sellerItems.length === 0 ? (
                  <p className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                    Shop items added in the app will appear here with stock and live status.
                  </p>
                ) : (
                  activity.sellerItems.slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-ink">{item.title || 'Ready-made item'}</h3>
                          <p className="mt-1 text-sm text-ink/60">{cleanLabel(item.stock_status, 'Stock')} · {item.is_live ? 'Live' : 'Draft'}</p>
                        </div>
                        <p className="text-sm font-semibold text-ink">{formatMoney(item.price_amount, item.currency)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer workspace</p>
                <h2 className="mt-2 text-3xl text-ink">Orders and fit travel together</h2>
              </div>
              <p className="text-sm leading-6 text-ink/62">{customerOrders.length} customer-side orders</p>
            </div>
            <div className="mt-5 grid gap-3">
              {customerOrders.length === 0 ? (
                <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                  No customer orders yet. Once you place a custom or ready-made order in the app, web will show the same status here.
                </div>
              ) : (
                customerOrders.slice(0, 4).map((order) => {
                  const latestUpdate = latestStageUpdateFor(order.id, activity.stageUpdates)
                  return (
                    <div key={order.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                            {cleanLabel(order.order_kind, 'Custom order')}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
                          <p className="mt-1 text-sm leading-6 text-ink/62">
                            {orderCounterparty(order, userId)} · {cleanLabel(order.stage, 'In progress')}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-ink/58">
                            {latestUpdate?.note || 'The next timeline update from the app will appear here.'}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-semibold text-ink">{orderAmount(order)}</p>
                          <p className="mt-1 text-xs text-ink/50">{formatRelative(order.updated_at ?? order.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Measurement profiles</p>
              <h2 className="mt-2 text-3xl text-ink">{measurementCount} records</h2>
              <div className="mt-5 grid gap-3">
                {activity.measurementProfiles.length === 0 && activity.measurementScans.length === 0 ? (
                  <p className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                    Add measurements in the app with Drape Vision or manual entry. Web will show the profile age and source here.
                  </p>
                ) : (
                  <>
                    {activity.measurementProfiles.slice(0, 3).map((profile) => (
                      <div key={profile.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-semibold text-ink">{profile.label || 'Measurement profile'}</h3>
                            <p className="mt-1 text-sm text-ink/60">
                              {cleanLabel(profile.relationship, 'Wearer')} · {cleanLabel(profile.source, 'Manual')}
                            </p>
                          </div>
                          <p className="text-xs font-semibold text-needle">{profile.is_default ? 'Default' : profile.unit_preference}</p>
                        </div>
                      </div>
                    ))}
                    {activity.measurementScans.slice(0, 2).map((scan) => (
                      <div key={scan.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                        <h3 className="font-semibold text-ink">Drape Vision scan</h3>
                        <p className="mt-1 text-sm text-ink/60">
                          {cleanLabel(scan.status, 'Captured')} · {cleanLabel(scan.confidence_overall, 'Confidence pending')} · {formatRelative(scan.created_at)}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Wishlist</p>
              <h2 className="mt-2 text-3xl text-ink">{activity.wishlistCollections.length} collections</h2>
              <div className="mt-5 grid gap-3">
                {activity.wishlistCollections.length === 0 ? (
                  <p className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
                    Saved tailors and ready-made items from the app will appear here.
                  </p>
                ) : (
                  activity.wishlistCollections.slice(0, 4).map((collection) => (
                    <div key={collection.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-ink">{collection.name || 'Wishlist'}</h3>
                          <p className="mt-1 text-sm text-ink/60">{formatRelative(collection.updated_at)}</p>
                        </div>
                        <p className="text-sm font-semibold text-ink">{collection.item_count ?? 0} items</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Messages</p>
            <h2 className="mt-2 text-3xl text-ink">Order conversations</h2>
          </div>
          <p className="text-sm leading-6 text-ink/62">
            {latestMessage ? `Latest ${formatRelative(latestMessage.created_at)}` : 'Same threads as the app'}
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {activityLoading ? (
            <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
              Loading messages...
            </div>
          ) : activity.messages.length === 0 ? (
            <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62 md:col-span-2">
              Messages unlock around orders. When you or a tailor sends a note, call request, voice note, or photo update, the thread appears here.
            </div>
          ) : (
            activity.messages.slice(0, 4).map((message) => {
              const order = activity.orders.find((entry) => entry.id === message.order_id)
              const sentByUser = message.sender_id === userId
              return (
                <div key={message.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                    {sentByUser ? 'You sent' : 'Received'} · {cleanLabel(message.type, 'Message')}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">{order ? orderTitle(order) : 'Order thread'}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/62">
                    {message.blocked
                      ? 'A message was blocked to keep the order protected on Drapeon.'
                      : message.content || (message.media_url ? 'Media message attached.' : 'Message activity recorded.')}
                  </p>
                  <p className="mt-3 text-xs text-ink/48">{formatRelative(message.created_at)}</p>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">App history</p>
            <h2 className="mt-2 text-3xl text-ink">Recent orders</h2>
          </div>
          <p className="text-sm leading-6 text-ink/62">The same order records your mobile app uses.</p>
        </div>
        <div className="mt-5 grid gap-3">
          {activityLoading ? (
            <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
              Loading your orders...
            </div>
          ) : activity.orders.length === 0 ? (
            <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
              No orders yet. When you place or receive an order in the app, it will appear here.
            </div>
          ) : (
            activity.orders.slice(0, 6).map((order) => {
              const side = order.customer_id === userId ? 'Customer order' : 'Tailor order'
              return (
                <div key={order.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">{side}</p>
                      <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
                      <p className="mt-1 text-sm leading-6 text-ink/62">
                        {orderCounterparty(order, userId)} · {cleanLabel(order.stage, 'In progress')}
                        {order.delivery_method ? ` · ${cleanLabel(order.delivery_method, 'Fulfillment')}` : ''}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold text-ink">{orderAmount(order)}</p>
                      <p className="mt-1 text-xs text-ink/50">{formatDate(order.created_at) ?? order.reference ?? 'Recent'}</p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Money</p>
            <h2 className="mt-2 text-3xl text-ink">Recent payments</h2>
          </div>
          <p className="text-sm leading-6 text-ink/62">Read-only web view for checkout and refund records.</p>
        </div>
        <div className="mt-5 grid gap-3">
          {activityLoading ? (
            <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm font-semibold text-ink/62">
              Loading payment history...
            </div>
          ) : activity.payments.length === 0 ? (
            <div className="rounded-[1.15rem] border border-ink/6 bg-bone/60 p-4 text-sm leading-6 text-ink/62">
              No payment records yet. Successful app checkouts and refunds will appear here.
            </div>
          ) : (
            activity.payments.slice(0, 6).map((payment) => (
              <div key={payment.id} className="rounded-[1.15rem] border border-ink/6 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{cleanLabel(payment.phase, 'Order payment')}</h3>
                    <p className="mt-1 text-sm leading-6 text-ink/62">
                      {cleanLabel(payment.status, 'Pending')} · {cleanLabel(payment.provider, 'Provider')}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold text-ink">{formatMoney(payment.amount, payment.currency)}</p>
                    <p className="mt-1 text-xs text-ink/50">{formatDate(payment.confirmed_at ?? payment.refunded_at ?? payment.created_at) ?? 'Recent'}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {[
          ['CUSTOMER', 'Customer mode', 'Browse, order, track, message, confirm handoff, and manage fit.'],
          ['TAILOR', 'Tailor mode', 'Manage briefs, consultations, shop, production, proof, earnings, and payouts.'],
        ].map(([value, title, body]) => {
          const mode = value as DrapeRole
          const active = role === mode
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                void setRole(mode)
              }}
              className={
                active
                  ? 'rounded-[1.5rem] border border-needle/20 bg-needle/8 p-6 text-left shadow-sm'
                  : 'rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]'
              }
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
                {active ? 'Active' : savingRole === mode ? 'Saving' : 'Switch'}
              </p>
              <h2 className="mt-4 text-2xl text-ink">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
            </button>
          )
        })}

        <div className="rounded-[1.5rem] border border-ink/6 bg-ink p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Open app</p>
          <h2 className="mt-4 text-2xl text-white">Continue in Drapeon.</h2>
          <p className="mt-3 text-sm leading-7 text-white/68">
            The app is where camera, payment, push, order, and proof flows run.
          </p>
          <a href="drape://" className="mt-5 inline-flex rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink">
            Open app
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 text-sm text-ink/66 sm:flex-row sm:items-center sm:justify-between">
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
