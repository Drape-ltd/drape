'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  CUSTOM_PRODUCTION_STAGE_LABELS,
  CUSTOM_PRODUCTION_STAGE_REQUIREMENTS,
  MEDIA_LIMITS_BYTES,
  buildBriefDossier,
  filterContactInfo,
  formatDatabaseEnumLabel,
  formatExplicitZonedDateTime,
  formatCallCountdown,
  formatMoney,
  formatMoneyInputValue,
  formatRelative,
  isFundedFabricPolicy,
  isVideoMediaUrl,
  isMeaningfulTailorQuoteDraft,
  normalizeAccountCurrency,
  parseMoneyInputToMinorUnits,
  QUOTE_ORDER_REVIEW_COPY,
  QUOTE_ORDER_REVIEW_VERSION,
  readyMadeStageLabel,
  readyMadeTailorNextStages,
  getCallLifecycleState,
  TAILOR_QUOTE_DRAFT_VERSION,
  type BriefDossierRow,
  type FabricAllowanceCoverageCode,
  type TailorQuoteDraftFields,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { MoneyInput } from '../../../components/money-input'
import { StatusChip } from '../../../components/ui/status-chip'
import { AccountRouteRuntime } from '../account-route-runtime'
import { FabricWorkflowPanel } from '../../../components/fabric-workflow-panel'
import { ConsultationLifecyclePanel } from '../../../components/consultation-lifecycle-panel'
import { ConsultationAttendancePanel } from '../../../components/consultation-attendance-panel'
import { ConsultationReschedulePanel } from '../../../components/consultation-reschedule-panel'
import { MediaViewerDialog } from '../../../components/ui/media-viewer-dialog'
import { AccountDrapeonDispatchCard } from '../../../components/account-app-surface'

