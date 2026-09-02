'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  filterContactInfo,
  formatDatabaseEnumLabel,
  formatExplicitZonedDateTime,
  formatMoney,
  formatRelative,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { StatusChip } from '../../../components/ui/status-chip'
import { AccountRouteRuntime } from '../account-route-runtime'

type Order = Record<string, unknown> & {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  garment_description: string | null
  item_title: string | null
  item_size: string | null
  stage: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  currency: string | null
  quoted_currency: string | null
  quoted_amount: number | null
  total_amount: number | null
  delivery_method: string | null
  deadline: string | null
  quoted_completion_date: string | null
  created_at: string | null
  updated_at: string | null
  reference_photos: unknown
  special_note: string | null
}
type StageUpdate = {
  id: string
  order_id: string
  stage: string | null
  note: string | null
  photo_url: string | null
  created_at: string | null
}
type Payment = {
  id: string
  order_id: string
  phase: string | null
  provider: string | null
  currency: string | null
  amount: number | null
  status: string | null
  confirmed_at: string | null
  created_at: string | null
}
type Message = {
  id: string
  order_id: string
  sender_id: string | null
  body: string | null
  photo_url: string | null
  voice_url: string | null
  created_at: string | null
}
type Quote = {
  id: string
  order_id: string
  version: number
  status: string | null
  total_amount: number | null
  currency: string | null
  completion_date: string | null
  breakdown: string | null
  expires_at: string | null
}
type Event = {
  id: string
  order_id: string
  event_type: string | null
  title: string | null
  summary: string | null
  actor_role: string | null
  created_at: string | null
}
type CustomDetail = Record<string, unknown> & {
  style_notes?: string | null
  body_note?: string | null
  fabric_description?: string | null
  target_delivery_date?: string | null
  delivery_instructions?: string | null
  social_reference_links?: unknown
}
type Data = {
  order: Order
  tailorProfileId: string | null
  stages: StageUpdate[]
  payments: Payment[]
  messages: Message[]
  quotes: Quote[]
  events: Event[]
  detail: CustomDetail | null
}
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: Data }
  | { status: 'missing' }
  | { status: 'error'; message: string }
const payableStages = new Set(['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'])
const terminalStages = new Set([
  'COMPLETE',
  'COMPLETED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
])
const stageNext: Record<string, string[]> = {
  CONFIRMED: ['DESIGNING', 'SOURCING', 'CUTTING'],
  DESIGNING: ['SOURCING', 'CUTTING'],
  SOURCING: ['CUTTING'],
  CUTTING: ['SEWING'],
  SEWING: ['FINISHING'],
  FINISHING: ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'],
  READY_FOR_DRAPE_DISPATCH: ['SHIPPED'],
  SHIPPED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
}
const orderSelect =
  'id, reference, order_kind, garment_type, garment_description, item_title, item_size, stage, customer_id, tailor_id, tailor_profile_id, currency, quoted_currency, quoted_amount, total_amount, delivery_method, deadline, quoted_completion_date, created_at, updated_at, reference_photos, special_note, occasion, fabric_source, delivery_address, recipient_name, recipient_phone, tracking_number, carrier, collection_code, collection_code_expiry, auto_release_at, customer_measurements_snapshot'
