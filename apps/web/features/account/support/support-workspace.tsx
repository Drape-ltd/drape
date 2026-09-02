'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { CONTACTS, buildWhatsAppSupportUrl, formatDatabaseEnumLabel } from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Textarea } from '../../../components/ui/textarea'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'

type SupportOrder = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
}
type SupportData = { role: 'CUSTOMER' | 'TAILOR'; orders: SupportOrder[] }
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: SupportData }
  | { status: 'error'; message: string }
type Category =
  | 'PAYMENT'
  | 'FIT'
  | 'DELIVERY_HANDOFF'
  | 'ACCOUNT_SECURITY'
  | 'TAILOR_PAYOUT'
  | 'GENERAL'
const categories: Array<[Category, string]> = [
  ['PAYMENT', 'Payment issue'],
  ['FIT', 'Fit or alteration issue'],
  ['DELIVERY_HANDOFF', 'Delivery or handoff issue'],
  ['ACCOUNT_SECURITY', 'Account or security issue'],
  ['TAILOR_PAYOUT', 'Tailor payout or setup issue'],
  ['GENERAL', 'Something else'],
]
const handoffTypes = [
  ['AT_PICKUP', 'At pickup'],
  ['CANT_FIND_LOCATION', 'Cannot find location'],
  ['COUNTERPART_NOT_RESPONDING', 'Other party not responding'],
  ['ORDER_NOT_READY', 'Order not ready'],
  ['COURIER_OR_DELIVERY_ISSUE', 'Courier or delivery issue'],
  ['NEED_DRAPE_HELP', 'Need Drapeon help'],
]
const terminal = new Set([
  'COMPLETE',
  'COMPLETED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
])
const title = (order: SupportOrder) =>
  order.reference?.trim() ||
  order.item_title?.trim() ||
  order.garment_type?.trim() ||
  'Drapeon order'

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context?.clone) {
      try {
        const payload = (await context.clone().json()) as { error?: string; message?: string }
        message = payload.error || payload.message || message
      } catch {
        /* retain SDK message */
      }
    }
    throw new Error(message)
  }
  const payload = (data ?? {}) as { error?: string }
  if (payload.error) throw new Error(payload.error)
  return data as T
}

