'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatDatabaseEnumLabel,
  formatExplicitZonedDateTime,
  formatMoney,
  formatOrderPaymentPhase,
  formatTaxRate,
  taxCollectionPromise,
  taxLinesForReceiptSnapshot,
  taxLinesForSnapshot,
  taxSnapshotNeedsRefresh,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { StatusChip } from '../../../components/ui/status-chip'
import { AccountRouteRuntime } from '../account-route-runtime'

type Order = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  customer_id: string | null
  payment_provider: string | null
  delivery_method: string | null
  currency: string | null
  quoted_currency: string | null
  quoted_amount: number | null
  total_amount: number | null
  subtotal_amount: number | null
  platform_fee_amount: number | null
  shipping_amount: number | null
  tax_amount: number | null
  import_tax_amount: number | null
  duty_amount: number | null
  tax_region: string | null
  tax_rate_bps: number | null
  tax_fallback: boolean | null
  tax_collection_mode: string | null
  tax_responsible_party: string | null
  created_at: string | null
  updated_at: string | null
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
  refunded_at: string | null
}
type Receipt = {
  receipt_number: string
  order_id: string
  provider: string
  provider_reference: string
  currency: string
  subtotal_amount: number
  consultation_credit_amount: number
  promotion_amount: number
  platform_fee_amount: number
  tax_amount: number
  import_tax_amount: number
  duty_amount: number
  tax_collection_mode: string | null
  shipping_amount: number
  total_amount: number
  tax_jurisdiction: string | null
  paid_at: string | null
  fabric_funding_policy_version: string | null
  tailoring_amount: number | null
  fabric_allowance_amount: number | null
}
type Quote = {
  id: string
  order_id: string
  version: number
  status: string | null
  currency: string | null
  tailoring_amount: number | null
  fabric_allowance_amount: number | null
  fabric_funding_policy_version: string | null
  expires_at: string | null
}
type Data = { orders: Order[]; payments: Payment[]; receipts: Receipt[]; quotes: Quote[] }
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: Data }
  | { status: 'error'; message: string }
const payableStages = new Set(['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'])
const orderSelect =
  'id, reference, order_kind, garment_type, item_title, stage, customer_id, payment_provider, delivery_method, currency, quoted_currency, quoted_amount, total_amount, subtotal_amount, platform_fee_amount, shipping_amount, tax_amount, import_tax_amount, duty_amount, tax_region, tax_rate_bps, tax_fallback, tax_collection_mode, tax_responsible_party, created_at, updated_at'

function title(order: Order) {
  return order.item_title?.trim() || order.garment_type?.trim() || 'Drapeon order'
}
function currency(order: Order) {
  return order.currency || order.quoted_currency || 'USD'
}
function total(order: Order) {
  return order.total_amount ?? order.quoted_amount ?? 0
}
function isPaid(payment: Payment) {
  return ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? '')
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
    /* safe fallback */
  }
  return null
}
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body })
  if (error)
    throw new Error(
      (await functionError(error)) || 'That action could not finish. Refresh and try again.'
    )
  const result = (data ?? {}) as Record<string, unknown>
  if (result.error) throw new Error(String(result.message || result.error))
  return result as T
}
async function load(userId: string): Promise<Data> {
  const supabase = createClient()
  const ordersResult = await supabase
    .from('orders')
    .select(orderSelect)
    .eq('customer_id', userId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (ordersResult.error)
    throw new Error('Checkout orders could not load. Your records have not changed.')
  const orders = (ordersResult.data ?? []) as unknown as Order[]
  const ids = orders.map((order) => order.id)
  if (!ids.length) return { orders, payments: [], receipts: [], quotes: [] }
  const [paymentsResult, receiptsResult, quotesResult] = await Promise.all([
    supabase
      .from('order_payments')
      .select(
        'id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at'
      )
      .in('order_id', ids)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('commercial_receipts')
      .select(
        'receipt_number, order_id, provider, provider_reference, currency, subtotal_amount, consultation_credit_amount, promotion_amount, platform_fee_amount, tax_amount, import_tax_amount, duty_amount, tax_collection_mode, shipping_amount, total_amount, tax_jurisdiction, paid_at, fabric_funding_policy_version, tailoring_amount, fabric_allowance_amount'
      )
      .in('order_id', ids)
      .order('paid_at', { ascending: false })
      .limit(80),
    supabase
      .from('order_quotes')
      .select(
        'id, order_id, version, status, currency, tailoring_amount, fabric_allowance_amount, fabric_funding_policy_version, expires_at'
      )
      .in('order_id', ids)
      .order('version', { ascending: false })
      .limit(80),
  ])
  if (paymentsResult.error || receiptsResult.error || quotesResult.error)
    throw new Error('The latest payment ledger could not load. Refresh before taking action.')
  return {
    orders,
    payments: (paymentsResult.data ?? []) as Payment[],
    receipts: (receiptsResult.data ?? []) as Receipt[],
    quotes: (quotesResult.data ?? []) as Quote[],
  }
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-ink/7 py-2.5 last:border-0">
      <dt className="text-sm text-ink/55">{label}</dt>
      <dd className={`text-right text-sm text-ink ${strong ? 'font-bold' : 'font-semibold'}`}>
        {value}
      </dd>
    </div>
  )
}

