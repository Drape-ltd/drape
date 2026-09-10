'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  consultationOrderListState,
  formatCallCountdown,
  formatDatabaseEnumLabel,
  formatMoney,
  formatRelative,
  getCallLifecycleState,
  type ConsultationAttendanceReviewSnapshot,
} from '@drape/shared'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { DataTable } from '../../../components/ui/data-table'
import { Input } from '../../../components/ui/input'
import { StatusChip } from '../../../components/ui/status-chip'

export type OrderParty = {
  display_name?: string | null
  business_name?: string | null
}

export type AccountOrder = {
  id: string
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  delivery_method: string | null
  quoted_amount: number | null
  total_amount: number | null
  currency: string | null
  quoted_currency: string | null
  created_at: string | null
  updated_at: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  seller_item_id: string | null
  special_note: string | null
  tailor_profiles?: OrderParty | OrderParty[] | null
  customer_profiles?: OrderParty | OrderParty[] | null
}

export type AccountPayment = {
  order_id: string
  phase: string | null
  status: string | null
  amount: number | null
  currency: string | null
  created_at: string | null
}
export type AccountMessage = {
  order_id: string
  body: string | null
  photo_url: string | null
  voice_url: string | null
  created_at: string | null
}
export type OrdersData = {
  userId: string
  tailorProfileId: string | null
  orders: AccountOrder[]
  payments: AccountPayment[]
  messages: AccountMessage[]
  consultationAttendanceReviews: Array<
    ConsultationAttendanceReviewSnapshot & { orderId: string; createdAt: string }
  >
}

