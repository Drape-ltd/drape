'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '../../lib/supabase'
import { useSessionTimeout } from '../../hooks/use-session-timeout'
import { WEB_ACCOUNT_CACHE_INVALIDATE_EVENT } from '../../lib/web-account-cache-events'
import { AccountWorkspaceShell } from './account-workspace-shell'
import type { AccountSurface } from './surface-contract'

export type AccountRouteIdentity = {
  role: 'CUSTOMER' | 'TAILOR'
  email: string
  displayName: string
  avatarUrl: string | null
  activeOrders: number
  unreadMessages: number
  checkoutPendingCount: number
  payoutNeedsSetup: boolean
}

type RuntimeState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'ready'; session: Session; identity: AccountRouteIdentity }
  | { status: 'error'; message: string }

const terminalStages = new Set(['COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REFUNDED'])
const identityCache = new Map<string, { value: AccountRouteIdentity; expiresAt: number }>()
const identityRequests = new Map<string, Promise<AccountRouteIdentity>>()
const IDENTITY_CACHE_TTL_MS = 45_000

function payoutNeedsSetup(profile: Record<string, unknown> | null) {
  if (!profile || profile.payout_reverification_required === true) return Boolean(profile)
  if (profile.payout_account_verified === true) return false
  const manualStatus = String(profile.manual_bank_verification_status ?? '').toUpperCase()
  return !(
    profile.paystack_recipient_code || profile.stripe_connect_account_id || profile.paystack_account_id ||
    profile.stripe_account_id || (profile.manual_bank_entry === true && ['VERIFIED', 'APPROVED'].includes(manualStatus))
  )
}

async function loadIdentity(session: Session): Promise<AccountRouteIdentity> {
  const userId = session.user.id
  const supabase = createClient()
  const [customerResult, tailorResult] = await Promise.all([
    supabase.from('customer_profiles').select('display_name, avatar_url').eq('user_id', userId).maybeSingle(),
    supabase.from('tailor_profiles').select('id, display_name, business_name, avatar_url').eq('user_id', userId).maybeSingle(),
  ])
  if (customerResult.error && tailorResult.error) throw new Error('Your account workspace could not load.')

  const customer = customerResult.data as { display_name?: string | null; avatar_url?: string | null } | null
  let tailor = tailorResult.data as (Record<string, unknown> & { id: string; display_name?: string | null; business_name?: string | null; avatar_url?: string | null }) | null
  if (tailor?.id) {
    const payoutResult = await supabase.from('tailor_profiles').select('payout_reverification_required, payout_account_verified, manual_bank_entry, manual_bank_verification_status, paystack_recipient_code, stripe_connect_account_id, paystack_account_id, stripe_account_id').eq('user_id', userId).maybeSingle()
    if (!payoutResult.error && payoutResult.data) tailor = { ...tailor, ...payoutResult.data }
  }
  const orderFilter = tailor?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailor.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`
  const ordersResult = await supabase.from('orders').select('id, stage, order_kind, seller_item_id, customer_id, tailor_id, tailor_profile_id').or(orderFilter).order('created_at', { ascending: false }).limit(40)
  const orders = (ordersResult.data ?? []) as Array<{ id: string; stage: string | null; order_kind: string | null; seller_item_id: string | null; customer_id: string | null; tailor_id: string | null; tailor_profile_id: string | null }>
  const active = orders.filter((order) => !terminalStages.has(order.stage ?? ''))
  const customerActive = active.filter((order) => order.customer_id === userId && !(order.order_kind === 'READY_MADE' && order.seller_item_id == null))
  const tailorActive = active.filter((order) => order.tailor_id === userId || order.tailor_profile_id === tailor?.id)
  const checkoutPendingCount = orders.filter((order) => ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')).length
  let unreadMessages = 0
  if (orders.length > 0) {
    const messagesResult = await supabase.from('messages').select('sender_id, read_at').in('order_id', orders.map((order) => order.id)).order('created_at', { ascending: false }).limit(100)
    unreadMessages = ((messagesResult.data ?? []) as Array<{ sender_id: string | null; read_at: string | null }>).filter((message) => message.sender_id !== userId && !message.read_at).length
  }
  const metadataName = typeof session.user.user_metadata?.display_name === 'string' ? session.user.user_metadata.display_name.trim() : ''
  const email = session.user.email ?? ''
  const displayName = String(tailor?.business_name || tailor?.display_name || customer?.display_name || metadataName || email.split('@')[0] || 'Drapeon')
  return {
    role: tailor ? 'TAILOR' : 'CUSTOMER', email, displayName,
    avatarUrl: String(tailor?.avatar_url || customer?.avatar_url || '') || null,
    activeOrders: tailor ? tailorActive.length : customerActive.length,
    unreadMessages, checkoutPendingCount,
    payoutNeedsSetup: payoutNeedsSetup(tailor),
  }
}

function loadIdentityCached(session: Session) {
  const userId = session.user.id
  const cached = identityCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  const pending = identityRequests.get(userId)
  if (pending) return pending
  const request = loadIdentity(session)
    .then((value) => {
      identityCache.set(userId, { value, expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS })
      return value
    })
    .finally(() => identityRequests.delete(userId))
  identityRequests.set(userId, request)
  return request
}

function SignedOut() {
  const pathname = usePathname()
  return <main className="min-h-screen bg-ui-canvas"><div className="mx-auto max-w-xl px-5 py-20"><div className="app-surface p-7"><p className="text-xs font-semibold uppercase text-needle/80">Account</p><h1 className="mt-3 text-4xl text-ink">Sign in to continue.</h1><p className="mt-4 text-sm leading-7 text-ink/66">Access your protected orders, messages, measurements, payments, and saved work.</p><Link href={`/sign-in?next=${encodeURIComponent(pathname || '/account')}`} className="mt-6 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white">Sign in</Link></div></div></main>
}

export function AccountRouteRuntime({ surface, children }: { surface: AccountSurface; children: (context: { session: Session; identity: AccountRouteIdentity }) => ReactNode }) {
  const [state, setState] = useState<RuntimeState>({ status: 'loading' })
  const userId = state.status === 'ready' ? state.session.user.id : null
  useSessionTimeout({ enabled: Boolean(userId) })

  useEffect(() => {
    const supabase = createClient()
    let active = true
    async function acceptSession(session: Session | null) {
      if (!active) return
      if (!session) { setState({ status: 'signed-out' }); return }
      setState({ status: 'loading' })
      try {
        const identity = await loadIdentityCached(session)
        if (active) setState({ status: 'ready', session, identity })
      } catch (error) {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Your account workspace could not load.' })
      }
    }
    void supabase.auth.getSession().then(({ data }) => acceptSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { void acceptSession(session) })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const invalidate = () => { identityCache.clear(); identityRequests.clear() }
    window.addEventListener(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, invalidate)
    return () => window.removeEventListener(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, invalidate)
  }, [])

  if (state.status === 'loading') return <main className="grid min-h-screen place-items-center bg-ui-canvas"><p className="text-sm font-semibold text-ink/60">Loading your workspace…</p></main>
  if (state.status === 'signed-out') return <SignedOut />
  if (state.status === 'error') return <main className="grid min-h-screen place-items-center bg-ui-canvas"><div className="app-surface max-w-md p-7"><h1 className="text-2xl font-semibold text-ink">Workspace unavailable</h1><p className="mt-3 text-sm leading-6 text-ink/64">{state.message} Refresh to retry.</p></div></main>
  return <AccountWorkspaceShell {...state.identity} surface={surface}>{children({ session: state.session, identity: state.identity })}</AccountWorkspaceShell>
}