async function loadSupport(userId: string): Promise<SupportData> {
  const supabase = createClient()
  const tailorResult = await supabase
    .from('tailor_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (tailorResult.error) throw new Error('Your support role could not be confirmed.')
  const tailorId = (tailorResult.data as { id?: string } | null)?.id ?? null
  const filter = tailorId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`
  const ordersResult = await supabase
    .from('orders')
    .select(
      'id, reference, order_kind, garment_type, item_title, stage, customer_id, tailor_id, tailor_profile_id'
    )
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(12)
  if (ordersResult.error) throw new Error('Order context could not load. Refresh to retry.')
  return {
    role: tailorId ? 'TAILOR' : 'CUSTOMER',
    orders: (ordersResult.data ?? []) as SupportOrder[],
  }
}

function Notice({ error, receipt }: { error: string | null; receipt: string | null }) {
  if (!error && !receipt) return null
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`rounded-[8px] border px-4 py-3 text-sm ${error ? 'border-rust/20 bg-rust/7 text-rust' : 'border-needle/20 bg-needle/7 text-needle'}`}
    >
      {error ?? receipt}
    </div>
  )
}

function SupportForms({ data, onRefresh }: { data: SupportData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const linked = searchParams.get('orderId')
  const initialOrder = linked && data.orders.some((order) => order.id === linked) ? linked : ''
  const [category, setCategory] = useState<Category>(
    data.role === 'TAILOR' ? 'TAILOR_PAYOUT' : 'PAYMENT'
  )
  const [orderId, setOrderId] = useState(initialOrder)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const activeOrders = useMemo(
    () => data.orders.filter((order) => !terminal.has(order.stage ?? '')),
    [data.orders]
  )
  const [handoffOrderId, setHandoffOrderId] = useState(initialOrder || activeOrders[0]?.id || '')
  const [handoffType, setHandoffType] = useState('NEED_DRAPE_HELP')
  const [handoffDescription, setHandoffDescription] = useState('')
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [handoffReceipt, setHandoffReceipt] = useState<string | null>(null)

  async function submit() {
    setError(null)
    setReceipt(null)
    if (filterContactInfo(`${subject}\n${description}`).blocked) {
      setError(
        "Support requests can't include phone numbers, email addresses, social handles, or off-platform contact details."
      )
      return
    }
    if (subject.trim().length < 3 || description.trim().length < 10) {
      setError('Add a short subject and enough detail for Drapeon to understand what happened.')
      return
    }
    setBusy(true)
    try {
      const result = await invoke<{ issueNumber?: number | null }>('account-support-action', {
        action: 'submit-support',
        category,
        orderId: orderId || undefined,
        subject: subject.trim(),
        description: description.trim(),
      })
      const message = result.issueNumber
        ? `Support request #${String(result.issueNumber).padStart(4, '0')} is open.`
        : 'Support request opened for review.'
      setReceipt(`${message} Keep this reference for follow-up.`)
      setSubject('')
      setDescription('')
      onRefresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Support could not open. Your message is still here; retry.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitHandoff() {
    setHandoffError(null)
    setHandoffReceipt(null)
    if (!handoffOrderId || handoffDescription.trim().length < 10) {
      setHandoffError('Choose an active order and describe the handoff problem.')
      return
    }
    if (filterContactInfo(handoffDescription).blocked) {
      setHandoffError("Support notes can't include contact details.")
      return
    }
    setHandoffBusy(true)
    try {
      await invoke('handoff-support-action', {
        action: 'report-issue',
        orderId: handoffOrderId,
        issueType: handoffType,
        description: handoffDescription.trim(),
      })
      setHandoffReceipt(
        'Handoff help is open on this order. Its stage and support context remain attached.'
      )
      setHandoffDescription('')
      onRefresh()
    } catch (cause) {
      setHandoffError(
        cause instanceof Error
          ? cause.message
          : 'Handoff help could not open. Your note is still here; retry.'
      )
    } finally {
      setHandoffBusy(false)
    }
  }

  const faq =
    data.role === 'TAILOR'
      ? [
          [
            'How do I respond to a brief?',
            'Open the order, review its fit and delivery context, then send a quote or request a consultation.',
          ],
          [
            'Why is payout blocked?',
            'Open Payout for the authoritative provider state and exact recovery action.',
          ],
          [
            'How do I change availability?',
            'Open Profile. Pausing new bookings never hides active orders.',
          ],
        ]
      : [
          [
            'How do I cancel?',
            'Open the order. Eligible pre-production cancellations appear as contextual actions; later requests require review.',
          ],
          [
            'What if the fit is wrong?',
            'Message the tailor on the order first, then open a fit request here if help is needed.',
          ],
          [
            'How do I update measurements?',
            'Use Measurements on web. Drapeon Vision capture remains in the mobile app.',
          ],
        ]
  return (
    <div data-route-content-ready="true" className="grid gap-5 pb-10">
      <Surface>
        <SurfaceHeader
          eyebrow="Protected support"
          title="Ask Drapeon for help"
          description="Open a request tied to your account, and attach the order when the issue concerns payment, fit, delivery, production, or payout."
        />
        <div className="grid gap-3 p-5">
          <Notice error={error} receipt={receipt} />
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="sr-only">Support category</span>
              <NativeSelect
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {categories.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <span className="sr-only">Related order</span>
              <NativeSelect value={orderId} onChange={(event) => setOrderId(event.target.value)}>
                <option value="">No order attached</option>
                {data.orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {title(order)} · {formatDatabaseEnumLabel(order.stage, 'In progress')}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <Input
            aria-label="Support subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={120}
            placeholder="Short subject"
          />
          <Textarea
            aria-label="Support description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={1500}
            placeholder="Tell us what happened inside Drapeon. Keep contact details out of the request."
          />
          <div>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? 'Opening support…' : 'Open support request'}
            </Button>
            <p className="mt-2 text-xs text-ink/46">
              Your text stays in place if submission fails.
            </p>
          </div>
        </div>
      </Surface>
      {activeOrders.length ? (
        <Surface>
          <SurfaceHeader
            eyebrow="Active handoff"
            title="Pickup or delivery help"
            description="Use this only when an active order has reached pickup, dispatch, or delivery. Other concerns belong in the request above."
          />
          <div className="grid gap-3 p-5">
            <Notice error={handoffError} receipt={handoffReceipt} />
            <div className="grid gap-3 md:grid-cols-2">
              <NativeSelect
                aria-label="Handoff order"
                value={handoffOrderId}
                onChange={(event) => setHandoffOrderId(event.target.value)}
              >
                {activeOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {title(order)} · {formatDatabaseEnumLabel(order.stage, 'In progress')}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Handoff issue"
                value={handoffType}
                onChange={(event) => setHandoffType(event.target.value)}
              >
                {handoffTypes.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Textarea
              aria-label="Handoff description"
              value={handoffDescription}
              onChange={(event) => setHandoffDescription(event.target.value)}
              rows={3}
              placeholder="Describe the pickup or delivery issue without contact details."
            />
            <Button onClick={() => void submitHandoff()} disabled={handoffBusy}>
              {handoffBusy ? 'Opening handoff help…' : 'Open handoff help'}
            </Button>
          </div>
        </Surface>
      ) : null}
      <Surface>
        <SurfaceHeader
          title="Common questions"
          description={`Answers for ${data.role === 'TAILOR' ? 'tailor' : 'customer'} workflows.`}
        />
        {faq.map(([question, answer], index) => (
          <details key={question} className={index ? 'border-t border-ui-border' : ''}>
            <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
              <span className="text-sm font-semibold text-ink">{question}</span>
              <ChevronDown className="size-4 text-ink/40" />
            </summary>
            <p className="border-t border-ui-border bg-ui-muted/50 px-5 py-4 text-sm leading-6 text-ink/62">
              {answer}
            </p>
          </details>
        ))}
      </Surface>
      <Surface>
        <SurfaceHeader
          title="Direct contact"
          description="Use the protected form above when account or order context matters."
        />
        <a
          href={buildWhatsAppSupportUrl(
            `Hi Drapeon, I need ${data.role === 'TAILOR' ? 'tailor' : 'customer'} support.`
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-5 py-4 text-sm font-semibold text-needle"
        >
          WhatsApp support
          <ChevronRight className="size-4" />
        </a>
        <a
          href={`mailto:${CONTACTS.support}`}
          className="flex items-center justify-between border-t border-ui-border px-5 py-4 text-sm font-semibold text-needle"
        >
          {CONTACTS.support}
          <ChevronRight className="size-4" />
        </a>
        <Link
          href="/account/orders"
          className="flex items-center justify-between border-t border-ui-border px-5 py-4 text-sm font-semibold text-needle"
        >
          Review orders
          <ChevronRight className="size-4" />
        </Link>
      </Surface>
    </div>
  )
}

function SupportRoute({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    void loadSupport(userId)
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((cause) => {
        if (active)
          setState({
            status: 'error',
            message: cause instanceof Error ? cause.message : 'Support could not load.',
          })
      })
    return () => {
      active = false
    }
  }, [revision, userId])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-7" aria-busy="true">
        Loading support…
      </section>
    )
  if (state.status === 'error')
    return (
      <section className="app-surface p-7" role="alert">
        <h2 className="text-2xl font-semibold text-ink">Support unavailable</h2>
        <p className="mt-2 text-sm text-ink/62">{state.message}</p>
        <Button onClick={refresh} className="mt-5">
          Try again
        </Button>
      </section>
    )
  return <SupportForms data={state.data} onRefresh={refresh} />
}

export function SupportWorkspace() {
  return (
    <AccountRouteRuntime surface="support">
      {({ session }) => <SupportRoute userId={session.user.id} />}
    </AccountRouteRuntime>
  )
}
