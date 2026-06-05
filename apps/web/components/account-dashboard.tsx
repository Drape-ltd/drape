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
type CustomerProfileSummary = {
  user_id: string
  unit_preference: string | null
  fit_style: string | null
  updated_at: string | null
}
type TailorProfileSummary = {
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
type AccountActivity = {
  userId: string | null
  orders: DashboardOrder[]
  payments: DashboardPayment[]
  customerProfile: CustomerProfileSummary | null
  tailorProfile: TailorProfileSummary | null
  warning: string | null
}

const emptyActivity: AccountActivity = {
  userId: null,
  orders: [],
  payments: [],
  customerProfile: null,
  tailorProfile: null,
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

async function fetchAccountActivity(userId: string): Promise<AccountActivity> {
  const supabase = createClient()
  const [customerProfileRes, tailorProfileRes, ordersRes] = await Promise.all([
    supabase
      .from('customer_profiles')
      .select('user_id, unit_preference, fit_style, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select('user_id, display_name, business_name, availability, is_live, is_verified, profile_completed, total_orders, avg_rating, currency, payout_account_verified, payout_reverification_required')
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
  ])

  let warning: string | null = null
  if (customerProfileRes.error || tailorProfileRes.error || ordersRes.error) {
    warning = 'Some account history could not load. Refresh in a moment; your app data is still safe.'
  }

  const orders = ordersRes.error ? [] : ((ordersRes.data ?? []) as DashboardOrder[])
  const orderIds = orders.map((order) => order.id)
  let payments: DashboardPayment[] = []
  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(12)
    if (error) {
      warning = 'Some payment history could not load. Refresh in a moment; your app data is still safe.'
    } else {
      payments = (data ?? []) as DashboardPayment[]
    }
  }

  return {
    userId,
    orders,
    payments,
    customerProfile: customerProfileRes.error ? null : ((customerProfileRes.data ?? null) as CustomerProfileSummary | null),
    tailorProfile: tailorProfileRes.error ? null : ((tailorProfileRes.data ?? null) as TailorProfileSummary | null),
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

  return (
    <div className="grid gap-5">
      <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Signed in</p>
        <h1 className="mt-3 break-words text-4xl text-ink sm:text-5xl">{email}</h1>
        <p className="mt-4 text-sm leading-7 text-ink/66">
          Current mode: <span className="font-semibold text-ink">{role === 'TAILOR' ? 'Tailor' : role === 'CUSTOMER' ? 'Customer' : 'Not selected'}</span>
        </p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Payments</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{activityLoading ? '...' : activity.payments.length}</p>
          <p className="mt-2 text-sm leading-6 text-ink/62">Recent checkout, refund, and escrow records.</p>
        </div>
        <div className="rounded-[1.35rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Profiles</p>
          <p className="mt-3 text-lg font-semibold text-ink">
            {activity.customerProfile ? 'Customer ready' : 'Customer setup open'}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {activity.tailorProfile?.profile_completed ? 'Tailor profile complete' : activity.tailorProfile ? 'Tailor setup in progress' : 'Tailor setup open'}
          </p>
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
