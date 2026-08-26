'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  FABRIC_FUNDING_POLICY_V2_VERSION,
  deriveFabricUserFacingState,
  formatFabricCuttingBlockerForRole,
  formatMinorCurrencyAmount,
  formatMoneyInputValue,
  normalizeAccountCurrency,
  parseMoneyInputToMinorUnits,
  type FabricCandidateStatus,
  type FabricAllowanceCoverageCode,
  type FabricHandoffStatus,
  type FabricMaterialIssueOutcome,
  type FabricUserFacingState,
} from '@drape/shared'
import { createClient } from '@/lib/supabase'

type FabricStripeCard = { mount: (element: HTMLElement) => void; unmount: () => void; destroy?: () => void }
type FabricStripe = {
  elements: () => { create: (type: 'card', options?: Record<string, unknown>) => FabricStripeCard }
  confirmCardPayment: (secret: string, options: { payment_method: { card: FabricStripeCard } }) => Promise<{ error?: { message?: string }; paymentIntent?: { id?: string } }>
}

function FabricStripeCheckout({ clientSecret, totalLabel, onConfirmed }: { clientSecret: string; totalLabel: string; onConfirmed: (paymentIntentId: string) => Promise<void> }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<FabricStripe | null>(null)
  const cardRef = useRef<FabricStripeCard | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let card: FabricStripeCard | null = null
    async function mount() {
      const key = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ?? '').trim()
      if (!key) return setError('Stripe web checkout is not configured.')
      if (!window.Stripe) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]')
          if (existing) {
            if (window.Stripe) resolve()
            else {
              existing.addEventListener('load', () => resolve(), { once: true })
              existing.addEventListener('error', () => reject(new Error('Stripe could not load.')), { once: true })
            }
            return
          }
          const script = document.createElement('script')
          script.src = 'https://js.stripe.com/v3/'
          script.async = true
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Stripe could not load.'))
          document.head.appendChild(script)
        })
      }
      if (!active || !window.Stripe || !mountRef.current) return
      const stripe = window.Stripe(key) as FabricStripe | null
      if (!stripe) throw new Error('Stripe checkout could not initialize.')
      card = stripe.elements().create('card', { hidePostalCode: true })
      card.mount(mountRef.current)
      stripeRef.current = stripe
      cardRef.current = card
      setReady(true)
    }
    void mount().catch((cause) => setError(cause instanceof Error ? cause.message : 'Stripe checkout could not load.'))
    return () => { active = false; card?.unmount(); card?.destroy?.() }
  }, [clientSecret])
  async function confirm() {
    const stripe = stripeRef.current
    const card = cardRef.current
    if (!stripe || !card) return setError('Stripe checkout is still loading.')
    setBusy(true)
    setError(null)
    try {
      const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } })
      if (result.error) throw new Error(result.error.message ?? 'Card authorization failed.')
      if (!result.paymentIntent?.id) throw new Error('Stripe did not return a payment reference.')
      await onConfirmed(result.paymentIntent.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be confirmed.')
    } finally { setBusy(false) }
  }
  return <div className="grid gap-3 rounded-[8px] border border-needle/20 bg-white p-4">
    <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">Fabric difference</p><p className="mt-1 font-semibold text-ink">Authorize {totalLabel}</p></div>
    <div ref={mountRef} className="min-h-12 rounded-[8px] border border-ui-border px-4 py-3" />
    {error ? <p role="alert" className="text-sm text-rust">{error}</p> : null}
    <button type="button" disabled={!ready || busy} onClick={() => { void confirm() }} className="rounded-[8px] bg-needle px-4 py-3 font-semibold text-white disabled:opacity-40">{busy ? 'Confirming…' : 'Pay fabric difference'}</button>
    <p className="text-xs leading-5 text-ink/55">Card details are handled by Stripe and are never stored by Drapeon.</p>
  </div>
}

type SignedMedia = {
  mediaType: 'IMAGE' | 'VIDEO'
  originalUrl?: string | null
  displayUrl?: string | null
  posterUrl?: string | null
}
type Candidate = {
  id: string
  component_code: string
  supplier_cost_amount: number
  currency: string
  status: FabricCandidateStatus
  protected_allowance_amount: number
  shortfall_subtotal_amount: number
  shortfall_tax_amount: number
  shortfall_fee_amount: number
  availability_note: string
  quantity_specification: string
  deadline_impact: string
  deadline_impact_note?: string | null
  customer_reason_code?: string | null
  customer_note?: string | null
  provider_release_status?: string | null
  actual_spend_amount?: number | null
  reconciliation_status?: string | null
  supplierEstimateUrl?: string | null
  receiptUrl?: string | null
  customerMedia: SignedMedia[]
  acquiredMedia: SignedMedia[]
}
type Handoff = {
  mode: string
  status: FabricHandoffStatus
  carrier?: string | null
  tracking_number?: string | null
  scheduled_at?: string | null
  handoff_location?: string | null
  issue_note?: string | null
  resolution_outcome?: string | null
  receivedMedia?: SignedMedia[]
}
type Blocker = { code: string; message: string; recovery_action: string; componentCode?: string }
type FabricState = {
  ok: boolean
  role: 'CUSTOMER' | 'TAILOR'
  order: {
    id: string
    reference: string
    stage: string
    fabricSource: 'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'
    policyVersion: string
  }
  allocation: {
    currency?: string | null
    remaining_funded_amount?: number | null
    coverage?: string[] | null
  } | null
  candidates: Candidate[]
  handoff: Handoff | null
  cuttingBlockers: Blocker[]
}
type CropDraft = {
  original: File
  display: File
  preview: string
  crop: {
    x: number
    y: number
    width: number
    height: number
    sourceWidth: number
    sourceHeight: number
    aspectRatio: '4:3'
  }
}
type BrowserMediaDraft =
  | { mediaType: 'IMAGE'; preview: string; image: CropDraft }
  | { mediaType: 'VIDEO'; preview: string; original: File }

