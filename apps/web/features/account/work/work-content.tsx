'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useState } from 'react'
import { Briefcase, CheckCheck, ChevronDown, MessageCircle } from 'lucide-react'
import { formatDatabaseEnumLabel, formatMoney, formatRelative } from '@drape/shared'
import { Button } from '../../../components/ui/button'
import { MetricCard } from '../../../components/ui/metric-card'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'

export type WorkTailor = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
  availability: string | null
  is_live: boolean | null
  is_verified: boolean | null
  total_orders: number | null
  profile_completed: boolean | null
  id_verification_status: string | null
  payout_provider: string | null
  payout_reverification_required: boolean | null
  payout_account_verified: boolean | null
}
export type WorkOrder = {
  id: string
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  total_amount: number | null
  quoted_amount: number | null
  currency: string | null
  quoted_currency: string | null
  updated_at: string | null
  created_at: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  customer_profiles?:
    | { display_name?: string | null }
    | Array<{ display_name?: string | null }>
    | null
}
export type WorkData = { userId: string; tailor: WorkTailor | null; orders: WorkOrder[] }

const terminal = new Set([
  'COMPLETE',
  'COMPLETED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
])
const needsAction = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'IN_DISPUTE',
])
const production = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'])
const dispatched = new Set([
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
])
const stageFlow = [
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
function orderTitle(order: WorkOrder) {
  return order.item_title?.trim() || order.garment_type?.trim() || 'Drapeon order'
}
function amount(order: WorkOrder) {
  return formatMoney(
    order.total_amount ?? order.quoted_amount,
    order.currency ?? order.quoted_currency
  )
}
function progress(order: WorkOrder) {
  if (terminal.has(order.stage ?? '')) return 100
  const index = stageFlow.indexOf(order.stage ?? '')
  return index < 0 ? 12 : Math.max(8, Math.round(((index + 1) / stageFlow.length) * 100))
}
function payoutReady(tailor: WorkTailor) {
  return tailor.payout_reverification_required !== true && tailor.payout_account_verified === true
}
function action(order: WorkOrder) {
  const stage = order.stage ?? ''
  if (['PENDING_QUOTE', 'CONSULTATION'].includes(stage)) return 'Quote needed'
  if (stage === 'PAYMENT_FAILED') return 'Payment issue'
  if (stage === 'IN_DISPUTE') return 'Dispute active'
  if (production.has(stage) || dispatched.has(stage)) return 'Stage update'
  return null
}
function column(order: WorkOrder) {
  const stage = order.stage ?? ''
  if (needsAction.has(stage)) return 'needs-action'
  if (production.has(stage)) return 'production'
  if (dispatched.has(stage)) return 'dispatched'
  return 'done'
}
function Stage({ value }: { value: string | null }) {
  return <StatusChip status={value} fallback="In progress" />
}

function WorkOrderCard({ order }: { order: WorkOrder }) {
  const next = action(order)
  const customer = first(order.customer_profiles)?.display_name?.trim() || 'Customer'
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="block rounded-[8px] border border-ui-border bg-white p-3.5 shadow-sm transition hover:border-needle/30 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-needle/70">
          {formatDatabaseEnumLabel(order.order_kind, 'Order')}
        </span>
        <Stage value={order.stage} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
      <p className="mt-0.5 truncate text-xs text-ink/52">
        {customer} · {amount(order)}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink/8">
        <div className="h-full rounded-full bg-needle" style={{ width: `${progress(order)}%` }} />
      </div>
      <p className={`mt-2 text-xs ${next ? 'font-semibold text-amber-700' : 'text-ink/40'}`}>
        {next ?? formatRelative(order.updated_at ?? order.created_at)}
      </p>
    </Link>
  )
}