type Order = Record<string, unknown> & {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  garment_description: string | null
  item_title: string | null
  item_size: string | null
  item_quantity: number | null
  stage: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  currency: string | null
  quoted_currency: string | null
  quoted_amount: number | null
  total_amount: number | null
  delivery_method: string | null
  occasion: string | null
  fabric_source: string | null
  fabric_funding_policy_version: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_phone: string | null
  deadline: string | null
  quoted_completion_date: string | null
  created_at: string | null
  updated_at: string | null
  reference_photos: unknown
  special_note: string | null
  fabric_tracking: string | null
  tracking_number: string | null
  carrier: string | null
  fulfillment_provider: string | null
  fulfillment_reference: string | null
  fulfillment_contact_name: string | null
  fulfillment_contact_phone: string | null
  customer_measurements_snapshot: unknown
  collection_code: string | null
  collection_code_expiry: string | null
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
type Review = {
  id: string
  order_id: string
  rating: number
  body: string | null
  tags: string[] | null
}
type Tip = { id: string; order_id: string; amount: number; currency: string; status: string }
type CustomDetail = Record<string, unknown> & {
  garment_type_other?: string | null
  gender_presentation?: string | null
  style_notes?: string | null
  body_note?: string | null
  fabric_description?: string | null
  fabric_budget_amount?: number | null
  fabric_budget_currency?: string | null
  fabric_sourcing_deadline_days?: number | null
  fabric_sourcing_deadline_at?: string | null
  fabric_approval_status?: string | null
  shipping_preference?: string | null
  target_delivery_date?: string | null
  delivery_instructions?: string | null
  social_reference_links?: unknown
}
type ConsultationMeta = {
  status?: string | null
  requestedBy?: string | null
  proposedStartAt?: string | null
  scheduledStartAt?: string | null
  timezone?: string | null
  requestNote?: string | null
  requestExpiresAt?: string | null
  feeAmount?: number | null
  feeCurrency?: string | null
  feeCreditable?: boolean | null
  paymentTiming?: string | null
  paidAt?: string | null
  callType?: string | null
}
type Data = {
  order: Order
  tailorProfileId: string | null
  stages: StageUpdate[]
  payments: Payment[]
  messages: Message[]
  quotes: Quote[]
  events: Event[]
  reviews: Review[]
  tips: Tip[]
  customerName: string
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
function isReadyMade(order: Pick<Order, 'order_kind'>) {
  return order.order_kind === 'READY_MADE'
}
function stageOptions(order: Pick<Order, 'order_kind' | 'stage' | 'delivery_method'>) {
  if (!isReadyMade(order)) return stageNext[order.stage ?? ''] ?? []
  return readyMadeTailorNextStages(order.stage, order.delivery_method)
}
function stageChoiceLabel(order: Pick<Order, 'order_kind'>, stage: string) {
  return isReadyMade(order)
    ? (readyMadeStageLabel(stage) ?? formatDatabaseEnumLabel(stage))
    : formatDatabaseEnumLabel(stage)
}
function customProductionRequirement(targetStage: string) {
  const stageKey =
    targetStage === 'DESIGNING' || targetStage === 'SOURCING'
      ? 'PRE_CUTTING'
      : targetStage === 'CUTTING'
        ? 'CUTTING'
        : targetStage === 'SEWING'
          ? 'SEWING'
          : targetStage === 'FINISHING'
            ? 'FINISHING'
            : targetStage === 'READY_FOR_COLLECTION'
              ? 'QUALITY_CHECK'
              : null
  return stageKey
    ? {
        stageKey,
        label: CUSTOM_PRODUCTION_STAGE_LABELS[stageKey],
        ...CUSTOM_PRODUCTION_STAGE_REQUIREMENTS[stageKey],
      }
    : null
}
function SelectedProofPreviews({
  files,
  onRemove,
}: {
  files: File[]
  onRemove: (index: number) => void
}) {
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files]
  )
  useEffect(
    () => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)),
    [previews]
  )
  if (previews.length === 0) return null
  return (
    <ul className="mt-3 grid gap-3 sm:grid-cols-2">
      {previews.map(({ file, url }, index) => (
        <li key={`${file.name}-${file.lastModified}`} className="overflow-hidden rounded-[8px] border border-ui-border bg-white">
          <div className="aspect-[4/3] bg-bone/50">
            {file.type.startsWith('video/') ? (
              <video src={url} controls preload="metadata" className="size-full object-contain" aria-label={`Preview ${file.name}`} />
            ) : (
              // Browser object URLs cannot be routed through next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`Preview ${file.name}`} className="size-full object-contain" />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate text-xs font-semibold text-ink">{file.name}</span>
            <button type="button" onClick={() => onRemove(index)} className="shrink-0 text-xs font-semibold text-rust">
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
function defaultQuoteCompletionDate(deadline: string | null | undefined) {
  const next = new Date()
  next.setDate(next.getDate() + 14)
  const deadlineDate = deadline ? new Date(deadline) : null
  if (
    deadlineDate &&
    !Number.isNaN(deadlineDate.getTime()) &&
    deadlineDate.getTime() < next.getTime()
  ) {
    next.setTime(deadlineDate.getTime())
  }
  return next.toISOString().slice(0, 10)
}
const orderSelect =
  'id, reference, order_kind, garment_type, garment_description, item_title, item_size, item_quantity, stage, customer_id, tailor_id, tailor_profile_id, currency, quoted_currency, quoted_amount, total_amount, delivery_method, deadline, quoted_completion_date, created_at, updated_at, reference_photos, special_note, occasion, fabric_source, fabric_funding_policy_version, fabric_tracking, delivery_address, recipient_name, recipient_phone, tracking_number, carrier, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, collection_code, collection_code_expiry, auto_release_at, customer_measurements_snapshot'
function text(value: unknown, fallback = 'Not provided') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
function list(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : []
}
function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function supportMeta(value: string | null) {
  if (!value?.trim()) return null
  try {
    return objectRecord(JSON.parse(value))
  } catch {
    return null
  }
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
type StyleAlignment = {
  requiredBeforeCutting?: boolean
  status?: 'PENDING_CUSTOMER_APPROVAL' | 'CHANGES_REQUESTED' | 'APPROVED' | 'NOT_REQUIRED'
  tailorInterpretation?: string | null
}
function styleAlignmentFor(order: Order): StyleAlignment | null {
  const value = supportMeta(order.special_note)?.styleAlignment
  return objectRecord(value) as StyleAlignment | null
}
function consultationFor(order: Order): ConsultationMeta | null {
  const value = supportMeta(order.special_note)?.consultation
  return objectRecord(value) as ConsultationMeta | null
}
function localDateTimeValue(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function localDateTimeToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
async function functionError(error: unknown) {
  const context =
    error && typeof error === 'object' ? (error as { context?: Response }).context : null
  if (context?.clone) {
    try {
      const body = (await context.clone().json()) as {
        message?: string
        error?: string
        code?: string
      }
      return body.message || body.error || body.code || null
    } catch {
      try {
        const body = (await context.clone().text()).trim()
        if (body && body.length <= 240) return body
      } catch {
        /* use the SDK message below */
      }
    }
  }
  return error instanceof Error && error.message !== 'Edge Function returned a non-2xx status code'
    ? error.message
    : null
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
  const [stages, payments, messages, quotes, events, detail, reviews, tips, customerProfile] =
    await Promise.all([
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
          'garment_type_other, gender_presentation, style_notes, body_note, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, fabric_approval_status, shipping_preference, target_delivery_date, delivery_instructions, social_reference_links'
        )
        .eq('order_id', orderId)
        .maybeSingle(),
      supabase.from('reviews').select('id, order_id, rating, body, tags').eq('order_id', orderId),
      supabase
        .from('order_tips')
        .select('id, order_id, amount, currency, status')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false }),
      supabase
        .from('customer_profiles')
        .select('display_name')
        .eq('user_id', order.customer_id ?? '')
        .maybeSingle(),
    ])
  if (
    stages.error ||
    payments.error ||
    messages.error ||
    quotes.error ||
    events.error ||
    reviews.error ||
    tips.error
  )
    throw new Error('Some order context could not load. Refresh before taking action.')
  return {
    order,
    tailorProfileId,
    stages: (stages.data ?? []) as StageUpdate[],
    payments: (payments.data ?? []) as Payment[],
    messages: (messages.data ?? []) as Message[],
    quotes: (quotes.data ?? []) as Quote[],
    events: (events.data ?? []) as Event[],
    reviews: (reviews.data ?? []) as Review[],
    tips: (tips.data ?? []) as Tip[],
    customerName:
      (customerProfile.data as { display_name?: string | null } | null)?.display_name?.trim() ||
      'Drapeon customer',
    detail: detail.error ? null : (detail.data as CustomDetail | null),
  }
}
function DossierRow({ row }: { row: BriefDossierRow }) {
  const safeLinks = (row.hrefs ?? []).filter((href) => /^https?:\/\//iu.test(href))
  const safeMedia = (row.mediaUrls ?? []).filter((href) => /^https?:\/\//iu.test(href))

  if (row.presentation === 'chips') {
    return (
      <div className="border-b border-ink/7 py-3 last:border-0">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{row.label}</dt>
        <dd className="mt-2 flex flex-wrap gap-2">
          {(row.values ?? []).map((value) => (
            <span key={value} className="rounded-full border border-ui-border bg-paper px-3 py-1 text-xs font-semibold text-ink/70">
              {value}
            </span>
          ))}
        </dd>
      </div>
    )
  }

  if (row.presentation === 'links') {
    return (
      <div className="border-b border-ink/7 py-3 last:border-0">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{row.label}</dt>
        <dd className="mt-2 flex flex-wrap gap-2">
          {safeLinks.map((href, index) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="rounded-full border border-needle/20 bg-needle/5 px-3 py-1.5 text-sm font-semibold text-needle underline-offset-4 transition-colors hover:border-needle/45 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
              Open reference {index + 1}
            </a>
          ))}
        </dd>
      </div>
    )
  }

  if (row.presentation === 'media') {
    const gallery = safeMedia.map((src, index) => ({
      kind: isVideoMediaUrl(src) ? ('video' as const) : ('image' as const),
      src,
      title: `${row.label} ${index + 1}`,
    }))
    return (
      <div className="border-b border-ink/7 py-3 last:border-0">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{row.label}</dt>
        <dd className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {safeMedia.slice(0, 8).map((src, index) => (
            <MediaViewerDialog
              key={src}
              src={src}
              kind={isVideoMediaUrl(src) ? 'video' : 'image'}
              title={`${row.label} ${index + 1}`}
              items={gallery}
              initialIndex={index}
              description="Submitted with this custom brief. Open the original only when you need the source file."
            >
              <button
                type="button"
                aria-label={`Expand ${row.label.toLowerCase()} ${index + 1}`}
                className="group relative aspect-square w-full max-w-40 cursor-zoom-in overflow-hidden rounded-[8px] border border-ui-border bg-ink/4 text-left transition hover:border-needle/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
              >
                {isVideoMediaUrl(src) ? (
                  <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <img src={src} alt={`${row.label} ${index + 1}`} className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/72 px-2 py-1 text-center text-[10px] font-semibold text-white">
                  {isVideoMediaUrl(src) ? 'Play preview' : 'Expand image'}
                </span>
              </button>
            </MediaViewerDialog>
          ))}
        </dd>
      </div>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <div className="border-b border-ink/7 py-3 last:border-0">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{row.label}</dt>
        <dd className="mt-1 whitespace-pre-line text-sm font-medium leading-6 text-ink/78">{row.value}</dd>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-4 border-b border-ink/7 py-2.5 last:border-0">
      <dt className="text-sm text-ink/50">{row.label}</dt>
      <dd className="text-right text-sm font-semibold text-ink">{row.value}</dd>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-4 border-b border-ink/7 py-2.5 last:border-0">
      <dt className="text-sm text-ink/50">{label}</dt>
      <dd className="text-right text-sm font-semibold text-ink">{value}</dd>
    </div>
  )
}

type StripeTipCard = { mount(node: HTMLElement): void; unmount(): void }
type StripeTipClient = {
  elements(): { create(kind: 'card', options?: Record<string, unknown>): StripeTipCard }
  confirmCardPayment(
    clientSecret: string,
    options: { payment_method: { card: StripeTipCard } }
  ): Promise<{ error?: { message?: string }; paymentIntent?: { id?: string } }>
}

let stripeTipLoader: Promise<void> | null = null
function loadStripeForTip() {
  const factory = (window as unknown as { Stripe?: (key: string) => StripeTipClient | null }).Stripe
  if (factory) return Promise.resolve()
  if (stripeTipLoader) return stripeTipLoader
  stripeTipLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3/'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Stripe could not load.'))
    document.head.appendChild(script)
  })
  return stripeTipLoader
}

function StripeTipAuthorization({
  payment,
  onDone,
}: {
  payment: { tipId: string; clientSecret: string; providerReference: string }
  onDone: () => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeTipClient | null>(null)
  const cardRef = useRef<StripeTipCard | null>(null)
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
      queueMicrotask(() => {
        if (active) setError('Secure card tipping is temporarily unavailable.')
      })
      return () => {
        active = false
      }
    }
    void loadStripeForTip()
      .then(() => {
        const factory = (
          window as unknown as { Stripe?: (value: string) => StripeTipClient | null }
        ).Stripe
        if (!active || !factory || !mountRef.current) return
        const stripe = factory(key)
        if (!stripe) throw new Error('Stripe checkout could not initialize.')
        const card = stripe.elements().create('card', { hidePostalCode: true })
        card.mount(mountRef.current)
        stripeRef.current = stripe
        cardRef.current = card
        setReady(true)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Stripe could not load.')
      })
    return () => {
      active = false
      cardRef.current?.unmount()
    }
  }, [payment.clientSecret])

  async function confirm() {
    if (!stripeRef.current || !cardRef.current || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await stripeRef.current.confirmCardPayment(payment.clientSecret, {
        payment_method: { card: cardRef.current },
      })
      if (result.error) throw new Error(result.error.message || 'The card could not be authorized.')
      await invoke('order-tip-action', {
        action: 'confirm',
        tipId: payment.tipId,
        providerReference: payment.providerReference,
      })
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The tip could not be confirmed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[8px] border border-ui-border bg-white p-3">
      <div ref={mountRef} className="min-h-12 rounded-[8px] border border-ui-border p-3" />
      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-rust">
          {error}
        </p>
      ) : null}
      <Button className="mt-3 w-full" disabled={!ready || busy} onClick={() => void confirm()}>
        {busy ? 'Confirming…' : ready ? 'Authorize tip' : 'Loading secure card…'}
      </Button>
    </div>
  )
}

function CompletionMoment({ data, refresh }: { data: Data; refresh: () => void }) {
  const order = data.order
  const existingReview = data.reviews[0] ?? null
  const existingTip = data.tips[0] ?? null
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tipAmount, setTipAmount] = useState('')
  const [busy, setBusy] = useState<'review' | 'completion' | 'tip' | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; copy: string } | null>(null)
  const [stripeTip, setStripeTip] = useState<{
    tipId: string
    clientSecret: string
    providerReference: string
  } | null>(null)
  const currency = (order.currency ?? order.quoted_currency ?? 'USD').toUpperCase()
  const tipSuggestions = currency === 'NGN' ? ['1000', '2500', '5000'] : ['5', '10', '20']
  const ready =
    order.customer_id && ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage ?? '')

  useEffect(() => {
    function handlePaymentReturn(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { type?: string; orderId?: string }
      if (payload?.type !== 'drapeon:payment-return' || payload.orderId !== order.id) return
      setNotice({ error: false, copy: 'Tip payment returned. Confirming the provider result…' })
      refresh()
    }
    window.addEventListener('message', handlePaymentReturn)
    return () => window.removeEventListener('message', handlePaymentReturn)
  }, [order.id, refresh])

  if (!ready) return null

  async function submitReview() {
    setBusy('review')
    setNotice(null)
    try {
      await invoke('review-action', {
        action: 'submit-tailor-review',
        orderId: order.id,
        reviewerName: data.customerName,
        rating,
        body: body.trim() || undefined,
        tags,
        mediaUrls: [],
      })
      setNotice({ error: false, copy: 'Review submitted. This order is now complete.' })
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'The review could not be submitted.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function finishOrder() {
    setBusy('completion')
    setNotice(null)
    try {
      await invoke('customer-order-action', {
        action: 'complete-order',
        orderId: order.id,
      })
      setNotice({ error: false, copy: 'Order complete. Your receipt and aftercare remain available.' })
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'The order could not finish right now.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function sendTip() {
    const major = Number(tipAmount.replaceAll(',', '').trim())
    if (!Number.isFinite(major) || major <= 0) {
      setNotice({ error: true, copy: 'Choose or enter a valid tip amount.' })
      return
    }
    const amount = Math.round(major * 100)
    const expectsPaystack = ['NGN', 'GHS', 'KES'].includes(currency)
    const popup = expectsPaystack
      ? window.open(
          '',
          'drapeon-secure-tip',
          'popup=yes,width=520,height=760,resizable=yes,scrollbars=yes'
        )
      : null
    if (popup)
      popup.document.body.innerHTML =
        '<p style="font:600 15px system-ui;padding:32px;color:#173f31">Preparing secure tip…</p>'
    setBusy('tip')
    setNotice(null)
    try {
      window.sessionStorage.setItem(
        'drapeon:payment-return',
        JSON.stringify({
          orderId: order.id,
          returnTo: `/account/orders/${order.id}`,
        })
      )
      const result = (await invoke('order-tip-action', {
        action: 'prepare',
        orderId: order.id,
        amount,
        currency,
        idempotencyKey: `web:tip:${order.id}:${amount}`,
      })) as {
        confirmed?: boolean
        tipId?: string
        authorizationUrl?: string | null
        provider?: string
        providerReference?: string
        clientSecret?: string | null
      }
      if (result.confirmed) {
        popup?.close()
        setNotice({ error: false, copy: 'This tip is already confirmed.' })
        refresh()
      } else if (result.authorizationUrl) {
        if (popup) {
          popup.location.replace(result.authorizationUrl)
          popup.focus()
        } else window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer')
        setNotice({
          error: false,
          copy: 'Secure tip checkout opened. The order will keep your review draft here.',
        })
      } else if (
        result.provider === 'STRIPE' &&
        result.clientSecret &&
        result.tipId &&
        result.providerReference
      ) {
        popup?.close()
        setStripeTip({
          tipId: result.tipId,
          clientSecret: result.clientSecret,
          providerReference: result.providerReference,
        })
      } else {
        popup?.close()
        setNotice({ error: true, copy: 'The payment provider did not return a secure checkout.' })
      }
    } catch (cause) {
      popup?.close()
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'The tip could not start.',
      })
    } finally {
      setBusy(null)
    }
  }

  if (existingReview && existingTip) {
    return (
      <section className="app-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Thank you</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Review and tip recorded.</h2>
        <p className="mt-2 text-sm text-ink/58">
          Your order receipt and aftercare options remain available here.
        </p>
      </section>
    )
  }

  const tagOptions = ['Fit matched', 'Quality finish', 'Clear communication', 'On time']
  return (
    <section
      className="app-surface overflow-hidden border-needle/15"
      aria-labelledby="completion-heading"
    >
      <div className="bg-needle/[0.06] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
          {order.stage === 'COLLECTED' ? 'Pickup complete' : 'Handoff complete'}
        </p>
        <h2 id="completion-heading" className="mt-1 text-2xl font-semibold text-ink">
          How did it go?
        </h2>
        <p className="mt-1 text-sm text-ink/58">
          Rate the order or send an optional thank-you. You can do either one now.
        </p>
      </div>
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`mx-5 mt-4 rounded-[8px] p-3 text-sm font-semibold ${notice.error ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
        >
          {notice.copy}
        </p>
      ) : null}
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        {!existingReview ? (
          <div className="grid content-start gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Rate this order</p>
              <div className="mt-1 flex gap-1" aria-label={`${rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`text-2xl ${star <= rating ? 'text-amber-400' : 'text-ink/15'}`}
                    aria-label={`${star} stars`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {tagOptions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setTags((current) =>
                      current.includes(tag)
                        ? current.filter((value) => value !== tag)
                        : [...current, tag]
                    )
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tags.includes(tag) ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink/65'}`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Share anything helpful (optional)"
              className="resize-none rounded-[8px] border border-ui-border px-3 py-2 text-sm outline-none focus:border-needle/45"
            />
            <Button disabled={busy !== null} onClick={() => void submitReview()}>
              {busy === 'review' ? 'Submitting…' : 'Submit review'}
            </Button>
          </div>
        ) : (
          <div className="grid content-start gap-3">
            <p className="text-sm font-semibold text-needle">Review submitted</p>
            <p className="mt-1 text-sm text-ink/55">Thanks for helping future customers.</p>
            {order.stage !== 'COMPLETE' ? (
              <>
                <p className="text-xs leading-5 text-ink/50">
                  Your review is safe. Finish the order record without submitting it again.
                </p>
                <Button disabled={busy !== null} onClick={() => void finishOrder()}>
                  {busy === 'completion' ? 'Finishing order…' : 'Finish order'}
                </Button>
              </>
            ) : null}
          </div>
        )}
        {!existingTip ? (
          <div className="grid content-start gap-3 border-t border-ui-border pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div>
              <p className="text-sm font-semibold text-ink">Optional tip</p>
              <p className="mt-1 text-xs leading-5 text-ink/50">
                The full displayed amount is owed to the tailor and does not affect your review.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {tipSuggestions.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTipAmount(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tipAmount === value ? 'border-needle bg-needle/10 text-needle' : 'border-ui-border bg-white text-ink/65'}`}
                >
                  {currency} {Number(value).toLocaleString()}
                </button>
              ))}
            </div>
            <label className="grid gap-1 text-xs font-semibold text-ink/55">
              Custom tip
              <div className="flex items-center rounded-[8px] border border-ui-border bg-white px-3">
                <span>{currency}</span>
                <input
                  value={tipAmount}
                  onChange={(event) => setTipAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-ink outline-none"
                />
              </div>
            </label>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void sendTip()}>
              {busy === 'tip' ? 'Preparing…' : 'Send tip'}
            </Button>
            {stripeTip ? (
              <StripeTipAuthorization
                payment={stripeTip}
                onDone={() => {
                  setStripeTip(null)
                  setNotice({ error: false, copy: 'Tip confirmed. Thank you.' })
                  refresh()
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="border-t border-ui-border pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <p className="text-sm font-semibold text-needle">
              Tip {formatDatabaseEnumLabel(existingTip.status, 'recorded')}
            </p>
            <p className="mt-1 text-sm text-ink/55">
              {formatMoney(existingTip.amount, existingTip.currency)}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function CustomerHandoffActions({ data, refresh }: { data: Data; refresh: () => void }) {
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; copy: string } | null>(null)
  const stage = data.order.stage ?? ''
  const canConfirmReceipt = stage === 'SHIPPED' || stage === 'OUT_FOR_DELIVERY'

  if (!canConfirmReceipt) return null

  async function confirmReceipt() {
    if (!receiptFile) {
      setNotice({ error: true, copy: 'Add a photo or short video showing the item in hand.' })
      return
    }
    const contentType = receiptFile.type.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES.includes(contentType as never)) {
      setNotice({ error: true, copy: 'Choose a JPG, PNG, WebP, MP4, or MOV file.' })
      return
    }
    const limit = contentType.startsWith('video/')
      ? MEDIA_LIMITS_BYTES.orderUpdateVideo
      : MEDIA_LIMITS_BYTES.image
    if (receiptFile.size > limit) {
      setNotice({
        error: true,
        copy: `Choose a ${contentType.startsWith('video/') ? 'video' : 'photo'} under ${Math.round(limit / (1024 * 1024))} MB.`,
      })
      return
    }
    setBusy(true)
    setNotice({ error: false, copy: 'Uploading handoff proof…' })
    try {
      const extension =
        receiptFile.name
          .split('.')
          .pop()
          ?.replace(/[^a-z0-9]/gi, '')
          .toLowerCase() || 'jpg'
      const path = `receipts/${data.order.id}/${crypto.randomUUID()}.${extension}`
      const supabase = createClient()
      const { error } = await supabase.storage.from('order-photos').upload(path, receiptFile, {
        contentType: receiptFile.type || 'application/octet-stream',
        cacheControl: '31536000',
        upsert: false,
      })
      if (error) throw new Error('The proof could not upload. Try a smaller file.')
      const receiptPhotoUrl = supabase.storage.from('order-photos').getPublicUrl(path)
        .data.publicUrl
      await invoke('customer-order-action', {
        action: 'confirm-receipt',
        orderId: data.order.id,
        receiptPhotoUrl,
      })
      setReceiptFile(null)
      setNotice({ error: false, copy: 'Receipt confirmed. The handoff is now recorded.' })
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'Receipt could not be confirmed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="app-surface p-5" aria-labelledby="customer-handoff-heading">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">
        Your next step
      </p>
      <h2 id="customer-handoff-heading" className="mt-1 text-xl font-semibold text-ink">
        Confirm that your order arrived.
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/58">
        Add one proof photo or short video after you have inspected the item.
      </p>
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`mt-3 rounded-[8px] p-3 text-sm font-semibold ${notice.error ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
        >
          {notice.copy}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-xs font-semibold text-ink/55">
          Handoff proof
          <input
            type="file"
            accept={ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES.join(',')}
            onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-[6px] file:border-0 file:bg-bone file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
        </label>
        <Button disabled={busy || !receiptFile} onClick={() => void confirmReceipt()}>
          {busy ? 'Confirming…' : 'Confirm receipt'}
        </Button>
      </div>
    </section>
  )
}

function PickupCredential({ order, refresh }: { order: Order; refresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [renderedAt] = useState(() => Date.now())
  const code =
    typeof order.collection_code === 'string' && /^\d{4}$/.test(order.collection_code)
      ? order.collection_code
      : null
  const expiry = order.collection_code_expiry
    ? Date.parse(order.collection_code_expiry)
    : Number.NaN
  const expired = !Number.isFinite(expiry) || expiry <= renderedAt

  const rotate = useCallback(
    async (force: boolean) => {
      setBusy(true)
      setNotice(null)
      try {
        await invoke('customer-order-action', {
          action: 'refresh-collection-code',
          orderId: order.id,
          force,
        })
        refresh()
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : 'The pickup code could not refresh.')
      } finally {
        setBusy(false)
      }
    },
    [order.id, refresh]
  )

  useEffect(() => {
    if (!expired) return
    const timeout = window.setTimeout(() => void rotate(false), 0)
    return () => window.clearTimeout(timeout)
  }, [expired, rotate])

  return (
    <section
      className="app-surface border-needle/20 bg-needle/[0.04] p-5"
      aria-labelledby="collection-code-heading"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
        Pickup credential
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 id="collection-code-heading" className="text-xl font-semibold text-ink">
            Inspect the item, then show this code to the tailor.
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/58">
            This is not your order number. Share it only when you are physically collecting the item
            and ready to record the handoff.
          </p>
        </div>
        {code && !expired ? (
          <div className="flex gap-2" aria-label={`Pickup code ${code}`}>
            {code.split('').map((digit, index) => (
              <span
                key={`${digit}-${index}`}
                className="grid size-11 place-items-center rounded-[8px] border border-needle/20 bg-white text-xl font-semibold text-needle shadow-sm"
              >
                {digit}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm font-semibold text-ink/55">
            {busy ? 'Refreshing code…' : 'Code expired'}
          </p>
        )}
      </div>
      {order.collection_code_expiry && !expired ? (
        <p className="mt-3 text-xs text-ink/48">
          Available until{' '}
          {formatExplicitZonedDateTime(order.collection_code_expiry) ||
            order.collection_code_expiry}
          .
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm font-semibold text-rust" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Generate a new pickup code? The current code will stop working immediately.'
              )
            )
              void rotate(true)
          }}
        >
          {busy ? 'Refreshing…' : 'Generate new code'}
        </Button>
        <Link
          href={`/account/support?orderId=${order.id}`}
          className="text-sm font-semibold text-rust"
        >
          Something wrong? Report an issue
        </Link>
      </div>
    </section>
  )
}

function TailorConsultationResponse({ data, refresh }: { data: Data; refresh: () => void }) {
  const consultation = consultationFor(data.order)
  const awaitingResponse =
    data.order.stage === 'CONSULTATION' &&
    consultation?.requestedBy === 'CUSTOMER' &&
    consultation.status === 'REQUESTED'
  const [scheduledStart, setScheduledStart] = useState(() =>
    localDateTimeValue(consultation?.proposedStartAt ?? consultation?.scheduledStartAt)
  )
  const [note, setNote] = useState(consultation?.requestNote ?? '')
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; copy: string } | null>(null)

  if (!awaitingResponse) return null

  const requestedTime =
    formatExplicitZonedDateTime(
      consultation?.proposedStartAt ?? consultation?.scheduledStartAt,
      consultation?.timezone ? { timeZone: consultation.timezone } : undefined
    ) || 'No valid time was recorded'
  const callType = consultation?.callType === 'AUDIO' ? 'AUDIO' : 'VIDEO'
  const feeLabel = consultation?.feeAmount
    ? formatMoney(consultation.feeAmount, consultation.feeCurrency ?? data.order.currency)
    : 'Free'

  async function respond(action: 'approve' | 'decline') {
    setNotice(null)
    setBusy(action)
    try {
      if (action === 'decline') {
        await invoke('tailor-order-action', {
          action: 'decline-consultation-request',
          orderId: data.order.id,
          note: note.trim() || undefined,
        })
        setNotice({ error: false, copy: 'Consultation declined. The order is back in quote review.' })
      } else {
        const scheduledStartAt = localDateTimeToIso(scheduledStart)
        if (!scheduledStartAt) {
          setNotice({ error: true, copy: 'Choose a valid consultation time.' })
          return
        }
        await invoke('tailor-order-action', {
          action: 'approve-consultation',
          orderId: data.order.id,
          scheduledStartAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          callType,
          note: note.trim() || undefined,
        })
        setNotice({
          error: false,
          copy: consultation?.feeAmount
            ? 'Consultation approved. The customer can now pay the published fee.'
            : 'Consultation approved and scheduled.',
        })
      }
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy:
          cause instanceof Error
            ? cause.message
            : 'The consultation response could not be saved.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="app-surface p-5" id="consultation-response">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">
        Consultation request
      </p>
      <h2 className="mt-1 text-xl font-semibold text-ink">Respond before preparing the quote.</h2>
      <p className="mt-2 text-sm leading-6 text-ink/62">
        The customer asked for a {callType === 'AUDIO' ? 'voice' : 'video'} consultation at{' '}
        {requestedTime}. Approve that time or choose another one. Your published terms apply.
      </p>
      <dl className="mt-4 grid gap-2 rounded-[8px] border border-needle/14 bg-needle/5 p-4 text-sm sm:grid-cols-2">
        <Row label="Published fee" value={feeLabel} />
        <Row label="Call type" value={callType === 'AUDIO' ? 'Audio' : 'Video'} />
      </dl>
      {consultation?.requestExpiresAt ? (
        <p className="mt-3 text-xs font-semibold text-ink/52">
          Respond by{' '}
          {formatExplicitZonedDateTime(
            consultation.requestExpiresAt,
            consultation.timezone ? { timeZone: consultation.timezone } : undefined
          ) || consultation.requestExpiresAt}
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`mt-4 rounded-[8px] p-3 text-sm font-semibold ${notice.error ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
        >
          {notice.copy}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-ink">
          Consultation date and time
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(event) => setScheduledStart(event.target.value)}
            className="h-11 rounded-[8px] border border-ui-border bg-white px-3 font-normal"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-ink">
          Note to customer (optional)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={300}
            className="resize-none rounded-[8px] border border-ui-border bg-white px-3 py-2 font-normal"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button disabled={busy !== null} onClick={() => void respond('approve')}>
          {busy === 'approve' ? 'Approving…' : 'Approve consultation'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void respond('decline')}
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </Button>
      </div>
    </section>
  )
}

function CustomerConsultationState({ data, refresh }: { data: Data; refresh: () => void }) {
  const consultation = consultationFor(data.order)
  if (data.order.stage !== 'CONSULTATION' || !consultation) return null
  const requested = consultation.status === 'REQUESTED'
  const scheduled = consultation.status === 'SCHEDULED'
  const feeRequired =
    scheduled &&
    Boolean(consultation.feeAmount) &&
    consultation.paymentTiming === 'BEFORE_CALL_STARTS' &&
    !consultation.paidAt
  const lifecycle = getCallLifecycleState(consultation.scheduledStartAt)
  const time = consultation.scheduledStartAt ?? consultation.proposedStartAt
  const timeLabel = formatExplicitZonedDateTime(
    time,
    consultation.timezone ? { timeZone: consultation.timezone } : undefined
  )

  return (
    <section className="app-surface p-5" id="consultation-status">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
        Consultation
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-ink">
        {requested
          ? 'Waiting for the tailor.'
          : feeRequired
            ? 'Your consultation is approved.'
            : scheduled
              ? 'Your consultation is scheduled.'
              : 'Consultation update'}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/58">
        {requested
          ? 'Your request is saved. The tailor can approve the time, suggest another one, or decline before preparing the quote.'
          : feeRequired
            ? 'Pay the published consultation fee to unlock the protected call at the scheduled time.'
            : consultation.paidAt
              ? 'The fee is recorded. Keep questions and decisions in the order conversation.'
              : 'Keep questions and decisions in the order conversation so the brief stays complete.'}
      </p>
      <dl className="mt-4 grid gap-x-8 rounded-[8px] border border-ui-border bg-ui-canvas px-4 py-2 md:grid-cols-2">
        {timeLabel ? <Row label={requested ? 'Requested time' : 'Scheduled for'} value={timeLabel} /> : null}
        <Row label="Call type" value={consultation.callType === 'AUDIO' ? 'Audio' : 'Video'} />
        {consultation.feeAmount ? (
          <Row
            label="Published fee"
            value={formatMoney(consultation.feeAmount, consultation.feeCurrency ?? data.order.currency)}
          />
        ) : (
          <Row label="Published fee" value="Free" />
        )}
        {consultation.feeAmount ? (
          <Row
            label="Fee treatment"
            value={consultation.feeCreditable ? 'Credited if you continue' : 'Separate consultation fee'}
          />
        ) : null}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {feeRequired ? (
          <Button asChild>
            <Link href={`/account/checkout/${data.order.id}`}>Pay consultation fee</Link>
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href={`/account/messages?orderId=${data.order.id}`}>Message tailor</Link>
        </Button>
      </div>
      {scheduled && lifecycle.status === 'upcoming' ? (
        <p className="mt-3 text-xs leading-5 text-ink/48">
          The call opens near the scheduled time. Add fit concerns, reference photos, fabric questions, and deadline risks to the conversation beforehand.
        </p>
      ) : null}
      {scheduled ? (
        <div className="mt-4">
          <ConsultationLifecyclePanel orderId={data.order.id} actorRole="CUSTOMER" onUpdated={refresh} />
        </div>
      ) : null}
    </section>
  )
}

function TailorConsultationState({ data, refresh }: { data: Data; refresh: () => void }) {
  const consultation = consultationFor(data.order)
  if (
    data.order.stage !== 'CONSULTATION' ||
    !consultation ||
    consultation.status !== 'SCHEDULED'
  ) return null

  const lifecycle = getCallLifecycleState(consultation.scheduledStartAt)
  const feeRequired = Boolean(consultation.feeAmount)
  const feePaid = !feeRequired || Boolean(consultation.paidAt)
  const timeLabel = formatExplicitZonedDateTime(
    consultation.scheduledStartAt,
    consultation.timezone ? { timeZone: consultation.timezone } : undefined
  )
  const callType = consultation.callType === 'AUDIO' ? 'audio' : 'video'
  const canJoin = feePaid && lifecycle.status === 'active'

  return (
    <section className="app-surface p-5" id="consultation-status">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
        Consultation
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-ink">
        {!feePaid
          ? 'Waiting for consultation payment.'
          : lifecycle.status === 'active'
            ? 'The consultation call is open.'
            : lifecycle.status === 'expired'
              ? 'The consultation window finished.'
              : 'Consultation scheduled.'}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/58">
        {!feePaid
          ? 'The customer must pay the published fee before the protected call can open.'
          : lifecycle.status === 'upcoming'
            ? `${formatCallCountdown(lifecycle.msUntilOpen)}. Use the order conversation to prepare questions and decisions.`
            : lifecycle.status === 'active'
              ? 'Join from this order so the call remains attached to the correct customer and brief.'
              : 'You can now prepare the quote from the decisions recorded in this order.'}
      </p>
      <dl className="mt-4 grid gap-x-8 rounded-[8px] border border-ui-border bg-ui-canvas px-4 py-2 md:grid-cols-2">
        {timeLabel ? <Row label="Scheduled for" value={timeLabel} /> : null}
        <Row label="Call type" value={callType === 'audio' ? 'Audio' : 'Video'} />
        <Row
          label="Published fee"
          value={consultation.feeAmount
            ? formatMoney(consultation.feeAmount, consultation.feeCurrency ?? data.order.currency)
            : 'Free'}
        />
        <Row
          label="Payment"
          value={feeRequired ? (feePaid ? 'Paid · protected' : 'Awaiting customer') : 'No fee'}
        />
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {canJoin ? (
          <Button asChild>
            <Link href={`/account/call-join?orderId=${data.order.id}&callKind=consultation&callType=${callType}`}>
              Join {callType} call
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href={`/account/messages?orderId=${data.order.id}`}>Message customer</Link>
        </Button>
      </div>
      <div className="mt-4">
        <ConsultationLifecyclePanel orderId={data.order.id} actorRole="TAILOR" onUpdated={refresh} />
      </div>
    </section>
  )
}

function TailorActions({ data, refresh }: { data: Data; refresh: () => void }) {
  const [amount, setAmount] = useState('')
  const [tailoringAmount, setTailoringAmount] = useState('')
  const [fabricAllowanceAmount, setFabricAllowanceAmount] = useState('')
  const [fabricCoverage, setFabricCoverage] = useState<FabricAllowanceCoverageCode[]>(
    data.order.fabric_source === 'TAILOR_SOURCES' ? ['FABRIC'] : []
  )
  const [fabricAssumptions, setFabricAssumptions] = useState('')
  const [completion, setCompletion] = useState(() =>
    defaultQuoteCompletionDate(data.order.deadline)
  )
  const [laborAmount, setLaborAmount] = useState('')
  const [sourcingAmount, setSourcingAmount] = useState('')
  const [rushAmount, setRushAmount] = useState('')
  const [includedText, setIncludedText] = useState('')
  const [excludedText, setExcludedText] = useState('')
  const [breakdownSummary, setBreakdownSummary] = useState('')
  const [note, setNote] = useState('')
  const [proofFiles, setProofFiles] = useState<File[]>([])
  const [orderReviewed, setOrderReviewed] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  const [next, setNext] = useState(stageOptions(data.order)[0] ?? '')
  const [pickupCode, setPickupCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; copy: string } | null>(null)
  const consultation = consultationFor(data.order)
  const consultationAwaitingResponse =
    data.order.stage === 'CONSULTATION' &&
    consultation?.requestedBy === 'CUSTOMER' &&
    consultation.status === 'REQUESTED'
  const consultationQuotePreparationReady =
    data.order.stage === 'CONSULTATION' &&
    consultation?.status === 'SCHEDULED' &&
    getCallLifecycleState(consultation.scheduledStartAt).status === 'expired'
  const canQuote =
    !consultationAwaitingResponse &&
    !isReadyMade(data.order) &&
    (data.order.stage === 'PENDING_QUOTE' || consultationQuotePreparationReady)
  const fundedFabricQuote = isFundedFabricPolicy(data.order.fabric_funding_policy_version)
  const tailorSourcesFabric = data.order.fabric_source === 'TAILOR_SOURCES'
  const currency = normalizeAccountCurrency(data.order.currency) ?? 'USD'
  const today = new Date().toISOString().slice(0, 10)
  const customerDeadline = data.order.deadline?.slice(0, 10) || null
  const quoteDraftFields = useMemo<TailorQuoteDraftFields>(
    () => ({
      amount,
      tailoringAmount,
      fabricAllowanceAmount,
      fabricCoverage,
      fabricAssumptions,
      completionDate: completion,
      laborAmount,
      sourcingAmount,
      rushAmount,
      includedText,
      excludedText,
      breakdownSummary,
      note,
      currency,
    }),
    [
      amount,
      breakdownSummary,
      completion,
      currency,
      excludedText,
      fabricAllowanceAmount,
      fabricAssumptions,
      fabricCoverage,
      includedText,
      laborAmount,
      note,
      rushAmount,
      sourcingAmount,
      tailoringAmount,
    ]
  )

  const parseList = (value: string) =>
    value
      .split(/[\n,]/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 6)

  useEffect(() => {
    if (!canQuote) return
    let active = true
    void invoke('tailor-quote-draft-action', { action: 'load', orderId: data.order.id })
      .then((result) => {
        if (!active) return
        const draft = (result as {
          draft?: { version?: string; mode?: string; fields?: Partial<TailorQuoteDraftFields> } | null
        }).draft
        const fields =
          draft?.version === TAILOR_QUOTE_DRAFT_VERSION && draft.mode === 'send'
            ? draft.fields
            : null
        if (fields) {
          setAmount(formatMoneyInputValue(fields.amount ?? ''))
          setTailoringAmount(formatMoneyInputValue(fields.tailoringAmount ?? ''))
          setFabricAllowanceAmount(formatMoneyInputValue(fields.fabricAllowanceAmount ?? ''))
          setFabricCoverage(
            Array.isArray(fields.fabricCoverage)
              ? (fields.fabricCoverage as FabricAllowanceCoverageCode[])
              : []
          )
          setFabricAssumptions(fields.fabricAssumptions ?? '')
          setCompletion(
            fields.completionDate || defaultQuoteCompletionDate(data.order.deadline)
          )
          setLaborAmount(formatMoneyInputValue(fields.laborAmount ?? ''))
          setSourcingAmount(formatMoneyInputValue(fields.sourcingAmount ?? ''))
          setRushAmount(formatMoneyInputValue(fields.rushAmount ?? ''))
          setIncludedText(fields.includedText ?? '')
          setExcludedText(fields.excludedText ?? '')
          setBreakdownSummary(fields.breakdownSummary ?? '')
          setNote(fields.note ?? '')
          setOrderReviewed(false)
          setDraftStatus('Draft restored')
        } else {
          setDraftStatus('')
        }
        setDraftLoaded(true)
      })
      .catch((cause) => {
        if (!active) return
        setDraftStatus(
          cause instanceof Error ? `Draft sync unavailable · ${cause.message}` : 'Draft sync unavailable'
        )
        setDraftLoaded(true)
      })
    return () => {
      active = false
    }
  }, [canQuote, data.order.deadline, data.order.id])

  useEffect(() => {
    if (!canQuote || !draftLoaded || busy || !isMeaningfulTailorQuoteDraft(quoteDraftFields)) return
    const timer = window.setTimeout(() => {
      setDraftStatus('Saving draft…')
      void invoke('tailor-quote-draft-action', {
        action: 'save',
        orderId: data.order.id,
        version: TAILOR_QUOTE_DRAFT_VERSION,
        mode: 'send',
        fields: quoteDraftFields,
      })
        .then(() => setDraftStatus('Draft saved'))
        .catch(() => setDraftStatus('Draft not synced'))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [
    busy,
    canQuote,
    data.order.id,
    draftLoaded,
    quoteDraftFields,
  ])

  async function sendQuote() {
    const tailoringMinor = parseMoneyInputToMinorUnits(tailoringAmount)
    const allowanceMinor = tailorSourcesFabric
      ? parseMoneyInputToMinorUnits(fabricAllowanceAmount)
      : 0
    const minor = fundedFabricQuote
      ? (tailoringMinor ?? 0) + (allowanceMinor ?? 0)
      : parseMoneyInputToMinorUnits(amount)
    const leak = filterContactInfo(note)
    if (!minor || (fundedFabricQuote && !tailoringMinor))
      return setNotice({ error: true, copy: 'Enter a valid quote amount.' })
    if (!completion) return setNotice({ error: true, copy: 'Choose an estimated completion date.' })
    if (customerDeadline && completion > customerDeadline)
      return setNotice({
        error: true,
        copy: `Choose a completion date on or before ${new Date(`${customerDeadline}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      })
    if (
      fundedFabricQuote &&
      tailorSourcesFabric &&
      (!allowanceMinor || fabricCoverage.length === 0 || fabricAssumptions.trim().length < 8)
    )
      return setNotice({
        error: true,
        copy: 'Add the fabric allowance, what it covers, and clear sourcing assumptions.',
      })
    if (!orderReviewed)
      return setNotice({
        error: true,
        copy: 'Review the complete order details and confirm that review before sending.',
      })
    if (leak.blocked) return setNotice({ error: true, copy: leak.userMessage })
    const parsedLabor = parseMoneyInputToMinorUnits(laborAmount)
    const parsedSourcing = parseMoneyInputToMinorUnits(sourcingAmount)
    const parsedRush = parseMoneyInputToMinorUnits(rushAmount)
    const breakdown = {
      ...(parsedLabor != null ? { laborAmount: parsedLabor } : {}),
      ...(parsedSourcing != null ? { sourcingAmount: parsedSourcing } : {}),
      ...(parsedRush != null ? { rushAmount: parsedRush } : {}),
      included: parseList(includedText),
      excluded: parseList(excludedText),
      ...(breakdownSummary.trim() ? { summary: breakdownSummary.trim() } : {}),
    }
    const hasBreakdown =
      parsedLabor != null ||
      parsedSourcing != null ||
      parsedRush != null ||
      breakdown.included.length > 0 ||
      breakdown.excluded.length > 0 ||
      Boolean(breakdown.summary)
    setBusy(true)
    try {
      await invoke('tailor-order-action', {
        action: 'send-quote',
        orderId: data.order.id,
        amount: minor,
        currency,
        completionDate: new Date(`${completion}T12:00:00`).toISOString(),
        ...(hasBreakdown ? { breakdown } : {}),
        ...(fundedFabricQuote
          ? {
              fabricAllocation: {
                tailoringAmount: tailoringMinor,
                fabricAllowanceAmount: allowanceMinor,
                coverage: fabricCoverage,
                sourcingAssumptions: tailorSourcesFabric ? fabricAssumptions.trim() : '',
              },
            }
          : {}),
        note: note.trim() || undefined,
        orderReview: { acknowledged: true, version: QUOTE_ORDER_REVIEW_VERSION },
      })
      setNotice({ error: false, copy: 'Quote saved. The customer can now review it.' })
      setOrderReviewed(false)
      await invoke('tailor-quote-draft-action', {
        action: 'delete',
        orderId: data.order.id,
      }).catch(() => null)
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
  async function advance(targetStage = next) {
    const leak = filterContactInfo(note)
    if (!targetStage) return
    const requirement = !isReadyMade(data.order)
      ? customProductionRequirement(targetStage)
      : null
    if (note.trim().length < 10)
      return setNotice({
        error: true,
        copy: 'Tell the customer what changed in at least 10 characters.',
      })
    if (requirement?.photoRequired && proofFiles.length < requirement.minPhotoCount)
      return setNotice({
        error: true,
        copy: `${requirement.label} needs ${requirement.minPhotoCount === 1 ? 'one fresh proof photo' : `${requirement.minPhotoCount} fresh proof photos`} before it can be completed.`,
      })
    if (leak.blocked) return setNotice({ error: true, copy: leak.userMessage })
    setBusy(true)
    try {
      const evidenceMedia: Array<{
        mediaType: 'IMAGE' | 'VIDEO'
        bucket: 'commercial-evidence'
        originalPath: string
        displayPath: string
        posterPath: null
      }> = []
      const mediaFingerprints: string[] = []
      for (const file of proofFiles) {
        if (!ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES.includes(file.type as never))
          throw new Error('Use a JPG, PNG, WebP, MP4, or MOV proof file.')
        const isVideo = file.type.startsWith('video/')
        if (file.size > (isVideo ? MEDIA_LIMITS_BYTES.stageVideo : MEDIA_LIMITS_BYTES.image))
          throw new Error(isVideo ? 'Each proof video must be 30 MB or smaller.' : 'Each proof photo must be 10 MB or smaller.')
        const extension =
          file.name.split('.').pop()?.replace(/[^a-z0-9]/giu, '').toLowerCase() || 'jpg'
        const assetKey = `${Date.now()}-${crypto.randomUUID()}`
        const path = `${data.order.id}/production/${targetStage.toLowerCase()}/${assetKey}/original.${extension}`
        const { error } = await createClient().storage.from('commercial-evidence').upload(path, file, {
          contentType: file.type,
          upsert: false,
        })
        if (error) throw new Error('Proof could not upload. Your note and selection are still here.')
        evidenceMedia.push({
          mediaType: isVideo ? 'VIDEO' : 'IMAGE',
          bucket: 'commercial-evidence',
          originalPath: path,
          displayPath: path,
          posterPath: null,
        })
        mediaFingerprints.push(`web:${file.name}:${file.size}:${file.lastModified}`)
      }
      await invoke('tailor-order-action', {
        action: 'advance-stage',
        orderId: data.order.id,
        targetStage,
        note: note.trim(),
        evidenceMedia,
        mediaFingerprints,
      })
      setNotice({
        error: false,
        copy: `Order moved to ${stageChoiceLabel(data.order, targetStage)}.`,
      })
      setProofFiles([])
      setNote('')
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
  async function confirmCollection() {
    if (!/^\d{4}$/.test(pickupCode)) {
      setNotice({ error: true, copy: 'Enter the customer’s 4-digit pickup code.' })
      return
    }
    setBusy(true)
    try {
      await invoke('tailor-order-action', {
        action: 'confirm-collection',
        orderId: data.order.id,
        code: pickupCode,
      })
      setNotice({ error: false, copy: 'Collection confirmed. The handoff is recorded.' })
      setPickupCode('')
      refresh()
    } catch (cause) {
      setNotice({
        error: true,
        copy: cause instanceof Error ? cause.message : 'Collection could not be confirmed.',
      })
    } finally {
      setBusy(false)
    }
  }
  const canConfirmCollection =
    data.order.stage === 'READY_FOR_COLLECTION' &&
    (data.order.delivery_method === 'LOCAL_COLLECTION' || data.order.delivery_method === 'PICKUP')
  const options = stageOptions(data.order)
  const selectedNext = options.includes(next) ? next : (options[0] ?? '')
  const quoteBlockedReason = !orderReviewed
    ? 'Confirm that you reviewed the order before sending.'
    : (!fundedFabricQuote && !amount) || (fundedFabricQuote && !tailoringAmount)
      ? 'Add the required quote amount before sending.'
      : fundedFabricQuote &&
          tailorSourcesFabric &&
          (!fabricAllowanceAmount || fabricCoverage.length === 0 || fabricAssumptions.trim().length < 8)
        ? 'Complete the fabric allowance details before sending.'
        : !completion
          ? 'Choose an estimated completion date before sending.'
          : null
  if (!canQuote && !options.length && !canConfirmCollection) return null
  return (
    <section className="app-surface p-5" id="order-actions">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">Tailor action</p>
      <h2 className="mt-1 text-xl font-semibold text-ink">
        {canQuote
          ? 'Send a clear quote.'
          : canConfirmCollection
            ? 'Confirm customer pickup.'
            : isReadyMade(data.order)
              ? 'Prepare and hand off this order.'
              : 'Move production forward.'}
      </h2>
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`mt-3 rounded-[8px] p-3 text-sm font-semibold ${notice.error ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
        >
          {notice.copy}
        </p>
      ) : null}
      {canConfirmCollection ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="text-xs font-semibold text-ink/55">
            Customer pickup code
            <input
              value={pickupCode}
              onChange={(event) => setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="4 digits"
              className="mt-1 h-10 w-full rounded-[8px] border border-ui-border px-3 text-sm"
            />
          </label>
          <Button
            className="self-end"
            disabled={busy || pickupCode.length !== 4}
            onClick={() => void confirmCollection()}
          >
            {busy ? 'Confirming…' : 'Confirm collection'}
          </Button>
        </div>
      ) : canQuote ? (
        <div className="mt-4 grid gap-4">
          <div className="rounded-[8px] border border-needle/15 bg-needle/5 p-4">
            <p className="text-sm font-semibold text-ink">Quote currency · {currency}</p>
            <p className="mt-1 text-xs leading-5 text-ink/58">
              This order is locked to {currency} so payment, protected funds, and payout stay in
              one currency.
            </p>
          </div>
          {draftStatus ? (
            <p className="text-xs font-semibold text-needle" aria-live="polite">
              {draftStatus}
            </p>
          ) : null}
          {fundedFabricQuote ? (
            <div className="grid gap-4 rounded-[8px] border border-ui-border bg-bone/35 p-4">
              <div>
                <p className="font-semibold text-ink">Seller amount breakdown</p>
                <p className="mt-1 text-xs leading-5 text-ink/58">
                  Keep construction and fabric separate so the customer can see what each
                  protected amount covers.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <MoneyInput
                  id={`quote-tailoring-${data.order.id}`}
                  label="Tailoring and construction"
                  value={tailoringAmount}
                  onValueChange={setTailoringAmount}
                  currency={currency}
                  required
                />
                {tailorSourcesFabric ? (
                  <MoneyInput
                    id={`quote-fabric-${data.order.id}`}
                    label="Fabric allowance"
                    value={fabricAllowanceAmount}
                    onValueChange={setFabricAllowanceAmount}
                    currency={currency}
                    required
                    hint="Held for approved, evidenced fabric costs. Unused funds return to the customer."
                  />
                ) : (
                  <div className="rounded-[8px] border border-needle/12 bg-white p-3 text-sm text-ink/62">
                    Customer supplies fabric · allowance fixed at zero
                  </div>
                )}
              </div>
              {tailorSourcesFabric ? (
                <>
                  <fieldset className="grid gap-2">
                    <legend className="text-sm font-semibold text-ink">Allowance covers</legend>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['FABRIC', 'Fabric'],
                          ['LINING', 'Lining'],
                          ['EMBROIDERY', 'Embroidery'],
                          ['TRIMS', 'Trims'],
                          ['NOTIONS', 'Notions'],
                          ['OTHER_AGREED_MATERIAL', 'Other agreed material'],
                        ] as const
                      ).map(([code, label]) => {
                        const selected = fabricCoverage.includes(code)
                        return (
                          <button
                            key={code}
                            type="button"
                            role="checkbox"
                            aria-checked={selected}
                            onClick={() =>
                              setFabricCoverage((current) =>
                                selected
                                  ? current.filter((item) => item !== code)
                                  : [...current, code]
                              )
                            }
                            className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${selected ? 'border-needle/30 bg-needle/10 text-needle' : 'border-ui-border bg-white text-ink/62 hover:border-needle/25'}`}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>
                  <label className="grid gap-1.5 text-sm font-semibold text-ink">
                    Sourcing assumptions <span className="text-rust">*</span>
                    <textarea
                      value={fabricAssumptions}
                      onChange={(event) => setFabricAssumptions(event.target.value)}
                      rows={3}
                      maxLength={1200}
                      placeholder="Quantity, quality, supplier estimate, lining or trim assumptions…"
                      className="resize-none rounded-[8px] border border-ui-border bg-white px-4 py-3 font-normal outline-none focus:border-needle/50 focus:ring-2 focus:ring-needle/10"
                    />
                  </label>
                  <div className="flex items-center justify-between border-t border-ink/8 pt-3">
                    <span className="text-sm font-semibold text-ink">Seller subtotal</span>
                    <strong>
                      {formatMoney(
                        (parseMoneyInputToMinorUnits(tailoringAmount) ?? 0) +
                          (parseMoneyInputToMinorUnits(fabricAllowanceAmount) ?? 0),
                        currency
                      )}
                    </strong>
                  </div>
                  <p className="text-xs leading-5 text-ink/55">
                    The fabric allowance is not immediate earnings. It is released only against
                    approved material evidence.
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            <MoneyInput
              id={`quote-amount-${data.order.id}`}
              label="Quote amount"
              value={amount}
              onValueChange={setAmount}
              currency={currency}
              required
            />
          )}
          <details className="rounded-[8px] border border-ui-border bg-white p-4">
            <summary className="cursor-pointer font-semibold text-ink">Optional price details</summary>
            <p className="mt-2 text-xs leading-5 text-ink/58">
              Use these when the customer needs more context before accepting.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <MoneyInput id={`quote-labor-${data.order.id}`} label="Labour" value={laborAmount} onValueChange={setLaborAmount} currency={currency} />
              <MoneyInput id={`quote-sourcing-${data.order.id}`} label="Sourcing" value={sourcingAmount} onValueChange={setSourcingAmount} currency={currency} />
              <MoneyInput id={`quote-rush-${data.order.id}`} label="Rush fee" value={rushAmount} onValueChange={setRushAmount} currency={currency} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-semibold text-ink">
                What is included?
                <textarea value={includedText} onChange={(event) => setIncludedText(event.target.value)} rows={3} maxLength={240} placeholder="One item per line" className="resize-none rounded-[8px] border border-ui-border p-3 font-normal" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-ink">
                What is not included?
                <textarea value={excludedText} onChange={(event) => setExcludedText(event.target.value)} rows={3} maxLength={240} placeholder="One item per line" className="resize-none rounded-[8px] border border-ui-border p-3 font-normal" />
              </label>
            </div>
            <label className="mt-4 grid gap-1.5 text-sm font-semibold text-ink">
              Short pricing summary
              <textarea value={breakdownSummary} onChange={(event) => setBreakdownSummary(event.target.value)} rows={2} maxLength={300} className="resize-none rounded-[8px] border border-ui-border p-3 font-normal" />
            </label>
          </details>
          <label className="grid gap-1.5 text-sm font-semibold text-ink">
            Estimated completion date <span className="text-rust">*</span>
            <input
              value={completion}
              onChange={(event) => setCompletion(event.target.value)}
              type="date"
              min={today}
              max={customerDeadline ?? undefined}
              className="h-11 rounded-[8px] border border-ui-border bg-white px-3 font-normal"
            />
            <span className="text-xs font-normal leading-5 text-ink/56">
              {customerDeadline
                ? `Must be on or before ${new Date(`${customerDeadline}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                : 'Customer has 48 hours to accept after the quote is sent.'}
            </span>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-[8px] border p-4 text-sm leading-6 ${orderReviewed ? 'border-needle/25 bg-needle/8 text-ink' : 'border-ui-border bg-bone/35 text-ink/68'}`}
          >
            <input
              type="checkbox"
              checked={orderReviewed}
              onChange={(event) => setOrderReviewed(event.target.checked)}
              className="mt-1 size-4 accent-needle"
            />
            <span>{QUOTE_ORDER_REVIEW_COPY}</span>
          </label>
          {quoteBlockedReason ? (
            <p className="text-center text-xs leading-5 text-ink/58" aria-live="polite">
              {quoteBlockedReason}
            </p>
          ) : null}
        </div>
      ) : isReadyMade(data.order) ? (
        <div className="mt-4 rounded-[8px] border border-needle/15 bg-needle/5 p-3">
          <p className="text-sm font-semibold text-ink">
            {stageChoiceLabel(data.order, selectedNext)}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink/58">
            {selectedNext === 'FINISHING'
              ? 'Ready-made orders skip design, sourcing, cutting, and sewing. Pack and check this item for handoff.'
              : selectedNext === 'READY_FOR_COLLECTION'
                ? 'Use this once the packed item is ready for the customer to collect.'
                : 'Use this once the packed item is ready for Drapeon-managed dispatch.'}
          </p>
        </div>
      ) : (
        <label className="mt-4 block text-xs font-semibold text-ink/55">
          {isReadyMade(data.order) ? 'Next order step' : 'Next stage'}
          <select
            value={selectedNext}
            onChange={(event) => setNext(event.target.value)}
            className="mt-1 h-10 w-full rounded-[8px] border border-ui-border px-3 text-sm"
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {stageChoiceLabel(data.order, value)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!canConfirmCollection ? (
        <label className="mt-3 block text-xs font-semibold text-ink/55">
          {isReadyMade(data.order)
            ? 'Customer update'
            : canQuote
              ? 'Note to customer (optional)'
              : 'Note'}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={300}
            className="mt-1 w-full rounded-[8px] border border-ui-border p-3 text-sm"
          />
        </label>
      ) : null}
      {!canQuote && !canConfirmCollection && !isReadyMade(data.order) && customProductionRequirement(selectedNext)?.photoRequired ? (
        <div className="mt-3 rounded-[8px] border border-needle/15 bg-needle/5 p-3">
          <label className="block text-xs font-semibold text-ink">
            Fresh {customProductionRequirement(selectedNext)?.label.toLowerCase()} proof
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              multiple={(customProductionRequirement(selectedNext)?.minPhotoCount ?? 0) > 1}
              onChange={(event) => {
                const minimum = customProductionRequirement(selectedNext)?.minPhotoCount ?? 1
                setProofFiles(Array.from(event.target.files ?? []).slice(0, Math.max(1, minimum)))
                setNotice(null)
              }}
              className="mt-2 block w-full rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-full file:border-0 file:bg-needle/10 file:px-3 file:py-2 file:font-semibold file:text-needle"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-ink/58">
            {customProductionRequirement(selectedNext)?.minPhotoCount === 2
              ? 'Add two current views (for example, front and back). Photos or short videos stay private with the order.'
              : 'Add a current photo or short video from this exact stage. Reused proof is blocked and the file stays private with the order.'}
          </p>
          <SelectedProofPreviews
            files={proofFiles}
            onRemove={(index) => setProofFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
          />
        </div>
      ) : null}
      {!canConfirmCollection ? (
        <Button
          className="mt-3"
          disabled={busy || (canQuote && Boolean(quoteBlockedReason))}
          onClick={() => {
            if (!canQuote && selectedNext !== next) setNext(selectedNext)
            void (canQuote ? sendQuote() : advance(selectedNext))
          }}
        >
          {busy
            ? 'Saving…'
            : canQuote
              ? 'Send quote'
              : isReadyMade(data.order)
                ? stageChoiceLabel(data.order, selectedNext)
                : 'Update stage'}
        </Button>
      ) : null}
    </section>
  )
}

function StyleAlignmentPanel({
  data,
  userId,
  refresh,
}: {
  data: Data
  userId: string
  refresh: () => void
}) {
  const alignment = styleAlignmentFor(data.order)
  const tailor = isTailor(data, userId)
  const customer = data.order.customer_id === userId
  const [note, setNote] = useState(alignment?.tailorInterpretation ?? '')
  const [changeNote, setChangeNote] = useState('')
  const [showChange, setShowChange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const status = alignment?.status
  const preCutting = ['CONFIRMED', 'DESIGNING', 'SOURCING'].includes(data.order.stage ?? '')
  if (isReadyMade(data.order) || !preCutting || (!tailor && !customer)) return null

  async function act(action: 'request-style-alignment' | 'approve-style-alignment' | 'request-style-alignment-change') {
    const value = action === 'request-style-alignment-change' ? changeNote.trim() : note.trim()
    if (action === 'request-style-alignment' && value.length < 10) {
      setNotice({ error: true, text: 'Explain the planned interpretation in at least 10 characters.' })
      return
    }
    if (action === 'request-style-alignment-change' && value.length < 5) {
      setNotice({ error: true, text: 'Explain what should change in at least 5 characters.' })
      return
    }
    const filtered = value ? filterContactInfo(value) : null
    if (filtered?.blocked) {
      setNotice({ error: true, text: "Contact details can't be included in this order decision." })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await invoke(tailor ? 'tailor-order-action' : 'customer-order-action', {
        orderId: data.order.id,
        action,
        ...(value ? { note: value } : {}),
      })
      setNotice({
        error: false,
        text:
          action === 'request-style-alignment'
            ? 'Style plan sent for customer approval.'
            : action === 'approve-style-alignment'
              ? 'Style plan approved for cutting.'
              : 'Your requested correction was sent to the tailor.',
      })
      refresh()
    } catch (cause) {
      setNotice({ error: true, text: cause instanceof Error ? cause.message : 'That style decision could not be saved.' })
    } finally {
      setBusy(false)
    }
  }

  if (tailor && status === 'APPROVED') {
    return (
      <section className="app-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Style plan</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Approved for cutting</h2>
        <p className="mt-2 text-sm leading-6 text-ink/58">{alignment?.tailorInterpretation}</p>
      </section>
    )
  }
  if (customer && status === 'APPROVED') {
    return (
      <section className="app-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Style plan</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Your approval is recorded</h2>
        <p className="mt-2 text-sm leading-6 text-ink/58">The tailor can use this interpretation when cutting begins.</p>
      </section>
    )
  }
  if (tailor) {
    return (
      <section className="app-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Before cutting</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">
          {status === 'PENDING_CUSTOMER_APPROVAL' ? 'Style plan awaiting approval' : status === 'CHANGES_REQUESTED' ? 'Update the style plan' : 'Confirm the style plan'}
        </h2>
        {status === 'PENDING_CUSTOMER_APPROVAL' ? (
          <p className="mt-2 text-sm leading-6 text-ink/58">{alignment?.tailorInterpretation}</p>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-ink/58">Explain how you will interpret the references so the customer can approve the plan before fabric is cut.</p>
            <label className="mt-3 block text-xs font-semibold text-ink">
              Interpretation for the customer
              <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} maxLength={500} className="mt-1 w-full rounded-[8px] border border-ui-border p-3 text-sm font-normal" />
            </label>
            <Button className="mt-3" disabled={busy} onClick={() => void act('request-style-alignment')}>
              {busy ? 'Sending…' : status === 'CHANGES_REQUESTED' ? 'Send updated style plan' : 'Send style plan for approval'}
            </Button>
          </>
        )}
        {notice ? <p role={notice.error ? 'alert' : 'status'} className={`mt-3 text-sm font-semibold ${notice.error ? 'text-rust' : 'text-needle'}`}>{notice.text}</p> : null}
      </section>
    )
  }
  if (status !== 'PENDING_CUSTOMER_APPROVAL') return null
  return (
    <section className="app-surface border border-needle/20 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Your approval</p>
      <h2 className="mt-1 text-xl font-semibold text-ink">Review the tailor&apos;s style plan</h2>
      <p className="mt-3 rounded-[8px] bg-needle/5 p-4 text-sm leading-6 text-ink">{alignment?.tailorInterpretation}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act('approve-style-alignment')}>{busy ? 'Saving…' : 'Approve style plan'}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setShowChange((value) => !value)}>Request changes</Button>
      </div>
      {showChange ? (
        <div className="mt-3 rounded-[8px] border border-ui-border p-3">
          <label className="block text-xs font-semibold text-ink">
            What should change?
            <textarea value={changeNote} onChange={(event) => setChangeNote(event.currentTarget.value)} rows={3} maxLength={500} className="mt-1 w-full rounded-[8px] border border-ui-border p-3 text-sm font-normal" placeholder="Example: Keep the neckline closer to the first reference." />
          </label>
          <Button className="mt-3" variant="secondary" disabled={busy} onClick={() => void act('request-style-alignment-change')}>Send correction</Button>
        </div>
      ) : null}
      {notice ? <p role={notice.error ? 'alert' : 'status'} className={`mt-3 text-sm font-semibold ${notice.error ? 'text-rust' : 'text-needle'}`}>{notice.text}</p> : null}
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
  const readyMade = isReadyMade(order)
  const tailor = isTailor(data, userId)
  const customer = order.customer_id === userId
  const activeQuote = data.quotes.find((quote) => quote.status === 'ACTIVE') ?? null
  const references = list(order.reference_photos)
  const collectionCode =
    customer &&
    order.stage === 'READY_FOR_COLLECTION' &&
    (order.delivery_method === 'LOCAL_COLLECTION' || order.delivery_method === 'PICKUP') &&
    typeof order.collection_code === 'string' &&
    /^\d{4}$/.test(order.collection_code)
      ? order.collection_code
      : null
  const dossier = buildBriefDossier(
    {
      orderKind: order.order_kind,
      garmentType: order.garment_type,
      garmentDescription: order.garment_description,
      itemTitle: order.item_title,
      itemSize: order.item_size,
      itemQuantity: order.item_quantity,
      occasion: order.occasion,
      stage: order.stage,
      quotedAmount: order.quoted_amount,
      quotedCurrency: order.quoted_currency ?? order.currency,
      quotedCompletionDate: order.quoted_completion_date,
      deadline: order.deadline,
      fabricSource: order.fabric_source,
      deliveryMethod: order.delivery_method,
      deliveryAddress: order.delivery_address,
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      fabricTracking: order.fabric_tracking,
      trackingNumber: order.tracking_number,
      carrier: order.carrier,
      fulfillmentProvider: order.fulfillment_provider,
      fulfillmentReference: order.fulfillment_reference,
      fulfillmentContactName: order.fulfillment_contact_name,
      fulfillmentContactPhone: order.fulfillment_contact_phone,
      collectionCode,
      referencePhotos: references,
      proofMediaUrls: data.stages.flatMap((update) => (update.photo_url ? [update.photo_url] : [])),
      messageCount: data.messages.length,
      supportMeta: supportMeta(order.special_note),
      customDetail: data.detail
        ? {
            garmentTypeOther: data.detail.garment_type_other,
            genderPresentation: data.detail.gender_presentation,
            socialReferenceLinks: list(data.detail.social_reference_links),
            styleNotes: data.detail.style_notes,
            bodyNote: data.detail.body_note,
            fabricDescription: data.detail.fabric_description,
            fabricBudgetAmount: data.detail.fabric_budget_amount,
            fabricBudgetCurrency: data.detail.fabric_budget_currency,
            fabricSourcingDeadlineDays: data.detail.fabric_sourcing_deadline_days,
            fabricSourcingDeadlineAt: data.detail.fabric_sourcing_deadline_at,
            fabricApprovalStatus: data.detail.fabric_approval_status,
            shippingPreference: data.detail.shipping_preference,
            deliveryInstructions: data.detail.delivery_instructions,
            targetDeliveryDate: data.detail.target_delivery_date,
          }
        : null,
      measurementSnapshot: objectRecord(order.customer_measurements_snapshot),
    },
    {
      date: (value) => formatExplicitZonedDateTime(value) || null,
      money: (amount, currency) => formatMoney(amount, currency),
    }
  )
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
                readyMade
                  ? 'Your purchase, payment, updates, conversation, and handoff remain attached to this order.'
                  : 'The brief, conversation, payment, and production history remain attached to this order.'
              )}
            </p>
          </div>
          <div className="max-w-[14rem] shrink-0">
            <StatusChip
              status={order.stage}
              label={readyMade ? (readyMadeStageLabel(order.stage) ?? undefined) : undefined}
              fallback="Order"
            />
          </div>
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
      {collectionCode ? <PickupCredential order={order} refresh={refresh} /> : null}
      {customer ? <CustomerHandoffActions data={data} refresh={refresh} /> : null}
      <AccountDrapeonDispatchCard
        order={order}
        viewerRole={customer ? 'CUSTOMER' : 'TAILOR'}
        onRefresh={refresh}
      />
      {customer ? <CompletionMoment data={data} refresh={refresh} /> : null}
      {customer ? <CustomerConsultationState data={data} refresh={refresh} /> : null}
      {!readyMade && (customer || tailor) ? (
        <>
          <ConsultationAttendancePanel orderId={order.id} actorRole={customer ? 'CUSTOMER' : 'TAILOR'} />
          {!terminalStages.has(order.stage ?? '') ? (
            <ConsultationReschedulePanel orderId={order.id} actorId={userId} actorRole={customer ? 'CUSTOMER' : 'TAILOR'} onUpdated={refresh} />
          ) : null}
        </>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.65fr)]">
        <div className="grid gap-5">
          <details className="app-surface group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">
                {dossier.title}
              </h2>
              <span className="text-sm font-semibold text-needle group-open:hidden">View</span>
              <span className="hidden text-sm font-semibold text-needle group-open:inline">
                Hide
              </span>
            </summary>
            <div className="mt-4 grid gap-4 border-t border-ui-border pt-4 md:grid-cols-2">
              {dossier.sections.map((section) => (
                <section key={section.id} className="rounded-[10px] border border-ui-border bg-white p-4">
                  <h3 className="font-semibold text-ink">{section.title}</h3>
                  {section.summary ? (
                    <p className="mt-1 text-xs leading-5 text-ink/48">{section.summary}</p>
                  ) : null}
                  <dl className="mt-2">
                    {section.rows.map((row) => (
                      <DossierRow key={row.id} row={row} />
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </details>
          <details className="app-surface group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">
                {readyMade ? 'Order updates' : 'Production history'}
              </h2>
              <span className="text-xs text-ink/45">
                {data.stages.length} updates ·{' '}
                <span className="font-semibold text-needle group-open:hidden">View</span>
                <span className="hidden font-semibold text-needle group-open:inline">Hide</span>
              </span>
            </summary>
            <div className="mt-4 grid gap-3">
              {data.stages.length ? (
                data.stages.map((stage) => (
                  <article key={stage.id} className="rounded-[8px] border border-ui-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <StatusChip
                        status={stage.stage}
                        label={
                          readyMade ? (readyMadeStageLabel(stage.stage) ?? undefined) : undefined
                        }
                        fallback="Update"
                      />
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
                          alt={readyMade ? 'Order update evidence' : 'Production evidence'}
                          className="mt-3 size-24 rounded-[8px] border border-ui-border object-cover"
                        />
                      </a>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="rounded-[8px] bg-ink/5 p-4 text-sm text-ink/55">
                  {readyMade ? 'No order updates yet.' : 'No production updates yet.'}
                </p>
              )}
            </div>
          </details>
          {!readyMade ? <StyleAlignmentPanel data={data} userId={userId} refresh={refresh} /> : null}
          {!readyMade ? (
            <FabricWorkflowPanel
              key={`${order.id}:${order.updated_at ?? ''}`}
              orderId={order.id}
              policyVersion={order.fabric_funding_policy_version}
              onRefresh={refresh}
            />
          ) : null}
          {tailor ? <TailorConsultationResponse data={data} refresh={refresh} /> : null}
          {tailor ? <TailorConsultationState data={data} refresh={refresh} /> : null}
          {tailor ? <TailorActions data={data} refresh={refresh} /> : null}
        </div>
        <aside className="grid h-fit gap-5">
          <section className="app-surface p-5">
            <h2 className="text-xl font-semibold text-ink">
              {readyMade ? 'Payment summary' : 'Commercial state'}
            </h2>
            <dl className="mt-3">
              <Row
                label={readyMade ? 'Item subtotal' : 'Quoted'}
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
              {!readyMade ? (
                <Row
                  label="Quote"
                  value={<StatusChip status={activeQuote?.status} fallback="Not active" />}
                />
              ) : null}
              {!readyMade && activeQuote?.expires_at ? (
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