const terminalStages = new Set([
  'COMPLETE',
  'COMPLETED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
])
const productionStages = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
])
const dispatchStages = new Set([
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
])
const customerStages = [
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

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}
function label(value: string | null | undefined, fallback = 'Not set') {
  return formatDatabaseEnumLabel(value, fallback)
}
function title(order: AccountOrder) {
  return order.item_title?.trim() || order.garment_type?.trim() || 'Drapeon order'
}
function orderAmount(order: AccountOrder) {
  return formatMoney(
    order.total_amount ?? order.quoted_amount,
    order.currency ?? order.quoted_currency
  )
}
function isTailorOrder(order: AccountOrder, data: OrdersData) {
  return Boolean(
    data.tailorProfileId &&
    (order.tailor_profile_id === data.tailorProfileId || order.tailor_id === data.userId)
  )
}
function party(order: AccountOrder, data: OrdersData) {
  const profile =
    order.customer_id === data.userId
      ? first(order.tailor_profiles)
      : first(order.customer_profiles)
  return (
    profile?.business_name?.trim() ||
    profile?.display_name?.trim() ||
    (order.customer_id === data.userId ? 'Tailor' : 'Customer')
  )
}
function isTerminal(order: AccountOrder) {
  return terminalStages.has(order.stage ?? '')
}
function isCompletedForRole(order: AccountOrder, data: OrdersData) {
  if (isTerminal(order)) return true
  return isTailorOrder(order, data) && ['DELIVERED', 'COLLECTED'].includes(order.stage ?? '')
}
function isActiveForRole(order: AccountOrder, data: OrdersData) {
  if (isCompletedForRole(order, data)) return false
  return !(
    order.customer_id === data.userId && ['DELIVERED', 'COLLECTED'].includes(order.stage ?? '')
  )
}
function latest<T extends { order_id: string }>(orderId: string, rows: T[]) {
  return rows.find((row) => row.order_id === orderId) ?? null
}
function relevantPayment(order: AccountOrder, payments: AccountPayment[]) {
  const orderPayments = payments.filter((payment) => payment.order_id === order.id)
  if (order.stage === 'CONSULTATION') {
    return orderPayments.find((payment) => payment.phase === 'CONSULTATION') ?? orderPayments[0] ?? null
  }
  return orderPayments.find((payment) => payment.phase !== 'CONSULTATION')
    ?? (makeupConsultationScheduled(order) ? orderPayments.find((payment) => payment.phase === 'CONSULTATION') : null)
    ?? null
}
function displayAmount(order: AccountOrder, data: OrdersData) {
  const payment = relevantPayment(order, data.payments)
  if (order.stage === 'CONSULTATION' && payment?.phase === 'CONSULTATION') {
    return formatMoney(payment.amount, payment.currency ?? order.currency ?? order.quoted_currency)
  }
  return orderAmount(order)
}
function visibleOnOrders(order: AccountOrder, data: OrdersData) {
  const hiddenCustomerInquiry =
    order.stage === 'PENDING_QUOTE' &&
    (order.order_kind === 'READY_MADE' || Boolean(order.seller_item_id))
  return !hiddenCustomerInquiry || isTailorOrder(order, data)
}
function consultationMeta(order: AccountOrder) {
  if (!order.special_note?.trim()) return null
  try {
    const parsed = JSON.parse(order.special_note) as {
      consultation?: {
        status?: string | null
        scheduledStartAt?: string | null
        paidAt?: string | null
        feeAmount?: number | null
      }
    }
    return parsed.consultation ?? null
  } catch {
    return null
  }
}
function makeupConsultationScheduled(order: AccountOrder) {
  if (order.stage !== 'PENDING_QUOTE') return false
  const consultation = consultationMeta(order)
  if (consultation?.status !== 'SCHEDULED' || !consultation.scheduledStartAt) return false
  return ['upcoming', 'active'].includes(getCallLifecycleState(consultation.scheduledStartAt).status)
}
function attendanceState(order: AccountOrder, data: OrdersData) {
  if (order.stage !== 'CONSULTATION') return null
  const review = data.consultationAttendanceReviews.find((entry) => entry.orderId === order.id) ?? null
  return consultationOrderListState({
    actorRole: isTailorOrder(order, data) ? 'TAILOR' : 'CUSTOMER',
    review,
  })
}
function actionCopy(order: AccountOrder, data: OrdersData) {
  const stage = order.stage ?? ''
  const consultationReview = attendanceState(order, data)
  if (consultationReview?.needsAction) return consultationReview.label
  if (order.customer_id === data.userId) {
    if (stage === 'QUOTE_SENT') return 'Review quote'
    if (stage === 'PAYMENT_PENDING' || stage === 'PAYMENT_FAILED') return 'Payment needed'
    if (['DELIVERED', 'COLLECTED'].includes(stage)) return 'Review & tip'
    if (dispatchStages.has(stage)) return 'Check handoff'
    if (stage === 'IN_DISPUTE') return 'Support active'
  }
  if (isTailorOrder(order, data)) {
    if (stage === 'PENDING_QUOTE' && makeupConsultationScheduled(order)) {
      const lifecycle = getCallLifecycleState(consultationMeta(order)?.scheduledStartAt)
      return lifecycle.status === 'active' ? 'Join make-up consultation' : `Quote prep open · ${formatCallCountdown(lifecycle.msUntilOpen)}`
    }
    if (stage === 'PENDING_QUOTE') return 'Quote needed'
    if (stage === 'CONSULTATION') {
      if (consultationReview) return consultationReview.label
      const consultation = consultationMeta(order)
      if (!consultation || consultation.status === 'REQUESTED') return 'Consultation response needed'
      if (consultation.status !== 'SCHEDULED') return 'Review consultation'
      const lifecycle = getCallLifecycleState(consultation.scheduledStartAt)
      if (lifecycle.status === 'active') return 'Join consultation'
      if (lifecycle.status === 'expired') return 'Quote needed after consultation'
      if (lifecycle.status === 'upcoming') {
        return consultation.feeAmount && !consultation.paidAt
          ? 'Awaiting consultation payment'
          : formatCallCountdown(lifecycle.msUntilOpen)
      }
      return 'Review consultation'
    }
    if (stage === 'PAYMENT_FAILED') return 'Payment issue'
    if (stage === 'IN_DISPUTE') return 'Dispute active'
    if (productionStages.has(stage) || dispatchStages.has(stage)) return 'Stage update'
  }
  return null
}
function requiresAction(order: AccountOrder, data: OrdersData) {
  if (order.stage !== 'CONSULTATION') return Boolean(actionCopy(order, data))
  const consultationReview = attendanceState(order, data)
  if (consultationReview?.needsAction) return true
  if (!isTailorOrder(order, data)) return false
  const consultation = consultationMeta(order)
  if (!consultation || consultation.status === 'REQUESTED') return true
  if (consultation.status !== 'SCHEDULED') return true
  const lifecycle = getCallLifecycleState(consultation.scheduledStartAt)
  return lifecycle.status === 'active' || lifecycle.status === 'expired' || lifecycle.status === 'unscheduled'
}
function progress(order: AccountOrder) {
  if (terminalStages.has(order.stage ?? '')) return 100
  const index = customerStages.indexOf(order.stage ?? '')
  return index < 0 ? 12 : Math.max(8, Math.round(((index + 1) / customerStages.length) * 100))
}
function stageClass(stage: string | null) {
  if (['PAYMENT_FAILED', 'IN_DISPUTE', 'REFUNDED', 'CANCELLED'].includes(stage ?? ''))
    return 'border-rust bg-rust text-white'
  if (['PENDING_QUOTE', 'QUOTE_SENT', 'PAYMENT_PENDING'].includes(stage ?? ''))
    return 'border-rust/18 bg-rust/12 text-rust'
  if (productionStages.has(stage ?? '')) return 'border-needle/14 bg-needle/10 text-needle'
  if (dispatchStages.has(stage ?? '')) return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-ink/8 bg-ink/6 text-ink/54'
}
function Stage({ value }: { value: string | null }) {
  return (
    <StatusChip
      status={value}
      fallback="In progress"
      className={`w-fit whitespace-nowrap ${stageClass(value)}`}
    />
  )
}