const POST_FABRIC_STAGES = new Set(['CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'READY_FOR_COLLECTION', 'COLLECTED', 'COMPLETE'])

const COPY: Record<FabricUserFacingState, readonly [string, string]> = {
  FINDING_MATERIALS: [
    'Find and submit fabric',
    'Submit the exact material, supplier cost, availability, and customer-facing proof.',
  ],
  AWAITING_FABRIC_APPROVAL: [
    'Materials awaiting approval',
    'Review the exact material, proof, and cost before authorizing funds.',
  ],
  AWAITING_FABRIC_PAYMENT: [
    'Material payment required',
    'Only the disclosed shortfall, tax, and fee are due.',
  ],
  SECURING_MATERIALS: ['Securing materials', 'The exact approved release is processing.'],
  AWAITING_RECEIPT: [
    'Add purchase proof',
    'Upload the final receipt and fresh proof of the acquired material.',
  ],
  MATERIALS_READY: [
    'Materials ready',
    'Funding and evidence are reconciled. Cutting can start when the remaining gates are clear.',
  ],
  AWAITING_HANDOFF: [
    'Arrange fabric handoff',
    'Choose how the customer fabric will reach the tailor.',
  ],
  HANDOFF_SCHEDULED: [
    'Fabric handoff scheduled',
    'The agreed handoff is recorded for both people.',
  ],
  FABRIC_IN_TRANSIT: ['Fabric in transit', 'The tailor will confirm receipt and suitability.'],
  FABRIC_ISSUE: [
    'Fabric issue needs a decision',
    'Choose a replacement path or authorize the current material.',
  ],
  FABRIC_EXCEPTION: [
    'Fabric needs review',
    'Funds or evidence could not be reconciled automatically. The protected order state remains unchanged.',
  ],
}
const COMPONENTS = [
  'FABRIC',
  'LINING',
  'TRIMS',
  'EMBROIDERY',
  'NOTIONS',
  'OTHER_AGREED_MATERIAL',
] as const
const MODES = [
  ['CUSTOMER_SHIPS_TO_TAILOR', 'Ship to tailor'],
  ['CUSTOMER_DROPS_OFF_LOCALLY', 'Drop off locally'],
  ['TAILOR_PICKS_UP_LOCALLY', 'Tailor picks up'],
  ['BRINGS_TO_CONSULTATION', 'Bring to consultation or fitting'],
] as const

function label(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}
function money(valueMinor: number | null | undefined, currency = 'NGN') {
  const normalizedCurrency = normalizeAccountCurrency(currency) ?? 'NGN'
  const normalizedAmount = Number.isSafeInteger(valueMinor) ? Number(valueMinor) : 0
  return formatMinorCurrencyAmount(normalizedAmount, normalizedCurrency)
}
function mediaUrl(value: SignedMedia | null | undefined) {
  return value?.displayUrl || value?.posterUrl || value?.originalUrl || null
}
function clientId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function amountMinor(value: string) {
  return parseMoneyInputToMinorUnits(value)
}

function amountMinorForInput(valueMinor: number | null | undefined) {
  if (!Number.isSafeInteger(valueMinor) || Number(valueMinor) < 0) return ''
  return formatMoneyInputValue((Number(valueMinor) / 100).toFixed(2))
}

async function invoke<T>(body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke('fabric-workflow-action', { body })
  if (error || data?.error)
    throw new Error(
      typeof data?.message === 'string'
        ? data.message
        : 'This fabric action could not be completed.'
    )
  return data as T
}
async function upload(pathPrefix: string, file: File) {
  const ext =
    file.name
      .split('.')
      .pop()
      ?.replace(/[^a-z0-9]/giu, '')
      .toLowerCase() || 'jpg'
  const path = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await createClient()
    .storage.from('commercial-evidence')
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error('Evidence could not upload. Try again without leaving this form.')
  return path
}

function BrowserCropEditor({
  file,
  onCancel,
  onSave,
}: {
  file: File
  onCancel: () => void
  onSave: (draft: CropDraft) => void
}) {
  const source = useMemo(() => URL.createObjectURL(file), [file])
  const imageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number; centerX: number; centerY: number; left: number; top: number } | null>(null)
  useEffect(() => () => URL.revokeObjectURL(source), [source])

  const clampPosition = useCallback((next: { x: number; y: number }, nextZoom: number) => {
    const image = imageRef.current
    const frame = frameRef.current
    if (!image?.naturalWidth || !image.naturalHeight || !frame) return next
    const bounds = frame.getBoundingClientRect()
    const cover = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
    const maxX = Math.max(0, (image.naturalWidth * cover * nextZoom - bounds.width) / 2)
    const maxY = Math.max(0, (image.naturalHeight * cover * nextZoom - bounds.height) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    }
  }, [])

  const updateZoom = useCallback((nextZoom: number, nextPosition = position) => {
    const boundedZoom = Math.max(1, Math.min(3, nextZoom))
    setZoom(boundedZoom)
    setPosition(clampPosition(nextPosition, boundedZoom))
  }, [clampPosition, position])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function move(event: ReactPointerEvent) {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const active = [...pointers.current.values()]
    if (active.length >= 2 && pinch.current) {
      const [first, second] = active
      if (!first || !second) return
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const centerX = (first.x + second.x) / 2
      const centerY = (first.y + second.y) / 2
      const nextZoom = Math.max(1, Math.min(3, pinch.current.zoom * distance / pinch.current.distance))
      setZoom(nextZoom)
      setPosition(clampPosition({
        x: pinch.current.left + centerX - pinch.current.centerX,
        y: pinch.current.top + centerY - pinch.current.centerY,
      }, nextZoom))
      return
    }
    if (!drag.current) return
    setPosition(clampPosition({
      x: drag.current.left + event.clientX - drag.current.x,
      y: drag.current.top + event.clientY - drag.current.y,
    }, zoom))
  }

  function releasePointer(event: ReactPointerEvent) {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    const remaining = [...pointers.current.values()][0]
    drag.current = remaining
      ? { x: remaining.x, y: remaining.y, left: position.x, top: position.y }
      : null
  }
  async function save() {
    const image = imageRef.current
    if (!image?.naturalWidth || !image.naturalHeight) return
    const outputWidth = 1200
    const outputHeight = 900
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (!context) return
    const frame = image.parentElement!.getBoundingClientRect()
    const cover =
      Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight) * zoom
    const shownWidth = image.naturalWidth * cover
    const shownHeight = image.naturalHeight * cover
    const sourceX = Math.max(
      0,
      Math.min(
        image.naturalWidth - frame.width / cover,
        (shownWidth - frame.width) / 2 / cover - position.x / cover
      )
    )
    const sourceY = Math.max(
      0,
      Math.min(
        image.naturalHeight - frame.height / cover,
        (shownHeight - frame.height) / 2 / cover - position.y / cover
      )
    )
    const sourceWidth = Math.min(image.naturalWidth - sourceX, frame.width / cover)
    const sourceHeight = Math.min(image.naturalHeight - sourceY, frame.height / cover)
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight
    )
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (!blob) return
    const display = new File([blob], `${file.name.replace(/\.[^.]+$/u, '')}-display.jpg`, {
      type: 'image/jpeg',
    })
    onSave({
      original: file,
      display,
      preview: URL.createObjectURL(display),
      crop: {
        x: sourceX,
        y: sourceY,
        width: sourceWidth,
        height: sourceHeight,
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
        aspectRatio: '4:3',
      },
    })
  }
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-ink/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop material photo"
    >
      <div className="w-full max-w-2xl rounded-[12px] bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-ink">Frame material proof</h3>
            <p className="mt-1 text-sm text-ink/55">
              Drag and zoom. The original stays private and unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-ui-border px-3 py-2 font-semibold"
            aria-label="Cancel crop"
          >
            ×
          </button>
        </div>
        <div
          ref={frameRef}
          className="relative mt-4 aspect-[4/3] touch-none overflow-hidden rounded-[8px] bg-ink/10"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
            const active = [...pointers.current.values()]
            if (active.length >= 2) {
              const [first, second] = active
              if (!first || !second) return
              pinch.current = {
                distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
                zoom,
                centerX: (first.x + second.x) / 2,
                centerY: (first.y + second.y) / 2,
                left: position.x,
                top: position.y,
              }
              drag.current = null
            } else {
              drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
            }
          }}
          onPointerMove={move}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onWheel={(event) => {
            event.preventDefault()
            updateZoom(zoom - event.deltaY * 0.002)
          }}
        >
          <img
            ref={imageRef}
            src={source}
            alt="Crop preview"
            draggable={false}
            className="h-full w-full select-none object-cover"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})` }}
          />
          <span className="pointer-events-none absolute inset-0 border-2 border-white/90" />
        </div>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-ink">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(event) => updateZoom(Number(event.currentTarget.value))}
            aria-label="Crop zoom"
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setZoom(1)
              setPosition({ x: 0, y: 0 })
            }}
            className="rounded-[8px] border border-ui-border px-4 py-2.5 font-semibold"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[8px] border border-ui-border px-4 py-2.5 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void save()
            }}
            className="ml-auto rounded-[8px] bg-needle px-5 py-2.5 font-semibold text-white"
          >
            Use photo
          </button>
        </div>
      </div>
    </div>
  )
}

export function FabricWorkflowPanel({
  orderId,
  policyVersion,
  onRefresh,
}: {
  orderId: string
  policyVersion?: string | null
  onRefresh?: () => void
}) {
  const usesFabricFundingV2 = policyVersion?.trim() === FABRIC_FUNDING_POLICY_V2_VERSION
  const [state, setState] = useState<FabricState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [open, setOpen] = useState<
    'candidate' | 'decision' | 'receipt' | 'handoff' | 'received' | 'issue' | null
  >(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [component, setComponent] = useState('FABRIC')
  const [cost, setCost] = useState('')
  const [availability, setAvailability] = useState('')
  const [quantity, setQuantity] = useState('')
  const [deadline, setDeadline] = useState('NONE')
  const [deadlineNote, setDeadlineNote] = useState('')
  const [estimate, setEstimate] = useState<File | null>(null)
  const [cropSource, setCropSource] = useState<File | null>(null)
  const [customerMedia, setCustomerMedia] = useState<BrowserMediaDraft[]>([])
  const [decisionNote, setDecisionNote] = useState('')
  const [reason, setReason] = useState('OTHER')
  const [actualSpend, setActualSpend] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [acquired, setAcquired] = useState<BrowserMediaDraft | null>(null)
  const [mode, setMode] = useState('CUSTOMER_SHIPS_TO_TAILOR')
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')
  const [handoffIssue, setHandoffIssue] = useState('')
  const [viewer, setViewer] = useState<SignedMedia | null>(null)
  const [stripePayment, setStripePayment] = useState<{ clientSecret: string; paymentIntentId: string; total: number; currency: string } | null>(null)
  const load = useCallback(async () => {
    try {
      setError(null)
      setState(await invoke<FabricState>({ action: 'get-state', orderId }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fabric status could not load.')
    }
  }, [orderId])
  useEffect(() => {
    if (!usesFabricFundingV2) return
    const initialLoad = window.setTimeout(() => { void load() }, 0)
    const client = createClient()
    const channel = client
      .channel(`web-fabric-v2:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_fabric_events',
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          void load()
          onRefresh?.()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        () => {
          void load()
          onRefresh?.()
        }
      )
      .subscribe()
    return () => {
      window.clearTimeout(initialLoad)
      void client.removeChannel(channel)
    }
  }, [load, onRefresh, orderId, usesFabricFundingV2])
  const candidates = useMemo(() => {
    const seen = new Set<string>()
    return (state?.candidates ?? []).filter((item) => {
      if (seen.has(item.component_code)) return false
      seen.add(item.component_code)
      return true
    })
  }, [state?.candidates])
  const selected =
    candidates.find((item) => item.id === selectedId) ??
    candidates.find((item) =>
      [
        'AWAITING_CUSTOMER_DECISION',
        'CHANGES_REQUESTED',
        'AWAITING_SHORTFALL_PAYMENT',
        'AWAITING_RECEIPT',
        'EXCEPTION',
      ].includes(item.status)
    ) ??
    candidates[0] ??
    null
  const outstanding = candidates.length === 0
    ? [
        (state?.allocation?.coverage ?? []).includes('FABRIC')
          ? 'FABRIC'
          : (state?.allocation?.coverage ?? [])[0],
      ].filter((code): code is FabricAllowanceCoverageCode => Boolean(code))
    : []
  const baseVisibleState = state
    ? deriveFabricUserFacingState({
        fabricSource: state.order.fabricSource,
        candidateStatus: selected?.status ?? null,
        handoffStatus: state.handoff?.status ?? null,
      })
    : 'FINDING_MATERIALS'
  const visibleState = baseVisibleState === 'MATERIALS_READY' && outstanding.length
    ? 'FINDING_MATERIALS'
    : baseVisibleState
  const outstandingLabel = label(outstanding[0] ?? 'material').toLowerCase()
  const copy = visibleState === 'FINDING_MATERIALS' && state?.role === 'CUSTOMER'
    ? [
        'Material selection pending',
        `The tailor is preparing the exact ${outstandingLabel} and supplier cost for your review.`,
      ] as const
    : visibleState === 'FINDING_MATERIALS' && state?.role === 'TAILOR' && outstanding.length
      ? [
          `Find and submit ${outstandingLabel}`,
          'Submit its exact supplier cost, availability, and customer-facing proof.',
        ] as const
    : visibleState === 'AWAITING_RECEIPT' && state?.role === 'CUSTOMER'
    ? [
        'Purchase proof pending',
        'The tailor is adding the supplier receipt and fresh proof of the acquired material.',
      ] as const
    : COPY[visibleState] ?? COPY.FABRIC_EXCEPTION
  const hasPurchaseProofPending = candidates.some((item) =>
    ['RELEASE_SUCCEEDED', 'AWAITING_RECEIPT'].includes(item.status)
  )
  const isTailorReplacement =
    state?.order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    state.handoff?.status === 'TAILOR_REPLACEMENT_PROPOSED' &&
    state.handoff?.resolution_outcome === 'TAILOR_SOURCES_REPLACEMENT'
  const replacementCandidateOpen = candidates.some(
    (item) =>
      item.component_code === 'FABRIC' &&
      !['DECLINED', 'SUPERSEDED', 'CHANGES_REQUESTED'].includes(item.status)
  )
  if (!usesFabricFundingV2) return null
  const isFabricHistory = visibleState === 'MATERIALS_READY'
    && (state?.cuttingBlockers?.length ?? 0) === 0
    && POST_FABRIC_STAGES.has(state?.order.stage ?? '')

  if (isFabricHistory && !detailsExpanded) {
    return (
      <button
        id="fabric-workflow"
        type="button"
        onClick={() => setDetailsExpanded(true)}
        className="flex min-h-[76px] w-full items-center justify-between gap-4 rounded-[8px] border border-ink/10 bg-bone px-5 py-4 text-left transition-colors hover:border-needle/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        aria-label="View completed fabric details"
      >
        <span>
          <strong className="block font-display text-lg text-ink">Fabric complete</strong>
          <span className="mt-1 block text-sm text-ink/60">{state?.order.fabricSource === 'TAILOR_SOURCES' ? 'Approved, funded, and reconciled' : 'Received and confirmed suitable'}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-needle">View details</span>
      </button>
    )
  }

  async function run(action: () => Promise<{ acknowledgement?: string }>) {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await action()
      setSuccess(result.acknowledgement ?? 'Fabric status updated.')
      setOpen(null)
      await load()
      onRefresh?.()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'This fabric action could not be completed.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function submitCandidate() {
    const amount = amountMinor(cost)
    if (amount === null || amount <= 0 || !estimate || customerMedia.length === 0) {
      setError(
        'Add the exact supplier cost, private estimate, and at least one customer-facing photo.'
      )
      return
    }
    await run(async () => {
      const estimatePath = await upload(`${orderId}/fabric-v2/estimate`, estimate)
      const media = await Promise.all(
        customerMedia.map(async (draft) => {
          if (draft.mediaType === 'VIDEO') {
            const originalStoragePath = await upload(`${orderId}/fabric-v2/video`, draft.original)
            return { mediaType: 'VIDEO', originalStoragePath, displayStoragePath: originalStoragePath }
          }
          return {
            mediaType: 'IMAGE',
            originalStoragePath: await upload(`${orderId}/fabric-v2/original`, draft.image.original),
            displayStoragePath: await upload(`${orderId}/fabric-v2/display`, draft.image.display),
            crop: draft.image.crop,
          }
        })
      )
      return invoke({
        action: 'submit-candidate',
        orderId,
        componentCode: component,
        supplierCostAmount: amount,
        currency: state?.allocation?.currency ?? 'NGN',
        estimateStoragePath: estimatePath,
        customerMedia: media,
        availabilityNote: availability,
        quantitySpecification: quantity,
        deadlineImpact: deadline,
        deadlineImpactNote: deadline === 'NONE' ? undefined : deadlineNote,
        idempotencyKey: clientId(),
      })
    })
  }
  async function decide(decision: 'APPROVE' | 'REQUEST_CHANGES' | 'DECLINE') {
    if (!selected) return
    await run(() =>
      invoke({
        action: 'decide-candidate',
        candidateId: selected.id,
        decision,
        ...(decision === 'APPROVE' ? {} : { reasonCode: reason, note: decisionNote }),
      })
    )
  }
  async function payShortfall() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const prepared = await invoke<{
        confirmed?: boolean
        provider?: string
        paymentIntentId?: string
        authorizationUrl?: string | null
        clientSecret?: string | null
        breakdown?: { total: number; currency: string }
        acknowledgement?: string
      }>({ action: 'prepare-shortfall-payment', candidateId: selected.id })
      if (prepared.confirmed) {
        setSuccess(prepared.acknowledgement ?? 'Payment already confirmed.')
        await load()
      } else if (prepared.authorizationUrl) {
        window.location.assign(prepared.authorizationUrl)
      } else if (prepared.provider === 'STRIPE' && prepared.clientSecret && prepared.paymentIntentId) {
        setStripePayment({
          clientSecret: prepared.clientSecret,
          paymentIntentId: prepared.paymentIntentId,
          total: prepared.breakdown?.total ?? 0,
          currency: prepared.breakdown?.currency ?? selected.currency,
        })
      } else {
        setError('This payment provider did not return a usable checkout. Refresh and try again.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not start.')
    } finally {
      setBusy(false)
    }
  }
  async function reconcile() {
    if (!selected || !receipt || !acquired) {
      setError('Add the final receipt and fresh acquired-material proof.')
      return
    }
    const spend = amountMinor(actualSpend)
    if (spend === null || spend < 0) {
      setError('Enter the exact amount on the receipt.')
      return
    }
    await run(async () => {
      const receiptPath = await upload(`${orderId}/fabric-v2/receipt`, receipt)
      let acquiredMedia: Array<Record<string, unknown>>
      if (acquired.mediaType === 'VIDEO') {
        const originalStoragePath = await upload(`${orderId}/fabric-v2/acquired-video`, acquired.original)
        acquiredMedia = [{ mediaType: 'VIDEO', originalStoragePath, displayStoragePath: originalStoragePath }]
      } else {
        acquiredMedia = [{
            mediaType: 'IMAGE',
            originalStoragePath: await upload(`${orderId}/fabric-v2/acquired-original`, acquired.image.original),
            displayStoragePath: await upload(`${orderId}/fabric-v2/acquired-display`, acquired.image.display),
            crop: acquired.image.crop,
          }]
      }
      return invoke({
        action: 'reconcile-candidate',
        candidateId: selected.id,
        receiptStoragePath: receiptPath,
        acquiredMedia,
        actualSpendAmount: spend,
      })
    })
  }
  async function saveHandoff() {
    const status = mode === 'CUSTOMER_SHIPS_TO_TAILOR' ? 'IN_TRANSIT' : 'SCHEDULED'
    await run(() =>
      invoke({
        action: 'save-handoff',
        orderId,
        mode,
        status,
        carrier: carrier || undefined,
        trackingNumber: tracking || undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        handoffLocation: location || undefined,
      })
    )
  }
  async function confirmReceived(outcome: 'RECEIVED_SUITABLE' | 'RECEIVED_WITH_ISSUE') {
    if (!acquired) {
      setError('Upload fresh proof of the fabric received.')
      return
    }
    await run(async () => {
      let receivedMedia: Array<Record<string, unknown>>
      if (acquired.mediaType === 'VIDEO') {
        const originalStoragePath = await upload(`${orderId}/fabric-v2/handoff-video`, acquired.original)
        receivedMedia = [{ mediaType: 'VIDEO', originalStoragePath, displayStoragePath: originalStoragePath }]
      } else {
        receivedMedia = [{
            mediaType: 'IMAGE',
            originalStoragePath: await upload(`${orderId}/fabric-v2/handoff-original`, acquired.image.original),
            displayStoragePath: await upload(`${orderId}/fabric-v2/handoff-display`, acquired.image.display),
            crop: acquired.image.crop,
          }]
      }
      return invoke({
        action: 'confirm-handoff-receipt',
        orderId,
        outcome,
        receivedMedia,
        issueNote: outcome === 'RECEIVED_WITH_ISSUE' ? handoffIssue : undefined,
      })
    })
  }
  async function resolveIssue(resolution: FabricMaterialIssueOutcome) {
    await run(() =>
      invoke({
        action: 'resolve-handoff-issue',
        orderId,
        resolution,
        note: decisionNote || undefined,
      })
    )
  }

  return (
    <section
      id="fabric-workflow"
      className="rounded-[8px] border border-needle/16 bg-white/90 p-5 shadow-sm"
      aria-busy={!state && !error}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.17em] text-needle">
            Fabric and materials
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">{copy[0]}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">{copy[1]}</p>
        </div>
        <div className="flex items-center gap-2">
          {state?.allocation ? (
            <span className="rounded-full bg-needle/10 px-3 py-2 text-xs font-semibold text-needle">
              {money(state.allocation.remaining_funded_amount, state.allocation.currency ?? 'NGN')}{' '}
              protected remaining
            </span>
          ) : null}
          {isFabricHistory ? <button type="button" onClick={() => setDetailsExpanded(false)} className="rounded-[8px] px-3 py-2 text-sm font-semibold text-needle hover:bg-needle/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">Hide details</button> : null}
        </div>
      </div>
      {!state && !error ? <p className="mt-4 text-sm text-ink/55">Loading fabric status…</p> : null}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[8px] bg-rust/8 p-3 text-sm font-semibold text-rust"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          className="mt-4 rounded-[8px] bg-needle/10 p-3 text-sm font-semibold text-needle"
        >
          {success}
        </p>
      ) : null}
      {stripePayment && selected ? (
        <div className="mt-4">
          <FabricStripeCheckout
            clientSecret={stripePayment.clientSecret}
            totalLabel={money(stripePayment.total, stripePayment.currency)}
            onConfirmed={async (paymentIntentId) => {
              const result = await invoke<{ acknowledgement?: string }>({
                action: 'confirm-shortfall-payment',
                candidateId: selected.id,
                paymentIntentId,
              })
              setStripePayment(null)
              setSuccess(result.acknowledgement ?? 'Fabric payment confirmed. The exact release is queued.')
              await load()
              onRefresh?.()
            }}
          />
        </div>
      ) : null}
      {candidates.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {candidates.map((item) => {
            const previewMedia = item.customerMedia?.[0]
            const preview = mediaUrl(previewMedia)
            return (
              <article
                key={item.id}
                className={`rounded-[8px] border p-4 ${selected?.id === item.id ? 'border-needle/30 bg-needle/5' : 'border-ink/8 bg-white'}`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setSelectedId(item.id)}
                >
                  <p className="text-xs font-semibold uppercase tracking-[.14em] text-needle">
                    {label(item.component_code)}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <strong>{money(item.supplier_cost_amount, item.currency)}</strong>
                    <span className="text-xs text-ink/52">{label(item.status)}</span>
                  </div>
                </button>
                {preview ? (
                  <button
                    type="button"
                    onClick={() => previewMedia && setViewer(previewMedia)}
                    className="mt-3 block aspect-[4/3] w-full overflow-hidden rounded-[8px] bg-ink/8"
                  >
                    {previewMedia?.mediaType === 'VIDEO' ? <span className="grid h-full w-full place-items-center font-semibold text-needle">Play video proof</span> : <img src={preview} alt={`${label(item.component_code)} proof`} className="h-full w-full object-cover" />}
                  </button>
                ) : null}
                <p className="mt-3 text-sm text-ink/60">{item.quantity_specification}</p>
                {item.shortfall_subtotal_amount > 0 ? (
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-[8px] bg-bone p-3 text-xs">
                    <span>Protected allowance</span>
                    <strong className="text-right">
                      {money(item.protected_allowance_amount, item.currency)}
                    </strong>
                    <span>Material shortfall</span>
                    <strong className="text-right">
                      {money(item.shortfall_subtotal_amount, item.currency)}
                    </strong>
                    <span>Tax</span>
                    <strong className="text-right">
                      {money(item.shortfall_tax_amount, item.currency)}
                    </strong>
                    <span>Fee</span>
                    <strong className="text-right">
                      {money(item.shortfall_fee_amount, item.currency)}
                    </strong>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
      {state?.cuttingBlockers?.length ? (
        <div className="mt-5 rounded-[8px] border border-rust/18 bg-rust/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-rust">
            {state.role === 'TAILOR' ? 'Before Cutting' : 'Before the tailor can start Cutting'}
          </p>
          {state.cuttingBlockers.map((item) => (
            <p key={item.code + (item.componentCode ?? '')} className="mt-2 text-sm text-ink/70">
              {formatFabricCuttingBlockerForRole(item, state.role)}
            </p>
          ))}
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {state?.role === 'TAILOR' &&
        state.order.fabricSource === 'TAILOR_SOURCES' &&
        outstanding.length &&
        !hasPurchaseProofPending ? (
          <button
            type="button"
            onClick={() => {
              setComponent(outstanding[0] ?? 'FABRIC')
              setOpen('candidate')
            }}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Find and submit {label(outstanding[0] ?? 'material').toLowerCase()}
          </button>
        ) : null}
        {state?.role === 'TAILOR' && isTailorReplacement && !replacementCandidateOpen ? (
          <button
            type="button"
            onClick={() => {
              setComponent('FABRIC')
              setOpen('candidate')
            }}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Submit replacement fabric
          </button>
        ) : null}
        {state?.role === 'CUSTOMER' && selected?.status === 'AWAITING_CUSTOMER_DECISION' ? (
          <>
            <button
              type="button"
              onClick={() => {
                void decide('APPROVE')
              }}
              className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
            >
              Approve and authorize {money(selected.supplier_cost_amount, selected.currency)}
            </button>
            <button
              type="button"
              onClick={() => setOpen('decision')}
              className="rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold"
            >
              Request changes or decline
            </button>
          </>
        ) : null}
        {state?.role === 'CUSTOMER' && selected?.status === 'AWAITING_SHORTFALL_PAYMENT' ? (
          <button
            type="button"
            onClick={() => {
              void payShortfall()
            }}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Pay disclosed shortfall
          </button>
        ) : null}
        {state?.role === 'TAILOR' && selected?.status === 'AWAITING_RECEIPT' ? (
          <button
            type="button"
            onClick={() => {
              setActualSpend(amountMinorForInput(selected.supplier_cost_amount))
              setOpen('receipt')
            }}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Add receipt and acquired proof
          </button>
        ) : null}
        {state?.order.fabricSource === 'CUSTOMER_SUPPLIES' && !state.handoff ? (
          <button
            type="button"
            onClick={() => setOpen('handoff')}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Arrange fabric handoff
          </button>
        ) : null}
        {state?.role === 'TAILOR' &&
        state.order.fabricSource === 'CUSTOMER_SUPPLIES' &&
        state.handoff &&
        !['RECEIVED_SUITABLE', 'CONTINUE_AUTHORIZED', 'TAILOR_REPLACEMENT_PROPOSED'].includes(
          state.handoff.status
        ) ? (
          <button
            type="button"
            onClick={() => setOpen('received')}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Confirm fabric received
          </button>
        ) : null}
        {state?.role === 'CUSTOMER' && state.handoff?.status === 'RECEIVED_WITH_ISSUE' ? (
          <button
            type="button"
            onClick={() => setOpen('issue')}
            className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          >
            Resolve material issue
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          className="fixed inset-0 z-[110] grid place-items-end bg-ink/55 p-0 sm:place-items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[16px] bg-white p-5 shadow-2xl sm:rounded-[12px]">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-ink">
                {open === 'candidate'
                  ? `Submit ${label(component).toLowerCase()}`
                  : open === 'decision'
                    ? 'Fabric decision'
                    : open === 'receipt'
                      ? 'Purchase proof'
                      : open === 'handoff'
                        ? 'Arrange handoff'
                        : open === 'received'
                          ? 'Confirm fabric received'
                          : 'Resolve fabric issue'}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded-full border border-ui-border px-3 py-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {open === 'candidate' ? (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-sm font-semibold">
                  Component
                  <select
                    value={component}
                    onChange={(event) => setComponent(event.currentTarget.value)}
                    disabled={isTailorReplacement}
                    className="rounded-[8px] border border-ui-border p-3 disabled:bg-bone"
                  >
                    {(isTailorReplacement
                      ? ['FABRIC']
                      : COMPONENTS.filter((value) =>
                          (state?.allocation?.coverage ?? []).includes(value)
                        )
                    ).map((value) => (
                      <option key={value} value={value}>
                        {label(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Exact supplier cost ({normalizeAccountCurrency(state?.allocation?.currency ?? 'NGN') ?? 'NGN'})
                  <input
                    inputMode="decimal"
                    value={cost}
                    onChange={(event) => setCost(formatMoneyInputValue(event.currentTarget.value))}
                    placeholder="Enter exact amount"
                    className="rounded-[8px] border border-ui-border p-3"
                  />
                </label>
                {amountMinor(cost) !== null && Number(amountMinor(cost)) > 0 ? (
                  <div className="border-l-4 border-needle pl-3" role="status">
                    <p className="text-xs font-semibold uppercase tracking-[.14em] text-ink/50">You are submitting</p>
                    <p className="mt-1 text-lg font-semibold text-ink">{money(amountMinor(cost), state?.allocation?.currency ?? 'NGN')}</p>
                  </div>
                ) : null}
                <label className="grid gap-1 text-sm font-semibold">
                  Availability
                  <input
                    value={availability}
                    onChange={(event) => setAvailability(event.currentTarget.value)}
                    className="rounded-[8px] border border-ui-border p-3"
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Quantity and specification
                  <textarea
                    value={quantity}
                    onChange={(event) => setQuantity(event.currentTarget.value)}
                    className="rounded-[8px] border border-ui-border p-3"
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Deadline impact
                  <select
                    value={deadline}
                    onChange={(event) => setDeadline(event.currentTarget.value)}
                    className="rounded-[8px] border border-ui-border p-3"
                  >
                    <option value="NONE">No impact</option>
                    <option value="MAY_DELAY">May delay</option>
                    <option value="DELAYS_ORDER">Changes deadline</option>
                  </select>
                </label>
                {deadline !== 'NONE' ? (
                  <input
                    value={deadlineNote}
                    onChange={(event) => setDeadlineNote(event.currentTarget.value)}
                    placeholder="Explain the timing impact"
                    className="rounded-[8px] border border-ui-border p-3"
                  />
                ) : null}
                <label className="grid gap-1 text-sm font-semibold">
                  Take a supplier-estimate photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => setEstimate(event.currentTarget.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Or choose the supplier estimate from this device
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(event) => setEstimate(event.currentTarget.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Take a customer-facing material photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file) setCropSource(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Or choose a photo or video from this device
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file?.type.startsWith('video/')) {
                        const media: BrowserMediaDraft = { mediaType: 'VIDEO', preview: URL.createObjectURL(file), original: file }
                        setCustomerMedia((current) => [...current, media].slice(0, 6))
                      } else if (file) setCropSource(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                {customerMedia.length ? (
                  <div className="flex gap-2 overflow-x-auto">
                    {customerMedia.map((item, index) => (
                      <div key={item.preview} className="relative h-24 w-32 shrink-0">
                        {item.mediaType === 'VIDEO' ? <div className="grid h-full w-full place-items-center rounded-[8px] bg-ink/8 text-sm font-semibold text-needle">Video selected</div> : <img src={item.preview} alt={`Material draft ${index + 1}`} className="h-full w-full rounded-[8px] object-cover" />}
                        <button
                          type="button"
                          aria-label={`Remove material draft ${index + 1}`}
                          onClick={() =>
                            setCustomerMedia((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index)
                            )
                          }
                          className="absolute right-1 top-1 rounded-full bg-white px-2 py-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void submitCandidate()
                  }}
                  className="rounded-[8px] bg-needle p-3 font-semibold text-white disabled:opacity-50"
                >
                  Submit for approval
                </button>
              </div>
            ) : null}
            {open === 'decision' ? (
              <div className="mt-4 grid gap-3">
                <select
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                  className="rounded-[8px] border border-ui-border p-3"
                >
                  <option value="TOO_EXPENSIVE">Too expensive</option>
                  <option value="WRONG_COLOR">Wrong color</option>
                  <option value="WRONG_TEXTURE_OR_WEIGHT">Wrong texture or weight</option>
                  <option value="WRONG_QUALITY">Wrong quality</option>
                  <option value="INSUFFICIENT_QUANTITY">Not enough material</option>
                  <option value="DEADLINE_IMPACT">Deadline impact</option>
                  <option value="NO_LONGER_NEEDED">No longer needed</option>
                  <option value="OTHER">Other</option>
                </select>
                <textarea
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.currentTarget.value)}
                  placeholder="Add a note (optional)"
                  className="rounded-[8px] border border-ui-border p-3"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void decide('REQUEST_CHANGES')
                    }}
                    className="rounded-[8px] border border-ui-border px-4 py-3 font-semibold"
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void decide('DECLINE')
                    }}
                    className="rounded-[8px] bg-rust px-4 py-3 font-semibold text-white"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : null}
            {open === 'receipt' ? (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-sm font-semibold">
                  Exact amount spent
                  <input
                    inputMode="decimal"
                    value={actualSpend}
                    onChange={(event) =>
                      setActualSpend(formatMoneyInputValue(event.currentTarget.value))
                    }
                    className="rounded-[8px] border border-ui-border p-3"
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Take a supplier-receipt photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => setReceipt(event.currentTarget.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Or choose the supplier receipt from this device
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(event) => setReceipt(event.currentTarget.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Take a fresh acquired-material photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file) setCropSource(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Or choose a photo or video from this device
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file?.type.startsWith('video/')) setAcquired({ mediaType: 'VIDEO', preview: URL.createObjectURL(file), original: file })
                      else if (file) setCropSource(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                {acquired ? acquired.mediaType === 'VIDEO' ? <div className="grid aspect-[4/3] w-full place-items-center rounded-[8px] bg-ink/8 font-semibold text-needle">Video selected</div> : <img src={acquired.preview} alt="Acquired material draft" className="aspect-[4/3] w-full rounded-[8px] object-cover" /> : null}
                {acquired ? <button type="button" onClick={() => setAcquired(null)} className="rounded-[8px] border border-rust/30 p-3 font-semibold text-rust">Remove proof</button> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void reconcile()
                  }}
                  className="rounded-[8px] bg-needle p-3 font-semibold text-white"
                >
                  Save and reconcile
                </button>
              </div>
            ) : null}
            {open === 'handoff' ? (
              <div className="mt-4 grid gap-3">
                <select
                  value={mode}
                  onChange={(event) => setMode(event.currentTarget.value)}
                  className="rounded-[8px] border border-ui-border p-3"
                >
                  {MODES.map(([value, title]) => (
                    <option key={value} value={value}>
                      {title}
                    </option>
                  ))}
                </select>
                {mode === 'CUSTOMER_SHIPS_TO_TAILOR' ? (
                  <>
                    <input
                      value={carrier}
                      onChange={(event) => setCarrier(event.currentTarget.value)}
                      placeholder="Carrier"
                      className="rounded-[8px] border border-ui-border p-3"
                    />
                    <input
                      value={tracking}
                      onChange={(event) => setTracking(event.currentTarget.value)}
                      placeholder="Tracking number"
                      className="rounded-[8px] border border-ui-border p-3"
                    />
                  </>
                ) : (
                  <>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.currentTarget.value)}
                      className="rounded-[8px] border border-ui-border p-3"
                    />
                    <input
                      value={location}
                      onChange={(event) => setLocation(event.currentTarget.value)}
                      placeholder="Agreed handoff location"
                      className="rounded-[8px] border border-ui-border p-3"
                    />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void saveHandoff()
                  }}
                  className="rounded-[8px] bg-needle p-3 font-semibold text-white"
                >
                  Save handoff
                </button>
              </div>
            ) : null}
            {open === 'received' ? (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-sm font-semibold">
                  Take a fresh receipt and suitability photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file) setCropSource(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Or choose a photo or video from this device
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file?.type.startsWith('video/')) setAcquired({ mediaType: 'VIDEO', preview: URL.createObjectURL(file), original: file })
                      else if (file) setCropSource(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                {acquired ? acquired.mediaType === 'VIDEO' ? <div className="grid aspect-[4/3] w-full place-items-center rounded-[8px] bg-ink/8 font-semibold text-needle">Video selected</div> : <img src={acquired.preview} alt="Received fabric draft" className="aspect-[4/3] w-full rounded-[8px] object-cover" /> : null}
                {acquired ? <button type="button" onClick={() => setAcquired(null)} className="rounded-[8px] border border-rust/30 p-3 font-semibold text-rust">Remove proof</button> : null}
                <textarea
                  value={handoffIssue}
                  onChange={(event) => setHandoffIssue(event.currentTarget.value)}
                  placeholder="Describe any material issue"
                  className="rounded-[8px] border border-ui-border p-3"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void confirmReceived('RECEIVED_SUITABLE')
                    }}
                    className="rounded-[8px] bg-needle px-4 py-3 font-semibold text-white"
                  >
                    Received and suitable
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void confirmReceived('RECEIVED_WITH_ISSUE')
                    }}
                    className="rounded-[8px] border border-rust/30 px-4 py-3 font-semibold text-rust"
                  >
                    Report material issue
                  </button>
                </div>
              </div>
            ) : null}
            {open === 'issue' ? (
              <div className="mt-4 grid gap-2">
                <p className="rounded-[8px] bg-rust/6 p-3 text-sm text-ink/70">
                  {state?.handoff?.issue_note}
                </p>
                <textarea
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.currentTarget.value)}
                  placeholder="Optional note"
                  className="rounded-[8px] border border-ui-border p-3"
                />
                {(
                  [
                    ['CUSTOMER_PROVIDES_REPLACEMENT', 'I will provide a replacement'],
                    ['TAILOR_SOURCES_REPLACEMENT', 'Ask tailor to source a replacement'],
                    ['CONTINUE_WITH_CURRENT_FABRIC', 'Continue with this fabric'],
                  ] as const
                ).map(([value, title]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      void resolveIssue(value)
                    }}
                    className="rounded-[8px] border border-ui-border p-3 text-left font-semibold"
                  >
                    {title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {cropSource ? (
        <BrowserCropEditor
          file={cropSource}
          onCancel={() => setCropSource(null)}
          onSave={(draft) => {
            const media: BrowserMediaDraft = { mediaType: 'IMAGE', preview: draft.preview, image: draft }
            if (open === 'candidate') setCustomerMedia((current) => [...current, media].slice(0, 6))
            else setAcquired(media)
            setCropSource(null)
          }}
        />
      ) : null}
      {viewer ? (
        <div
          className="fixed inset-0 z-[130] grid place-items-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setViewer(null)}
            className="absolute right-5 top-5 rounded-full bg-white px-4 py-2 font-semibold"
            aria-label="Close media viewer"
          >
            ×
          </button>
          {viewer.mediaType === 'VIDEO' ? <video src={viewer.originalUrl ?? undefined} poster={viewer.posterUrl ?? undefined} controls playsInline className="max-h-[90vh] max-w-[95vw]" /> : <img src={mediaUrl(viewer) ?? undefined} alt="Material evidence" className="max-h-[90vh] max-w-[95vw] object-contain" />}
        </div>
      ) : null}
    </section>
  )
}
