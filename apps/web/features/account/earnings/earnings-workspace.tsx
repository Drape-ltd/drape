'use client'

import Link from 'next/link'
import { Download, Search, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  derivePayoutDeliveryState,
  formatDate,
  formatDatabaseEnumLabel,
  formatMoney,
  formatPayoutPurpose,
  payoutDeliveryExplanation,
  payoutDeliveryLabel,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'

type Profile = {
  id: string
  currency: string | null
  payout_currency: string | null
  payout_account_verified: boolean | null
  payout_reverification_required: boolean | null
}
type Order = {
  id: string
  reference: string | null
  garment_type: string | null
  item_title: string | null
  garment_description: string | null
  stage: string | null
  subtotal_amount: number | null
  platform_fee_amount: number | null
  tax_amount: number | null
  total_amount: number | null
  currency: string | null
  customer_id: string | null
  escrow_released: boolean | null
  created_at: string | null
  updated_at: string | null
}
type Payout = {
  id: string
  amount: number | null
  currency: string | null
  provider: string | null
  status: string | null
  payout_purpose: string | null
  provider_transfer_status: string | null
  bank_settlement_status: string | null
  provider_bank_payout_id: string | null
  bank_settlement_expected_at: string | null
  blocked_reason: string | null
  order_id: string | null
  initiated_at: string | null
  completed_at: string | null
}
type BankEvent = {
  id: string
  provider: string | null
  provider_bank_payout_id: string | null
  amount: number | null
  currency: string | null
  status: string | null
  arrival_at: string | null
  failure_message: string | null
  created_at: string | null
}
type Loaded = {
  profile: Profile | null
  orders: Order[]
  payouts: Payout[]
  bank: BankEvent[]
  customers: Record<string, string>
  warning: string | null
}
type TxStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'RELEASED'
  | 'IN_TRANSIT'
  | 'PAID_OUT'
  | 'BLOCKED'
  | 'FAILED'
type Tx = { order: Order; status: TxStatus; reason: string | null; customer: string }
const terminalUnpaid = new Set([
  'DRAFT',
  'PENDING_QUOTE',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
  'DECLINED',
])
const orderSelect =
  'id, reference, garment_type, item_title, garment_description, stage, subtotal_amount, platform_fee_amount, tax_amount, total_amount, currency, customer_id, escrow_released, created_at, updated_at'
const payoutSelect =
  'id, amount, currency, provider, status, payout_purpose, provider_transfer_status, bank_settlement_status, provider_bank_payout_id, bank_settlement_expected_at, blocked_reason, order_id, initiated_at, completed_at'
function title(order: Order) {
  return (
    order.item_title?.trim() ||
    order.garment_type?.trim() ||
    order.garment_description?.trim() ||
    'Custom garment'
  )
}
function derive(order: Order, payouts: Payout[]): { status: TxStatus; reason: string | null } {
  const payout = payouts
    .filter((p) => p.order_id === order.id && p.payout_purpose === 'ORDER_EARNING')
    .sort(
      (a, b) => new Date(b.initiated_at || 0).getTime() - new Date(a.initiated_at || 0).getTime()
    )[0]
  if (payout) {
    const state = derivePayoutDeliveryState({
      provider: payout.provider,
      status: payout.status,
      providerTransferStatus: payout.provider_transfer_status,
      bankSettlementStatus: payout.bank_settlement_status,
    })
    if (state === 'PAID_TO_BANK') return { status: 'PAID_OUT', reason: null }
    if (state === 'IN_PROVIDER_BALANCE' || state === 'BANK_PAYOUT_PENDING')
      return { status: 'IN_TRANSIT', reason: payoutDeliveryExplanation(state, payout.provider) }
    if (payout.status === 'BLOCKED')
      return { status: 'BLOCKED', reason: 'This payout is paused for review.' }
    if (['FAILED', 'REVERSED', 'CANCELED'].includes(payout.status || ''))
      return { status: 'FAILED', reason: 'The provider transfer failed and needs review.' }
    if (payout.status === 'PROCESSING') return { status: 'RELEASED', reason: null }
  }
  const stage = (order.stage || '').toUpperCase()
  if (stage === 'REFUNDED') return { status: 'FAILED', reason: 'Order refunded.' }
  if (stage === 'PARTIALLY_REFUNDED' || stage === 'IN_DISPUTE')
    return { status: 'BLOCKED', reason: 'An adjustment or concern is still open.' }
  if (terminalUnpaid.has(stage))
    return { status: 'PENDING', reason: 'Awaiting customer payment or order progression.' }
  if (order.escrow_released) return { status: 'RELEASED', reason: null }
  return { status: 'AVAILABLE', reason: null }
}
function pill(status: TxStatus) {
  return status === 'PAID_OUT' || status === 'RELEASED'
    ? 'border-needle/20 bg-needle/8 text-needle'
    : status === 'AVAILABLE' || status === 'IN_TRANSIT'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : status === 'PENDING'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-rust/20 bg-rust/8 text-rust'
}
function csv(rows: Tx[]) {
  const data = [
    [
      'Order',
      'Customer',
      'Garment',
      'Customer paid',
      'Platform fee',
      'Tax',
      'Net earnings',
      'Currency',
      'Status',
      'Date',
    ],
    ...rows.map(({ order, status, customer }) => [
      order.reference || order.id,
      customer,
      title(order),
      (order.total_amount || 0) / 100,
      (order.platform_fee_amount || 0) / 100,
      (order.tax_amount || 0) / 100,
      (order.subtotal_amount || 0) / 100,
      order.currency || 'USD',
      status,
      order.updated_at || order.created_at || '',
    ]),
  ]
  return data
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n')
}
async function load(userId: string, role: AccountRouteIdentity['role']): Promise<Loaded> {
  if (role !== 'TAILOR')
    return { profile: null, orders: [], payouts: [], bank: [], customers: {}, warning: null }
  const supabase = createClient()
  const profileResult = await supabase
    .from('tailor_profiles')
    .select(
      'id, currency, payout_currency, payout_account_verified, payout_reverification_required'
    )
    .eq('user_id', userId)
    .maybeSingle()
  if (profileResult.error) throw new Error('Your earnings identity could not load.')
  const profile = profileResult.data as Profile | null
  if (!profile)
    return { profile: null, orders: [], payouts: [], bank: [], customers: {}, warning: null }
  const [ordersResult, payoutsResult, bankResult] = await Promise.all([
    supabase
      .from('orders')
      .select(orderSelect)
      .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${profile.id}`)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('payouts')
      .select(payoutSelect)
      .eq('tailor_profile_id', profile.id)
      .order('initiated_at', { ascending: false, nullsFirst: false })
      .limit(80),
    supabase
      .from('provider_payout_events')
      .select(
        'id, provider, provider_bank_payout_id, amount, currency, status, arrival_at, failure_message, created_at'
      )
      .eq('tailor_profile_id', profile.id)
      .is('payout_id', null)
      .order('created_at', { ascending: false })
      .limit(40),
  ])
  const orders = (ordersResult.data || []) as Order[]
  const ids = [
    ...new Set(
      orders.map((order) => order.customer_id).filter((value): value is string => Boolean(value))
    ),
  ]
  let customers: Record<string, string> = {}
  if (ids.length) {
    const result = await supabase
      .from('customer_profiles')
      .select('user_id, display_name')
      .in('user_id', ids)
    customers = Object.fromEntries(
      (result.data || []).map((row) => [row.user_id, row.display_name || 'Customer'])
    )
  }
  const failed = [
    ordersResult.error && 'orders',
    payoutsResult.error && 'payouts',
    bankResult.error && 'bank activity',
  ].filter(Boolean)
  return {
    profile,
    orders,
    payouts: (payoutsResult.data || []) as Payout[],
    bank: (bankResult.data || []) as BankEvent[],
    customers,
    warning: failed.length ? `Some ${failed.join(', ')} could not load. Refresh to retry.` : null,
  }
}

function EarningsContent({ userId, identity }: { userId: string; identity: AccountRouteIdentity }) {
  const [state, setState] = useState<{
    status: 'loading' | 'error' | 'ready'
    data?: Loaded
    message?: string
  }>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TxStatus | 'ALL'>('ALL')
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('all')
  const [loadedAt] = useState(() => Date.now())
  const profileId = state.status === 'ready' ? state.data?.profile?.id : null
  useEffect(() => {
    let active = true
    void load(userId, identity.role)
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Earnings could not load.',
          })
      })
    return () => {
      active = false
    }
  }, [identity.role, revision, userId])
  useEffect(() => {
    if (!profileId || identity.role !== 'TAILOR') return
    const client = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRevision((value) => value + 1), 180)
    }
    const channel = client
      .channel(`web-earnings:${profileId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tailor_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tailor_profile_id=eq.${profileId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payouts', filter: `tailor_profile_id=eq.${profileId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_payout_events', filter: `tailor_profile_id=eq.${profileId}` }, refresh)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [identity.role, profileId, userId])
  const tx = useMemo(() => {
    if (state.status !== 'ready' || !state.data) return []
    const needle = search.trim().toLowerCase()
    const cutoff = range === 'all' ? 0 : loadedAt - Number(range) * 86400000
    return state.data.orders
      .map((order) => ({
        ...derive(order, state.data!.payouts),
        order,
        customer: state.data!.customers[order.customer_id || ''] || 'Customer',
      }))
      .filter(
        (row) =>
          (status === 'ALL' || row.status === status) &&
          (!cutoff ||
            new Date(row.order.updated_at || row.order.created_at || 0).getTime() >= cutoff) &&
          (!needle ||
            [row.order.reference, row.customer, title(row.order)]
              .join(' ')
              .toLowerCase()
              .includes(needle))
      )
  }, [loadedAt, range, search, state, status])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-6" aria-busy="true">
        Loading earnings…
      </section>
    )
  if (state.status === 'error' || !state.data)
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Earnings unavailable</h2>
        <p className="mt-2 text-sm text-ink/60">{state.message}</p>
        <button
          className="mt-4 h-9 rounded-[8px] bg-drape-green px-3 text-sm font-semibold text-white"
          onClick={() => setRevision((v) => v + 1)}
        >
          Try again
        </button>
      </section>
    )
  if (!state.data.profile)
    return (
      <section className="app-surface p-6">
        <h2 className="text-xl font-semibold">Tailor earnings need a tailor profile.</h2>
        <p className="mt-2 text-sm text-ink/60">Customer accounts do not have payout records.</p>
        <Link
          href="/apply?source=account"
          className="mt-4 inline-flex text-sm font-semibold text-needle"
        >
          Apply as a tailor
        </Link>
      </section>
    )
  const currency = state.data.profile.payout_currency || state.data.profile.currency || 'USD'
  const all = state.data.orders.map((order) => ({
    ...derive(order, state.data!.payouts),
    order,
    customer: state.data!.customers[order.customer_id || ''] || 'Customer',
  }))
  const sum = (states: TxStatus[]) =>
    all
      .filter((row) => states.includes(row.status))
      .reduce((total, row) => total + (row.order.subtotal_amount || 0), 0)
  const available = sum(['AVAILABLE', 'RELEASED'])
  const pending = sum(['PENDING', 'BLOCKED'])
  const paid = sum(['PAID_OUT'])
  const href = tx.length ? `data:text/csv;charset=utf-8,${encodeURIComponent(csv(tx))}` : '#'
  return (
    <div className="grid gap-5 pb-10">
      {state.data.warning ? (
        <p
          role="alert"
          className="rounded-[8px] border border-rust/20 bg-rust/8 p-3 text-sm text-rust"
        >
          {state.data.warning}
        </p>
      ) : null}
      <section className="app-surface overflow-hidden">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
              Eligible order earnings
            </p>
            <p className="mt-2 text-3xl font-semibold">{formatMoney(available, currency)}</p>
            <p className="mt-2 text-sm text-ink/58">
              Available or already released from completed order stages.
            </p>
          </div>
          <Link
            href="/account/payout"
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold"
          >
            <WalletCards className="size-4" />
            Review payout setup
          </Link>
        </div>
        <dl className="grid grid-cols-3 border-t border-ui-border bg-bone/40">
          <div className="p-4">
            <dt className="text-xs text-ink/50">Pending</dt>
            <dd className="mt-1 font-semibold">{formatMoney(pending, currency)}</dd>
          </div>
          <div className="border-x border-ui-border p-4">
            <dt className="text-xs text-ink/50">Paid to bank</dt>
            <dd className="mt-1 font-semibold">{formatMoney(paid, currency)}</dd>
          </div>
          <div className="p-4">
            <dt className="text-xs text-ink/50">Payout readiness</dt>
            <dd className="mt-1 font-semibold">
              {state.data.profile.payout_reverification_required
                ? 'Reverification needed'
                : state.data.profile.payout_account_verified
                  ? 'Ready'
                  : 'Setup required'}
            </dd>
          </div>
        </dl>
      </section>
      <section className="app-surface p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search earnings</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/40" />
            <input
              className="h-10 w-full rounded-[8px] border border-ui-border bg-white pl-9 pr-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
              placeholder="Search order, customer, or garment"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Earnings status"
            className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as TxStatus | 'ALL')}
          >
            <option value="ALL">All statuses</option>
            {(
              [
                'PENDING',
                'AVAILABLE',
                'RELEASED',
                'IN_TRANSIT',
                'PAID_OUT',
                'BLOCKED',
                'FAILED',
              ] as const
            ).map((value) => (
              <option key={value}>{formatDatabaseEnumLabel(value)}</option>
            ))}
          </select>
          <select
            aria-label="Earnings date range"
            className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm"
            value={range}
            onChange={(e) => setRange(e.target.value as typeof range)}
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="all">All time</option>
          </select>
          <a
            href={href}
            download="drapeon-earnings.csv"
            aria-disabled={!tx.length}
            className={`inline-flex h-10 items-center gap-2 rounded-[8px] border border-ui-border px-3 text-sm font-semibold ${tx.length ? '' : 'pointer-events-none opacity-45'}`}
          >
            <Download className="size-4" />
            Export CSV
          </a>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-y border-ui-border text-xs text-ink/50">
              <tr>
                <th className="px-3 py-3">Order</th>
                <th>Customer</th>
                <th>Customer paid</th>
                <th>Net earnings</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {tx.map((row) => (
                <tr key={row.order.id} className="border-b border-ui-border">
                  <td className="px-3 py-3">
                    <Link
                      href={`/account/orders/${row.order.id}`}
                      className="font-semibold text-needle"
                    >
                      {title(row.order)}
                    </Link>
                    <p className="mt-1 text-xs text-ink/45">
                      #{row.order.reference || row.order.id.slice(0, 8)}
                    </p>
                  </td>
                  <td>{row.customer}</td>
                  <td>{formatMoney(row.order.total_amount, row.order.currency)}</td>
                  <td className="font-semibold">
                    {formatMoney(row.order.subtotal_amount, row.order.currency)}
                  </td>
                  <td>
                    <span
                      className={`rounded-[6px] border px-2 py-1 text-xs font-semibold ${pill(row.status)}`}
                    >
                      {formatDatabaseEnumLabel(row.status)}
                    </span>
                    {row.reason ? (
                      <p className="mt-1 max-w-48 text-xs text-ink/45">{row.reason}</p>
                    ) : null}
                  </td>
                  <td>
                    {formatDate(row.order.updated_at || row.order.created_at, {
                      fallback: 'Not recorded',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tx.length ? (
            <p className="py-8 text-center text-sm text-ink/52">
              {all.length
                ? 'No earnings match these filters.'
                : 'No transactions yet. Completed orders will appear here.'}
            </p>
          ) : null}
        </div>
      </section>
      <section className="app-surface overflow-hidden">
        <header className="border-b border-ui-border px-5 py-4">
          <h2 className="text-lg font-semibold">Payout history</h2>
          <p className="mt-1 text-sm text-ink/55">
            Provider transfer and bank-settlement outcomes.
          </p>
        </header>
        {state.data.payouts.length ? (
          <div className="divide-y divide-ui-border">
            {state.data.payouts.map((payout) => {
              const delivery = derivePayoutDeliveryState({
                provider: payout.provider,
                status: payout.status,
                providerTransferStatus: payout.provider_transfer_status,
                bankSettlementStatus: payout.bank_settlement_status,
              })
              return (
                <div
                  key={payout.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-[6px] border border-ui-border px-2 py-1 text-xs font-semibold">
                        {payoutDeliveryLabel(delivery)}
                      </span>
                      <span className="text-xs text-ink/45">
                        {formatPayoutPurpose(payout.payout_purpose)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink/55">
                      {payoutDeliveryExplanation(delivery, payout.provider)}
                    </p>
                    {payout.blocked_reason ? (
                      <p className="mt-2 text-xs text-rust">
                        {formatDatabaseEnumLabel(payout.blocked_reason)}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-ink/40">
                      Initiated {formatDate(payout.initiated_at, { fallback: 'not recorded' })}
                    </p>
                  </div>
                  <p className="text-lg font-semibold">
                    {formatMoney(payout.amount, payout.currency)}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="p-5 text-sm text-ink/52">No payouts yet.</p>
        )}
      </section>
      {state.data.bank.length ? (
        <section className="app-surface p-5">
          <h2 className="text-lg font-semibold">Bank settlement activity</h2>
          <div className="mt-4 grid gap-3">
            {state.data.bank.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap justify-between gap-3 rounded-[8px] border border-ui-border p-4"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {formatDatabaseEnumLabel(event.status, 'Provider update')}
                  </p>
                  <p className="mt-1 text-xs text-ink/50">
                    {event.provider_bank_payout_id || 'Provider reference pending'} ·{' '}
                    {formatDate(event.arrival_at || event.created_at, { fallback: 'Date pending' })}
                  </p>
                  {event.failure_message ? (
                    <p className="mt-1 text-xs text-rust">{event.failure_message}</p>
                  ) : null}
                </div>
                <p className="font-semibold">
                  {formatMoney(event.amount, event.currency, { pendingLabel: 'Bank payout' })}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
export function EarningsWorkspace() {
  return (
    <AccountRouteRuntime surface="earnings">
      {({ session, identity }) => <EarningsContent userId={session.user.id} identity={identity} />}
    </AccountRouteRuntime>
  )
}