type StripeCard = { mount(node: HTMLElement): void; unmount(): void; destroy?: () => void }
type StripeLike = {
  elements(): { create(kind: 'card', options?: Record<string, unknown>): StripeCard }
  confirmCardPayment(
    clientSecret: string,
    options: { payment_method: { card: StripeCard } }
  ): Promise<{ error?: { message?: string }; paymentIntent?: { id?: string; status?: string } }>
}
function stripeFactory() {
  return (window as unknown as Record<string, unknown>).Stripe as
    | ((key: string) => StripeLike | null)
    | undefined
}
let stripeLoader: Promise<void> | null = null
function loadStripe() {
  if (stripeFactory()) return Promise.resolve()
  if (stripeLoader) return stripeLoader
  stripeLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3/'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Stripe could not load.'))
    document.head.appendChild(script)
  })
  return stripeLoader
}

function StripeAuthorization({
  clientSecret,
  orderId,
  onDone,
}: {
  clientSecret: string
  orderId: string
  onDone: () => void
}) {
  const mount = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeLike | null>(null)
  const paymentElementRef = useRef<StripeCard | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const key = (
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ||
      ''
    ).trim()
    if (!key) {
      queueMicrotask(() => { if (active) setError('Stripe configuration is unavailable. Use Support before retrying.') })
      return
    }
    void loadStripe()
      .then(() => {
        const factory = stripeFactory()
        if (!active || !mount.current || !factory) return
        const stripe = factory(key)
        if (!stripe) throw new Error('Stripe checkout could not initialize.')
        const element = stripe.elements().create('card', { hidePostalCode: true })
        element.mount(mount.current)
        stripeRef.current = stripe
        paymentElementRef.current = element
        setReady(true)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Stripe could not load.'))
    return () => {
      active = false
      paymentElementRef.current?.unmount()
    }
  }, [clientSecret])
  async function confirm() {
    if (!stripeRef.current || !paymentElementRef.current || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await stripeRef.current.confirmCardPayment(clientSecret, {
        payment_method: { card: paymentElementRef.current },
      })
      if (result.error) throw new Error(result.error.message || 'Payment authorization failed.')
      if (!result.paymentIntent?.id)
        throw new Error('Stripe did not return a payment confirmation.')
      await invoke('payment-action', {
        action: 'confirm-payment',
        orderId,
        paymentIntentId: result.paymentIntent.id,
      })
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be confirmed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 rounded-[8px] border border-ui-border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">
        Secure card payment
      </p>
      <div ref={mount} className="mt-3 min-h-14 rounded-[8px] border border-ui-border p-3" />
      {error ? (
        <p role="alert" className="mt-3 rounded-[8px] bg-rust/10 p-3 text-sm text-rust">
          {error}
        </p>
      ) : null}
      <Button className="mt-3 w-full" disabled={!ready || busy} onClick={() => void confirm()}>
        {busy ? 'Confirming…' : ready ? 'Authorize card' : 'Loading Stripe…'}
      </Button>
      <p className="mt-2 text-xs text-ink/45">
        Card details are handled by Stripe. Drapeon never receives the card number.
      </p>
    </div>
  )
}

function CheckoutAction({
  order,
  quote,
  refresh,
}: {
  order: Order
  quote: Quote | null
  refresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; copy: string } | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const taxBlocked = taxSnapshotNeedsRefresh({
    taxRegion: order.tax_region,
    taxRateBps: order.tax_rate_bps,
    taxFallback: order.tax_fallback,
  })
  async function pay() {
    if (taxBlocked) {
      setNotice({
        tone: 'error',
        copy: 'The tailor must refresh this tax snapshot before payment.',
      })
      return
    }
    if (order.order_kind === 'CUSTOM' && order.stage === 'QUOTE_SENT' && !quote) {
      setNotice({ tone: 'error', copy: 'The active quote is unavailable. Refresh before paying.' })
      return
    }
    setBusy(true)
    setClientSecret(null)
    setNotice({ tone: 'success', copy: 'Preparing payment. Do not open another checkout.' })
    try {
      const result = await invoke<{
        confirmed?: boolean
        alreadyPaid?: boolean
        provider?: string
        authorizationUrl?: string
        clientSecret?: string
      }>('payment-action', {
        action: 'prepare-payment',
        orderId: order.id,
        ...(quote ? { quoteId: quote.id, expectedQuoteVersion: quote.version } : {}),
      })
      if (result.confirmed || result.alreadyPaid) {
        setNotice({
          tone: 'success',
          copy: 'Payment is already confirmed. The existing receipt is shown here.',
        })
        refresh()
        return
      }
      if (result.authorizationUrl) {
        setNotice({ tone: 'success', copy: 'Opening the secure provider checkout.' })
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.provider === 'STRIPE' && result.clientSecret) {
        setClientSecret(result.clientSecret)
        setNotice({ tone: 'success', copy: 'Secure card authorization is ready.' })
        return
      }
      setNotice({
        tone: 'error',
        copy: 'The provider did not return a checkout. Refresh once, then contact Support.',
      })
    } catch (cause) {
      setNotice({
        tone: 'error',
        copy: cause instanceof Error ? cause.message : 'Payment could not start.',
      })
    } finally {
      setBusy(false)
    }
  }
  async function decline() {
    if (!armed) {
      setArmed(true)
      setNotice({ tone: 'success', copy: 'Select Confirm decline to close this quote.' })
      return
    }
    if (!quote) {
      setNotice({
        tone: 'error',
        copy: 'The active quote is unavailable. Refresh before declining.',
      })
      return
    }
    setBusy(true)
    try {
      await invoke('customer-order-action', {
        action: 'decline-quote',
        orderId: order.id,
        quoteId: quote.id,
        expectedQuoteVersion: quote.version,
      })
      setNotice({ tone: 'success', copy: 'Quote declined. The order is closed.' })
      setArmed(false)
      refresh()
    } catch (cause) {
      setNotice({
        tone: 'error',
        copy: cause instanceof Error ? cause.message : 'Quote could not be declined.',
      })
    } finally {
      setBusy(false)
    }
  }
  if (!payableStages.has(order.stage ?? ''))
    return (
      <p className="rounded-[8px] bg-ink/5 p-4 text-sm text-ink/60">
        This order is not awaiting payment. Open its timeline for the current next step.
      </p>
    )
  return (
    <div className="grid gap-3">
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-[8px] p-3 text-sm font-semibold ${notice.tone === 'error' ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
        >
          {notice.copy}
        </p>
      ) : null}
      <Button disabled={busy || taxBlocked} onClick={() => void pay()}>
        {busy
          ? 'Preparing checkout…'
          : taxBlocked
            ? 'Tax update needed'
            : order.stage === 'PAYMENT_FAILED'
              ? 'Retry payment'
              : 'Continue securely'}
      </Button>
      {order.order_kind === 'CUSTOM' && order.stage === 'QUOTE_SENT' ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void decline()}
          className="text-rust"
        >
          {armed ? 'Confirm decline' : 'Decline quote'}
        </Button>
      ) : null}
      {clientSecret ? (
        <StripeAuthorization
          clientSecret={clientSecret}
          orderId={order.id}
          onDone={() => {
            setClientSecret(null)
            refresh()
          }}
        />
      ) : null}
      <p className="text-xs leading-5 text-ink/48">
        Existing provider attempts are reused. Reloading or selecting the action twice does not
        create a second charge.
      </p>
    </div>
  )
}