export function WorkContent({ data }: { data: WorkData }) {
  const [open, setOpen] = useState([true, true, true, false])
  if (!data.tailor)
    return (
    <section data-route-content-ready="true" className="app-surface p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
          Tailor workspace
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">Tailor workspace not set up.</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink/62">
          Apply for tailor access before orders, shop readiness, and payout context appear here.
        </p>
        <Button asChild className="mt-5">
          <Link href="/apply?source=account">Apply as a tailor</Link>
        </Button>
      </section>
    )
  const tailor = data.tailor
  const orders = data.orders.filter(
    (order) => order.tailor_profile_id === tailor.id || order.tailor_id === data.userId
  )
  const active = orders.filter((order) => !terminal.has(order.stage ?? ''))
  const replies = active.filter((order) =>
    ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '')
  )
  const ready = payoutReady(tailor)
  const profileReady = Boolean(tailor.profile_completed || tailor.is_live)
  const verified = Boolean(
    tailor.is_verified ||
    ['VERIFIED', 'APPROVED'].includes(tailor.id_verification_status ?? '') ||
    tailor.is_live
  )
  const availability = tailor.availability ?? 'OPEN'
  const availabilityCopy =
    availability === 'OPEN'
      ? 'Open for orders'
      : availability === 'LIMITED'
        ? 'Limited availability'
        : 'Fully booked'
  const groups = [
    {
      key: 'needs-action',
      title: 'Needs action',
      body: 'Quotes, payment issues, and disputes.',
      orders: active.filter((order) => column(order) === 'needs-action'),
    },
    {
      key: 'production',
      title: 'In production',
      body: 'Confirmed work moving through stages.',
      orders: active.filter((order) => column(order) === 'production'),
    },
    {
      key: 'dispatched',
      title: 'Handoff',
      body: 'Collection, dispatch, and delivery.',
      orders: active.filter((order) => column(order) === 'dispatched'),
    },
    {
      key: 'done',
      title: 'Done / recent',
      body: 'Closed work and final review.',
      orders: orders
        .filter((order) => terminal.has(order.stage ?? '') || column(order) === 'done')
        .slice(0, 8),
    },
  ]
  const focus: { eyebrow: string; title: string; body: string; href: Route; action: string } =
    replies.length
      ? {
          eyebrow: 'Today',
          title: `${replies.length} quote${replies.length === 1 ? '' : 's'} waiting`,
          body: 'Review the brief and send clear pricing or request a consultation.',
          href: '/account/orders',
          action: 'Review orders',
        }
      : active[0]
        ? {
            eyebrow: 'Today',
            title: orderTitle(active[0]),
            body: action(active[0]) ?? 'Open the order to review its next step.',
            href: `/account/orders/${active[0].id}` as Route,
            action: 'Open order',
          }
        : !profileReady
          ? {
              eyebrow: 'Readiness',
              title: 'Finish your tailor profile',
              body: 'Complete the storefront and selling setup before customers can discover it.',
              href: '/account/profile',
              action: 'Complete profile',
            }
          : !verified
            ? {
                eyebrow: 'Readiness',
                title: 'Trust review required',
                body: 'Complete the private challenge review in the app before paid work opens.',
                href: '/account/profile',
                action: 'Review requirements',
              }
            : !ready
              ? {
                  eyebrow: 'Readiness',
                  title: 'Set up payouts',
                  body: 'Paid quotes and earnings release remain paused until payout setup is verified.',
                  href: '/account/payout',
                  action: 'Set up payout',
                }
              : {
                  eyebrow: 'Today',
                  title: 'No urgent actions',
                  body: 'Your queue is clear. Review your storefront or update availability.',
                  href: '/account/profile',
                  action: 'Review storefront',
                }
  return (
    <div data-route-content-ready="true" className="grid gap-5 pb-10">
      <Surface>
        <SurfaceHeader
          eyebrow="Tailor cockpit"
          title={tailor.business_name?.trim() || tailor.display_name?.trim() || 'Tailor dashboard'}
          description="Order health, selling readiness, and the next useful action."
          action={<StatusChip status={tailor.is_live ? 'LIVE' : 'HIDDEN'} />}
        />
        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Active"
              value={active.length}
              hint="Orders in progress"
              icon={<Briefcase />}
            />
            <MetricCard
              label="Needs reply"
              value={replies.length}
              hint="Quotes or consultations"
              icon={<MessageCircle />}
            />
            <MetricCard
              label="Completed"
              value={tailor.total_orders ?? 0}
              hint="Lifetime orders"
              icon={<CheckCheck />}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Link
              href="/account/profile"
              className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 hover:bg-white"
            >
              <p className="text-xs font-semibold uppercase text-needle/70">Availability</p>
              <p className="mt-1.5 text-sm font-semibold text-ink">{availabilityCopy}</p>
              <p className="mt-1 text-xs text-ink/52">
                Active orders remain available if new bookings pause.
              </p>
            </Link>
            <Link
              href="/account/profile"
              className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 hover:bg-white"
            >
              <StatusChip
                status={verified ? 'VERIFIED' : (tailor.id_verification_status ?? 'NOT_SUBMITTED')}
              />
              <p className="mt-2 text-sm font-semibold text-ink">Trust</p>
              <p className="mt-1 text-xs text-ink/52">
                {profileReady ? 'Storefront setup recorded.' : 'Profile setup is incomplete.'}
              </p>
            </Link>
            <Link
              href="/account/payout"
              className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 hover:bg-white"
            >
              <StatusChip
                status={
                  ready
                    ? 'PAYOUT_READY'
                    : tailor.payout_reverification_required
                      ? 'REVERIFICATION_REQUIRED'
                      : 'SETUP_REQUIRED'
                }
              />
              <p className="mt-2 text-sm font-semibold text-ink">Payout</p>
              <p className="mt-1 text-xs text-ink/52">
                {ready
                  ? tailor.payout_provider || 'Verified destination'
                  : 'Paid work remains paused.'}
              </p>
            </Link>
          </div>
          <div className="rounded-[8px] border border-needle/15 bg-needle/6 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/70">
              {focus.eyebrow}
            </p>
            <h3 className="mt-1.5 text-lg font-semibold text-ink">{focus.title}</h3>
            <p className="mt-1 text-sm leading-6 text-ink/58">{focus.body}</p>
            <Button asChild size="sm" className="mt-3">
              <Link href={focus.href}>{focus.action}</Link>
            </Button>
          </div>
        </div>
      </Surface>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">
            Order queue
          </p>
          <Link href="/account/orders" className="text-xs font-semibold text-needle">
            View all orders
          </Link>
        </div>
        {active.length === 0 ? (
          <div className="app-surface p-6">
            <h2 className="text-xl font-semibold text-ink">No active work right now.</h2>
            <p className="mt-2 text-sm text-ink/58">
              New briefs and ready-made orders will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-4">
            {groups.map((group, index) => (
              <div
                key={group.key}
                className="h-fit overflow-hidden rounded-[8px] border border-ui-border bg-white"
              >
                <button
                  type="button"
                  aria-expanded={open[index]}
                  onClick={() =>
                    setOpen((current) =>
                      current.map((value, item) => (item === index ? !value : value))
                    )
                  }
                  className="flex w-full items-start justify-between gap-3 p-3.5 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {group.title} <span className="text-needle">{group.orders.length}</span>
                    </p>
                    <p className="mt-1 text-xs leading-4 text-ink/48">{group.body}</p>
                  </div>
                  <ChevronDown
                    className={`size-4 text-ink/40 transition ${open[index] ? 'rotate-180' : ''}`}
                  />
                </button>
                {open[index] ? (
                  <div className="grid gap-2.5 border-t border-ui-border p-3">
                    {group.orders.length ? (
                      group.orders.map((order) => <WorkOrderCard key={order.id} order={order} />)
                    ) : (
                      <p className="rounded-[8px] bg-ui-muted p-3 text-xs text-ink/44">
                        Nothing here.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
