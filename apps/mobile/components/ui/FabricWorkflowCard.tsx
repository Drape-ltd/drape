import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  FABRIC_FUNDING_POLICY_V2_VERSION,
  deriveFabricUserFacingState,
  formatFabricCuttingBlockerForRole,
  formatMinorCurrencyAmount,
  formatMoneyInputValue,
  normalizeAccountCurrency,
  parseMoneyInputToMinorUnits,
} from '@drape/shared'
import { Colors, FontSize, FontWeight, Fonts, Radius, Spacing } from '@/constants/theme'
import { invokeFunction, supabase } from '@/lib/supabase'
import { uploadPrivateStorageImage } from '@/lib/storage-upload'
import { usePaystackCheckout } from '@/lib/paystack-checkout'
import { useOptionalStripe } from '@/lib/stripe-runtime'
import { ImageCropEditor, type CropResult } from './ImageCropEditor'
import { Button } from './Button'
import { DrapeMediaViewer, type DrapeMediaViewerItem } from './DrapeMediaViewer'

type SignedMedia = {
  mediaType: 'IMAGE' | 'VIDEO'
  originalUrl?: string | null
  displayUrl?: string | null
  posterUrl?: string | null
  crop?: Record<string, unknown> | null
}

type Candidate = {
  id: string
  component_code: string
  supplier_cost_amount: number
  currency: string
  status: string
  protected_allowance_amount: number
  shortfall_subtotal_amount: number
  shortfall_tax_amount: number
  shortfall_fee_amount: number
  availability_note: string
  quantity_specification: string
  deadline_impact: string
  deadline_impact_note?: string | null
  customer_decision_reason?: string | null
  customer_decision_note?: string | null
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
  status: string
  carrier?: string | null
  tracking_number?: string | null
  scheduled_at?: string | null
  issue_note?: string | null
  resolution_outcome?: string | null
  receivedMedia?: SignedMedia[]
}

type Blocker = { code: string; message: string; recovery_action: string; componentCode?: string | null }

type FabricState = {
  ok: boolean
  role: 'CUSTOMER' | 'TAILOR'
  order: { id: string; reference: string; stage: string; fabricSource: 'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'; policyVersion: string }
  allocation: { currency?: string | null; remaining_funded_amount?: number | null; authorized_amount?: number | null; coverage?: string[] | null } | null
  candidates: Candidate[]
  handoff: Handoff | null
  cuttingBlockers: Blocker[]
}

type PreparedShortfall = {
  ok: boolean
  confirmed?: boolean
  acknowledgement?: string
  provider: 'PAYSTACK' | 'STRIPE'
  paymentIntentId: string
  authorizationUrl?: string | null
  clientSecret?: string | null
  breakdown?: { subtotal: number; tax: number; fee: number; total: number; currency: string; protectedAllowance: number }
}

type DraftPhoto = CropResult & { originalWidth: number; originalHeight: number }
type DraftMedia =
  | { mediaType: 'IMAGE'; uri: string; photo: DraftPhoto }
  | { mediaType: 'VIDEO'; uri: string; asset: ImagePicker.ImagePickerAsset }

const STATE_COPY: Record<string, { title: string; body: string }> = {
  FINDING_MATERIALS: { title: 'Find and submit fabric', body: 'Submit the exact material, supplier cost, availability, and customer-facing proof.' },
  AWAITING_FABRIC_APPROVAL: { title: 'Fabric awaiting approval', body: 'The exact material and cost are ready for the customer’s decision.' },
  AWAITING_FABRIC_PAYMENT: { title: 'Fabric payment required', body: 'The approved cost exceeds the protected allowance. Only the disclosed difference, tax, and fee are due.' },
  SECURING_MATERIALS: { title: 'Securing materials', body: 'Drapeon is releasing only the exact approved material amount.' },
  AWAITING_RECEIPT: { title: 'Add purchase proof', body: 'Upload the supplier receipt and fresh proof of the acquired material.' },
  MATERIALS_READY: { title: 'Materials ready', body: 'Fabric funding and evidence are reconciled. Cutting can start when the remaining gates are clear.' },
  AWAITING_HANDOFF: { title: 'Arrange fabric handoff', body: 'Choose how the customer’s fabric will reach the tailor.' },
  HANDOFF_SCHEDULED: { title: 'Fabric handoff scheduled', body: 'The handoff time is recorded for both people.' },
  FABRIC_IN_TRANSIT: { title: 'Fabric in transit', body: 'Tracking is recorded. The tailor will confirm receipt and suitability.' },
  FABRIC_ISSUE: { title: 'Fabric issue needs a decision', body: 'Choose a replacement path or authorize the current material.' },
  FABRIC_EXCEPTION: { title: 'Fabric needs review', body: 'Funds or evidence could not be reconciled automatically. Drapeon has preserved the order state.' },
}