function CheckoutContent({
  requestedId,
  data,
  refresh,
}: {
  requestedId: string | null
  data: Data
  refresh: () => void
}) {
  const order = requestedId
    ? (data.orders.find((entry) => entry.id === requestedId) ?? null)
    : (data.orders.find((entry) => payableStages.has(entry.stage ?? '')) ?? data.orders[0] ?? null)
  if (!order)
    return (
      <section data-route-content-ready="true" className="app-surface p-7">
        <h1 className="text-2xl font-semibold text-ink">No payment is waiting.</h1>
        <p className="mt-2 text-sm text-ink/58">
          Checkout appears after a quote, ready-made purchase, or payment retry is ready.
        </p>
        <Link href="/account/orders" className="mt-4 inline-flex text-sm font-semibold text-needle">
          View orders
        </Link>
      </section>
    )
  if (requestedId && !order) return null
  const payments = data.payments.filter((entry) => entry.order_id === order.id)
  const receipt = data.receipts.find((entry) => entry.order_id === order.id) ?? null
  const quote =
    data.quotes.find((entry) => entry.order_id === order.id && entry.status === 'ACTIVE') ?? null
  const paid = payments.some(isPaid)
  const taxLines = taxLinesForSnapshot({
    taxRegion: order.tax_region,
    taxRateBps: order.tax_rate_bps,
    taxAmount: Math.max(
      (order.tax_amount ?? 0) - (order.import_tax_amount ?? 0) - (order.duty_amount ?? 0),
      0
    ),
  })
  const receiptTaxLines = receipt
    ? taxLinesForReceiptSnapshot({
        taxJurisdiction: receipt.tax_jurisdiction,
        taxAmount: Math.max(
          receipt.tax_amount - receipt.import_tax_amount - receipt.duty_amount,
          0
        ),
      })
    : []
  const promise =
    order.tax_collection_mode && order.tax_responsible_party
      ? taxCollectionPromise({
          collectionMode: order.tax_collection_mode as
            | 'COLLECTED_AT_CHECKOUT'
            | 'PAYABLE_ON_IMPORT'
            | 'BLOCKED',
          responsibleParty: order.tax_responsible_party as
            | 'TAILOR'
            | 'DRAPEON_MARKETPLACE_FACILITATOR'
            | 'CUSTOMER_IMPORTER',
        })
      : null
  return (
    <div
      data-route-content-ready="true"
      className="grid gap-5 pb-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.75fr)]"
    >
      <section className="app-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
          {paid || receipt
            ? 'Payment confirmed'
            : payableStages.has(order.stage ?? '')
              ? 'Payment needed'
              : 'Payment status'}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{title(order)}</h1>
        <p className="mt-2 text-sm leading-6 text-ink/58">
          Review the locked amount and provider status before continuing. Payment, receipt, and
          recovery stay attached to this order.
        </p>
        <dl className="mt-5">
          <Row
            label="Order reference"
            value={order.reference || order.id.slice(0, 8).toUpperCase()}
          />
          <Row label="Status" value={<StatusChip status={order.stage} fallback="Order" />} />
          <Row
            label="Fulfillment"
            value={formatDatabaseEnumLabel(order.delivery_method, 'Not selected')}
          />
          <Row
            label="Provider"
            value={formatDatabaseEnumLabel(order.payment_provider, 'Selected at payment')}
          />
        </dl>
        <div className="mt-5 rounded-[8px] border border-ui-border bg-ui-canvas p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">
            Locked checkout
          </p>
          <dl className="mt-2">
            {quote?.fabric_funding_policy_version &&
            quote.tailoring_amount != null &&
            quote.fabric_allowance_amount != null ? (
              <>
                <Row
                  label="Tailoring and construction"
                  value={formatMoney(quote.tailoring_amount, quote.currency)}
                />
                <Row
                  label="Protected fabric allowance"
                  value={formatMoney(quote.fabric_allowance_amount, quote.currency)}
                />
              </>
            ) : (
              <Row
                label="Tailor work and materials"
                value={formatMoney(order.subtotal_amount, currency(order))}
              />
            )}
            {(order.platform_fee_amount ?? 0) > 0 ? (
              <Row
                label="Drapeon service fee"
                value={formatMoney(order.platform_fee_amount, currency(order))}
              />
            ) : null}
            <Row
              label="Fulfillment"
              value={
                (order.shipping_amount ?? 0) > 0
                  ? formatMoney(order.shipping_amount, currency(order))
                  : 'Free'
              }
            />
            {taxLines.map((line) => (
              <Row
                key={line.key}
                label={`${order.tax_fallback ? 'Estimated ' : ''}${line.label}${line.rateBps ? ` (${formatTaxRate(line.rateBps)})` : ''}`}
                value={formatMoney(line.amount, currency(order))}
              />
            ))}
            {(order.import_tax_amount ?? 0) > 0 ? (
              <Row
                label="Import tax"
                value={formatMoney(order.import_tax_amount, currency(order))}
              />
            ) : null}
            {(order.duty_amount ?? 0) > 0 ? (
              <Row label="Customs duty" value={formatMoney(order.duty_amount, currency(order))} />
            ) : null}
            <Row label="Total due" value={formatMoney(total(order), currency(order))} strong />
            {quote?.expires_at ? (
              <Row
                label="Quote valid until"
                value={formatExplicitZonedDateTime(quote.expires_at) || quote.expires_at}
              />
            ) : null}
          </dl>
          {promise ? (
            <div className="mt-3 rounded-[8px] bg-white p-3">
              <p className="text-sm font-semibold text-ink">{promise.title}</p>
              <p className="mt-1 text-xs text-ink/55">{promise.body}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-5">
          {paid || receipt ? (
            <div className="rounded-[8px] bg-needle/8 p-4 text-sm font-semibold text-needle">
              Payment is recorded. Continue from the order timeline.
            </div>
          ) : (
            <CheckoutAction order={order} quote={quote} refresh={refresh} />
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href={`/account/orders/${order.id}`}>Back to order</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/account/support?orderId=${order.id}`}>Payment support</Link>
          </Button>
        </div>
      </section>
      <aside className="app-surface h-fit p-6">
        <h2 className="text-2xl font-semibold text-ink">
          {receipt ? 'Receipt' : 'Payment ledger'}
        </h2>
        {receipt ? (
          <dl className="mt-4">
            <Row label="Receipt" value={receipt.receipt_number} />
            {receipt.fabric_funding_policy_version &&
            receipt.tailoring_amount != null &&
            receipt.fabric_allowance_amount != null ? (
              <>
                <Row
                  label="Tailoring and construction"
                  value={formatMoney(
                    receipt.tailoring_amount + receipt.consultation_credit_amount,
                    receipt.currency
                  )}
                />
                <Row
                  label="Protected fabric allowance"
                  value={formatMoney(receipt.fabric_allowance_amount, receipt.currency)}
                />
              </>
            ) : (
              <Row
                label="Tailor work and materials"
                value={formatMoney(
                  receipt.subtotal_amount + receipt.consultation_credit_amount,
                  receipt.currency
                )}
              />
            )}
            {receipt.promotion_amount > 0 ? (
              <Row
                label="Drapeon-funded benefit"
                value={`−${formatMoney(receipt.promotion_amount, receipt.currency)}`}
              />
            ) : null}
            {receipt.platform_fee_amount > 0 ? (
              <Row
                label="Service fee"
                value={formatMoney(receipt.platform_fee_amount, receipt.currency)}
              />
            ) : null}
            <Row
              label="Fulfillment"
              value={
                receipt.shipping_amount > 0
                  ? formatMoney(receipt.shipping_amount, receipt.currency)
                  : 'Free'
              }
            />
            {receiptTaxLines.map((line) => (
              <Row
                key={line.key}
                label={`${line.label}${line.rateBps ? ` (${formatTaxRate(line.rateBps)})` : ''}`}
                value={formatMoney(line.amount, receipt.currency)}
              />
            ))}
            <Row
              label="Total paid"
              value={formatMoney(receipt.total_amount, receipt.currency)}
              strong
            />
            <Row
              label="Provider reference"
              value={`${formatDatabaseEnumLabel(receipt.provider, 'Provider')} · ${receipt.provider_reference}`}
            />
            <Row label="Paid" value={formatExplicitZonedDateTime(receipt.paid_at) || 'Recorded'} />
          </dl>
        ) : payments.length ? (
          <div className="mt-4 grid gap-3">
            {payments.map((payment) => (
              <div key={payment.id} className="rounded-[8px] border border-ui-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">
                    {formatOrderPaymentPhase(payment.phase)}
                  </p>
                  <StatusChip status={payment.status} fallback="Pending" />
                </div>
                <p className="mt-2 text-lg font-semibold text-ink">
                  {formatMoney(payment.amount, payment.currency)}
                </p>
                <p className="mt-1 text-xs text-ink/45">
                  {formatExplicitZonedDateTime(payment.confirmed_at || payment.created_at) ||
                    'Provider attempt recorded'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-[8px] bg-ink/5 p-4 text-sm leading-6 text-ink/58">
            No provider attempt is recorded. If you already paid, do not retry. Open Support with
            this order attached.
          </p>
        )}
      </aside>
    </div>
  )
}

function CheckoutRoute({ userId, orderId }: { userId: string; orderId: string | null }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    void load(userId)
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Checkout could not load.',
          })
      })
    return () => {
      active = false
    }
  }, [revision, userId])
  useEffect(() => {
    if (state.status !== 'ready') return
    const ids = state.data.orders.map((order) => order.id)
    if (!ids.length) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const queue = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 180)
    }
    const filter = `order_id=in.(${ids.join(',')})`
    const channel = supabase
      .channel(`web-checkout:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${userId}` },
        queue
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_payments', filter },
        queue
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'commercial_receipts', filter },
        queue
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_quotes', filter },
        queue
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [refresh, state, userId])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-7" aria-busy="true">
        <p className="text-sm font-semibold text-ink/60">Loading secure checkout…</p>
      </section>
    )
  if (state.status === 'error')
    return (
      <section className="app-surface p-7" role="alert">
        <h1 className="text-2xl font-semibold text-ink">Checkout unavailable</h1>
        <p className="mt-2 text-sm text-ink/58">{state.message}</p>
        <Button className="mt-5" onClick={refresh}>
          Try again
        </Button>
      </section>
    )
  if (orderId && !state.data.orders.some((order) => order.id === orderId))
    return (
      <section data-route-content-ready="true" className="app-surface p-7" role="alert">
        <h1 className="text-2xl font-semibold text-ink">Payment not available.</h1>
        <p className="mt-2 text-sm text-ink/58">
          This order does not belong to the signed-in customer, or it no longer exists.
        </p>
        <Link href="/account/orders" className="mt-4 inline-flex text-sm font-semibold text-needle">
          Return to orders
        </Link>
      </section>
    )
  return <CheckoutContent requestedId={orderId} data={state.data} refresh={refresh} />
}

export function CheckoutWorkspace({ orderId }: { orderId?: string }) {
  const params = useSearchParams()
  const requestedId = orderId || params.get('orderId') || null
  return (
    <AccountRouteRuntime surface="checkout">
      {({ session }) => <CheckoutRoute userId={session.user.id} orderId={requestedId} />}
    </AccountRouteRuntime>
  )
}