function text(value: unknown, fallback = 'Not provided') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
function list(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : []
}
function title(order: Order) {
  return text(order.item_title || order.garment_type, 'Drapeon order')
}
function isTailor(data: Data, userId: string) {
  return Boolean(
    data.tailorProfileId &&
    (data.order.tailor_profile_id === data.tailorProfileId || data.order.tailor_id === userId)
  )
}
async function functionError(error: unknown) {
  const context =
    error && typeof error === 'object' ? (error as { context?: Response }).context : null
  try {
    if (context?.clone) {
      const body = (await context.clone().json()) as { message?: string; error?: string }
      return body.message || body.error || null
    }
  } catch {
    /* fallback */
  }
  return null
}
async function invoke(name: string, body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke(name, { body })
  if (error)
    throw new Error(
      (await functionError(error)) || 'That action could not finish. Refresh and try again.'
    )
  if ((data as { error?: unknown } | null)?.error)
    throw new Error(
      String(
        (data as { message?: unknown; error?: unknown }).message ||
          (data as { error?: unknown }).error
      )
    )
  return data
}
async function load(userId: string, orderId: string): Promise<Data | null> {
  const supabase = createClient()
  const tailorResult = await supabase
    .from('tailor_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (tailorResult.error) throw new Error('Your order role could not be confirmed.')
  const tailorProfileId = (tailorResult.data as { id?: string } | null)?.id ?? null
  const orderResult = await supabase
    .from('orders')
    .select(orderSelect)
    .eq('id', orderId)
    .maybeSingle()
  if (orderResult.error) throw new Error('The order could not load.')
  if (!orderResult.data) return null
  const order = orderResult.data as unknown as Order
  const participant =
    order.customer_id === userId ||
    order.tailor_id === userId ||
    order.tailor_profile_id === tailorProfileId
  if (!participant) return null
  const [stages, payments, messages, quotes, events, detail] = await Promise.all([
    supabase
      .from('order_stage_updates')
      .select('id, order_id, stage, note, photo_url, created_at')
      .eq('order_id', orderId)
      .order('created_at'),
    supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),
    supabase
      .from('messages')
      .select('id, order_id, sender_id, body, photo_url, voice_url, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('order_quotes')
      .select(
        'id, order_id, version, status, total_amount, currency, completion_date, breakdown, expires_at'
      )
      .eq('order_id', orderId)
      .order('version', { ascending: false }),
    supabase
      .from('order_events')
      .select('id, order_id, event_type, title, summary, actor_role, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('custom_order_details')
      .select(
        'style_notes, body_note, fabric_description, target_delivery_date, delivery_instructions, social_reference_links'
      )
      .eq('order_id', orderId)
      .maybeSingle(),
  ])
  if (stages.error || payments.error || messages.error || quotes.error || events.error)
    throw new Error('Some order context could not load. Refresh before taking action.')
  return {
    order,
    tailorProfileId,
    stages: (stages.data ?? []) as StageUpdate[],
    payments: (payments.data ?? []) as Payment[],
    messages: (messages.data ?? []) as Message[],
    quotes: (quotes.data ?? []) as Quote[],
    events: (events.data ?? []) as Event[],
    detail: detail.error ? null : (detail.data as CustomDetail | null),
  }
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-4 border-b border-ink/7 py-2.5 last:border-0">
      <dt className="text-sm text-ink/50">{label}</dt>
      <dd className="text-right text-sm font-semibold text-ink">{value}</dd>
    </div>
  )
}

function TailorActions({ data, refresh }: { data: Data; refresh: () => void }) {
  const [amount, setAmount] = useState('')
  const [completion, setCompletion] = useState('')
  const [note, setNote] = useState('')
  const [next, setNext] = useState(stageNext[data.order.stage ?? '']?.[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; copy: string } | null>(null)
  async function sendQuote() {
    const minor = Math.round(Number(amount) * 100)
    const leak = filterContactInfo(note)
    if (!Number.isFinite(minor) || minor < 1)
      return setNotice({ error: true, copy: 'Enter a valid quote amount.' })
    if (!completion) return setNotice({ error: true, copy: 'Choose an estimated completion date.' })
    if (leak.blocked) return setNotice({ error: true, copy: leak.userMessage })
    setBusy(true)
    try {
      await invoke('tailor-order-action', {
        action: 'send-quote',
        orderId: data.order.id,
        amount: minor,
        currency: data.order.currency || 'USD',
        completionDate: new Date(`${completion}T12:00:00`).toISOString(),
        note: note.trim(),
        orderReview: { acknowledged: true, version: 'quote-order-review-2026-08-14-v1' },
      })
      setNotice({ error: false, copy: 'Quote saved. The customer can now review it.' })
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'Quote could not be saved.',
      })
    } finally {
      setBusy(false)
    }
  }
  async function advance() {
    const leak = filterContactInfo(note)
    if (!next) return
    if (leak.blocked) return setNotice({ error: true, copy: leak.userMessage })
    setBusy(true)
    try {
      await invoke('tailor-order-action', {
        action: 'advance-stage',
        orderId: data.order.id,
        targetStage: next,
        note: note.trim() || `Order moved to ${formatDatabaseEnumLabel(next)}.`,
      })
      setNotice({ error: false, copy: `Order moved to ${formatDatabaseEnumLabel(next)}.` })
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'Stage could not update.',
      })
    } finally {
      setBusy(false)
    }
  }
  const canQuote = ['PENDING_QUOTE', 'CONSULTATION'].includes(data.order.stage ?? '')
  const options = stageNext[data.order.stage ?? ''] ?? []
  if (!canQuote && !options.length) return null
  return (
    <section className="app-surface p-5" id="order-actions">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">Tailor action</p>
      <h2 className="mt-1 text-xl font-semibold text-ink">
        {canQuote ? 'Send a clear quote.' : 'Move production forward.'}
      </h2>
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`mt-3 rounded-[8px] p-3 text-sm font-semibold ${notice.error ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
        >
          {notice.copy}
        </p>
      ) : null}
      {canQuote ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-ink/55">
            Amount
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="mt-1 h-10 w-full rounded-[8px] border border-ui-border px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-ink/55">
            Completion date
            <input
              value={completion}
              onChange={(event) => setCompletion(event.target.value)}
              type="date"
              className="mt-1 h-10 w-full rounded-[8px] border border-ui-border px-3 text-sm"
            />
          </label>
        </div>
      ) : (
        <label className="mt-4 block text-xs font-semibold text-ink/55">
          Next stage
          <select
            value={next}
            onChange={(event) => setNext(event.target.value)}
            className="mt-1 h-10 w-full rounded-[8px] border border-ui-border px-3 text-sm"
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {formatDatabaseEnumLabel(value)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="mt-3 block text-xs font-semibold text-ink/55">
        Note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-[8px] border border-ui-border p-3 text-sm"
        />
      </label>
      <Button
        className="mt-3"
        disabled={busy}
        onClick={() => void (canQuote ? sendQuote() : advance())}
      >
        {busy ? 'Saving…' : canQuote ? 'Send quote' : 'Update stage'}
      </Button>
    </section>
  )
}

function OrderDetail({
  userId,
  data,
  refresh,
}: {
  userId: string
  data: Data
  refresh: () => void
}) {
  const order = data.order
  const tailor = isTailor(data, userId)
  const customer = order.customer_id === userId
  const activeQuote = data.quotes.find((quote) => quote.status === 'ACTIVE') ?? null
  const references = list(order.reference_photos)
  const facts: Array<[string, unknown]> = [
    ['Garment', order.garment_type],
    ['Size', order.item_size],
    ['Occasion', order.occasion],
    ['Fabric source', order.fabric_source],
    ['Fulfillment', order.delivery_method],
    [
      'Target date',
      data.detail?.target_delivery_date || order.quoted_completion_date || order.deadline,
    ],
  ]
  return (
    <div data-route-content-ready="true" className="grid gap-5 pb-12">
      <section className="app-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
              {formatDatabaseEnumLabel(order.order_kind, 'Order')} ·{' '}
              {order.reference || order.id.slice(0, 8)}
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">{title(order)}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/58">
              {text(
                order.garment_description || order.special_note,
                'The brief, conversation, payment, and production history remain attached to this order.'
              )}
            </p>
          </div>
          <StatusChip status={order.stage} fallback="Order" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/account/messages?orderId=${order.id}`}>Open conversation</Link>
          </Button>
          {customer && payableStages.has(order.stage ?? '') ? (
            <Button asChild variant="secondary">
              <Link href={`/account/checkout/${order.id}`}>Review payment</Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link href={`/account/support?orderId=${order.id}`}>Order support</Link>
          </Button>
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.65fr)]">
        <div className="grid gap-5">
          <section className="app-surface p-5">
            <h2 className="text-xl font-semibold text-ink">Order brief</h2>
            <dl className="mt-3">
              {facts.map(([label, value]) => (
                <Row
                  key={label}
                  label={label}
                  value={
                    label.includes('date') || label === 'Target date'
                      ? formatExplicitZonedDateTime(value as string) || text(value)
                      : formatDatabaseEnumLabel(value as string, text(value))
                  }
                />
              ))}
              <Row
                label="Style notes"
                value={text(data.detail?.style_notes || data.detail?.body_note)}
              />
              <Row label="Fabric" value={text(data.detail?.fabric_description)} />
            </dl>
            {references.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {references.slice(0, 8).map((src, index) => (
                  <a
                    key={src}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="overflow-hidden rounded-[8px] border border-ui-border"
                  >
                    <img
                      src={src}
                      alt={`Reference ${index + 1}`}
                      className="aspect-square h-full w-full object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}
          </section>
          <section className="app-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-ink">Production history</h2>
              <span className="text-xs text-ink/45">{data.stages.length} updates</span>
            </div>
            <div className="mt-4 grid gap-3">
              {data.stages.length ? (
                data.stages.map((stage) => (
                  <article key={stage.id} className="rounded-[8px] border border-ui-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <StatusChip status={stage.stage} fallback="Update" />
                      <time className="text-xs text-ink/42">
                        {formatRelative(stage.created_at)}
                      </time>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink/58">
                      {text(stage.note, 'Stage updated.')}
                    </p>
                    {stage.photo_url ? (
                      <a href={stage.photo_url} target="_blank" rel="noreferrer">
                        <img
                          src={stage.photo_url}
                          alt="Production evidence"
                          className="mt-3 max-h-64 rounded-[8px] object-contain"
                        />
                      </a>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="rounded-[8px] bg-ink/5 p-4 text-sm text-ink/55">
                  No production updates yet.
                </p>
              )}
            </div>
          </section>
          {tailor ? <TailorActions data={data} refresh={refresh} /> : null}
        </div>
        <aside className="grid h-fit gap-5">
          <section className="app-surface p-5">
            <h2 className="text-xl font-semibold text-ink">Commercial state</h2>
            <dl className="mt-3">
              <Row
                label="Quoted"
                value={formatMoney(
                  activeQuote?.total_amount ?? order.quoted_amount,
                  activeQuote?.currency || order.quoted_currency || order.currency
                )}
              />
              <Row
                label="Total"
                value={formatMoney(
                  order.total_amount ?? order.quoted_amount,
                  order.currency || order.quoted_currency
                )}
              />
              <Row
                label="Quote"
                value={<StatusChip status={activeQuote?.status} fallback="Not active" />}
              />
              {activeQuote?.expires_at ? (
                <Row
                  label="Valid until"
                  value={
                    formatExplicitZonedDateTime(activeQuote.expires_at) || activeQuote.expires_at
                  }
                />
              ) : null}
            </dl>
            {customer && payableStages.has(order.stage ?? '') ? (
              <Link
                href={`/account/checkout/${order.id}`}
                className="mt-4 inline-flex h-10 items-center rounded-[8px] bg-needle px-4 text-sm font-semibold text-white"
              >
                Continue to payment
              </Link>
            ) : null}
          </section>
          <section className="app-surface p-5">
            <h2 className="text-xl font-semibold text-ink">Payments</h2>
            <div className="mt-3 grid gap-2">
              {data.payments.length ? (
                data.payments.map((payment) => (
                  <div key={payment.id} className="rounded-[8px] border border-ui-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {formatDatabaseEnumLabel(payment.phase, 'Payment')}
                      </p>
                      <StatusChip status={payment.status} fallback="Pending" />
                    </div>
                    <p className="mt-2 text-sm font-semibold">
                      {formatMoney(payment.amount, payment.currency)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink/50">No payment recorded yet.</p>
              )}
            </div>
          </section>
          <section className="app-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-ink">Recent conversation</h2>
              <Link
                href={`/account/messages?orderId=${order.id}`}
                className="text-xs font-semibold text-needle"
              >
                Open all
              </Link>
            </div>
            <div className="mt-3 grid gap-2">
              {data.messages.length ? (
                data.messages.map((message) => (
                  <div key={message.id} className="rounded-[8px] bg-ink/4 p-3">
                    <p className="line-clamp-2 text-sm text-ink/64">
                      {text(
                        message.body,
                        message.photo_url ? 'Photo' : message.voice_url ? 'Voice note' : 'Message'
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink/40">
                      {message.sender_id === userId ? 'You' : 'Other party'} ·{' '}
                      {formatRelative(message.created_at)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink/50">No messages yet.</p>
              )}
            </div>
          </section>
          {data.events.length ? (
            <section className="app-surface p-5">
              <h2 className="text-xl font-semibold text-ink">Decision record</h2>
              <div className="mt-3 grid gap-2">
                {data.events.map((event) => (
                  <div key={event.id} className="border-b border-ink/7 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">
                        {text(
                          event.title,
                          formatDatabaseEnumLabel(event.event_type, 'Order update')
                        )}
                      </p>
                      <time className="text-xs text-ink/40">
                        {formatRelative(event.created_at)}
                      </time>
                    </div>
                    {event.summary ? (
                      <p className="mt-1 text-xs leading-5 text-ink/52">{event.summary}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function DetailRoute({ userId, orderId }: { userId: string; orderId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    void load(userId, orderId)
      .then((data) => {
        if (active) setState(data ? { status: 'ready', data } : { status: 'missing' })
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Order could not load.',
          })
      })
    return () => {
      active = false
    }
  }, [orderId, revision, userId])
  useEffect(() => {
    if (state.status !== 'ready') return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const queue = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 180)
    }
    const channel = supabase
      .channel(`web-order:${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        queue
      )
    for (const table of [
      'order_stage_updates',
      'order_payments',
      'messages',
      'order_quotes',
      'order_events',
    ])
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `order_id=eq.${orderId}` },
        queue
      )
    channel.subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [orderId, refresh, state])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-7" aria-busy="true">
        <p className="text-sm font-semibold text-ink/60">Loading complete order context…</p>
      </section>
    )
  if (state.status === 'missing')
    return (
      <section data-route-content-ready="true" className="app-surface p-7" role="alert">
        <h1 className="text-2xl font-semibold text-ink">Order not available.</h1>
        <p className="mt-2 text-sm text-ink/58">
          This order does not belong to the signed-in account, or it no longer exists.
        </p>
        <Link href="/account/orders" className="mt-4 inline-flex text-sm font-semibold text-needle">
          Return to orders
        </Link>
      </section>
    )
  if (state.status === 'error')
    return (
      <section className="app-surface p-7" role="alert">
        <h1 className="text-2xl font-semibold text-ink">Order unavailable</h1>
        <p className="mt-2 text-sm text-ink/58">{state.message}</p>
        <Button className="mt-4" onClick={refresh}>
          Try again
        </Button>
      </section>
    )
  return <OrderDetail userId={userId} data={state.data} refresh={refresh} />
}

export function OrderDetailWorkspace({ orderId }: { orderId: string }) {
  return (
    <AccountRouteRuntime surface="order-detail">
      {({ session }) => <DetailRoute userId={session.user.id} orderId={orderId} />}
    </AccountRouteRuntime>
  )
}