function Empty({ search, filter, tailor }: { search: boolean; filter: string; tailor: boolean }) {
  const heading = search
    ? 'No orders match that search.'
    : filter === 'action'
      ? 'No orders need action.'
      : filter === 'completed'
        ? 'No completed orders yet.'
        : 'No orders here.'
  return (
    <section className="app-surface p-7">
      <h2 className="text-xl font-semibold text-ink">{heading}</h2>
      <p className="mt-2 text-sm leading-6 text-ink/60">
        Custom and ready-made orders appear here after they are created.
      </p>
      <Link
        href={tailor ? '/account/work' : '/account/explore'}
        className="mt-4 inline-flex text-sm font-semibold text-needle"
      >
        {tailor ? 'Back to work' : 'Explore tailors'}
      </Link>
    </section>
  )
}

function OrderCard({ order, data }: { order: AccountOrder; data: OrdersData }) {
  const payment = relevantPayment(order, data.payments)
  const message = latest(order.id, data.messages)
  const action = actionCopy(order, data)
  const consultation = order.stage === 'CONSULTATION' || makeupConsultationScheduled(order)
  const consultationState = consultation ? attendanceState(order, data) : null
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="block overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/25 hover:shadow-md"
    >
      <div className="p-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/68">
                {label(order.order_kind, 'Order')}
              </span>
              <Stage value={order.stage} />
              {action && !consultation ? (
                <span className="rounded-full bg-rust/10 px-2.5 py-0.5 text-xs font-semibold text-rust">
                  {action}
                </span>
              ) : null}
            </div>
            <h3 className="mt-2 text-lg font-semibold text-ink">{title(order)}</h3>
            <p className="mt-1 text-sm text-ink/52">
              {party(order, data)} · {label(order.delivery_method, 'Fulfillment')}
            </p>
            {consultation ? (
              <span
                className={`mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${consultationState?.needsAction ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {consultationState?.label ?? (order.stage === 'CONSULTATION' ? 'Consultation scheduled' : 'Make-up consultation scheduled')}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-semibold text-ink">{displayAmount(order, data)}</p>
            <div className="mt-1 flex justify-end">
              <StatusChip status={payment?.status} fallback="Payment pending" />
            </div>
            <p className="mt-1 text-xs text-ink/40">
              {formatRelative(order.updated_at ?? order.created_at)}
            </p>
          </div>
        </div>
        {message && !consultation ? (
          <p className="mt-3 line-clamp-1 rounded-[8px] bg-ink/4 px-3 py-2 text-sm text-ink/52">
            {message.body?.trim() ||
              (message.photo_url || message.voice_url ? 'Media attached.' : 'Message recorded.')}
          </p>
        ) : null}
      </div>
      <div className="h-1 bg-ink/6">
        <div className="h-full bg-needle" style={{ width: `${progress(order)}%` }} />
      </div>
    </Link>
  )
}

type OrderFilter = 'active' | 'action' | 'completed' | 'all'

export function OrdersContent({ data }: { data: OrdersData }) {
  const searchParams = useSearchParams()
  const requestedFilter = searchParams.get('filter')
  const initialFilter = ['active', 'action', 'completed', 'all'].includes(requestedFilter || '')
    ? (requestedFilter as OrderFilter)
    : 'active'
  return <OrdersContentView key={initialFilter} data={data} initialFilter={initialFilter} />
}

function OrdersContentView({ data, initialFilter }: { data: OrdersData; initialFilter: OrderFilter }) {
  const [filter, setFilter] = useState<OrderFilter>(initialFilter)
  const [search, setSearch] = useState('')
  const rows = data.orders.filter((order) => visibleOnOrders(order, data))
  const active = rows.filter((order) => isActiveForRole(order, data))
  const completed = rows.filter((order) => isCompletedForRole(order, data))
  const actions = rows.filter((order) => requiresAction(order, data))
  const filtered =
    filter === 'active'
      ? active
      : filter === 'action'
        ? actions
        : filter === 'completed'
          ? completed
          : rows
  const query = search.trim().toLowerCase()
  const visible = query
    ? filtered.filter((order) =>
        [title(order), party(order, data), label(order.stage), label(order.order_kind)]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : filtered
  const tabs: Array<[typeof filter, string, number]> = [
    ['active', 'Active', active.length],
    ['action', 'Needs action', actions.length],
    ['completed', 'Completed', completed.length],
    ['all', 'All', rows.length],
  ]
  const columns = useMemo<ColumnDef<AccountOrder>[]>(
    () => [
      {
        id: 'order',
        accessorFn: title,
        header: 'Order',
        cell: ({ row }) => (
          <div className="min-w-52">
            <Link
              href={`/account/orders/${row.original.id}`}
              className="font-semibold text-ink hover:text-needle hover:underline"
            >
              {title(row.original)}
            </Link>
            <p className="mt-1 text-xs text-ui-subtle">{party(row.original, data)}</p>
          </div>
        ),
      },
      {
        id: 'stage',
        accessorFn: (order) => order.stage ?? '',
        header: 'Status',
        cell: ({ row }) => <Stage value={row.original.stage} />,
      },
      {
        id: 'fulfillment',
        accessorFn: (order) => label(order.delivery_method, 'Fulfillment'),
        header: 'Fulfillment',
        cell: ({ row }) => (
          <span className="text-ui-subtle">
            {label(row.original.delivery_method, 'Fulfillment')}
          </span>
        ),
      },
      {
        id: 'payment',
        accessorFn: (order) => relevantPayment(order, data.payments)?.status ?? '',
        header: 'Payment',
        cell: ({ row }) => (
          <StatusChip
            status={relevantPayment(row.original, data.payments)?.status}
            fallback="Payment pending"
          />
        ),
      },
      {
        id: 'amount',
        accessorFn: (order) => {
          const payment = relevantPayment(order, data.payments)
          return order.stage === 'CONSULTATION' && payment?.phase === 'CONSULTATION'
            ? payment.amount ?? 0
            : order.total_amount ?? order.quoted_amount ?? 0
        },
        header: 'Amount',
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-semibold">
            {displayAmount(row.original, data)}
          </span>
        ),
      },
      {
        id: 'updated',
        accessorFn: (order) => order.updated_at ?? order.created_at ?? '',
        header: 'Updated',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-ui-subtle">
            {formatRelative(row.original.updated_at ?? row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'action',
        enableSorting: false,
        header: '',
        cell: ({ row }) => {
          const action = actionCopy(row.original, data)
          return action ? <Badge tone="warning">{action}</Badge> : null
        },
      },
    ],
    [data]
  )
  return (
    <div className="grid gap-4 pb-10">
      <section className="grid grid-cols-3 gap-3" aria-label="Order summary">
        {[
          ['Active', active.length],
          ['Needs action', actions.length],
          ['Completed', completed.length],
        ].map(([name, value]) => (
          <div key={String(name)} className="app-surface p-4">
            <p className="text-2xl font-semibold text-ink">{String(value)}</p>
            <p className="text-xs text-ink/52">{String(name)}</p>
          </div>
        ))}
      </section>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search orders by title, party, or status"
        aria-label="Search orders"
        className="h-11"
      />
      <div
        className="flex gap-1.5 overflow-x-auto rounded-[8px] border border-ui-border bg-white p-1.5"
        role="tablist"
        aria-label="Filter orders"
      >
        {tabs.map(([key, name, count]) => (
          <Button
            key={key}
            onClick={() => setFilter(key)}
            variant={filter === key ? 'primary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={filter === key}
          >
            {name}
            {count > 0 ? <span className="ml-1 opacity-70">{count}</span> : null}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 md:hidden">
        {visible.length ? (
          visible.map((order) => <OrderCard key={order.id} order={order} data={data} />)
        ) : (
          <Empty search={Boolean(query)} filter={filter} tailor={Boolean(data.tailorProfileId)} />
        )}
      </div>
      {visible.length ? (
        <div className="hidden overflow-hidden rounded-[8px] border border-ui-border bg-white md:block">
          <DataTable columns={columns} data={visible} />
        </div>
      ) : (
        <div className="hidden md:block">
          <Empty search={Boolean(query)} filter={filter} tailor={Boolean(data.tailorProfileId)} />
        </div>
      )}
    </div>
  )
}