const COMPONENTS = ['FABRIC', 'LINING', 'TRIMS', 'EMBROIDERY', 'NOTIONS', 'OTHER_AGREED_MATERIAL'] as const
const HANDOFF_MODES = [
  ['CUSTOMER_SHIPS_TO_TAILOR', 'Ship to tailor'],
  ['CUSTOMER_DROPS_OFF_LOCALLY', 'Drop off locally'],
  ['TAILOR_PICKS_UP_LOCALLY', 'Tailor picks up'],
  ['BRINGS_TO_CONSULTATION', 'Bring to consultation or fitting'],
] as const
const POST_FABRIC_STAGES = new Set(['CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'READY_FOR_COLLECTION', 'COLLECTED', 'COMPLETE'])

function formatMoney(amountMinor: number | null | undefined, currency = 'NGN') {
  const normalizedCurrency = normalizeAccountCurrency(currency) ?? 'NGN'
  const normalizedAmount = Number.isSafeInteger(amountMinor) ? Number(amountMinor) : 0
  return formatMinorCurrencyAmount(normalizedAmount, normalizedCurrency)
}

function mediaUri(media: SignedMedia | null | undefined) {
  return media?.displayUrl || media?.posterUrl || media?.originalUrl || null
}

function cleanError(error: Error | null, fallback: string) {
  const message = error?.message?.trim()
  if (!message || /functionshttperror|non-2xx/iu.test(message)) return fallback
  return message
}

function createClientId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function parseMajorAmount(value: string) {
  return parseMoneyInputToMinorUnits(value)
}

function formatMinorAmountForInput(amountMinor: number | null | undefined) {
  if (!Number.isSafeInteger(amountMinor) || Number(amountMinor) < 0) return ''
  return formatMoneyInputValue((Number(amountMinor) / 100).toFixed(2))
}

export function FabricWorkflowCard({ orderId, policyVersion }: { orderId: string; policyVersion?: string | null }) {
  const usesFabricFundingV2 = policyVersion?.trim() === FABRIC_FUNDING_POLICY_V2_VERSION
  const [state, setState] = useState<FabricState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [sheet, setSheet] = useState<'candidate' | 'decision' | 'receipt' | 'handoff' | 'receipt-handoff' | 'issue' | null>(null)
  const [componentCode, setComponentCode] = useState<(typeof COMPONENTS)[number]>('FABRIC')
  const [cost, setCost] = useState('')
  const [availability, setAvailability] = useState('Available now')
  const [quantity, setQuantity] = useState('Enough for the agreed order')
  const [deadlineImpact, setDeadlineImpact] = useState<'NONE' | 'MAY_DELAY' | 'DELAYS_ORDER'>('NONE')
  const [deadlineNote, setDeadlineNote] = useState('')
  const [estimatePhoto, setEstimatePhoto] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [fabricPhoto, setFabricPhoto] = useState<DraftMedia | null>(null)
  const [cropSource, setCropSource] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [decision, setDecision] = useState<'APPROVE' | 'REQUEST_CHANGES' | 'DECLINE'>('APPROVE')
  const [decisionReason, setDecisionReason] = useState('WRONG_COLOR')
  const [decisionNote, setDecisionNote] = useState('')
  const [receiptPhoto, setReceiptPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [acquiredPhoto, setAcquiredPhoto] = useState<DraftMedia | null>(null)
  const [actualSpend, setActualSpend] = useState('')
  const [handoffMode, setHandoffMode] = useState<(typeof HANDOFF_MODES)[number][0]>(HANDOFF_MODES[0][0])
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [handoffOutcome, setHandoffOutcome] = useState<'RECEIVED_SUITABLE' | 'RECEIVED_WITH_ISSUE'>('RECEIVED_SUITABLE')
  const [handoffIssue, setHandoffIssue] = useState('')
  const [handoffPhoto, setHandoffPhoto] = useState<DraftMedia | null>(null)
  const [issueResolution, setIssueResolution] = useState('CUSTOMER_PROVIDES_REPLACEMENT')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const paystack = usePaystackCheckout()
  const stripe = useOptionalStripe()

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const { data, error } = await invokeFunction<FabricState>('fabric-workflow-action', { body: { action: 'get-state', orderId }, timeoutMs: 20_000 })
    if (error || !data?.ok) {
      if (!quiet) Alert.alert('Fabric status unavailable', cleanError(error, 'Pull to refresh and try again.'))
    } else {
      setState(data)
    }
    if (!quiet) setLoading(false)
  }, [orderId])

  useEffect(() => {
    if (!usesFabricFundingV2) return
    void refresh()
    const channel = supabase.channel(`fabric-v2:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_fabric_candidates', filter: `order_id=eq.${orderId}` }, () => { void refresh(true) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_fabric_handoffs', filter: `order_id=eq.${orderId}` }, () => { void refresh(true) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_fabric_events', filter: `order_id=eq.${orderId}` }, () => { void refresh(true) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => { void refresh(true) })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [orderId, refresh, usesFabricFundingV2])

  const activeCandidates = useMemo(() => {
    const latest = new Map<string, Candidate>()
    for (const row of state?.candidates ?? []) {
      if (row.status === 'SUPERSEDED') continue
      if (!latest.has(row.component_code)) latest.set(row.component_code, row)
    }
    return [...latest.values()]
  }, [state?.candidates])
  const defaultCandidate = useMemo(() => {
    const role = state?.role
    const priority = role === 'CUSTOMER'
      ? ['AWAITING_CUSTOMER_DECISION', 'AWAITING_SHORTFALL_PAYMENT', 'RELEASE_BLOCKED', 'EXCEPTION']
      : ['CHANGES_REQUESTED', 'DECLINED', 'AWAITING_RECEIPT', 'RELEASE_SUCCEEDED', 'RELEASE_BLOCKED', 'EXCEPTION']
    return activeCandidates.find((row) => priority.includes(row.status)) ?? activeCandidates[0] ?? null
  }, [activeCandidates, state?.role])
  const candidate = activeCandidates.find((row) => row.id === selectedCandidateId) ?? defaultCandidate
  const uncoveredComponent = activeCandidates.length === 0
    ? ((state?.allocation?.coverage ?? []).includes('FABRIC') ? 'FABRIC' : (state?.allocation?.coverage ?? [])[0])
    : undefined
  const viewerItems = useMemo<DrapeMediaViewerItem[]>(() => activeCandidates.flatMap((row) => [
    ...row.customerMedia.map((media, index) => ({ uri: mediaUri(media) ?? '', label: `${row.component_code.replaceAll('_', ' ')} candidate ${index + 1}`, contextId: `${row.id}:candidate:${index}`, kind: media.mediaType === 'VIDEO' ? 'video' as const : 'photo' as const })),
    ...row.acquiredMedia.map((media, index) => ({ uri: mediaUri(media) ?? '', label: `Acquired ${row.component_code.replaceAll('_', ' ')} ${index + 1}`, contextId: `${row.id}:acquired:${index}`, kind: media.mediaType === 'VIDEO' ? 'video' as const : 'photo' as const })),
  ]).filter((item) => item.uri.length > 0), [activeCandidates])
  const baseFacingState = useMemo(() => state ? deriveFabricUserFacingState({
    fabricSource: state.order.fabricSource,
    candidateStatus: candidate?.status as never,
    handoffStatus: state.handoff?.status as never,
  }) : 'FINDING_MATERIALS', [candidate?.status, state])
  const facingState = baseFacingState === 'MATERIALS_READY' && uncoveredComponent ? 'FINDING_MATERIALS' : baseFacingState
  const componentLabel = uncoveredComponent?.replaceAll('_', ' ').toLowerCase() ?? 'material'
  const copy = facingState === 'FINDING_MATERIALS' && state?.role === 'CUSTOMER'
    ? {
        title: 'Next material pending',
        body: `The tailor is preparing the exact ${componentLabel} and supplier cost for your review.`,
      }
    : facingState === 'FINDING_MATERIALS' && state?.role === 'TAILOR' && uncoveredComponent
      ? {
          title: `Find and submit ${componentLabel}`,
          body: 'Submit its exact supplier cost, availability, and customer-facing proof.',
        }
      : facingState === 'AWAITING_RECEIPT' && state?.role === 'CUSTOMER'
    ? {
        title: 'Purchase proof pending',
        body: 'The tailor is adding the supplier receipt and fresh proof of the acquired material.',
      }
    : STATE_COPY[facingState]

  if (!usesFabricFundingV2) return null
  if (loading && !state) return <View style={styles.card}><ActivityIndicator color={Colors.needleGreen} /><Text style={styles.muted}>Loading fabric status…</Text></View>
  if (!state) return <View style={styles.card}><Text style={styles.title}>Fabric status unavailable</Text><Button label="Try again" variant="secondary" size="md" onPress={() => { void refresh() }} /></View>

  async function choosePhoto(kind: 'estimate' | 'fabric' | 'receipt' | 'acquired' | 'handoff', source: 'camera' | 'library') {
    const proofOnly = kind === 'estimate' || kind === 'receipt'
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        source === 'camera' ? 'Camera access needed' : 'Photo access needed',
        source === 'camera'
          ? 'Allow camera access to take fresh fabric proof.'
          : 'Allow photo access to choose fabric proof from this device.',
      )
      return
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: proofOnly ? ['images'] : ['images', 'videos'], allowsMultipleSelection: false, quality: 1 })
    const asset = result.assets?.[0]
    if (!asset) return
    if (kind === 'estimate') setEstimatePhoto(asset)
    else if (kind === 'receipt') setReceiptPhoto(asset)
    else if (asset.type === 'video') {
      const media: DraftMedia = { mediaType: 'VIDEO', uri: asset.uri, asset }
      if (kind === 'fabric') setFabricPhoto(media)
      else if (kind === 'acquired') setAcquiredPhoto(media)
      else setHandoffPhoto(media)
    }
    else {
      setCropSource({ ...asset, fileName: `${kind}:${asset.fileName ?? 'photo.jpg'}` })
    }
  }

  async function uploadPhoto(asset: { uri: string; mimeType?: string | null; fileName?: string | null }, suffix: string) {
    const contentType = asset.mimeType?.startsWith('video/') ? asset.mimeType : 'image/jpeg'
    const extension = contentType.startsWith('video/') ? (asset.fileName?.split('.').pop()?.toLowerCase() || 'mp4') : 'jpg'
    const path = `${orderId}/fabric-v2/${createClientId()}-${suffix}.${extension}`
    await uploadPrivateStorageImage({ bucket: 'commercial-evidence', path, uri: asset.uri, contentType, upsert: false, purpose: 'PRODUCTION_STAGE' })
    return path
  }

  function artifact(originalPath: string, displayPath: string, photo: DraftPhoto) {
    return {
      originalStoragePath: originalPath,
      displayStoragePath: displayPath,
      mediaType: 'IMAGE',
      crop: { ...photo.crop, sourceWidth: photo.originalWidth, sourceHeight: photo.originalHeight },
    }
  }

  async function uploadMediaArtifact(media: DraftMedia, suffix: string) {
    if (media.mediaType === 'VIDEO') {
      const originalStoragePath = await uploadPhoto(media.asset, `${suffix}-original`)
      return { originalStoragePath, displayStoragePath: originalStoragePath, mediaType: 'VIDEO' as const, posterStoragePath: null, crop: null }
    }
    const [originalStoragePath, displayStoragePath] = await Promise.all([
      uploadPhoto({ uri: media.photo.originalUri }, `${suffix}-original`),
      uploadPhoto(media.photo, `${suffix}-display`),
    ])
    return artifact(originalStoragePath, displayStoragePath, media.photo)
  }

  async function submitCandidate() {
    const allocationCurrency = state?.allocation?.currency ?? 'NGN'
    const supplierCostAmount = parseMajorAmount(cost)
    if (!estimatePhoto || !fabricPhoto || supplierCostAmount === null || supplierCostAmount <= 0) {
      Alert.alert('Complete the fabric details', 'Add an exact cost, private supplier estimate, and cropped customer-facing fabric photo.')
      return
    }
    setBusy(true)
    try {
      const [estimatePath, media] = await Promise.all([
        uploadPhoto(estimatePhoto, 'supplier-estimate'),
        uploadMediaArtifact(fabricPhoto, 'fabric'),
      ])
      const { data, error } = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: {
        action: 'submit-candidate', orderId, componentCode, supplierCostAmount, currency: allocationCurrency,
        estimateStoragePath: estimatePath, customerMedia: [media], availabilityNote: availability,
        quantitySpecification: quantity, deadlineImpact,
        ...(deadlineImpact === 'NONE' ? {} : { deadlineImpactNote: deadlineNote.trim() }),
        idempotencyKey: `candidate:${orderId}:${createClientId()}`,
      } })
      if (error || !data?.ok) throw error ?? new Error('Fabric candidate was not saved.')
      setSheet(null)
      Alert.alert('Fabric sent', data.acknowledgement ?? 'The customer can now review the exact material and cost.')
      await refresh(true)
    } catch (error) {
      Alert.alert('Could not submit fabric', cleanError(error as Error, 'Your photos and notes are still here. Try again.'))
    } finally { setBusy(false) }
  }

  async function submitDecision() {
    if (!candidate) return
    if (decision !== 'APPROVE' && decisionNote.trim().length < 3) {
      Alert.alert('Add a short note', 'Tell the tailor what needs to change or why you declined.')
      return
    }
    setBusy(true)
    const { data, error } = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: {
      action: 'decide-candidate', orderId, candidateId: candidate.id, decision,
      ...(decision === 'APPROVE' ? {} : { reasonCode: decisionReason, note: decisionNote.trim() }),
    } })
    setBusy(false)
    if (error || !data?.ok) return Alert.alert('Decision not saved', cleanError(error, 'Try again. Your note is still here.'))
    setSheet(null)
    Alert.alert(decision === 'APPROVE' ? 'Fabric approved' : 'Decision sent', data.acknowledgement ?? 'The tailor has been notified.')
    await refresh(true)
  }

  async function payShortfall() {
    if (!candidate) return
    setBusy(true)
    try {
      const prepared = await invokeFunction<PreparedShortfall>('fabric-workflow-action', { body: { action: 'prepare-shortfall-payment', orderId, candidateId: candidate.id } })
      if (prepared.error || !prepared.data?.ok) throw prepared.error ?? new Error('Checkout could not be prepared.')
      const payment = prepared.data
      if (payment.confirmed) {
        Alert.alert('Fabric payment confirmed', payment.acknowledgement ?? 'The exact approved release is already queued.')
        await refresh(true)
        return
      }
      if (!payment.breakdown) throw new Error('The payment breakdown is unavailable. Refresh before authorizing payment.')
      const message = `Protected allowance: ${formatMoney(payment.breakdown.protectedAllowance, payment.breakdown.currency)}\nMaterial difference: ${formatMoney(payment.breakdown.subtotal, payment.breakdown.currency)}\nTax: ${formatMoney(payment.breakdown.tax, payment.breakdown.currency)}\nFee: ${formatMoney(payment.breakdown.fee, payment.breakdown.currency)}\nTotal due: ${formatMoney(payment.breakdown.total, payment.breakdown.currency)}`
      await new Promise<void>((resolve, reject) => Alert.alert('Authorize fabric difference', message, [
        { text: 'Not now', style: 'cancel', onPress: () => reject(new Error('CANCELLED')) },
        { text: 'Continue to payment', onPress: () => resolve() },
      ]))
      if (payment.provider === 'PAYSTACK') {
        if (!payment.authorizationUrl) throw new Error('Paystack checkout is unavailable.')
        const result = await paystack.present(payment.authorizationUrl, 'drape://paystack-redirect')
        if (result.type !== 'success') throw new Error(result.type === 'cancel' ? 'CANCELLED' : result.message)
      } else {
        if (!stripe.available || !payment.clientSecret) throw new Error('Card checkout is unavailable in this build.')
        const init = await stripe.initPaymentSheet({ merchantDisplayName: 'Drapeon', paymentIntentClientSecret: payment.clientSecret, returnURL: 'drape://stripe-redirect', allowsDelayedPaymentMethods: false })
        if (init.error) throw new Error(init.error.message)
        const presented = await stripe.presentPaymentSheet()
        if (presented.error) throw new Error(presented.error.message)
      }
      const confirmed = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: { action: 'confirm-shortfall-payment', orderId, candidateId: candidate.id, paymentIntentId: payment.paymentIntentId } })
      if (confirmed.error || !confirmed.data?.ok) throw confirmed.error ?? new Error('Payment confirmation is still pending.')
      Alert.alert('Fabric payment confirmed', confirmed.data.acknowledgement ?? 'The exact approved release is now queued.')
      await refresh(true)
    } catch (error) {
      if ((error as Error).message !== 'CANCELLED') Alert.alert('Payment not completed', cleanError(error as Error, 'Try again when you are ready.'))
    } finally { setBusy(false) }
  }

  async function reconcile() {
    const actualSpendAmount = parseMajorAmount(actualSpend)
    if (!candidate || !receiptPhoto || !acquiredPhoto || actualSpendAmount === null || actualSpendAmount <= 0) {
      Alert.alert('Add purchase proof', 'Add the final supplier receipt, acquired-material photo, and exact amount spent.')
      return
    }
    setBusy(true)
    try {
      const [receiptPath, media] = await Promise.all([
        uploadPhoto(receiptPhoto, 'supplier-receipt'), uploadMediaArtifact(acquiredPhoto, 'acquired'),
      ])
      const { data, error } = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: {
        action: 'reconcile-candidate', orderId, candidateId: candidate.id, receiptStoragePath: receiptPath,
        acquiredMedia: [media], actualSpendAmount,
      } })
      if (error || !data?.ok) throw error ?? new Error('Reconciliation was not saved.')
      setSheet(null)
      Alert.alert('Purchase proof saved', data.acknowledgement ?? 'The exact spend has been reconciled.')
      await refresh(true)
    } catch (error) { Alert.alert('Could not save purchase proof', cleanError(error as Error, 'Try again.')) }
    finally { setBusy(false) }
  }

  async function saveHandoff() {
    setBusy(true)
    const isShipping = handoffMode === 'CUSTOMER_SHIPS_TO_TAILOR'
    const { data, error } = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: {
      action: 'save-handoff', orderId, mode: handoffMode,
      carrier: isShipping ? carrier.trim() : null, trackingNumber: isShipping ? tracking.trim() : null,
      scheduledAt: isShipping ? null : scheduledAt.trim(), note: null,
    } })
    setBusy(false)
    if (error || !data?.ok) return Alert.alert('Handoff not saved', cleanError(error, 'Check the details and try again.'))
    setSheet(null); Alert.alert('Handoff updated', data.acknowledgement ?? 'The tailor has been notified.'); await refresh(true)
  }

  async function confirmHandoff() {
    if (!handoffPhoto || (handoffOutcome === 'RECEIVED_WITH_ISSUE' && handoffIssue.trim().length < 4)) return Alert.alert('Add receipt proof', 'Add a fresh material photo and describe any issue.')
    setBusy(true)
    try {
      const media = await uploadMediaArtifact(handoffPhoto, 'handoff')
      const { data, error } = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: {
        action: 'confirm-handoff-receipt', orderId, outcome: handoffOutcome,
        receivedMedia: [media], issueNote: handoffOutcome === 'RECEIVED_WITH_ISSUE' ? handoffIssue : null,
      } })
      if (error || !data?.ok) throw error ?? new Error('Receipt was not saved.')
      setSheet(null); Alert.alert('Fabric receipt recorded', data.acknowledgement ?? 'The customer has been notified.'); await refresh(true)
    } catch (error) { Alert.alert('Could not confirm receipt', cleanError(error as Error, 'Try again.')) }
    finally { setBusy(false) }
  }

  async function resolveIssue() {
    setBusy(true)
    const { data, error } = await invokeFunction<{ ok: boolean; acknowledgement?: string }>('fabric-workflow-action', { body: { action: 'resolve-handoff-issue', orderId, resolution: issueResolution, note: decisionNote.trim() || null } })
    setBusy(false)
    if (error || !data?.ok) return Alert.alert('Decision not saved', cleanError(error, 'Try again.'))
    setSheet(null); Alert.alert('Material decision sent', data.acknowledgement ?? 'The tailor has been notified.'); await refresh(true)
  }

  const isTailor = state.role === 'TAILOR'
  const customerDecisionReady = !isTailor && candidate?.status === 'AWAITING_CUSTOMER_DECISION'
  const replaceableCandidate = activeCandidates.find((row) => ['CHANGES_REQUESTED', 'DECLINED'].includes(row.status))
  const hasPurchaseProofPending = activeCandidates.some((row) =>
    ['RELEASE_SUCCEEDED', 'AWAITING_RECEIPT'].includes(row.status)
  )
  const isTailorReplacement = state.order.fabricSource === 'CUSTOMER_SUPPLIES'
    && state.handoff?.status === 'TAILOR_REPLACEMENT_PROPOSED'
    && state.handoff?.resolution_outcome === 'TAILOR_SOURCES_REPLACEMENT'
  const allowedCandidateComponents = isTailorReplacement
    ? (['FABRIC'] as const)
    : COMPONENTS.filter((component) => (state.allocation?.coverage ?? []).includes(component))
  const canSubmitCandidate = isTailor && (
    (state.order.fabricSource === 'TAILOR_SOURCES' && (!!uncoveredComponent || !!replaceableCandidate || activeCandidates.length === 0))
    || (isTailorReplacement && !activeCandidates.some((row) => row.component_code === 'FABRIC' && !['DECLINED', 'SUPERSEDED', 'CHANGES_REQUESTED'].includes(row.status)))
  ) && !hasPurchaseProofPending
  const candidateActionLabel = isTailorReplacement
    ? 'Submit replacement fabric'
    : replaceableCandidate
      ? `Submit replacement ${replaceableCandidate.component_code.replaceAll('_', ' ').toLowerCase()}`
      : uncoveredComponent
        ? `Find and submit ${uncoveredComponent.replaceAll('_', ' ').toLowerCase()}`
        : 'Find and submit material'
  const canReconcile = isTailor && !!candidate && ['RELEASE_SUCCEEDED', 'AWAITING_RECEIPT'].includes(candidate.status)
  const canArrangeHandoff = !isTailor && state.order.fabricSource === 'CUSTOMER_SUPPLIES' && (!state.handoff || ['AWAITING_HANDOFF', 'REPLACEMENT_REQUIRED'].includes(state.handoff.status))
  const canConfirmHandoff = isTailor && state.order.fabricSource === 'CUSTOMER_SUPPLIES' && !!state.handoff && !['RECEIVED_SUITABLE', 'CONTINUE_AUTHORIZED', 'TAILOR_REPLACEMENT_PROPOSED'].includes(state.handoff.status)
  const canResolveIssue = !isTailor && state.handoff?.status === 'RECEIVED_WITH_ISSUE'
  const isFabricHistory = facingState === 'MATERIALS_READY'
    && state.cuttingBlockers.length === 0
    && POST_FABRIC_STAGES.has(state.order.stage)

  if (isFabricHistory && !detailsExpanded) {
    return <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="View completed fabric details"
      accessibilityHint="Opens the fabric approval, funding, proof, and reconciliation history"
      onPress={() => setDetailsExpanded(true)}
      style={styles.historyRow}
    >
      <View style={styles.historyCopy}>
        <Text style={styles.historyTitle}>Fabric complete</Text>
        <Text style={styles.historyBody}>{state.order.fabricSource === 'TAILOR_SOURCES' ? 'Approved, funded, and reconciled' : 'Received and confirmed suitable'}</Text>
      </View>
      <View style={styles.historyAction}><Text style={styles.historyActionText}>View details</Text><Feather name="chevron-down" size={18} color={Colors.needleGreenDark} /></View>
    </TouchableOpacity>
  }

  return (
    <View style={[styles.card, facingState === 'FABRIC_EXCEPTION' && styles.warningCard]}>
      <View style={styles.headerRow}>
        <View style={styles.icon}><Feather name={state.order.fabricSource === 'TAILOR_SOURCES' ? 'shopping-bag' : 'package'} size={20} color={Colors.needleGreenDark} /></View>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>FABRIC</Text><Text style={styles.title}>{copy.title}</Text></View>
        {isFabricHistory ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Collapse fabric details" onPress={() => setDetailsExpanded(false)} style={styles.collapseAction}><Text style={styles.collapseText}>Hide</Text><Feather name="chevron-up" size={18} color={Colors.needleGreenDark} /></TouchableOpacity> : null}
      </View>
      <Text style={styles.body}>{copy.body}</Text>
      {activeCandidates.map((row) => <TouchableOpacity key={row.id} accessibilityRole="button" accessibilityLabel={`Review ${row.component_code.replaceAll('_', ' ').toLowerCase()}`} onPress={() => setSelectedCandidateId(row.id)} style={[styles.candidateCard, candidate?.id === row.id && styles.candidateCardSelected]}>
        <View style={styles.amountRow}><View><Text style={styles.amount}>{row.component_code.replaceAll('_', ' ')}</Text><Text style={styles.muted}>{row.status.replaceAll('_', ' ')}</Text></View><Text style={styles.amount}>{formatMoney(row.supplier_cost_amount, row.currency)}</Text></View>
        {mediaUri(row.customerMedia[0]) ? <TouchableOpacity accessibilityRole="imagebutton" accessibilityLabel={`Open ${row.component_code.replaceAll('_', ' ').toLowerCase()} proof`} onPress={() => setViewerIndex(viewerItems.findIndex((item) => item.contextId === `${row.id}:candidate:0`))}><Image source={{ uri: mediaUri(row.customerMedia[0])! }} style={styles.preview} resizeMode="contain" /></TouchableOpacity> : null}
        <Text style={styles.meta}>{row.quantity_specification} · {row.availability_note}</Text>
        {row.shortfall_subtotal_amount > 0 ? <View style={styles.breakdown}>
          <Text style={styles.meta}>Protected allowance: {formatMoney(row.protected_allowance_amount, row.currency)}</Text>
          <Text style={styles.meta}>Material difference: {formatMoney(row.shortfall_subtotal_amount, row.currency)}</Text>
          <Text style={styles.meta}>Tax: {formatMoney(row.shortfall_tax_amount, row.currency)}</Text>
          <Text style={styles.amount}>Total extra: {formatMoney(row.shortfall_subtotal_amount + row.shortfall_tax_amount + row.shortfall_fee_amount, row.currency)}</Text>
        </View> : null}
      </TouchableOpacity>)}
      {state.handoff ? <View style={styles.breakdown}><Text style={styles.amount}>{HANDOFF_MODES.find(([value]) => value === state.handoff?.mode)?.[1] ?? 'Fabric handoff'}</Text><Text style={styles.meta}>{state.handoff.status.replaceAll('_', ' ')}</Text>{state.handoff.tracking_number ? <Text style={styles.meta}>{state.handoff.carrier} · {state.handoff.tracking_number}</Text> : null}</View> : null}
      {state.cuttingBlockers.length > 0 ? <View style={styles.blockers}><Text style={styles.blockerTitle}>{isTailor ? 'Before Cutting' : 'Before the tailor can start Cutting'}</Text>{state.cuttingBlockers.map((blocker) => <Text key={blocker.code} style={styles.blocker}>• {formatFabricCuttingBlockerForRole({ ...blocker, componentCode: blocker.componentCode ?? (blocker.code === 'FABRIC_CANDIDATE_REQUIRED' ? uncoveredComponent : null) }, state.role)}</Text>)}</View> : <Text style={styles.ready}>✓ Fabric gate is clear for Cutting</Text>}
      {canSubmitCandidate ? <Button label={candidateActionLabel} onPress={() => { setComponentCode((isTailorReplacement ? 'FABRIC' : uncoveredComponent ?? replaceableCandidate?.component_code ?? 'FABRIC') as (typeof COMPONENTS)[number]); setSheet('candidate') }} /> : null}
      {customerDecisionReady ? <Button label={`Review and authorize ${formatMoney(candidate?.supplier_cost_amount, candidate?.currency)}`} onPress={() => setSheet('decision')} /> : null}
      {!isTailor && candidate?.status === 'AWAITING_SHORTFALL_PAYMENT' ? <Button label="Pay disclosed fabric difference" loading={busy} onPress={() => { void payShortfall() }} /> : null}
      {canReconcile ? <Button label="Add receipt and acquired-fabric proof" onPress={() => { setActualSpend(formatMinorAmountForInput(candidate?.supplier_cost_amount)); setSheet('receipt') }} /> : null}
      {canArrangeHandoff ? <Button label="Arrange fabric handoff" onPress={() => setSheet('handoff')} /> : null}
      {canConfirmHandoff ? <Button label="Confirm fabric receipt" onPress={() => setSheet('receipt-handoff')} /> : null}
      {canResolveIssue ? <Button label="Resolve fabric issue" onPress={() => setSheet('issue')} /> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh fabric status" style={styles.refresh} onPress={() => { void refresh() }}><Feather name="refresh-cw" size={15} color={Colors.needleGreenDark} /><Text style={styles.refreshText}>Refresh status</Text></TouchableOpacity>

      <Modal visible={!!sheet} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !busy && setSheet(null)}>
        <SafeAreaView style={styles.sheetSafe}>
          <View style={styles.sheetHeader}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSheet(null)} disabled={busy}><Feather name="x" size={26} color={Colors.ink} /></TouchableOpacity><Text style={styles.sheetTitle}>{sheet === 'candidate' ? 'Submit exact fabric' : sheet === 'decision' ? 'Fabric decision' : sheet === 'receipt' ? 'Purchase proof' : sheet === 'handoff' ? 'Fabric handoff' : sheet === 'receipt-handoff' ? 'Confirm receipt' : 'Resolve fabric issue'}</Text><View style={{ width: 26 }} /></View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            {sheet === 'candidate' ? <>
              <Text style={styles.label}>Covered component</Text><View style={styles.chips}>{allowedCandidateComponents.map((value) => <TouchableOpacity key={value} onPress={() => setComponentCode(value)} style={[styles.chip, componentCode === value && styles.chipSelected]}><Text style={styles.chipText}>{value.replaceAll('_', ' ')}</Text></TouchableOpacity>)}</View>
              <Field label={`Exact supplier cost (${normalizeAccountCurrency(state?.allocation?.currency ?? 'NGN') ?? 'NGN'})`} value={cost} onChangeText={(value) => setCost(formatMoneyInputValue(value))} keyboardType="decimal-pad" placeholder="Enter exact amount" />
              {parseMajorAmount(cost) !== null && Number(parseMajorAmount(cost)) > 0 ? <View style={styles.moneyConfirmation}><Text style={styles.moneyConfirmationLabel}>You are submitting</Text><Text style={styles.moneyConfirmationAmount}>{formatMoney(parseMajorAmount(cost), state?.allocation?.currency ?? 'NGN')}</Text></View> : null}
              <Field label="Availability" value={availability} onChangeText={setAvailability} placeholder="Available now" />
              <Field label="Quantity / specification" value={quantity} onChangeText={setQuantity} multiline placeholder="Amount, weave, quality, color" />
              <Text style={styles.label}>Deadline impact</Text><View style={styles.chips}>{(['NONE', 'MAY_DELAY', 'DELAYS_ORDER'] as const).map((value) => <TouchableOpacity key={value} onPress={() => setDeadlineImpact(value)} style={[styles.chip, deadlineImpact === value && styles.chipSelected]}><Text style={styles.chipText}>{value.replaceAll('_', ' ')}</Text></TouchableOpacity>)}</View>
              {deadlineImpact !== 'NONE' ? <Field label="Explain the timing impact" value={deadlineNote} onChangeText={setDeadlineNote} multiline /> : null}
              <PhotoField label="Private supplier estimate" uri={estimatePhoto?.uri} onTakePhoto={() => { void choosePhoto('estimate', 'camera') }} onChooseLibrary={() => { void choosePhoto('estimate', 'library') }} onRemove={() => setEstimatePhoto(null)} />
              <PhotoField label="Customer-facing fabric photo or video" uri={fabricPhoto?.uri} isVideo={fabricPhoto?.mediaType === 'VIDEO'} onTakePhoto={() => { void choosePhoto('fabric', 'camera') }} onChooseLibrary={() => { void choosePhoto('fabric', 'library') }} onRemove={() => setFabricPhoto(null)} />
              <Button label="Submit fabric for approval" loading={busy} onPress={() => { void submitCandidate() }} />
            </> : null}
            {sheet === 'decision' && candidate ? <>
              <Text style={styles.decisionAmount}>{formatMoney(candidate.supplier_cost_amount, candidate.currency)}</Text>
              <Text style={styles.body}>Approval authorizes only this exact fabric cost. Any amount above the protected allowance is shown separately before payment.</Text>
              <View style={styles.chips}>{(['APPROVE', 'REQUEST_CHANGES', 'DECLINE'] as const).map((value) => <TouchableOpacity key={value} onPress={() => setDecision(value)} style={[styles.chip, decision === value && styles.chipSelected]}><Text style={styles.chipText}>{value.replaceAll('_', ' ')}</Text></TouchableOpacity>)}</View>
              {decision !== 'APPROVE' ? <><Text style={styles.label}>Reason</Text><View style={styles.chips}>{['WRONG_COLOR', 'WRONG_QUALITY', 'TOO_EXPENSIVE', 'DEADLINE_IMPACT', 'OTHER'].map((value) => <TouchableOpacity key={value} onPress={() => setDecisionReason(value)} style={[styles.chip, decisionReason === value && styles.chipSelected]}><Text style={styles.chipText}>{value.replaceAll('_', ' ')}</Text></TouchableOpacity>)}</View><Field label="Note to tailor" value={decisionNote} onChangeText={setDecisionNote} multiline /></> : null}
              <Button label={decision === 'APPROVE' ? `Approve fabric and authorize ${formatMoney(candidate.supplier_cost_amount, candidate.currency)}` : 'Send decision'} loading={busy} onPress={() => { void submitDecision() }} />
            </> : null}
            {sheet === 'receipt' ? <><Field label="Exact amount spent" value={actualSpend} onChangeText={(value) => setActualSpend(formatMoneyInputValue(value))} keyboardType="decimal-pad" /><PhotoField label="Final supplier receipt" uri={receiptPhoto?.uri} onTakePhoto={() => { void choosePhoto('receipt', 'camera') }} onChooseLibrary={() => { void choosePhoto('receipt', 'library') }} onRemove={() => setReceiptPhoto(null)} /><PhotoField label="Fresh acquired-material photo or video" uri={acquiredPhoto?.uri} isVideo={acquiredPhoto?.mediaType === 'VIDEO'} onTakePhoto={() => { void choosePhoto('acquired', 'camera') }} onChooseLibrary={() => { void choosePhoto('acquired', 'library') }} onRemove={() => setAcquiredPhoto(null)} /><Button label="Save and reconcile purchase" loading={busy} onPress={() => { void reconcile() }} /></> : null}
            {sheet === 'handoff' ? <><Text style={styles.label}>Handoff method</Text><View style={styles.chips}>{HANDOFF_MODES.map(([value, label]) => <TouchableOpacity key={value} onPress={() => setHandoffMode(value)} style={[styles.chip, handoffMode === value && styles.chipSelected]}><Text style={styles.chipText}>{label}</Text></TouchableOpacity>)}</View>{handoffMode === 'CUSTOMER_SHIPS_TO_TAILOR' ? <><Field label="Carrier" value={carrier} onChangeText={setCarrier} /><Field label="Tracking number" value={tracking} onChangeText={setTracking} /></> : <Field label="Agreed date and time" value={scheduledAt} onChangeText={setScheduledAt} placeholder="2026-08-24T14:00:00-05:00" />}<Button label="Save handoff" loading={busy} onPress={() => { void saveHandoff() }} /></> : null}
            {sheet === 'receipt-handoff' ? <><Text style={styles.label}>Condition</Text><View style={styles.chips}>{(['RECEIVED_SUITABLE', 'RECEIVED_WITH_ISSUE'] as const).map((value) => <TouchableOpacity key={value} onPress={() => setHandoffOutcome(value)} style={[styles.chip, handoffOutcome === value && styles.chipSelected]}><Text style={styles.chipText}>{value.replaceAll('_', ' ')}</Text></TouchableOpacity>)}</View>{handoffOutcome === 'RECEIVED_WITH_ISSUE' ? <Field label="Describe the material issue" value={handoffIssue} onChangeText={setHandoffIssue} multiline /> : null}<PhotoField label="Fresh receipt and suitability photo or video" uri={handoffPhoto?.uri} isVideo={handoffPhoto?.mediaType === 'VIDEO'} onTakePhoto={() => { void choosePhoto('handoff', 'camera') }} onChooseLibrary={() => { void choosePhoto('handoff', 'library') }} onRemove={() => setHandoffPhoto(null)} /><Button label="Confirm receipt" loading={busy} onPress={() => { void confirmHandoff() }} /></> : null}
            {sheet === 'issue' ? <><Text style={styles.body}>{state.handoff?.issue_note}</Text><Text style={styles.label}>Choose the next step</Text><View style={styles.chips}>{[['CUSTOMER_PROVIDES_REPLACEMENT', 'I will provide a replacement'], ['TAILOR_SOURCES_REPLACEMENT', 'Tailor sources a replacement'], ['CONTINUE_WITH_CURRENT_FABRIC', 'Continue with this fabric']].map(([value, label]) => <TouchableOpacity key={value} onPress={() => setIssueResolution(value)} style={[styles.chip, issueResolution === value && styles.chipSelected]}><Text style={styles.chipText}>{label}</Text></TouchableOpacity>)}</View><Field label="Optional note" value={decisionNote} onChangeText={setDecisionNote} multiline /><Button label="Send material decision" loading={busy} onPress={() => { void resolveIssue() }} /></> : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <ImageCropEditor visible={!!cropSource} uri={cropSource?.uri ?? null} sourceWidth={cropSource?.width} sourceHeight={cropSource?.height} onCancel={() => setCropSource(null)} onComplete={(result) => {
        const photo = { ...result, originalWidth: cropSource?.width ?? result.crop.width, originalHeight: cropSource?.height ?? result.crop.height }
        const kind = cropSource?.fileName?.split(':')[0]
        const media: DraftMedia = { mediaType: 'IMAGE', uri: photo.uri, photo }
        if (kind === 'fabric') setFabricPhoto(media); else if (kind === 'acquired') setAcquiredPhoto(media); else setHandoffPhoto(media)
        setCropSource(null)
      }} />
      <DrapeMediaViewer items={viewerItems} activeIndex={viewerIndex} onDismiss={() => setViewerIndex(null)} testID="fabric-workflow-media-viewer" />
    </View>
  )
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={Colors.midGrey} multiline={props.multiline} keyboardType={props.keyboardType} /></View>
}

function PhotoField({ label, uri, isVideo = false, onTakePhoto, onChooseLibrary, onRemove }: { label: string; uri?: string | null; isVideo?: boolean; onTakePhoto: () => void; onChooseLibrary: () => void; onRemove?: () => void }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{uri ? isVideo ? <View style={[styles.photoDraft, styles.videoDraft]}><Feather name="video" size={30} color={Colors.needleGreenDark} /><Text style={styles.meta}>Video selected</Text></View> : <Image source={{ uri }} style={styles.photoDraft} resizeMode="contain" /> : null}<View style={styles.mediaActions}><View style={styles.mediaAction}><Button label={uri ? 'Retake photo' : 'Take photo'} size="md" onPress={onTakePhoto} /></View><View style={styles.mediaAction}><Button label={uri ? 'Replace from library' : 'Choose from library'} variant="secondary" size="md" onPress={onChooseLibrary} /></View>{uri && onRemove ? <View style={styles.mediaAction}><Button label="Remove" variant="ghost" size="md" onPress={onRemove} /></View> : null}</View></View>
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.xl, backgroundColor: Colors.surface, padding: Spacing.xl },
  historyRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.xl, backgroundColor: Colors.bone, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  historyCopy: { flex: 1, gap: 3 }, historyTitle: { fontFamily: Fonts.display, fontSize: FontSize.lg, color: Colors.ink }, historyBody: { fontSize: FontSize.sm, color: Colors.inkLight },
  historyAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }, historyActionText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreenDark },
  collapseAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.sm }, collapseText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreenDark },
  warningCard: { borderColor: Colors.kanteRustLight },
  headerRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  icon: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  headerCopy: { flex: 1, gap: 2 }, eyebrow: { fontSize: FontSize.xs, letterSpacing: 1.4, color: Colors.needleGreenDark, fontWeight: FontWeight.bold },
  title: { fontFamily: Fonts.display, fontSize: FontSize.xl, color: Colors.ink }, body: { fontSize: FontSize.md, lineHeight: 23, color: Colors.inkLight },
  muted: { fontSize: FontSize.sm, color: Colors.midGrey }, meta: { fontSize: FontSize.sm, lineHeight: 21, color: Colors.inkLight },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, alignItems: 'center' }, amount: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  moneyConfirmation: { borderLeftWidth: 3, borderLeftColor: Colors.needleGreen, paddingLeft: Spacing.md, gap: 2 },
  moneyConfirmationLabel: { fontSize: FontSize.xs, color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 1 },
  moneyConfirmationAmount: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  candidateCard: { gap: Spacing.sm, padding: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.lg, backgroundColor: Colors.bone },
  candidateCardSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.lg, backgroundColor: Colors.boneDeep },
  breakdown: { gap: Spacing.xs, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },
  blockers: { gap: Spacing.xs, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.lightGrey }, blockerTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.ink }, blocker: { fontSize: FontSize.sm, lineHeight: 20, color: Colors.inkLight }, ready: { color: Colors.success, fontWeight: FontWeight.semibold },
  refresh: { minHeight: 44, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center' }, refreshText: { color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  sheetSafe: { flex: 1, backgroundColor: Colors.bone }, sheetHeader: { minHeight: 64, paddingHorizontal: Spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey }, sheetTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink }, sheetContent: { padding: Spacing.xl, paddingBottom: 120, gap: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.ink }, field: { gap: Spacing.sm }, input: { minHeight: 54, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, backgroundColor: Colors.surface, color: Colors.ink, fontSize: FontSize.md }, multiline: { minHeight: 100, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }, chip: { minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface }, chipSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight }, chipText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  photoDraft: { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.lg, backgroundColor: Colors.boneDeep }, decisionAmount: { fontFamily: Fonts.display, fontSize: FontSize.xxxl, color: Colors.ink, textAlign: 'center' },
  videoDraft: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  mediaActions: { flexDirection: 'row', gap: Spacing.sm },
  mediaAction: { flex: 1 },
})
