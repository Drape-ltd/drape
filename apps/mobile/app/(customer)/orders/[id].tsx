import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  RefreshControl,
  BackHandler,
  type StyleProp,
  type ImageStyle,
  type ViewStyle,
} from 'react-native'
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useNavigation,
} from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { ConsultationAttendancePanel } from '@/components/ui/ConsultationAttendancePanel'
import { CommercialReceiptCard } from '@/components/ui/CommercialReceiptCard'
import { FabricWorkflowCard } from '@/components/ui/FabricWorkflowCard'
import { TaxDecisionSummaryCard } from '@/components/ui/TaxDecisionSummaryCard'
import { ConsultationReschedulePanel } from '@/components/ui/ConsultationReschedulePanel'
import { ConsultationLifecyclePanel } from '@/components/ui/ConsultationLifecyclePanel'
import { CommercialAdjustmentCard } from '@/components/ui/CommercialAdjustmentCard'
import { SettlementProgressCard } from '@/components/ui/SettlementProgressCard'
import { DrapeonDispatchCard } from '@/components/ui/DrapeonDispatchCard'
import { ReturnResolutionCard } from '@/components/ui/ReturnResolutionCard'
import { OpsRefundStatusCard } from '@/components/ui/OpsRefundStatusCard'
import {
  CommercialBenefitsCard,
  type CommercialBenefitReservation,
} from '@/components/ui/CommercialBenefitsCard'
import { OrderTipCard } from '@/components/ui/OrderTipCard'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import {
  formatCallCountdown,
  getCallLifecycleState,
  deriveFulfillmentAwareHistoryLabel,
  materialReconciliationCopy,
  recommendedSchedulingStartDate,
} from '@drape/shared'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { Sentry } from '@/lib/sentry'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import { openTrackingPage } from '@/lib/shipping'
import { shareGroupOrderInvite } from '@/lib/invite'
import {
  isLikelyConnectivityIssue,
  isMachineErrorCodeMessage,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import {
  CANCELLATION_REVIEW_REASON_LABELS,
  CONSULTATION_EXPIRY_POLICY_LABELS,
  CONSULTATION_NO_SHOW_POLICY_LABELS,
  CONSULTATION_PAYMENT_TIMING_LABELS,
  CONSULTATION_RESCHEDULE_POLICY_LABELS,
  COVERAGE_PREFERENCE_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  enrichMeasurementSnapshot,
  DISPATCH_SERVICE_LEVEL_LABELS,
  FABRIC_HANDOFF_LABELS,
  FABRIC_STRETCH_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_INTENT_LABELS,
  getMeasurementConfirmationFields,
  labelMeasurementField,
  measurementGuideForField,
  MATERIAL_ISSUE_REASON_LABELS,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  measurementAgeLabel,
  MEASUREMENT_SOURCE_LABELS,
  resolveMeasurementAgeMeta,
  STALE_MEASUREMENT_MONTHS,
  WEAR_DAY_SUPPORT_LABELS,
  hasOpenCancellationReview,
  hasOpenDeliveryReview,
  hasOpenMaterialIssue,
  hasOpenScopeChange,
  isShippingFabricHandoff,
  parseOrderSupportMeta,
  withConsultationBookingFallback,
  SCOPE_CHANGE_IMPACT_LABELS,
  SCOPE_CHANGE_TYPE_LABELS,
  type CancellationReviewReason,
  type DeliveryReviewReason,
  type MaterialIssueResponse,
  type MeasurementSnapshotMeta,
  type OrderSupportMeta,
  type ScopeChangeImpact,
  type ScopeChangeType,
} from '@/lib/order-support'
import {
  CUSTOMER_COMPLETED_ORDER_STAGES,
  customerOrderStageLabel,
  isReadyMadePreparationStage,
} from '@/lib/order-flow'
import {
  fetchOpenHandoffIssue,
  handoffHelpCardBody,
  handoffHelpCardTitle,
  handoffIssueLabel,
  handoffIssueStatusLabel,
  resolveHandoffIssue,
  type HandoffIssue,
} from '@/lib/handoff-support'
import {
  Button,
  DrapeActionBar,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  DrapeInlineActionCard,
  DrapeMediaMosaic,
  DrapeMediaViewer,
  DrapeSheet,
  DrapeStatusChip,
  HandoffSupportModal,
  Input,
  MoneyInput,
  PortfolioVideoPreview,
  RemoteImage,
  type DrapeMediaMosaicItem,
  type MediaLightboxItem,
} from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import {
  buildBriefDossier,
  formatConsultationStatusLabel,
  formatMaterialAdvanceStatusLabel,
  formatMeasurementStatusLabel,
  formatScopeChangeStatusLabel,
  isFabricApprovalEvidence,
  latestFabricApprovalEvidence,
  orderHistorySummary,
  sourcedFabricDecisionFromNote,
  MATERIAL_ADVANCE_DECLINE_REASONS,
  MATERIAL_ADVANCE_DECLINE_REASON_LABELS,
  materialAdvanceDeclineReasonLabel,
  formatTaxRate,
  taxLinesForSnapshot,
  taxSnapshotNeedsRefresh,
  type AccountCurrencyCode,
  type DispatchFulfillmentPresentation,
  type MaterialAdvanceDeclineReason,
  styleAlignmentChangeFeedbackFromUpdates,
  styleAlignmentDecisionFromNote,
  styleAlignmentEventFromNote,
} from '@drape/shared'
import { type OrderStage } from '@drape/shared/order-machine'
import {
  QUOTE_REVISION_REASON_LABELS,
  deriveOrderConversationActions,
  type QuoteRevisionReason,
} from '@drape/shared/order-negotiation'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import {
  CUSTOMER_CONCERN_REASONS,
  CUSTOMER_CONCERN_REASON_LABELS,
  FINANCIAL_CASE_REQUESTED_OUTCOMES,
  FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS,
  evidencePromptsForConcern,
  type CustomerConcernReason,
  type FinancialCaseRequestedOutcome,
} from '@drape/shared/financial-cases'
import {
  CANCELLATION_REFUND_COMPONENT_LABELS,
  deriveCancellationPolicy,
} from '@drape/shared/cancellation-policy'
import { useCurrency, formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { paymentRouteCopyForCurrency, useOrderPaymentFlow } from '@/lib/payments'
import { minorUnitsFromInput, moneyInputFromMinorUnits } from '@/lib/money-input'
import { isTerminalOrderStage, purgeTerminalOrderClientState } from '@/lib/order-client-state'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'

type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
}

type OrderStageUpdateRow = {
  id: string
  stage: string
  note: string | null
  photo_url: string | null
  evidence_media: unknown
  created_at: string
}

async function resolvedStageUpdateMedia(row: Pick<OrderStageUpdateRow, 'photo_url' | 'evidence_media'>) {
  if (row.photo_url) return row.photo_url
  if (!Array.isArray(row.evidence_media)) return null
  const asset = row.evidence_media.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined
  const path = typeof asset?.displayPath === 'string' ? asset.displayPath : typeof asset?.originalPath === 'string' ? asset.originalPath : null
  if (!path) return null
  const { data, error } = await supabase.storage.from('commercial-evidence').createSignedUrl(path, 10 * 60)
  return error ? null : data?.signedUrl ?? null
}

async function resolveProductionEvidenceUrls(values: string[]) {
  return (await Promise.all(values.map(async (value) => {
    if (/^https?:\/\//iu.test(value)) return value
    if (!value.includes('/production/')) return null
    const { data, error } = await supabase.storage.from('commercial-evidence').createSignedUrl(value, 10 * 60)
    return error ? null : data?.signedUrl ?? null
  }))).filter((value): value is string => !!value)
}

type CustomOrderDetailRow = {
  garment_type_other: string | null
  gender_presentation: string | null
  social_reference_links: unknown
  style_notes: string | null
  body_note: string | null
  fabric_approval_required: boolean | null
  fabric_approval_status: string | null
  fabric_description: string | null
  fabric_budget_amount: number | null
  fabric_budget_currency: string | null
  fabric_sourcing_deadline_days: number | null
  fabric_sourcing_deadline_at: string | null
  shipping_preference: string | null
  delivery_instructions: string | null
  target_delivery_date: string | null
}

type TailorProfileJoinRow = {
  display_name: string | null
  location: string | null
}

type OrderQueryRow = {
  id: string
  reference: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  seller_item_id: string | null
  fulfillment_option: string | null
  garment_type: string | null
  garment_description: string | null
  occasion: string | null
  deadline: string | null
  item_title: string | null
  item_size: string | null
  item_quantity: number | null
  item_subtotal: number | null
  stage: OrderStage
  tailor_id: string
  quoted_amount: number | null
  currency: string | null
  quoted_currency: string | null
  consultation_fee: number | null
  fulfillment_fee: number | null
  quoted_completion_date: string | null
  quote_expires_at: string | null
  source_currency: string | null
  source_amount: number | null
  subtotal_amount: number | null
  platform_fee_amount: number | null
  tax_amount: number | null
  import_tax_amount: number | null
  duty_amount: number | null
  tax_rate_bps: number | null
  tax_region: string | null
  tax_fallback: boolean | null
  tax_fallback_reason: string | null
  shipping_amount: number | null
  total_amount: number | null
  fulfillment_payment_requested_at: string | null
  fulfillment_payment_paid_at: string | null
  fulfillment_payment_provider: string | null
  fulfillment_payment_intent_id: string | null
  fulfillment_payment_checkout_url: string | null
  fabric_source: string | null
  fabric_funding_policy_version: string | null
  delivery_method: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_phone: string | null
  fabric_tracking: string | null
  tracking_number: string | null
  carrier: string | null
  fulfillment_provider: string | null
  fulfillment_reference: string | null
  fulfillment_contact_name: string | null
  fulfillment_contact_phone: string | null
  reference_photos: unknown
  collection_code: string | null
  video_call_url: string | null
  handoff_completed_at: string | null
  customer_handoff_confirmed_at: string | null
  special_note: string | null
  customer_measurements_snapshot: Record<string, unknown> | null
  created_at: string
  tailor_profiles: TailorProfileJoinRow | TailorProfileJoinRow[] | null
  custom_order_details: CustomOrderDetailRow | CustomOrderDetailRow[] | null
  order_stage_updates: OrderStageUpdateRow[] | null
  active_quote_id: string | null
  active_quote_version: number | null
  negotiation_round_limit: number | null
  negotiation_rounds_used: number | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function wearerLabelFromOrder(
  meta: OrderSupportMeta | null | undefined,
  snapshot: Record<string, unknown> | null | undefined
) {
  const fromMeta = meta?.wearerContext?.label?.trim()
  if (fromMeta) return fromMeta
  const snapshotContext =
    snapshot?.wearerContext && typeof snapshot.wearerContext === 'object' && !Array.isArray(snapshot.wearerContext)
      ? (snapshot.wearerContext as { label?: unknown })
      : null
  if (typeof snapshotContext?.label === 'string' && snapshotContext.label.trim()) {
    return snapshotContext.label.trim()
  }
  return typeof snapshot?.measurementProfileLabel === 'string' && snapshot.measurementProfileLabel.trim()
    ? snapshot.measurementProfileLabel.trim()
    : null
}

function isVideoUri(uri: string | null | undefined) {
  return typeof uri === 'string' && /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/iu.test(uri)
}

function normalizeExternalHref(value: string) {
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`
}

function dossierMediaItems(label: string, mediaUrls: string[]): MediaLightboxItem[] {
  return mediaUrls.slice(0, 6).map((uri, index) => ({
    uri,
    label: `${label} ${index + 1}`,
    kind: isVideoUri(uri) ? 'video' : 'photo',
    bucket: isVideoUri(uri) ? undefined : 'order-photos',
  }))
}

const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo
const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo
const QUOTE_NEGOTIATION_UI_ENABLED = MOBILE_FEATURE_FLAGS.quoteNegotiationV1

function customerCommercialAdjustmentTypeForScope(type: ScopeChangeType) {
  if (type === 'MEASUREMENT_AMENDMENT') return 'FIT_REVISION' as const
  if (type === 'FABRIC_OR_MATERIAL') return 'MATERIAL' as const
  if (type === 'DEADLINE_OR_EVENT') return 'RUSH_WORK' as const
  if (type === 'PAUSE_OR_RESTART') return 'DEADLINE_EXTENSION' as const
  if (type === 'REWORK_OR_ALTERATION') return 'CORRECTION' as const
  return 'SCOPE' as const
}

function orderEvidenceContentType(asset: ImagePicker.ImagePickerAsset) {
  const normalizedMimeType = asset.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalizedMimeType && (ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(normalizedMimeType)) {
    return normalizedMimeType
  }

  const extension = (asset.fileName ?? asset.uri).match(/\.([a-z0-9]+)(?:[?#].*)?$/iu)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'mov') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return asset.type === 'video' ? 'video/mp4' : 'image/jpeg'
}

function orderEvidenceExtension(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'video/quicktime') return 'mov'
  if (contentType === 'video/mp4') return 'mp4'
  return 'jpg'
}

function orderEvidenceDurationSeconds(asset: ImagePicker.ImagePickerAsset) {
  if (typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0) return null
  return asset.duration > 1000 ? asset.duration / 1000 : asset.duration
}

function validateOrderEvidenceAsset(asset: ImagePicker.ImagePickerAsset) {
  const contentType = orderEvidenceContentType(asset)
  const isVideo = asset.type === 'video' || (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)
  if (!isVideo) return null

  if (!(ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return 'That video type is not supported here. Please choose an MP4 or MOV video.'
  }

  if (typeof asset.fileSize === 'number' && asset.fileSize > ORDER_EVIDENCE_VIDEO_MAX_BYTES) {
    return `Choose videos under ${Math.round(ORDER_EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
  }

  const durationSeconds = orderEvidenceDurationSeconds(asset)
  if (durationSeconds && durationSeconds > ORDER_EVIDENCE_VIDEO_MAX_SECONDS) {
    return OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE
  }

  return null
}

function StageMediaPreview({
  uri,
  style,
  surface,
  accessibilityLabel,
}: {
  uri: string
  style: StyleProp<ImageStyle>
  surface: string
  accessibilityLabel?: string
}) {
  if (isVideoUri(uri)) {
    return (
      <PortfolioVideoPreview
        uri={uri}
        style={style as StyleProp<ViewStyle>}
        contentFit="contain"
        nativeControls
        autoplay={false}
        isLooping={false}
      />
    )
  }

  return (
    <RemoteImage
      uri={uri}
      bucket="order-photos"
      style={style}
      contentFit="cover"
      transition={120}
      surface={surface}
      accessibilityLabel={accessibilityLabel}
    />
  )
}

type MeasurementSnapshot = Record<string, unknown> & MeasurementSnapshotMeta

type OrderDetail = {
  id: string
  reference: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  sellerItemId: string | null
  fulfillmentOption: string | null
  garmentType: string
  garmentDescription: string | null
  occasion: string | null
  deadline: string | null
  itemTitle: string | null
  itemSize: string | null
  itemQuantity: number
  itemSubtotal: number | null
  fulfillmentFee: number
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  importTaxAmount: number
  dutyAmount: number
  taxRateBps: number
  taxRegion: string | null
  taxFallback: boolean
  taxFallbackReason: string | null
  shippingAmount: number
  totalAmount: number
  sourceCurrency: CurrencyCode | null
  sourceAmount: number | null
  stage: OrderStage
  tailorId: string
  tailorName: string
  tailorLocation: string | null
  pickupAddress: string | null
  pickupInstructions: string | null
  quotedAmount: number | null
  quotedCurrency: CurrencyCode
  consultationFee: number | null
  quotedCompletionDate: string | null
  quoteExpiresAt: string | null
  activeQuoteId: string | null
  activeQuoteVersion: number | null
  negotiationRoundLimit: number
  negotiationRoundsUsed: number
  fulfillmentPaymentRequestedAt: string | null
  fulfillmentPaymentPaidAt: string | null
  fulfillmentPaymentProvider: string | null
  fulfillmentPaymentIntentId: string | null
  fulfillmentPaymentCheckoutUrl: string | null
  fabricSource: string
  fabricFundingPolicyVersion: string | null
  deliveryMethod: string
  deliveryAddress: string | null
  recipientName: string | null
  recipientPhone: string | null
  fabricTracking: string | null
  trackingNumber: string | null
  carrier: string | null
  fulfillmentProvider: string | null
  fulfillmentReference: string | null
  fulfillmentContactName: string | null
  fulfillmentContactPhone: string | null
  referencePhotos: string[]
  collectionCode: string | null
  videoCallUrl: string | null
  handoffCompletedAt: string | null
  customerHandoffConfirmedAt: string | null
  measurementSnapshot: MeasurementSnapshot | null
  supportMeta: OrderSupportMeta
  customDetail: {
    garmentTypeOther: string | null
    genderPresentation: string | null
    socialReferenceLinks: string[]
    styleNotes: string | null
    bodyNote: string | null
    fabricApprovalRequired: boolean
    fabricApprovalStatus: string | null
    fabricDescription: string | null
    fabricBudgetAmount: number | null
    fabricBudgetCurrency: string | null
    fabricSourcingDeadlineDays: number | null
    fabricSourcingDeadlineAt: string | null
    shippingPreference: string | null
    deliveryInstructions: string | null
    targetDeliveryDate: string | null
  } | null
  stageUpdates: StageUpdate[]
  createdAt: string
}

type OpenQuoteRevision = {
  id: string
  roundNumber: number
  reasonCodes: QuoteRevisionReason[]
  note: string
  targetAmount: number | null
  currency: string
}

type GroupMember = {
  id: string
  displayName: string
  status: 'DRAFT' | 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'REMOVED' | string
  inviteCode: string
  invitedUserId: string | null
  acceptedAt: string | null
}

type GroupMemberListResponse = {
  ok?: boolean
  members?: GroupMember[]
}

type MaterialAdvanceStatus =
  | 'REQUESTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PAID'
  | 'OPS_REVIEW'
  | 'RELEASED'
  | 'BLOCKED'
  | 'DECLINED'
  | 'CANCELLED'

type MaterialAdvance = {
  id: string
  title: string
  description: string
  amount: number
  currency: CurrencyCode
  status: MaterialAdvanceStatus
  releaseStatus: string | null
  estimateStorageBucket: string | null
  estimateStoragePath: string | null
  receiptUrl: string | null
  receiptStorageBucket: string | null
  receiptStoragePath: string | null
  acquiredStorageBucket: string | null
  acquiredStoragePath: string | null
  reconciliationStatus: string | null
  reconciliationOutcome: string | null
  reconciliationResolution: string | null
  customerRefundAmount: number
  unapprovedOverageAmount: number
  receiptNote: string | null
  customerResponseNote: string | null
  customerResponseReason: string | null
  createdAt: string
  fundingSource: 'LEGACY_SEPARATE_PAYMENT' | 'FUNDED_FABRIC_ALLOWANCE'
  providerReleaseStatus: string | null
}

const SUPPORT_EMAIL = 'support@drapeon.co'
const AFTERCARE_WINDOW_DAYS = 14
const AFTERCARE_WINDOW_MS = AFTERCARE_WINDOW_DAYS * 24 * 60 * 60 * 1000
const ORDER_DETAIL_POLL_INTERVAL_MS = 60_000
type AftercareSupportType =
  | 'FIT_ISSUE'
  | 'FINISH_ISSUE'
  | 'DAMAGE_OR_DEFECT'
  | 'ALTERATION_FOLLOW_UP'
  | 'OTHER'

const AFTERCARE_SUPPORT_OPTIONS: AftercareSupportType[] = [
  'FIT_ISSUE',
  'FINISH_ISSUE',
  'DAMAGE_OR_DEFECT',
  'ALTERATION_FOLLOW_UP',
  'OTHER',
]

const AFTERCARE_SUPPORT_LABELS: Record<AftercareSupportType, string> = {
  FIT_ISSUE: 'Fit issue',
  FINISH_ISSUE: 'Finish issue',
  DAMAGE_OR_DEFECT: 'Damage or defect',
  ALTERATION_FOLLOW_UP: 'Alteration follow-up',
  OTHER: 'Other aftercare issue',
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function formatReadableDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'the saved date'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatTimelineTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time not available'
  const day = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${day} at ${time}`
}

function formatOrderUpdateNote(value: string) {
  const note = displayText(value)
  return note.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g,
    (timestamp) => formatConsultationStart(timestamp),
  )
}

function timelineStageLabel(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  orderKind: 'CUSTOM' | 'READY_MADE'
) {
  const note = update.note?.toLowerCase() ?? ''
  if (update.stage === 'CONFIRMED' && note.includes('payment confirmed')) {
    return 'Payment confirmed'
  }
  if (
    update.stage === 'CONFIRMED' &&
    (note.includes('guided fit profile') || note.includes('fit intake'))
  ) {
    return 'Measurements reviewed'
  }
  return customerOrderStageLabel(update.stage as OrderStage, orderKind) ?? update.stage
}

function timelineDotColor(update: Pick<StageUpdate, 'stage' | 'note'>) {
  const note = update.note?.toLowerCase() ?? ''
  if (update.stage === 'PAYMENT_FAILED' || note.includes('failed') || note.includes('cancel')) {
    return Colors.error
  }
  if (
    update.stage === 'PAYMENT_PENDING' ||
    note.includes('checkout started') ||
    note.includes('payment started')
  ) {
    return Colors.statusPending
  }
  if (update.stage === 'IN_DISPUTE' || note.includes('concern') || note.includes('review')) {
    return Colors.kanteRust
  }
  return Colors.needleGreen
}

function getAftercareStatus(order: OrderDetail) {
  if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
    return {
      available: false,
      message: 'Aftercare opens after delivery or collection is confirmed.',
      closesAt: null as string | null,
    }
  }

  const anchor = order.customerHandoffConfirmedAt ?? order.handoffCompletedAt
  if (!anchor) {
    return {
      available: false,
      message:
        'Confirm delivery or collection first, then Drapeon can open the 14-day aftercare window.',
      closesAt: null as string | null,
    }
  }

  const anchorMs = Date.parse(anchor)
  if (!Number.isFinite(anchorMs)) {
    return {
      available: false,
      message:
        'We could not read the delivery confirmation time. Contact support and keep photos in the order thread.',
      closesAt: null as string | null,
    }
  }

  const closesAt = new Date(anchorMs + AFTERCARE_WINDOW_MS).toISOString()
  if (Date.parse(closesAt) < Date.now()) {
    return {
      available: false,
      message: `The ${AFTERCARE_WINDOW_DAYS}-day aftercare window has closed. Contact support if this is a serious safety, fraud, or workmanship concern.`,
      closesAt,
    }
  }

  return {
    available: true,
    message: `Aftercare is open until ${formatReadableDate(closesAt)}. Add photos in the order thread before sending.`,
    closesAt,
  }
}

// The custom production journey is intentionally explicit. Designing and sourcing
// are visible customer milestones, not hidden history entries.
const CUSTOM_PROGRESS_STAGES: OrderStage[] = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
]
const READY_MADE_PROGRESS_STAGES: OrderStage[] = [
  'CONFIRMED',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
]

// Stages that are before production starts — show a "Waiting" pre-step
const PRE_PRODUCTION_STAGES: OrderStage[] = ['CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED']
const PRE_CUTTING_STAGES: OrderStage[] = ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING']
const SCOPE_CHANGE_STAGES: OrderStage[] = [
  'PENDING_QUOTE',
  'CONSULTATION',
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
]
const CUSTOM_PROGRESS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  DESIGNING: 'Design',
  SOURCING: 'Fabric',
  CUTTING: 'Cutting',
  SEWING: 'Sewing',
  FINISHING: 'Finishing',
  READY_FOR_DRAPE_DISPATCH: 'Dispatch',
  SHIPPED: 'Shipped',
}

function progressStagesForOrder(orderKind: 'CUSTOM' | 'READY_MADE') {
  return orderKind === 'READY_MADE' ? READY_MADE_PROGRESS_STAGES : CUSTOM_PROGRESS_STAGES
}

function progressLabel(
  stage: OrderStage,
  orderKind: 'CUSTOM' | 'READY_MADE',
  isCollection: boolean,
  currentOrderStage?: OrderStage
) {
  const terminalHandoffLabel =
    currentOrderStage && isHandoffCompleteStage(currentOrderStage)
      ? isCollection
        ? 'Collected'
        : 'Delivered'
      : null

  if (orderKind === 'READY_MADE') {
    if (stage === 'CONFIRMED') return 'Placed'
    if (stage === 'FINISHING') return 'Preparing'
    if (stage === 'READY_FOR_DRAPE_DISPATCH') return 'Dispatch'
    if (stage === 'OUT_FOR_DELIVERY') return 'On the way'
    if (stage === 'SHIPPED' && terminalHandoffLabel) return terminalHandoffLabel
    if (stage === 'SHIPPED') return isCollection ? 'Ready' : 'Shipped'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') return 'Dispatch'
  if (stage === 'OUT_FOR_DELIVERY') return 'On the way'
  if (stage === 'SHIPPED' && terminalHandoffLabel) return terminalHandoffLabel
  if (stage === 'SHIPPED' && currentOrderStage === 'READY_FOR_COLLECTION' && !isCollection) {
    return 'Dispatch'
  }
  return isCollection && stage === 'SHIPPED' ? 'Ready' : CUSTOM_PROGRESS_LABELS[stage]
}

function isHandoffCompleteStage(stage: OrderStage) {
  return ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(stage)
}

function stageIndex(stage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE'): number {
  // Map READY_FOR_COLLECTION -> same level as SHIPPED.
  // Map delivered / collected / complete -> final shipped-ready milestone in the progress bar.
  const normalised =
    stage === 'READY_FOR_COLLECTION'
      ? 'SHIPPED'
      : stage === 'OUT_FOR_DELIVERY'
        ? 'SHIPPED'
        : stage === 'READY_FOR_DRAPE_DISPATCH'
          ? 'READY_FOR_DRAPE_DISPATCH'
          : orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)
            ? 'FINISHING'
            : stage === 'DELIVERED' || stage === 'COLLECTED' || stage === 'COMPLETE'
              ? 'SHIPPED'
              : stage
  return progressStagesForOrder(orderKind).indexOf(normalised as OrderStage)
}

function handoffOpsButtonLabel(deliveryMethod: string, hasOpenIssue: boolean) {
  if (deliveryMethod === 'LOCAL_COLLECTION') {
    return hasOpenIssue ? 'Update pickup help for Drapeon' : 'Log pickup help for Drapeon'
  }
  return hasOpenIssue ? 'Update Drapeon dispatch help' : 'Contact Drapeon dispatch'
}

function stageGuidance(
  stage: OrderStage,
  deliveryMethod: string,
  orderKind: 'CUSTOM' | 'READY_MADE'
): string | null {
  if (stage === 'CONSULTATION') {
    return 'Consultation comes before the quote. You and the tailor are next to clarify the work before pricing is final.'
  }
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE'
      ? 'You are next. Finish checkout to place this order.'
      : 'You are next. Your quote is accepted, but production cannot start until payment is completed.'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE'
      ? 'Checkout did not complete. You are next to retry payment before this checkout is cancelled automatically.'
      : 'Payment did not complete. You are next to retry payment before this order is cancelled automatically.'
  }
  if (stage === 'CONFIRMED') {
    return orderKind === 'READY_MADE'
      ? deliveryMethod === 'LOCAL_COLLECTION'
        ? 'Your order has been placed. The seller is next to prepare it for pickup.'
        : 'Your payment is confirmed. The seller is next to prepare the order.'
      : 'Your order is confirmed. The tailor is next to begin the first real work stage.'
  }
  if (orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)) {
    return deliveryMethod === 'LOCAL_COLLECTION'
      ? 'Your seller is packing and checking this order. Once it is truly ready, they will mark it ready for collection.'
      : 'Your seller is packing and checking this order. The next handoff step appears here once it is ready.'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') {
    return deliveryMethod === 'LOCAL_DELIVERY'
      ? 'Your seller has packed the order. Drapeon is next to arrange local delivery now.'
      : 'Your seller has packed the order. Drapeon is next to arrange shipment now.'
  }
  if (stage === 'DESIGNING') {
    return 'The tailor is working through design details and pattern decisions.'
  }
  if (stage === 'SOURCING') {
    return 'The tailor is sourcing the agreed fabric or materials.'
  }
  if (stage === 'CUTTING') {
    return 'Fabric is being cut. This is the point where the garment starts becoming irreversible.'
  }
  if (stage === 'SEWING') {
    return 'Your garment is being sewn.'
  }
  if (stage === 'FINISHING') {
    return 'Final checks and finishing are underway before handoff.'
  }
  if (stage === 'OUT_FOR_DELIVERY') {
    return 'A local delivery partner is bringing your order to you now. Be reachable on the phone tied to this order.'
  }
  if (stage === 'SHIPPED') {
    return 'A courier has accepted the parcel. You are next once it arrives, either to confirm receipt or raise a concern.'
  }
  if (stage === 'DELIVERED') {
    return 'Delivery is confirmed. Your 72-hour review window is open before payout is released to the tailor.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. Your 72-hour review window is open before payout is released to the tailor.'
  }
  if (stage === 'COMPLETE') {
    return 'This order is complete.'
  }
  if (stage === 'IN_DISPUTE') {
    return 'Your concern is under review.'
  }
  if (stage === 'READY_FOR_COLLECTION' && deliveryMethod === 'LOCAL_COLLECTION') {
    return 'Bring your collection code to pickup. Exact pickup details are shown below.'
  }
  return null
}

function refundCoverageLabel(components: string[]) {
  return components
    .map(
      (component) =>
        CANCELLATION_REFUND_COMPONENT_LABELS[
          component as keyof typeof CANCELLATION_REFUND_COMPONENT_LABELS
        ]
    )
    .join(', ')
}

function preProductionLabel(stage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE') {
  if (stage === 'CONSULTATION') return 'Consultation scheduled'
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE' ? 'Waiting for payment' : 'Awaiting payment'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE' ? 'Payment failed' : 'Retry payment'
  }
  return 'Awaiting confirmation'
}

function baseAmount(
  order: Pick<
    OrderDetail,
    | 'orderKind'
    | 'itemSubtotal'
    | 'subtotalAmount'
    | 'quotedAmount'
    | 'fulfillmentFee'
    | 'taxAmount'
  >
) {
  if (typeof order.subtotalAmount === 'number' && order.subtotalAmount > 0) {
    return order.subtotalAmount
  }
  if (order.orderKind === 'READY_MADE') {
    return (
      order.itemSubtotal ??
      (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
    )
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee - (order.taxAmount ?? 0), 0)
}

function taxLabelForOrder(order: Pick<OrderDetail, 'taxFallback' | 'taxRegion' | 'taxRateBps'>) {
  const region = order.taxRegion?.trim() || 'Tax'
  const rate = order.taxRateBps > 0 ? ` (${formatTaxRate(order.taxRateBps)})` : ''
  return `${order.taxFallback ? 'Estimated ' : ''}${region}${rate}`
}

function fulfillmentFeeLabel(
  order: Pick<OrderDetail, 'orderKind' | 'deliveryMethod' | 'fulfillmentOption'>
) {
  if (
    order.deliveryMethod === 'LOCAL_DELIVERY' ||
    (order.orderKind === 'READY_MADE' && order.fulfillmentOption === 'DELIVERY')
  )
    return 'Standard delivery fee'
  if (order.deliveryMethod === 'LOCAL_COLLECTION' || order.fulfillmentOption === 'PICKUP')
    return 'Fulfillment fee'
  return 'Standard shipping fee'
}

function fulfillmentOptionLabel(
  option: OrderDetail['fulfillmentOption'],
  deliveryMethod: OrderDetail['deliveryMethod']
) {
  if (option === 'PICKUP' || deliveryMethod === 'LOCAL_COLLECTION') return 'Pickup'
  if (option === 'DELIVERY' || deliveryMethod === 'LOCAL_DELIVERY') return 'Delivery'
  if (option === 'SHIPPING') return 'Shipping'
  return option ?? 'Fulfillment'
}

function pendingFulfillmentPaymentLabel(
  order: Pick<OrderDetail, 'deliveryMethod' | 'fulfillmentOption'>
) {
  if (order.deliveryMethod === 'LOCAL_DELIVERY' || order.fulfillmentOption === 'DELIVERY')
    return 'Delivery payment requested'
  return 'Extra shipping payment requested'
}

function hasPendingFulfillmentPayment(
  order: Pick<
    OrderDetail,
    | 'deliveryMethod'
    | 'fulfillmentFee'
    | 'fulfillmentPaymentRequestedAt'
    | 'fulfillmentPaymentPaidAt'
  >
) {
  return (
    order.deliveryMethod !== 'LOCAL_COLLECTION' &&
    order.fulfillmentFee > 0 &&
    !!order.fulfillmentPaymentRequestedAt &&
    !order.fulfillmentPaymentPaidAt
  )
}

function safeOperationalText(value: string | null | undefined, fallback: string) {
  if (!value) return null
  const decoded = decodeDisplayText(value)
  return filterContactInfo(decoded).blocked ? fallback : decoded
}

function displayText(value: string | null | undefined, fallback = '') {
  const decoded = decodeDisplayText(value ?? '').trim()
  return decoded || fallback
}

function displayNullableText(value: string | null | undefined) {
  const decoded = displayText(value)
  return decoded || null
}

function defaultConsultationStart() {
  const value = new Date()
  value.setDate(value.getDate() + 1)
  value.setMinutes(0, 0, 0)
  return value
}

function formatConsultationStart(value: string | Date | null | undefined, timezone?: string | null) {
  return formatExplicitZonedDateTime(value, { timeZone: timezone, fallback: 'Choose a time' }) ?? 'Choose a time'
}

export default function OrderTrackingScreen() {
  const { id, sent, placed, tab, returnTo, historyChain, action, advanceId } = useLocalSearchParams<{
    id: string
    sent?: string
    placed?: string
    tab?: string
    returnTo?: string
    historyChain?: string
    action?: string
    advanceId?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const userId = user?.id

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [consultationClockMs, setConsultationClockMs] = useState(() => Date.now())
  const loadedOrderIdRef = useRef<string | null>(null)

  function fallbackTab(stage?: OrderStage | null): 'active' | 'completed' {
    if (tab === 'active' || tab === 'completed') return tab
    if (stage && CUSTOMER_COMPLETED_ORDER_STAGES.includes(stage)) {
      return 'completed'
    }
    return 'active'
  }
  const explicitReturnPath = pickSafeReturnTo(historyChain, returnTo)

  function goBack() {
    if (sent === '1') {
      router.replace({ pathname: '/(customer)/orders', params: { tab: 'active' } })
      return
    }
    if (placed === '1') {
      router.replace({ pathname: '/(customer)/orders', params: { tab: 'active' } })
      return
    }
    goBackOrReturnTo(
      router,
      navigation,
      explicitReturnPath,
      { pathname: '/(customer)/orders', params: { tab: fallbackTab(order?.stage) } },
    )
  }

  useContextualBackHandler(goBack)

  useEffect(() => {
    const timer = setInterval(() => setConsultationClockMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [showDispute, setShowDispute] = useState(false)
  const [showCancellationReview, setShowCancellationReview] = useState(false)
  const [showDeliveryReview, setShowDeliveryReview] = useState(false)
  const [showMaterialIssueResponse, setShowMaterialIssueResponse] = useState(false)
  const [showScopeChange, setShowScopeChange] = useState(false)
  const [showHandoffSupport, setShowHandoffSupport] = useState(false)
  const [showAftercareSupport, setShowAftercareSupport] = useState(false)
  const [showCustomerConsultation, setShowCustomerConsultation] = useState(false)
  const [showConsultationReschedule, setShowConsultationReschedule] = useState(false)
  const [consultationReschedulePending, setConsultationReschedulePending] = useState(false)
  const [consultationRescheduleRequired, setConsultationRescheduleRequired] = useState(false)
  const [fabricTracking, setFabricTracking] = useState('')
  const [approvingFabric, setApprovingFabric] = useState(false)
  const [fabricChangeNote, setFabricChangeNote] = useState('')
  const [approvingStyle, setApprovingStyle] = useState(false)
  const [styleChangeNote, setStyleChangeNote] = useState('')
  const [showStyleCorrection, setShowStyleCorrection] = useState(false)
  const [showStyleChangeFeedback, setShowStyleChangeFeedback] = useState(false)
  const [showEmergencySupport, setShowEmergencySupport] = useState(false)
  const [savingFabric, setSavingFabric] = useState(false)
  const [confirmingMeasurements, setConfirmingMeasurements] = useState(false)
  const [hasReview, setHasReview] = useState(false)
  const [reviewCheckComplete, setReviewCheckComplete] = useState(false)
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false)
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false)
  const [dispatchHandoffComplete, setDispatchHandoffComplete] = useState(false)
  const [dispatchFulfillmentState, setDispatchFulfillmentState] = useState<DispatchFulfillmentPresentation | null>(null)
  const completionPromptShownRef = useRef(false)
  const [handoffIssue, setHandoffIssue] = useState<HandoffIssue | null>(null)
  const [materialAdvances, setMaterialAdvances] = useState<MaterialAdvance[]>([])
  const [respondingAdvanceId, setRespondingAdvanceId] = useState<string | null>(null)
  const [decliningAdvance, setDecliningAdvance] = useState<MaterialAdvance | null>(null)
  const [materialAdvanceDeclineReason, setMaterialAdvanceDeclineReason] = useState<MaterialAdvanceDeclineReason>('FIND_CHEAPER_OPTION')
  const [materialAdvanceDeclineNote, setMaterialAdvanceDeclineNote] = useState('')
  const [materialAdvanceConfirmation, setMaterialAdvanceConfirmation] = useState<{
    decision: 'APPROVE' | 'DECLINE'
    title: string
    detail: string
  } | null>(null)
  const [payingAdvanceId, setPayingAdvanceId] = useState<string | null>(null)
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [productionEvidenceMedia, setProductionEvidenceMedia] = useState<string[]>([])
  const [fabricEvidenceMedia, setFabricEvidenceMedia] = useState<string[]>([])
  const [fabricApprovalHistoryMedia, setFabricApprovalHistoryMedia] = useState<string[]>([])
  const [mediaPreview, setMediaPreview] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null)
  const [startingConsultationCall, setStartingConsultationCall] = useState<
    'audio' | 'video' | null
  >(null)
  const [resolvingHandoffIssue, setResolvingHandoffIssue] = useState(false)
  const { startOrderPayment, startMaterialAdvancePayment } = useOrderPaymentFlow()

  const openDossierLink = useCallback(async (href: string) => {
    try {
      await Linking.openURL(normalizeExternalHref(href))
    } catch {
      Alert.alert('Could not open link', 'Please try again in a moment.')
    }
  }, [])

  const openMediaPreview = useCallback((items: MediaLightboxItem[], index: number) => {
    setMediaPreview({ items, index })
  }, [])
  const purgedTerminalOrderRef = useRef<string | null>(null)

  function openOrderMessages() {
    if (!order) return
    router.navigate({
      pathname: '/(customer)/messages/[orderId]',
      params: {
        orderId: order.id,
        returnTo: `/(customer)/orders/${order.id}`,
        historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
      },
    })
  }

  function askToRescheduleConsultation() {
    if (!order) return
    setShowConsultationReschedule(true)
  }

  async function startConsultationCall(callType: 'audio' | 'video') {
    if (!order || startingConsultationCall) return
    setStartingConsultationCall(callType)
    try {
      router.push({
        pathname: '/call-join',
        params: {
          orderId: order.id,
          callKind: 'consultation',
          callType,
          historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
        },
      })
    } finally {
      setStartingConsultationCall(null)
    }
  }

  async function contactSupport(kind: 'general' | 'aftercare' = 'general') {
    const fallbackSubject = `${kind === 'aftercare' ? 'Aftercare help' : 'Order help'}: #${order?.reference ?? id}`
    const subject = encodeURIComponent(fallbackSubject)
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}`
    const supported = await Linking.canOpenURL(mailto)
    if (!supported) {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}", and keep the live order updated here so support can follow the full timeline.`
      )
      return
    }

    try {
      await Linking.openURL(mailto)
    } catch {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}", and keep the live order updated here so support can follow the full timeline.`
      )
    }
  }

  const fetchOrder = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true
      // Route focus can beat auth hydration on cold/deep-link entry. Do not send
      // an undefined customer id to PostgREST; the callback reruns when auth is ready.
      if (!id || !userId) return
      const shouldReplaceSurface = !silent && loadedOrderIdRef.current !== id
      if (shouldReplaceSurface) {
        setLoading(true)
        setOrder(null)
        setMaterialAdvances([])
        setProductionEvidenceMedia([])
        setFabricEvidenceMedia([])
        setFabricApprovalHistoryMedia([])
      }
      setFetchErrorMessage('')
      try {
        const [orderRes, reviewRes] = await Promise.allSettled([
          supabase
            .from('orders')
            .select(
              `
            id, reference, order_kind, seller_item_id, fulfillment_option, garment_type, garment_description, occasion, deadline, item_title, item_size, item_quantity, item_subtotal, stage,
            tailor_id, tailor_profile_id, quoted_amount, currency, quoted_currency, consultation_fee, fulfillment_fee, quoted_completion_date,
            active_quote_id, active_quote_version, negotiation_round_limit, negotiation_rounds_used, quote_expires_at,
            source_currency, source_amount, subtotal_amount, platform_fee_amount, tax_amount, import_tax_amount, duty_amount, tax_rate_bps, tax_region, tax_fallback, tax_fallback_reason, shipping_amount, total_amount,
            fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
            fabric_source, fabric_funding_policy_version, delivery_method, delivery_address, recipient_name, recipient_phone, fabric_tracking, tracking_number, carrier,
            fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos,
            collection_code, video_call_url, handoff_completed_at, customer_handoff_confirmed_at, special_note, customer_measurements_snapshot, created_at,
            tailor_profiles!tailor_profile_id(display_name, location),
            custom_order_details(garment_type_other, gender_presentation, social_reference_links, style_notes, body_note, fabric_approval_required, fabric_approval_status, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, shipping_preference, delivery_instructions, target_delivery_date),
            order_stage_updates(id, stage, note, photo_url, evidence_media, created_at)
          `
            )
            .eq('id', id)
            .eq('customer_id', userId)
            .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
            .maybeSingle(),
          supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('order_id', id),
        ])

        const orderError = orderRes.status === 'fulfilled' ? orderRes.value.error : orderRes.reason

        if (orderError) {
          const databaseError = orderError as {
            code?: string
            details?: string
            hint?: string
            message?: string
          }
          const normalizedError = new Error(
            databaseError.message || 'The order query failed.',
          )
          Object.assign(normalizedError, {
            name: 'OrderFetchError',
            cause: databaseError,
          })
          Sentry.captureException(normalizedError, {
            tags: { operation: 'fetchOrder', databaseCode: databaseError.code ?? 'unknown' },
            extra: {
              orderId: id,
              details: databaseError.details,
              hint: databaseError.hint,
            },
          })
          throw normalizedError
        }

        const data = orderRes.status === 'fulfilled' ? orderRes.value.data : null
        if (reviewRes.status === 'fulfilled' && !reviewRes.value.error) {
          setHasReview((reviewRes.value.count ?? 0) > 0)
          setReviewCheckComplete(true)
        } else {
          // Do not present a duplicate review prompt when review state is unknown.
          setReviewCheckComplete(false)
        }

        if (data) {
          const d = data as OrderQueryRow
          const openHandoffIssue = await fetchOpenHandoffIssue(d.id)
          let pickupAddress: string | null = null
          let pickupInstructions: string | null = null

          if (d.delivery_method === 'LOCAL_COLLECTION' && d.tailor_id) {
            const { data: pickupData } = await supabase
              .from('tailor_pickup_details')
              .select('pickup_address, pickup_instructions')
              .eq('user_id', d.tailor_id)
              .maybeSingle()

            pickupAddress =
              typeof pickupData?.pickup_address === 'string' ? pickupData.pickup_address : null
            pickupInstructions =
              typeof pickupData?.pickup_instructions === 'string'
                ? pickupData.pickup_instructions
                : null
          }

          setFabricTracking(d.fabric_tracking ?? '')
          setHandoffIssue(openHandoffIssue)
          let supportMeta = parseOrderSupportMeta(displayText(d.special_note))
          if (!supportMeta.consultation && d.stage === 'CONSULTATION') {
            const { data: consultationBooking } = await supabase
              .from('consultation_bookings')
              .select('status, scheduled_start_at, scheduled_end_at, fee_mode, fee_amount, fee_currency, fee_creditable, payment_status, paid_at, call_type, policy_version')
              .eq('order_id', d.id)
              .eq('status', 'CONFIRMED')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            supportMeta = withConsultationBookingFallback(supportMeta, consultationBooking)
          }
          const shouldLoadGroupMembers = supportMeta.bulkOrder?.enabled === true
          const groupMemberRows = shouldLoadGroupMembers
            ? (await invokeFunction<GroupMemberListResponse>('group-member-action', {
                body: { action: 'list', orderId: d.id },
                timeoutMs: 10_000,
              })).data?.members ?? []
            : []
          const { data: materialAdvanceRows } = await supabase
            .from('order_material_advances')
            .select('id, title, description, amount, currency, status, release_status, estimate_storage_bucket, estimate_storage_path, receipt_url, receipt_storage_bucket, receipt_storage_path, acquired_storage_bucket, acquired_storage_path, reconciliation_status, reconciliation_outcome, reconciliation_resolution, customer_refund_amount, unapproved_overage_amount, receipt_note, customer_response_note, customer_response_reason, created_at, funding_source, provider_release_status')
            .eq('order_id', d.id)
            .order('created_at', { ascending: false })
          const { data: productionEvidenceRows, error: productionEvidenceError } = await supabase
            .from('order_production_evidence')
            .select('stage_key, photo_urls, metadata, created_at')
            .eq('order_id', d.id)
            .order('created_at', { ascending: true })
          if (productionEvidenceError) {
            Sentry.captureException(productionEvidenceError, { extra: { context: 'customer_order_production_evidence', orderId: d.id } })
          }
          setProductionEvidenceMedia(await resolveProductionEvidenceUrls(Array.from(new Set(
            (productionEvidenceRows ?? []).flatMap((row) => asStringList(row.photo_urls)),
          ))))
          const latestFabricEvidence = latestFabricApprovalEvidence(productionEvidenceRows ?? [])
          setFabricApprovalHistoryMedia(Array.from(new Set(
            (productionEvidenceRows ?? [])
              .filter((row) => isFabricApprovalEvidence({ stageKey: row.stage_key, metadata: row.metadata }))
              .flatMap((row) => asStringList(row.photo_urls)),
          )))
          setFabricEvidenceMedia(Array.from(new Set(
            asStringList(latestFabricEvidence?.photo_urls),
          )))
          setGroupMembers(groupMemberRows)
          setMaterialAdvances(
            ((materialAdvanceRows ?? []) as Array<{
              id: string
              title: string | null
              description: string | null
              amount: number | null
              currency: string | null
              status: string | null
              release_status: string | null
              estimate_storage_bucket: string | null
              estimate_storage_path: string | null
              receipt_url: string | null
              receipt_storage_bucket: string | null
              receipt_storage_path: string | null
              acquired_storage_bucket: string | null
              acquired_storage_path: string | null
              reconciliation_status: string | null
              reconciliation_outcome: string | null
              reconciliation_resolution: string | null
              customer_refund_amount: number | null
              unapproved_overage_amount: number | null
              receipt_note: string | null
              customer_response_note: string | null
              customer_response_reason: string | null
              created_at: string | null
              funding_source: string | null
              provider_release_status: string | null
            }>).map((advance) => ({
              id: advance.id,
              title: displayText(advance.title, 'Material advance'),
              description: displayText(advance.description),
              amount: advance.amount ?? 0,
              currency: (advance.currency ?? d.currency ?? d.quoted_currency ?? 'USD') as CurrencyCode,
              status: (advance.status ?? 'REQUESTED') as MaterialAdvanceStatus,
              releaseStatus: advance.release_status ?? null,
              estimateStorageBucket: advance.estimate_storage_bucket ?? null,
              estimateStoragePath: advance.estimate_storage_path ?? null,
              receiptUrl: advance.receipt_url ?? null,
              receiptStorageBucket: advance.receipt_storage_bucket ?? null,
              receiptStoragePath: advance.receipt_storage_path ?? null,
              acquiredStorageBucket: advance.acquired_storage_bucket ?? null,
              acquiredStoragePath: advance.acquired_storage_path ?? null,
              reconciliationStatus: advance.reconciliation_status ?? null,
              reconciliationOutcome: advance.reconciliation_outcome ?? null,
              reconciliationResolution: advance.reconciliation_resolution ?? null,
              customerRefundAmount: advance.customer_refund_amount ?? 0,
              unapprovedOverageAmount: advance.unapproved_overage_amount ?? 0,
              receiptNote: displayNullableText(advance.receipt_note),
              customerResponseNote: displayNullableText(advance.customer_response_note),
              customerResponseReason: advance.customer_response_reason ?? null,
              createdAt: advance.created_at ?? new Date().toISOString(),
              fundingSource: advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' ? 'FUNDED_FABRIC_ALLOWANCE' : 'LEGACY_SEPARATE_PAYMENT',
              providerReleaseStatus: advance.provider_release_status ?? null,
            }))
          )
          const tailorProfile = firstJoinedRow(d.tailor_profiles)
          const customDetail = firstJoinedRow(d.custom_order_details)
          const resolvedStageUpdates = await Promise.all((d.order_stage_updates ?? []).map(async (u) => ({
            id: u.id,
            stage: u.stage,
            note: displayNullableText(u.note),
            photoUrl: await resolvedStageUpdateMedia(u),
            createdAt: u.created_at,
          })))
          setOrder({
            id: d.id,
            reference: d.reference ?? d.id,
            orderKind: d.order_kind ?? 'CUSTOM',
            sellerItemId: d.seller_item_id ?? null,
            fulfillmentOption: d.fulfillment_option ?? null,
            garmentType: displayText(d.garment_type, 'Order'),
            garmentDescription: displayNullableText(d.garment_description),
            occasion: displayNullableText(d.occasion),
            deadline: d.deadline ?? null,
            itemTitle: displayNullableText(d.item_title),
            itemSize: d.item_size ?? null,
            itemQuantity: d.item_quantity ?? 1,
            itemSubtotal: d.item_subtotal ?? null,
            fulfillmentFee: d.fulfillment_fee ?? 0,
            subtotalAmount: d.subtotal_amount ?? d.item_subtotal ?? 0,
            platformFeeAmount: d.platform_fee_amount ?? 0,
            taxAmount: d.tax_amount ?? 0,
            importTaxAmount: d.import_tax_amount ?? 0,
            dutyAmount: d.duty_amount ?? 0,
            taxRateBps: d.tax_rate_bps ?? 0,
            taxRegion: d.tax_region ?? null,
            taxFallback: d.tax_fallback ?? false,
            taxFallbackReason: d.tax_fallback_reason ?? null,
            shippingAmount: d.shipping_amount ?? d.fulfillment_fee ?? 0,
            totalAmount: d.total_amount ?? d.quoted_amount ?? 0,
            sourceCurrency: (d.source_currency ?? null) as CurrencyCode | null,
            sourceAmount: d.source_amount ?? null,
            stage: d.stage,
            tailorId: d.tailor_id,
            tailorName: displayText(tailorProfile?.display_name, ''),
            tailorLocation: displayNullableText(tailorProfile?.location),
            pickupAddress: displayNullableText(pickupAddress),
            pickupInstructions: displayNullableText(pickupInstructions),
            quotedAmount: d.quoted_amount,
            quotedCurrency: (d.currency ?? d.quoted_currency ?? 'USD') as CurrencyCode,
            consultationFee: d.consultation_fee ?? null,
            quotedCompletionDate: d.quoted_completion_date,
            quoteExpiresAt: d.quote_expires_at ?? null,
            activeQuoteId: d.active_quote_id ?? null,
            activeQuoteVersion: d.active_quote_version ?? null,
            negotiationRoundLimit: d.negotiation_round_limit ?? 3,
            negotiationRoundsUsed: d.negotiation_rounds_used ?? 0,
            fulfillmentPaymentRequestedAt: d.fulfillment_payment_requested_at ?? null,
            fulfillmentPaymentPaidAt: d.fulfillment_payment_paid_at ?? null,
            fulfillmentPaymentProvider: d.fulfillment_payment_provider ?? null,
            fulfillmentPaymentIntentId: d.fulfillment_payment_intent_id ?? null,
            fulfillmentPaymentCheckoutUrl: d.fulfillment_payment_checkout_url ?? null,
            fabricSource: d.fabric_source ?? '',
            fabricFundingPolicyVersion: d.fabric_funding_policy_version ?? null,
            deliveryMethod: d.delivery_method ?? '',
            deliveryAddress: displayNullableText(d.delivery_address),
            recipientName: displayNullableText(d.recipient_name),
            recipientPhone: d.recipient_phone ?? null,
            fabricTracking: d.fabric_tracking,
            trackingNumber: d.tracking_number ?? null,
            carrier: d.carrier ?? null,
            fulfillmentProvider: displayNullableText(d.fulfillment_provider),
            fulfillmentReference: displayNullableText(d.fulfillment_reference),
            fulfillmentContactName: displayNullableText(d.fulfillment_contact_name),
            fulfillmentContactPhone: d.fulfillment_contact_phone ?? null,
            referencePhotos: asStringList(d.reference_photos),
            collectionCode: d.collection_code,
            videoCallUrl: d.video_call_url ?? null,
            handoffCompletedAt: d.handoff_completed_at ?? null,
            customerHandoffConfirmedAt: d.customer_handoff_confirmed_at ?? null,
            measurementSnapshot: enrichMeasurementSnapshot(
              d.customer_measurements_snapshot ?? null
            ) as MeasurementSnapshot | null,
            supportMeta,
            customDetail: customDetail
              ? {
                  garmentTypeOther: displayNullableText(customDetail.garment_type_other),
                  genderPresentation: displayNullableText(customDetail.gender_presentation),
                  socialReferenceLinks: asStringList(customDetail.social_reference_links),
                  styleNotes: displayNullableText(customDetail.style_notes),
                  bodyNote: displayNullableText(customDetail.body_note),
                  fabricApprovalRequired: customDetail.fabric_approval_required === true,
                  fabricApprovalStatus: customDetail.fabric_approval_status ?? null,
                  fabricDescription: displayNullableText(customDetail.fabric_description),
                  fabricBudgetAmount: customDetail.fabric_budget_amount ?? null,
                  fabricBudgetCurrency: customDetail.fabric_budget_currency ?? null,
                  fabricSourcingDeadlineDays: customDetail.fabric_sourcing_deadline_days ?? null,
                  fabricSourcingDeadlineAt: customDetail.fabric_sourcing_deadline_at ?? null,
                  shippingPreference: displayNullableText(customDetail.shipping_preference),
                  deliveryInstructions: displayNullableText(customDetail.delivery_instructions),
                  targetDeliveryDate: customDetail.target_delivery_date ?? null,
                }
              : null,
            stageUpdates: resolvedStageUpdates,
            createdAt: d.created_at,
          })
          loadedOrderIdRef.current = d.id
        } else {
          if (shouldReplaceSurface) {
            setHandoffIssue(null)
            setGroupMembers([])
            setOrder(null)
          }
        }
        if (shouldReplaceSurface) setLoading(false)
      } catch (error) {
        if (silent) {
          if (!(error instanceof Error && error.name === 'OrderFetchError')) {
            Sentry.captureException(error, {
              extra: { context: 'customer_order_realtime_refresh', orderId: id },
            })
          }
          return
        }
        if (!shouldReplaceSurface && loadedOrderIdRef.current === id) {
          if (!(error instanceof Error && error.name === 'OrderFetchError')) {
            Sentry.captureException(error, {
              extra: { context: 'customer_order_background_refresh', orderId: id },
            })
          }
          return
        }
        setFetchErrorMessage(
          isLikelyConnectivityIssue(error)
            ? 'Connection is weak. We could not load this order yet. Retry when the signal improves, or reopen it from Orders later.'
            : 'We could not load this order right now. Retry, or reopen it from your Orders list.'
        )
        setHandoffIssue(null)
        setGroupMembers([])
        setMaterialAdvances([])
        setOrder(null)
        setLoading(false)
      }
    },
    [id, setFabricTracking, setOrder, userId]
  )
  const fetchOrderRef = useRef(fetchOrder)

  useEffect(() => {
    fetchOrderRef.current = fetchOrder
  }, [fetchOrder])

  useEffect(() => {
    completionPromptShownRef.current = false
    setReviewCheckComplete(false)
    setShowCompletionPrompt(false)
    setDispatchModalOpen(false)
    setDispatchHandoffComplete(false)
  }, [id])

  useEffect(() => {
    if (
      !order ||
      !reviewCheckComplete ||
      hasReview ||
      (!isHandoffCompleteStage(order.stage) && !dispatchHandoffComplete) ||
      dispatchModalOpen ||
      completionPromptShownRef.current
    ) return

    const timer = setTimeout(() => {
      completionPromptShownRef.current = true
      setShowCompletionPrompt(true)
    }, 450)
    return () => clearTimeout(timer)
  }, [dispatchHandoffComplete, dispatchModalOpen, hasReview, order, reviewCheckComplete])

  async function shareGroupInvite(member: GroupMember) {
    const { error } = await invokeFunction('group-member-action', {
      body: { action: 'mark-invited', memberId: member.id },
    })
    if (error) {
      Alert.alert(
        'Invite not ready',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not prepare this invite yet.'
          : await readFunctionErrorMessage(error, 'We could not prepare this invite right now.'),
      )
      return
    }
    setGroupMembers((prev) =>
      prev.map((item) => (item.id === member.id && item.status !== 'ACCEPTED' ? { ...item, status: 'INVITED' } : item))
    )
    await shareGroupOrderInvite(member.inviteCode, member.displayName, order?.reference ?? '')
  }

  async function handleRefresh() {
    setRefreshing(true)
    await fetchOrder()
    setRefreshing(false)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchOrder()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchOrder])

  useEffect(() => {
    if (!order || !isTerminalOrderStage(order.stage)) return
    const purgeKey = `${order.id}:${order.stage}`
    if (purgedTerminalOrderRef.current === purgeKey) return
    purgedTerminalOrderRef.current = purgeKey
    void purgeTerminalOrderClientState({
      orderId: order.id,
      customerId: userId ?? null,
      sellerItemId: order.sellerItemId,
    })
  }, [order, userId])

  useFocusEffect(
    useCallback(() => {
      void fetchOrderRef.current()
    }, [])
  )

  useEffect(() => {
    if (!id || !user?.id) return
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const pollTimer = setInterval(() => {
      scheduleSilentRefresh()
    }, ORDER_DETAIL_POLL_INTERVAL_MS)

    const scheduleSilentRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void fetchOrder({ silent: true })
      }, 250)
    }

    const channel = supabase
      .channel(`customer-order-detail:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'custom_order_details', filter: `order_id=eq.${id}` },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_stage_updates',
          filter: `order_id=eq.${id}`,
        },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'order_stage_updates',
          filter: `order_id=eq.${id}`,
        },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_quotes', filter: `order_id=eq.${id}` },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_revision_requests', filter: `order_id=eq.${id}` },
        scheduleSilentRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      clearInterval(pollTimer)
      void supabase.removeChannel(channel)
    }
  }, [fetchOrder, id, user?.id])

  async function markHandoffIssueResolved() {
    if (!handoffIssue || resolvingHandoffIssue) return
    setResolvingHandoffIssue(true)
    const result = await resolveHandoffIssue(
      handoffIssue.id,
      'Resolved from customer order screen.'
    )
    setResolvingHandoffIssue(false)
    if (result.error) {
      Alert.alert('Could not close help thread', result.error)
      return
    }
    await fetchOrder()
  }

  async function uploadReceiptProof(source: 'camera' | 'library') {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Take quick delivery proof before confirming receipt.')
        return null
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('Media access needed', 'Choose delivery proof before confirming receipt.')
        return null
      }
    }

    const result = await launchImagePickerSafely(
      () =>
        source === 'camera'
          ? ImagePicker.launchCameraAsync({
              mediaTypes: ['images', 'videos'],
              quality: 0.85,
              videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
            })
          : ImagePicker.launchImageLibraryAsync(
              preferCompatibleVideoRepresentation({
                mediaTypes: ['images', 'videos'],
                quality: 0.85,
                videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
              })
            ),
      {
        context: 'customer_order_receipt_proof_picker',
        mediaLabel: 'delivery proof media file',
        extra: { source, orderId: order?.id, userId: user?.id },
      }
    )
    if (!result) return null

    if (result.canceled || !result.assets?.[0]) return null
    const asset = result.assets[0]
    const validationError = validateOrderEvidenceAsset(asset)
    if (validationError) {
      Alert.alert('Video not added', validationError)
      return null
    }
    const contentType = orderEvidenceContentType(asset)
    const extension = orderEvidenceExtension(contentType)
    return uploadPublicStorageImage({
      bucket: 'order-photos',
      path: `receipts/${id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`,
      uri: asset.uri,
      contentType,
      maxBytes: (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)
        ? ORDER_EVIDENCE_VIDEO_MAX_BYTES
        : MEDIA_LIMITS_BYTES.image,
      allowedContentTypes: ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
      purpose: 'ORDER_REFERENCE',
    })
  }

  async function confirmReceiptWithProof(source: 'camera' | 'library') {
    if (confirming) return
    setConfirming(true)
    try {
      const receiptPhotoUrl = await uploadReceiptProof(source)
      if (!receiptPhotoUrl) {
        setConfirming(false)
        return
      }
      const { error } = await invokeFunction('customer-order-action', {
        body: { orderId: id, action: 'confirm-receipt', receiptPhotoUrl },
      })
      setConfirming(false)
      if (error) {
        Sentry.captureException(error, { extra: { context: 'confirm_receipt', orderId: id } })
        const message = isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not confirm receipt yet. Retry when the signal improves.'
          : await readFunctionErrorMessage(
              error,
              'Could not confirm receipt. Please try again.'
            )
        Alert.alert('Could not confirm receipt', message)
      } else {
        const reviewReturnTarget = `/(customer)/orders/${id}`
        router.replace({
          pathname: '/(customer)/review/[orderId]',
          params: {
            orderId: id,
            returnTo: reviewReturnTarget,
            historyChain: appendToHistory(historyChain, reviewReturnTarget),
          },
        })
      }
    } catch (error) {
      setConfirming(false)
      Sentry.captureException(error, { extra: { context: 'confirm_receipt_upload', orderId: id } })
      Alert.alert(
        'Proof media not saved',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your receipt was not confirmed yet.'
          : 'We could not upload the delivery proof. Please try again.',
      )
    }
  }

  async function confirmReceipt() {
    if (confirming) return
    Alert.alert(
      'Confirm with proof',
      'Add a quick photo of the item in hand before closing delivery. If a neighbour, receptionist, or courier says it was delivered but you have not seen it, raise a concern first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose photo',
          style: 'default',
          onPress: () => void confirmReceiptWithProof('library'),
        },
        {
          text: 'Take photo',
          style: 'default',
          onPress: () => void confirmReceiptWithProof('camera'),
        },
      ]
    )
  }

  async function saveFabricTracking() {
    if (savingFabric) return
    if (!fabricTracking.trim()) return
    if (filterContactInfo(fabricTracking).blocked) {
      Alert.alert(
        'Tracking number blocked',
        "Use the carrier tracking number only. Contact details can't be included here."
      )
      return
    }
    setSavingFabric(true)
    const { error, data } = await invokeFunction<{ ok: boolean; fabricTracking?: string }>(
      'customer-order-action',
      {
        body: {
          orderId: id,
          action: 'save-fabric-tracking',
          fabricTracking: fabricTracking.trim(),
        },
      }
    )
    setSavingFabric(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'save_fabric_tracking', orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save this tracking detail yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save tracking number. Please try again.')
      Alert.alert('Could not save tracking number', message)
    } else {
      const nextValue = data?.fabricTracking ?? fabricTracking.trim()
      setFabricTracking(nextValue)
      setOrder((prev) => (prev ? { ...prev, fabricTracking: nextValue } : prev))
    }
  }

  async function decideSourcedFabric(
    action: 'approve-sourced-fabric' | 'request-sourced-fabric-change'
  ) {
    if (approvingFabric) return
    if (action === 'request-sourced-fabric-change' && fabricChangeNote.trim().length < 5) {
      Alert.alert(
        'Add a note',
        'Tell the tailor what should change before requesting another fabric option.'
      )
      return
    }

    setApprovingFabric(true)
    const { error, data } = await invokeFunction<{ ok: boolean; fabricApprovalStatus?: string }>(
      'customer-order-action',
      {
        body: {
          orderId: id,
          action,
          note: action === 'request-sourced-fabric-change' ? fabricChangeNote.trim() : undefined,
        },
      }
    )
    setApprovingFabric(false)

    if (error) {
      Sentry.captureException(error, { extra: { context: action, orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your fabric decision yet.'
        : await readFunctionErrorMessage(
            error,
            'Could not save your fabric decision. Please try again.'
          )
      Alert.alert('Fabric decision not saved', message)
      return
    }

    const nextStatus =
      data?.fabricApprovalStatus ??
      (action === 'approve-sourced-fabric' ? 'APPROVED' : 'CHANGES_REQUESTED')
    setFabricChangeNote('')
    setOrder((prev) =>
      prev
        ? {
            ...prev,
            customDetail: prev.customDetail
              ? { ...prev.customDetail, fabricApprovalStatus: nextStatus }
              : prev.customDetail,
          }
        : prev
    )
    Alert.alert(
      action === 'approve-sourced-fabric' ? 'Fabric approved' : 'Change request sent',
      action === 'approve-sourced-fabric'
        ? 'Your tailor can continue once the pre-cutting checks are ready.'
        : 'Your tailor will upload another fabric option for approval.'
    )
  }

  async function decideStyleAlignment(
    action: 'approve-style-alignment' | 'request-style-alignment-change'
  ) {
    if (approvingStyle) return
    if (action === 'request-style-alignment-change' && styleChangeNote.trim().length < 5) {
      Alert.alert('Add a note', 'Tell the tailor what should change before cutting.')
      return
    }

    setApprovingStyle(true)
    const { error, data } = await invokeFunction<{ ok: boolean; styleAlignmentStatus?: string }>(
      'customer-order-action',
      {
        body: {
          orderId: id,
          action,
          note: action === 'request-style-alignment-change' ? styleChangeNote.trim() : undefined,
        },
      }
    )
    setApprovingStyle(false)

    if (error) {
      Sentry.captureException(error, { extra: { context: action, orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your style decision yet.'
        : await readFunctionErrorMessage(error, 'Could not save your style decision. Please try again.')
      Alert.alert('Style decision not saved', message)
      return
    }

    const nextStatus =
      data?.styleAlignmentStatus ??
      (action === 'approve-style-alignment' ? 'APPROVED' : 'CHANGES_REQUESTED')
    setStyleChangeNote('')
    setShowStyleCorrection(false)
    setOrder((prev) =>
      prev
        ? {
            ...prev,
            supportMeta: {
              ...prev.supportMeta,
              styleAlignment: {
                ...(prev.supportMeta.styleAlignment ?? {}),
                status: nextStatus as NonNullable<OrderSupportMeta['styleAlignment']>['status'],
              },
            },
          }
        : prev
    )
    Alert.alert(
      action === 'approve-style-alignment' ? 'Style approved' : 'Clarification sent',
      action === 'approve-style-alignment'
        ? 'Your tailor can keep moving once the rest of the pre-cutting checks are ready.'
        : 'Your tailor will clarify the style interpretation before cutting.'
    )
  }

  async function continuePayment() {
    if (!order || paying) return
    const payingFulfillmentNow = hasPendingFulfillmentPayment(order)
    const payingConsultationNow = consultationPaymentRequired

    setPaying(true)
    try {
      const result = await startOrderPayment({
        orderId: order.id,
        customerEmail: user?.email,
        quoteId: order.activeQuoteId,
        expectedQuoteVersion: order.activeQuoteVersion,
      })

      await fetchOrder()

      if (result.ok) {
        Alert.alert(
          payingConsultationNow
            ? 'Consultation fee confirmed'
            : payingFulfillmentNow
              ? 'Extra dispatch payment confirmed'
              : order.orderKind === 'READY_MADE'
                ? 'Order placed'
                : 'Payment confirmed',
          payingConsultationNow
            ? 'Your consultation fee is confirmed. Your tailor can now start the consultation when ready.'
            : payingFulfillmentNow
              ? order.deliveryMethod === 'LOCAL_DELIVERY'
                ? 'The extra delivery payment is confirmed. Drapeon can now finish arranging this handoff.'
                : 'The extra shipping payment is confirmed. Drapeon can now finish arranging this shipment.'
              : order.orderKind === 'READY_MADE'
                ? 'Payment is confirmed and your seller can now prepare this order.'
                : 'Payment is confirmed and your order is now ready for production.'
        )
        return
      }

      if (!result.ok) {
        if (result.reason === 'cancelled') {
          Alert.alert(
            'Payment not finished',
            payingConsultationNow
              ? 'Your consultation fee is still open. You can finish it from this order any time.'
              : payingFulfillmentNow
                ? `Your extra ${order.deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} payment is still open. You can finish it from this order any time.`
                : order.orderKind === 'READY_MADE'
                  ? 'Your checkout is saved. Finish payment within 2 hours to keep this item and any applied discount.'
                  : 'Your quote is saved. Finish payment within 2 hours to keep its current pricing.'
          )
          return
        }

        if (result.stage === 'PAYMENT_FAILED') {
          Alert.alert(
            order.orderKind === 'READY_MADE' ? 'Checkout failed' : 'Payment failed',
            `${result.message}\n\nRetry within 2 hours or this order will cancel automatically.`
          )
          return
        }

        Alert.alert('Payment unavailable', result.message)
      }
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'continue_order_payment', orderId: order.id },
      })
      Alert.alert(
        'Payment unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your card has not been charged. Retry payment when the signal improves.'
          : 'Something went wrong before payment could finish. Your card has not been charged. Please try again.'
      )
    } finally {
      setPaying(false)
    }
  }

  async function respondToMaterialAdvance(
    advance: MaterialAdvance,
    decision: 'APPROVE' | 'DECLINE',
    declineReason?: MaterialAdvanceDeclineReason,
    note?: string,
  ) {
    if (respondingAdvanceId) return
    setRespondingAdvanceId(advance.id)
    try {
      const { error, data } = await invokeFunction<{
        ok: boolean
        notificationJobs?: { pushQueued?: boolean; emailQueued?: boolean }
      }>('material-advance-action', {
        body: {
          action: 'respond-advance',
          advanceId: advance.id,
          decision,
          declineReason: decision === 'DECLINE' ? declineReason : undefined,
          note: note?.trim() || undefined,
        },
      })

      if (error) {
        Alert.alert(
          'Could not update request',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. Try again when the signal improves.'
            : await readFunctionErrorMessage(error, 'Could not update this material advance right now.'),
        )
        return
      }

      await fetchOrder()
      if (decision === 'DECLINE') {
        setDecliningAdvance(null)
        setMaterialAdvanceDeclineReason('FIND_CHEAPER_OPTION')
        setMaterialAdvanceDeclineNote('')
      }
      const reasonLabel = decision === 'DECLINE'
        ? materialAdvanceDeclineReasonLabel(declineReason)
        : null
      const counterpartQueued = data?.notificationJobs?.pushQueued === true || data?.notificationJobs?.emailQueued === true
      setMaterialAdvanceConfirmation({
        decision,
        title: decision === 'APPROVE'
          ? advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE' ? 'Fabric release approved' : 'Material request approved'
          : 'Material request declined',
        detail: decision === 'APPROVE'
          ? advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE'
            ? `${advance.title} is approved against the fabric allowance you already funded. You were not charged again; Drapeon Money Desk must review the exact release next.`
            : `${advance.title} is approved. Payment remains separate from the main order funds and still requires Drapeon release review.`
          : `${advance.title} stays unpaid${reasonLabel ? ` · ${reasonLabel}` : ''}. ${counterpartQueued ? 'The tailor notification is queued.' : 'The decision is saved in the order record.'}`,
      })
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'respond_material_advance', advanceId: advance.id, decision },
      })
      Alert.alert('Could not update request', 'Something went wrong. Try again in a moment.')
    } finally {
      setRespondingAdvanceId(null)
    }
  }

  async function openMaterialAdvanceEvidence(advance: MaterialAdvance, kind: 'estimate' | 'receipt' | 'acquired') {
    const bucket = kind === 'estimate' ? advance.estimateStorageBucket : kind === 'receipt' ? advance.receiptStorageBucket : advance.acquiredStorageBucket
    const path = kind === 'estimate' ? advance.estimateStoragePath : kind === 'receipt' ? advance.receiptStoragePath : advance.acquiredStoragePath
    if (!bucket || !path) {
      Alert.alert('Proof unavailable', 'This protected proof is not available yet.')
      return
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 10 * 60)
    if (error || !data?.signedUrl) {
      Alert.alert('Proof unavailable', 'Drapeon could not open this protected proof. Try again.')
      return
    }
    setMediaPreview({
      items: [{
        uri: data.signedUrl,
        label: kind === 'estimate' ? 'Supplier proof' : kind === 'receipt' ? 'Final receipt' : 'Acquired fabric',
        kind: isVideoUri(path) ? 'video' : 'photo',
      }],
      index: 0,
    })
  }

  function openMaterialAdvanceDecline(advance: MaterialAdvance) {
    setDecliningAdvance(advance)
    setMaterialAdvanceDeclineReason('FIND_CHEAPER_OPTION')
    setMaterialAdvanceDeclineNote('')
  }

  function submitMaterialAdvanceDecline() {
    if (!decliningAdvance) return
    if (materialAdvanceDeclineReason === 'OTHER' && materialAdvanceDeclineNote.trim().length < 5) {
      Alert.alert('Add a short explanation', 'Tell the tailor why you are declining this material request.')
      return
    }
    void respondToMaterialAdvance(
      decliningAdvance,
      'DECLINE',
      materialAdvanceDeclineReason,
      materialAdvanceDeclineNote,
    )
  }

  async function payMaterialAdvance(advance: MaterialAdvance) {
    if (!order || payingAdvanceId) return
    setPayingAdvanceId(advance.id)
    try {
      const result = await startMaterialAdvancePayment({
        orderId: order.id,
        advanceId: advance.id,
        customerEmail: user?.email,
      })
      await fetchOrder()

      if (result.ok) {
        Alert.alert(
          'Material advance paid',
          'Drapeon will review and release only this approved material amount. The main order escrow stays protected until delivery.'
        )
        return
      }

      Alert.alert(
        result.reason === 'cancelled' ? 'Payment not finished' : 'Payment unavailable',
        result.reason === 'cancelled'
          ? 'This material advance is still saved. You can finish payment from this order.'
          : result.message
      )
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'pay_material_advance', advanceId: advance.id, orderId: order.id },
      })
      Alert.alert(
        'Payment unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your payment has not been completed. Retry when the signal improves.'
          : 'Something went wrong before payment could finish. Please try again.'
      )
    } finally {
      setPayingAdvanceId(null)
    }
  }

  async function confirmMeasurements() {
    if (!order || confirmingMeasurements) return

    Alert.alert(
      'Confirm measurements',
      'Only confirm if these measurements are still correct. Cutting will stay paused until you do.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            if (confirmingMeasurements) return
            setConfirmingMeasurements(true)
            const { error } = await invokeFunction('customer-order-action', {
              body: { orderId: order.id, action: 'confirm-measurements' },
            })
            setConfirmingMeasurements(false)
            if (error) {
              Sentry.captureException(error, {
                extra: { context: 'confirm_measurements', orderId: order.id },
              })
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not confirm your measurements yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(
                    error,
                    'Could not confirm your measurements right now. Please try again.'
                  )
              Alert.alert('Update unavailable', message)
              return
            }
            await fetchOrder()
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <ActivityIndicator color={Colors.needleGreenDark} size="large" />
            <Text style={styles.stateTitle}>Loading your order...</Text>
            <Text style={styles.stateHint}>Pulling the latest order updates.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchErrorMessage) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <Text style={styles.stateTitle}>Couldn't load this order.</Text>
            <Text style={styles.stateHint}>{fetchErrorMessage}</Text>
            <TouchableOpacity
              onPress={() => {
                void fetchOrder()
              }}
              style={styles.retryBtn}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace({ pathname: '/(customer)/orders', params: { tab } })}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(customer)/messages')}>
              <Text style={styles.backLink}>Open messages</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(customer)')}>
              <Text style={styles.backLink}>Explore tailors</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <Text style={styles.stateTitle}>Order not found.</Text>
            <Text style={styles.stateHint}>Open your orders list and try again.</Text>
            <TouchableOpacity
              onPress={() => router.replace({ pathname: '/(customer)/orders', params: { tab } })}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const progressStage =
    order.stage === 'IN_DISPUTE'
      ? (([...order.stageUpdates].reverse().find((u) => u.stage !== 'IN_DISPUTE')?.stage as
          | OrderStage
          | undefined) ?? 'CONFIRMED')
      : order.stage
  const progressStages = progressStagesForOrder(order.orderKind)
  const currentStageIdx = stageIndex(progressStage, order.orderKind)
  const fabricApprovalHistoryMediaSet = new Set(fabricApprovalHistoryMedia)
  const fabricApprovalUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => !!update.photoUrl && fabricApprovalHistoryMediaSet.has(update.photoUrl))
      .map((update) => update.id),
  )
  const fabricDecisionUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => sourcedFabricDecisionFromNote(update.note) !== null)
      .map((update) => update.id),
  )
  const styleAlignmentWorkflowUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => styleAlignmentEventFromNote(update.note) !== null)
      .map((update) => update.id),
  )
  const latestUpdate = [...order.stageUpdates]
    .reverse()
    .find((update) =>
      !fabricApprovalUpdateIds.has(update.id) &&
      !fabricDecisionUpdateIds.has(update.id) &&
      !styleAlignmentWorkflowUpdateIds.has(update.id),
    )
  const latestHistoryUpdate = [...order.stageUpdates].reverse()[0]
  const historyUpdateLabelRaw = (update: StageUpdate) => fabricApprovalUpdateIds.has(update.id)
    ? 'Fabric submitted for approval'
    : sourcedFabricDecisionFromNote(update.note) === 'APPROVED'
      ? 'Fabric approved'
      : sourcedFabricDecisionFromNote(update.note) === 'CHANGES_REQUESTED'
        ? 'Fabric changes requested'
        : styleAlignmentEventFromNote(update.note) === 'REQUESTED'
      ? 'Style plan sent for approval'
      : styleAlignmentDecisionFromNote(update.note) === 'APPROVED'
      ? 'Style plan approved'
      : styleAlignmentDecisionFromNote(update.note) === 'CHANGES_REQUESTED'
        ? 'Style clarification requested'
        : timelineStageLabel(update, order.orderKind)
  const historyUpdateLabel = (update: StageUpdate, isLatest = false) =>
    deriveFulfillmentAwareHistoryLabel({
      eventStage: update.stage,
      effectiveMethod: dispatchFulfillmentState?.effectiveMethod ?? order.deliveryMethod,
      defaultLabel: historyUpdateLabelRaw(update),
      isLatest,
    })
  const timelineMediaUrls = Array.from(new Set([
    ...productionEvidenceMedia,
    ...order.stageUpdates.map((update) => update.photoUrl).filter((url): url is string => !!url),
  ]))
  const timelineMediaItems = timelineMediaUrls.map((uri, index) => ({
    uri,
    label: `Order evidence ${index + 1}`,
    kind: isVideoUri(uri) ? ('video' as const) : ('photo' as const),
    bucket: isVideoUri(uri) ? undefined : ('order-photos' as const),
  }))
  const timelineMosaicItems: DrapeMediaMosaicItem[] = timelineMediaItems.map((item, index) => ({
    id: `${index}:${item.uri}`,
    uri: item.uri,
    kind: item.kind,
    label: item.label,
    bucket: item.bucket,
  }))
  const justPlacedReadyMade = placed === '1' && order.orderKind === 'READY_MADE'
  const effectiveDeliveryMethod =
    dispatchFulfillmentState?.effectiveMethod ?? order.deliveryMethod
  const isCollection = effectiveDeliveryMethod === 'LOCAL_COLLECTION'
  const progressIsTerminalComplete = isHandoffCompleteStage(order.stage) || dispatchHandoffComplete
  const conversationCtaLabel = isTerminalOrderStage(order.stage)
    ? 'Open order conversation'
    : `Open order chat · ${order.tailorName.split(' ')[0]}`
  const pickupDetailsUnlocked =
    isCollection &&
    ['READY_FOR_COLLECTION', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE'].includes(order.stage)
  const stageHelp =
    order.stage === 'READY_FOR_COLLECTION' && !isCollection
      ? dispatchFulfillmentState?.replacementPending
        ? 'Pickup has been replaced. Drapeon is confirming the delivery or shipping cost before the provider is booked.'
        : 'Pickup has been replaced. Follow the Drapeon Dispatch status for the active handoff.'
      : stageGuidance(order.stage, effectiveDeliveryMethod, order.orderKind)
  const stageStatusLabel =
    order.stage === 'READY_FOR_COLLECTION' && !isCollection
      ? dispatchFulfillmentState?.replacementPending
        ? 'Delivery requested'
        : 'Drapeon Dispatch'
      : customerOrderStageLabel(order.stage, order.orderKind)
  const measurementSource = order.measurementSnapshot?.measurementSource
  const fitConfidence = order.measurementSnapshot?.fitConfidence
  const measurementConfirmationNeeded = order.measurementSnapshot?.needsConfirmation === true
  const wearerLabel = wearerLabelFromOrder(order.supportMeta, order.measurementSnapshot)
  const measurementAge = resolveMeasurementAgeMeta(order.supportMeta, order.measurementSnapshot)
  const measurementAgeText = measurementAgeLabel(measurementAge)
  const measurementConfirmationFields = getMeasurementConfirmationFields(order.measurementSnapshot)
  const styleAlignment = order.supportMeta.styleAlignment
  const styleChangeFeedback = styleAlignmentChangeFeedbackFromUpdates(order.stageUpdates)
  const fitProfile = order.supportMeta.fitProfile ?? null
  const consultationMeta = order.supportMeta.consultation ?? null
  const consultationCallLifecycle = getCallLifecycleState(
    consultationMeta?.scheduledStartAt,
    consultationClockMs,
  )
  const consultationCallAvailable =
    consultationMeta?.status === 'SCHEDULED' && consultationCallLifecycle.status === 'active'
  const consultationCallExpired =
    consultationMeta?.status === 'EXPIRED' || consultationCallLifecycle.status === 'expired'
  const consultationQuotePreparationReady =
    order.stage === 'CONSULTATION' && consultationCallExpired
  const quoteBreakdown = order.supportMeta.quoteBreakdown ?? null
  const fabricPolicy = order.supportMeta.fabricPolicy ?? null
  const bulkOrder = order.supportMeta.bulkOrder ?? null
  const dispatchRecord = order.supportMeta.dispatchRecord ?? null
  const fabricHandoffMode = order.supportMeta.fabricHandoffMode ?? null
  const fabricHandoffLabel =
    order.supportMeta.fabricHandoffLabel ??
    (fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null)
  const briefDossier = buildBriefDossier(
    {
      orderKind: order.orderKind,
      garmentType: order.garmentType,
      garmentDescription: order.garmentDescription,
      itemTitle: order.itemTitle,
      itemSize: order.itemSize,
      itemQuantity: order.itemQuantity,
      occasion: order.occasion,
      stage: order.stage,
      quotedAmount: baseAmount(order),
      quotedCurrency: order.quotedCurrency,
      quotedCompletionDate: order.quotedCompletionDate,
      deadline: order.deadline,
      fabricSource: order.fabricSource,
      deliveryMethod: order.deliveryMethod,
      deliveryAddress: order.deliveryAddress,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      fabricTracking: order.fabricTracking,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      fulfillmentProvider: order.fulfillmentProvider,
      fulfillmentReference: order.fulfillmentReference,
      fulfillmentContactName: order.fulfillmentContactName,
      fulfillmentContactPhone: order.fulfillmentContactPhone,
      collectionCode: order.collectionCode,
      referencePhotos: order.referencePhotos,
      proofMediaUrls: order.stageUpdates.map((update) => update.photoUrl).filter((url): url is string => !!url),
      supportMeta: order.supportMeta as unknown as Record<string, unknown>,
      customDetail: order.customDetail,
      measurementSnapshot: order.measurementSnapshot as Record<string, unknown> | null,
      measurementSourceLabel: measurementSource ? MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource) : null,
      fitConfidenceLabel: fitConfidence ? FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence) : null,
      measurementAgeLabel: measurementAgeText,
      wearerLabel,
      bulkMemberCount: groupMembers.length,
    },
    {
      money: (amount, currency) => amount == null ? 'Quote pending' : formatAmount(amount, (currency ?? order.quotedCurrency) as CurrencyCode, (currency ?? order.quotedCurrency) as CurrencyCode, STATIC_FALLBACK_RATES),
    },
  )
  const showFabricTrackingSection =
    order.fabricFundingPolicyVersion !== 'fabric-funding-2026-08-21-v2' &&
    order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    (fabricHandoffMode == null || isShippingFabricHandoff(fabricHandoffMode))
  const materialIssue = order.supportMeta.materialIssue ?? null
  const materialIssueOpen = hasOpenMaterialIssue(order.supportMeta)
  const sourcedFabricUrls = Array.from(new Set([
    ...fabricEvidenceMedia,
  ]))
  const sourcedFabricItems: MediaLightboxItem[] = sourcedFabricUrls.map((uri, index) => ({
    uri,
    label: `Sourced fabric proof ${index + 1}`,
    kind: isVideoUri(uri) ? 'video' : 'photo',
    bucket: isVideoUri(uri) ? undefined : 'order-photos',
  }))
  const sourcedFabricPending =
    order.fabricFundingPolicyVersion !== 'fabric-funding-2026-08-21-v2' &&
    order.fabricSource === 'TAILOR_SOURCES' &&
    order.customDetail?.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL'
  const materialIssueNeedsResponse = materialIssue?.status === 'OPEN'
  const materialIssueCancellationRequested = materialIssue?.status === 'CUSTOMER_REQUESTED_CANCEL'
  const materialIssueReasonLabel =
    materialIssue?.reasonLabel ??
    (materialIssue?.reason ? MATERIAL_ISSUE_REASON_LABELS[materialIssue.reason] : null)
  const materialIssueResponseLabel =
    materialIssue?.responseLabel ??
    (materialIssue?.response ? MATERIAL_ISSUE_RESPONSE_LABELS[materialIssue.response] : null)
  const cancellationReview = order.supportMeta.cancellationReview ?? null
  const cancellationReviewOpen = hasOpenCancellationReview(order.supportMeta)
  const cancellationReasonLabel =
    cancellationReview?.reasonLabel ??
    (cancellationReview?.reason
      ? CANCELLATION_REVIEW_REASON_LABELS[cancellationReview.reason]
      : null)
  const cancellationPolicy = deriveCancellationPolicy({
    orderKind: order.orderKind,
    stage: order.stage,
    deliveryMethod: order.deliveryMethod,
    consultationFee: order.consultationFee,
    consultationPaidAt: consultationMeta?.paidAt ?? null,
    consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
    fulfillmentFee: order.fulfillmentFee,
    fulfillmentPaymentRequestedAt: order.fulfillmentPaymentRequestedAt,
    fulfillmentPaymentPaidAt: order.fulfillmentPaymentPaidAt,
    dispatchBookedAt: dispatchRecord?.bookedAt ?? null,
    premiumDispatch: dispatchRecord?.premiumException ?? null,
  })
  const canRequestCancellationReview =
    !cancellationReviewOpen && cancellationPolicy.customerCanRequestReview
  const canSelfCancelOrder = cancellationPolicy.customerCanSelfCancel
  const showCancellationPolicyCard =
    cancellationReviewOpen ||
    (order.orderKind === 'CUSTOM'
      ? [
          'PENDING_QUOTE',
          'CONSULTATION',
          'PAYMENT_PENDING',
          'PAYMENT_FAILED',
          'CONFIRMED',
          'DESIGNING',
          'SOURCING',
          'CUTTING',
          'SEWING',
          'FINISHING',
        ].includes(order.stage)
      : [
          'PAYMENT_PENDING',
          'PAYMENT_FAILED',
          'CONFIRMED',
          'FINISHING',
          'READY_FOR_DRAPE_DISPATCH',
        ].includes(order.stage))
  const cancellationCardTitle = canSelfCancelOrder
    ? 'Cancellation options'
    : 'Cancellation and refund review'
  const deliveryReview = order.supportMeta.deliveryReview ?? null
  const deliveryReviewOpen = hasOpenDeliveryReview(order.supportMeta)
  const scopeChange = order.supportMeta.scopeChange ?? null
  const scopeChangeOpen = hasOpenScopeChange(order.supportMeta)
  const canRequestScopeChange =
    order.orderKind === 'CUSTOM' &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    SCOPE_CHANGE_STAGES.includes(order.stage)
  const canRespondScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'TAILOR'
  const canCancelScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'CUSTOMER'
  const scopeChangeTypeLabel =
    scopeChange?.typeLabel ??
    (scopeChange?.type ? SCOPE_CHANGE_TYPE_LABELS[scopeChange.type] : null)
  const scopeChangeStatusLabel =
    scopeChange?.status ? formatScopeChangeStatusLabel(scopeChange.status) : null
  const handoffStageActive =
    [
      'READY_FOR_COLLECTION',
      'READY_FOR_DRAPE_DISPATCH',
      'OUT_FOR_DELIVERY',
      'SHIPPED',
      'DELIVERED',
      'COLLECTED',
      'COMPLETE',
    ].includes(order.stage) ||
    !!order.handoffCompletedAt ||
    !!order.customerHandoffConfirmedAt
  const hasShipmentDetails = !!(
    dispatchRecord?.serviceLevel ||
    order.fulfillmentProvider ||
    order.trackingNumber ||
    order.fulfillmentReference ||
    order.fulfillmentContactName ||
    order.fulfillmentContactPhone ||
    order.carrier
  )
  const handoffContextAvailable =
    !cancellationReviewOpen &&
    !materialIssueOpen &&
    (handoffStageActive || deliveryReviewOpen || !!handoffIssue)
  const handoffHelpAvailable = handoffContextAvailable
  const showNonCollectionHandoffPanels =
    order.deliveryMethod !== 'LOCAL_COLLECTION' && handoffContextAvailable
  const showShipmentDetails = showNonCollectionHandoffPanels && hasShipmentDetails
  const compressReadyMadeSupport =
    order.orderKind === 'READY_MADE' &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    !['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE'].includes(
      order.stage
    )
  const deliveryReasonLabel =
    deliveryReview?.reasonLabel ??
    (deliveryReview?.reason ? DELIVERY_REVIEW_REASON_LABELS[deliveryReview.reason] : null)
  const aftercareStatus = getAftercareStatus(order)
  const initialPaymentLikelyPaid = ![
    'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'DECLINED', 'EXPIRED',
  ].includes(order.stage)
  const canRequestDeliveryReview =
    initialPaymentLikelyPaid &&
    !deliveryReviewOpen &&
    order.stage !== 'IN_DISPUTE' &&
    order.stage !== 'COMPLETE'
  const consultationPaymentRequired =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS' &&
    !consultationMeta.paidAt
  const consultationPaymentPaid =
    order.stage === 'CONSULTATION' && !!consultationMeta?.feeAmount && !!consultationMeta.paidAt
  const consultationApproved =
    order.stage === 'CONSULTATION' &&
    consultationMeta?.status !== 'REQUESTED' &&
    consultationMeta?.status !== 'DECLINED'
  const readyMadePurchaseSummary =
    order.orderKind === 'READY_MADE'
      ? `${order.itemQuantity} ${order.itemQuantity === 1 ? 'item' : 'items'} · ${fulfillmentOptionLabel(
          order.fulfillmentOption,
          order.deliveryMethod
        )}`
      : null
  const activeMaterialAdvanceStatuses: MaterialAdvanceStatus[] = [
    'REQUESTED',
    'PAYMENT_PENDING',
    'PAYMENT_FAILED',
    'PAID',
    'OPS_REVIEW',
    'BLOCKED',
  ]
  const activeMaterialAdvances = materialAdvances.filter((advance) =>
    activeMaterialAdvanceStatuses.includes(advance.status) || advance.reconciliationStatus === 'OPS_REVIEW'
  )
  const closedMaterialAdvances = materialAdvances.filter(
    (advance) => !activeMaterialAdvanceStatuses.includes(advance.status) && advance.reconciliationStatus !== 'OPS_REVIEW'
  )
  const focusedMaterialAdvance = advanceId
    ? materialAdvances.find((advance) => advance.id === advanceId) ?? null
    : null
  const focusedMaterialCopy = focusedMaterialAdvance
    ? materialReconciliationCopy({
        outcome: focusedMaterialAdvance.reconciliationOutcome,
        resolution: focusedMaterialAdvance.reconciliationResolution,
        customerRefundAmount: focusedMaterialAdvance.customerRefundAmount,
        unapprovedOverageAmount: focusedMaterialAdvance.unapprovedOverageAmount,
        actorRole: 'CUSTOMER',
      })
    : null

  async function cancelOrderDirectly() {
    if (!order) return
    Alert.alert('Cancel this order?', cancellationPolicy.customerMessage, [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: async () => {
          const { error } = await invokeFunction('customer-order-action', {
            body: { orderId: order.id, action: 'cancel-order' },
          })
          if (error) {
            const message = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not cancel this order yet. Retry when the signal improves.'
              : await readFunctionErrorMessage(
                  error,
                  'Could not cancel this order right now. Please try again.'
                )
            Alert.alert('Cancellation unavailable', message)
            return
          }
          await purgeTerminalOrderClientState({
            orderId: order.id,
            customerId: user?.id ?? null,
            sellerItemId: order.sellerItemId,
          })
          await fetchOrder()
        },
      },
    ])
  }

  function respondToScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    if (!order) return
    const actionLabel =
      decision === 'ACCEPTED' ? 'Accept change' : decision === 'DECLINED' ? 'Decline change' : 'Cancel request'
    const message =
      decision === 'ACCEPTED'
        ? 'This records your approval in Drapeon. If money or deadline changes are involved, Drapeon will still keep those steps formal.'
        : decision === 'DECLINED'
          ? 'This records that you do not approve the proposed change.'
          : 'This closes your change request without changing the order scope.'
    Alert.alert(actionLabel, message, [
      { text: 'Not now', style: 'cancel' },
      {
        text: actionLabel,
        onPress: async () => {
          const { error } = await invokeFunction('customer-order-action', {
            body: {
              orderId: order.id,
              action: 'respond-scope-change',
              scopeChangeDecision: decision,
            },
          })
          if (error) {
            const errorMessage = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not update this change yet.'
              : await readFunctionErrorMessage(error, 'Could not update this change request right now.')
            Alert.alert('Change unavailable', errorMessage)
            return
          }
          void fetchOrder()
        },
      },
    ])
  }

  // ── QUOTE_SENT state — dedicated accept / decline view ──────────────────
  if (order.stage === 'QUOTE_SENT') {
    return (
      <QuoteReviewScreen
        order={order}
        onAction={fetchOrder}
        router={router}
        customerEmail={user?.email ?? ''}
        preferredTab={tab}
        returnTarget={explicitReturnPath}
        historyChain={historyChain}
        initialAction={action}
      />
    )
  }

  // ── PENDING_QUOTE — waiting on tailor ───────────────────────────────────
  if (order.stage === 'PENDING_QUOTE' || consultationQuotePreparationReady) {
    const isReadyMadeInquiry = order.orderKind === 'READY_MADE'
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={goBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.content}>
          {sent === '1' && (
            <View style={styles.sentBanner}>
              <Text style={styles.sentBannerText}>
                ✓ Brief sent to {order.tailorName.split(' ')[0]} · #{order.reference}
              </Text>
            </View>
          )}
          <Text style={styles.heading}>{order.garmentType}</Text>
          <Text style={styles.subheading}>
            {order.tailorName} · #{order.reference}
          </Text>
          <View style={styles.statusCard} testID="order-pending-quote">
            <DrapeStatusChip
              value={consultationQuotePreparationReady ? 'PENDING_QUOTE' : order.stage}
              label={isReadyMadeInquiry ? 'Inquiry Open' : 'Awaiting Quote'}
              domain="order"
            />
            <Text style={styles.statusNote}>
              {isReadyMadeInquiry
                ? `Your chat with ${order.tailorName.split(' ')[0]} is open. Ask about size, fit, colour, pickup, or delivery before you buy.`
                : consultationQuotePreparationReady
                  ? `The consultation finished. ${order.tailorName.split(' ')[0]} can now send your quote while any fee review finishes in the background.`
                  : `Your brief is with ${order.tailorName.split(' ')[0]}. Message them if needed.`}
            </Text>
          </View>
          <View style={styles.nextStepsCard}>
            <Text style={styles.nextStepsTitle}>What happens next</Text>
            {isReadyMadeInquiry ? (
              <>
                <Text style={styles.nextStepsItem}>1. Message the seller about this item</Text>
                <Text style={styles.nextStepsItem}>
                  2. Once you are ready, continue to checkout
                </Text>
                <Text style={styles.nextStepsItem}>
                  3. Your purchase order starts after checkout
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.nextStepsItem}>
                  1. {order.tailorName.split(' ')[0]} reviews your order and sends a quote
                </Text>
                <Text style={styles.nextStepsItem}>
                  2. You review the quote and accept or decline
                </Text>
                <Text style={styles.nextStepsItem}>3. Production starts once you accept</Text>
              </>
            )}
          </View>
          {scopeChangeOpen ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>Change request open</Text>
              {scopeChangeTypeLabel ? (
                <Text style={styles.supportBodyText}>{scopeChangeTypeLabel}</Text>
              ) : null}
              {scopeChange?.summary ? <Text style={styles.supportHint}>{scopeChange.summary}</Text> : null}
              {canCancelScopeChange ? (
                <Button
                  label="Cancel request"
                  variant="ghost"
                  onPress={() => respondToScopeChange('CANCELLED')}
                />
              ) : null}
            </View>
          ) : null}
          <Button
            label={conversationCtaLabel}
            variant="secondary"
            onPress={() =>
              router.navigate({
                pathname: '/(customer)/messages/[orderId]',
                params: {
                  orderId: order.id,
                  returnTo: `/(customer)/orders/${order.id}`,
                  historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                },
              })
            }
          />
          {!isReadyMadeInquiry ? (
            <Button
              label="Request consultation"
              variant="secondary"
              onPress={() => setShowCustomerConsultation(true)}
            />
          ) : null}
          {!isReadyMadeInquiry && canRequestScopeChange ? (
            <Button
              label="Update brief"
              variant="secondary"
              onPress={() => setShowScopeChange(true)}
            />
          ) : null}
          {isReadyMadeInquiry && order.sellerItemId ? (
            <Button
              label="Continue to checkout"
              onPress={() =>
                router.navigate({
                  pathname: '/(customer)/tailor/item/checkout/[itemId]',
                  params: {
                    itemId: order.sellerItemId as string,
                    returnTo: `/(customer)/orders/${order.id}`,
                    historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                  },
                })
              }
            />
          ) : null}
          {order.orderKind === 'CUSTOM' && canSelfCancelOrder ? (
            <Button
              label="Cancel request"
              variant="ghost"
              onPress={() => {
                void cancelOrderDirectly()
              }}
            />
          ) : null}
          {showCustomerConsultation ? (
            <CustomerConsultationRequestModal
              key={`customer-consultation-${order.id}`}
              visible
              orderId={order.id}
              tailorName={order.tailorName}
              tailorUserId={order.tailorId}
              onClose={() => setShowCustomerConsultation(false)}
              onSent={() => {
                setShowCustomerConsultation(false)
                void fetchOrder()
              }}
            />
          ) : null}
          {showScopeChange ? (
            <ScopeChangeModal
              key={`scope-change-${order.id}`}
              visible
              orderId={order.id}
              currency={order.quotedCurrency}
              onClose={() => setShowScopeChange(false)}
              onSubmitted={() => {
                setShowScopeChange(false)
                void fetchOrder()
              }}
            />
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  const sourcedFabricApprovalPanel = sourcedFabricPending ? (
    <View style={[styles.supportCard, styles.supportCardWarning]}>
      <View style={styles.disclosureHeader}>
        <View style={styles.disclosureCopy}>
          <Text style={styles.supportCardTitle}>Review sourced fabric</Text>
          <Text style={styles.supportHint}>Your approval is needed before cutting can begin.</Text>
        </View>
      </View>
      {sourcedFabricItems.length > 0 ? (
        <DrapeMediaMosaic
          items={sourcedFabricItems.map((item, index) => ({
            id: `sourced-fabric:${index}:${item.uri}`,
            uri: item.uri,
            kind: item.kind ?? 'photo',
            label: item.label,
            bucket: item.bucket,
          }))}
          contentFit="contain"
          onPressItem={(_, index) => openMediaPreview(sourcedFabricItems, index)}
          testID="customer-sourced-fabric-proof"
        />
      ) : (
        <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
          <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
            Fabric proof is missing. Ask the tailor to upload it before approving.
          </Text>
        </View>
      )}
      <Text style={styles.supportBodyText}>
        Approve this fabric to let the tailor continue toward cutting, or request a change before
        work becomes irreversible.
      </Text>
      <View style={styles.fabricApprovalActions}>
        <Button
          label="Approve fabric"
          onPress={() => decideSourcedFabric('approve-sourced-fabric')}
          loading={approvingFabric}
          disabled={sourcedFabricItems.length === 0}
        />
        <Input
          label="Change request"
          placeholder="e.g. I need a darker green or less shiny texture."
          value={fabricChangeNote}
          onChangeText={setFabricChangeNote}
          multiline
          numberOfLines={3}
          maxLength={300}
          filterContact
        />
        <Button
          label="Request changes"
          variant="secondary"
          onPress={() => decideSourcedFabric('request-sourced-fabric-change')}
          loading={approvingFabric}
          disabled={fabricChangeNote.trim().length < 5}
        />
      </View>
    </View>
  ) : null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        {...capsuleNavScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 48, 72) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.needleGreen}
          />
        }
      >
        <View style={styles.content}>
          {/* Header */}
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>
              {order.tailorName} · #{order.reference}
            </Text>
            {order.orderKind === 'READY_MADE' ? (
              <View style={styles.orderTypePill}>
                <Text style={styles.orderTypePillText}>Ready-made order</Text>
              </View>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={conversationCtaLabel}
              style={styles.messageAction}
              onPress={() =>
                router.navigate({
                  pathname: '/(customer)/messages/[orderId]',
                  params: {
                    orderId: order.id,
                    returnTo: `/(customer)/orders/${order.id}`,
                    historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                  },
                })
              }
            >
              <Feather name="message-circle" size={17} color={Colors.needleGreenDark} />
              <Text style={styles.messageActionText}>{conversationCtaLabel}</Text>
              <Feather name="chevron-right" size={17} color={Colors.midGrey} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              <CommercialReceiptCard orderId={order.id} actorRole="CUSTOMER" />
              <SettlementProgressCard orderId={order.id} actorRole="CUSTOMER" />
            </View>
            <DrapeonDispatchCard
              orderId={order.id}
              orderStage={order.stage}
              actorRole="CUSTOMER"
              onOpenChange={setDispatchModalOpen}
              onDeliveryStateChange={setDispatchHandoffComplete}
              onFulfillmentStateChange={setDispatchFulfillmentState}
              onOrderStateChange={() => fetchOrder({ silent: true })}
            />
            {progressIsTerminalComplete && reviewCheckComplete && !hasReview && !showCompletionPrompt ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Rate this order and optionally tip the tailor"
                style={styles.completionAction}
                activeOpacity={0.82}
                onPress={() => setShowCompletionPrompt(true)}
              >
                <View style={styles.completionActionIcon}>
                  <Feather name="star" size={16} color={Colors.needleGreenDark} />
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.completionActionTitle}>Rate & thank {order.tailorName.split(' ')[0]}</Text>
                  <Text style={styles.completionActionBody}>Add a review or optional tip</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : null}
          </View>

          <FabricWorkflowCard orderId={order.id} policyVersion={order.fabricFundingPolicyVersion} />

          {/* Collection code is the primary handoff credential, never the order reference. */}
          {order.stage === 'READY_FOR_COLLECTION'
            && order.collectionCode
            && (dispatchFulfillmentState?.pickupCredentialActive ?? order.deliveryMethod === 'LOCAL_COLLECTION') ? (
            <View style={styles.collectionCard} accessibilityRole="summary" accessibilityLabel={`Collection code ${order.collectionCode}`}>
              <Text style={styles.collectionEyebrow}>COLLECTION CODE</Text>
              <Text style={styles.collectionTitle}>Show this code to {order.tailorName}</Text>
              <View style={styles.codeBox}>
                {order.collectionCode.split('').map((digit, i) => (
                  <View key={`${digit}-${i}`} style={styles.codeDigit}>
                    <Text style={styles.codeDigitText}>{digit}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.collectionHint}>
                This is not your order number. Inspect the order first, then share the code so Drapeon can record the pickup handoff.
              </Text>
              <TouchableOpacity onPress={() => setShowDispute(true)} accessibilityRole="button">
                <Text style={styles.disputeLink}>Something wrong? Report issue</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {focusedMaterialAdvance ? (
            <View accessibilityRole="alert" style={[styles.supportCard, focusedMaterialCopy?.tone === 'warning' ? styles.supportCardWarning : undefined]}>
              <Text style={styles.supportCardTitle}>{focusedMaterialCopy?.title ?? formatMaterialAdvanceStatusLabel(focusedMaterialAdvance.status, 'customer')}</Text>
              <Text style={styles.supportBodyText}>{focusedMaterialAdvance.title}</Text>
              <Text style={styles.supportHint}>{focusedMaterialCopy?.body ?? 'This protected fabric update is recorded on your order.'}</Text>
            </View>
          ) : null}

          {justPlacedReadyMade ? (
            <View style={styles.sentBanner}>
              <Text style={styles.sentBannerText}>
                ✓ Order placed · #{order.reference}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' ? ' · item paid first' : ''}
              </Text>
            </View>
          ) : null}

          {materialAdvanceConfirmation ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.supportCard,
                materialAdvanceConfirmation.decision === 'DECLINE'
                  ? styles.supportCardWarning
                  : styles.materialDecisionSuccess,
              ]}
            >
              <Text style={styles.supportCardTitle}>{materialAdvanceConfirmation.title}</Text>
              <Text style={styles.supportBodyText}>{materialAdvanceConfirmation.detail}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Dismiss material request confirmation"
                onPress={() => setMaterialAdvanceConfirmation(null)}
              >
                <Text style={styles.disclosureAction}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Stage progress bar */}
          {PRE_PRODUCTION_STAGES.includes(order.stage) &&
          order.stage !== 'PAYMENT_PENDING' &&
          order.stage !== 'PAYMENT_FAILED' ? (
            <View style={styles.preProductionBar}>
              <View style={styles.preProductionDot} />
              <Text style={styles.preProductionLabel}>
                {order.stage === 'CONSULTATION' && consultationQuotePreparationReady
                  ? 'Quote ready'
                  : preProductionLabel(order.stage, order.orderKind)}
              </Text>
            </View>
          ) : (
            <View style={styles.progressBar}>
              {progressStages.map((s, i) => {
                const done = i <= currentStageIdx
                const active = i === currentStageIdx && !progressIsTerminalComplete
                return (
                  <View key={s} style={styles.progressStep}>
                    <View
                      style={[
                        styles.progressDot,
                        done && styles.progressDotDone,
                        active && styles.progressDotActive,
                      ]}
                    >
                      {done && !active && <Text style={styles.progressCheck}>✓</Text>}
                    </View>
                    {i < progressStages.length - 1 && (
                      <View
                        style={[
                          styles.progressLine,
                          done && i < currentStageIdx && styles.progressLineDone,
                        ]}
                      />
                    )}
                    <Text style={[styles.progressLabel, done && styles.progressLabelDone]}>
                      {progressLabel(s, order.orderKind, isCollection, order.stage)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}

          {/* Current stage status */}
          {!(
            (order.stage === 'CONSULTATION' && consultationRescheduleRequired) ||
            order.stage === 'PAYMENT_PENDING' ||
            order.stage === 'PAYMENT_FAILED'
          ) ? (
          <View style={styles.statusCard} testID="order-tracking-status">
            <DrapeStatusChip
              value={order.stage === 'READY_FOR_COLLECTION' && !isCollection ? 'READY_FOR_DRAPE_DISPATCH' : order.stage}
              label={stageStatusLabel}
              domain="order"
            />
            {stageHelp && <Text style={styles.statusHelp}>{stageHelp}</Text>}
            {latestUpdate?.note && (
              <Text style={styles.statusNote}>{formatOrderUpdateNote(latestUpdate.note)}</Text>
            )}
            {latestUpdate?.photoUrl && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open latest order progress proof"
                accessibilityHint="Opens the order evidence gallery full screen"
                activeOpacity={0.88}
                onPress={() => {
                  const mediaIndex = timelineMediaItems.findIndex((item) => item.uri === latestUpdate.photoUrl)
                  openMediaPreview(timelineMediaItems, Math.max(0, mediaIndex))
                }}
              >
                <StageMediaPreview
                  uri={latestUpdate.photoUrl}
                  style={styles.progressPhoto}
                  surface="customer_order_progress_photo"
                  accessibilityLabel="Latest order progress proof"
                />
              </TouchableOpacity>
            )}
            {order.quotedCompletionDate &&
              order.stage !== 'COMPLETE' &&
              order.stage !== 'DELIVERED' &&
              order.stage !== 'COLLECTED' &&
              order.stage !== 'IN_DISPUTE' && (
                <Text style={styles.statusEta}>
                  Est. ready{' '}
                  {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              )}
          </View>
          ) : null}

          {sourcedFabricApprovalPanel}

          {styleAlignment?.status === 'PENDING_CUSTOMER_APPROVAL' ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>Review the tailor&apos;s style plan</Text>
              <Text style={styles.supportHint}>
                {styleAlignment.tailorInterpretation ??
                  'Your tailor added their interpretation of your references. Approve it before cutting, or request a correction.'}
              </Text>
              <Button
                label={approvingStyle ? 'Saving...' : 'Approve style plan'}
                onPress={() => decideStyleAlignment('approve-style-alignment')}
                disabled={approvingStyle}
              />
              {showStyleCorrection ? (
                <>
                  <Input
                    label="What should change?"
                    value={styleChangeNote}
                    onChangeText={setStyleChangeNote}
                    placeholder="Example: Please make the neckline closer to the first reference."
                    multiline
                  />
                  <Button
                    label={approvingStyle ? 'Sending...' : 'Send correction'}
                    variant="secondary"
                    onPress={() => decideStyleAlignment('request-style-alignment-change')}
                    disabled={approvingStyle || !styleChangeNote.trim()}
                  />
                </>
              ) : (
                <Button
                  label="Request changes"
                  variant="secondary"
                  onPress={() => setShowStyleCorrection(true)}
                  disabled={approvingStyle}
                />
              )}
            </View>
          ) : null}

          {styleAlignment?.status === 'CHANGES_REQUESTED' ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>Style clarification requested</Text>
              <Text style={styles.supportHint} numberOfLines={3}>
                {styleAlignment.tailorInterpretation ?? 'The tailor needs to update the style plan before cutting.'}
              </Text>
              {styleChangeFeedback ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="View your requested style clarification"
                  style={styles.decisionLink}
                  onPress={() => setShowStyleChangeFeedback(true)}
                >
                  <Text style={styles.decisionLinkText}>View changes</Text>
                  <Feather name="chevron-right" size={14} color={Colors.needleGreenDark} />
                </TouchableOpacity>
              ) : null}
              <Text style={styles.supportBodyText}>Your tailor must send an updated interpretation before you approve it.</Text>
            </View>
          ) : null}

          {styleAlignment?.status === 'APPROVED' && PRE_CUTTING_STAGES.includes(order.stage) ? (
            <View style={styles.supportCard} accessibilityRole="summary">
              <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>Style plan approved</Text>
              </View>
              <Text style={styles.supportBodyText}>Your approved interpretation is recorded with this order before cutting.</Text>
            </View>
          ) : null}

          {activeMaterialAdvances.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Material advance</Text>
              {activeMaterialAdvances.map((advance) => {
                const amountLabel = formatAmount(
                  advance.amount,
                  advance.currency,
                  advance.currency,
                  STATIC_FALLBACK_RATES
                )
                const needsDecision = advance.status === 'REQUESTED'
                const needsPayment =
                  advance.status === 'PAYMENT_PENDING' || advance.status === 'PAYMENT_FAILED'
                const reconciliationCopy = materialReconciliationCopy({ outcome: advance.reconciliationOutcome, resolution: advance.reconciliationResolution, customerRefundAmount: advance.customerRefundAmount, unapprovedOverageAmount: advance.unapprovedOverageAmount, actorRole: 'CUSTOMER' })
                return (
                  <View
                    key={advance.id}
                    style={[
                      styles.supportCard,
                      (needsDecision || needsPayment || advance.status === 'BLOCKED') &&
                        styles.supportCardWarning,
                    ]}
                  >
                    <View style={styles.disclosureHeader}>
                      <View style={styles.disclosureCopy}>
                        <Text style={styles.supportCardTitle}>{advance.title}</Text>
                        <Text style={styles.supportHint}>
                          {formatMaterialAdvanceStatusLabel(advance.status, 'customer')}
                        </Text>
                      </View>
                      <Text style={styles.disclosureAction}>{amountLabel}</Text>
                    </View>
                    <Text style={styles.supportBodyText}>{advance.description}</Text>
                    <Text style={styles.supportHint}>
                      {advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE'
                        ? 'This exact amount comes from the fabric allowance already paid at checkout. Approval does not charge you again; Drapeon Money Desk reviews the release before the tailor receives it.'
                        : 'This is separate from the main order funds. Approve only if this material cost makes sense; Drapeon reviews the release before the tailor receives it.'}
                    </Text>
                    {advance.estimateStorageBucket && advance.estimateStoragePath ? (
                      <Button label="View proof" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'estimate') }} />
                    ) : (
                      <View style={styles.materialProofMissing}>
                        <Text style={styles.materialProofMissingTitle}>Supplier proof unavailable</Text>
                        <Text style={styles.supportHint}>Do not approve this request. Ask the tailor to resubmit it with an estimate or supplier photo.</Text>
                      </View>
                    )}
                    {advance.customerResponseReason ? (
                      <Text style={styles.supportHint}>Decision reason: {materialAdvanceDeclineReasonLabel(advance.customerResponseReason) ?? 'Not specified'}</Text>
                    ) : null}
                    {advance.customerResponseNote ? (
                      <Text style={styles.supportHint}>Your note: {advance.customerResponseNote}</Text>
                    ) : null}
                    {advance.receiptStoragePath ? (
                      <Button label="View final receipt" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'receipt') }} />
                    ) : null}
                    {advance.acquiredStoragePath ? (
                      <Button label="View acquired fabric" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'acquired') }} />
                    ) : null}
                    {reconciliationCopy ? (
                      <View style={[styles.supportStatusBadge, reconciliationCopy.tone === 'success' ? styles.supportStatusSuccess : styles.supportStatusWarning]} accessibilityRole="summary">
                        <Text style={[styles.supportStatusText, reconciliationCopy.tone === 'success' ? styles.supportStatusTextSuccess : styles.supportStatusTextWarning]}>{reconciliationCopy.title}</Text>
                        <Text style={styles.supportHint}>{reconciliationCopy.body}</Text>
                        {advance.customerRefundAmount > 0 ? <Text style={styles.supportStatusText}>Refund value: {formatAmount(advance.customerRefundAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                        {advance.unapprovedOverageAmount > 0 ? <Text style={styles.supportStatusText}>Unapproved overage: {formatAmount(advance.unapprovedOverageAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                      </View>
                    ) : null}
                    {needsDecision ? (
                      <View style={styles.inlineActions}>
                        <Button
                          label="Approve"
                          onPress={() => respondToMaterialAdvance(advance, 'APPROVE')}
                          loading={respondingAdvanceId === advance.id}
                          disabled={!!respondingAdvanceId || !advance.estimateStorageBucket || !advance.estimateStoragePath}
                        />
                        <Button
                          label="Decline"
                          variant="secondary"
                          onPress={() => openMaterialAdvanceDecline(advance)}
                          disabled={!!respondingAdvanceId}
                        />
                      </View>
                    ) : needsPayment ? (
                      <Button
                        label={advance.status === 'PAYMENT_FAILED' ? 'Retry payment' : 'Pay material advance'}
                        onPress={() => payMaterialAdvance(advance)}
                        loading={payingAdvanceId === advance.id}
                        disabled={!!payingAdvanceId}
                      />
                    ) : null}
                  </View>
                )
              })}
            </View>
          ) : null}

          {showCancellationPolicyCard && cancellationReviewOpen && (
            <SupportDisclosure
              title={cancellationCardTitle}
              summary={
                canSelfCancelOrder
                  ? 'Stop this order before the next step.'
                  : 'Review cancellation and refund options.'
              }
              defaultExpanded={false}
            >
              {cancellationReviewOpen ? (
                <>
                  <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                      Review open
                    </Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing this cancellation request before handoff. Keep all updates
                    inside this order while we decide the next step.
                  </Text>
                  {cancellationReasonLabel ? (
                    <Text style={styles.supportBodyText}>Reason: {cancellationReasonLabel}</Text>
                  ) : null}
                  {cancellationReview?.note ? (
                    <Text style={styles.supportHint}>{cancellationReview.note}</Text>
                  ) : null}
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                </>
              ) : canSelfCancelOrder ? (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Check the order terms for:{' '}
                      {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.nonRefundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Not normally refunded:{' '}
                      {refundCoverageLabel(cancellationPolicy.nonRefundableNow)}
                    </Text>
                  ) : null}
                  <Button
                    label="Cancel this order"
                    variant="secondary"
                    onPress={() => {
                      void cancelOrderDirectly()
                    }}
                  />
                </>
              ) : canRequestCancellationReview ? (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                  <Button
                    label="Request cancellation review"
                    variant="secondary"
                    onPress={() => setShowCancellationReview(true)}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                </>
              )}
            </SupportDisclosure>
          )}

          {deliveryReviewOpen && (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Shipping &amp; delivery help</Text>
              {deliveryReviewOpen ? (
                <>
                  <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                      Review open
                    </Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing this fulfillment issue. Keep updates and evidence inside the
                    order. High-risk custody or delivery problems pause the order; routine delays do not.
                  </Text>
                  {deliveryReasonLabel ? (
                    <Text style={styles.supportBodyText}>Reason: {deliveryReasonLabel}</Text>
                  ) : null}
                  {deliveryReview?.note ? (
                    <Text style={styles.supportHint}>{deliveryReview.note}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>
                    Available after payment, including after completion. Report tracking, custody,
                    recipient, customs, damage, missing contents, or delivery problems here.
                  </Text>
                  <Button
                    label="Get shipping or delivery help"
                    variant="secondary"
                    onPress={() => setShowDeliveryReview(true)}
                  />
                </>
              )}
            </View>
          )}

          {(order.stage === 'PAYMENT_PENDING' || order.stage === 'PAYMENT_FAILED') && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>
                {order.stage === 'PAYMENT_FAILED'
                  ? order.orderKind === 'READY_MADE'
                    ? 'Checkout failed'
                    : 'Payment failed'
                  : order.orderKind === 'READY_MADE'
                    ? 'Complete checkout'
                    : 'Finish payment'}
              </Text>
              <Text style={styles.videoCallHint}>
                {order.stage === 'PAYMENT_FAILED'
                  ? order.orderKind === 'READY_MADE'
                    ? 'This checkout did not complete. Retry within 2 hours or it will cancel automatically.'
                    : 'This payment did not complete. Retry within 2 hours or the order will cancel automatically.'
                  : order.orderKind === 'READY_MADE'
                    ? 'Your checkout is saved for now. Payment must succeed before this becomes a placed order.'
                    : 'Your tailor will only see this order as confirmed after payment succeeds.'}
              </Text>
              {paymentRouteCopyForCurrency(order.quotedCurrency) ? (
                <Text style={styles.videoCallHint}>
                  {paymentRouteCopyForCurrency(order.quotedCurrency)}
                </Text>
              ) : null}
              {order.stage === 'PAYMENT_PENDING' ? (
                <Text style={styles.videoCallHint}>
                  If your bank already shows a charge, do not pay again. Refresh this order or contact support if it still looks pending after a few minutes.
                </Text>
              ) : null}
              <CommercialBenefitsCard
                orderId={order.id}
                currency={order.quotedCurrency}
                variant="checkout"
                onChanged={() => fetchOrder({ silent: true })}
              />
              <Button
                label={
                  order.stage === 'PAYMENT_FAILED'
                    ? order.orderKind === 'READY_MADE'
                      ? 'Retry checkout'
                      : 'Retry payment'
                    : order.orderKind === 'READY_MADE'
                      ? 'Complete checkout'
                      : 'Continue payment'
                }
                onPress={continuePayment}
                loading={paying}
                disabled={paying}
              />
            </View>
          )}

          {hasPendingFulfillmentPayment(order) && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>{pendingFulfillmentPaymentLabel(order)}</Text>
              <Text style={styles.videoCallHint}>
                {order.deliveryMethod === 'LOCAL_DELIVERY'
                  ? 'Your item is already paid. Drapeon requested an extra delivery payment for a non-standard handoff, such as rush or exception dispatch.'
                  : 'Your item is already paid. Drapeon requested an extra shipping payment for a non-standard handoff, such as rush or exception dispatch.'}
              </Text>
              {paymentRouteCopyForCurrency(order.quotedCurrency) ? (
                <Text style={styles.videoCallHint}>
                  {paymentRouteCopyForCurrency(order.quotedCurrency)}
                </Text>
              ) : null}
              <View style={styles.timelineContent}>
                {baseAmount(order) != null ? (
                  <SummaryLine
                    label="Item already paid"
                    value={formatAmount(
                      baseAmount(order) ?? 0,
                      order.quotedCurrency,
                      order.quotedCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  />
                ) : null}
                <SummaryLine
                  label={
                    order.deliveryMethod === 'LOCAL_DELIVERY'
                      ? 'Delivery payment'
                      : 'Shipping payment'
                  }
                  value={formatAmount(
                    order.fulfillmentFee,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                />
              </View>
              <Button
                label={
                  order.deliveryMethod === 'LOCAL_DELIVERY'
                    ? 'Pay extra delivery fee'
                    : 'Pay extra shipping fee'
                }
                onPress={continuePayment}
                loading={paying}
                disabled={paying}
              />
            </View>
          )}

          {/* Consultation */}
          {order.stage === 'CONSULTATION' && !consultationRescheduleRequired && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>
                {consultationMeta?.requestedBy === 'CUSTOMER' &&
                consultationMeta.status === 'REQUESTED'
                  ? 'Consultation request sent'
                  : consultationMeta?.status === 'EXPIRED'
                    ? 'Consultation expired'
                    : consultationPaymentRequired
                      ? 'Consultation payment required'
                      : consultationCallAvailable
                        ? 'Consultation call available'
                        : consultationCallExpired
                          ? 'Consultation window ended'
                          : consultationApproved
                            ? 'Consultation scheduled'
                            : 'Consultation requested'}
              </Text>
              {order.consultationFee != null && (
                <Text style={styles.consultationFeeText}>
                  Consultation fee:{' '}
                  {formatAmount(
                    order.consultationFee,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              )}
              {consultationMeta ? (
                <View style={styles.timelineContent}>
                  {consultationMeta.feeAmount ? (
                    <SummaryLine
                      label="Fee treatment"
                      value={
                        consultationMeta.feeCreditable
                          ? 'Counts toward the final order if you go ahead'
                          : 'Separate consultation fee'
                      }
                    />
                  ) : null}
                  {consultationMeta.scheduledStartAt ? (
                    <SummaryLine
                      label="Scheduled for"
                      value={formatConsultationStart(consultationMeta.scheduledStartAt, consultationMeta.timezone)}
                    />
                  ) : consultationMeta.proposedStartAt ? (
                    <SummaryLine
                      label="Requested time"
                      value={formatConsultationStart(consultationMeta.proposedStartAt, consultationMeta.timezone)}
                    />
                  ) : null}
                  {consultationMeta.status === 'REQUESTED' && consultationMeta.requestExpiresAt ? (
                    <SummaryLine
                      label="Respond by"
                      value={formatConsultationStart(consultationMeta.requestExpiresAt, consultationMeta.timezone)}
                    />
                  ) : null}
                  {consultationMeta.paymentTiming ? (
                    <SummaryLine
                      label="Payment timing"
                      value={CONSULTATION_PAYMENT_TIMING_LABELS[consultationMeta.paymentTiming]}
                    />
                  ) : null}
                  {consultationMeta.reschedulePolicy ? (
                    <SummaryLine
                      label="Rescheduling"
                      value={
                        CONSULTATION_RESCHEDULE_POLICY_LABELS[consultationMeta.reschedulePolicy]
                      }
                    />
                  ) : null}
                  {consultationMeta.noShowPolicy ? (
                    <SummaryLine
                      label="No-show policy"
                      value={CONSULTATION_NO_SHOW_POLICY_LABELS[consultationMeta.noShowPolicy]}
                    />
                  ) : null}
                  {consultationMeta.status !== 'REQUESTED' && consultationMeta.expiryPolicy ? (
                    <SummaryLine
                      label="Booking validity"
                      value={CONSULTATION_EXPIRY_POLICY_LABELS[consultationMeta.expiryPolicy]}
                    />
                  ) : null}
                  {consultationPaymentPaid ? (
                    <SummaryLine
                      label="Payment status"
                      value="Paid"
                    />
                  ) : null}
                  <SummaryLine
                    label="Bring to call"
                    value="Fit concerns, reference photos, fabric questions, and any deadline risk"
                  />
                </View>
              ) : null}
              <Text style={styles.videoCallHint}>
                {consultationPaymentRequired
                  ? 'Your tailor approved the slot and charges for this consultation. Pay the consultation fee here first; the call opens around the scheduled time.'
                  : consultationCallAvailable
                    ? 'Your protected consultation call is available now.'
                    : consultationMeta?.requestedBy === 'CUSTOMER' &&
                        consultationMeta.status === 'REQUESTED'
                      ? `Waiting for ${order.tailorName.split(' ')[0]}. This request expires after 48 hours.`
                      : consultationMeta?.status === 'EXPIRED'
                        ? 'This consultation window expired. The order is back in quote review so your tailor can send a quote, reschedule, or decline.'
                        : consultationCallExpired
                          ? 'The scheduled call window has ended. Message your tailor to agree on another time.'
                        : consultationPaymentPaid
                          ? `Your consultation fee is paid. ${formatCallCountdown(consultationCallLifecycle.msUntilOpen)}.`
                          : consultationApproved
                            ? 'This consultation is scheduled. Open the call around the scheduled time.'
                            : `Your tailor wants to speak before production starts. Keep chatting here and ${order.tailorName.split(' ')[0]} will share the call link when ready.`}
              </Text>
              {consultationPaymentRequired ? (
                <Button
                  label="Pay consultation fee"
                  onPress={continuePayment}
                  loading={paying}
                  disabled={paying}
                />
              ) : consultationCallAvailable ? (
                <Button
                  label={`Join ${consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video'} call now`}
                  onPress={() => { void startConsultationCall(consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video') }}
                  loading={!!startingConsultationCall}
                  disabled={!!startingConsultationCall}
                />
              ) : consultationApproved && consultationCallLifecycle.status === 'upcoming' ? (
                <>
                  <Button
                    label={formatCallCountdown(consultationCallLifecycle.msUntilOpen)}
                    variant="secondary"
                    onPress={() => {}}
                    disabled
                  />
                  {!consultationReschedulePending ? (
                    <Button
                      label="Need another time?"
                      variant="secondary"
                      onPress={askToRescheduleConsultation}
                    />
                  ) : null}
                </>
              ) : (
                <Button
                  label={conversationCtaLabel}
                  variant="secondary"
                  onPress={() =>
                    router.navigate({
                      pathname: '/(customer)/messages/[orderId]',
                      params: {
                        orderId: order.id,
                        returnTo: `/(customer)/orders/${order.id}`,
                        historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                      },
                    })
                  }
                />
              )}
            </View>
          )}

          {consultationMeta?.scheduledStartAt ? (
            <ConsultationAttendancePanel orderId={order.id} actorRole="CUSTOMER" />
          ) : null}
          {order.stage === 'CONSULTATION' ? (
            <ConsultationReschedulePanel
              orderId={order.id}
              actorRole="CUSTOMER"
              actorId={userId}
              counterpartName={order.tailorName.split(' ')[0]}
              onOpenChat={openOrderMessages}
              onUpdated={() => { void fetchOrder({ silent: true }) }}
              onPendingChange={setConsultationReschedulePending}
              onRescheduleRequiredChange={setConsultationRescheduleRequired}
            />
          ) : null}
          {consultationMeta?.scheduledStartAt && !consultationRescheduleRequired && !consultationCallExpired ? (
            <ConsultationLifecyclePanel orderId={order.id} actorRole="CUSTOMER" onUpdated={() => { void fetchOrder({ silent: true }) }} />
          ) : null}
          <TaxDecisionSummaryCard orderId={order.id} />
          {order.orderKind === 'CUSTOM' && !['CANCELLED'].includes(order.stage) ? (
            <SupportDisclosure
              title="Fit protection"
              summary="Measurements, style decisions, and aftercare are recorded here."
              defaultExpanded={false}
            >
              <Text style={styles.supportHint}>
                Before cutting, confirm the measurements and decisions that affect fit. After
                handoff, you can report fit or finish issues from this page for 14 days.
              </Text>
              <View style={styles.timelineContent}>
                <SummaryLine
                  label="Before cutting"
                  value={
                    measurementConfirmationNeeded
                      ? 'Waiting for your measurement confirmation'
                      : 'Measurements and material should be confirmed here'
                  }
                />
                {styleAlignment?.requiredBeforeCutting ? (
                  <SummaryLine
                    label="Style references"
                    value={
                      styleAlignment.status === 'APPROVED'
                        ? 'Approved before cutting'
                        : styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
                          ? 'Waiting for your approval'
                          : 'Tailor should confirm their interpretation before cutting'
                    }
                  />
                ) : null}
                <SummaryLine
                  label="After handoff"
                  value="Use aftercare if the garment arrives with a fit or finish issue"
                />
              </View>
            </SupportDisclosure>
          ) : null}

          {(scopeChangeOpen || canRequestScopeChange) && (
            <View style={[styles.supportCard, scopeChangeOpen && styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>
                {scopeChangeOpen ? 'Change request open' : 'Need to change something?'}
              </Text>
              {scopeChangeOpen ? (
                <>
                  <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                      {scopeChangeStatusLabel ?? 'Waiting for review'}
                    </Text>
                  </View>
                  {scopeChangeTypeLabel ? (
                    <Text style={styles.supportBodyText}>{scopeChangeTypeLabel}</Text>
                  ) : null}
                  {scopeChange?.summary ? (
                    <Text style={styles.supportHint}>{scopeChange.summary}</Text>
                  ) : null}
                  {scopeChange?.impacts?.length ? (
                    <Text style={styles.supportHint}>
                      Affects:{' '}
                      {scopeChange.impacts
                        .map((impact) => SCOPE_CHANGE_IMPACT_LABELS[impact])
                        .join(', ')}
                    </Text>
                  ) : null}
                  <Text style={styles.supportHint}>
                    Keep working details in Messages. Price, deadline, fit, fabric, or fulfillment changes need a clear Drapeon record before the next step.
                  </Text>
                  {canRespondScopeChange ? (
                    <View style={{ gap: Spacing.sm }}>
                      <Button
                        label="Accept change"
                        variant="secondary"
                        onPress={() => respondToScopeChange('ACCEPTED')}
                      />
                      <Button
                        label="Decline change"
                        variant="ghost"
                        onPress={() => respondToScopeChange('DECLINED')}
                      />
                    </View>
                  ) : null}
                  {canCancelScopeChange ? (
                    <Button
                      label="Cancel request"
                      variant="ghost"
                      onPress={() => respondToScopeChange('CANCELLED')}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>
                    Use this for measurement amendments, style/reference changes, deadline shifts, pause/restart moments, or rework before handoff. Drapeon keeps the change tied to this order.
                  </Text>
                  <Button
                    label="Request change"
                    variant="secondary"
                    onPress={() => setShowScopeChange(true)}
                  />
                </>
              )}
            </View>
          )}

          {['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED'].includes(order.stage) ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Event emergency</Text>
              <Text style={styles.supportHint}>
                Use this only when a real wear date is at risk, the item cannot be worn, or delivery has gone wrong close to the event. Drapeon treats it as urgent ops review.
              </Text>
              <Button
                label="Request emergency help"
                variant="secondary"
                onPress={() => setShowEmergencySupport(true)}
              />
            </View>
          ) : null}

          {isCollection ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>
                {pickupDetailsUnlocked ? 'Pickup details' : 'Pickup plan'}
              </Text>
              {pickupDetailsUnlocked && order.pickupAddress ? (
                <>
                  <Text style={styles.supportBodyText}>{order.pickupAddress}</Text>
                  {order.pickupInstructions ? (
                    <Text style={styles.supportHint}>{order.pickupInstructions}</Text>
                  ) : (
                    <Text style={styles.supportHint}>
                      Bring your collection code and inspect the order before confirming pickup.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.supportHint}>
                  {pickupDetailsUnlocked
                    ? 'Your seller marked this order ready for collection, but exact pickup details are still missing. Message them in Drapeon before travelling.'
                    : order.tailorLocation
                      ? `This is a pickup order in ${order.tailorLocation}. Exact pickup details appear once the seller marks the order ready for collection.`
                      : 'This is a pickup order. Exact pickup details appear once the seller marks the order ready for collection.'}
                </Text>
              )}
            </View>
          ) : null}

          {handoffHelpAvailable ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>
                {handoffHelpCardTitle('CUSTOMER', order.deliveryMethod)}
              </Text>
              <Text style={styles.supportHint}>
                {handoffHelpCardBody('CUSTOMER', order.deliveryMethod)}
              </Text>
              {handoffIssue ? (
                <View style={styles.handoffIssueCard}>
                  <View style={styles.handoffIssueHeader}>
                    <Text style={styles.handoffIssueTitle}>
                      {handoffIssueLabel(handoffIssue.issueType)}
                    </Text>
                    <View
                      style={[
                        styles.handoffStatusPill,
                        handoffIssue.status === 'ESCALATED' && styles.handoffStatusPillEscalated,
                      ]}
                    >
                      <Text style={styles.handoffStatusText}>
                        {handoffIssueStatusLabel(handoffIssue.status)}
                      </Text>
                    </View>
                  </View>
                  {handoffIssue.description ? (
                    <Text style={styles.supportHint}>{handoffIssue.description}</Text>
                  ) : null}
                  <Text style={styles.supportHint}>
                    {handoffIssue.status === 'ESCALATED'
                      ? 'Drapeon support has been flagged for follow-up. Keep all updates in this order thread.'
                      : 'This handoff help thread is open inside Drapeon. Keep all updates here so the timeline stays clear.'}
                  </Text>
                  <Button
                    label="Mark help resolved"
                    variant="secondary"
                    onPress={() => {
                      void markHandoffIssueResolved()
                    }}
                    loading={resolvingHandoffIssue}
                    disabled={resolvingHandoffIssue}
                  />
                </View>
              ) : null}
              <View style={{ gap: Spacing.md }}>
                <Button
                  label={handoffOpsButtonLabel(order.deliveryMethod, !!handoffIssue)}
                  onPress={() => setShowHandoffSupport(true)}
                />
                <Button
                  label="Message tailor"
                  variant="secondary"
                  onPress={openOrderMessages}
                />
              </View>
            </View>
          ) : null}

          {/* Confirm receipt button — shipping path */}
          {['SHIPPED', 'OUT_FOR_DELIVERY'].includes(order.stage) &&
            !dispatchHandoffComplete &&
            order.deliveryMethod !== 'LOCAL_COLLECTION' && (
              <Button
                label="I've received my order"
                onPress={confirmReceipt}
                loading={confirming}
                disabled={confirming}
              />
            )}

          {showShipmentDetails ? (
            <View style={styles.trackingRow}>
              <View>
                <Text style={styles.trackingLabel}>
                  {order.deliveryMethod === 'LOCAL_DELIVERY'
                    ? 'Delivery details'
                    : 'Shipment details'}
                </Text>
                {dispatchRecord?.serviceLevel ? (
                  <Text style={styles.fabricSavedNote}>
                    Service level: {DISPATCH_SERVICE_LEVEL_LABELS[dispatchRecord.serviceLevel]}
                  </Text>
                ) : null}
                {order.fulfillmentProvider ? (
                  <Text style={styles.trackingNumber}>{order.fulfillmentProvider}</Text>
                ) : null}
                {order.trackingNumber ? (
                  <Text style={styles.fabricSavedNote}>
                    Tracking:{' '}
                    {safeOperationalText(
                      order.trackingNumber,
                      'Tracking reference saved in Drapeon'
                    )}
                  </Text>
                ) : null}
                {order.fulfillmentReference ? (
                  <Text style={styles.fabricSavedNote}>Reference: {order.fulfillmentReference}</Text>
                ) : null}
                {order.fulfillmentContactName ? (
                  <Text style={styles.fabricSavedNote}>Contact: {order.fulfillmentContactName}</Text>
                ) : null}
                {order.fulfillmentContactPhone ? (
                  <Text style={styles.fabricSavedNote}>
                    {safeOperationalText(
                      order.fulfillmentContactPhone,
                      'Courier contact saved in Drapeon'
                    )}
                  </Text>
                ) : null}
                {!order.fulfillmentProvider && order.carrier ? (
                  <Text style={styles.trackingNumber}>{order.carrier}</Text>
                ) : null}
              </View>
              {order.trackingNumber ? (
                <View style={styles.trackingAction}>
                  <Button
                    label="Track shipment"
                    variant="secondary"
                    onPress={() => {
                      void openTrackingPage({
                        trackingNumber: order.trackingNumber!,
                        carrier: order.fulfillmentProvider ?? order.carrier,
                        audience: 'customer',
                      })
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {showNonCollectionHandoffPanels ? (
            <SupportDisclosure
              title={
                order.deliveryMethod === 'LOCAL_DELIVERY'
                  ? 'Delivery protection'
                  : 'Shipping protection'
              }
              summary="What to do if handoff, courier, or tracking goes off track."
              defaultExpanded={!compressReadyMadeSupport}
            >
              <Text style={styles.supportHint}>
                Do not confirm receipt until the garment is actually in hand. If dispatch stalls,
                the rider or courier cannot be reached, or the handoff goes off track, keep the
                conversation in this order and open a concern here instead of trying to settle it
                offline.
              </Text>
            </SupportDisclosure>
          ) : null}

          {(wearerLabel || measurementSource || fitConfidence || measurementAgeText || measurementConfirmationNeeded) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Measurement check</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  {wearerLabel ? <SummaryLine label="Wearer" value={wearerLabel} /> : null}
                  {measurementSource ? (
                    <SummaryLine
                      label="Source"
                      value={
                        MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource)
                      }
                    />
                  ) : null}
                  {fitConfidence ? (
                    <SummaryLine
                      label="Fit confidence"
                      value={FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence)}
                    />
                  ) : null}
                  {measurementAgeText ? (
                    <SummaryLine label="Last updated" value={measurementAgeText} />
                  ) : null}
                </View>
                {measurementAge?.stale ? (
                  <Text style={styles.supportWarningText}>
                    These measurements are over {STALE_MEASUREMENT_MONTHS} months old. If your fit
                    changed, ask for a measurement amendment before cutting starts.
                  </Text>
                ) : null}
                {measurementConfirmationNeeded ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Confirmation needed before cutting
                      </Text>
                    </View>
                    {order.measurementSnapshot?.confirmationReason ? (
                      <Text style={styles.supportBodyText}>
                        {order.measurementSnapshot.confirmationReason}
                      </Text>
                    ) : null}
                    {measurementConfirmationFields.length > 0 ? (
                      <View style={styles.measurementConfirmGuideList}>
                        {measurementConfirmationFields.map((field) => {
                          const guide = measurementGuideForField(field)
                          return (
                            <View key={field} style={styles.measurementConfirmGuideCard}>
                              <Text style={styles.measurementConfirmGuideTitle}>
                                {labelMeasurementField(field)}
                              </Text>
                              {guide ? (
                                <Text style={styles.measurementConfirmGuideText}>{guide}</Text>
                              ) : (
                                <Text style={styles.measurementConfirmGuideText}>
                                  Confirm this value against your latest tape measurement before the
                                  tailor cuts.
                                </Text>
                              )}
                            </View>
                          )
                        })}
                      </View>
                    ) : null}
                    <Text style={styles.supportHint}>
                      Your tailor has paused cutting until you confirm these measurements are still
                      correct.
                    </Text>
                    <Button
                      label="Confirm measurements"
                      onPress={confirmMeasurements}
                      loading={confirmingMeasurements}
                      disabled={confirmingMeasurements}
                    />
                  </>
                ) : order.measurementSnapshot?.confirmedAt ? (
                  <Text style={styles.supportHint}>
                    Measurements were confirmed on{' '}
                    {new Date(order.measurementSnapshot.confirmedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    .
                  </Text>
                ) : (
                  <Text style={styles.supportHint}>
                    Your saved measurement source is attached to this order for fit review.
                  </Text>
                )}
              </View>
            </View>
          )}

          {fitProfile ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fit notes</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  {fitProfile.status ? (
                    <SummaryLine
                      label="Status"
                      value={formatMeasurementStatusLabel(fitProfile.status)}
                    />
                  ) : null}
                  {fitProfile.fitIntent ? (
                    <SummaryLine
                      label="Fit direction"
                      value={FIT_INTENT_LABELS[fitProfile.fitIntent]}
                    />
                  ) : null}
                  {fitProfile.fabricStretch ? (
                    <SummaryLine
                      label="Stretch"
                      value={FABRIC_STRETCH_LABELS[fitProfile.fabricStretch]}
                    />
                  ) : null}
                  {fitProfile.wearDaySupport ? (
                    <SummaryLine
                      label="Support"
                      value={WEAR_DAY_SUPPORT_LABELS[fitProfile.wearDaySupport]}
                    />
                  ) : null}
                  {fitProfile.coveragePreference ? (
                    <SummaryLine
                      label="Coverage"
                      value={COVERAGE_PREFERENCE_LABELS[fitProfile.coveragePreference]}
                    />
                  ) : null}
                  {typeof fitProfile.heelHeightCm === 'number' ? (
                    <SummaryLine label="Heel height" value={`${fitProfile.heelHeightCm} cm`} />
                  ) : null}
                </View>
                {fitProfile.styleEaseNotes ? (
                  <Text style={styles.supportBodyText}>{fitProfile.styleEaseNotes}</Text>
                ) : null}
                {fitProfile.postureNote ? (
                  <Text style={styles.supportHint}>Posture: {fitProfile.postureNote}</Text>
                ) : null}
                {fitProfile.asymmetryNote ? (
                  <Text style={styles.supportHint}>Asymmetry: {fitProfile.asymmetryNote}</Text>
                ) : null}
                {fitProfile.tailorMeasurementOverrideReason ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                        Tailor reviewed these fit notes
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>
                      {fitProfile.tailorMeasurementOverrideReason}
                    </Text>
                  </>
                ) : fitProfile.requiresTailorReview ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Tailor review will happen before cutting
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>
                      Your tailor will review these fit notes before moving this order into cutting.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.supportHint}>
                    These fit notes were attached to help your tailor quote and cut with more
                    context.
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          {order.orderKind === 'CUSTOM' && (consultationMeta || quoteBreakdown || bulkOrder) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quote setup</Text>
              {consultationMeta ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Consultation terms</Text>
                  <View style={styles.supportMetaList}>
                    <SummaryLine
                      label="Status"
                      value={formatConsultationStatusLabel(consultationMeta.status)}
                    />
                    <SummaryLine
                      label="Fee"
                      value={
                        consultationMeta.feeAmount && consultationMeta.feeCurrency
                          ? formatAmount(
                              consultationMeta.feeAmount,
                              consultationMeta.feeCurrency as CurrencyCode,
                              consultationMeta.feeCurrency as CurrencyCode,
                              STATIC_FALLBACK_RATES
                            )
                          : 'Free'
                      }
                    />
                    {consultationMeta.feeAmount ? (
                      <SummaryLine
                        label="Fee treatment"
                        value={
                          consultationMeta.feeCreditable
                            ? 'Counts toward the final order'
                            : 'Separate consultation fee'
                        }
                      />
                    ) : null}
                    {consultationMeta.scheduledStartAt ? (
                      <SummaryLine
                        label="Scheduled for"
                        value={formatConsultationStart(consultationMeta.scheduledStartAt, consultationMeta.timezone)}
                      />
                    ) : consultationMeta.proposedStartAt ? (
                      <SummaryLine
                        label="Requested time"
                        value={formatConsultationStart(consultationMeta.proposedStartAt, consultationMeta.timezone)}
                      />
                    ) : null}
                    {consultationMeta.paymentTiming ? (
                      <SummaryLine
                        label="Payment timing"
                        value={CONSULTATION_PAYMENT_TIMING_LABELS[consultationMeta.paymentTiming]}
                      />
                    ) : null}
                    {consultationMeta.reschedulePolicy ? (
                      <SummaryLine
                        label="Rescheduling"
                        value={
                          CONSULTATION_RESCHEDULE_POLICY_LABELS[consultationMeta.reschedulePolicy]
                        }
                      />
                    ) : null}
                    {consultationMeta.noShowPolicy ? (
                      <SummaryLine
                        label="No-show"
                        value={CONSULTATION_NO_SHOW_POLICY_LABELS[consultationMeta.noShowPolicy]}
                      />
                    ) : null}
                    {consultationMeta.expiryPolicy ? (
                      <SummaryLine
                        label="Window"
                        value={CONSULTATION_EXPIRY_POLICY_LABELS[consultationMeta.expiryPolicy]}
                      />
                    ) : null}
                  </View>
                  {consultationMeta.requestNote ? (
                    <Text style={styles.supportHint}>{consultationMeta.requestNote}</Text>
                  ) : null}
                </View>
              ) : null}

              {quoteBreakdown ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Pricing breakdown</Text>
                  <View style={styles.supportMetaList}>
                    {typeof quoteBreakdown.laborAmount === 'number' ? (
                      <SummaryLine
                        label="Labour"
                        value={formatAmount(
                          quoteBreakdown.laborAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      />
                    ) : null}
                    {typeof quoteBreakdown.sourcingAmount === 'number' ? (
                      <SummaryLine
                        label="Sourcing"
                        value={formatAmount(
                          quoteBreakdown.sourcingAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      />
                    ) : null}
                    {typeof quoteBreakdown.rushAmount === 'number' ? (
                      <SummaryLine
                        label="Rush fee"
                        value={formatAmount(
                          quoteBreakdown.rushAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      />
                    ) : null}
                    {typeof quoteBreakdown.consultationCreditAmount === 'number' &&
                    quoteBreakdown.consultationCreditAmount > 0 ? (
                      <SummaryLine
                        label="Consultation fee credit"
                        value={`-${formatAmount(quoteBreakdown.consultationCreditAmount, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)}`}
                      />
                    ) : null}
                  </View>
                  {quoteBreakdown.summary ? (
                    <Text style={styles.supportBodyText}>{quoteBreakdown.summary}</Text>
                  ) : null}
                  {quoteBreakdown.included && quoteBreakdown.included.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Included: {quoteBreakdown.included.join(', ')}
                    </Text>
                  ) : null}
                  {quoteBreakdown.excluded && quoteBreakdown.excluded.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Not included: {quoteBreakdown.excluded.join(', ')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {bulkOrder?.enabled ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Bulk order note</Text>
                  <View style={styles.supportMetaList}>
                    {bulkOrder.label ? <SummaryLine label="Group" value={bulkOrder.label} /> : null}
                    {bulkOrder.recipientCount ? (
                      <SummaryLine label="Recipients" value={`${bulkOrder.recipientCount}`} />
                    ) : null}
                    {bulkOrder.memberNames && bulkOrder.memberNames.length > 0 ? (
                      <SummaryLine label="Members" value={bulkOrder.memberNames.join(', ')} />
                    ) : null}
                    <SummaryLine
                      label="Handling"
                      value={
                        bulkOrder.statusPolicy === 'OPS_MANAGED_LINKED_CHILDREN'
                          ? 'Drapeon manages linked recipient timelines for this order.'
                          : 'Drapeon manages linked recipients and status flow for this order.'
                      }
                    />
                    <SummaryLine
                      label="Measurement privacy"
                      value={
                        bulkOrder.measurementPrivacy === 'TAILOR_ONLY'
                          ? 'Recipient measurements stay tailor-only.'
                          : 'Measurements stay private to the tailor.'
                      }
                    />
                    {bulkOrder.memberMeasurementPolicy ? (
                      <SummaryLine label="Measurement rule" value={bulkOrder.memberMeasurementPolicy} />
                    ) : null}
                    <SummaryLine
                      label="Payer model"
                      value={
                        bulkOrder.payerModel === 'SINGLE_PAYER'
                          ? 'One payer covers the whole group order'
                          : 'Single payer'
                      }
                    />
                    <SummaryLine
                      label="Dye-lot consistency"
                      value={
                        bulkOrder.dyeLotConsistencyRequired
                          ? 'Keep fabrics matched across the whole group'
                          : 'Not flagged'
                      }
                    />
                  </View>
                  {bulkOrder.notes ? (
                    <Text style={styles.supportHint}>{bulkOrder.notes}</Text>
                  ) : null}
                  {groupMembers.length > 0 ? (
                    <View style={styles.groupMemberList}>
                      {groupMembers.map((member) => (
                        <View key={member.id} style={styles.groupMemberRow}>
                          <View style={styles.groupMemberCopy}>
                            <Text style={styles.groupMemberName}>{member.displayName}</Text>
                            <Text style={styles.groupMemberStatus}>
                              {member.status === 'ACCEPTED'
                                ? 'Measurements attached'
                                : member.status === 'DECLINED'
                                  ? 'Invite declined'
                                  : member.status === 'INVITED'
                                    ? 'Invite sent'
                                    : 'Invite not sent'}
                            </Text>
                          </View>
                          {member.status === 'ACCEPTED' ? (
                            <View style={styles.groupMemberBadge}>
                              <Feather name="check" size={14} color={Colors.needleGreenDark} />
                              <Text style={styles.groupMemberBadgeText}>Ready</Text>
                            </View>
                          ) : member.status === 'REMOVED' ? null : (
                            <TouchableOpacity
                              style={styles.groupInviteButton}
                              onPress={() => { void shareGroupInvite(member) }}
                              activeOpacity={0.75}
                            >
                              <Text style={styles.groupInviteButtonText}>
                                {member.status === 'INVITED' ? 'Reshare' : 'Invite'}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {order.fabricFundingPolicyVersion !== 'fabric-funding-2026-08-21-v2' && (order.fabricSource === 'CUSTOMER_SUPPLIES' ||
            fabricHandoffLabel ||
            fabricPolicy ||
            materialIssue) && (
            <View style={styles.section}>
              <SupportDisclosure
                title="Fabric handoff"
                summary={
                  order.supportMeta.fabricReceivedAt
                    ? 'Received and recorded'
                    : sourcedFabricPending
                      ? 'Your approval is needed'
                      : fabricHandoffLabel ?? (order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'You supply the fabric' : 'Tailor sources fabric')
                }
                defaultExpanded={Boolean(sourcedFabricPending || showFabricTrackingSection)}
              >
                <View style={styles.supportMetaList}>
                  <SummaryLine
                    label="Fabric source"
                    value={
                      order.fabricSource === 'CUSTOMER_SUPPLIES'
                        ? 'You supply the fabric'
                        : 'Tailor sources fabric'
                    }
                  />
                  {fabricHandoffLabel ? (
                    <SummaryLine label="Handoff plan" value={fabricHandoffLabel} />
                  ) : order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                    <SummaryLine
                      label="Handoff plan"
                      value="To be confirmed in chat or consultation"
                    />
                  ) : null}
                </View>
                {order.supportMeta.fabricReceivedAt ? (
                  <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                      Tailor confirmed fabric receipt
                    </Text>
                  </View>
                ) : null}
                {order.supportMeta.fabricReceivedAt ? (
                  <Text style={styles.supportHint}>
                    Confirmed on{' '}
                    {new Date(order.supportMeta.fabricReceivedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {order.supportMeta.fabricReceivedNote
                      ? ` · ${order.supportMeta.fabricReceivedNote}`
                      : ''}
                    .
                  </Text>
                ) : showFabricTrackingSection ? (
                  <View style={styles.fabricTrackingAction}>
                    <Text style={styles.supportBodyText}>Add the shipping reference when the fabric is on its way.</Text>
                    <View style={styles.fabricInputRow}>
                      <TextInput
                        style={styles.fabricInput}
                        placeholder="Tracking or shipping reference"
                        placeholderTextColor={Colors.midGrey}
                        value={fabricTracking}
                        onChangeText={setFabricTracking}
                        editable={!savingFabric}
                        autoCapitalize="characters"
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        style={[
                          styles.fabricSaveBtn,
                          (!fabricTracking.trim() || fabricTracking === order.fabricTracking) &&
                            styles.fabricSaveBtnDisabled,
                        ]}
                        onPress={saveFabricTracking}
                        disabled={
                          !fabricTracking.trim() ||
                          fabricTracking === order.fabricTracking ||
                          savingFabric
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Save fabric tracking"
                      >
                        {savingFabric ? (
                          <ActivityIndicator color={Colors.textInverse} size="small" />
                        ) : (
                          <Text style={styles.fabricSaveBtnText}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    {order.fabricTracking ? (
                      <Text style={styles.fabricSavedNote}>
                        Saved: {order.fabricTracking}
                      </Text>
                    ) : null}
                  </View>
                ) : order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                  <Text style={styles.supportHint}>
                    Share dropoff photos, courier tracking, or a receipt in the order thread until the tailor confirms the fabric is in hand.
                  </Text>
                ) : (
                  <Text style={styles.supportHint}>
                    The tailor will source materials from the accepted quote instead of waiting on a
                    customer handoff. Ask for fabric proof here before approving cutting if color,
                    texture, or quality matters. For color-sensitive fabric, ask them to place a
                    white piece of paper beside the fabric in natural light.
                  </Text>
                )}
                {order.fabricSource === 'TAILOR_SOURCES' &&
                order.customDetail?.fabricDescription ? (
                  <Text style={styles.supportHint}>
                    Fabric requested: {order.customDetail.fabricDescription}
                  </Text>
                ) : null}
                {order.fabricSource === 'TAILOR_SOURCES' &&
                order.customDetail?.fabricApprovalStatus ? (
                  <View
                    style={[
                      styles.supportStatusBadge,
                      order.customDetail.fabricApprovalStatus === 'APPROVED'
                        ? styles.supportStatusSuccess
                        : styles.supportStatusWarning,
                    ]}
                  >
                    <Text
                      style={[
                        styles.supportStatusText,
                        order.customDetail.fabricApprovalStatus === 'APPROVED'
                          ? styles.supportStatusTextSuccess
                          : styles.supportStatusTextWarning,
                      ]}
                    >
                      {order.customDetail.fabricApprovalStatus === 'APPROVED'
                        ? 'Sourced fabric approved'
                        : order.customDetail.fabricApprovalStatus === 'CHANGES_REQUESTED'
                          ? 'Fabric changes requested'
                          : order.customDetail.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL'
                            ? 'Your fabric approval is needed'
                            : 'Fabric approval pending'}
                    </Text>
                  </View>
                ) : null}
              </SupportDisclosure>
              {fabricPolicy ? (
                <SupportDisclosure
                  title="Fabric rules and exceptions"
                  summary="Preparation, rejection, late fabric, replacements, and disputes"
                  defaultExpanded={false}
                >
                  {fabricPolicy.rejectionReasons && fabricPolicy.rejectionReasons.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Tailor can reject before cutting for:{' '}
                      {fabricPolicy.rejectionReasons.join(' · ')}
                    </Text>
                  ) : null}
                  {fabricPolicy.prepRequirements && fabricPolicy.prepRequirements.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Preparation: {fabricPolicy.prepRequirements.join(' · ')}
                    </Text>
                  ) : null}
                  {fabricPolicy.lateFabricRule ? (
                    <Text style={styles.supportHint}>
                      If fabric is late: {fabricPolicy.lateFabricRule}
                    </Text>
                  ) : null}
                  {fabricPolicy.missingFabricRule ? (
                    <Text style={styles.supportHint}>
                      If fabric never arrives: {fabricPolicy.missingFabricRule}
                    </Text>
                  ) : null}
                  {fabricPolicy.replacementRule ? (
                    <Text style={styles.supportHint}>
                      Replacement: {fabricPolicy.replacementRule}
                    </Text>
                  ) : null}
                  {fabricPolicy.disagreementRule ? (
                    <Text style={styles.supportHint}>
                      If suitability is disputed: {fabricPolicy.disagreementRule}
                    </Text>
                  ) : null}
                </SupportDisclosure>
              ) : null}
            </View>
          )}

          {materialIssue ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Material issue</Text>
              <View style={[styles.supportCard, materialIssueOpen && styles.supportCardWarning]}>
                {materialIssueReasonLabel ? (
                  <SummaryLine label="Issue" value={materialIssueReasonLabel} />
                ) : null}
                {materialIssue.note ? (
                  <Text style={styles.supportBodyText}>{materialIssue.note}</Text>
                ) : null}
                {materialIssueNeedsResponse ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Your decision is needed before cutting
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>
                      Choose how you want to handle the fabric issue so the order can move forward
                      cleanly.
                    </Text>
                    <Button
                      label="Respond to fabric issue"
                      onPress={() => setShowMaterialIssueResponse(true)}
                    />
                  </>
                ) : materialIssueCancellationRequested ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Cancellation request sent for review
                      </Text>
                    </View>
                    {materialIssueResponseLabel ? (
                      <Text style={styles.supportHint}>
                        Your response: {materialIssueResponseLabel}.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    {materialIssueResponseLabel ? (
                      <SummaryLine label="Your response" value={materialIssueResponseLabel} />
                    ) : null}
                    {materialIssue.responseNote ? (
                      <Text style={styles.supportHint}>{materialIssue.responseNote}</Text>
                    ) : null}
                    {materialIssue.status === 'RESOLVED' ? (
                      <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                        <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                          Material issue resolved
                        </Text>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </View>
          ) : null}

          {closedMaterialAdvances.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Material advance</Text>
              {closedMaterialAdvances.map((advance) => {
                const amountLabel = formatAmount(
                  advance.amount,
                  advance.currency,
                  advance.currency,
                  STATIC_FALLBACK_RATES
                )
                const needsDecision = advance.status === 'REQUESTED'
                const needsPayment = advance.status === 'PAYMENT_PENDING' || advance.status === 'PAYMENT_FAILED'
                const reconciliationCopy = materialReconciliationCopy({ outcome: advance.reconciliationOutcome, resolution: advance.reconciliationResolution, customerRefundAmount: advance.customerRefundAmount, unapprovedOverageAmount: advance.unapprovedOverageAmount, actorRole: 'CUSTOMER' })
                return (
                  <View
                    key={advance.id}
                    style={[styles.supportCard, (needsDecision || needsPayment || advance.status === 'BLOCKED') && styles.supportCardWarning]}
                  >
                    <View style={styles.disclosureHeader}>
                      <View style={styles.disclosureCopy}>
                        <Text style={styles.supportCardTitle}>{advance.title}</Text>
                        <Text style={styles.supportHint}>
                          {formatMaterialAdvanceStatusLabel(advance.status, 'customer')}
                        </Text>
                      </View>
                      <Text style={styles.disclosureAction}>{amountLabel}</Text>
                    </View>
                    <Text style={styles.supportBodyText}>{advance.description}</Text>
                    <Text style={styles.supportHint}>
                      This is separate from the main escrow. Drapeon only releases the approved material amount after payment and ops review.
                    </Text>
                    {advance.estimateStorageBucket && advance.estimateStoragePath ? (
                      <Button label="View proof" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'estimate') }} />
                    ) : (
                      <View style={styles.materialProofMissing}>
                        <Text style={styles.materialProofMissingTitle}>Supplier proof unavailable</Text>
                        <Text style={styles.supportHint}>This request cannot be approved without an estimate or supplier photo.</Text>
                      </View>
                    )}
                    {advance.customerResponseReason ? (
                      <Text style={styles.supportHint}>Decision reason: {materialAdvanceDeclineReasonLabel(advance.customerResponseReason) ?? 'Not specified'}</Text>
                    ) : null}
                    {advance.customerResponseNote ? (
                      <Text style={styles.supportHint}>Your note: {advance.customerResponseNote}</Text>
                    ) : null}
                    {advance.receiptStoragePath ? (
                      <Button label="View final receipt" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'receipt') }} />
                    ) : null}
                    {advance.acquiredStoragePath ? (
                      <Button label="View acquired fabric" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'acquired') }} />
                    ) : null}
                    {reconciliationCopy ? (
                      <View style={[styles.supportStatusBadge, reconciliationCopy.tone === 'success' ? styles.supportStatusSuccess : styles.supportStatusWarning]} accessibilityRole="summary">
                        <Text style={[styles.supportStatusText, reconciliationCopy.tone === 'success' ? styles.supportStatusTextSuccess : styles.supportStatusTextWarning]}>{reconciliationCopy.title}</Text>
                        <Text style={styles.supportHint}>{reconciliationCopy.body}</Text>
                        {advance.customerRefundAmount > 0 ? <Text style={styles.supportStatusText}>Refund value: {formatAmount(advance.customerRefundAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                        {advance.unapprovedOverageAmount > 0 ? <Text style={styles.supportStatusText}>Unapproved overage: {formatAmount(advance.unapprovedOverageAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                      </View>
                    ) : null}
                    {needsDecision ? (
                      <View style={styles.inlineActions}>
                        <Button
                          label="Approve"
                          onPress={() => respondToMaterialAdvance(advance, 'APPROVE')}
                          loading={respondingAdvanceId === advance.id}
                          disabled={!!respondingAdvanceId || !advance.estimateStorageBucket || !advance.estimateStoragePath}
                        />
                        <Button
                          label="Decline"
                          variant="secondary"
                          onPress={() => openMaterialAdvanceDecline(advance)}
                          disabled={!!respondingAdvanceId}
                        />
                      </View>
                    ) : needsPayment ? (
                      <Button
                        label={advance.status === 'PAYMENT_FAILED' ? 'Retry payment' : 'Pay material advance'}
                        onPress={() => payMaterialAdvance(advance)}
                        loading={payingAdvanceId === advance.id}
                        disabled={!!payingAdvanceId}
                      />
                    ) : null}
                  </View>
                )
              })}
            </View>
          ) : null}

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Aftercare</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Fit or finish issue?</Text>
                <Text style={styles.supportHint}>
                  Raise obvious fit or finish issues within 14 days. If you spot a credible
                  workmanship issue later, tell support as early as possible and ideally within 30
                  days. Keep photos, tailoring notes, and any local alteration receipts in Drapeon.
                </Text>
                <Text style={styles.supportHint}>{aftercareStatus.message}</Text>
                <Button
                  label={
                    aftercareStatus.available ? 'Log aftercare issue in Drapeon' : 'Contact support'
                  }
                  onPress={() => {
                    if (aftercareStatus.available) {
                      setShowAftercareSupport(true)
                      return
                    }
                    void contactSupport('aftercare')
                  }}
                />
              </View>
            </View>
          )}

          {/* Review CTA — terminal stages without a review yet */}
          {['COMPLETE', 'DELIVERED', 'COLLECTED'].includes(order.stage) && !hasReview && (
            <TouchableOpacity
              style={styles.reviewCta}
              onPress={() =>
                router.push({
                  pathname: '/(customer)/review/[orderId]',
                  params: {
                    orderId: order.id,
                    historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                  },
                })
              }
              activeOpacity={0.85}
            >
              <View style={styles.reviewCtaInner}>
                <Text style={styles.reviewCtaTitle}>
                  {order.stage === 'COMPLETE' ? 'Leave a review' : 'Finish this order'}
                </Text>
                <Text style={styles.reviewCtaHint}>
                  {order.stage === 'COMPLETE'
                    ? `Share how it went with ${order.tailorName.split(' ')[0]}`
                    : 'Review is optional on the next screen.'}
                </Text>
              </View>
              <Text style={styles.reviewCtaArrow}>
                {order.stage === 'COMPLETE' ? '★  Rate' : 'Finish →'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.section}>
            <SupportDisclosure
              title={briefDossier.title}
              summary="Summary, style refs, fabric plan, measurements, fulfillment, bulk details, and proof."
              defaultExpanded={false}
            >
              <View style={styles.dossierList}>
                {briefDossier.sections.map((section) => (
                  <BriefDossierCard
                    key={section.id}
                    section={section}
                    onOpenLink={openDossierLink}
                    onOpenMedia={openMediaPreview}
                    defaultExpanded={false}
                  />
                ))}
              </View>
            </SupportDisclosure>
          </View>

          {order.orderKind === 'READY_MADE' && (
            <View style={styles.section}>
              <SupportDisclosure
                title="Purchase details"
                summary={readyMadePurchaseSummary ?? 'Item, fulfillment, and payment details.'}
                defaultExpanded={false}
              >
                <View style={styles.timelineContent}>
                {order.itemTitle ? <SummaryLine label="Item" value={order.itemTitle} /> : null}
                {order.itemSize ? <SummaryLine label="Size" value={order.itemSize} /> : null}
                <SummaryLine label="Quantity" value={`${order.itemQuantity}`} />
                {order.fulfillmentOption ? (
                  <SummaryLine
                    label="Fulfillment"
                    value={fulfillmentOptionLabel(order.fulfillmentOption, order.deliveryMethod)}
                  />
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.recipientName ? (
                  <SummaryLine label="Recipient" value={order.recipientName} />
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.recipientPhone ? (
                  <SummaryLine
                    label="Recipient phone"
                    value={
                      safeOperationalText(order.recipientPhone, 'Phone saved in Drapeon') ??
                      'Phone saved in Drapeon'
                    }
                  />
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.deliveryAddress ? (
                  <SummaryLine
                    label={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Deliver to' : 'Ship to'}
                    value={order.deliveryAddress}
                  />
                ) : null}
                <SummaryLine
                  label={order.orderKind === 'READY_MADE' ? 'Item subtotal' : 'Quote amount'}
                  value={formatAmount(
                    order.subtotalAmount,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                />
                <SummaryLine
                  label={fulfillmentFeeLabel(order)}
                  value={
                    order.shippingAmount > 0
                      ? formatAmount(
                          order.shippingAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )
                      : 'Free'
                  }
                />
                <SummaryLine
                  label={taxLabelForOrder(order)}
                  value={formatAmount(
                    order.taxAmount,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                />
                {order.totalAmount > 0 ? (
                  <SummaryLine
                    label="Total"
                    value={formatAmount(
                      order.totalAmount,
                      order.quotedCurrency,
                      order.quotedCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  />
                ) : order.quotedAmount != null ? (
                  <SummaryLine
                    label="Total"
                    value={formatAmount(
                      order.quotedAmount,
                      order.quotedCurrency,
                      order.quotedCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  />
                ) : null}
                {order.taxFallback ? (
                  <Text style={styles.helperText}>
                    Tax was estimated because live tax lookup was unavailable for this delivery
                    address.
                  </Text>
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
                  <Text style={styles.helperText}>
                    This includes Drapeon's standard{' '}
                    {order.deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} fee.
                    Carrier surcharges, customs, or import duties are never charged automatically;
                    Drapeon will ask you to approve anything extra before dispatch.
                  </Text>
                ) : null}
                </View>
              </SupportDisclosure>
            </View>
          )}

          <SupportDisclosure
            title="Order history"
            summary={orderHistorySummary({
              updateCount: order.stageUpdates.length + 1,
              lastUpdatedLabel: formatTimelineTimestamp(latestHistoryUpdate?.createdAt ?? order.createdAt),
              latestEventLabel: latestHistoryUpdate
                ? historyUpdateLabel(latestHistoryUpdate, true)
                : 'Order submitted',
            })}
            defaultExpanded={false}
          >
            <Text style={styles.supportHint}>
              Milestones, notes, and evidence stay together here. Tap any photo or video to view it full screen.
            </Text>
            <View style={styles.timeline}>
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: Colors.needleGreen }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineStage}>Order submitted</Text>
                  <Text style={styles.timelineDate}>
                    {formatTimelineTimestamp(order.createdAt)}
                  </Text>
                </View>
              </View>
              {order.stageUpdates.map((u) => (
                <View key={u.id} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: timelineDotColor(u) }]} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>
                      {historyUpdateLabel(u)}
                    </Text>
                    {u.note && (
                      <Text style={styles.timelineNote}>{formatOrderUpdateNote(u.note)}</Text>
                    )}
                    {u.photoUrl ? (() => {
                      const mediaIndex = timelineMediaItems.findIndex((item) => item.uri === u.photoUrl)
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${historyUpdateLabel(u)} evidence`}
                          accessibilityHint="Opens the order evidence gallery full screen"
                          activeOpacity={0.88}
                          onPress={() => openMediaPreview(timelineMediaItems, Math.max(0, mediaIndex))}
                        >
                          <StageMediaPreview
                            uri={u.photoUrl}
                            style={styles.timelinePhoto}
                            surface="customer_order_timeline_photo"
                            accessibilityLabel="Order timeline proof"
                          />
                        </TouchableOpacity>
                      )
                    })() : null}
                    <Text style={styles.timelineDate}>{formatTimelineTimestamp(u.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
            {timelineMosaicItems.length > 0 ? (
              <View style={{ gap: Spacing.sm }}>
                <Text style={styles.supportCardTitle}>All production evidence</Text>
                <DrapeMediaMosaic
                  items={timelineMosaicItems}
                  compact
                  onPressItem={(_, index) => openMediaPreview(timelineMediaItems, index)}
                  testID="customer-order-history-media"
                />
              </View>
            ) : null}
          </SupportDisclosure>

          <OpsRefundStatusCard orderId={order.id} actorRole="CUSTOMER" />
          {order.stage !== 'COMPLETE' ? (
            <ReturnResolutionCard
              orderId={order.id}
              actorRole="CUSTOMER"
              currency={order.quotedCurrency}
              allowOpen={['DELIVERED', 'COLLECTED'].includes(order.stage)}
              onChanged={fetchOrder}
            />
          ) : null}
          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) ? <OrderTipCard orderId={order.id} actorRole="CUSTOMER" currency={order.quotedCurrency} onChanged={fetchOrder} /> : null}
          {order.stage !== 'COMPLETE' ? <CommercialAdjustmentCard orderId={order.id} actorRole="CUSTOMER" onChanged={fetchOrder} /> : null}

          {(!deliveryReviewOpen && canRequestDeliveryReview) ||
          (!cancellationReviewOpen && showCancellationPolicyCard) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Help &amp; order options</Text>
              {!deliveryReviewOpen && canRequestDeliveryReview ? (
                <SupportDisclosure
                  title="Shipping & delivery help"
                  summary="Tracking, custody, damage, customs, or delivery support"
                  defaultExpanded={false}
                >
                  <Text style={styles.supportHint}>
                    Available after payment, including after completion. Report tracking, custody,
                    recipient, customs, damage, missing contents, or delivery problems here.
                  </Text>
                  <Button
                    label="Get shipping or delivery help"
                    variant="secondary"
                    onPress={() => setShowDeliveryReview(true)}
                  />
                </SupportDisclosure>
              ) : null}
              {!cancellationReviewOpen && showCancellationPolicyCard ? (
                <SupportDisclosure
                  title={cancellationCardTitle}
                  summary={canSelfCancelOrder ? 'Stop this order before the next step.' : 'Policy and reviewed cancellation options'}
                  defaultExpanded={false}
                >
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                  {canSelfCancelOrder ? (
                    <Button
                      label="Cancel this order"
                      variant="secondary"
                      onPress={() => { void cancelOrderDirectly() }}
                    />
                  ) : canRequestCancellationReview ? (
                    <Button
                      label="Request cancellation review"
                      variant="secondary"
                      onPress={() => setShowCancellationReview(true)}
                    />
                  ) : null}
                </SupportDisclosure>
              ) : null}
            </View>
          ) : null}

          {[
            'CONFIRMED',
            'DESIGNING',
            'SOURCING',
            'CUTTING',
            'SEWING',
            'FINISHING',
            'OUT_FOR_DELIVERY',
            'SHIPPED',
            'READY_FOR_COLLECTION',
          ].includes(order.stage) && (
            <TouchableOpacity style={styles.disputeEntry} onPress={() => setShowDispute(true)}>
              <Text style={styles.disputeEntryText}>Something wrong? Raise a concern</Text>
            </TouchableOpacity>
          )}
          {order.stage === 'IN_DISPUTE' && (
            <TouchableOpacity
              style={styles.disputeEntry}
              onPress={() => {
                void contactSupport()
              }}
            >
              <Text style={styles.disputeEntryText}>Need help with this concern? Contact support</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {showDispute ? (
        <DisputeModal
          key={`dispute-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowDispute(false)}
          onSubmitted={() => {
            setShowDispute(false)
            fetchOrder()
          }}
        />
      ) : null}

      {showCancellationReview ? (
        <CancellationReviewModal
          key={`cancellation-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowCancellationReview(false)}
          onSubmitted={() => {
            setShowCancellationReview(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showDeliveryReview ? (
        <DeliveryReviewModal
          key={`delivery-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowDeliveryReview(false)}
          onSubmitted={() => {
            setShowDeliveryReview(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showAftercareSupport ? (
        <AftercareSupportModal
          key={`aftercare-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowAftercareSupport(false)}
          onSubmitted={() => {
            setShowAftercareSupport(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showMaterialIssueResponse ? (
        <MaterialIssueResponseModal
          key={`material-response-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowMaterialIssueResponse(false)}
          onSubmitted={() => {
            setShowMaterialIssueResponse(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showScopeChange ? (
        <ScopeChangeModal
          key={`scope-change-${order.id}`}
          visible
          orderId={order.id}
          currency={order.quotedCurrency}
          onClose={() => setShowScopeChange(false)}
          onSubmitted={() => {
            setShowScopeChange(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showEmergencySupport ? (
        <EmergencySupportModal
          key={`emergency-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowEmergencySupport(false)}
          onSubmitted={() => {
            setShowEmergencySupport(false)
            void fetchOrder()
          }}
        />
      ) : null}

      <DrapeSheet
        visible={showCompletionPrompt}
        title={order.deliveryMethod === 'LOCAL_COLLECTION' ? 'Pickup complete' : 'Delivered — how did it go?'}
        subtitle="Rate the order or send an optional thank-you. You can do either one now."
        onDismiss={() => setShowCompletionPrompt(false)}
        scrollable
        snapPoints={['82%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: 'Rate this order',
          tone: 'primary',
          onPress: () => {
            setShowCompletionPrompt(false)
            router.push({
              pathname: '/(customer)/review/[orderId]',
              params: {
                orderId: order.id,
                historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
              },
            })
          },
        }}
        secondaryAction={{
          label: 'Maybe later',
          tone: 'secondary',
          onPress: () => setShowCompletionPrompt(false),
        }}
        testID="order-completion-prompt"
      >
        <OrderTipCard
          orderId={order.id}
          actorRole="CUSTOMER"
          currency={order.quotedCurrency}
          onChanged={fetchOrder}
        />
      </DrapeSheet>

      <DrapeMediaViewer
        items={mediaPreview?.items ?? []}
        activeIndex={mediaPreview?.index ?? null}
        onDismiss={() => setMediaPreview(null)}
        testID="order-dossier-media-viewer"
      />

      <DrapeSheet
        visible={showStyleChangeFeedback}
        title="Requested style clarification"
        subtitle="Your feedback"
        onDismiss={() => setShowStyleChangeFeedback(false)}
        scrollable
        snapPoints={['44%']}
        enableDynamicSizing={false}
      >
        <Text style={styles.decisionFeedbackBody}>
          {decodeDisplayText(styleChangeFeedback?.feedback ?? '')}
        </Text>
      </DrapeSheet>

      <DrapeSheet
        visible={!!decliningAdvance}
        title="Decline material request"
        subtitle={decliningAdvance ? `${decliningAdvance.title} · Tell the tailor what should happen next.` : undefined}
        onDismiss={() => setDecliningAdvance(null)}
        scrollable
        snapPoints={['72%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: respondingAdvanceId === decliningAdvance?.id ? 'Declining...' : 'Decline request',
          onPress: submitMaterialAdvanceDecline,
          loading: respondingAdvanceId === decliningAdvance?.id,
          disabled: !!respondingAdvanceId,
          tone: 'destructive',
        }}
        secondaryAction={{
          label: 'Cancel',
          onPress: () => setDecliningAdvance(null),
          disabled: !!respondingAdvanceId,
          tone: 'secondary',
        }}
      >
        <View>
          <Text style={disputeStyles.label}>Why are you declining?</Text>
          {MATERIAL_ADVANCE_DECLINE_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason}
              accessibilityRole="radio"
              accessibilityState={{ selected: materialAdvanceDeclineReason === reason }}
              style={[
                disputeStyles.reasonRow,
                materialAdvanceDeclineReason === reason && disputeStyles.reasonRowActive,
              ]}
              disabled={!!respondingAdvanceId}
              onPress={() => setMaterialAdvanceDeclineReason(reason)}
            >
              <View style={[
                disputeStyles.radio,
                materialAdvanceDeclineReason === reason && disputeStyles.radioActive,
              ]} />
              <Text style={[
                disputeStyles.reasonText,
                materialAdvanceDeclineReason === reason && disputeStyles.reasonTextActive,
              ]}>
                {MATERIAL_ADVANCE_DECLINE_REASON_LABELS[reason]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Input
          label={materialAdvanceDeclineReason === 'OTHER' ? 'Explanation *' : 'Note (optional)'}
          placeholder="Add useful context for the tailor."
          value={materialAdvanceDeclineNote}
          onChangeText={setMaterialAdvanceDeclineNote}
          multiline
          maxLength={300}
        />
      </DrapeSheet>

      <HandoffSupportModal
        visible={showHandoffSupport}
        orderId={order.id}
        role="CUSTOMER"
        deliveryMethod={order.deliveryMethod}
        onClose={() => setShowHandoffSupport(false)}
        onSubmitted={() => {
          setShowHandoffSupport(false)
          void fetchOrder()
        }}
      />
      {showConsultationReschedule && order ? (
        <ConsultationRescheduleModal
          visible
          orderId={order.id}
          counterpartName={order.tailorName}
          onClose={() => setShowConsultationReschedule(false)}
          onSent={() => {
            setShowConsultationReschedule(false)
            setConsultationReschedulePending(true)
            Alert.alert('New time sent', `Your current time stays booked until ${order.tailorName.split(' ')[0]} accepts the replacement.`)
            void fetchOrder({ silent: true })
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLineLabel}>{label}</Text>
      <Text style={styles.summaryLineValue}>{decodeDisplayText(value)}</Text>
    </View>
  )
}

function BriefDossierRowView({
  row,
  onOpenLink,
  onOpenMedia,
}: {
  row: BriefDossierRow
  onOpenLink: (href: string) => void
  onOpenMedia: (items: MediaLightboxItem[], index: number) => void
}) {
  if (row.presentation === 'chips' && row.values?.length) {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.summaryLineLabel}>{row.label}</Text>
        <View style={styles.styleChipRow}>
          {row.values.map((value) => (
            <View key={value} style={styles.styleChip}>
              <Text style={styles.styleChipText}>{decodeDisplayText(value)}</Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  if (row.presentation === 'links' && row.hrefs?.length) {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.summaryLineLabel}>{row.label}</Text>
        {row.hrefs.map((href) => (
          <TouchableOpacity
            key={href}
            onPress={() => void onOpenLink(href)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${decodeDisplayText(href)}`}
          >
            <Text style={styles.dossierLinkText}>{decodeDisplayText(href)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  if (row.presentation === 'media' && row.mediaUrls?.length) {
    const mediaItems = dossierMediaItems(row.label, row.mediaUrls)
    const mosaicItems: DrapeMediaMosaicItem[] = mediaItems.map((item, index) => ({
      id: `${item.uri}-${index}`,
      uri: item.uri,
      kind: item.kind ?? 'photo',
      label: `Open ${item.label}`,
      bucket: item.bucket,
    }))
    return (
      <View style={styles.dossierRowStacked}>
        <View style={styles.dossierRowHeader}>
          <Text style={styles.summaryLineLabel}>{row.label}</Text>
          {row.value ? <Text style={styles.helperText}>{row.value}</Text> : null}
        </View>
        <DrapeMediaMosaic
          items={mosaicItems}
          compact
          testID={`customer-dossier-media-${row.id}`}
          onPressItem={(_item, index) => onOpenMedia(mediaItems, index)}
        />
      </View>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.summaryLineLabel}>{row.label}</Text>
        <Text style={styles.dossierStackedText}>{decodeDisplayText(row.value ?? '')}</Text>
      </View>
    )
  }

  return <SummaryLine label={row.label} value={row.value ?? 'Not set'} />
}

function BriefDossierCard({
  section,
  onOpenLink,
  onOpenMedia,
  defaultExpanded = false,
}: {
  section: BriefDossierSection
  onOpenLink: (href: string) => void
  onOpenMedia: (items: MediaLightboxItem[], index: number) => void
  defaultExpanded?: boolean
}) {
  const rowCount = `${section.rows.length} ${section.rows.length === 1 ? 'detail' : 'details'}`
  const summary = section.summary?.trim()
  return (
    <SupportDisclosure
      title={section.title}
      summary={summary && summary.length <= 84 ? summary : rowCount}
      defaultExpanded={defaultExpanded}
    >
      <View style={styles.supportMetaList}>
        {section.rows.map((row) => (
          <BriefDossierRowView
            key={row.id}
            row={row}
            onOpenLink={onOpenLink}
            onOpenMedia={onOpenMedia}
          />
        ))}
      </View>
    </SupportDisclosure>
  )
}

function SupportDisclosure({
  title,
  summary,
  defaultExpanded,
  children,
}: {
  title: string
  summary: string
  defaultExpanded: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <View style={[styles.supportCard, styles.disclosureCard]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        style={styles.disclosureHeader}
        onPress={() => setExpanded((value) => !value)}
        activeOpacity={0.82}
      >
        <View style={styles.disclosureCopy}>
          <Text style={styles.supportCardTitle}>{title}</Text>
          <Text style={styles.disclosureSummary}>{summary}</Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={Colors.midGrey}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  )
}

function ConsultationRescheduleModal({
  visible,
  orderId,
  counterpartName,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  counterpartName: string
  onClose: () => void
  onSent: () => void
}) {
  const initialTime = useMemo(() => {
    const value = new Date(Date.now() + 90 * 60 * 1000)
    value.setMinutes(Math.ceil(value.getMinutes() / 15) * 15, 0, 0)
    return value
  }, [])
  const [scheduledAt, setScheduledAt] = useState(initialTime)
  const [showPicker, setShowPicker] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (sending) return
    if (scheduledAt.getTime() < Date.now() + 60 * 60 * 1000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })
      Alert.alert(
        'Use the next available time?',
        `That time is too soon. The nearest valid option is ${formatExplicitZonedDateTime(suggestion)}.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Use suggested time', onPress: () => setScheduledAt(suggestion) },
        ],
      )
      return
    }
    setSending(true)
    try {
      const { data, error } = await invokeFunction<{ ok?: boolean }>('consultation-reschedule-action', {
        body: {
          action: 'request',
          orderId,
          proposedStartAt: scheduledAt.toISOString(),
          note: note.trim() || undefined,
        },
      })
      if (error || !data?.ok) {
        throw new Error(error ? await readFunctionErrorMessage(error, 'Could not send the new time.') : 'Could not send the new time.')
      }
      onSent()
    } catch (error) {
      Alert.alert('Could not send new time', await readFunctionErrorMessage(error, 'Try again in a moment.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}><Text style={styles.modalClose}>Cancel</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Propose new time</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Current time stays booked</Text>
              <Text style={styles.supportHint}>{counterpartName.split(' ')[0]} must accept before Drapeon moves the consultation and its reminders.</Text>
            </View>
            <Input
              label="New time"
              value={formatConsultationStart(scheduledAt)}
              onPressIn={() => setShowPicker(true)}
              showSoftInputOnFocus={false}
              required
            />
            {showPicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                minimumDate={recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })}
                onChange={(_, value) => {
                  setShowPicker(Platform.OS === 'ios')
                  if (value) setScheduledAt(value)
                }}
              />
            ) : null}
            <Input
              label="Note (optional)"
              placeholder="Why this time works better"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
            <Button label="Send new time" onPress={() => { void send() }} loading={sending} disabled={sending} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function CustomerConsultationRequestModal({
  visible,
  orderId,
  tailorName,
  tailorUserId,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  tailorName: string
  tailorUserId: string
  onClose: () => void
  onSent: () => void
}) {
  const [scheduledAt, setScheduledAt] = useState<Date>(defaultConsultationStart())
  const [minimumStartAt] = useState<Date>(defaultConsultationStart())
  const [showPicker, setShowPicker] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [callPolicy, setCallPolicy] = useState<'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'>('VIDEO')
  const [callType, setCallType] = useState<'AUDIO' | 'VIDEO'>('VIDEO')

  useEffect(() => {
    if (!visible || !tailorUserId) return
    let active = true
    void supabase
      .from('tailor_profiles')
      .select('consultation_call_type')
      .eq('user_id', tailorUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        const nextPolicy = data?.consultation_call_type === 'AUDIO' || data?.consultation_call_type === 'AUDIO_OR_VIDEO'
          ? data.consultation_call_type
          : 'VIDEO'
        setCallPolicy(nextPolicy)
        if (nextPolicy !== 'AUDIO_OR_VIDEO') setCallType(nextPolicy)
      })
    return () => { active = false }
  }, [tailorUserId, visible])

  async function send() {
    if (sending) return
    if (scheduledAt.getTime() < Date.now() + 120 * 60 * 1000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
      Alert.alert(
        'Use the next available time?',
        `That time is too soon. The nearest valid option is ${formatExplicitZonedDateTime(suggestion)}.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Use suggested time', onPress: () => setScheduledAt(suggestion) },
        ],
      )
      return
    }

    setSending(true)
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const { data, error } = await invokeFunction('customer-order-action', {
        body: {
          orderId,
          action: 'request-consultation',
          scheduledStartAt: scheduledAt.toISOString(),
          callType,
          timezone,
          note: note.trim() || undefined,
        },
      })

      if (error || !data?.ok) {
        const message = error
          ? await readFunctionErrorMessage(error, 'Could not request consultation right now.')
          : 'Could not request consultation right now.'
        throw new Error(message)
      }

      onSent()
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your requested time stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not request consultation right now.')
      Alert.alert('Consultation unavailable', message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Request consultation</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>
                Consultation with {tailorName.split(' ')[0]}
              </Text>
              <Text style={styles.supportHint}>
                The tailor has 48 hours to respond. You will see any fee before payment.
              </Text>
            </View>
            {callPolicy === 'AUDIO_OR_VIDEO' ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Call type</Text>
                <View style={styles.consultationCallChoices}>
                  {(['AUDIO', 'VIDEO'] as const).map((value) => (
                    <TouchableOpacity
                      key={value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: callType === value }}
                      style={[styles.consultationCallChoice, callType === value && styles.consultationCallChoiceActive]}
                      onPress={() => setCallType(value)}
                    >
                      <Feather name={value === 'AUDIO' ? 'phone' : 'video'} size={18} color={Colors.needleGreenDark} />
                      <Text style={styles.consultationCallChoiceText}>{value === 'AUDIO' ? 'Audio' : 'Video'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>{callType === 'AUDIO' ? 'Audio consultation' : 'Video consultation'}</Text>
                <Text style={styles.supportHint}>This is the call type offered by the tailor.</Text>
              </View>
            )}
            <Input
              label="Preferred time"
              value={formatConsultationStart(scheduledAt)}
              onPressIn={() => setShowPicker(true)}
              showSoftInputOnFocus={false}
              hint="Pick a time at least 2 hours from now."
              required
            />
            {showPicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                minimumDate={minimumStartAt}
                onChange={(_, value) => {
                  setShowPicker(Platform.OS === 'ios')
                  if (value) setScheduledAt(value)
                }}
              />
            ) : null}
            <Input
              label="What do you want to cover? (optional)"
              placeholder="e.g. Fit, fabric choice, deadline, or styling direction."
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
            <Button label="Send request" onPress={send} loading={sending} disabled={sending} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Dispute Modal ────────────────────────────────────────────────────────────

// V1.1 TODO: extract to locale strings for i18n
const MATERIAL_ISSUE_RESPONSE_OPTIONS: MaterialIssueResponse[] = [
  'REPLACE_FABRIC',
  'ASK_TAILOR_TO_SOURCE',
  'REVISE_DESIGN',
  'CANCEL_ORDER',
]

const CUSTOMER_CANCELLATION_REVIEW_OPTIONS: CancellationReviewReason[] = [
  'CUSTOMER_CHANGED_MIND',
  'NEED_FULFILLMENT_CHANGE',
  'OTHER',
]

const CUSTOMER_DELIVERY_REVIEW_OPTIONS: DeliveryReviewReason[] = [
  'TRACKING_STALLED',
  'SIGNIFICANT_DELAY',
  'NOT_RECEIVED',
  'WRONG_ADDRESS_OR_RECIPIENT',
  'DAMAGED_IN_TRANSIT',
  'MISSING_CONTENTS',
  'RETURNED_TO_DRAPEON',
  'CUSTOMS_OR_CARRIER_CHARGE',
  'RECIPIENT_CONTACT_PROBLEM',
  'OTHER',
]

const SCOPE_CHANGE_TYPE_OPTIONS: ScopeChangeType[] = [
  'MEASUREMENT_AMENDMENT',
  'STYLE_OR_REFERENCE',
  'FABRIC_OR_MATERIAL',
  'DEADLINE_OR_EVENT',
  'PAUSE_OR_RESTART',
  'REWORK_OR_ALTERATION',
  'ADD_OR_REMOVE_ITEM',
  'OTHER',
]

const SCOPE_CHANGE_IMPACT_OPTIONS: ScopeChangeImpact[] = [
  'FIT',
  'STYLE',
  'FABRIC',
  'DEADLINE',
  'PRICE',
  'FULFILLMENT',
]

function ScopeChangeModal({
  visible,
  orderId,
  currency,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  currency: CurrencyCode
  onClose: () => void
  onSubmitted: () => void
}) {
  const [type, setType] = useState<ScopeChangeType | null>(null)
  const [impacts, setImpacts] = useState<ScopeChangeImpact[]>([])
  const [summary, setSummary] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [proposedDeadline, setProposedDeadline] = useState<Date | null>(null)
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false)
  const [deadlinePickerMinimum] = useState(() => new Date())
  const [deadlinePickerDefault] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function toggleImpact(value: ScopeChangeImpact) {
    setImpacts((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  function validateSummary(value: string) {
    if (value.trim().length < 10) {
      setSummaryError('Describe what needs to change so the tailor has a clear record.')
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setSummaryError(result.userMessage)
      return false
    }
    setSummaryError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!type) {
      Alert.alert('Choose a change type', 'Tell Drapeon what kind of change this is before sending it.')
      return
    }
    if (!validateSummary(summary)) return

    const adjustmentType = customerCommercialAdjustmentTypeForScope(type)
    if ((type === 'DEADLINE_OR_EVENT' || type === 'PAUSE_OR_RESTART') && !proposedDeadline) {
      Alert.alert('Choose the requested deadline', 'Record the exact date and time so your tailor can make a clear decision.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    const { error } = await invokeFunction('commercial-adjustment-action', {
      body: {
        action: 'propose',
        orderId,
        type: adjustmentType,
        summary: summary.trim(),
        reason: impacts.length > 0 ? `${summary.trim()} Affects: ${impacts.map((impact) => SCOPE_CHANGE_IMPACT_LABELS[impact]).join(', ')}.` : summary.trim(),
        responsibility: 'UNRESOLVED',
        amountDelta: 0,
        currency,
        proposedDeadline: proposedDeadline?.toISOString() ?? null,
        evidenceIds: [],
        idempotencyKey: `mobile-customer:${orderId}:${Date.now()}`,
      },
    })
    setSubmitting(false)

    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_scope_change', orderId, type, impacts },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your change stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not send this change request right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    onSubmitted()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Request change</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Use this before the next production step when measurements, style, fabric, deadline, or scope need to change. Price or deadline changes stay on record inside Drapeon.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Change type <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    type === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setType(option)}
                >
                  <View style={[disputeStyles.radio, type === option && disputeStyles.radioActive]} />
                  <Text style={[disputeStyles.reasonText, type === option && disputeStyles.reasonTextActive]}>
                    {SCOPE_CHANGE_TYPE_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View>
              <Text style={disputeStyles.label}>What could this affect?</Text>
              {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => {
                const active = impacts.includes(option)
                return (
                  <TouchableOpacity
                    key={option}
                    style={[disputeStyles.reasonRow, active && disputeStyles.reasonRowActive]}
                    disabled={submitting}
                    onPress={() => toggleImpact(option)}
                  >
                    <View style={[disputeStyles.radio, active && disputeStyles.radioActive]} />
                    <Text style={[disputeStyles.reasonText, active && disputeStyles.reasonTextActive]}>
                      {SCOPE_CHANGE_IMPACT_LABELS[option]}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Input
              label="What needs to change? *"
              placeholder="e.g. I used old measurements and need the waist updated before cutting starts."
              value={summary}
              onChangeText={(value) => {
                setSummary(value)
                if (summaryError) validateSummary(value)
              }}
              onBlur={() => validateSummary(summary)}
              error={summaryError}
              multiline
              numberOfLines={5}
              maxLength={500}
              filterContact
              required
            />

            {type === 'DEADLINE_OR_EVENT' || type === 'PAUSE_OR_RESTART' ? (
              <View style={{ gap: Spacing.sm }}>
                <Text style={disputeStyles.label}>Exact requested deadline *</Text>
                <Button label={proposedDeadline ? proposedDeadline.toLocaleString() : 'Choose date and time'} variant="secondary" onPress={() => setShowDeadlinePicker(true)} />
                {showDeadlinePicker ? <DateTimePicker value={proposedDeadline ?? deadlinePickerDefault} mode="datetime" minimumDate={deadlinePickerMinimum} onChange={(_event, value) => { setShowDeadlinePicker(false); if (value) setProposedDeadline(value) }} /> : null}
              </View>
            ) : null}

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                If the tailor has already cut fabric, this may affect price, timing, or the remedy Drapeon can approve.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send change request"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !type || summary.trim().length < 10 || !!summaryError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function CancellationReviewModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [reason, setReason] = useState<CancellationReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError(result.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) {
      Alert.alert(
        'Choose a reason',
        'Tell Drapeon why this ready-made order needs review before handoff.'
      )
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-cancellation-review',
        cancellationReason: reason,
        note: note.trim() || undefined,
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_cancellation_review', orderId, reason },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not open cancellation review right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    onSubmitted()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Cancellation review</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Use this before pickup or dispatch starts. Drapeon will pause the handoff and review
                the best remedy with you and the seller.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Reason <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {CUSTOMER_CANCELLATION_REVIEW_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    reason === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setReason(option)}
                >
                  <View
                    style={[disputeStyles.radio, reason === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      reason === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {CANCELLATION_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. I need to switch from delivery to pickup before dispatch is booked."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={4}
              maxLength={300}
              filterContact
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                If dispatch has already been booked or the order is already at pickup handoff, Drapeon
                may need a fuller support review instead of an instant cancellation.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Request review"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function EmergencySupportModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [description, setDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function validateDescription(value: string) {
    if (value.trim().length < 10) {
      setDescriptionError('Tell Drapeon what is urgent and when the garment is needed.')
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setDescriptionError(result.userMessage)
      return false
    }
    setDescriptionError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!validateDescription(description)) return
    setSubmitting(true)
    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-emergency-support',
        description: description.trim(),
      },
    })
    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'request_emergency_support', orderId } })
      Alert.alert(
        'Emergency request not sent',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not send this emergency request right now.'),
      )
      return
    }
    Alert.alert('Drapeon support alerted', 'We opened an urgent ops review and will keep the order thread as the source of truth.')
    onSubmitted()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Emergency help</Text>
            <View style={{ width: 64 }} />
          </View>
          <ScrollView contentContainerStyle={disputeStyles.content}>
            <Text style={disputeStyles.infoText}>
              Use this for event-sensitive issues only: wear date within 24 hours, item cannot be worn, delivery is missing, or a handoff has broken down.
            </Text>
            <Input
              label="What happened?"
              value={description}
              onChangeText={(value) => {
                setDescription(value)
                if (descriptionError) validateDescription(value)
              }}
              placeholder="Example: My wedding is tomorrow morning and the zipper broke during pickup inspection."
              multiline
              numberOfLines={5}
              error={descriptionError}
              hint="Enter at least 10 characters so support can act without asking you to repeat the issue."
              filterContact
              required
            />
            <Button
              label="Alert Drapeon support"
              variant="danger"
              onPress={submit}
              loading={submitting}
              disabled={submitting || description.trim().length < 10 || !!descriptionError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function DeliveryReviewModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [reason, setReason] = useState<DeliveryReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError(result.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) {
      Alert.alert('Choose a reason', 'Tell Drapeon what went wrong with dispatch or delivery.')
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-delivery-review',
        deliveryReason: reason,
        note: note.trim() || undefined,
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_delivery_review', orderId, reason },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your delivery review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not open delivery review right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    onSubmitted()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Shipping &amp; delivery help</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Tell Drapeon what happened. Routine follow-up stays open without stopping the order;
                high-risk custody, damage, missing-content, or non-delivery reports pause protected steps for review.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Reason <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {CUSTOMER_DELIVERY_REVIEW_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    reason === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setReason(option)}
                >
                  <View
                    style={[disputeStyles.radio, reason === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      reason === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {DELIVERY_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. The tracking says delivered, but nothing reached my address."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={4}
              maxLength={300}
              filterContact
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Keep dispatch, courier, or proof details inside Drapeon while the review is open so
                support can follow one clean record.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send to Drapeon"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function AftercareSupportModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [issueType, setIssueType] = useState<AftercareSupportType | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('Please describe the issue so Drapeon can review it.')
      return false
    }
    if (value.trim().length < 10) {
      setNoteError('Add a little more detail so Drapeon can understand the issue.')
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError(result.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!issueType) {
      Alert.alert(
        'Choose an issue type',
        'Tell Drapeon what kind of aftercare help you need before sending this request.'
      )
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-aftercare-support',
        aftercareType: issueType,
        note: note.trim(),
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_aftercare_support', orderId, issueType },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your aftercare request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not send this aftercare request right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    Alert.alert(
      'Aftercare issue logged',
      'Drapeon can now follow this from the order timeline and ops workflow.'
    )
    onSubmitted()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Aftercare help</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Keep fit, finish, and workmanship follow-up inside Drapeon so support and ops can
                review one clean timeline.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Issue type <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {AFTERCARE_SUPPORT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    issueType === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setIssueType(option)}
                >
                  <View
                    style={[disputeStyles.radio, issueType === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      issueType === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {AFTERCARE_SUPPORT_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="What happened? *"
              placeholder="Describe the fit, finish, or workmanship issue and tell Drapeon what you need help with."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={5}
              maxLength={400}
              filterContact
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Add photos and any alteration notes in the live order thread too, so Drapeon can
                follow the full aftercare record.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send to Drapeon support"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !issueType}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function MaterialIssueResponseModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [response, setResponse] = useState<MaterialIssueResponse | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const res = filterContactInfo(value)
    if (res.blocked) {
      setNoteError(res.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!response) {
      Alert.alert(
        'Choose a response',
        'Please tell your tailor how you want to handle this fabric issue.'
      )
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'respond-material-issue',
        materialIssueResponse: response,
        note: note.trim() || undefined,
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'respond_material_issue', orderId, response },
      })
      if (isLikelyConnectivityIssue(error)) {
        setSubmitError(
          'Your connection looks weak. This response draft stayed here, so retry when the signal improves.'
        )
        return
      }
      const payload = await readFunctionErrorPayload(error)
      const code = typeof payload?.code === 'string' ? payload.code : null
      const payloadMessage =
        typeof payload?.message === 'string' && payload.message.trim().length > 0
          ? payload.message.trim()
          : typeof payload?.error === 'string' &&
              payload.error.trim().length > 0 &&
              !isMachineErrorCodeMessage(payload.error.trim())
            ? payload.error.trim()
            : null
      if (code === 'THREATENING_LANGUAGE') {
        const message = payloadMessage ?? "That note can't be submitted yet."
        setNoteError(message)
        setSubmitError(message)
        return
      }
      const message = await readFunctionErrorMessage(
        error,
        'Could not save your response right now. Please try again.'
      )
      setSubmitError(message)
      if (code === 'UNAUTHORIZED') {
        Alert.alert('Session expired', message)
      }
      return
    }

    onSubmitted()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Handle fabric issue</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Keep this response inside Drapeon so the order timeline stays clear if support needs
                to step in later.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Your choice <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {MATERIAL_ISSUE_RESPONSE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    response === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setResponse(option)}
                >
                  <View
                    style={[disputeStyles.radio, response === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      response === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {MATERIAL_ISSUE_RESPONSE_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for your tailor. e.g. I can replace the fabric on Saturday."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={4}
              maxLength={300}
              filterContact
            />

            {response === 'CANCEL_ORDER' ? (
              <View style={disputeStyles.warningCard}>
                <Text style={disputeStyles.warningText}>
                  Cancelling here sends a request for review. The order does not disappear instantly
                  if work or fabric decisions already happened.
                </Text>
              </View>
            ) : null}

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send response"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !response}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function DisputeModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [reason, setReason] = useState<CustomerConcernReason | null>(null)
  const [requestedOutcome, setRequestedOutcome] = useState<FinancialCaseRequestedOutcome | null>(null)
  const [description, setDescription] = useState('')
  const [descError, setDescError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function readPayloadString(payload: Record<string, unknown> | null, key: string) {
    const value = payload?.[key]
    if (typeof value !== 'string' || value.trim().length === 0) return null
    const trimmed = value.trim()
    return key === 'code' || !isMachineErrorCodeMessage(trimmed) ? trimmed : null
  }

  async function resolveConcernFailure(error: Error | null) {
    const payload = error ? await readFunctionErrorPayload(error) : null
    const code = readPayloadString(payload, 'code')
    const payloadMessage =
      readPayloadString(payload, 'message') ?? readPayloadString(payload, 'error')

    if (code === 'UNAUTHORIZED') {
      return {
        message: payloadMessage ?? 'Please sign in again before raising a concern.',
        descMessage: '',
        showAlert: true,
      }
    }

    if (code === 'THREATENING_LANGUAGE') {
      return {
        message: payloadMessage ?? "That concern description can't be submitted yet.",
        descMessage: payloadMessage ?? "That concern description can't be submitted yet.",
        showAlert: false,
      }
    }

    if (code === 'RATE_LIMITED') {
      return {
        message:
          payloadMessage ??
          'Too many concern attempts right now. Please wait a moment before trying again.',
        descMessage: '',
        showAlert: true,
      }
    }

    if (code === 'DISPUTE_REASON_REQUIRED' || code === 'DISPUTE_DESCRIPTION_REQUIRED' || code === 'DISPUTE_OUTCOME_REQUIRED') {
      return {
        message: payloadMessage ?? 'Please finish the concern details before submitting.',
        descMessage:
          code === 'DISPUTE_DESCRIPTION_REQUIRED'
            ? (payloadMessage ?? 'Please describe what happened before submitting this concern.')
            : '',
        showAlert: false,
      }
    }

    if (isLikelyConnectivityIssue(error)) {
      return {
        message:
          'Your connection looks weak. Your concern draft is still here, so retry when the signal improves.',
        descMessage: '',
        showAlert: false,
      }
    }

    return {
      message: await readFunctionErrorMessage(error, 'Could not submit concern. Please try again.'),
      descMessage: '',
      showAlert: true,
    }
  }

  function validateDesc(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) {
      setDescError(res.userMessage)
      return false
    }
    setDescError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) {
      Alert.alert('Select a reason', 'Please pick a reason for your concern.')
      return
    }
    if (!requestedOutcome) {
      Alert.alert('Choose an outcome', 'Tell us what outcome would help so the review has a clear starting point.')
      return
    }
    if (!description.trim()) {
      Alert.alert('Add details', 'Please describe the issue.')
      return
    }
    if (!validateDesc(description)) return

    setSubmitError('')
    setSubmitting(true)

    const { error } = await invokeFunction('customer-order-action', {
      body: { orderId, action: 'open-dispute', reason, requestedOutcome, description: description.trim() },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'open_dispute', orderId } })
      const failure = await resolveConcernFailure(error)
      if (failure.descMessage) setDescError(failure.descMessage)
      setSubmitError(failure.message)
      if (failure.showAlert) {
        Alert.alert(
          failure.message.includes('sign in again') ? 'Session expired' : 'Concern unavailable',
          failure.message
        )
      }
      return
    }
    onSubmitted()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Raise a concern</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Our team will review your concern within 72 hours. Keep messaging your tailor in the
                meantime, and include dates, delivery or fit details, and what outcome you need.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Reason <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {CUSTOMER_CONCERN_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[disputeStyles.reasonRow, reason === r && disputeStyles.reasonRowActive]}
                  disabled={submitting}
                  onPress={() => setReason(r)}
                >
                  <View style={[disputeStyles.radio, reason === r && disputeStyles.radioActive]} />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      reason === r && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {CUSTOMER_CONCERN_REASON_LABELS[r]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View>
              <Text style={disputeStyles.label}>
                What outcome would help? <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {FINANCIAL_CASE_REQUESTED_OUTCOMES.map((outcome) => (
                <TouchableOpacity
                  key={outcome}
                  style={[disputeStyles.reasonRow, requestedOutcome === outcome && disputeStyles.reasonRowActive]}
                  disabled={submitting}
                  onPress={() => setRequestedOutcome(outcome)}
                >
                  <View style={[disputeStyles.radio, requestedOutcome === outcome && disputeStyles.radioActive]} />
                  <Text style={[disputeStyles.reasonText, requestedOutcome === outcome && disputeStyles.reasonTextActive]}>
                    {FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS[outcome]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {reason && evidencePromptsForConcern(reason).length > 0 ? (
              <View style={disputeStyles.infoCard}>
                <Text style={disputeStyles.infoText}>
                  Helpful evidence: {evidencePromptsForConcern(reason).map((prompt) => prompt.label).join(' · ')}. You can add it securely in the order thread after submitting.
                </Text>
              </View>
            ) : null}

            <Input
              label="Describe the issue"
              placeholder="What happened? Be as specific as possible. Include dates, what was promised, and what you received."
              value={description}
              onChangeText={(v) => {
                setDescription(v)
                if (descError) validateDesc(v)
              }}
              onBlur={() => validateDesc(description)}
              error={descError}
              multiline
              numberOfLines={5}
              maxLength={2000}
              filterContact
              required
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Raising a concern pauses the order. Payment stays protected inside Drapeon until the
                concern is resolved, so keep all updates and evidence here.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Submit concern"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !reason || !requestedOutcome || !description.trim()}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const disputeStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  cancel: {
    color: Colors.needleGreenDark,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    width: 60,
  },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  infoCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
  },
  infoText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginBottom: Spacing.md,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    marginBottom: Spacing.sm,
  },
  reasonRowActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRustLight },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  radioActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRust },
  reasonText: { fontSize: FontSize.sm, color: Colors.inkLight },
  reasonTextActive: { color: Colors.kanteRust, fontWeight: FontWeight.medium },
  warningCard: {
    backgroundColor: Colors.kanteRustLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '35',
  },
  warningText: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  submitErrorCard: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error + '35',
  },
  submitErrorText: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 18 },
})

// ─── Quote Review Screen ──────────────────────────────────────────────────────

function QuoteReviewScreen({
  order,
  onAction,
  router,
  customerEmail,
  preferredTab,
  returnTarget,
  historyChain,
  initialAction,
}: {
  order: OrderDetail
  onAction: () => Promise<void>
  router: ReturnType<typeof useRouter>
  customerEmail?: string
  preferredTab?: string
  returnTarget?: string
  historyChain?: string
  initialAction?: string
}) {
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [revisionSheetVisible, setRevisionSheetVisible] = useState(false)
  const [revisionSaving, setRevisionSaving] = useState(false)
  const [revisionReasons, setRevisionReasons] = useState<QuoteRevisionReason[]>([])
  const [revisionNote, setRevisionNote] = useState('')
  const [revisionTargetAmount, setRevisionTargetAmount] = useState('')
  const [revisionError, setRevisionError] = useState('')
  const [openRevision, setOpenRevision] = useState<OpenQuoteRevision | null>(null)
  const [actionSheetVisible, setActionSheetVisible] = useState(false)
  const [benefitReservation, setBenefitReservation] = useState<CommercialBenefitReservation | null>(null)
  const initialActionHandledRef = useRef(false)
  const onActionRef = useRef(onAction)
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { currency: accountCurrency } = useCurrency()
  const navigation = useNavigation()
  const { startOrderPayment } = useOrderPaymentFlow()
  const orderCurrency = order.quotedCurrency
  const orderReturnTab = preferredTab === 'completed' ? 'completed' : 'active'
  const currentOrderReturnTarget = `/(customer)/orders/${order.id}`
  const currentOrderHistoryChain = appendToHistory(historyChain, currentOrderReturnTarget)
  const negotiationAvailable =
    QUOTE_NEGOTIATION_UI_ENABLED && !!order.activeQuoteId && !!order.activeQuoteVersion

  const conversationActions = deriveOrderConversationActions({
    role: 'CUSTOMER',
    orderKind: order.orderKind,
    stage: order.stage,
    activeQuote: order.activeQuoteId && order.activeQuoteVersion
      ? { id: order.activeQuoteId, version: order.activeQuoteVersion, status: 'ACTIVE' }
      : null,
    openRevision: openRevision
      ? { id: openRevision.id, status: 'OPEN', roundNumber: openRevision.roundNumber }
      : null,
    negotiationRoundsUsed: order.negotiationRoundsUsed,
    negotiationRoundLimit: order.negotiationRoundLimit,
  })

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  const goBack = useCallback(() => {
    goBackOrReturnTo(
      router,
      navigation,
      returnTarget,
      {
        pathname: '/(customer)/orders',
        params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
      },
    )
  }, [navigation, preferredTab, returnTarget, router])

  const fetchOpenRevision = useCallback(async () => {
    if (!QUOTE_NEGOTIATION_UI_ENABLED || !order.activeQuoteId) {
      setOpenRevision(null)
      return
    }

    const { data, error } = await supabase
      .from('quote_revision_requests')
      .select('id, round_number, reason_codes, note, target_amount, currency')
      .eq('order_id', order.id)
      .eq('source_quote_id', order.activeQuoteId)
      .eq('status', 'OPEN')
      .maybeSingle()

    if (error || !data) {
      setOpenRevision(null)
      return
    }

    const next = {
      id: data.id as string,
      roundNumber: Number(data.round_number) || 1,
      reasonCodes: (Array.isArray(data.reason_codes) ? data.reason_codes : []) as QuoteRevisionReason[],
      note: typeof data.note === 'string' ? data.note : '',
      targetAmount: typeof data.target_amount === 'number' ? data.target_amount : null,
      currency: typeof data.currency === 'string' ? data.currency : order.quotedCurrency,
    }
    setOpenRevision(next)
  }, [order.activeQuoteId, order.id, order.quotedCurrency])

  useEffect(() => {
    void fetchOpenRevision()
  }, [fetchOpenRevision])

  useFocusEffect(
    useCallback(() => {
      const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack()
        return true
      })
      const refresh = () => {
        void Promise.all([onActionRef.current(), fetchOpenRevision()])
      }
      refresh()
      const poll = setInterval(refresh, 15_000)

      return () => {
        backSubscription.remove()
        clearInterval(poll)
      }
    }, [fetchOpenRevision, goBack]),
  )

  useEffect(() => {
    if (initialActionHandledRef.current || !negotiationAvailable) return
    if (initialAction !== 'REQUEST_QUOTE_CHANGES' && initialAction !== 'EDIT_QUOTE_CHANGE_REQUEST') return
    if (initialAction === 'EDIT_QUOTE_CHANGE_REQUEST' && !openRevision) return
    initialActionHandledRef.current = true
    openRevisionEditor()
  }, [initialAction, openRevision])

  function openRevisionEditor() {
    setRevisionReasons(openRevision?.reasonCodes ?? [])
    setRevisionNote(openRevision?.note ?? '')
    setRevisionTargetAmount(moneyInputFromMinorUnits(openRevision?.targetAmount))
    setRevisionError('')
    setRevisionSheetVisible(true)
  }

  function toggleRevisionReason(reason: QuoteRevisionReason) {
    setRevisionReasons((current) => current.includes(reason)
      ? current.filter((item) => item !== reason)
      : [...current, reason].slice(0, 4))
  }

  async function saveRevisionRequest() {
    if (!order.activeQuoteId || !order.activeQuoteVersion) {
      setRevisionError('Refresh this order before requesting quote changes.')
      return
    }
    if (revisionReasons.length === 0) {
      setRevisionError('Choose at least one part of the quote that needs attention.')
      return
    }
    if (revisionNote.trim().length < 10) {
      setRevisionError('Explain the change you need in at least 10 characters.')
      return
    }

    const targetAmount = minorUnitsFromInput(revisionTargetAmount)
    if (targetAmount == null) {
      setRevisionError('Enter a valid target amount or leave it blank.')
      return
    }

    setRevisionSaving(true)
    setRevisionError('')
    const action = openRevision ? 'edit-quote-revision' : 'request-quote-revision'
    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId: order.id,
        action,
        quoteId: order.activeQuoteId,
        expectedQuoteVersion: order.activeQuoteVersion,
        revisionRequestId: openRevision?.id,
        quoteRevisionReasons: revisionReasons,
        quoteRevisionNote: revisionNote.trim(),
        quoteTargetAmount: targetAmount > 0 ? targetAmount : undefined,
      },
    })
    setRevisionSaving(false)

    if (error) {
      setRevisionError(await readFunctionErrorMessage(error, 'Could not save this quote change request right now.'))
      return
    }

    setRevisionSheetVisible(false)
    await Promise.all([onAction(), fetchOpenRevision()])
  }

  function withdrawRevisionRequest() {
    if (!openRevision || !order.activeQuoteId || !order.activeQuoteVersion || revisionSaving) return
    Alert.alert(
      'Withdraw change request?',
      'The current quote will become actionable again. This round will not count because the tailor has not responded.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setRevisionSaving(true)
            const { error } = await invokeFunction('customer-order-action', {
              body: {
                orderId: order.id,
                action: 'withdraw-quote-revision',
                quoteId: order.activeQuoteId,
                expectedQuoteVersion: order.activeQuoteVersion,
                revisionRequestId: openRevision.id,
              },
            })
            setRevisionSaving(false)
            if (error) {
              Alert.alert('Could not withdraw request', await readFunctionErrorMessage(error, 'Please try again in a moment.'))
              return
            }
            setRevisionSheetVisible(false)
            await Promise.all([onAction(), fetchOpenRevision()])
          },
        },
      ],
    )
  }

  function replaceCurrentOrder() {
    router.replace({
      pathname: '/(customer)/orders/[id]',
      params: {
        id: order.id,
        tab: orderReturnTab,
        returnTo: returnTarget ?? currentOrderReturnTarget,
        historyChain: currentOrderHistoryChain,
      },
    })
  }
  const payableAmount = benefitReservation?.customer_due_amount ?? order.quotedAmount
  const totalLabel = payableAmount != null
    ? formatAmount(payableAmount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)
    : 'Not available'
  const feeLabel =
    order.fulfillmentFee > 0
      ? formatAmount(order.fulfillmentFee, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)
      : null
  const accountCurrencyNote =
    accountCurrency === orderCurrency
      ? `This order is locked in ${orderCurrency}.`
      : `This order stays locked in ${orderCurrency}, even though your account default is now ${accountCurrency}.`
  const paymentRouteCopy = paymentRouteCopyForCurrency(orderCurrency)
  const consultationMeta = order.supportMeta.consultation ?? null
  const quoteBreakdown = order.supportMeta.quoteBreakdown ?? null
  const consultationCredit = typeof quoteBreakdown?.consultationCreditAmount === 'number'
    ? Math.max(quoteBreakdown.consultationCreditAmount, 0)
    : 0
  const quoteTaxNeedsRefresh = taxSnapshotNeedsRefresh(order)
  const quoteTaxLines = taxLinesForSnapshot({
    taxRegion: order.taxRegion,
    taxRateBps: order.taxRateBps,
    taxAmount: Math.max(order.taxAmount - order.importTaxAmount - order.dutyAmount, 0),
  })
  const hasFundedFabricAllocation = typeof quoteBreakdown?.tailoringAmount === 'number'
    && typeof quoteBreakdown?.fabricAllowanceAmount === 'number'
  const hasDetailedQuoteBreakdown = Boolean(
    quoteBreakdown &&
      (hasFundedFabricAllocation ||
        typeof quoteBreakdown.laborAmount === 'number' ||
        typeof quoteBreakdown.sourcingAmount === 'number' ||
        typeof quoteBreakdown.rushAmount === 'number' ||
        quoteBreakdown.summary ||
        quoteBreakdown.included?.length ||
        quoteBreakdown.excluded?.length)
  )
  // Find the quote from stage updates or a separate quote field
  // The tailor's quote note is in the QUOTE_SENT stage update
  const quoteUpdate = order.stageUpdates.find((u) => u.stage === 'QUOTE_SENT')

  async function accept() {
    if (accepting || declining) return
    if (quoteTaxNeedsRefresh) {
      Alert.alert(
        'Updated tax needed',
        `${order.tailorName} needs to refresh this quote before you can pay. Your tailoring and fabric prices stay visible; only the outdated tax snapshot must be replaced.`,
      )
      return
    }
    if (openRevision) {
      Alert.alert('Quote changes still open', 'Edit or withdraw your change request before accepting this quote.')
      return
    }
    Alert.alert(
      'Accept and pay',
      feeLabel
        ? `Accept the quote from ${order.tailorName}? You will pay the full total of ${totalLabel} now, including the ${fulfillmentFeeLabel(order).toLowerCase()} of ${feeLabel}.\n\n${paymentRouteCopy ?? 'You’ll be taken to secure payment now.'}\n\nProduction starts after payment succeeds.`
        : `Pay ${totalLabel} for ${order.tailorName}’s quote?\n\n${paymentRouteCopy ?? 'You’ll be taken to secure payment now.'}\n\nStandard dispatch is already reflected here when it applies. Extra delivery or shipping payments should only appear later for rush or exception handling.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            if (accepting || declining) return
            setAccepting(true)
            try {
              const result = await startOrderPayment({
                orderId: order.id,
                customerEmail,
                quoteId: order.activeQuoteId,
                expectedQuoteVersion: order.activeQuoteVersion,
              })
              await onAction()

              if (!result.ok) {
                if (result.reason === 'cancelled') {
                  Alert.alert(
                    'Payment not finished',
                    'Your quote is still saved. Finish payment from the order screen any time.'
                  )
                  replaceCurrentOrder()
                  return
                }

                if (result.stage === 'PAYMENT_FAILED') {
                  Alert.alert(
                    'Payment failed',
                    `${result.message}\n\nRetry from the order screen within 2 hours to keep this quote alive.`
                  )
                  replaceCurrentOrder()
                  return
                }

                Sentry.captureException(new Error(result.message), {
                  extra: {
                    context: 'accept_quote_payment',
                    orderId: order.id,
                    reason: result.reason,
                  },
                })
                Alert.alert('Payment unavailable', result.message)
                return
              }

              replaceCurrentOrder()
            } catch (error) {
              Sentry.captureException(error, {
                extra: { context: 'accept_quote_payment_unhandled', orderId: order.id },
              })
              Alert.alert(
                'Payment unavailable',
                isLikelyConnectivityIssue(error)
                  ? 'Connection looks weak. Your card has not been charged. Retry payment from this order when the signal improves.'
                  : 'Something went wrong before payment could finish. Your card has not been charged. Please try again.'
              )
            } finally {
              setAccepting(false)
            }
          },
        },
      ]
    )
  }

  async function decline() {
    if (declining || accepting) return
    Alert.alert('Decline quote', 'Decline this quote? The order will be closed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          if (declining || accepting) return
          setDeclining(true)
          const { error } = await invokeFunction('customer-order-action', {
            body: {
              orderId: order.id,
              action: 'decline-quote',
              quoteId: order.activeQuoteId ?? undefined,
              expectedQuoteVersion: order.activeQuoteVersion ?? undefined,
            },
          })
          setDeclining(false)
          if (error) {
            const message = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not decline this quote yet. Retry when the signal improves.'
              : await readFunctionErrorMessage(
                  error,
                  'Could not decline this quote right now. Please try again in a moment.'
                )
            Alert.alert('Could not decline quote', message)
            return
          }
          await purgeTerminalOrderClientState({
            orderId: order.id,
            sellerItemId: order.sellerItemId,
          })
          router.replace({
            pathname: '/(customer)/orders',
            params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
          })
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 280 }}
        {...capsuleNavScroll}
      >
        <View style={styles.content}>
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>
              Quote from {order.tailorName} · #{order.reference}
            </Text>
          </View>

          {negotiationAvailable ? (
            <DrapeInlineActionCard
              eyebrow={conversationActions.revisionRoundsUsed === 0
                ? 'Original quote'
                : `Revision ${conversationActions.revisionRoundsUsed} of ${conversationActions.revisionRoundLimit}`}
              title={openRevision ? 'Changes requested' : 'Review this quote'}
              body={openRevision
                ? `${order.tailorName.split(' ')[0]} is reviewing your requested changes.`
                : conversationActions.revisionLimitReached
                  ? 'Continue in chat, or accept or decline this quote.'
                  : 'Ask questions in chat, or submit a formal change request.'}
              icon="file-text"
            >
              {openRevision ? <DrapeStatusChip label="Awaiting tailor response" tone="warning" /> : null}
            </DrapeInlineActionCard>
          ) : null}

          {/* Quote card */}
          <View
            style={[
              styles.statusCard,
              { borderWidth: 1.5, borderColor: Colors.needleGreen + '40' },
            ]}
            testID="quote-received-card"
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={styles.sectionTitle}>Quote received</Text>
              <Text style={styles.stateEyebrow}>{orderCurrency}</Text>
            </View>

            {hasFundedFabricAllocation ? (
              <>
                <View style={quoteDetailRow}>
                  <Text style={quoteLabel}>Tailoring and construction</Text>
                  <Text style={quoteAmount}>{formatAmount(quoteBreakdown!.tailoringAmount!, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text>
                </View>
                <View style={quoteDetailRow}>
                  <Text style={quoteLabel}>Protected fabric allowance</Text>
                  <Text style={quoteAmount}>{formatAmount(quoteBreakdown!.fabricAllowanceAmount!, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text>
                </View>
                <Text style={styles.quoteFootnote}>The fabric allowance stays protected. Drapeon releases only approved, evidenced fabric costs and returns any unused amount to you.</Text>
              </>
            ) : baseAmount(order) != null && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>
                  {order.orderKind === 'READY_MADE' ? 'Item subtotal' : 'Tailor work and included materials'}
                </Text>
                <Text style={quoteAmount}>
                  {formatAmount(
                    (baseAmount(order) ?? 0) + consultationCredit,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            )}

            {consultationCredit > 0 ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Consultation fee credit</Text>
                <Text style={quoteValue}>−{formatAmount(consultationCredit, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text>
              </View>
            ) : null}

            {order.platformFeeAmount > 0 ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Drapeon service fee</Text>
                <Text style={quoteValue}>{formatAmount(order.platformFeeAmount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text>
              </View>
            ) : null}

            <View style={quoteDetailRow}>
              <Text style={quoteLabel}>Subtotal before tax</Text>
              <Text style={quoteValue}>{formatAmount(order.subtotalAmount + order.platformFeeAmount + order.shippingAmount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text>
            </View>

            <View style={quoteDetailRow}>
              <Text style={quoteLabel}>{fulfillmentFeeLabel(order)}</Text>
              <Text style={quoteValue}>
                {order.fulfillmentFee > 0
                  ? formatAmount(
                      order.fulfillmentFee,
                      orderCurrency,
                      orderCurrency,
                      STATIC_FALLBACK_RATES
                    )
                  : 'Free'}
              </Text>
            </View>

            {quoteTaxLines.map((line) => (
              <View style={quoteDetailRow} key={line.key}>
                <Text style={quoteLabel}>{order.taxFallback ? `Estimated ${line.label}` : line.label} ({formatTaxRate(line.rateBps)})</Text>
                <Text style={quoteValue}>{formatAmount(line.amount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text>
              </View>
            ))}
            {order.importTaxAmount > 0 ? <View style={quoteDetailRow}><Text style={quoteLabel}>Import tax</Text><Text style={quoteValue}>{formatAmount(order.importTaxAmount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text></View> : null}
            {order.dutyAmount > 0 ? <View style={quoteDetailRow}><Text style={quoteLabel}>Customs duty</Text><Text style={quoteValue}>{formatAmount(order.dutyAmount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}</Text></View> : null}

            {order.quotedAmount != null && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Total due</Text>
                <Text style={quoteAmount}>
                  {formatAmount(
                    order.quotedAmount,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            )}

            {order.taxFallback ? (
              <Text style={styles.quoteFootnote}>
                Tax was estimated because live tax lookup was unavailable for this delivery address.
              </Text>
            ) : null}

            {quoteTaxNeedsRefresh ? (
              <View style={styles.inlineWarningCard}>
                <Text style={styles.inlineWarningTitle}>Tax update required</Text>
                <Text style={styles.inlineWarningBody}>This quote used an older Ghana tax snapshot. It cannot be paid until the tailor refreshes it with the current VAT and statutory levies.</Text>
              </View>
            ) : null}

            {order.consultationFee != null && consultationCredit <= 0 && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Consultation fee</Text>
                <Text style={quoteValue}>
                  {formatAmount(
                    order.consultationFee,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            )}


            {order.quotedCompletionDate && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Est. completion</Text>
                <Text style={quoteValue}>
                  {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              </View>
            )}

            {order.quoteExpiresAt ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Quote valid until</Text>
                <Text style={quoteValue}>{formatExplicitZonedDateTime(order.quoteExpiresAt)}</Text>
              </View>
            ) : null}

          </View>

          {hasDetailedQuoteBreakdown || quoteUpdate?.note ? (
            <SupportDisclosure
              title="Quote details"
              summary={
                hasDetailedQuoteBreakdown && quoteUpdate?.note
                  ? `Breakdown, inclusions, and note from ${order.tailorName.split(' ')[0]}`
                  : hasDetailedQuoteBreakdown
                    ? 'Breakdown and inclusions'
                    : `Note from ${order.tailorName.split(' ')[0]}`
              }
              defaultExpanded={false}
            >
              {hasDetailedQuoteBreakdown && quoteBreakdown ? (
              <View style={{ gap: 6 }}>
                {typeof quoteBreakdown.laborAmount === 'number' ? (
                  <View style={quoteDetailRow}>
                    <Text style={quoteLabel}>Labour</Text>
                    <Text style={quoteValue}>
                      {formatAmount(
                        quoteBreakdown.laborAmount,
                        orderCurrency,
                        orderCurrency,
                        STATIC_FALLBACK_RATES
                      )}
                    </Text>
                  </View>
                ) : null}
                {typeof quoteBreakdown.sourcingAmount === 'number' ? (
                  <View style={quoteDetailRow}>
                    <Text style={quoteLabel}>Sourcing</Text>
                    <Text style={quoteValue}>
                      {formatAmount(
                        quoteBreakdown.sourcingAmount,
                        orderCurrency,
                        orderCurrency,
                        STATIC_FALLBACK_RATES
                      )}
                    </Text>
                  </View>
                ) : null}
                {typeof quoteBreakdown.rushAmount === 'number' ? (
                  <View style={quoteDetailRow}>
                    <Text style={quoteLabel}>Rush fee</Text>
                    <Text style={quoteValue}>
                      {formatAmount(
                        quoteBreakdown.rushAmount,
                        orderCurrency,
                        orderCurrency,
                        STATIC_FALLBACK_RATES
                      )}
                    </Text>
                  </View>
                ) : null}
                {quoteBreakdown.fabricAllowanceCoverage?.length ? (
                  <Text style={styles.escrowNoteText}>Fabric allowance covers: {quoteBreakdown.fabricAllowanceCoverage.map((item) => item.toLowerCase().replaceAll('_', ' ')).join(', ')}</Text>
                ) : null}
                {quoteBreakdown.fabricSourcingAssumptions ? (
                  <View style={{ gap: 4 }}><Text style={quoteLabel}>Sourcing assumptions</Text><Text style={styles.statusNote}>{quoteBreakdown.fabricSourcingAssumptions}</Text></View>
                ) : null}
                {quoteBreakdown.summary ? (
                  <Text style={styles.statusNote}>{quoteBreakdown.summary}</Text>
                ) : null}
                {quoteBreakdown.included && quoteBreakdown.included.length > 0 ? (
                  <Text style={styles.escrowNoteText}>
                    Included: {quoteBreakdown.included.join(', ')}
                  </Text>
                ) : null}
                {quoteBreakdown.excluded && quoteBreakdown.excluded.length > 0 ? (
                  <Text style={styles.escrowNoteText}>
                    Not included: {quoteBreakdown.excluded.join(', ')}
                  </Text>
                ) : null}
              </View>
            ) : null}

              {quoteUpdate?.note ? (
              <View style={{ gap: 4 }}>
                <Text style={quoteLabel}>Note from {order.tailorName.split(' ')[0]}</Text>
                <Text style={styles.statusNote}>"{quoteUpdate.note}"</Text>
              </View>
              ) : null}
            </SupportDisclosure>
          ) : null}

          <CommercialBenefitsCard
            orderId={order.id}
            currency={orderCurrency}
            variant="checkout"
            onChanged={setBenefitReservation}
          />

          <SupportDisclosure
            title="Payment and currency"
            summary={`${orderCurrency} order · Checkout and payment protection`}
            defaultExpanded={false}
          >
            <Text style={styles.supportBodyText}>{accountCurrencyNote}</Text>
            {paymentRouteCopy ? <Text style={styles.supportBodyText}>{paymentRouteCopy}</Text> : null}
            <Text style={styles.supportBodyText}>
              {consultationMeta?.feeCreditable && order.consultationFee
                ? 'Your consultation fee counts toward this order. Accepting locks the price and target date, and Drapeon holds payment until delivery is confirmed.'
                : 'Accepting locks the price and target date. Drapeon holds payment until delivery is confirmed; raise any problem inside the order.'}
            </Text>
          </SupportDisclosure>
        </View>
      </ScrollView>

      <DrapeFloatingActionDock compactWidth={76} testID="quote-action-dock">
        {(compact) =>
          compact ? (
            <DrapeIconButton
              icon={negotiationAvailable && openRevision ? 'edit-3' : 'lock'}
              accessibilityLabel={
                negotiationAvailable && openRevision
                  ? 'Edit change request'
                  : 'Accept and pay'
              }
              tone="primary"
              onPress={
                negotiationAvailable && openRevision
                  ? openRevisionEditor
                  : accept
              }
              disabled={
                negotiationAvailable && openRevision
                  ? revisionSaving
                  : accepting || declining || !!openRevision
              }
            />
          ) : (
            <DrapeActionBar style={styles.quoteActionBar}>
              {negotiationAvailable && openRevision ? (
                <DrapeCapsuleButton
                  label="Edit change request"
                  icon="edit-3"
                  onPress={openRevisionEditor}
                  disabled={revisionSaving}
                  style={styles.quotePrimaryAction}
                />
              ) : (
                <DrapeCapsuleButton
                  label="Accept and pay"
                  icon="lock"
                  onPress={accept}
                  loading={accepting}
                  disabled={accepting || declining || !!openRevision || quoteTaxNeedsRefresh}
                  style={styles.quotePrimaryAction}
                  testID="quote-accept-btn"
                />
              )}
              <DrapeIconButton
                icon="more-horizontal"
                accessibilityLabel="More quote actions"
                onPress={() => setActionSheetVisible(true)}
                disabled={accepting || declining}
              />
            </DrapeActionBar>
          )
        }
      </DrapeFloatingActionDock>

      <DrapeSheet
        visible={actionSheetVisible}
        title="Quote actions"
        subtitle="Ask a question, request a formal revision, or close this quote."
        onDismiss={() => setActionSheetVisible(false)}
      >
        <View style={styles.quoteSecondaryActions}>
          {negotiationAvailable && !openRevision && !conversationActions.revisionLimitReached ? (
            <DrapeCapsuleButton
              label="Request changes"
              tone="secondary"
              icon="edit-3"
              onPress={() => {
                setActionSheetVisible(false)
                openRevisionEditor()
              }}
              disabled={accepting || declining}
              testID="quote-request-changes-btn"
            />
          ) : null}
          <DrapeCapsuleButton
            label={`Message ${order.tailorName.split(' ')[0]}`}
            tone="secondary"
            icon="message-circle"
            onPress={() => {
              setActionSheetVisible(false)
              router.navigate({
                pathname: '/(customer)/messages/[orderId]',
                params: {
                  orderId: order.id,
                  returnTo: `/(customer)/orders/${order.id}`,
                  historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                },
              })
            }}
          />
          <DrapeCapsuleButton
            label="Decline quote"
            tone="destructive"
            onPress={() => {
              setActionSheetVisible(false)
              void decline()
            }}
            loading={declining}
            disabled={accepting || declining}
          />
        </View>
      </DrapeSheet>

      <DrapeSheet
        visible={revisionSheetVisible}
        testID="quote-revision-sheet"
        title={openRevision ? 'Edit quote changes' : 'Request quote changes'}
        subtitle={`Revision ${openRevision?.roundNumber ?? Math.min(order.negotiationRoundsUsed + 1, order.negotiationRoundLimit)} of ${order.negotiationRoundLimit}. Ordinary chat questions do not use a revision.`}
        onDismiss={() => setRevisionSheetVisible(false)}
        scrollable
        snapPoints={['88%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: openRevision ? 'Save request' : 'Send change request',
          testID: 'quote-revision-submit-btn',
          onPress: () => { void saveRevisionRequest() },
          loading: revisionSaving,
          disabled: revisionSaving,
          tone: 'primary',
        }}
        destructiveAction={openRevision ? {
          label: 'Withdraw request',
          onPress: withdrawRevisionRequest,
          disabled: revisionSaving,
          tone: 'destructive',
        } : undefined}
      >
        <View style={styles.revisionReasonList}>
          <Text style={styles.revisionFieldLabel}>What should change?</Text>
          <View style={styles.revisionReasonGrid}>
            {(Object.keys(QUOTE_REVISION_REASON_LABELS) as QuoteRevisionReason[]).map((reason) => {
              const selected = revisionReasons.includes(reason)
              return (
                <DrapeCapsuleButton
                  key={reason}
                  label={QUOTE_REVISION_REASON_LABELS[reason]}
                  tone={selected ? 'primary' : 'secondary'}
                  compact
                  onPress={() => toggleRevisionReason(reason)}
                  style={styles.revisionReasonButton}
                  accessibilityState={{ selected }}
                  testID={`quote-revision-reason-${reason.toLowerCase()}`}
                />
              )
            })}
          </View>
        </View>
        <Input
          label="Change details"
          value={revisionNote}
          onChangeText={setRevisionNote}
          placeholder="Explain what should change and what outcome would work for you."
          multiline
          maxLength={1200}
          showCharacterCount
          required
          filterContact
          testID="quote-revision-note-input"
        />
        <MoneyInput
          label="Target total"
          value={revisionTargetAmount}
          onChangeText={setRevisionTargetAmount}
          currency={orderCurrency as AccountCurrencyCode}
          hint="This is a request, not a binding price. The tailor must issue a revised quote."
          testID="quote-revision-target-input"
        />
        {revisionError ? <Text style={styles.revisionError} accessibilityRole="alert">{revisionError}</Text> : null}
      </DrapeSheet>
    </SafeAreaView>
  )
}

// Inline StyleSheet objects for QuoteReviewScreen (avoids forward-ref issue)
const quoteDetailRow: import('react-native').ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
}
const quoteLabel: import('react-native').TextStyle = {
  fontSize: 14,
  color: Colors.inkLight,
}
const quoteAmount: import('react-native').TextStyle = {
  fontSize: 22,
  fontWeight: '700',
  color: Colors.needleGreenDark,
}
const quoteValue: import('react-native').TextStyle = {
  fontSize: 14,
  fontWeight: '600',
  color: Colors.ink,
}
const quoteFootnote: import('react-native').TextStyle = {
  fontSize: 12,
  color: Colors.midGrey,
  lineHeight: 18,
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  safe: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backText: { color: Colors.needleGreenDark, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.md },
  quoteActionBar: { paddingHorizontal: 0, paddingVertical: 0, justifyContent: 'center', flexWrap: 'wrap' },
  quotePrimaryAction: { minWidth: 190, flexGrow: 1 },
  quoteSecondaryActions: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  revisionReasonList: { gap: Spacing.sm },
  revisionFieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  revisionReasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  revisionReasonButton: { flexGrow: 0, maxWidth: '100%' },
  revisionError: { fontSize: FontSize.sm, lineHeight: 20, color: Colors.error },
  inlineWarningCard: {
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '35',
    backgroundColor: Colors.kanteRustLight,
  },
  inlineWarningTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.kanteRust },
  inlineWarningBody: { fontSize: FontSize.xs, lineHeight: 18, color: Colors.inkLight },

  heading: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  subheading: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 4 },
  messageAction: {
    minHeight: 48,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  messageActionText: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.semibold,
  },
  completionAction: {
    minHeight: 56,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  completionActionIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  completionActionTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  completionActionBody: { marginTop: 2, fontSize: FontSize.xs, color: Colors.midGrey },
  // Progress bar
  progressBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 0 },
  progressStep: { flex: 1, alignItems: 'center', gap: 4, position: 'relative' },
  progressDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.lightGrey,
  },
  progressDotDone: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  progressDotActive: {
    backgroundColor: Colors.white,
    borderColor: Colors.needleGreen,
    borderWidth: 3,
  },
  progressCheck: { fontSize: 9, color: Colors.textInverse, fontWeight: FontWeight.bold },
  progressLine: {
    position: 'absolute',
    top: 8,
    left: '50%',
    right: '-50%',
    height: 2,
    backgroundColor: Colors.lightGrey,
    zIndex: -1,
  },
  progressLineDone: { backgroundColor: Colors.needleGreen },
  progressLabel: { fontSize: 8, color: Colors.midGrey, textAlign: 'center', lineHeight: 11 },
  progressLabelDone: { color: Colors.needleGreenDark, fontWeight: FontWeight.medium },

  // Status card
  statusCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 10,
    gap: 5,
    ...Shadow.sm,
  },
  statusNote: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontStyle: 'italic',
    lineHeight: 18,
  },

  nextStepsCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
  },
  nextStepsTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreenDark,
    marginBottom: 4,
    fontFamily: Fonts.display,
  },
  nextStepsItem: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  progressPhoto: {
    width: '100%',
    height: 156,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
  },
  statusHelp: { fontSize: 11, color: Colors.inkLight, lineHeight: 17 },
  statusEta: { fontSize: 11, color: Colors.midGrey },

  // Video call card
  videoCallCard: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.needleGreen,
  },
  videoCallTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  consultationFeeText: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  orderTypePill: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  orderTypePillText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  videoCallHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Modal shell
  modalSafe: { flex: 1, backgroundColor: Colors.bone },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  modalClose: {
    color: Colors.needleGreenDark,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    width: 60,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.xl, gap: Spacing.xl },

  // Collection code
  collectionCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.needleGreen + '40',
  },
  collectionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  collectionEyebrow: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.needleGreenDark, letterSpacing: 1.4 },
  collectionHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  codeBox: { flexDirection: 'row', gap: Spacing.md },
  codeDigit: {
    width: 56,
    height: 72,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
  },
  codeDigitText: { fontSize: 32, fontWeight: FontWeight.bold, color: Colors.needleGreenDark },
  collectionInstruction: { fontSize: FontSize.sm, color: Colors.inkLight },
  disputeLink: { fontSize: FontSize.sm, color: Colors.kanteRust, fontWeight: FontWeight.medium },

  // Timeline
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  timeline: { gap: 0, paddingLeft: Spacing.xs },
  timelineItem: { flexDirection: 'row', gap: 9, paddingBottom: 10 },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.needleGreen,
    marginTop: 5,
    flexShrink: 0,
  },
  timelineContent: { flex: 1, gap: 2 },
  timelineStage: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  timelineNote: { fontSize: 11, color: Colors.inkLight, fontStyle: 'italic', lineHeight: 16 },
  timelinePhoto: {
    width: '100%',
    height: 176,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    marginTop: Spacing.xs,
    marginBottom: 2,
    overflow: 'hidden',
  },
  timelineDate: { fontSize: 10, color: Colors.midGrey },

  // Tracking
  trackingRow: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  trackingAction: {
    width: '100%',
  },
  trackingLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  trackingNumber: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreenDark,
  },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryLineLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  summaryLineValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  dossierList: { gap: Spacing.sm },
  dossierRowStacked: { gap: 6 },
  dossierRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  dossierStackedText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 20 },
  dossierLinkText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.needleGreenDark, lineHeight: 20 },
  dossierMediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  dossierMediaTile: { width: '31%', aspectRatio: 1, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.boneDeep },
  dossierMediaImage: { width: '100%', height: '100%' },
  styleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  styleChip: {
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  styleChipText: { fontSize: FontSize.xs, color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  helperText: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },
  quoteFootnote,
  supportCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 10,
    gap: 6,
    ...Shadow.sm,
  },
  disclosureCard: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.boneDeep,
    shadowOpacity: 0,
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  disclosureCopy: { flex: 1, gap: 3 },
  disclosureSummary: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  disclosureAction: {
    color: Colors.needleGreenDark,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  disclosureBody: {
    paddingTop: Spacing.xs,
    gap: 6,
  },
  supportCardTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  supportCardWarning: {
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
  },
  materialDecisionSuccess: {
    borderWidth: 1,
    borderColor: Colors.needleGreen + '40',
    backgroundColor: Colors.needleGreenLight,
  },
  supportMetaList: { gap: 6 },
  supportStatusBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  supportStatusWarning: { backgroundColor: Colors.kanteRustLight },
  supportStatusSuccess: { backgroundColor: Colors.needleGreenLight },
  supportStatusText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  supportStatusTextWarning: { color: Colors.kanteRust },
  supportStatusTextSuccess: { color: Colors.needleGreenDark },
  supportBodyText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  supportWarningText: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  supportHint: { fontSize: 11, color: Colors.midGrey, lineHeight: 17 },
  materialProofMissing: {
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
    backgroundColor: Colors.kanteRustLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  materialProofMissingTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.kanteRust,
  },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center' },
  decisionLink: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '45',
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  decisionLinkText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreenDark },
  decisionFeedbackBody: { fontSize: FontSize.md, lineHeight: 24, color: Colors.ink },
  groupMemberList: { gap: Spacing.sm, marginTop: Spacing.xs },
  groupMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  groupMemberCopy: { flex: 1, gap: 2 },
  groupMemberName: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  groupMemberStatus: { fontSize: FontSize.xs, color: Colors.midGrey },
  groupInviteButton: {
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    paddingVertical: 7,
    paddingHorizontal: Spacing.md,
  },
  groupInviteButtonText: { fontSize: FontSize.xs, color: Colors.textInverse, fontWeight: FontWeight.semibold },
  groupMemberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
  },
  groupMemberBadgeText: { fontSize: FontSize.xs, color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  inlineDecisionCard: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  inlineDecisionTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  measurementConfirmGuideList: { gap: Spacing.xs },
  measurementConfirmGuideCard: {
    borderRadius: Radius.md,
    padding: Spacing.sm,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '35',
  },
  measurementConfirmGuideTitle: {
    fontSize: FontSize.xs,
    color: Colors.kanteRust,
    fontWeight: FontWeight.semibold,
  },
  measurementConfirmGuideText: {
    marginTop: 3,
    fontSize: 11,
    color: Colors.inkLight,
    lineHeight: 16,
  },
  handoffIssueCard: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  handoffIssueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  handoffIssueTitle: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  handoffStatusPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  handoffStatusPillEscalated: {
    backgroundColor: Colors.accentLight,
  },
  handoffStatusText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreenDark,
  },

  // Fabric tracking input
  trackingHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  fabricInputRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  fabricTrackingAction: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.lightGrey,
  },
  fabricInput: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  fabricSaveBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minWidth: 64,
    alignItems: 'center',
  },
  fabricSaveBtnDisabled: { backgroundColor: Colors.lightGrey },
  fabricSaveBtnText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  fabricSavedNote: { fontSize: FontSize.xs, color: Colors.midGrey },
  fabricApprovalCard: {
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    padding: Spacing.sm,
  },
  fabricApprovalImage: {
    width: '100%',
    height: 180,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
  },
  fabricApprovalActions: { gap: Spacing.sm },

  reviewCta: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...Shadow.sm,
    borderWidth: 1,
    borderColor: Colors.statusPending + '40',
  },
  reviewCtaInner: { gap: 3 },
  reviewCtaTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  reviewCtaHint: { fontSize: FontSize.sm, color: Colors.inkLight },
  reviewCtaArrow: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.statusPending,
  },

  messageCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.white,
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingBottom: Spacing.xxl,
  },
  scrollContent: {
    paddingBottom: 480,
  },

  sentBanner: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
  },
  sentBannerText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.medium,
  },

  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  backLink: { color: Colors.needleGreenDark, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  retryBtnText: {
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.sm,
  },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  secondaryBtnText: { color: Colors.ink, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },

  // Pre-production waiting bar
  preProductionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  preProductionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.warning },
  preProductionLabel: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },

  // Dispute entry
  disputeEntry: { alignItems: 'center', paddingTop: Spacing.sm },
  disputeEntryText: {
    fontSize: FontSize.sm,
    color: Colors.kanteRust,
    fontWeight: FontWeight.medium,
  },

  // Quote review extras
  escrowNote: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
  },
  escrowNoteText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  consultationCallChoices: { flexDirection: 'row', gap: Spacing.sm },
  consultationCallChoice: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
  },
  consultationCallChoiceActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  consultationCallChoiceText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
})
