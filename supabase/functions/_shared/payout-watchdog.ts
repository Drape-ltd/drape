import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  normalizeAccountCurrency,
  resolvePaymentProviderForCurrency,
} from '../../../packages/shared/src/currency-config.ts'
import type { OpsIssueSeverity } from '../../../packages/shared/src/ops-issues.ts'
import {
  PAYOUT_DISPUTE_WINDOW_HOURS,
  payoutWindowClosesAt,
} from '../../../packages/shared/src/payout-timing.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

export const PAYOUT_WATCHDOG_GRACE_MINUTES = 30
export const PAYOUT_WATCHDOG_ESCALATE_MINUTES = 60
export const PAYOUT_WATCHDOG_LIMIT = 25

const PAYOUT_FINAL_STAGES = ['DELIVERED', 'COLLECTED', 'COMPLETE'] as const

type WatchdogOrderRow = {
  id: string
  reference: string | null
  stage: string
  order_kind: string | null
  tailor_id: string | null
  customer_id: string | null
  currency: string | null
  source_currency: string | null
  source_amount: number | null
  subtotal_amount: number | null
  total_amount: number | null
  escrow_released: boolean | null
  handoff_completed_at: string | null
  customer_handoff_confirmed_at: string | null
}

export type OverduePayoutWithoutRow = {
  order: WatchdogOrderRow
  payoutReadyAt: string
  minutesPastReady: number
  amount: number | null
  currency: string | null
  provider: string | null
}

function payoutReadyAt(confirmedAt: string) {
  if (!Number.isFinite(Date.parse(confirmedAt))) return null
  return payoutWindowClosesAt(confirmedAt)
}

function payoutWatchdogCutoff(now: number, graceMinutes: number) {
  return new Date(
    now - (PAYOUT_DISPUTE_WINDOW_HOURS * 60 + graceMinutes) * 60 * 1000,
  ).toISOString()
}

function payoutAmount(order: WatchdogOrderRow) {
  if (typeof order.source_amount === 'number' && order.source_amount > 0) return order.source_amount
  if (typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0) return order.subtotal_amount
  if (typeof order.total_amount === 'number' && order.total_amount > 0) return order.total_amount
  return null
}

function payoutCurrency(order: WatchdogOrderRow) {
  const currency = normalizeAccountCurrency(order.source_currency ?? order.currency)
  return currency ?? null
}

function payoutProvider(order: WatchdogOrderRow) {
  const currency = payoutCurrency(order)
  return currency ? resolvePaymentProviderForCurrency(currency) : null
}

export async function findOverduePayoutsWithoutRows(
  supabase: SupabaseClient,
  options: {
    now?: number
    graceMinutes?: number
    limit?: number
  } = {},
) {
  const now = options.now ?? Date.now()
  const graceMinutes = options.graceMinutes ?? PAYOUT_WATCHDOG_GRACE_MINUTES
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? PAYOUT_WATCHDOG_LIMIT)))

  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, currency, source_currency, source_amount, subtotal_amount, total_amount, escrow_released, handoff_completed_at, customer_handoff_confirmed_at')
    .eq('escrow_released', false)
    .in('stage', [...PAYOUT_FINAL_STAGES])
    .not('customer_handoff_confirmed_at', 'is', null)
    .lte('customer_handoff_confirmed_at', payoutWatchdogCutoff(now, graceMinutes))
    .order('customer_handoff_confirmed_at', { ascending: true })
    .limit(limit)

  if (orderError) throw orderError

  const candidateOrders = ((orders ?? []) as WatchdogOrderRow[])
    .filter((order) => typeof order.customer_handoff_confirmed_at === 'string')

  if (candidateOrders.length === 0) return [] as OverduePayoutWithoutRow[]

  const orderIds = candidateOrders.map((order) => order.id)
  const { data: payouts, error: payoutError } = await supabase
    .from('payouts')
    .select('order_id')
    .in('order_id', orderIds)

  if (payoutError) throw payoutError

  const ordersWithPayoutRows = new Set(
    ((payouts ?? []) as Array<{ order_id: string | null }>)
      .map((row) => row.order_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )

  const overdue: OverduePayoutWithoutRow[] = []

  for (const order of candidateOrders) {
    if (ordersWithPayoutRows.has(order.id) || !order.customer_handoff_confirmed_at) continue
    const readyAt = payoutReadyAt(order.customer_handoff_confirmed_at)
    if (!readyAt) continue

    const minutesPastReady = Math.floor((now - Date.parse(readyAt)) / 60_000)
    if (minutesPastReady < graceMinutes) continue

    overdue.push({
      order,
      payoutReadyAt: readyAt,
      minutesPastReady,
      amount: payoutAmount(order),
      currency: payoutCurrency(order),
      provider: payoutProvider(order),
    })
  }

  return overdue
}

function severityForOverduePayout(minutesPastReady: number): OpsIssueSeverity {
  return minutesPastReady >= PAYOUT_WATCHDOG_ESCALATE_MINUTES ? 'CRITICAL' : 'HIGH'
}

export async function createOverduePayoutIssues(supabase: SupabaseClient) {
  const overdue = await findOverduePayoutsWithoutRows(supabase)

  for (const item of overdue) {
    const reference = item.order.reference ?? item.order.id
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'ESCROW_STUCK',
      severity: severityForOverduePayout(item.minutesPastReady),
      source: 'payout-watchdog',
      actorRole: 'SYSTEM',
      orderId: item.order.id,
      userId: item.order.tailor_id,
      provider: item.provider,
      stage: item.order.stage,
      title: 'Payout release overdue',
      description: `Order ${reference} became payout-eligible at ${item.payoutReadyAt}, but no payout row exists yet.`,
      recommendedAction: 'Run release-order-payouts for this order, confirm a payout row is created, and investigate cron/Vault/job health if the row is still missing.',
      dedupeKey: `escrow-stuck:payout-overdue-no-row:${item.order.id}`,
      metadata: {
        watchdog: 'payout_overdue_no_row',
        order_reference: item.order.reference,
        order_kind: item.order.order_kind,
        payout_ready_at: item.payoutReadyAt,
        minutes_past_ready: item.minutesPastReady,
        grace_minutes: PAYOUT_WATCHDOG_GRACE_MINUTES,
        customer_handoff_confirmed_at: item.order.customer_handoff_confirmed_at,
        handoff_completed_at: item.order.handoff_completed_at,
        payout_amount: item.amount,
        payout_currency: item.currency,
        payout_provider: item.provider,
      },
    })
  }

  return overdue
}
