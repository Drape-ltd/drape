import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Linking,
  type ImageStyle, type StyleProp, type ViewStyle,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Feather } from '@expo/vector-icons'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import {
  getFulfillmentStagePreflightError,
  normalizeContactPhoneInput,
  normalizeDispatchReferenceInput,
  normalizeTrackingNumberInput,
  openTrackingPage,
} from '@/lib/shipping'
import { stripExif } from '@/lib/stripExif'
import { createConsultationRoom, openConsultationCallUrl } from '@/lib/consultation'
import { createOrderCallRoom, openDrapeCallUrl } from '@/lib/order-call'
import {
  CANCELLATION_REVIEW_REASON_LABELS,
  CONSULTATION_EXPIRY_POLICY_LABELS,
  CONSULTATION_NO_SHOW_POLICY_LABELS,
  CONSULTATION_PAYMENT_TIMING_LABELS,
  CONSULTATION_RESCHEDULE_POLICY_LABELS,
  COVERAGE_PREFERENCE_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  DISPATCH_SERVICE_LEVEL_LABELS,
  enrichMeasurementSnapshot,
  FABRIC_HANDOFF_LABELS,
  FABRIC_STRETCH_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_INTENT_LABELS,
  getAdditionalMeasurementRows,
  getMeasurementConfirmationFields,
  labelMeasurementField,
  MATERIAL_ISSUE_REASON_LABELS,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  measurementAgeLabel,
  MEASUREMENT_SOURCE_LABELS,
  WEAR_DAY_SUPPORT_LABELS,
  labelFitContextFlag,
  fitProfileNeedsTailorReview,
  hasOpenCancellationReview,
  hasOpenDeliveryReview,
  hasOpenMaterialIssue,
  hasOpenScopeChange,
  parseOrderSupportMeta,
  resolveMeasurementAgeMeta,
  SCOPE_CHANGE_IMPACT_LABELS,
  SCOPE_CHANGE_TYPE_LABELS,
  STALE_MEASUREMENT_MONTHS,
  type CancellationReviewReason,
  type DeliveryReviewReason,
  type MaterialIssueReason,
  type MeasurementSnapshotMeta,
  type OrderSupportMeta,
  type ScopeChangeImpact,
  type ScopeChangeType,
} from '@/lib/order-support'
import {
  isReadyMadePreparationStage,
  tailorOrderStageLabel,
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
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeInlineActionCard,
  DrapeMediaMosaic,
  DrapeMediaViewer,
  DrapeSheet,
  DrapeStatusChip,
  HandoffSupportModal,
  Input,
  PortfolioVideoPreview,
  RemoteImage,
  type DrapeMediaMosaicItem,
  type MediaLightboxItem,
} from '@/components/ui'
import { BottomSheetScaffold } from '@/components/ui/BottomSheetScaffold'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import {
  buildBriefDossier,
  currencySymbol,
  formatConsultationStatusLabel,
  formatMaterialAdvanceStatusLabel,
  formatMeasurementStatusLabel,
  formatScopeChangeStatusLabel,
} from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { QUOTE_REVISION_REASON_LABELS, type QuoteRevisionReason } from '@drape/shared/order-negotiation'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import {
  CANCELLATION_REFUND_COMPONENT_LABELS,
  deriveCancellationPolicy,
} from '@drape/shared/cancellation-policy'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { stageColor } from '@/lib/stageColors'
import { isTerminalOrderStage, purgeTerminalOrderClientState } from '@/lib/order-client-state'
import { hapticSuccess } from '@/lib/haptics'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'

const QUOTE_NEGOTIATION_UI_ENABLED = MOBILE_FEATURE_FLAGS.quoteNegotiationV1

// ─── Types ────────────────────────────────────────────────────────────────────

type Measurement = {
  [key: string]: unknown
  chest: number | null; waist: number | null; hips: number | null
  shoulderWidth: number | null; inseam: number | null; sleeveLength: number | null
  neckCircumference: number | null; height: number | null; unit: string
  backLength?: number | null; outseam?: number | null; thighCircumference?: number | null
  kneeCircumference?: number | null; torsoLength?: number | null
  fitStyle: string | null; garmentContext: string | null; bodyShape: string | string[] | null
  fitFlags: string[]; bodyNote: string | null
} & MeasurementSnapshotMeta

type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
}

type CustomerReviewSummary = {
  count: number
  averageRating: number | null
  tags: string[]
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
  receiptUrl: string | null
  receiptNote: string | null
  createdAt: string
}

const ORDER_DETAIL_POLL_INTERVAL_MS = 60_000

type CustomerProfileJoinRow = {
  display_name: string | null
}

type CustomOrderDetailJoinRow = {
  garment_type_other: string | null
  gender_presentation: string | null
  social_reference_links: unknown
  style_notes: string | null
  body_note: string | null
  fabric_description: string | null
  fabric_budget_amount: number | null
  fabric_budget_currency: string | null
  fabric_sourcing_deadline_days: number | null
  fabric_sourcing_deadline_at: string | null
  fabric_approval_status: string | null
  shipping_preference: string | null
  delivery_instructions: string | null
  target_delivery_date: string | null
}

type TailorOrderDetailQueryRow = {
  id: string
  reference: string
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  fulfillment_option: string | null
  garment_type: string | null
  garment_description: string | null
  item_title: string | null
  item_size: string | null
  item_quantity: number | null
  item_subtotal: number | null
  stage: OrderStage
  customer_id: string
  quoted_amount: number | null
  currency: string | null
  quoted_currency: string | null
  fulfillment_fee: number | null
  source_amount: number | null
  subtotal_amount: number | null
  tax_amount: number | null
  shipping_amount: number | null
  total_amount: number | null
  quoted_completion_date: string | null
  active_quote_id: string | null
  active_quote_version: number | null
  negotiation_round_limit: number | null
  negotiation_rounds_used: number | null
  fulfillment_payment_requested_at: string | null
  fulfillment_payment_paid_at: string | null
  fulfillment_payment_provider: string | null
  fulfillment_payment_intent_id: string | null
  fulfillment_payment_checkout_url: string | null
  fabric_source: string | null
  delivery_method: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_phone: string | null
  tracking_number: string | null
  carrier: string | null
  fulfillment_provider: string | null
  fulfillment_reference: string | null
  fulfillment_contact_name: string | null
  fulfillment_contact_phone: string | null
  reference_photos: unknown
  fit_note: string | null
  customer_measurements_snapshot: unknown
  special_note: string | null
  collection_code: string | null
  video_call_url: string | null
  occasion: string | null
  deadline: string | null
  created_at: string
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
  custom_order_details: CustomOrderDetailJoinRow | CustomOrderDetailJoinRow[] | null
  order_stage_updates: Array<{
    id: string
    stage: string
    note: string | null
    photo_url: string | null
    created_at: string
  }> | null
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

type StageMediaType = 'image' | 'video'

type StageMedia = {
  uri: string
  type: StageMediaType
  fingerprint: string
  duration?: number | null
  fileSize?: number | null
  mimeType?: string | null
}

type OrderDetail = {
  id: string; reference: string; garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'; fulfillmentOption: string | null
  itemTitle: string | null; itemSize: string | null; itemQuantity: number; itemSubtotal: number | null
  fulfillmentFee: number
  garmentDescription: string | null; stage: OrderStage
  customerId: string; customerName: string
  quotedAmount: number | null; quotedCurrency: string; quotedCompletionDate: string | null
  activeQuoteId: string | null; activeQuoteVersion: number | null
  negotiationRoundLimit: number; negotiationRoundsUsed: number
  sourceAmount: number | null; subtotalAmount: number; taxAmount: number; shippingAmount: number; totalAmount: number
  fulfillmentPaymentRequestedAt: string | null
  fulfillmentPaymentPaidAt: string | null
  fulfillmentPaymentProvider: string | null
  fulfillmentPaymentIntentId: string | null
  fulfillmentPaymentCheckoutUrl: string | null
  fabricSource: string; deliveryMethod: string; deliveryAddress: string | null
  recipientName: string | null; recipientPhone: string | null
  trackingNumber: string | null; carrier: string | null
  fulfillmentProvider: string | null
  fulfillmentReference: string | null
  fulfillmentContactName: string | null
  fulfillmentContactPhone: string | null
  referencePhotos: string[]; fitNote: string | null
  measurements: Measurement | null
  supportMeta: OrderSupportMeta
  customDetail: {
    garmentTypeOther: string | null
    genderPresentation: string | null
    socialReferenceLinks: string[]
    styleNotes: string | null
    bodyNote: string | null
    fabricDescription: string | null
    fabricBudgetAmount: number | null
    fabricBudgetCurrency: string | null
    fabricSourcingDeadlineDays: number | null
    fabricSourcingDeadlineAt: string | null
    fabricApprovalStatus: string | null
    shippingPreference: string | null
    deliveryInstructions: string | null
    targetDeliveryDate: string | null
  } | null
  collectionCode: string | null
  videoCallUrl: string | null
  occasion: string | null; deadline: string | null
  createdAt: string
  stageUpdates: StageUpdate[]
}

type OpenTailorQuoteRevision = {
  id: string
  roundNumber: number
  note: string
  reasonCodes: string[]
  targetAmount: number | null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function isVideoUri(uri: string | null | undefined) {
  return typeof uri === 'string' && /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/iu.test(uri)
}

const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo
const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo

function stageMediaFromAsset(asset: ImagePicker.ImagePickerAsset): StageMedia {
  const type: StageMediaType = asset.type === 'video' ? 'video' : 'image'
  const fingerprintParts = [
    asset.assetId,
    asset.fileName,
    asset.fileSize,
    asset.width,
    asset.height,
    asset.duration,
    type,
  ].filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)

  return {
    uri: asset.uri,
    type,
    duration: asset.duration ?? null,
    fileSize: asset.fileSize ?? null,
    mimeType: asset.mimeType ?? null,
    fingerprint: fingerprintParts.length > 0 ? fingerprintParts.join('|') : `${type}|${asset.uri}`,
  }
}

function stageMediaExtension(media: StageMedia) {
  if (media.type === 'image') return 'jpg'
  const match = media.uri.match(/\.([a-z0-9]+)(?:[?#].*)?$/iu)
  const extension = match?.[1]?.toLowerCase()
  if (extension === 'mov') return extension
  return 'mp4'
}

function stageMediaContentType(media: StageMedia) {
  if (media.type === 'image') return 'image/jpeg'
  const normalizedMimeType = media.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalizedMimeType && (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(normalizedMimeType)) {
    return normalizedMimeType
  }
  const extension = stageMediaExtension(media)
  if (extension === 'mov') return 'video/quicktime'
  return 'video/mp4'
}

function stageMediaDurationSeconds(media: StageMedia) {
  if (typeof media.duration !== 'number' || !Number.isFinite(media.duration) || media.duration <= 0) return null
  return media.duration > 1000 ? media.duration / 1000 : media.duration
}

function validateStageMedia(media: StageMedia) {
  if (media.type !== 'video') return null

  const contentType = stageMediaContentType(media)
  if (!(ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return 'That video type is not supported here. Please choose an MP4 or MOV video.'
  }

  if (typeof media.fileSize === 'number' && media.fileSize > ORDER_EVIDENCE_VIDEO_MAX_BYTES) {
    return `Choose videos under ${Math.round(ORDER_EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
  }

  const durationSeconds = stageMediaDurationSeconds(media)
  if (durationSeconds && durationSeconds > ORDER_EVIDENCE_VIDEO_MAX_SECONDS) {
    return OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE
  }

  return null
}

function StageMediaPreview({
  uri,
  mediaType,
  style,
  surface,
}: {
  uri: string
  mediaType?: StageMediaType
  style: StyleProp<ImageStyle>
  surface: string
}) {
  const isVideo = mediaType === 'video' || isVideoUri(uri)
  if (isVideo) {
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
    />
  )
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

function labelShippingPreference(value: string | null | undefined) {
  if (value === 'EXPRESS') return 'Express'
  if (value === 'STANDARD') return 'Standard'
  return null
}

function labelFabricApprovalStatus(value: string | null | undefined) {
  if (value === 'PENDING_TAILOR_UPLOAD') return 'Waiting for sourced fabric upload'
  if (value === 'PENDING_CUSTOMER_APPROVAL') return 'Waiting for customer approval'
  if (value === 'APPROVED') return 'Approved by customer'
  if (value === 'CHANGES_REQUESTED') return 'Customer requested changes'
  if (value === 'UNSUITABLE') return 'Marked unsuitable'
  if (value === 'OPS_REVIEW') return 'Ops review needed'
  return null
}

function linkHostLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./u, '')
  } catch {
    return value
  }
}

function orderStatusGuidance(stage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE'): string | null {
  if (stage === 'CONSULTATION') {
    return 'Use the consultation to clarify fit, fabric, and expectations before you send a quote. You and the customer are next to align on the brief.'
  }
  if (stage === 'QUOTE_SENT') {
    return 'Your quote is with the customer. They are next to accept, decline, or let it expire.'
  }
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE'
      ? 'Checkout is still open. The customer is next to finish payment before fulfilment can start. If they say their bank charged them, ask them not to pay again while Drapeon reconciles it.'
      : 'The customer has started payment. They are next to finish payment before production can start. If they say their bank charged them, ask them not to pay again while Drapeon reconciles it.'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE'
      ? 'Checkout failed. The customer is next to retry within 2 hours before this order is cancelled automatically.'
      : 'Payment failed. The customer is next to retry within 2 hours before this order is cancelled automatically.'
  }
  if (stage === 'CONFIRMED') {
    return orderKind === 'READY_MADE'
      ? 'Payment is confirmed. You are next to start preparing this order for dispatch or pickup.'
      : 'The customer has accepted your quote. You are next to move this order into the first real production stage when work begins.'
  }
  if (orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)) {
    return 'You are still next. Keep packing and checking this order until it is truly ready for Drapeon dispatch or pickup.'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'This order is packed and waiting for Drapeon ops. Drapeon is next to arrange dispatch from here.'
  }
  if (stage === 'DESIGNING') {
    return 'Design details and pattern decisions are underway. You are next to advance when the design is stable enough to source or cut.'
  }
  if (stage === 'SOURCING') {
    return 'Fabric and materials are being sourced for this order. You are next to advance when cutting can begin.'
  }
  if (stage === 'CUTTING') {
    return 'Cutting is underway. You are next to advance when sewing can begin.'
  }
  if (stage === 'SEWING') {
    return 'Sewing is underway. You are next to advance when the garment is ready for finishing.'
  }
  if (stage === 'FINISHING') {
    return orderKind === 'READY_MADE'
      ? 'Final packing and quality checks are underway. When the order is truly handoff-ready, mark it for Drapeon dispatch or collection.'
      : 'Final touches and quality checks are underway. When the order is truly handoff-ready, mark it for Drapeon dispatch or collection.'
  }
  if (stage === 'OUT_FOR_DELIVERY') {
    return 'This order is with a local delivery partner. Drapeon and the customer are next until the handoff is confirmed.'
  }
  if (stage === 'SHIPPED') {
    return 'This order is on its way to the customer. The customer is next once it arrives, unless a delivery issue opens first.'
  }
  if (stage === 'READY_FOR_COLLECTION') {
    return 'The order is ready to hand over. The customer is next at pickup, and you should confirm the collection code when they arrive. Drapeon may follow up if pickup is delayed.'
  }
  if (stage === 'DELIVERED') {
    return 'Delivery is confirmed. The 72-hour customer review window is open, and payout stays protected until it closes.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. The 72-hour customer review window is open, and payout stays protected until it closes.'
  }
  if (stage === 'COMPLETE') {
    return 'This order is complete. You can still revisit the full brief, measurements, and timeline here any time.'
  }
  if (stage === 'IN_DISPUTE') {
    return 'This order is paused while the customer concern is being reviewed.'
  }
  return null
}

function quotedAmountLabel(
  stage: OrderStage,
  orderKind: 'CUSTOM' | 'READY_MADE',
  fulfillmentPaymentPending = false,
): string {
  if (orderKind === 'READY_MADE') {
    if (stage === 'PAYMENT_PENDING') return 'awaiting payment'
    if (stage === 'PAYMENT_FAILED') return 'payment failed'
    if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'review window'
    if (fulfillmentPaymentPending) return 'item paid'
    if (stage === 'COMPLETE') return 'closed out'
    return 'seller amount'
  }
  if (fulfillmentPaymentPending) return 'base quote paid'
  if (stage === 'QUOTE_SENT') return 'quoted'
  if (stage === 'PAYMENT_PENDING') return 'awaiting payment'
  if (stage === 'PAYMENT_FAILED') return 'payment failed'
  if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'awaiting finish'
  if (stage === 'COMPLETE') return 'closed out'
  return 'seller amount'
}

function displayStageChoiceLabel(targetStage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE') {
  if (orderKind === 'READY_MADE' && targetStage === 'FINISHING') return 'Preparing order'
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return 'Ready for Drapeon dispatch'
  return STAGE_LABELS[targetStage]
}

function stageChoiceDetail(targetStage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE') {
  if (orderKind === 'READY_MADE' && targetStage === 'FINISHING') {
    return 'Pack, check, and prepare the item for handoff.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Signal that the packed order is ready for Drapeon-managed dispatch.'
  }
  if (targetStage === 'READY_FOR_COLLECTION') {
    return 'Mark the order ready for customer pickup and code verification.'
  }
  return `Move this order into ${displayStageChoiceLabel(targetStage, orderKind).toLowerCase()} once the real work state has changed.`
}

function refundCoverageLabel(components: string[]) {
  return components.map((component) => CANCELLATION_REFUND_COMPONENT_LABELS[component as keyof typeof CANCELLATION_REFUND_COMPONENT_LABELS]).join(', ')
}

function stageUpdateNotePlaceholder(order: Pick<OrderDetail, 'orderKind' | 'deliveryMethod'>, targetStage: OrderStage) {
  if (order.orderKind === 'READY_MADE') {
    if (targetStage === 'FINISHING') {
      return order.deliveryMethod === 'LOCAL_COLLECTION'
        ? 'e.g. "Packing your order now and setting it aside for pickup."'
        : 'e.g. "Packing your order now and checking it before dispatch."'
    }
    if (targetStage === 'READY_FOR_COLLECTION') {
      return 'e.g. "Your order is packed and ready for pickup. Please bring your collection code when you come."'
    }
    if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
      return 'e.g. "Your order is packed and ready for Drapeon dispatch. We will hand it to Drapeon ops next."'
    }
    if (targetStage === 'OUT_FOR_DELIVERY') {
      return 'e.g. "Your order is packed and a local rider is bringing it to you now."'
    }
    if (targetStage === 'SHIPPED') {
      return 'e.g. "Your order has been packed and handed to the courier today."'
    }
  }

  if (targetStage === 'DESIGNING') {
    return 'e.g. "Finalising the pattern and design details for your order now."'
  }
  if (targetStage === 'SOURCING') {
    return 'e.g. "Sourcing the agreed fabric and materials for your order now."'
  }
  if (targetStage === 'CUTTING') {
    return 'e.g. "Cutting the fabric now using the approved measurements and plan."'
  }
  if (targetStage === 'SEWING') {
    return 'e.g. "The garment is now in sewing and construction."'
  }
  if (targetStage === 'FINISHING') {
    return 'e.g. "Doing final pressing, finishing, and quality checks now."'
  }
  if (targetStage === 'READY_FOR_COLLECTION') {
    return 'e.g. "Your order is finished and ready for pickup. Please bring your collection code when you come."'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'e.g. "Your order is finished, packed, and ready for Drapeon dispatch."'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'e.g. "A local delivery partner now has your order and is on the way."'
  }
  if (targetStage === 'SHIPPED') {
    return 'e.g. "Your order has been finished, packed, and handed to the courier today."'
  }

  return 'e.g. "Sharing a quick update on your order here."'
}

function stageUpdatePhotoHint(order: Pick<OrderDetail, 'orderKind'>, targetStage: OrderStage) {
  if (targetStage === 'SOURCING') {
    return 'Show the sourced fabric or material in natural light. For color-sensitive fabric, place white paper beside it as a reference.'
  }
  if (order.orderKind === 'READY_MADE' && targetStage === 'READY_FOR_COLLECTION') {
    return 'Show the packed order so the customer knows pickup is truly ready.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Show the packed order so Drapeon ops and the customer can trust that dispatch can begin.'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'Show the packed order or rider handoff so the customer can trust this delivery update.'
  }
  if (targetStage === 'SHIPPED') {
    return 'Show the packed handoff or dispatch proof so the customer can trust the shipment update.'
  }
  return 'Use fresh photo or video proof for this exact stage. Keep the garment fully in frame, steady, and well lit. Reused media is blocked.'
}

function stageUpdatePhotoLabel(order: Pick<OrderDetail, 'orderKind'>, targetStage: OrderStage) {
  if (order.orderKind === 'READY_MADE') {
    if (targetStage === 'FINISHING') return 'Packing proof'
    if (targetStage === 'READY_FOR_COLLECTION') return 'Pickup-ready proof'
    if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return 'Packed-order proof'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') return 'Delivery handoff proof'
  if (targetStage === 'SHIPPED') return 'Dispatch proof'
  return 'Progress proof'
}

function stageUpdatePhotoRequiredMessage(order: Pick<OrderDetail, 'orderKind'>, targetStage: OrderStage) {
  if (order.orderKind === 'READY_MADE' && targetStage === 'READY_FOR_COLLECTION') {
    return 'Add fresh pickup-ready proof so the customer can see the packed order before collection.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Add fresh packed-order proof so Drapeon can take over dispatch cleanly.'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'Add fresh delivery handoff proof so the customer can trust that the order is really on the way.'
  }
  if (targetStage === 'SHIPPED') {
    return 'Add fresh dispatch proof so the customer can trust this shipment update.'
  }
  return 'Fresh proof at this stage builds trust. Add a photo or video before updating.'
}

function defaultConsultationStart() {
  const value = new Date()
  value.setDate(value.getDate() + 1)
  value.setMinutes(0, 0, 0)
  return value
}

function formatConsultationStart(value: string | Date | null | undefined) {
  if (!value) return 'Choose a time'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Choose a time'
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTimelineDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
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

function displayText(value: string | null | undefined, fallback = '') {
  const decoded = decodeDisplayText(value ?? '').trim()
  return decoded || fallback
}

function displayNullableText(value: string | null | undefined) {
  const decoded = displayText(value)
  return decoded || null
}

function hasSuccessfulPaymentEvent(updates: StageUpdate[]) {
  return updates.some((update) => {
    const note = update.note?.toLowerCase() ?? ''
    return update.stage === 'CONFIRMED' && note.includes('payment confirmed')
  })
}

function isResolvedCheckoutAttempt(update: Pick<StageUpdate, 'stage' | 'note'>, successfulPaymentExists: boolean) {
  if (!successfulPaymentExists) return false
  const note = update.note?.toLowerCase() ?? ''
  return update.stage === 'PAYMENT_FAILED'
    || update.stage === 'PAYMENT_PENDING'
    || note.includes('checkout started')
    || note.includes('payment started')
}

function timelineStageLabel(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  orderKind: 'CUSTOM' | 'READY_MADE',
  successfulPaymentExists = false
) {
  const note = update.note?.toLowerCase() ?? ''
  if (isResolvedCheckoutAttempt(update, successfulPaymentExists)) {
    return update.stage === 'PAYMENT_FAILED' ? 'Earlier checkout failed' : 'Earlier checkout opened'
  }
  if (update.stage === 'CONFIRMED' && note.includes('payment confirmed')) {
    return 'Payment confirmed'
  }
  if (update.stage === 'CONFIRMED' && (note.includes('guided fit profile') || note.includes('fit intake'))) {
    return 'Measurements reviewed'
  }
  return tailorOrderStageLabel(update.stage as OrderStage, orderKind)
}

function timelineDotColor(update: Pick<StageUpdate, 'stage' | 'note'>, successfulPaymentExists = false) {
  const note = update.note?.toLowerCase() ?? ''
  if (isResolvedCheckoutAttempt(update, successfulPaymentExists)) {
    return Colors.midGrey
  }
  if (update.stage === 'PAYMENT_FAILED' || note.includes('failed') || note.includes('cancel')) {
    return Colors.error
  }
  if (update.stage === 'PAYMENT_PENDING' || note.includes('checkout started') || note.includes('payment started')) {
    return Colors.statusPending
  }
  if (update.stage === 'IN_DISPUTE' || note.includes('concern') || note.includes('review')) {
    return Colors.kanteRust
  }
  return Colors.needleGreen
}

function timelineNoteText(update: Pick<StageUpdate, 'stage' | 'note'>, successfulPaymentExists: boolean) {
  if (isResolvedCheckoutAttempt(update, successfulPaymentExists)) {
    return update.stage === 'PAYMENT_FAILED'
      ? 'An earlier checkout attempt failed, then the customer completed payment successfully.'
      : 'An earlier checkout was opened before the successful payment.'
  }
  return update.note
}

function baseAmount(
  order: Pick<OrderDetail, 'orderKind' | 'itemSubtotal' | 'quotedAmount' | 'fulfillmentFee' | 'sourceAmount' | 'subtotalAmount' | 'taxAmount'>
) {
  if (typeof order.sourceAmount === 'number' && order.sourceAmount > 0) {
    return order.sourceAmount
  }
  if (typeof order.subtotalAmount === 'number' && order.subtotalAmount > 0) {
    return order.subtotalAmount
  }
  if (order.orderKind === 'READY_MADE') {
    return order.itemSubtotal ?? (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee - (order.taxAmount ?? 0), 0)
}

// Linear next stages (one option only)
const PRODUCTION_NEXT: Partial<Record<OrderStage, OrderStage>> = {
  CUTTING: 'SEWING',
  SEWING: 'FINISHING',
}

// Flexible next stages — tailor chooses which pre-production phase to start
const FLEXIBLE_NEXT_STAGES: Partial<Record<OrderStage, OrderStage[]>> = {
  CONFIRMED: ['DESIGNING'],
  DESIGNING: ['SOURCING', 'CUTTING'],
  SOURCING: ['CUTTING'],
}

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

function parseMoneyToMinorUnits(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed * 100)
}

function parseListInput(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
}

const GARMENT_CONTEXT_LABELS: Record<string, string> = {
  MENSWEAR: 'Menswear cuts', WOMENSWEAR: 'Womenswear cuts',
  BOTH: 'Both', PREFER_NOT: 'Prefer not to say', PREFER_NOT_TO_SAY: 'Prefer not to say',
}
const BODY_SHAPE_LABELS: Record<string, string> = {
  RECTANGLE: 'Rectangle', BROAD_SHOULDERS: 'Broad shoulders',
  FULL_HIPS: 'Full hips', DEFINED_WAIST: 'Defined waist',
  FULL_MIDSECTION: 'Full midsection', ATHLETIC: 'Athletic / muscular',
  PREFER_NOT: 'Prefer not to say', PREFER_NOT_TO_SAY: 'Prefer not to say',
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TailorOrderDetailScreen() {
  const { id, returnTo, historyChain, action } = useLocalSearchParams<{
    id: string
    returnTo?: string
    historyChain?: string
    action?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const userId = user?.id ?? null

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'tailor')
  }

  function openOrderMessages() {
    if (!order) return
    router.navigate({
      pathname: '/(tailor)/messages/[orderId]',
      params: {
        orderId: order.id,
        returnTo: `/(tailor)/orders/${order.id}`,
        historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
      },
    })
  }

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      '/(tailor)/orders',
    )
  }

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [quoteModalMode, setQuoteModalMode] = useState<'send' | 'revise'>('send')
  const [openQuoteRevision, setOpenQuoteRevision] = useState<OpenTailorQuoteRevision | null>(null)
  const [showRevisionResponseSheet, setShowRevisionResponseSheet] = useState(false)
  const [revisionResponseSaving, setRevisionResponseSaving] = useState(false)
  const initialActionHandledRef = useRef(false)
  const [showStageModal, setShowStageModal] = useState(false)
  const [stageModalTarget, setStageModalTarget] = useState<OrderStage | null>(null)
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [consultationModalAction, setConsultationModalAction] = useState<'request-consultation' | 'approve-consultation'>('request-consultation')
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [showMeasurementRequestModal, setShowMeasurementRequestModal] = useState(false)
  const [showFitReadinessModal, setShowFitReadinessModal] = useState(false)
  const [showStyleAlignmentModal, setShowStyleAlignmentModal] = useState(false)
  const [showMaterialIssueModal, setShowMaterialIssueModal] = useState(false)
  const [showMaterialAdvanceModal, setShowMaterialAdvanceModal] = useState(false)
  const [showCancellationReviewModal, setShowCancellationReviewModal] = useState(false)
  const [showDeliveryReviewModal, setShowDeliveryReviewModal] = useState(false)
  const [showScopeChangeModal, setShowScopeChangeModal] = useState(false)
  const [showHandoffSupport, setShowHandoffSupport] = useState(false)
  const [showDossierSheet, setShowDossierSheet] = useState(false)
  const [showMeasurementSheet, setShowMeasurementSheet] = useState(false)
  const [showFlexibleStageSheet, setShowFlexibleStageSheet] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null)
  const [startingCall, setStartingCall] = useState<'audio' | 'video' | null>(null)
  const [startingOrderCall, setStartingOrderCall] = useState<'audio' | 'video' | null>(null)
  const [confirmingFabricReceived, setConfirmingFabricReceived] = useState(false)
  const [failedReferencePhotos, setFailedReferencePhotos] = useState<string[]>([])
  const [hasCustomerReview, setHasCustomerReview] = useState(false)
  const [customerReviewSummary, setCustomerReviewSummary] = useState<CustomerReviewSummary | null>(null)
  const [handoffIssue, setHandoffIssue] = useState<HandoffIssue | null>(null)
  const [materialAdvances, setMaterialAdvances] = useState<MaterialAdvance[]>([])
  const [uploadingAdvanceReceiptId, setUploadingAdvanceReceiptId] = useState<string | null>(null)
  const [resolvingHandoffIssue, setResolvingHandoffIssue] = useState(false)
  const purgedTerminalOrderRef = useRef<string | null>(null)

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

  const hasActiveMaterialAdvance = materialAdvances.some((advance) =>
    ['REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW', 'BLOCKED'].includes(advance.status)
  )

  const fetchOrder = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!id || !userId) {
      if (!silent) {
        setLoading(false)
        setFetchErrorMessage('')
        setOrder(null)
        setHasCustomerReview(false)
        setCustomerReviewSummary(null)
        setFailedReferencePhotos([])
        setHandoffIssue(null)
        setMaterialAdvances([])
      }
      return
    }
    if (!silent) {
      setLoading(true)
      setOrder(null)
      setHasCustomerReview(false)
      setCustomerReviewSummary(null)
      setFailedReferencePhotos([])
      setMaterialAdvances([])
    }
    setFetchErrorMessage('')
    try {
      const { data, error } = await supabase
      .from('orders')
      .select(`
        id, reference, order_kind, fulfillment_option, garment_type, garment_description, item_title, item_size, item_quantity, item_subtotal, stage,
        customer_id, quoted_amount, currency, quoted_currency, fulfillment_fee, quoted_completion_date,
        active_quote_id, active_quote_version, negotiation_round_limit, negotiation_rounds_used,
        source_amount, subtotal_amount, tax_amount, shipping_amount, total_amount,
        fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
        fabric_source, delivery_method, delivery_address, recipient_name, recipient_phone, tracking_number, carrier,
        fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos, fit_note,
        customer_measurements_snapshot, special_note, collection_code, video_call_url,
        occasion, deadline, created_at,
        customer_profiles!customer_id(display_name),
        custom_order_details(garment_type_other, gender_presentation, social_reference_links, style_notes, body_note, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, fabric_approval_status, shipping_preference, delivery_instructions, target_delivery_date),
        order_stage_updates(id, stage, note, photo_url, created_at)
      `)
      .eq('id', id)
      .eq('tailor_id', userId)
      .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
      .maybeSingle()

      if (error) throw error

      if (data) {
        const d = data as TailorOrderDetailQueryRow
        const customerProfile = firstJoinedRow(d.customer_profiles)
        const measurementSnapshot =
          d.customer_measurements_snapshot &&
          typeof d.customer_measurements_snapshot === 'object' &&
          !Array.isArray(d.customer_measurements_snapshot)
            ? (d.customer_measurements_snapshot as Record<string, unknown>)
            : null
        const openHandoffIssue = await fetchOpenHandoffIssue(d.id)
        const { data: materialAdvanceRows } = await supabase
          .from('order_material_advances')
          .select('id, title, description, amount, currency, status, release_status, receipt_url, receipt_note, created_at')
          .eq('order_id', d.id)
          .order('created_at', { ascending: false })
        const customDetail = firstJoinedRow(d.custom_order_details)
        const { data: openRevisionRow } = QUOTE_NEGOTIATION_UI_ENABLED && d.active_quote_id
          ? await supabase
              .from('quote_revision_requests')
              .select('id, round_number, note, reason_codes, target_amount')
              .eq('order_id', d.id)
              .eq('source_quote_id', d.active_quote_id)
              .eq('status', 'OPEN')
              .maybeSingle()
          : { data: null }
        setOpenQuoteRevision(openRevisionRow ? {
          id: openRevisionRow.id as string,
          roundNumber: Number(openRevisionRow.round_number) || 1,
          note: typeof openRevisionRow.note === 'string' ? openRevisionRow.note : '',
          reasonCodes: Array.isArray(openRevisionRow.reason_codes)
            ? openRevisionRow.reason_codes.filter((item): item is string => typeof item === 'string')
            : [],
          targetAmount: typeof openRevisionRow.target_amount === 'number' ? openRevisionRow.target_amount : null,
        } : null)
        setMaterialAdvances(
          ((materialAdvanceRows ?? []) as Array<{
            id: string
            title: string | null
            description: string | null
            amount: number | null
            currency: string | null
            status: string | null
            release_status: string | null
            receipt_url: string | null
            receipt_note: string | null
            created_at: string | null
          }>).map((advance) => ({
            id: advance.id,
            title: displayText(advance.title, 'Material advance'),
            description: displayText(advance.description),
            amount: advance.amount ?? 0,
            currency: (advance.currency ?? d.currency ?? d.quoted_currency ?? 'USD') as CurrencyCode,
            status: (advance.status ?? 'REQUESTED') as MaterialAdvanceStatus,
            releaseStatus: advance.release_status ?? null,
            receiptUrl: advance.receipt_url ?? null,
            receiptNote: displayNullableText(advance.receipt_note),
            createdAt: advance.created_at ?? new Date().toISOString(),
          }))
        )
        setOrder({
          id: d.id, reference: d.reference, garmentType: displayText(d.garment_type, 'Order'),
          orderKind: d.order_kind ?? 'CUSTOM', fulfillmentOption: d.fulfillment_option ?? null,
          itemTitle: displayNullableText(d.item_title), itemSize: displayNullableText(d.item_size), itemQuantity: d.item_quantity ?? 1, itemSubtotal: d.item_subtotal ?? null, fulfillmentFee: d.fulfillment_fee ?? 0,
          garmentDescription: displayNullableText(d.garment_description), stage: d.stage,
          customerId: d.customer_id,
          customerName: displayText(customerProfile?.display_name, 'Customer'),
          quotedAmount: d.quoted_amount, quotedCurrency: d.currency ?? d.quoted_currency ?? 'USD', quotedCompletionDate: d.quoted_completion_date,
          activeQuoteId: d.active_quote_id ?? null,
          activeQuoteVersion: d.active_quote_version ?? null,
          negotiationRoundLimit: d.negotiation_round_limit ?? 3,
          negotiationRoundsUsed: d.negotiation_rounds_used ?? 0,
          sourceAmount: d.source_amount ?? null,
          subtotalAmount: d.subtotal_amount ?? d.item_subtotal ?? 0,
          taxAmount: d.tax_amount ?? 0,
          shippingAmount: d.shipping_amount ?? d.fulfillment_fee ?? 0,
          totalAmount: d.total_amount ?? d.quoted_amount ?? 0,
          fulfillmentPaymentRequestedAt: d.fulfillment_payment_requested_at ?? null,
          fulfillmentPaymentPaidAt: d.fulfillment_payment_paid_at ?? null,
          fulfillmentPaymentProvider: d.fulfillment_payment_provider ?? null,
          fulfillmentPaymentIntentId: d.fulfillment_payment_intent_id ?? null,
          fulfillmentPaymentCheckoutUrl: d.fulfillment_payment_checkout_url ?? null,
          fabricSource: d.fabric_source ?? '', deliveryMethod: d.delivery_method ?? '', deliveryAddress: displayNullableText(d.delivery_address),
          recipientName: displayNullableText(d.recipient_name), recipientPhone: d.recipient_phone ?? null,
          trackingNumber: d.tracking_number ?? null, carrier: d.carrier ?? null,
          fulfillmentProvider: displayNullableText(d.fulfillment_provider),
          fulfillmentReference: displayNullableText(d.fulfillment_reference),
          fulfillmentContactName: displayNullableText(d.fulfillment_contact_name),
          fulfillmentContactPhone: d.fulfillment_contact_phone ?? null,
          referencePhotos: asStringList(d.reference_photos),
          fitNote: d.fit_note, measurements: enrichMeasurementSnapshot(measurementSnapshot) as Measurement | null,
          supportMeta: parseOrderSupportMeta(displayText(d.special_note)),
          customDetail: customDetail
            ? {
                garmentTypeOther: displayNullableText(customDetail.garment_type_other),
                genderPresentation: displayNullableText(customDetail.gender_presentation),
                socialReferenceLinks: asStringList(customDetail.social_reference_links),
                styleNotes: displayNullableText(customDetail.style_notes),
                bodyNote: displayNullableText(customDetail.body_note),
                fabricDescription: displayNullableText(customDetail.fabric_description),
                fabricBudgetAmount: customDetail.fabric_budget_amount ?? null,
                fabricBudgetCurrency: customDetail.fabric_budget_currency ?? null,
                fabricSourcingDeadlineDays: customDetail.fabric_sourcing_deadline_days ?? null,
                fabricSourcingDeadlineAt: customDetail.fabric_sourcing_deadline_at ?? null,
                fabricApprovalStatus: customDetail.fabric_approval_status ?? null,
                shippingPreference: displayNullableText(customDetail.shipping_preference),
                deliveryInstructions: displayNullableText(customDetail.delivery_instructions),
                targetDeliveryDate: customDetail.target_delivery_date ?? null,
              }
            : null,
          collectionCode: d.collection_code, videoCallUrl: d.video_call_url ?? null,
          occasion: displayNullableText(d.occasion), deadline: d.deadline, createdAt: d.created_at,
          stageUpdates: (d.order_stage_updates ?? []).map((update) => ({
            id: update.id,
            stage: update.stage,
            note: displayNullableText(update.note),
            photoUrl: update.photo_url ?? null,
            createdAt: update.created_at,
          })),
        })
        setHandoffIssue(openHandoffIssue)

        const { count: customerReviewCount } = await supabase
          .from('customer_reviews')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', d.id)

        setHasCustomerReview((customerReviewCount ?? 0) > 0)

        const { data: priorCustomerReviews } = await supabase
          .from('customer_reviews')
          .select('rating, tags')
          .eq('customer_id', d.customer_id)
          .neq('order_id', d.id)
          .order('created_at', { ascending: false })
          .limit(5)

        const reviewRows = Array.isArray(priorCustomerReviews) ? priorCustomerReviews : []
        const numericRatings = reviewRows
          .map((review) => (typeof review.rating === 'number' ? review.rating : null))
          .filter((rating): rating is number => rating !== null)
        const tags = Array.from(
          new Set(
            reviewRows
              .flatMap((review) => (Array.isArray(review.tags) ? review.tags : []))
              .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
              .map((tag) => tag.trim())
          )
        ).slice(0, 3)
        setCustomerReviewSummary({
          count: reviewRows.length,
          averageRating: numericRatings.length
            ? numericRatings.reduce((sum, rating) => sum + rating, 0) / numericRatings.length
            : null,
          tags,
        })
      } else {
        if (!silent) {
          setHandoffIssue(null)
          setOrder(null)
          setHasCustomerReview(false)
          setCustomerReviewSummary(null)
          setMaterialAdvances([])
        }
      }
    } catch (error) {
      if (silent) {
        Sentry.captureException(error, { extra: { context: 'tailor_order_realtime_refresh', orderId: id } })
        return
      }
      setFetchErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Connection is weak. We could not load this order yet. Retry when the signal improves, or reopen it from Orders later.'
          : 'We could not load this order right now. Retry, or reopen it from your Orders list.'
      )
      setHandoffIssue(null)
      setOrder(null)
      setHasCustomerReview(false)
      setCustomerReviewSummary(null)
      setMaterialAdvances([])
    }
    if (!silent) setLoading(false)
  }, [id, setOrder, userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchOrder()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchOrder])

  useFocusEffect(
    useCallback(() => {
      void fetchOrder()
    }, [fetchOrder]),
  )

  useEffect(() => {
    if (!id || !userId) return
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleSilentRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void fetchOrder({ silent: true })
      }, 250)
    }

    const pollTimer = setInterval(scheduleSilentRefresh, ORDER_DETAIL_POLL_INTERVAL_MS)
    const channel = supabase
      .channel(`tailor-order-detail:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'custom_order_details', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_stage_updates', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_stage_updates', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      clearInterval(pollTimer)
      void supabase.removeChannel(channel)
    }
  }, [fetchOrder, id, userId])

  useEffect(() => {
    if (!order || !isTerminalOrderStage(order.stage)) return
    const purgeKey = `${order.id}:${order.stage}`
    if (purgedTerminalOrderRef.current === purgeKey) return
    purgedTerminalOrderRef.current = purgeKey
    void purgeTerminalOrderClientState({
      orderId: order.id,
      customerId: order.customerId,
    })
  }, [order])

  useEffect(() => {
    if (initialActionHandledRef.current || !order || !action) return
    if (action === 'SEND_QUOTE') {
      initialActionHandledRef.current = true
      setQuoteModalMode('send')
      setShowQuoteModal(true)
      return
    }
    if (action === 'REVISE_QUOTE' && openQuoteRevision && order.activeQuoteId && order.activeQuoteVersion) {
      initialActionHandledRef.current = true
      setQuoteModalMode('revise')
      setShowQuoteModal(true)
      return
    }
    if (
      (action === 'KEEP_CURRENT_QUOTE' || action === 'DECLINE_AFTER_REVISION') &&
      openQuoteRevision &&
      order.activeQuoteId &&
      order.activeQuoteVersion
    ) {
      initialActionHandledRef.current = true
      setShowRevisionResponseSheet(true)
    }
  }, [action, openQuoteRevision, order])

  async function respondToQuoteRevision(response: 'keep-current-quote' | 'decline-after-revision') {
    if (
      !order?.activeQuoteId ||
      !order.activeQuoteVersion ||
      !openQuoteRevision ||
      revisionResponseSaving
    ) return
    setRevisionResponseSaving(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId: order.id,
        action: response,
        quoteId: order.activeQuoteId,
        expectedQuoteVersion: order.activeQuoteVersion,
        revisionRequestId: openQuoteRevision.id,
      },
    })
    setRevisionResponseSaving(false)
    if (error) {
      Alert.alert(
        'Response not saved',
        await readFunctionErrorMessage(error, 'Refresh the order and try this response again.'),
      )
      return
    }
    setShowRevisionResponseSheet(false)
    await fetchOrder()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this order...</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the brief, measurements, quote context, and current production state.
            </Text>
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
              style={styles.retryBtn}
              onPress={() => { setLoading(true); fetchOrder() }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tailor)/clients')}>
              <Text style={styles.backLink}>Open clients</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>← Back</Text>
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
            <Text style={styles.stateHint}>Open Orders and try again.</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>← Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const nextProductionStage =
    order.orderKind === 'READY_MADE'
      ? undefined
      : PRODUCTION_NEXT[order.stage]
  const flexibleNextStages =
    order.orderKind === 'READY_MADE'
      ? (order.stage === 'CONFIRMED' ? ['FINISHING'] as OrderStage[] : undefined)
      : FLEXIBLE_NEXT_STAGES[order.stage]
  const isFlexibleStage = !!flexibleNextStages
  const visibleReferencePhotos = order.referencePhotos.filter((url) => !failedReferencePhotos.includes(url))
  const styleReferenceLinks =
    order.customDetail?.socialReferenceLinks.length
      ? order.customDetail.socialReferenceLinks
      : asStringList(order.supportMeta.styleReferenceLinks)
  const styleAttributes = asStringList(order.supportMeta.styleAttributes)
  const styleNotes = order.customDetail?.styleNotes?.trim() || order.supportMeta.styleNotes?.trim() || null
  const bodyNote = order.customDetail?.bodyNote?.trim() || order.supportMeta.bodyNote?.trim() || order.fitNote?.trim() || null
  const garmentOther = order.customDetail?.garmentTypeOther?.trim() || order.supportMeta.customOrder?.garmentTypeOther?.trim() || null
  const genderPresentation = order.customDetail?.genderPresentation?.trim() || order.supportMeta.customOrder?.genderPresentation?.trim() || null
  const targetDeliveryDate = order.customDetail?.targetDeliveryDate ?? order.supportMeta.customOrder?.targetDeliveryDate ?? order.deadline
  const fabricDescription =
    order.customDetail?.fabricDescription?.trim()
    || order.supportMeta.fabricSourcing?.description?.trim()
    || null
  const fabricBudgetAmount =
    typeof order.customDetail?.fabricBudgetAmount === 'number'
      ? order.customDetail.fabricBudgetAmount
      : typeof order.supportMeta.fabricSourcing?.budgetAmount === 'number'
        ? order.supportMeta.fabricSourcing.budgetAmount
        : null
  const fabricBudgetCurrency =
    order.customDetail?.fabricBudgetCurrency
    || order.supportMeta.fabricSourcing?.budgetCurrency
    || order.quotedCurrency
  const fabricSourcingDeadlineDays =
    order.customDetail?.fabricSourcingDeadlineDays
    ?? order.supportMeta.fabricSourcing?.deadlineBusinessDays
    ?? null
  const fabricApprovalStatus = labelFabricApprovalStatus(order.customDetail?.fabricApprovalStatus)
  const shippingPreference = labelShippingPreference(order.customDetail?.shippingPreference ?? order.supportMeta.customOrder?.shippingPreference)
  const deliveryInstructions = order.customDetail?.deliveryInstructions?.trim() || order.supportMeta.deliveryInstructions?.trim() || null
  const statusGuidance = orderStatusGuidance(order.stage, order.orderKind)
  const measurementSource = order.measurements?.measurementSource
  const fitConfidence = order.measurements?.fitConfidence
  const measurementConfirmationNeeded = order.measurements?.needsConfirmation === true
  const wearerLabel = wearerLabelFromOrder(order.supportMeta, order.measurements)
  const measurementAge = resolveMeasurementAgeMeta(order.supportMeta, order.measurements)
  const measurementAgeText = measurementAgeLabel(measurementAge)
  const measurementConfirmationFields = getMeasurementConfirmationFields(order.measurements)
  const styleAlignment = order.supportMeta.styleAlignment
  const referralTrust = order.supportMeta.referralTrust ?? null
  const fitProfile = order.supportMeta.fitProfile ?? null
  const consultationMeta = order.supportMeta.consultation ?? null
  const quoteBreakdown = order.supportMeta.quoteBreakdown ?? null
  const fabricPolicy = order.supportMeta.fabricPolicy ?? null
  const bulkOrder = order.supportMeta.bulkOrder ?? null
  const dispatchRecord = order.supportMeta.dispatchRecord ?? null
  const consultationPaymentRequired =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS'
  const consultationPaymentPaid =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    !!consultationMeta.paidAt
  const customerRequestedConsultation =
    order.stage === 'CONSULTATION' &&
    consultationMeta?.requestedBy === 'CUSTOMER' &&
    consultationMeta.status === 'REQUESTED'
  const fitProfileReviewNeeded = fitProfileNeedsTailorReview(order.supportMeta)
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
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      fulfillmentProvider: order.fulfillmentProvider,
      fulfillmentReference: order.fulfillmentReference,
      fulfillmentContactName: order.fulfillmentContactName,
      fulfillmentContactPhone: order.fulfillmentContactPhone,
      collectionCode: order.collectionCode,
      referencePhotos: visibleReferencePhotos,
      proofMediaUrls: order.stageUpdates.map((update) => update.photoUrl).filter((url): url is string => !!url),
      supportMeta: order.supportMeta as unknown as Record<string, unknown>,
      customDetail: order.customDetail,
      measurementSnapshot: order.measurements as Record<string, unknown> | null,
      measurementSourceLabel: measurementSource ? MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource) : null,
      fitConfidenceLabel: fitConfidence ? FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence) : null,
      measurementAgeLabel: measurementAgeText,
      wearerLabel,
    },
    {
      money: (amount, currency) => amount == null ? 'Quote pending' : formatAmount(amount, (currency ?? order.quotedCurrency) as CurrencyCode, (currency ?? order.quotedCurrency) as CurrencyCode, STATIC_FALLBACK_RATES),
    },
  )
  const referenceMediaItems = dossierMediaItems('Reference photo', visibleReferencePhotos)
  const materialIssue = order.supportMeta.materialIssue ?? null
  const materialIssueOpen = hasOpenMaterialIssue(order.supportMeta)
  const materialIssueNeedsCustomerDecision = materialIssue?.status === 'OPEN'
  const materialIssueCancellationRequested = materialIssue?.status === 'CUSTOMER_REQUESTED_CANCEL'
  const handoffHelpAvailable = ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED', 'IN_DISPUTE'].includes(order.stage)
  const activeOrderCallAvailable =
    order.orderKind === 'CUSTOM' &&
    !handoffHelpAvailable &&
    ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'].includes(order.stage)
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
    (cancellationReview?.reason ? CANCELLATION_REVIEW_REASON_LABELS[cancellationReview.reason] : null)
  const cancellationPolicy = deriveCancellationPolicy({
    orderKind: order.orderKind,
    stage: order.stage,
    deliveryMethod: order.deliveryMethod,
    consultationFee: consultationMeta?.feeAmount ?? null,
    consultationPaidAt: consultationMeta?.paidAt ?? null,
    consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
    fulfillmentFee: order.fulfillmentFee,
    fulfillmentPaymentRequestedAt: order.fulfillmentPaymentRequestedAt,
    fulfillmentPaymentPaidAt: order.fulfillmentPaymentPaidAt,
    dispatchBookedAt: dispatchRecord?.bookedAt ?? null,
    premiumDispatch: dispatchRecord?.premiumException ?? null,
  })
  const canRequestCancellationReview =
    !cancellationReviewOpen &&
    cancellationPolicy.tailorCanRequestReview
  const showCancellationPolicyCard =
    cancellationReviewOpen ||
    (order.orderKind === 'CUSTOM'
      ? ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage)
      : ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage))
  const deliveryReview = order.supportMeta.deliveryReview ?? null
  const deliveryReviewOpen = hasOpenDeliveryReview(order.supportMeta)
  const deliveryReasonLabel =
    deliveryReview?.reasonLabel ??
    (deliveryReview?.reason ? DELIVERY_REVIEW_REASON_LABELS[deliveryReview.reason] : null)
  const scopeChange = order.supportMeta.scopeChange ?? null
  const scopeChangeOpen = hasOpenScopeChange(order.supportMeta)
  const canRequestScopeChange =
    order.orderKind === 'CUSTOM' &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    SCOPE_CHANGE_STAGES.includes(order.stage)
  const canRespondScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'CUSTOMER'
  const canCancelScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'TAILOR'
  const scopeChangeTypeLabel =
    scopeChange?.typeLabel ??
    (scopeChange?.type ? SCOPE_CHANGE_TYPE_LABELS[scopeChange.type] : null)
  const scopeChangeStatusLabel =
    scopeChange?.status ? formatScopeChangeStatusLabel(scopeChange.status) : null
  const canRequestDeliveryReview =
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED'].includes(order.stage)
  const waitingOnTailorSourcing = materialIssue?.status === 'CUSTOMER_RESPONDED' && materialIssue?.response === 'ASK_TAILOR_TO_SOURCE'
  const tailorSourcedFabricNeedsApproval =
    order.orderKind === 'CUSTOM' &&
    order.fabricSource === 'TAILOR_SOURCES' &&
    order.customDetail?.fabricApprovalStatus !== 'APPROVED'
  const cuttingBlockerMessage = measurementConfirmationNeeded
    ? 'The customer still needs to confirm measurements before cutting can start.'
    : fitProfileReviewNeeded
      ? 'Review the fit notes or request measurement confirmation before cutting starts.'
      : materialIssueOpen
        ? 'There is an open material issue that needs a customer decision first.'
        : order.fabricSource === 'CUSTOMER_SUPPLIES' &&
            !order.supportMeta.fabricReceivedAt &&
            !waitingOnTailorSourcing
          ? 'Confirm that the customer fabric has been received before cutting starts.'
          : tailorSourcedFabricNeedsApproval
            ? 'Upload sourced fabric and wait for the customer to approve it before cutting starts.'
            : styleAlignment?.requiredBeforeCutting === true &&
                styleAlignment.status !== 'NOT_REQUIRED' &&
                styleAlignment.status !== 'APPROVED'
              ? 'Get customer approval on your style interpretation before cutting starts.'
            : null
  const canConfirmFabricReceived =
    order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.includes(order.stage) &&
    (!order.supportMeta.fabricReceivedAt || materialIssue?.response === 'REPLACE_FABRIC')
  const cuttingBlockedLocally = !!cuttingBlockerMessage

  const quotedHeadlineAmount = baseAmount(order)
  const conversationCtaLabel = isTerminalOrderStage(order.stage)
    ? 'View conversation'
    : `Message ${order.customerName.split(' ')[0]}`

  async function confirmFabricReceived() {
    const currentOrderId = order?.id
    if (!currentOrderId) return
    if (confirmingFabricReceived) return
    Alert.alert(
      'Confirm fabric received',
      'Only confirm this once the customer fabric is actually in your hands and ready for the next step.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            if (confirmingFabricReceived) return
            setConfirmingFabricReceived(true)
            let photoUrl: string | null = null
            try {
              const picked = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
              })
              if (picked.canceled || !picked.assets[0]) {
                setConfirmingFabricReceived(false)
                return
              }
              const cleanUri = await stripExif(picked.assets[0].uri)
              const filename = `fabric-receipts/${user?.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
              photoUrl = await uploadPublicStorageImage({
                bucket: 'order-photos',
                path: filename,
                uri: cleanUri,
                contentType: 'image/jpeg',
                maxBytes: 10 * 1024 * 1024,
              })
            } catch (uploadError) {
              setConfirmingFabricReceived(false)
              const message = isLikelyConnectivityIssue(uploadError)
                ? 'Connection looks weak. The fabric receipt photo could not upload yet.'
                : 'The fabric receipt photo could not upload. Please try again.'
              Alert.alert('Photo needed', message)
              return
            }
            const { error } = await invokeFunction('tailor-order-action', {
              body: { orderId: currentOrderId, action: 'confirm-fabric-received', photoUrl },
            })
            setConfirmingFabricReceived(false)
            if (error) {
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not confirm fabric receipt yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'Could not confirm fabric receipt right now. Please try again.')
              Alert.alert('Update unavailable', message)
              return
            }
            await fetchOrder()
          },
        },
      ]
    )
  }

  function openStageModal(target: OrderStage) {
    if (target === 'CUTTING' && cuttingBlockerMessage) {
      Alert.alert('Cutting is blocked', cuttingBlockerMessage)
      return
    }
    setStageModalTarget(target)
    setShowStageModal(true)
  }

  function respondToScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    if (!order) return
    const actionLabel =
      decision === 'ACCEPTED' ? 'Accept change' : decision === 'DECLINED' ? 'Decline change' : 'Cancel proposal'
    const message =
      decision === 'ACCEPTED'
        ? 'This records your approval in Drapeon. If this changes price, deadline, fit, or fabric, keep the next step formal before continuing.'
        : decision === 'DECLINED'
          ? 'This records that you cannot accept the requested change.'
          : 'This closes your proposed change without changing the order scope.'
    Alert.alert(actionLabel, message, [
      { text: 'Not now', style: 'cancel' },
      {
        text: actionLabel,
        onPress: async () => {
          const { error } = await invokeFunction('tailor-order-action', {
            body: {
              orderId: order.id,
              action: 'respond-scope-change',
              scopeChangeDecision: decision,
            },
          })
          if (error) {
            Alert.alert(
              'Change unavailable',
              isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not update this change yet.'
                : await readFunctionErrorMessage(error, 'Could not update this change request right now.'),
            )
            return
          }
          void fetchOrder()
        },
      },
    ])
  }

  async function startCall(callType: 'audio' | 'video') {
    if (!order) return
    if (startingCall) return
    setStartingCall(callType)
    try {
      const room = await createConsultationRoom(order.id, callType)
      if (room?.fallback === 'MESSAGES') {
        void fetchOrder()
        openOrderMessages()
        return
      }
      if (!room?.url) {
        return
      }
      void fetchOrder()
      await openCallUrl(room.url)
    } catch (error) {
      Alert.alert(
        'Call unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Keep the order thread updated and try starting the consultation again when the signal improves.'
          : 'Could not start the consultation call. Keep using the order thread and try again in a moment.',
      )
    } finally {
      setStartingCall(null)
    }
  }

  async function startOrderCall(callType: 'audio' | 'video') {
    if (!order) return
    if (startingOrderCall) return
    setStartingOrderCall(callType)
    try {
      const room = await createOrderCallRoom(order.id, callType, 'tailor')
      if (room?.fallback === 'MESSAGES') {
        await fetchOrder()
        openOrderMessages()
        return
      }
      if (!room?.url) return
      await fetchOrder()
      await openDrapeCallUrl(room.url, 'tailor')
    } finally {
      setStartingOrderCall(null)
    }
  }

  function openOrderCallOptions() {
    if (!order || startingOrderCall) return
    if (order.videoCallUrl) {
      Alert.alert(
        'Join Drapeon call',
        `Open the current Drapeon call with ${order.customerName}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Video', onPress: () => { void startOrderCall('video') } },
          { text: 'Audio only', onPress: () => { void startOrderCall('audio') } },
        ]
      )
      return
    }

    Alert.alert(
      'Start Drapeon call',
      `Start a Drapeon call with ${order.customerName} without exposing personal phone numbers.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Video', onPress: () => { void startOrderCall('video') } },
        { text: 'Audio only', onPress: () => { void startOrderCall('audio') } },
      ]
    )
  }

  function confirmDeclineOrder(title = 'Decline order', message = 'Are you sure you want to decline this order?') {
    if (!order) return
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          if (!order) return
          const { error } = await invokeFunction('tailor-order-action', {
            body: { orderId: order.id, action: 'decline-order' },
          })
          if (error) {
            const message = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not decline this order yet. Retry when the signal improves.'
              : await readFunctionErrorMessage(error, 'Could not decline this order right now. Please try again in a moment.')
            Alert.alert('Could not decline order', message)
            return
          }
          await purgeTerminalOrderClientState({
            orderId: order.id,
            customerId: order.customerId,
          })
          router.replace('/(tailor)/orders')
        },
      },
    ])
  }

  function openQuoteActionMenu() {
    if (!order) return
    Alert.alert(
      'Order actions',
      'Choose one clear next step for this request.',
      [
        {
          text: 'Request consultation',
          onPress: () => {
            setConsultationModalAction('request-consultation')
            setShowConsultationModal(true)
          },
        },
        {
          text: 'Decline order',
          style: 'destructive',
          onPress: () => confirmDeclineOrder(),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  async function declineConsultationRequest() {
    if (!order) return
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId: order.id, action: 'decline-consultation-request' },
    })
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not decline the consultation yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not decline this consultation right now.')
      Alert.alert('Consultation unavailable', message)
      return
    }
    fetchOrder()
  }

  function openCustomerConsultationMenu() {
    Alert.alert(
      'Consultation options',
      'Use this only if the requested time or consultation is not right for this order.',
      [
        {
          text: 'Decline consultation',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Decline consultation?',
              'The order returns to quote review so you can still send a quote or decline the full order.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Decline consultation',
                  style: 'destructive',
                  onPress: () => { void declineConsultationRequest() },
                },
              ],
            )
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function openConsultationCallMenu() {
    if (!order) return
    if (consultationPaymentRequired && !consultationPaymentPaid) {
      Alert.alert(
        'Payment still needed',
        'The customer needs to pay the consultation fee before the call can begin.',
      )
      return
    }
    if (startingCall) return
    const title = order.videoCallUrl ? 'Rejoin consultation' : 'Start consultation'
    const message = order.videoCallUrl
      ? 'Open the current Drapeon consultation call.'
      : 'Choose the call type for this consultation. Drapeon keeps phone numbers private.'
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Video call', onPress: () => { void startCall('video') } },
      { text: 'Audio only', onPress: () => { void startCall('audio') } },
    ])
  }

  function openConsultationNextMenu() {
    Alert.alert(
      'After consultation',
      'Choose the next step once you have enough information to proceed.',
      [
        { text: 'Send quote', onPress: () => { setQuoteModalMode('send'); setShowQuoteModal(true) } },
        {
          text: 'Decline order',
          style: 'destructive',
          onPress: () => confirmDeclineOrder('Decline order', 'Are you sure you want to decline this order after consultation?'),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function openFlexibleStageMenu() {
    if (!order || !flexibleNextStages?.length) return
    if (flexibleNextStages.length === 1) {
      openStageModal(flexibleNextStages[0])
      return
    }
    setShowFlexibleStageSheet(true)
  }

  async function markHandoffIssueResolved() {
    if (!handoffIssue || resolvingHandoffIssue) return
    setResolvingHandoffIssue(true)
    const result = await resolveHandoffIssue(handoffIssue.id, 'Resolved from tailor order screen.')
    setResolvingHandoffIssue(false)
    if (result.error) {
      Alert.alert('Could not close help thread', result.error)
      return
    }
    await fetchOrder()
  }

  async function uploadMaterialAdvanceReceipt(advance: MaterialAdvance, source: 'camera' | 'library') {
    if (!order || uploadingAdvanceReceiptId) return
    setUploadingAdvanceReceiptId(advance.id)
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) {
          Alert.alert('Camera access needed', 'Take a receipt photo so Drapeon can keep this advance audit-ready.')
          return
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (!permission.granted) {
          Alert.alert('Photo access needed', 'Choose a receipt photo so Drapeon can keep this advance audit-ready.')
          return
        }
      }

      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })

      if (picked.canceled || !picked.assets?.[0]?.uri) return
      const cleanUri = await stripExif(picked.assets[0].uri)
      const receiptUrl = await uploadPublicStorageImage({
        bucket: 'order-photos',
        path: `material-advances/${order.id}/${advance.id}.jpg`,
        uri: cleanUri,
        contentType: 'image/jpeg',
        maxBytes: 8 * 1024 * 1024,
        upsert: true,
        purpose: 'ORDER_REFERENCE',
      })

      const { error } = await invokeFunction('material-advance-action', {
        body: {
          action: 'upload-receipt',
          advanceId: advance.id,
          receiptUrl,
          note: 'Receipt proof uploaded by tailor.',
        },
      })

      if (error) {
        Alert.alert(
          'Receipt not saved',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. The receipt did not finish saving; retry when the signal improves.'
            : await readFunctionErrorMessage(error, 'Could not save this receipt proof right now.'),
        )
        return
      }

      await fetchOrder()
      Alert.alert('Receipt saved', 'Drapeon now has proof for this material advance.')
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'upload_material_advance_receipt', advanceId: advance.id, orderId: order.id },
      })
      Alert.alert('Receipt not saved', 'Something went wrong while saving this receipt. Try again in a moment.')
    } finally {
      setUploadingAdvanceReceiptId(null)
    }
  }

  function chooseMaterialAdvanceReceiptSource(advance: MaterialAdvance) {
    Alert.alert(
      'Upload receipt',
      'Use a clear receipt or supplier proof for this material advance.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take photo', onPress: () => { void uploadMaterialAdvanceReceipt(advance, 'camera') } },
        { text: 'Choose photo', onPress: () => { void uploadMaterialAdvanceReceipt(advance, 'library') } },
      ]
    )
  }

  async function openCustomerReview() {
    if (!order) return
    const { count, error } = await supabase
      .from('customer_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', order.id)

    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'open_customer_review_preflight', orderId: order.id },
      })
      Alert.alert('Review unavailable', 'We could not check this review yet. Reopen the order and try again.')
      return
    }

    if ((count ?? 0) > 0) {
      setHasCustomerReview(true)
      Alert.alert(
        'Review already saved',
        'Drapeon keeps one internal customer review per order. You can review this customer again after a future order.',
      )
      return
    }

    router.push({
      pathname: '/(tailor)/clients/review/[orderId]',
      params: {
        orderId: order.id,
        returnTo: '/(tailor)/orders',
        historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
      },
    })
  }

  const successfulPaymentExists = hasSuccessfulPaymentEvent(order.stageUpdates)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        {...capsuleNavScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 320, 420) }}
      >
        <View style={styles.content}>

          {/* Header */}
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>{order.customerName}  ·  #{order.reference}</Text>
            {order.orderKind === 'READY_MADE' ? (
              <View style={styles.orderTypePill}>
                <Text style={styles.orderTypePillText}>Ready-made order</Text>
              </View>
            ) : null}
            <View style={styles.stageRow}>
              <DrapeStatusChip
                value={order.stage}
                label={tailorOrderStageLabel(order.stage, order.orderKind)}
                domain="order"
                testID="tailor-order-stage"
              />
              {quotedHeadlineAmount != null && (
                <Text style={styles.amount}>
                  {formatAmount(
                    quotedHeadlineAmount,
                    order.quotedCurrency as CurrencyCode,
                    order.quotedCurrency as CurrencyCode,
                    STATIC_FALLBACK_RATES
                  )} {quotedAmountLabel(order.stage, order.orderKind, false)}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.supportCard}>
            <Text style={styles.supportCardTitle}>Customer context</Text>
            {referralTrust?.visibleToTailor ? (
              <View style={styles.referralTrustCard}>
                <Feather name="user-check" size={16} color={Colors.needleGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.referralTrustTitle}>
                    Referred through Drapeon
                  </Text>
                  <Text style={styles.referralTrustText}>
                    {referralTrust.referrerName
                      ? `${referralTrust.referrerName} referred this customer`
                      : 'This customer was referred by a Drapeon user'}
                    {typeof referralTrust.completedOrderCount === 'number'
                      ? ` · ${referralTrust.completedOrderCount} completed ${referralTrust.completedOrderCount === 1 ? 'order' : 'orders'}`
                      : ''}
                    . Treat it as context, not a shortcut around brief review.
                  </Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.supportHint}>
              {customerReviewSummary && customerReviewSummary.count > 0
                ? `${customerReviewSummary.count} past internal ${customerReviewSummary.count === 1 ? 'review' : 'reviews'}${
                    customerReviewSummary.averageRating
                      ? ` · ${customerReviewSummary.averageRating.toFixed(1)}/5 average`
                      : ''
                  }. This helps you decide how to work before accepting more risk.`
                : 'No previous internal reviews for this customer yet. Keep communication and decisions inside Drapeon so future context is useful.'}
            </Text>
            {customerReviewSummary?.tags.length ? (
              <Text style={styles.supportHint}>Notes seen before: {customerReviewSummary.tags.join(', ')}</Text>
            ) : null}
            <Button
              label="Open customer profile"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/(tailor)/clients/[clientId]',
                  params: {
                    clientId: order.customerId,
                    historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
                  },
                })
              }
            />
          </View>

          {/* PENDING_QUOTE — show brief + quote/consultation CTAs */}
          {order.stage === 'PENDING_QUOTE' && (
            <View style={styles.alertCard}>
              {order.orderKind === 'READY_MADE' ? (
                <>
                  <Text style={styles.alertTitle}>New item inquiry</Text>
                  <Text style={styles.alertSub}>
                    This customer has a question before buying. Open messages to reply about fit, stock, pickup, delivery, or shipping.
                  </Text>
                  <Button
                    label="Open messages"
                    onPress={() =>
                      router.push({
                        pathname: '/(tailor)/messages/[orderId]',
                        params: {
                          orderId: order.id,
                          returnTo: `/(tailor)/orders/${order.id}`,
                          historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
                        },
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <Text style={styles.alertTitle}>New order. Your quote is needed</Text>
                  <Text style={styles.alertSub}>
                    Review the order details below and send your quote. You can also request a consultation first.
                  </Text>
                  <Button
                    label="Send quote"
                    onPress={() => { setQuoteModalMode('send'); setShowQuoteModal(true) }}
                    testID="tailor-send-quote-btn"
                  />
                  <TouchableOpacity style={styles.compactActionMenuButton} onPress={openQuoteActionMenu}>
                    <Text style={styles.compactActionMenuText}>Consultation or decline</Text>
                    <Feather name="chevron-down" size={16} color={Colors.needleGreen} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {QUOTE_NEGOTIATION_UI_ENABLED && order.stage === 'QUOTE_SENT' && openQuoteRevision ? (
            <DrapeInlineActionCard
              eyebrow={`Revision ${openQuoteRevision.roundNumber} of ${order.negotiationRoundLimit}`}
              title="Customer requested quote changes"
              body={openQuoteRevision.note}
              icon="edit-3"
            >
              <View style={styles.quoteRevisionReasonRow}>
                {openQuoteRevision.reasonCodes.map((reason) => (
                  <DrapeStatusChip
                    key={reason}
                    label={QUOTE_REVISION_REASON_LABELS[reason as QuoteRevisionReason] ?? 'Other'}
                    tone="warning"
                  />
                ))}
              </View>
              <DrapeCapsuleButton
                label="Revise quote"
                onPress={() => { setQuoteModalMode('revise'); setShowQuoteModal(true) }}
                testID="tailor-revise-quote-btn"
              />
              <DrapeCapsuleButton
                label="Other responses"
                tone="secondary"
                onPress={() => setShowRevisionResponseSheet(true)}
              />
            </DrapeInlineActionCard>
          ) : null}

          {/* CONSULTATION — tailor awaiting consultation, then sends quote */}
          {order.stage === 'CONSULTATION' && (
            <View style={[styles.alertCard, styles.consultationCard]}>
              <Text style={styles.alertTitle}>Consultation requested</Text>
              <Text style={styles.alertSub}>
                {customerRequestedConsultation
                  ? 'The customer asked to schedule a consultation before you quote. Drapeon checks your calendar before approval, so choose another time if this one has already gone.'
                  : consultationPaymentRequired && !consultationPaymentPaid
                  ? "You've requested a paid consultation. Wait for the customer to pay before you start the call."
                  : "You've requested a consultation with this customer. Once done, send your quote or decline."}
              </Text>
              {consultationMeta?.proposedStartAt && customerRequestedConsultation ? (
                <Text style={styles.supportHint}>Requested time: {formatConsultationStart(consultationMeta.proposedStartAt)}</Text>
              ) : consultationMeta?.scheduledStartAt ? (
                <Text style={styles.supportHint}>Scheduled: {formatConsultationStart(consultationMeta.scheduledStartAt)}</Text>
              ) : null}
              {consultationPaymentRequired ? (
                <Text style={styles.supportHint}>
                  {consultationPaymentPaid
                    ? 'Consultation fee paid. You can start the consultation call at the scheduled time.'
                    : 'The customer still needs to pay the consultation fee before the consultation can begin.'}
                </Text>
              ) : null}
              <View style={styles.supportMetaList}>
                <BriefRow label="Fit" value="Confirm silhouette, ease, sensitive measurements, and comfort notes" />
                <BriefRow label="Fabric" value="Agree source, color, texture, stretch, and proof needed before cutting" />
                <BriefRow label="Next step" value="After the call, send a clear quote or decline quickly" />
              </View>
              {customerRequestedConsultation ? (
                <>
                  <Button
                    label="Approve and schedule"
                    onPress={() => {
                      setConsultationModalAction('approve-consultation')
                      setShowConsultationModal(true)
                    }}
                  />
                  <TouchableOpacity style={styles.compactActionMenuButton} onPress={openCustomerConsultationMenu}>
                    <Text style={styles.compactActionMenuText}>Other consultation options</Text>
                    <Feather name="chevron-down" size={16} color={Colors.needleGreen} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Button
                    label={order.videoCallUrl ? 'Rejoin consultation' : 'Start consultation call'}
                    onPress={openConsultationCallMenu}
                    loading={!!startingCall}
                    disabled={!!startingCall || (consultationPaymentRequired && !consultationPaymentPaid)}
                  />
                  <TouchableOpacity style={styles.compactActionMenuButton} onPress={openConsultationNextMenu}>
                    <Text style={styles.compactActionMenuText}>Quote or decline</Text>
                    <Feather name="chevron-down" size={16} color={Colors.needleGreen} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {order.orderKind === 'CUSTOM' && (consultationMeta || quoteBreakdown || bulkOrder) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Commercial setup</Text>
              {consultationMeta ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Consultation policy</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Status" value={formatConsultationStatusLabel(consultationMeta.status)} />
                    <BriefRow
                      label="Fee"
                      value={
                        consultationMeta.feeAmount && consultationMeta.feeCurrency
                          ? formatAmount(
                              consultationMeta.feeAmount,
                              consultationMeta.feeCurrency as CurrencyCode,
                              consultationMeta.feeCurrency as CurrencyCode,
                              STATIC_FALLBACK_RATES,
                            )
                          : 'Free'
                      }
                    />
                    {consultationMeta.feeAmount ? (
                      <BriefRow label="Fee treatment" value={consultationMeta.feeCreditable ? 'Credits toward the final order' : 'Separate consultation fee'} />
                    ) : null}
                    {consultationMeta.scheduledStartAt ? (
                      <BriefRow label="Scheduled for" value={formatConsultationStart(consultationMeta.scheduledStartAt)} />
                    ) : consultationMeta.proposedStartAt ? (
                      <BriefRow label="Requested time" value={formatConsultationStart(consultationMeta.proposedStartAt)} />
                    ) : null}
                    {consultationMeta.paymentTiming ? (
                      <BriefRow label="Payment timing" value={CONSULTATION_PAYMENT_TIMING_LABELS[consultationMeta.paymentTiming]} />
                    ) : null}
                    {consultationMeta.reschedulePolicy ? (
                      <BriefRow label="Rescheduling" value={CONSULTATION_RESCHEDULE_POLICY_LABELS[consultationMeta.reschedulePolicy]} />
                    ) : null}
                    {consultationMeta.noShowPolicy ? (
                      <BriefRow label="No-show" value={CONSULTATION_NO_SHOW_POLICY_LABELS[consultationMeta.noShowPolicy]} />
                    ) : null}
                    {consultationMeta.expiryPolicy ? (
                      <BriefRow label="Offer window" value={CONSULTATION_EXPIRY_POLICY_LABELS[consultationMeta.expiryPolicy]} />
                    ) : null}
                    {consultationPaymentRequired ? (
                      <BriefRow label="Payment status" value={consultationPaymentPaid ? 'Paid and ready to schedule' : 'Waiting for customer payment'} />
                    ) : null}
                    <BriefRow label="Reminder" value={consultationMeta.reminderEnabled === false ? 'No reminder planned' : 'Reminder enabled'} />
                  </View>
                  {consultationMeta.requestNote ? <Text style={styles.supportHint}>{consultationMeta.requestNote}</Text> : null}
                </View>
              ) : null}

              {quoteBreakdown ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Quote breakdown</Text>
                  <View style={styles.supportMetaList}>
                    {typeof quoteBreakdown.laborAmount === 'number' ? (
                      <BriefRow
                        label="Labour"
                        value={formatAmount(quoteBreakdown.laborAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {typeof quoteBreakdown.sourcingAmount === 'number' ? (
                      <BriefRow
                        label="Sourcing"
                        value={formatAmount(quoteBreakdown.sourcingAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {typeof quoteBreakdown.rushAmount === 'number' ? (
                      <BriefRow
                        label="Rush fee"
                        value={formatAmount(quoteBreakdown.rushAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {typeof quoteBreakdown.consultationCreditAmount === 'number' && quoteBreakdown.consultationCreditAmount > 0 ? (
                      <BriefRow
                        label="Consultation credit"
                        value={`-${formatAmount(quoteBreakdown.consultationCreditAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}`}
                      />
                    ) : null}
                  </View>
                  {quoteBreakdown.summary ? <Text style={styles.supportBodyText}>{quoteBreakdown.summary}</Text> : null}
                  {quoteBreakdown.included && quoteBreakdown.included.length > 0 ? (
                    <Text style={styles.supportHint}>Included: {quoteBreakdown.included.join(', ')}</Text>
                  ) : null}
                  {quoteBreakdown.excluded && quoteBreakdown.excluded.length > 0 ? (
                    <Text style={styles.supportHint}>Not included: {quoteBreakdown.excluded.join(', ')}</Text>
                  ) : null}
                </View>
              ) : null}

              {bulkOrder?.enabled ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Bulk order handling</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Mode" value="Ops-managed linked custom order" />
                    {bulkOrder.recipientCount ? <BriefRow label="Recipients" value={`${bulkOrder.recipientCount}`} /> : null}
                    {bulkOrder.label ? <BriefRow label="Group label" value={bulkOrder.label} /> : null}
                    {bulkOrder.memberNames && bulkOrder.memberNames.length > 0 ? (
                      <BriefRow label="Members" value={bulkOrder.memberNames.join(', ')} />
                    ) : null}
                    <BriefRow
                      label="Measurement privacy"
                      value={bulkOrder.measurementPrivacy === 'TAILOR_ONLY' ? 'Tailor only' : 'Tailor-private by default'}
                    />
                    {bulkOrder.memberMeasurementPolicy ? (
                      <BriefRow label="Measurement rule" value={bulkOrder.memberMeasurementPolicy} />
                    ) : null}
                    <BriefRow
                      label="Payer model"
                      value={bulkOrder.payerModel === 'SINGLE_PAYER' ? 'One payer covers the full group order' : 'Single payer'}
                    />
                    <BriefRow
                      label="Status policy"
                      value={bulkOrder.statusPolicy === 'OPS_MANAGED_LINKED_CHILDREN' ? 'Ops manages linked recipient timelines' : 'Linked custom order'}
                    />
                    <BriefRow label="Dye-lot consistency" value={bulkOrder.dyeLotConsistencyRequired ? 'Required' : 'Not flagged'} />
                  </View>
                  <Text style={styles.supportHint}>
                    Keep recipient-level measurements and any consistency notes inside Drapeon so ops can help manage the group cleanly.
                  </Text>
                  {bulkOrder.notes ? <Text style={styles.supportHint}>{bulkOrder.notes}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Flexible stages: CONFIRMED / DESIGNING / SOURCING — tailor picks next stage */}
          {isFlexibleStage && flexibleNextStages && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>
                {order.orderKind === 'READY_MADE' ? 'Prepare this order' : 'Update production stage'}
              </Text>
              <Text style={styles.stageCardSub}>
                Currently: <Text style={{ color: Colors.needleGreen, fontWeight: FontWeight.semibold }}>{tailorOrderStageLabel(order.stage, order.orderKind)}</Text>
              </Text>
              <Text style={styles.stageCardHint}>
                {order.orderKind === 'READY_MADE'
                  ? 'Ready-made orders skip tailoring production stages. Move this into preparation, then ship it or mark it ready for collection.'
                  : 'Choose which stage to move to next. Tailors often run design and sourcing in parallel.'}
              </Text>
              <Button
                label={flexibleNextStages.length === 1 ? displayStageChoiceLabel(flexibleNextStages[0], order.orderKind) : 'Choose next stage'}
                onPress={openFlexibleStageMenu}
              />
              {flexibleNextStages.length > 1 ? (
                <Text style={styles.stageCardHint}>
                  Available next steps: {flexibleNextStages.map((target) => displayStageChoiceLabel(target, order.orderKind)).join(' · ')}
                </Text>
              ) : null}
            </View>
          )}

          {/* Linear stages: CUTTING / SEWING — single next stage */}
          {!isFlexibleStage && (order.stage === 'CUTTING' || order.stage === 'SEWING') && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>Update production stage</Text>
              <Text style={styles.stageCardSub}>
                Currently: <Text style={{ color: Colors.needleGreen, fontWeight: FontWeight.semibold }}>{tailorOrderStageLabel(order.stage, order.orderKind)}</Text>
              </Text>
              <Button
                label={`Advance to ${nextProductionStage ? STAGE_LABELS[nextProductionStage] : '...'}`}
                onPress={() => openStageModal(nextProductionStage!)}
              />
            </View>
          )}

          {order.stage === 'FINISHING' && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>{order.orderKind === 'READY_MADE' ? 'Preparing order' : 'Almost done'}</Text>
              <Text style={styles.stageCardSub}>
                {order.deliveryMethod === 'LOCAL_COLLECTION'
                  ? (order.orderKind === 'READY_MADE'
                      ? 'Mark this order ready for collection once it is packed and checked.'
                      : 'Mark as finished and ready for collection.')
                  : (order.orderKind === 'READY_MADE'
                      ? `Keep packing and checking this order. When it is ready, hand it to Drapeon for dispatch.`
                      : `Mark this order ready for Drapeon dispatch once it is packed and checked.`)}
              </Text>
              {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Drapeon-managed dispatch</Text>
                  <Text style={styles.supportHint}>
                    Drapeon will manage the actual dispatch from ops once you mark this packed order ready. You only need to finish packing, quality-check the order, and hand it over cleanly.
                  </Text>
                </View>
              ) : null}
              {order.deliveryMethod === 'LOCAL_COLLECTION' ? (
                <Button
                  label="Mark ready for collection"
                  onPress={() => openStageModal('READY_FOR_COLLECTION')}
                />
              ) : (
                <Button
                  label="Mark ready for Drapeon dispatch"
                  onPress={() => openStageModal('READY_FOR_DRAPE_DISPATCH')}
                />
              )}
            </View>
          )}

          {/* READY_FOR_COLLECTION — code entry */}
          {order.stage === 'READY_FOR_COLLECTION' && (
            <View style={[styles.stageCard, { borderColor: Colors.needleGreen, borderWidth: 1.5 }]}>
              <Text style={styles.stageCardTitle}>Awaiting customer collection</Text>
              <Text style={styles.stageCardSub}>
                Ask the customer to show their 4-digit code, then enter it below to confirm collection and close the handoff in Drapeon.
              </Text>
              <Button label="Enter collection code" onPress={() => setShowCodeModal(true)} />
            </View>
          )}

          {statusGuidance && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>{tailorOrderStageLabel(order.stage, order.orderKind)}</Text>
              <Text style={styles.stageCardSub}>{statusGuidance}</Text>
            </View>
          )}

          <View style={styles.supportCard}>
            <View style={styles.visionOrderHeader}>
              <View style={styles.visionOrderIcon}>
                <Feather name="image" size={16} color={Colors.needleGreen} />
              </View>
              <Text style={styles.supportCardTitle}>Order evidence timeline</Text>
            </View>
            <Text style={styles.supportHint}>
              Production photos and stage updates stay here so you, the customer, and ops are looking at the same proof.
            </Text>
            <View style={styles.timeline}>
              {order.stageUpdates.length > 0 ? order.stageUpdates.map((update) => (
                <View key={update.id} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: timelineDotColor(update, successfulPaymentExists) }]} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>
                      {timelineStageLabel(update, order.orderKind, successfulPaymentExists)}
                    </Text>
                    {timelineNoteText(update, successfulPaymentExists) ? (
                      <Text style={styles.timelineNote}>{timelineNoteText(update, successfulPaymentExists)}</Text>
                    ) : null}
                    {update.photoUrl ? (
                      <StageMediaPreview
                        uri={update.photoUrl}
                        style={styles.timelinePhoto}
                        surface="tailor_order_timeline_photo"
                      />
                    ) : null}
                    <Text style={styles.timelineDate}>{formatTimelineDate(update.createdAt)}</Text>
                  </View>
                </View>
              )) : (
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: Colors.lightGrey }]} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>No evidence yet</Text>
                    <Text style={styles.timelineNote}>
                      Add photos when updating production stages so the final handoff has a clear evidence trail.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {showCancellationPolicyCard && (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Cancellation and refund review</Text>
              {cancellationReviewOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>Review open</Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing whether this order should be cancelled before handoff. Keep all updates inside the order timeline.
                  </Text>
                  {cancellationReasonLabel ? (
                    <Text style={styles.supportBodyText}>Reason: {cancellationReasonLabel}</Text>
                  ) : null}
                  {cancellationReview?.note ? (
                    <Text style={styles.supportHint}>{cancellationReview.note}</Text>
                  ) : null}
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}</Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}</Text>
                  ) : null}
                </>
              ) : canRequestCancellationReview ? (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.tailorMessage}</Text>
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}</Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}</Text>
                  ) : null}
                  <Button
                    label="Request cancellation review"
                    variant="secondary"
                    onPress={() => setShowCancellationReviewModal(true)}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.tailorMessage}</Text>
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}</Text>
                  ) : null}
                </>
              )}
            </View>
          )}

          {(deliveryReviewOpen || canRequestDeliveryReview) && (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Dispatch and delivery review</Text>
              {deliveryReviewOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>Review open</Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing a dispatch or delivery issue on this order. Keep ops and customer updates inside this timeline while the handoff is paused.
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
                    Use this if dispatch is delayed, the recipient could not be reached, delivery failed, or the parcel is heading back instead of finishing cleanly.
                  </Text>
                  <Button
                    label="Report dispatch or delivery issue"
                    variant="secondary"
                    onPress={() => setShowDeliveryReviewModal(true)}
                  />
                </>
              )}
            </View>
          )}

          {(scopeChangeOpen || canRequestScopeChange) && (
            <View style={[styles.supportCard, scopeChangeOpen && styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>
                {scopeChangeOpen ? 'Change request open' : 'Need to change the order?'}
              </Text>
              {scopeChangeOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
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
                  {typeof scopeChange?.priceImpactMinor === 'number' && scopeChange.priceImpactMinor !== 0 ? (
                    <Text style={styles.supportHint}>
                      Price impact: {formatAmount(Math.abs(scopeChange.priceImpactMinor), order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                    </Text>
                  ) : null}
                  {scopeChange?.deadlineImpact ? (
                    <Text style={styles.supportHint}>Deadline: {scopeChange.deadlineImpact}</Text>
                  ) : null}
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
                      label="Cancel proposal"
                      variant="ghost"
                      onPress={() => respondToScopeChange('CANCELLED')}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>
                    Use this for measurement amendments, style/reference alignment, fabric changes, added work, pause/restart, or rework. It keeps approval, price, and deadline impact inside Drapeon.
                  </Text>
                  <Button
                    label="Propose change"
                    variant="secondary"
                    onPress={() => setShowScopeChangeModal(true)}
                  />
                </>
              )}
            </View>
          )}

          {(measurementSource || fitConfidence || order.fabricSource === 'CUSTOMER_SUPPLIES' || fabricDescription || fabricApprovalStatus || materialIssue || (order.orderKind === 'CUSTOM' && PRE_CUTTING_STAGES.includes(order.stage))) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pre-cutting checks</Text>
              {cuttingBlockedLocally && order.orderKind === 'CUSTOM' && ['CONFIRMED', 'DESIGNING', 'SOURCING'].includes(order.stage) ? (
                <View style={styles.supportWarningCard}>
                  <Text style={styles.supportWarningTitle}>Cutting still has a blocker</Text>
                  <Text style={styles.supportWarningText}>{cuttingBlockerMessage ?? ''}</Text>
                </View>
              ) : null}

              {order.orderKind === 'CUSTOM' && PRE_CUTTING_STAGES.includes(order.stage) ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Fit protection checklist</Text>
                  <Text style={styles.supportHint}>
                    Before cutting, confirm the customer understands the fit direction, key measurements,
                    fabric choice, and deadline. Keep proof media and consultation notes in Drapeon so aftercare
                    has a clear record if the finished garment needs a remedy.
                  </Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Fit" value="Confirm silhouette, ease, and sensitive measurements" />
                    <BriefRow label="Material" value="Do not cut until fabric is approved or supplied" />
                    {styleAlignment?.requiredBeforeCutting ? (
                      <BriefRow
                        label="Style"
                        value={
                          styleAlignment.status === 'APPROVED'
                            ? 'Customer approved your interpretation before cutting'
                            : styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
                              ? 'Waiting on customer approval before cutting'
                              : styleAlignment.status === 'CHANGES_REQUESTED'
                                ? 'Customer asked for clarification before cutting'
                                : 'Confirm what can and cannot be matched from the references'
                        }
                      />
                    ) : null}
                    <BriefRow label="Proof" value="Use fresh stage photos or video for each production move" />
                  </View>
                  {styleAlignment?.requiredBeforeCutting &&
                  styleAlignment.status !== 'APPROVED' &&
                  styleAlignment.status !== 'NOT_REQUIRED' ? (
                    <Button
                      label={
                        styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
                          ? 'Update style approval request'
                          : 'Request style approval'
                      }
                      variant="secondary"
                      onPress={() => setShowStyleAlignmentModal(true)}
                    />
                  ) : null}
                </View>
              ) : null}

              {(wearerLabel || measurementSource || fitConfidence || measurementAgeText || measurementConfirmationNeeded) && (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Measurement readiness</Text>
                  <View style={styles.supportMetaList}>
                    {wearerLabel ? <BriefRow label="Wearer" value={wearerLabel} /> : null}
                    {measurementSource ? (
                      <BriefRow
                        label="Source"
                        value={MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource)}
                      />
                    ) : null}
                    {fitConfidence ? (
                      <BriefRow
                        label="Fit confidence"
                        value={FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence)}
                      />
                    ) : null}
                    {measurementAgeText ? (
                      <BriefRow label="Last updated" value={measurementAgeText} />
                    ) : null}
                  </View>
                  {measurementAge?.stale ? (
                    <Text style={styles.supportWarningText}>
                      These measurements are over {STALE_MEASUREMENT_MONTHS} months old. Confirm
                      the customer still wants to use them before cutting.
                    </Text>
                  ) : null}
                  {measurementConfirmationNeeded ? (
                    <>
                      <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                        <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                          Customer confirmation pending
                        </Text>
                      </View>
                      {order.measurements?.confirmationReason ? (
                        <Text style={styles.supportBodyText}>{order.measurements.confirmationReason}</Text>
                      ) : null}
                      {measurementConfirmationFields.length > 0 ? (
                        <View style={styles.measurementConfirmFieldWrap}>
                          {measurementConfirmationFields.map((field) => (
                            <View key={field} style={styles.measurementConfirmFieldChip}>
                              <Text style={styles.measurementConfirmFieldText}>{labelMeasurementField(field)}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : PRE_CUTTING_STAGES.includes(order.stage) ? (
                    <>
                      <Text style={styles.supportHint}>
                        If anything looks off, ask the customer to confirm before you move into cutting.
                      </Text>
                      <Button
                        label="Request measurement confirmation"
                        variant="secondary"
                        onPress={() => setShowMeasurementRequestModal(true)}
                      />
                    </>
                  ) : null}
                </View>
              )}

              {fitProfile ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Fit notes</Text>
                  <View style={styles.supportMetaList}>
                    {fitProfile.status ? (
                      <BriefRow label="Status" value={formatMeasurementStatusLabel(fitProfile.status)} />
                    ) : null}
                    {fitProfile.fitIntent ? (
                      <BriefRow label="Fit direction" value={FIT_INTENT_LABELS[fitProfile.fitIntent]} />
                    ) : null}
                    {fitProfile.fabricStretch ? (
                      <BriefRow label="Stretch" value={FABRIC_STRETCH_LABELS[fitProfile.fabricStretch]} />
                    ) : null}
                    {fitProfile.wearDaySupport ? (
                      <BriefRow label="Support" value={WEAR_DAY_SUPPORT_LABELS[fitProfile.wearDaySupport]} />
                    ) : null}
                    {fitProfile.coveragePreference ? (
                      <BriefRow label="Coverage" value={COVERAGE_PREFERENCE_LABELS[fitProfile.coveragePreference]} />
                    ) : null}
                    {typeof fitProfile.heelHeightCm === 'number' ? (
                      <BriefRow label="Heel height" value={`${fitProfile.heelHeightCm} cm`} />
                    ) : null}
                  </View>
                  {fitProfile.styleEaseNotes ? <Text style={styles.supportHint}>{fitProfile.styleEaseNotes}</Text> : null}
                  {fitProfile.postureNote ? <Text style={styles.supportHint}>Posture: {fitProfile.postureNote}</Text> : null}
                  {fitProfile.asymmetryNote ? <Text style={styles.supportHint}>Asymmetry: {fitProfile.asymmetryNote}</Text> : null}
                  {fitProfile.tailorMeasurementOverrideReason ? (
                    <Text style={styles.supportHint}>Tailor review note: {fitProfile.tailorMeasurementOverrideReason}</Text>
                  ) : null}
                  {fitProfileReviewNeeded ? (
                    <>
                      <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                        <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                          Tailor review required before cutting
                        </Text>
                      </View>
                      <Button
                        label="Confirm fit readiness"
                        variant="secondary"
                        onPress={() => setShowFitReadinessModal(true)}
                      />
                    </>
                  ) : fitProfile.tailorMeasurementOverride ? (
                    <View style={[styles.supportBadge, styles.supportBadgeSuccess]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextSuccess]}>
                        Fit notes reviewed
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {(order.fabricSource === 'CUSTOMER_SUPPLIES' || fabricHandoffLabel || fabricPolicy || materialIssue || fabricDescription || fabricApprovalStatus) && (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>{order.fabricSource === 'TAILOR_SOURCES' ? 'Fabric sourcing' : 'Fabric handoff'}</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow
                      label="Fabric source"
                      value={order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer supplies' : 'Tailor sources'}
                    />
                    {fabricHandoffLabel ? <BriefRow label="Handoff plan" value={fabricHandoffLabel} /> : null}
                    {fabricDescription ? <BriefRow label="Customer wants" value={fabricDescription} /> : null}
                    {fabricBudgetAmount != null ? (
                      <BriefRow
                        label="Fabric budget"
                        value={formatAmount(fabricBudgetAmount, fabricBudgetCurrency as CurrencyCode, fabricBudgetCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {fabricSourcingDeadlineDays ? (
                      <BriefRow label="Sourcing update due" value={`${fabricSourcingDeadlineDays} business days`} />
                    ) : null}
                    {fabricApprovalStatus ? <BriefRow label="Approval status" value={fabricApprovalStatus} /> : null}
                    {order.supportMeta.fabricReceivedAt ? (
                      <BriefRow
                        label="Received"
                        value={new Date(order.supportMeta.fabricReceivedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      />
                    ) : null}
                  </View>
                  {order.supportMeta.fabricReceivedNote ? (
                    <Text style={styles.supportHint}>{order.supportMeta.fabricReceivedNote}</Text>
                  ) : null}
                  {!order.supportMeta.fabricReceivedAt && order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                    <Text style={styles.supportHint}>
                      Ask the customer to keep dropoff photos, courier tracking, or receipt proof in this order thread before you confirm fabric receipt.
                    </Text>
                  ) : null}
                  {order.fabricSource === 'TAILOR_SOURCES' &&
                  order.customDetail?.fabricApprovalStatus !== 'APPROVED' ? (
                    <Text style={styles.supportHint}>
                      Upload sourced-fabric proof and wait for the customer's approval before cutting
                      starts. Use natural light, show the weave/texture clearly, and add a white paper
                      reference when color accuracy matters.
                    </Text>
                  ) : null}
                  {fabricPolicy?.rejectionReasons && fabricPolicy.rejectionReasons.length > 0 ? (
                    <Text style={styles.supportHint}>Tailor can reject before cutting for: {fabricPolicy.rejectionReasons.join(' · ')}</Text>
                  ) : null}
                  {fabricPolicy?.prepRequirements && fabricPolicy.prepRequirements.length > 0 ? (
                    <Text style={styles.supportHint}>Prep: {fabricPolicy.prepRequirements.join(' · ')}</Text>
                  ) : null}
                  {fabricPolicy?.lateFabricRule ? (
                    <Text style={styles.supportHint}>If fabric is late: {fabricPolicy.lateFabricRule}</Text>
                  ) : null}
                  {fabricPolicy?.missingFabricRule ? (
                    <Text style={styles.supportHint}>If fabric never arrives: {fabricPolicy.missingFabricRule}</Text>
                  ) : null}
                  {fabricPolicy?.replacementRule ? (
                    <Text style={styles.supportHint}>Replacement rule: {fabricPolicy.replacementRule}</Text>
                  ) : null}
                  {fabricPolicy?.disagreementRule ? (
                    <Text style={styles.supportHint}>Disagreement rule: {fabricPolicy.disagreementRule}</Text>
                  ) : null}
                  {waitingOnTailorSourcing ? (
                    <View style={[styles.supportBadge, styles.supportBadgeSuccess]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextSuccess]}>
                        Customer approved tailor sourcing
                      </Text>
                    </View>
                  ) : null}
                  {canConfirmFabricReceived ? (
                    <Button
                      label="Confirm fabric received"
                      variant="secondary"
                      onPress={confirmFabricReceived}
                      loading={confirmingFabricReceived}
                      disabled={confirmingFabricReceived}
                    />
                  ) : null}
                </View>
              )}

              {order.orderKind === 'CUSTOM' && materialIssue ? (
                <View style={[styles.supportCard, materialIssueOpen && styles.supportCardWarning]}>
                  <Text style={styles.supportCardTitle}>Material issue</Text>
                  {materialIssueReasonLabel ? <BriefRow label="Issue" value={materialIssueReasonLabel} /> : null}
                  {materialIssue.note ? <Text style={styles.supportBodyText}>{materialIssue.note}</Text> : null}
                  {materialIssueNeedsCustomerDecision ? (
                    <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                        Waiting on the customer
                      </Text>
                    </View>
                  ) : materialIssueCancellationRequested ? (
                    <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                        Customer requested cancellation review
                      </Text>
                    </View>
                  ) : materialIssueResponseLabel ? (
                    <BriefRow label="Customer response" value={materialIssueResponseLabel} />
                  ) : null}
                  {materialIssue.responseNote ? <Text style={styles.supportHint}>{materialIssue.responseNote}</Text> : null}
                  {PRE_CUTTING_STAGES.includes(order.stage) && !materialIssueOpen ? (
                    <Button
                      label="Open material issue"
                      variant="secondary"
                      onPress={() => setShowMaterialIssueModal(true)}
                    />
                  ) : null}
                </View>
              ) : order.orderKind === 'CUSTOM' && PRE_CUTTING_STAGES.includes(order.stage) && order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Material issue</Text>
                  <Text style={styles.supportHint}>
                    If the customer fabric is unsuitable before cutting, open a material issue instead of moving the order forward blindly.
                  </Text>
                  <Button
                    label="Open material issue"
                    variant="secondary"
                    onPress={() => setShowMaterialIssueModal(true)}
                  />
                </View>
              ) : null}

              {order.orderKind === 'CUSTOM' ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Material advance</Text>
                  <Text style={styles.supportHint}>
                    Use this only when the customer needs to approve and pay for a specific fabric, embroidery, lining, or order material. Drapeon never releases the main escrow early.
                  </Text>
                  {materialAdvances.length > 0 ? (
                    <View style={styles.supportMetaList}>
                      {materialAdvances.map((advance) => {
                        const amountLabel = formatAmount(
                          advance.amount,
                          advance.currency,
                          advance.currency,
                          STATIC_FALLBACK_RATES
                        )
                        const receiptNeeded = ['PAID', 'OPS_REVIEW', 'RELEASED'].includes(advance.status) && !advance.receiptUrl
                        return (
                          <View key={advance.id} style={styles.advanceRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.advanceTitle}>{advance.title}</Text>
                              <Text style={styles.supportHint}>
                                {amountLabel} · {formatMaterialAdvanceStatusLabel(advance.status, 'tailor')}
                              </Text>
                              {advance.description ? (
                                <Text style={styles.supportBodyText}>{advance.description}</Text>
                              ) : null}
                              {advance.receiptUrl ? (
                                <Text style={styles.supportHint}>Receipt proof uploaded.</Text>
                              ) : null}
                            </View>
                            {receiptNeeded ? (
                              <Button
                                label="Receipt"
                                variant="secondary"
                                onPress={() => chooseMaterialAdvanceReceiptSource(advance)}
                                loading={uploadingAdvanceReceiptId === advance.id}
                                disabled={!!uploadingAdvanceReceiptId}
                              />
                            ) : null}
                          </View>
                        )
                      })}
                    </View>
                  ) : null}
                  {!hasActiveMaterialAdvance ? (
                    <Button
                      label="Request material advance"
                      variant="secondary"
                      onPress={() => setShowMaterialAdvanceModal(true)}
                    />
                  ) : (
                    <Text style={styles.supportHint}>
                      Finish or resolve the open material advance before requesting another one.
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {hasMeasurementContent(order.measurements) ? (
            <View style={styles.section}>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Measurement profile</Text>
                <Text style={styles.supportHint}>
                  Review saved body context, fit flags, and garment-specific values in one focused view before you cut, confirm readiness, or ask the customer to verify anything.
                </Text>
                <Button
                  label="Review measurements"
                  variant="secondary"
                  onPress={() => setShowMeasurementSheet(true)}
                />
              </View>
            </View>
          ) : null}

          {/* Brief details */}
          <View style={styles.section}>
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>{briefDossier.title}</Text>
              <Text style={styles.supportHint}>
                {briefDossier.sections.length === 1
                  ? '1 section is ready for review.'
                  : briefDossier.sections.length + ' sections are ready for review.'} Open the focused dossier to inspect style references, fabric planning, fulfillment, and long-form notes without crowding the main order screen.
              </Text>
              <Button
                label="Open brief dossier"
                variant="secondary"
                onPress={() => setShowDossierSheet(true)}
              />
            </View>

            {activeOrderCallAvailable ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Talk in Drapeon</Text>
                <Text style={styles.supportHint}>
                  Use a Drapeon call for fit, fabric, or timeline details that need a quick conversation. Keep final decisions in Messages so the order record stays clear.
                </Text>
                <Button
                  label={startingOrderCall ? 'Starting Drapeon call...' : order.videoCallUrl ? 'Join Drapeon call' : 'Call customer in Drapeon'}
                  variant="secondary"
                  onPress={openOrderCallOptions}
                  disabled={!!startingOrderCall}
                />
              </View>
            ) : null}

            {handoffHelpAvailable ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>{handoffHelpCardTitle('TAILOR', order.deliveryMethod)}</Text>
                <Text style={styles.supportHint}>{handoffHelpCardBody('TAILOR', order.deliveryMethod)}</Text>
                {handoffIssue ? (
                  <View style={styles.handoffIssueCard}>
                    <View style={styles.handoffIssueHeader}>
                      <Text style={styles.handoffIssueTitle}>{handoffIssueLabel(handoffIssue.issueType)}</Text>
                      <View
                        style={[
                          styles.handoffStatusPill,
                          handoffIssue.status === 'ESCALATED' && styles.handoffStatusPillEscalated,
                        ]}
                      >
                        <Text style={styles.handoffStatusText}>{handoffIssueStatusLabel(handoffIssue.status)}</Text>
                      </View>
                    </View>
                    {handoffIssue.description ? <Text style={styles.supportHint}>{handoffIssue.description}</Text> : null}
                    <Text style={styles.supportHint}>
                      {handoffIssue.status === 'ESCALATED'
                        ? 'Drapeon support has been flagged for follow-up. Keep all updates in this order thread.'
                        : 'This handoff help thread is open inside Drapeon. Keep all updates here so the timeline stays clear.'}
                    </Text>
                    <Button
                      label="Mark help resolved"
                      variant="secondary"
                      onPress={() => { void markHandoffIssueResolved() }}
                      loading={resolvingHandoffIssue}
                      disabled={resolvingHandoffIssue}
                    />
                  </View>
                ) : null}
                <View style={{ gap: Spacing.md }}>
                  <Button
                    label={startingOrderCall ? 'Starting Drapeon call...' : order.videoCallUrl ? 'Join Drapeon call' : 'Start Drapeon call'}
                    variant="secondary"
                    onPress={openOrderCallOptions}
                    disabled={!!startingOrderCall}
                  />
                  <Button
                    label={handoffIssue ? 'Log another help issue' : 'Log handoff help'}
                    variant="secondary"
                    onPress={() => setShowHandoffSupport(true)}
                  />
                </View>
              </View>
            ) : null}
          </View>

          {/* Reference photos */}
          {visibleReferencePhotos.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reference photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                  {referenceMediaItems.map((item, index, items) => (
                    <TouchableOpacity
                      key={item.uri}
                      onPress={() => openMediaPreview(items, index)}
                      activeOpacity={0.9}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open ${item.label}`}
                    >
                      <RemoteImage
                        uri={item.uri}
                        bucket="order-photos"
                        style={styles.refPhoto}
                        contentFit="contain"
                        transition={120}
                        surface="tailor_order_reference_photo"
                        onLoadError={() => {
                          setFailedReferencePhotos((prev) => prev.includes(item.uri) ? prev : [...prev, item.uri])
                        }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Aftercare</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Post-handoff expectations</Text>
                <Text style={styles.supportHint}>
                  Keep any fit, finish, alteration, remake, or workmanship follow-up inside Drapeon. Obvious issues should be
                  answered quickly, and any remedy should stay tied to the order timeline so support can help if the
                  conversation becomes disputed later.
                </Text>
              </View>
            </View>
          )}

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Next step</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>
                  {hasCustomerReview ? 'Customer review saved' : 'Review this customer'}
                </Text>
                <Text style={styles.supportHint}>
                  {hasCustomerReview
                    ? 'Your internal customer review is already saved. You can head back to Orders or keep this record for future reference.'
                    : 'Leave an internal customer review so future work has better context. This stays inside Drapeon and is not public.'}
                </Text>
                {!hasCustomerReview ? (
                  <Button
                    label="Review customer"
                    onPress={() => { void openCustomerReview() }}
                  />
                ) : null}
                <Button
                  label="Back to orders"
                  variant="secondary"
                  onPress={() => router.replace('/(tailor)/orders')}
                />
              </View>
            </View>
          )}

        </View>
      </ScrollView>

      <DrapeFloatingActionDock testID="tailor-order-message-dock">
        <DrapeCapsuleButton
          label={conversationCtaLabel}
          tone="primary"
          icon="message-circle"
          style={{ flex: 1 }}
          onPress={openOrderMessages}
        />
      </DrapeFloatingActionDock>

      <HandoffSupportModal
        visible={showHandoffSupport}
        orderId={order.id}
        role="TAILOR"
        deliveryMethod={order.deliveryMethod}
        onClose={() => setShowHandoffSupport(false)}
        onSubmitted={() => {
          setShowHandoffSupport(false)
          void fetchOrder()
        }}
      />

      <BottomSheetScaffold
        visible={showDossierSheet}
        testID="tailor-dossier-sheet"
        title={briefDossier.title}
        subtitle="Summary, style refs, fabric plan, fulfillment, and proof in one focused review surface."
        onDismiss={() => setShowDossierSheet(false)}
        scrollable
      >
        <View style={styles.sheetSectionStack}>
          {briefDossier.sections.map((section) => (
            <BriefDossierCard
              key={section.id}
              section={section}
              onOpenLink={openDossierLink}
              onOpenMedia={openMediaPreview}
            />
          ))}
        </View>
      </BottomSheetScaffold>

      <DrapeMediaViewer
        items={mediaPreview?.items ?? []}
        activeIndex={mediaPreview?.index ?? null}
        onDismiss={() => setMediaPreview(null)}
        testID="order-dossier-media-viewer"
      />

      <BottomSheetScaffold
        visible={showMeasurementSheet}
        testID="tailor-measurement-sheet"
        title="Measurement profile"
        subtitle="Review body context and garment-specific values before the next production step."
        onDismiss={() => setShowMeasurementSheet(false)}
        scrollable
      >
        {hasMeasurementContent(order.measurements) ? (
          <View style={styles.sheetSectionStack}>
            <BodyProfileCard measurements={order.measurements} />
            <MeasurementsSection measurements={order.measurements} />
            {measurementConfirmationNeeded ? (
              <Button
                label="Request measurement confirmation"
                variant="secondary"
                onPress={() => {
                  setShowMeasurementSheet(false)
                  setShowMeasurementRequestModal(true)
                }}
              />
            ) : null}
            {fitProfileReviewNeeded ? (
              <Button
                label="Confirm fit and cutting readiness"
                variant="secondary"
                onPress={() => {
                  setShowMeasurementSheet(false)
                  setShowFitReadinessModal(true)
                }}
              />
            ) : null}
          </View>
        ) : (
          <Text style={styles.supportHint}>No measurement profile is attached to this order yet.</Text>
        )}
      </BottomSheetScaffold>

      <BottomSheetScaffold
        visible={showFlexibleStageSheet}
        title="Choose next stage"
        subtitle={order.orderKind === 'READY_MADE'
          ? 'Move this item through its real handoff state.'
          : 'Design, fabric, and production can move in a flexible order. Pick the true next step.'}
        onDismiss={() => setShowFlexibleStageSheet(false)}
        enableDynamicSizing
        secondaryAction={{ label: 'Cancel', onPress: () => setShowFlexibleStageSheet(false), tone: 'secondary' }}
      >
        <View style={styles.stageChoiceList}>
          {flexibleNextStages?.map((target) => (
            <SelectableSettingRow
              key={target}
              label={displayStageChoiceLabel(target, order.orderKind)}
              detail={stageChoiceDetail(target, order.orderKind)}
              active={false}
              onPress={() => {
                setShowFlexibleStageSheet(false)
                openStageModal(target)
              }}
            />
          ))}
        </View>
      </BottomSheetScaffold>

      {/* Quote modal */}
      {showQuoteModal ? (
        <QuoteModal
          key={`quote-${order.id}-${quoteModalMode}-${order.activeQuoteVersion ?? 0}`}
          visible
          orderId={order.id}
          mode={quoteModalMode}
          quoteId={order.activeQuoteId}
          expectedQuoteVersion={order.activeQuoteVersion}
          revisionRequestId={openQuoteRevision?.id ?? null}
          initialAmount={quoteModalMode === 'revise' ? order.quotedAmount : null}
          initialCompletionDate={quoteModalMode === 'revise' ? order.quotedCompletionDate : null}
          defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          deliveryMethod={order.deliveryMethod}
          customerDeadline={order.deadline}
          onClose={() => setShowQuoteModal(false)}
          onSent={() => { setShowQuoteModal(false); fetchOrder() }}
        />
      ) : null}

      <DrapeSheet
        visible={showRevisionResponseSheet}
        title="Respond to quote changes"
        subtitle={openQuoteRevision
          ? `Revision ${openQuoteRevision.roundNumber} of ${order.negotiationRoundLimit}`
          : undefined}
        onDismiss={() => setShowRevisionResponseSheet(false)}
        enableDynamicSizing
      >
        <View style={styles.stageChoiceList}>
          <Text style={styles.supportHint}>
            Keep the current quote only when its price, scope, and date still cover the requested changes. The customer will receive a formal event either way.
          </Text>
          <DrapeCapsuleButton
            label="Keep current quote"
            loading={revisionResponseSaving}
            onPress={() => { void respondToQuoteRevision('keep-current-quote') }}
          />
          <DrapeCapsuleButton
            label="Decline order"
            tone="destructive"
            disabled={revisionResponseSaving}
            onPress={() => { void respondToQuoteRevision('decline-after-revision') }}
          />
        </View>
      </DrapeSheet>

      {/* Stage update modal */}
      {showStageModal && stageModalTarget ? (
        <StageUpdateModal
          key={`stage-${order.id}-${stageModalTarget}`}
          visible
          order={order}
          targetStage={stageModalTarget}
          onClose={() => setShowStageModal(false)}
          onUpdated={async (updatedStage) => {
            setShowStageModal(false)
            await fetchOrder()
            if (updatedStage === 'FINISHING' && order.deliveryMethod !== 'LOCAL_COLLECTION') {
              Alert.alert(
                'Preparing order',
                'Keep packing and checking this order. When it is truly ready, come back here and mark it ready for Drapeon dispatch.',
              )
            }
          }}
        />
      ) : null}

      {/* Consultation modal */}
      {showConsultationModal ? (
        <ConsultationModal
          key={`consultation-${order.id}-${consultationModalAction}`}
          visible
          orderId={order.id}
          action={consultationModalAction}
          defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          onClose={() => setShowConsultationModal(false)}
          onSent={() => { setShowConsultationModal(false); fetchOrder() }}
        />
      ) : null}

      {showMeasurementRequestModal ? (
        <MeasurementConfirmationRequestModal
          key={`measurements-${order.id}`}
          visible
          orderId={order.id}
          measurements={order.measurements}
          onClose={() => setShowMeasurementRequestModal(false)}
          onSent={() => {
            setShowMeasurementRequestModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showFitReadinessModal ? (
        <FitReadinessModal
          key={`fit-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowFitReadinessModal(false)}
          onSent={() => {
            setShowFitReadinessModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showStyleAlignmentModal ? (
        <StyleAlignmentRequestModal
          key={`style-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowStyleAlignmentModal(false)}
          onSent={() => {
            setShowStyleAlignmentModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showMaterialIssueModal ? (
        <MaterialIssueModal
          key={`material-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowMaterialIssueModal(false)}
          onSent={() => {
            setShowMaterialIssueModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showMaterialAdvanceModal ? (
        <MaterialAdvanceRequestModal
          key={`material-advance-${order.id}`}
          visible
          orderId={order.id}
          currency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          onClose={() => setShowMaterialAdvanceModal(false)}
          onSent={() => {
            setShowMaterialAdvanceModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showCancellationReviewModal ? (
        <CancellationReviewRequestModal
          key={`cancel-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowCancellationReviewModal(false)}
          onSent={() => {
            setShowCancellationReviewModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showDeliveryReviewModal ? (
        <DeliveryReviewRequestModal
          key={`delivery-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowDeliveryReviewModal(false)}
          onSent={() => {
            setShowDeliveryReviewModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showScopeChangeModal ? (
        <ScopeChangeRequestModal
          key={`scope-change-${order.id}`}
          visible
          orderId={order.id}
          currency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          onClose={() => setShowScopeChangeModal(false)}
          onSent={() => {
            setShowScopeChangeModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {/* Collection code modal */}
      {showCodeModal ? (
        <CollectionCodeModal
          key={`code-${order.id}-${order.collectionCode ?? ''}`}
          visible
          orderId={order.id}
          onClose={() => setShowCodeModal(false)}
          onConfirmed={async () => {
            setShowCodeModal(false)
            await fetchOrder()
            Alert.alert(
              'Collection confirmed',
              hasCustomerReview
                ? 'Pickup is complete. The customer can finish the order in Drapeon now.'
                : 'Pickup is complete. You can review this customer next or head back to Orders.',
              hasCustomerReview
                ? [
                    { text: 'Stay here', style: 'cancel' },
                    { text: 'Back to orders', onPress: () => router.replace('/(tailor)/orders') },
                  ]
                : [
                    { text: 'Back to orders', style: 'cancel', onPress: () => router.replace('/(tailor)/orders') },
                    { text: 'Review customer', onPress: () => { void openCustomerReview() } },
                  ],
            )
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

// ─── Body Profile Card ────────────────────────────────────────────────────────

function BodyProfileCard({ measurements: m }: { measurements: Measurement }) {
  const bodyShapes = asStringList(m.bodyShape)
  const fitFlags = asStringList(m.fitFlags)

  return (
    <View style={styles.bodyCard}>
      <Text style={styles.bodyCardTitle}>Body profile</Text>
      <View style={styles.bodyCardRow}>
        {m.garmentContext && (
          <BodyRow label="Cut context" value={GARMENT_CONTEXT_LABELS[m.garmentContext] ?? m.garmentContext} />
        )}
        {bodyShapes.length > 0 && (
          <BodyRow
            label="Shape"
            value={bodyShapes.map((shape) => BODY_SHAPE_LABELS[shape] ?? shape).join(', ')}
          />
        )}
      </View>
      {fitFlags.length > 0 && (
        <View style={styles.fitFlagsRow}>
          {fitFlags.map((f) => (
            <View key={f} style={styles.fitFlagBadge}>
              <Text style={styles.fitFlagText}>{labelFitContextFlag(f)}</Text>
            </View>
          ))}
        </View>
      )}
      {m.bodyNote && (
        <View style={styles.bodyNote}>
          <Text style={styles.bodyNoteText}>"{m.bodyNote}"</Text>
        </View>
      )}
    </View>
  )
}

function BodyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flex: 1 }}>
      <Text style={{ fontSize: FontSize.xs, color: Colors.midGrey }}>{label}</Text>
      <Text style={{ fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.ink }}>{decodeDisplayText(value)}</Text>
    </View>
  )
}

// ─── Measurements Section ─────────────────────────────────────────────────────

function MeasurementsSection({ measurements: m }: { measurements: Measurement }) {
  const additionalRows = getAdditionalMeasurementRows(m)
  const rows = [
    { label: 'Chest', value: m.chest }, { label: 'Waist', value: m.waist },
    { label: 'Hips', value: m.hips }, { label: 'Shoulders', value: m.shoulderWidth },
    { label: 'Inseam', value: m.inseam }, { label: 'Sleeve', value: m.sleeveLength },
    { label: 'Neck', value: m.neckCircumference }, { label: 'Height', value: m.height },
    { label: 'Back length', value: m.backLength }, { label: 'Outseam', value: m.outseam },
    { label: 'Thigh', value: m.thighCircumference }, { label: 'Knee', value: m.kneeCircumference },
    { label: 'Torso', value: m.torsoLength },
  ]
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Measurements {m.fitStyle && <Text style={styles.fitStyleTag}>· {m.fitStyle} fit</Text>}</Text>
      <View style={styles.measureGrid}>
        {rows.map(({ label, value }) => (
          <View key={label} style={styles.measureItem}>
            <Text style={styles.measureLabel}>{label}</Text>
            <Text style={[styles.measureValue, !value && { color: Colors.lightGrey }]}>
              {value ? `${value} ${m.unit}` : 'Not added'}
            </Text>
          </View>
        ))}
      </View>
      {additionalRows.length > 0 ? (
        <View style={styles.additionalMeasureBlock}>
          <Text style={styles.additionalMeasureTitle}>Garment-specific measurements</Text>
          <View style={styles.measureGrid}>
            {additionalRows.map(({ label, value }) => (
              <View key={label} style={styles.measureItem}>
                <Text style={styles.measureLabel}>{label}</Text>
                <Text style={styles.measureValue}>{String(value)} {m.unit}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function hasMeasurementContent(measurements: Measurement | null): measurements is Measurement {
  if (!measurements) return false

  const numericFields = [
    measurements.chest,
    measurements.waist,
    measurements.hips,
    measurements.shoulderWidth,
    measurements.inseam,
    measurements.sleeveLength,
    measurements.neckCircumference,
    measurements.height,
    measurements.backLength,
    measurements.outseam,
    measurements.thighCircumference,
    measurements.kneeCircumference,
    measurements.torsoLength,
  ]

  if (numericFields.some((value) => typeof value === 'number' && Number.isFinite(value))) return true
  if (typeof measurements.fitStyle === 'string' && measurements.fitStyle.trim().length > 0) return true
  if (typeof measurements.garmentContext === 'string' && measurements.garmentContext.trim().length > 0) return true
  if (asStringList(measurements.bodyShape).length > 0) return true
  if (asStringList(measurements.fitFlags).length > 0) return true
  if (typeof measurements.bodyNote === 'string' && measurements.bodyNote.trim().length > 0) return true
  if (getAdditionalMeasurementRows(measurements).length > 0) return true

  return false
}

const MATERIAL_ISSUE_REASON_OPTIONS: MaterialIssueReason[] = [
  'POOR_FABRIC_QUALITY',
  'INSUFFICIENT_YARDAGE',
  'FABRIC_NOT_RECEIVED',
  'WRONG_FABRIC_TYPE',
  'FABRIC_DAMAGED',
  'FABRIC_MISMATCH',
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

function ScopeChangeRequestModal({ visible, orderId, currency, onClose, onSent }: {
  visible: boolean
  orderId: string
  currency: CurrencyCode
  onClose: () => void
  onSent: () => void
}) {
  const [type, setType] = useState<ScopeChangeType | null>(null)
  const [impacts, setImpacts] = useState<ScopeChangeImpact[]>([])
  const [summary, setSummary] = useState('')
  const [priceImpact, setPriceImpact] = useState('')
  const [deadlineImpact, setDeadlineImpact] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [priceError, setPriceError] = useState('')
  const [sending, setSending] = useState(false)

  function toggleImpact(value: ScopeChangeImpact) {
    setImpacts((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  function validateSummary(value: string) {
    if (value.trim().length < 10) {
      setSummaryError('Explain what changed and what the customer needs to approve.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Change note')
    if (placeholder) {
      setSummaryError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setSummaryError("Contact details can't be included.")
      return false
    }
    setSummaryError('')
    return true
  }

  function validatePrice(value: string) {
    if (!value.trim()) {
      setPriceError('')
      return true
    }
    const parsed = parseMoneyToMinorUnits(value)
    if (parsed == null) {
      setPriceError('Enter a valid added price, or leave this blank.')
      return false
    }
    setPriceError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!type) {
      Alert.alert('Choose a change type', 'Pick what kind of order change this is before sending it.')
      return
    }
    if (!validateSummary(summary)) return
    if (!validatePrice(priceImpact)) return

    const priceImpactMinor = parseMoneyToMinorUnits(priceImpact)
    const nextImpacts = [
      ...new Set([
        ...impacts,
        ...(priceImpactMinor && priceImpactMinor > 0 ? ['PRICE' as const] : []),
        ...(deadlineImpact.trim() ? ['DEADLINE' as const] : []),
      ]),
    ]

    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-scope-change',
        scopeChangeType: type,
        scopeChangeSummary: summary.trim(),
        scopeChangeImpacts: nextImpacts,
        priceImpactMinor,
        deadlineImpact: deadlineImpact.trim() || undefined,
      },
    })
    setSending(false)

    if (error) {
      Alert.alert(
        'Change unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your change stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not send this change request right now.'),
      )
      return
    }
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Propose change</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Keep changes formal</Text>
              <Text style={styles.supportWarningText}>
                Use this when the order scope, measurements, fabric, deadline, or rework plan changes. The customer sees it in the order timeline before you continue.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>Change type <Text style={styles.required}>*</Text></Text>
              {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.reasonRow, type === option && styles.reasonRowActive]}
                  disabled={sending}
                  onPress={() => setType(option)}
                >
                  <View style={[styles.reasonRadio, type === option && styles.reasonRadioActive]} />
                  <Text style={[styles.reasonText, type === option && styles.reasonTextActive]}>
                    {SCOPE_CHANGE_TYPE_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>What this affects</Text>
              {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => {
                const active = impacts.includes(option)
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.reasonRow, active && styles.reasonRowActive]}
                    disabled={sending}
                    onPress={() => toggleImpact(option)}
                  >
                    <View style={[styles.reasonRadio, active && styles.reasonRadioActive]} />
                    <Text style={[styles.reasonText, active && styles.reasonTextActive]}>
                      {SCOPE_CHANGE_IMPACT_LABELS[option]}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Input
              label="What changed?"
              placeholder="e.g. The sleeve reference needs a different cuff, which adds embroidery time before cutting."
              value={summary}
              onChangeText={(value) => {
                setSummary(value)
                if (summaryError) validateSummary(value)
              }}
              onBlur={() => validateSummary(summary)}
              error={summaryError}
              multiline
              numberOfLines={4}
              maxLength={500}
              filterContact
              required
            />

            <Input
              label={`Added price (${currency}, optional)`}
              placeholder="0.00"
              value={priceImpact}
              onChangeText={(value) => {
                setPriceImpact(value)
                if (priceError) validatePrice(value)
              }}
              onBlur={() => validatePrice(priceImpact)}
              error={priceError}
              keyboardType="decimal-pad"
            />

            <Input
              label="Deadline impact (optional)"
              placeholder="e.g. Adds 3 days, or no deadline change."
              value={deadlineImpact}
              onChangeText={setDeadlineImpact}
              maxLength={120}
            />

            <Button
              label="Send change request"
              onPress={send}
              loading={sending}
              disabled={sending || !type || summary.trim().length < 10 || !!summaryError || !!priceError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function MeasurementConfirmationRequestModal({ visible, orderId, measurements, onClose, onSent }: {
  visible: boolean
  orderId: string
  measurements: Measurement | null
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const fieldOptions = [
    'chest',
    'waist',
    'hips',
    'shoulderWidth',
    'inseam',
    'sleeveLength',
    'neckCircumference',
    'height',
    'backLength',
    'outseam',
    'thighCircumference',
    'kneeCircumference',
    'torsoLength',
  ]
    .filter((key) => measurements?.[key] != null)
    .map((key) => ({ key, label: labelMeasurementField(key), value: measurements?.[key] }))
    .concat(getAdditionalMeasurementRows(measurements).map((row) => ({ key: row.label, label: row.label, value: row.value })))

  function toggleField(field: string) {
    setSelectedFields((previous) =>
      previous.includes(field)
        ? previous.filter((item) => item !== field)
        : [...previous, field],
    )
  }

  function validateNote(value: string) {
    if (value.trim().length < 10) {
      setNoteError('Tell the customer what needs confirming before cutting can start.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-measurement-confirmation',
        note: note.trim(),
        fields: selectedFields,
      },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Request unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not request measurement confirmation right now.'),
      )
      return
    }
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Measurement confirmation</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Pause cutting until this is answered</Text>
              <Text style={styles.supportWarningText}>
                Select exact fields when possible. Drapeon will show the customer a focused task before cutting can start.
              </Text>
            </View>

            {fieldOptions.length > 0 ? (
              <View style={styles.measurementFieldPicker}>
                <Text style={styles.modalSectionLabel}>Fields to confirm</Text>
                <View style={styles.choiceList}>
                  {fieldOptions.map((option) => {
                    const active = selectedFields.includes(option.key)
                    return (
                      <SelectableSettingRow
                        key={option.key}
                        label={option.label}
                        detail={`${String(option.value)} ${measurements?.unit ?? ''}`.trim()}
                        active={active}
                        onPress={() => toggleField(option.key)}
                      />
                    )
                  })}
                </View>
                <Text style={styles.modalHelpText}>
                  Leave unselected only if the question is general. Selected fields travel with the order and Vision review.
                </Text>
              </View>
            ) : null}

            <Input
              label="What needs confirming?"
              placeholder="e.g. Please confirm the sleeve and shoulder measurements before I cut the fabric."
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
              required
            />

            <Button
              label="Send request"
              onPress={send}
              loading={sending}
              disabled={sending || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function FitReadinessModal({ visible, orderId, onClose, onSent }: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  function validateNote(value: string) {
    if (value.trim().length < 10) {
      setNoteError('Explain what you reviewed before clearing this blocker.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'confirm-fit-readiness', note: note.trim() },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Review unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not confirm fit readiness right now.'),
      )
      return
    }
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Confirm fit readiness</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Clear this only after review</Text>
              <Text style={styles.supportWarningText}>
                Use this once you have reviewed the fit notes and are comfortable moving the order toward cutting.
              </Text>
            </View>

            <Input
              label="What did you verify?"
              placeholder="e.g. I reviewed the posture and symmetry notes against the garment plan, and I can cut with the current measurements."
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
              required
            />

            <Button
              label="Confirm fit readiness"
              onPress={send}
              loading={sending}
              disabled={sending || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function StyleAlignmentRequestModal({ visible, orderId, onClose, onSent }: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  function validateNote(value: string) {
    const trimmed = value.trim()
    if (trimmed.length < 10) {
      setNoteError('Explain the style interpretation before asking for approval.')
      return false
    }
    const placeholder = rejectPlaceholder(trimmed, 'Style note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(trimmed)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'request-style-alignment', note: note.trim() },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Style approval unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not request style approval right now.'),
      )
      return
    }
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Style approval</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Do this before cutting</Text>
              <Text style={styles.supportWarningText}>
                Tell the customer what you can match from the references, what may differ because of fabric or budget,
                and what silhouette or finish you plan to cut.
              </Text>
            </View>

            <Input
              label="Interpretation for customer approval"
              placeholder="e.g. I will keep the same neckline and sleeve shape, use the closest available lace, and make the fit relaxed as requested."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={5}
              maxLength={500}
              filterContact
              required
            />

            <Button
              label="Send for approval"
              onPress={send}
              loading={sending}
              disabled={sending || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function MaterialIssueModal({ visible, orderId, onClose, onSent }: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [reason, setReason] = useState<MaterialIssueReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  function validateNote(value: string) {
    if (value.trim().length < 10) {
      setNoteError('Describe the material issue clearly so the customer can choose what to do next.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!reason) {
      Alert.alert('Choose a reason', 'Pick the fabric issue before sending this to the customer.')
      return
    }
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'open-material-issue', reason, note: note.trim() },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Issue unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not open this material issue right now.'),
      )
      return
    }
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Open material issue</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Use this before cutting only</Text>
              <Text style={styles.supportWarningText}>
                Keep the reason specific so the customer can replace fabric, ask you to source it, revise the design, or request cancellation.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>Issue reason <Text style={styles.required}>*</Text></Text>
              {MATERIAL_ISSUE_REASON_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.reasonRow, reason === option && styles.reasonRowActive]}
                  disabled={sending}
                  onPress={() => setReason(option)}
                >
                  <View style={[styles.reasonRadio, reason === option && styles.reasonRadioActive]} />
                  <Text style={[styles.reasonText, reason === option && styles.reasonTextActive]}>
                    {MATERIAL_ISSUE_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="What should the customer know?"
              placeholder="e.g. The supplied fabric is not enough for the agreed style, so I need a replacement or a design change before cutting."
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
              required
            />

            <Button
              label="Send issue to customer"
              onPress={send}
              loading={sending}
              disabled={sending || !reason || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function MaterialAdvanceRequestModal({ visible, orderId, currency, onClose, onSent }: {
  visible: boolean
  orderId: string
  currency: CurrencyCode
  onClose: () => void
  onSent: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [titleError, setTitleError] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [amountError, setAmountError] = useState('')
  const [sending, setSending] = useState(false)

  function parseAmountMinor(value: string) {
    const normalized = value.replace(/,/g, '').trim()
    if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) return Number.NaN
    return Math.round(Number.parseFloat(normalized) * 100)
  }

  function validateTitle(value: string) {
    if (value.trim().length < 3) {
      setTitleError('Name the material or service clearly.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Material')
    if (placeholder) {
      setTitleError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setTitleError("Contact details can't be included.")
      return false
    }
    setTitleError('')
    return true
  }

  function validateDescription(value: string) {
    if (value.trim().length < 10) {
      setDescriptionError('Explain exactly why this advance is needed before asking the customer to approve it.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Description')
    if (placeholder) {
      setDescriptionError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setDescriptionError("Contact details can't be included.")
      return false
    }
    setDescriptionError('')
    return true
  }

  function validateAmount(value: string) {
    const minor = parseAmountMinor(value)
    if (!Number.isFinite(minor) || minor <= 0) {
      setAmountError('Enter a valid amount.')
      return false
    }
    setAmountError('')
    return true
  }

  async function send() {
    if (sending) return
    const titleOk = validateTitle(title)
    const descriptionOk = validateDescription(description)
    const amountOk = validateAmount(amount)
    if (!titleOk || !descriptionOk || !amountOk) return

    setSending(true)
    const { error } = await invokeFunction('material-advance-action', {
      body: {
        action: 'request-advance',
        orderId,
        title: title.trim(),
        description: description.trim(),
        amount: parseAmountMinor(amount),
        currency,
      },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Advance unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your request stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not request this material advance right now.'),
      )
      return
    }
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Material advance</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>This is not early escrow</Text>
              <Text style={styles.supportWarningText}>
                Request only the specific material cost the customer needs to approve. The customer pays this separately, ops reviews it, and you upload receipt proof after purchase.
              </Text>
            </View>

            <Input
              label="What is this for?"
              placeholder="e.g. Beaded embroidery deposit"
              value={title}
              onChangeText={(value) => {
                setTitle(value)
                if (titleError) validateTitle(value)
              }}
              onBlur={() => validateTitle(title)}
              error={titleError}
              maxLength={120}
              filterContact
              required
            />

            <Input
              label="Why is it needed?"
              placeholder="Explain what you need to buy, why it is outside the accepted quote, and what receipt proof you will upload."
              value={description}
              onChangeText={(value) => {
                setDescription(value)
                if (descriptionError) validateDescription(value)
              }}
              onBlur={() => validateDescription(description)}
              error={descriptionError}
              multiline
              numberOfLines={5}
              maxLength={1000}
              filterContact
              required
            />

            <Input
              label={`Amount (${currency})`}
              placeholder="0.00"
              value={amount}
              onChangeText={(value) => {
                setAmount(value)
                if (amountError) validateAmount(value)
              }}
              onBlur={() => validateAmount(amount)}
              error={amountError}
              keyboardType="decimal-pad"
              required
            />

            <Button
              label="Send for customer approval"
              onPress={send}
              loading={sending}
              disabled={sending || title.trim().length < 3 || description.trim().length < 10 || !amount.trim()}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const TAILOR_CANCELLATION_REVIEW_OPTIONS: CancellationReviewReason[] = [
  'ITEM_UNAVAILABLE',
  'ITEM_DAMAGED_BEFORE_DISPATCH',
  'TAILOR_CANNOT_FULFIL',
  'DISPATCH_DELAY',
  'OTHER',
]

const TAILOR_DELIVERY_REVIEW_OPTIONS: DeliveryReviewReason[] = [
  'DISPATCH_DELAY',
  'DELIVERY_FAILED',
  'RETURN_TO_SENDER',
  'RECIPIENT_UNREACHABLE',
  'OTHER',
]

function CancellationReviewRequestModal({ visible, orderId, onClose, onSent }: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [reason, setReason] = useState<CancellationReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!reason) {
      Alert.alert('Choose a reason', 'Tell Drapeon why this order needs cancellation review before handoff.')
      return
    }
    if (!validateNote(note)) return

    setSending(true)
    setSubmitError('')

    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-cancellation-review',
        reason,
        note: note.trim() || undefined,
      },
    })

    setSending(false)
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not open cancellation review right now.')
      setSubmitError(message)
      return
    }

    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Cancellation review</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Pause handoff until reviewed</Text>
              <Text style={styles.supportWarningText}>
                Use this when the order cannot move forward cleanly before pickup or dispatch starts. Drapeon will review the remedy with you and the customer.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>Reason <Text style={styles.required}>*</Text></Text>
              {TAILOR_CANCELLATION_REVIEW_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.reasonRow, reason === option && styles.reasonRowActive]}
                  disabled={sending}
                  onPress={() => setReason(option)}
                >
                  <View style={[styles.reasonRadio, reason === option && styles.reasonRadioActive]} />
                  <Text style={[styles.reasonText, reason === option && styles.reasonTextActive]}>
                    {CANCELLATION_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. The item was damaged during final checks before dispatch."
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

            {submitError ? (
              <View style={styles.supportWarningCard}>
                <Text style={styles.supportWarningText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Request review"
              onPress={send}
              loading={sending}
              disabled={sending || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function DeliveryReviewRequestModal({ visible, orderId, onClose, onSent }: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [reason, setReason] = useState<DeliveryReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!reason) {
      Alert.alert('Choose a reason', 'Tell Drapeon what went wrong with dispatch or delivery.')
      return
    }
    if (!validateNote(note)) return

    setSending(true)
    setSubmitError('')

    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-delivery-review',
        reason,
        note: note.trim() || undefined,
      },
    })

    setSending(false)
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not open delivery review right now.')
      setSubmitError(message)
      return
    }

    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Delivery review</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Pause dispatch until reviewed</Text>
              <Text style={styles.supportWarningText}>
                Use this when Drapeon dispatch is slipping, the recipient could not be reached, or the parcel is not reaching the customer cleanly.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>Reason <Text style={styles.required}>*</Text></Text>
              {TAILOR_DELIVERY_REVIEW_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.reasonRow, reason === option && styles.reasonRowActive]}
                  disabled={sending}
                  onPress={() => setReason(option)}
                >
                  <View style={[styles.reasonRadio, reason === option && styles.reasonRadioActive]} />
                  <Text style={[styles.reasonText, reason === option && styles.reasonTextActive]}>
                    {DELIVERY_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. The rider could not reach the recipient after multiple attempts."
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

            {submitError ? (
              <View style={styles.supportWarningCard}>
                <Text style={styles.supportWarningText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Request review"
              onPress={send}
              loading={sending}
              disabled={sending || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Quote Modal ──────────────────────────────────────────────────────────────

function QuoteModal({
  visible,
  orderId,
  mode,
  quoteId,
  expectedQuoteVersion,
  revisionRequestId,
  initialAmount,
  initialCompletionDate,
  defaultCurrency,
  deliveryMethod,
  customerDeadline,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  mode: 'send' | 'revise'
  quoteId: string | null
  expectedQuoteVersion: number | null
  revisionRequestId: string | null
  initialAmount: number | null
  initialCompletionDate: string | null
  defaultCurrency: CurrencyCode
  deliveryMethod: string
  customerDeadline: string | null
  onClose: () => void
  onSent: () => void
}) {
  const currencyLabel = `${currencySymbol(defaultCurrency)} ${defaultCurrency}`
  const [amount, setAmount] = useState(initialAmount != null ? String(initialAmount / 100) : '')
  const [completionDate, setCompletionDate] = useState(
    initialCompletionDate ? initialCompletionDate.slice(0, 10) : '',
  )
  const [completionDateValue, setCompletionDateValue] = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [laborAmount, setLaborAmount] = useState('')
  const [sourcingAmount, setSourcingAmount] = useState('')
  const [rushAmount, setRushAmount] = useState('')
  const [includedText, setIncludedText] = useState('')
  const [excludedText, setExcludedText] = useState('')
  const [breakdownSummary, setBreakdownSummary] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  function defaultCompletionDateValue() {
    const next = new Date()
    next.setDate(next.getDate() + 14)
    if (customerDeadline) {
      const deadline = new Date(customerDeadline)
      if (!isNaN(deadline.getTime()) && deadline.getTime() < next.getTime()) {
        next.setTime(deadline.getTime())
      }
    }
    return next
  }

  function formatDateInput(date: Date) {
    return date.toISOString().slice(0, 10)
  }

  const effectiveCompletionDate = completionDate || formatDateInput(defaultCompletionDateValue())

  function openCompletionDatePicker() {
    const next = completionDateValue ? new Date(completionDateValue) : defaultCompletionDateValue()
    setCompletionDateValue(next)
    setCompletionDate(formatDateInput(next))
    setShowDatePicker(true)
  }

  function validateNote(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) { setNoteError("Contact details can't be included."); return false }
    setNoteError(''); return true
  }

  async function send() {
    if (sending) return
    if (!amount || !effectiveCompletionDate) return
    if (!validateNote(note)) return
    if (mode === 'revise' && (!quoteId || !expectedQuoteVersion || !revisionRequestId)) {
      Alert.alert('Quote changed', 'Refresh this order before sending a revised quote.')
      return
    }

    // Validate date — Hermes (iOS) rejects non-padded formats like "2026/04/1"
    const parsedDate = new Date(effectiveCompletionDate)
    if (isNaN(parsedDate.getTime())) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD format, e.g. 2026-04-01')
      return
    }
    const deadlineDate = customerDeadline ? new Date(customerDeadline) : null
    if (deadlineDate && parsedDate.getTime() > deadlineDate.getTime()) {
      Alert.alert(
        'Deadline exceeded',
        `This quote date goes past the customer deadline of ${deadlineDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Choose an earlier date.`
      )
      return
    }

    setSending(true)
    try {
      const amountPence = Math.round(parseFloat(amount) * 100)
      const breakdown = {
        laborAmount: parseMoneyToMinorUnits(laborAmount),
        sourcingAmount: parseMoneyToMinorUnits(sourcingAmount),
        rushAmount: parseMoneyToMinorUnits(rushAmount),
        included: parseListInput(includedText),
        excluded: parseListInput(excludedText),
        summary: breakdownSummary.trim() || undefined,
      }
      const hasBreakdown =
        breakdown.laborAmount != null ||
        breakdown.sourcingAmount != null ||
        breakdown.rushAmount != null ||
        breakdown.included.length > 0 ||
        breakdown.excluded.length > 0 ||
        !!breakdown.summary

      const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
        body: {
          orderId,
          action: mode === 'revise' ? 'revise-quote' : 'send-quote',
          ...(mode === 'revise' ? {
            quoteId,
            expectedQuoteVersion,
            revisionRequestId,
            changeKind: 'CUSTOMER_REVISION' as const,
          } : {}),
          amount: amountPence,
          currency: defaultCurrency,
          completionDate: parsedDate.toISOString(),
          breakdown: hasBreakdown ? breakdown : undefined,
          note: note.trim() || undefined,
        },
      })

      if (efError || !efData?.ok) {
        const errorPayload = efError ? await readFunctionErrorPayload(efError) : null
        const errorMessage =
          typeof efData?.error === 'string' && efData.error.length > 0
            ? efData.error
            : typeof errorPayload?.error === 'string' && errorPayload.error.length > 0
              ? errorPayload.error
              : await readFunctionErrorMessage(efError, 'Could not send this quote right now.')
        const err = new Error(errorMessage)
        Sentry.captureException(err, { extra: { context: 'send_quote', orderId } })
        throw err
      }

      capture(mode === 'revise' ? 'quote_revised' : 'quote_sent', { amount_pence: amountPence, has_note: !!note.trim() })
      onSent()
    } catch (e) {
      Sentry.captureException(e, { extra: { context: 'send_quote_submit', orderId } })
      Alert.alert(
        'Error',
        isLikelyConnectivityIssue(e)
          ? 'Connection looks weak. We could not send this quote yet. Your draft stayed here, so retry when the signal improves.'
          : e instanceof Error && e.message
            ? e.message
            : 'Could not send this quote right now. Please try again in a moment.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{mode === 'revise' ? 'Revise quote' : 'Send quote'}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Quote currency</Text>
              <Text style={styles.supportHint}>
                This order is locked to {currencyLabel} so payment, escrow, and payout stay in the same currency. To use another currency, update your payout and pricing setup before accepting new orders.
              </Text>
            </View>
            <Input
              label={`Your price (${currencyLabel})`}
              placeholder="e.g. 180"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              required
              hint={
                deliveryMethod === 'LOCAL_COLLECTION'
                  ? 'Enter the full quote the customer should pay.'
                  : 'Enter your base quote. Drapeon adds the standard dispatch fee automatically based on the customer address and your location.'
              }
              testID="quote-amount-input"
            />
            {deliveryMethod !== 'LOCAL_COLLECTION' ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Drapeon-managed dispatch</Text>
                <Text style={styles.supportHint}>
                  Standard {deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} is collected at checkout as a Drapeon fee. If a carrier surcharge, customs charge, or import duty appears later, Drapeon will handle approval with the customer before dispatch.
                </Text>
              </View>
            ) : null}
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Quote breakdown</Text>
              <Text style={styles.supportHint}>
                Add a clean breakdown when you want the customer to understand what is driving this price before they pay.
              </Text>
              <Input
                label={`Labour (${currencyLabel}, optional)`}
                placeholder="e.g. 120"
                value={laborAmount}
                onChangeText={setLaborAmount}
                keyboardType="decimal-pad"
              />
              <Input
                label={`Sourcing (${currencyLabel}, optional)`}
                placeholder="e.g. 40"
                value={sourcingAmount}
                onChangeText={setSourcingAmount}
                keyboardType="decimal-pad"
                hint="Useful when the quote includes fabric, trims, or accessory sourcing."
              />
              <Input
                label={`Rush fee (${currencyLabel}, optional)`}
                placeholder="e.g. 25"
                value={rushAmount}
                onChangeText={setRushAmount}
                keyboardType="decimal-pad"
              />
              <Input
                label="What's included? (optional)"
                placeholder="One per line or comma separated. e.g. pattern drafting, lining, basic alterations"
                value={includedText}
                onChangeText={setIncludedText}
                multiline
                numberOfLines={3}
                maxLength={240}
              />
              <Input
                label="What's not included? (optional)"
                placeholder="One per line or comma separated. e.g. extra fabric changes, rush remake after approval"
                value={excludedText}
                onChangeText={setExcludedText}
                multiline
                numberOfLines={3}
                maxLength={240}
              />
              <Input
                label="Short pricing summary (optional)"
                placeholder="e.g. Includes sourcing and construction for one fitted two-piece set."
                value={breakdownSummary}
                onChangeText={setBreakdownSummary}
                multiline
                numberOfLines={3}
                maxLength={300}
                filterContact
              />
            </View>
            <Input
              label="Estimated completion date"
              placeholder="Select a date"
              value={effectiveCompletionDate}
              onPressIn={openCompletionDatePicker}
              showSoftInputOnFocus={false}
              required
              hint={
                customerDeadline
                  ? `Must be on or before ${new Date(customerDeadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                  : 'The date you expect to finish. Customer has 48h to accept.'
              }
              testID="quote-completion-date-input"
            />
            {showDatePicker && (
              <DateTimePicker
                value={completionDateValue ?? defaultCompletionDateValue()}
                mode="date"
                minimumDate={new Date()}
                maximumDate={customerDeadline ? new Date(customerDeadline) : undefined}
                onChange={(_, date) => {
                  setShowDatePicker(false)
                  if (!date) return
                  setCompletionDateValue(date)
                  setCompletionDate(formatDateInput(date))
                }}
              />
            )}
            <Input
              label="Note to customer (optional)"
              placeholder="Any context about your pricing or timeline..."
              value={note}
              onChangeText={(v) => { setNote(v); if (noteError) validateNote(v) }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button
              label={mode === 'revise' ? 'Send revised quote' : 'Send quote'}
              onPress={send}
              loading={sending}
              disabled={sending || !amount || !effectiveCompletionDate || !!noteError}
              testID={mode === 'revise' ? 'tailor-send-revised-quote-btn' : 'tailor-send-quote-submit-btn'}
            />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Stage Update Modal ───────────────────────────────────────────────────────

function StageUpdateModal({ visible, order, targetStage, onClose, onUpdated }: {
  visible: boolean; order: OrderDetail; targetStage: OrderStage; onClose: () => void; onUpdated: (updatedStage: OrderStage) => void
}) {
  const insets = useSafeAreaInsets()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [primaryMedia, setPrimaryMedia] = useState<StageMedia | null>(null)
  const [secondMedia, setSecondMedia] = useState<StageMedia | null>(null)
  const [updating, setUpdating] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [provider, setProvider] = useState('')
  const [reference, setReference] = useState('')
  const [deliveryContactName, setDeliveryContactName] = useState('')
  const [deliveryContactPhone, setDeliveryContactPhone] = useState('')
  const [mediaSourceSlot, setMediaSourceSlot] = useState<'primary' | 'secondary' | null>(null)

  const nextStage: OrderStage = targetStage
  const finishingNeedsSecondPhoto = order.orderKind === 'CUSTOM' && nextStage === 'FINISHING'

  function validateNote(t: string) {
    if (t.trim().length < 10) { setNoteError('Tell your customer what you are working on. Use at least 10 characters.'); return false }
    const placeholder = rejectPlaceholder(t, 'Note')
    if (placeholder) { setNoteError(placeholder); return false }
    const res = filterContactInfo(t)
    if (res.blocked) { setNoteError("Contact details can't be included."); return false }
    setNoteError(''); return true
  }

  async function pickStageMediaFromCamera(slot: 'primary' | 'secondary') {
    if (updating) return
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (permission.status !== 'granted') {
      Alert.alert('Camera access needed', 'Allow camera access to take fresh production proof for this stage.')
      return
    }
    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchCameraAsync({
          mediaTypes: ['images', 'videos'],
          quality: 0.8,
          videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
        }),
      {
        context: 'tailor_order_stage_camera_picker',
        mediaLabel: 'stage proof media',
        extra: { slot, orderId: order?.id },
      }
    )
    if (!res) return
    if (!res.canceled && res.assets[0]) {
      const media = stageMediaFromAsset(res.assets[0])
      const mediaError = validateStageMedia(media)
      if (mediaError) {
        Alert.alert('Video not added', mediaError)
        return
      }
      if (slot === 'secondary') setSecondMedia(media)
      else setPrimaryMedia(media)
    }
  }

  async function pickStageMediaFromLibrary(slot: 'primary' | 'secondary') {
    if (updating) return
    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchImageLibraryAsync(
          preferCompatibleVideoRepresentation({
            mediaTypes: ['images', 'videos'],
            quality: 0.8,
            videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
          })
        ),
      {
        context: 'tailor_order_stage_library_picker',
        mediaLabel: 'stage proof media file',
        extra: { slot, orderId: order?.id },
      }
    )
    if (!res) return
    if (!res.canceled && res.assets[0]) {
      const media = stageMediaFromAsset(res.assets[0])
      const mediaError = validateStageMedia(media)
      if (mediaError) {
        Alert.alert('Video not added', mediaError)
        return
      }
      if (slot === 'secondary') setSecondMedia(media)
      else setPrimaryMedia(media)
    }
  }

  function pickStageMedia(slot: 'primary' | 'secondary' = 'primary') {
    if (updating) return
    setMediaSourceSlot(slot)
  }

  function chooseStageMediaSource(source: 'camera' | 'library') {
    const slot = mediaSourceSlot
    setMediaSourceSlot(null)
    if (!slot) return
    setTimeout(() => {
      if (source === 'camera') void pickStageMediaFromCamera(slot)
      else void pickStageMediaFromLibrary(slot)
    }, 250)
  }

  async function update() {
    if (updating) return
    if (!nextStage) return
    if (note.trim().length < 10) {
      Alert.alert('Note required', 'Tell your customer what you are working on. Use at least 10 characters.')
      return
    }
    if (!validateNote(note)) return
    if (!primaryMedia) {
      Alert.alert('Proof media required', stageUpdatePhotoRequiredMessage(order, nextStage))
      return
    }
    if (finishingNeedsSecondPhoto && !secondMedia) {
      Alert.alert('Second proof required', 'Finishing needs front and back proof before it can be marked complete.')
      return
    }
    const fulfillmentPreflightError =
      nextStage === 'SHIPPED' || nextStage === 'OUT_FOR_DELIVERY'
        ? getFulfillmentStagePreflightError({
            targetStage: nextStage,
            deliveryMethod: order.deliveryMethod,
            deliveryAddress: order.deliveryAddress,
            recipientName: order.recipientName,
            recipientPhone: order.recipientPhone,
            provider,
            reference,
            trackingNumber,
            contactName: deliveryContactName,
            contactPhone: deliveryContactPhone,
          })
        : null
    if (fulfillmentPreflightError) {
      Alert.alert(nextStage === 'OUT_FOR_DELIVERY' ? 'Delivery details required' : 'Shipping details required', fulfillmentPreflightError)
      return
    }
    setUpdating(true)

    try {
      const photoUrls: string[] = []
      const mediaFingerprints: string[] = []
      for (const media of [primaryMedia, secondMedia].filter(Boolean) as StageMedia[]) {
        const uploadUri = media.type === 'image' ? await stripExif(media.uri) : media.uri
        const ext = stageMediaExtension(media)
        const filename = `progress/${order.id}/${Date.now()}_${photoUrls.length}.${ext}`
        const publicUrl = await uploadPublicStorageImage({
          bucket: 'order-photos',
          path: filename,
          uri: uploadUri,
          contentType: stageMediaContentType(media),
          maxBytes: media.type === 'video' ? ORDER_EVIDENCE_VIDEO_MAX_BYTES : MEDIA_LIMITS_BYTES.image,
          allowedContentTypes: ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
          purpose: 'PRODUCTION_STAGE',
        })
        photoUrls.push(publicUrl)
        mediaFingerprints.push(media.fingerprint)
      }

      const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
        body: {
          orderId: order.id,
          action: 'advance-stage',
          targetStage: nextStage,
          note: note.trim() || undefined,
          photoUrl: photoUrls[0] ?? undefined,
          photoUrls,
          mediaFingerprints,
          trackingNumber: nextStage === 'SHIPPED' ? normalizeTrackingNumberInput(trackingNumber) || undefined : undefined,
          fulfillmentProvider: ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage) ? provider.trim() || undefined : undefined,
          fulfillmentReference: ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage) ? normalizeDispatchReferenceInput(reference) || undefined : undefined,
          fulfillmentContactName: ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage) ? deliveryContactName.trim() || undefined : undefined,
          fulfillmentContactPhone: ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage) ? normalizeContactPhoneInput(deliveryContactPhone) || undefined : undefined,
        },
      })

      if (efError || !efData?.ok) {
        const errorPayload = efError ? await readFunctionErrorPayload(efError) : null
        const errorMessage =
          typeof efData?.error === 'string' && efData.error.length > 0
            ? efData.error
            : typeof errorPayload?.error === 'string' && errorPayload.error.length > 0
              ? errorPayload.error
              : efError?.message ?? 'Edge Function error'
        const err = new Error(errorMessage)
        Sentry.captureException(err, { extra: { context: 'advance_stage', orderId: order.id, targetStage: nextStage } })
        throw err
      }

      capture('stage_advanced', {
        from_stage: order.stage,
        to_stage: nextStage,
        has_photo: photoUrls.length > 0,
        has_note: !!note.trim(),
      })

      hapticSuccess()
      onUpdated(nextStage)
    } catch (e) {
      Sentry.captureException(e, { extra: { context: 'stage_update_submit', orderId: order.id, targetStage: nextStage } })
      Alert.alert(
        'Update unavailable',
        isLikelyConnectivityIssue(e)
          ? 'Connection looks weak. We could not save this stage update yet. Your note and photo stayed here, so retry when the signal improves.'
          : e instanceof Error && e.message
            ? e.message
            : 'Could not update this stage right now. Please try again.',
      )
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={updating}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Update stage</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.nextStageRow}>
              <Text style={styles.nextStageLabel}>Advancing to</Text>
              <Text style={styles.nextStageValue}>{displayStageChoiceLabel(nextStage, order.orderKind)}</Text>
            </View>

            <Input
              label="Note to customer"
              placeholder={stageUpdateNotePlaceholder(order, nextStage)}
              value={note}
              onChangeText={(v) => { setNote(v); if (noteError) validateNote(v) }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
              required
            />

            {/* Progress proof */}
            <View>
              <Text style={styles.photoLabel}>{stageUpdatePhotoLabel(order, nextStage)} <Text style={{ color: Colors.error }}>*</Text></Text>
              <Text style={styles.photoHint}>{stageUpdatePhotoHint(order, nextStage)}</Text>
              {primaryMedia ? (
                <View style={styles.photoPreviewWrap}>
                  <StageMediaPreview
                    uri={primaryMedia.uri}
                    mediaType={primaryMedia.type}
                    style={styles.photoPreview}
                    surface="tailor_stage_update_photo_preview"
                  />
                  <TouchableOpacity style={styles.photoRemove} onPress={() => setPrimaryMedia(null)} disabled={updating}>
                    <Text style={styles.photoRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoPickBtn} onPress={() => pickStageMedia('primary')} disabled={updating}>
                  <View style={styles.photoPickIcon}>
                    <Feather name="camera" size={20} color={Colors.needleGreen} />
                  </View>
                  <Text style={styles.photoPickText}>Take or add photo/video</Text>
                  <Text style={styles.photoPickSubtext}>
                    Fresh proof keeps the timeline trusted. Use natural light and keep the garment fully in frame.
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {finishingNeedsSecondPhoto ? (
              <View>
                <Text style={styles.photoLabel}>Second finishing proof <Text style={{ color: Colors.error }}>*</Text></Text>
                <Text style={styles.photoHint}>Add a second fresh angle so the customer and ops can verify finishing quality.</Text>
                {secondMedia ? (
                  <View style={styles.photoPreviewWrap}>
                    <StageMediaPreview
                      uri={secondMedia.uri}
                      mediaType={secondMedia.type}
                      style={styles.photoPreview}
                      surface="tailor_stage_update_second_photo_preview"
                    />
                    <TouchableOpacity style={styles.photoRemove} onPress={() => setSecondMedia(null)} disabled={updating}>
                      <Text style={styles.photoRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.photoPickBtn} onPress={() => pickStageMedia('secondary')} disabled={updating}>
                    <View style={styles.photoPickIcon}>
                      <Feather name="camera" size={20} color={Colors.needleGreen} />
                    </View>
                    <Text style={styles.photoPickText}>Take or add second proof</Text>
                    <Text style={styles.photoPickSubtext}>Use a different, well-lit angle for finishing quality.</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage) && (
              <View style={styles.shippingFields}>
                <Input
                  label={nextStage === 'OUT_FOR_DELIVERY' ? 'Delivery partner' : 'Courier or shipper'}
                  placeholder={nextStage === 'OUT_FOR_DELIVERY' ? 'e.g. Gokada, Uber package, Local rider' : 'e.g. DHL, UPS, FedEx'}
                  value={provider}
                  onChangeText={setProvider}
                  autoCapitalize="words"
                  hint="Required so the customer knows who has the order."
                  required
                />
                {order.recipientName || order.recipientPhone ? (
                  <View style={styles.supportCard}>
                    <Text style={styles.supportCardTitle}>Recipient details</Text>
                    {order.recipientName ? <Text style={styles.supportHint}>Name: {order.recipientName}</Text> : null}
                    {order.recipientPhone ? <Text style={styles.supportHint}>Phone: {order.recipientPhone}</Text> : null}
                    {order.deliveryAddress ? <Text style={styles.supportHint}>Address: {order.deliveryAddress}</Text> : null}
                  </View>
                ) : null}
                <Input
                  label="Tracking number"
                  placeholder="e.g. JD000095006536993823"
                  value={trackingNumber}
                  onChangeText={(value) => setTrackingNumber(normalizeTrackingNumberInput(value))}
                  autoCapitalize="characters"
                  hint={nextStage === 'SHIPPED' ? 'Use this when the courier provides formal tracking.' : 'Optional for local delivery. Leave blank if there is no formal tracking.'}
                />
                <Input
                  label={nextStage === 'OUT_FOR_DELIVERY' ? 'Trip or dispatch reference' : 'Shipment reference'}
                  placeholder={nextStage === 'OUT_FOR_DELIVERY' ? 'e.g. trip id, rider booking code' : 'e.g. booking code, parcel reference'}
                  value={reference}
                  onChangeText={(value) => setReference(normalizeDispatchReferenceInput(value))}
                  autoCapitalize="characters"
                  hint={nextStage === 'SHIPPED' ? 'Required if there is no formal tracking number.' : 'Optional, but helpful for support and follow-up.'}
                  required={nextStage === 'SHIPPED' && !trackingNumber.trim()}
                />
                <Input
                  label={nextStage === 'OUT_FOR_DELIVERY' ? 'Rider or delivery contact' : 'Courier or shipping contact'}
                  placeholder={nextStage === 'OUT_FOR_DELIVERY' ? 'e.g. Tunde, Dispatch desk' : 'e.g. DHL desk, Parcel hub contact'}
                  value={deliveryContactName}
                  onChangeText={setDeliveryContactName}
                  autoCapitalize="words"
                  hint={nextStage === 'OUT_FOR_DELIVERY' ? 'Required so the customer knows who is trying to reach them.' : 'Required so the customer knows who accepted the parcel.'}
                  required
                />
                <Input
                  label={nextStage === 'OUT_FOR_DELIVERY' ? 'Delivery contact phone' : 'Shipping contact phone'}
                  placeholder="e.g. +2348012345678"
                  value={deliveryContactPhone}
                  onChangeText={(value) => setDeliveryContactPhone(normalizeContactPhoneInput(value))}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  hint={nextStage === 'OUT_FOR_DELIVERY' ? 'Required so the customer can identify the active rider.' : 'Required so the customer can identify the courier or shipping desk.'}
                  required
                />
                <Text style={styles.shippingWarning}>
                  {nextStage === 'OUT_FOR_DELIVERY'
                    ? 'Only mark this as out for delivery after the rider or local delivery partner has actually accepted the order. Keep rider, contact, and dispatch updates in Drapeon so support can recover the timeline if anything goes wrong.'
                    : 'Only mark this as shipped after the courier has actually accepted the parcel. Keep provider, tracking, shipment reference, and customs updates in Drapeon so support can recover the timeline if anything goes wrong.'}
                </Text>
                {!order.deliveryAddress?.trim() ? (
                  <Text style={styles.shippingWarning}>
                    Delivery address is missing on this order. Ask the customer to update it before marking this handoff as started.
                  </Text>
                ) : null}
              </View>
            )}

            <Button
              label="Confirm update"
              onPress={update}
              loading={updating}
              disabled={
                updating ||
                note.trim().length < 10 ||
                !!noteError ||
                !primaryMedia ||
                (finishingNeedsSecondPhoto && !secondMedia) ||
                (
                  nextStage === 'SHIPPED' &&
                  (!provider.trim() || (!trackingNumber.trim() && !reference.trim()) || !deliveryContactName.trim() || !deliveryContactPhone.trim())
                ) ||
                (
                  nextStage === 'OUT_FOR_DELIVERY' &&
                  (!provider.trim() || !deliveryContactName.trim() || !deliveryContactPhone.trim())
                )
              }
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
    <Modal
      visible={!!mediaSourceSlot}
      transparent
      animationType="fade"
      onRequestClose={() => setMediaSourceSlot(null)}
    >
      <View style={styles.mediaSourceOverlay}>
        <TouchableOpacity
          style={styles.mediaSourceBackdrop}
          activeOpacity={1}
          onPress={() => setMediaSourceSlot(null)}
          accessibilityRole="button"
          accessibilityLabel="Close proof media options"
        />
        <View style={[styles.mediaSourceSheet, { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xxl) }]}>
          <View style={styles.mediaSourceHandle} />
          <Text style={styles.mediaSourceTitle}>Add proof media</Text>
          <Text style={styles.mediaSourceText}>
            Use fresh stage proof. Reused media is blocked to keep the order timeline trustworthy.
          </Text>
          <TouchableOpacity
            style={styles.mediaSourceAction}
            onPress={() => chooseStageMediaSource('camera')}
            disabled={updating}
          >
            <Feather name="camera" size={20} color={Colors.needleGreen} />
            <View style={styles.mediaSourceActionCopy}>
              <Text style={styles.mediaSourceActionTitle}>Take photo or video</Text>
              <Text style={styles.mediaSourceActionText}>Best for fresh production proof.</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mediaSourceAction}
            onPress={() => chooseStageMediaSource('library')}
            disabled={updating}
          >
            <Feather name="image" size={20} color={Colors.needleGreen} />
            <View style={styles.mediaSourceActionCopy}>
              <Text style={styles.mediaSourceActionTitle}>Choose from library</Text>
              <Text style={styles.mediaSourceActionText}>Use only media from this exact stage.</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mediaSourceCancel}
            onPress={() => setMediaSourceSlot(null)}
            disabled={updating}
          >
            <Text style={styles.mediaSourceCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  )
}

// ─── Consultation Modal ───────────────────────────────────────────────────────

function ConsultationModal({ visible, orderId, action, defaultCurrency, onClose, onSent }: {
  visible: boolean; orderId: string; action: 'request-consultation' | 'approve-consultation'; defaultCurrency: CurrencyCode; onClose: () => void; onSent: () => void
}) {
  const currencyLabel = `${currencySymbol(defaultCurrency)} ${defaultCurrency}`
  const [fee, setFee] = useState('')
  const [scheduledAt, setScheduledAt] = useState<Date>(defaultConsultationStart())
  const [showPicker, setShowPicker] = useState(false)
  const [creditFeeTowardOrder, setCreditFeeTowardOrder] = useState(true)
  const [paymentTiming] = useState<'BEFORE_CALL_STARTS' | 'WAIVED_OR_FREE'>('BEFORE_CALL_STARTS')
  const [reschedulePolicy, setReschedulePolicy] = useState<'ONE_FREE_RESCHEDULE' | 'FLEXIBLE_WITH_NOTICE' | 'CASE_BY_CASE'>('ONE_FREE_RESCHEDULE')
  const [noShowPolicy, setNoShowPolicy] = useState<'FEE_FORFEITED' | 'ONE_REBOOK_ALLOWED' | 'CASE_BY_CASE'>('FEE_FORFEITED')
  const [expiryPolicy, setExpiryPolicy] = useState<'EXPIRES_IN_7_DAYS' | 'EXPIRES_IN_14_DAYS' | 'NO_EXPIRY'>('EXPIRES_IN_14_DAYS')
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const feeEnabled = fee.trim().length > 0
  const noShowOptions: Array<'FEE_FORFEITED' | 'ONE_REBOOK_ALLOWED' | 'CASE_BY_CASE'> = feeEnabled
    ? ['FEE_FORFEITED', 'ONE_REBOOK_ALLOWED', 'CASE_BY_CASE']
    : ['CASE_BY_CASE']

  function validateNote(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) { setNoteError("Contact details can't be included."); return false }
    setNoteError(''); return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    if (scheduledAt.getTime() < Date.now() + 60 * 60 * 1000) {
      Alert.alert('Choose another time', 'Pick a consultation time at least 1 hour from now.')
      return
    }
    setSending(true)

    const feePence = fee ? Math.round(parseFloat(fee) * 100) : null
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action,
        consultationFee: feePence,
        currency: defaultCurrency,
        creditFeeTowardOrder: feePence ? creditFeeTowardOrder : false,
        paymentTiming: feePence ? paymentTiming : 'WAIVED_OR_FREE',
        reschedulePolicy,
        noShowPolicy: feePence ? noShowPolicy : 'CASE_BY_CASE',
        expiryPolicy,
        reminderEnabled,
        scheduledStartAt: scheduledAt.toISOString(),
        timezone,
        note: note.trim() || undefined,
      },
    })

    if (efError || !efData?.ok) {
      const errorPayload = efError ? await readFunctionErrorPayload(efError) : null
      const errorMessage =
        typeof efData?.error === 'string' && efData.error.length > 0
          ? efData.error
          : typeof errorPayload?.error === 'string' && errorPayload.error.length > 0
            ? errorPayload.error
            : efError?.message ?? 'Could not request consultation right now.'
      const err = new Error(errorMessage)
      Sentry.captureException(err, { extra: { context: 'request_consultation', orderId } })
      Alert.alert(
        'Consultation unavailable',
        isLikelyConnectivityIssue(efError)
          ? 'Connection looks weak. Your consultation request details stayed here, so retry when the signal improves.'
          : errorMessage,
      )
      setSending(false)
      return
    }

    capture(action === 'approve-consultation' ? 'consultation_approved' : 'consultation_requested', { has_fee: !!feePence })
    setSending(false)
    onSent()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{action === 'approve-consultation' ? 'Approve consultation' : 'Request consultation'}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.consultationInfo}>
              <Text style={styles.consultationInfoText}>
                {action === 'approve-consultation'
                  ? 'Approving this request reserves this time on your Drapeon calendar, sets the terms, and asks the customer to pay first if you charge a fee.'
                  : 'A consultation reserves time on your Drapeon calendar so you can assess the order details before committing to a quote.'}
              </Text>
              <Text style={styles.consultationInfoText}>
                If another order takes the same time first, Drapeon will block the booking and ask you to choose a new slot.
              </Text>
            </View>
            <Input
              label="Consultation time"
              value={formatConsultationStart(scheduledAt)}
              onPressIn={() => setShowPicker(true)}
              showSoftInputOnFocus={false}
              hint="Pick a time at least 1 hour from now. Reminders go out before the scheduled slot."
              required
            />
            {showPicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                minimumDate={new Date(new Date().getTime() + 60 * 60 * 1000)}
                onChange={(_, value) => {
                  setShowPicker(Platform.OS === 'ios')
                  if (value) setScheduledAt(value)
                }}
              />
            ) : null}
            <Input
              label={`Consultation fee (${currencyLabel}, optional)`}
              placeholder="e.g. 20"
              value={fee}
              onChangeText={setFee}
              keyboardType="decimal-pad"
              hint={`Leave blank if you don't charge for consultations. This fee will be shown in ${currencyLabel}.`}
            />
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Consultation terms</Text>
              <Text style={styles.supportHint}>
                Set the expectations now so the customer knows how this consultation is paid, rescheduled, and timed before you quote.
              </Text>
              {feeEnabled ? (
                <>
                  <Text style={styles.fieldLabel}>Should this fee count toward the final order?</Text>
                  <View style={styles.choiceList}>
                    <SelectableSettingRow
                      label="Credit it later"
                      detail="The consultation fee is deducted from the final order quote."
                      active={creditFeeTowardOrder}
                      onPress={() => setCreditFeeTowardOrder(true)}
                    />
                    <SelectableSettingRow
                      label="Separate fee"
                      detail="The consultation is paid on its own and does not reduce the order quote."
                      active={!creditFeeTowardOrder}
                      onPress={() => setCreditFeeTowardOrder(false)}
                    />
                  </View>

                  <Text style={styles.fieldLabel}>When is payment due?</Text>
                  <View style={styles.policySummaryRow}>
                    <Text style={styles.policySummaryLabel}>Payment due</Text>
                    <Text style={styles.policySummaryValue}>
                      {CONSULTATION_PAYMENT_TIMING_LABELS[paymentTiming]}
                    </Text>
                  </View>
                </>
              ) : null}

              <Text style={styles.fieldLabel}>Reschedule policy</Text>
              <View style={styles.choiceList}>
                {(['ONE_FREE_RESCHEDULE', 'FLEXIBLE_WITH_NOTICE', 'CASE_BY_CASE'] as const).map((value) => (
                  <SelectableSettingRow
                    key={value}
                    label={CONSULTATION_RESCHEDULE_POLICY_LABELS[value]}
                    active={reschedulePolicy === value}
                    onPress={() => setReschedulePolicy(value)}
                  />
                ))}
              </View>

              <Text style={styles.fieldLabel}>No-show policy</Text>
              <View style={styles.choiceList}>
                {noShowOptions.map((value) => (
                  <SelectableSettingRow
                    key={value}
                    label={CONSULTATION_NO_SHOW_POLICY_LABELS[value]}
                    active={noShowPolicy === value}
                    onPress={() => setNoShowPolicy(value)}
                  />
                ))}
              </View>

              <Text style={styles.fieldLabel}>How long should this consultation hold?</Text>
              <View style={styles.choiceList}>
                {(['EXPIRES_IN_7_DAYS', 'EXPIRES_IN_14_DAYS', 'NO_EXPIRY'] as const).map((value) => (
                  <SelectableSettingRow
                    key={value}
                    label={CONSULTATION_EXPIRY_POLICY_LABELS[value]}
                    active={expiryPolicy === value}
                    onPress={() => setExpiryPolicy(value)}
                  />
                ))}
              </View>

              <Text style={styles.fieldLabel}>Reminder support</Text>
              <View style={styles.choiceList}>
                <SelectableSettingRow
                  label="Send reminder"
                  detail="Drapeon sends reminders before the scheduled consultation."
                  active={reminderEnabled}
                  onPress={() => setReminderEnabled(true)}
                />
                <SelectableSettingRow
                  label="No reminder"
                  detail="Use only when you have already arranged the reminder outside this request."
                  active={!reminderEnabled}
                  onPress={() => setReminderEnabled(false)}
                />
              </View>
            </View>
            <Input
              label="Note to customer (optional)"
              placeholder="Explain what you need from the consultation..."
              value={note}
              onChangeText={(v) => { setNote(v); if (noteError) validateNote(v) }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
            <Button
              label={action === 'approve-consultation' ? 'Approve consultation' : 'Request consultation'}
              onPress={send}
              loading={sending}
              disabled={sending || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Collection Code Modal ────────────────────────────────────────────────────

function CollectionCodeModal({ visible, orderId, onClose, onConfirmed }: {
  visible: boolean; orderId: string; onClose: () => void; onConfirmed: () => void
}) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const inputs = useRef<TextInput[]>([])

  function handleDigit(value: string, index: number) {
    const d = [...digits]
    d[index] = value.replace(/\D/g, '').slice(-1)
    setDigits(d)
    setError('')
    if (value && index < 3) inputs.current[index + 1]?.focus()
  }

  async function confirm() {
    if (confirming) return
    const entered = digits.join('')
    if (entered.length < 4) { setError('Enter all 4 digits.'); return }

    setConfirming(true)
    const { data, error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'confirm-collection', code: entered },
    })
    setConfirming(false)

    if (error || !data?.ok) {
      const msg = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not confirm collection yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, data?.error ?? 'Could not confirm collection. Please try again.')
      const remaining = data?.attemptsRemaining
      setError(remaining !== undefined ? `${msg} ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : msg)
      return
    }
    onConfirmed()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} disabled={confirming}>
            <Text style={styles.modalClose}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Enter collection code</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.codeModalContent}>
          <Text style={styles.codeInstruction}>Ask the customer for their 4-digit collection code.</Text>

          <View style={styles.codeInputRow}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={(ref) => { if (ref) inputs.current[i] = ref }}
                style={[styles.codeInput, d && styles.codeInputFilled]}
                value={d}
                onChangeText={(v) => handleDigit(v, i)}
                editable={!confirming}
                keyboardType="number-pad"
                maxLength={1}
                textAlign="center"
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Backspace' && !d && i > 0) {
                    inputs.current[i - 1]?.focus()
                  }
                }}
              />
            ))}
          </View>

          {error ? <Text style={styles.codeError}>{error}</Text> : null}

          <Text style={styles.amountNote}>Collection confirmation closes the pickup handoff. Drapeon handles any payout follow-up after that.</Text>

          <Button
            label="Confirm collection"
            onPress={confirm}
            loading={confirming}
            disabled={confirming || digits.some((d) => !d)}
          />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.briefRow}>
      <Text style={styles.briefRowLabel}>{label}</Text>
      <Text style={styles.briefRowValue}>{decodeDisplayText(value)}</Text>
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
        <Text style={styles.briefRowLabel}>{row.label}</Text>
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
        <Text style={styles.briefRowLabel}>{row.label}</Text>
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
          <Text style={styles.briefRowLabel}>{row.label}</Text>
          {row.value ? <Text style={styles.supportHint}>{row.value}</Text> : null}
        </View>
        <DrapeMediaMosaic
          items={mosaicItems}
          compact
          testID={`tailor-dossier-media-${row.id}`}
          onPressItem={(_item, index) => onOpenMedia(mediaItems, index)}
        />
      </View>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.briefRowLabel}>{row.label}</Text>
        <Text style={styles.dossierStackedText}>{decodeDisplayText(row.value ?? '')}</Text>
      </View>
    )
  }

  return <BriefRow label={row.label} value={row.value ?? 'Not set'} />
}

function BriefDossierCard({
  section,
  onOpenLink,
  onOpenMedia,
}: {
  section: BriefDossierSection
  onOpenLink: (href: string) => void
  onOpenMedia: (items: MediaLightboxItem[], index: number) => void
}) {
  return (
    <View style={styles.supportCard}>
      <Text style={styles.supportCardTitle}>{section.title}</Text>
      {section.summary ? <Text style={styles.supportHint}>{section.summary}</Text> : null}
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
    </View>
  )
}

function SelectableSettingRow({
  label,
  detail,
  active,
  onPress,
}: {
  label: string
  detail?: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.selectableSettingRow, active && styles.selectableSettingRowActive]}
    >
      <View style={[styles.selectableSettingRadio, active && styles.selectableSettingRadioActive]}>
        {active ? <Feather name="check" size={12} color={Colors.textInverse} /> : null}
      </View>
      <View style={styles.selectableSettingBody}>
        <Text style={[styles.selectableSettingLabel, active && styles.selectableSettingLabelActive]}>
          {label}
        </Text>
        {detail ? <Text style={styles.selectableSettingDetail}>{detail}</Text> : null}
      </View>
    </TouchableOpacity>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.bold, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.md },

  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  subheading: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 4 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderTypePill: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  orderTypePillText: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },

  alertCard: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.needleGreen + '40',
  },
  alertTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  alertSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  compactActionMenuButton: {
    minHeight: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  compactActionMenuText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },

  stageCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  stageCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  stageCardSub: { fontSize: 13, color: Colors.inkLight, lineHeight: 19 },
  stageCardHint: { fontSize: 12, color: Colors.midGrey, lineHeight: 18 },

  consultationCard: { borderColor: Colors.kanteRust + '60', borderWidth: 1.5 },
  consultationInfo: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md, padding: Spacing.md,
  },
  consultationInfoText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Body profile
  bodyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
    borderWidth: 1, borderColor: Colors.kanteRust + '55',
  },
  bodyCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  bodyCardRow: { gap: Spacing.sm },
  fitFlagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  fitFlagBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    backgroundColor: Colors.kanteRustLight, borderRadius: Radius.full,
  },
  fitFlagText: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.semibold },
  bodyNote: {
    backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.kanteRust + '35',
  },
  bodyNoteText: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic' },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  fitStyleTag: { color: Colors.midGrey, fontWeight: FontWeight.regular },

  briefText: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  briefMeta: { gap: Spacing.sm },
  briefRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  briefRowLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  briefRowValue: { flex: 1, textAlign: 'right', fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
  dossierList: { gap: Spacing.sm },
  sheetSectionStack: { gap: Spacing.md },
  stageChoiceList: { gap: Spacing.sm },
  quoteRevisionReasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  dossierRowStacked: { gap: 6 },
  dossierRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  dossierStackedText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 20 },
  dossierLinkText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.needleGreen, lineHeight: 20 },
  dossierMediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  dossierMediaTile: { width: '31%', aspectRatio: 1, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.boneDeep },
  dossierMediaImage: { width: '100%', height: '100%' },
  supportCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  supportCardWarning: {
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
  },
  referralTrustCard: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  referralTrustTitle: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  referralTrustText: {
    marginTop: 2,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  visionOrderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  visionOrderIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  supportCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  supportMetaList: { gap: 6 },
  advanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    backgroundColor: Colors.bone,
  },
  advanceTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  supportBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  supportBadgeWarning: { backgroundColor: Colors.kanteRustLight },
  supportBadgeSuccess: { backgroundColor: Colors.needleGreenLight },
  supportBadgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  supportBadgeTextWarning: { color: Colors.kanteRust },
  supportBadgeTextSuccess: { color: Colors.needleGreen },
  supportBodyText: { fontSize: 13, color: Colors.inkLight, lineHeight: 19 },
  supportHint: { fontSize: 12, color: Colors.midGrey, lineHeight: 18 },
  timeline: { gap: 0, paddingTop: Spacing.xs },
  timelineItem: { flexDirection: 'row', gap: 10, paddingBottom: 12 },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: Colors.needleGreen,
  },
  timelineContent: { flex: 1, gap: 3 },
  timelineStage: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  timelineNote: { fontSize: 12, color: Colors.inkLight, fontStyle: 'italic', lineHeight: 18 },
  timelinePhoto: {
    width: '100%',
    height: 176,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    marginTop: Spacing.xs,
    overflow: 'hidden',
  },
  timelineDate: { fontSize: 10, color: Colors.midGrey },
  measurementConfirmFieldWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  measurementConfirmFieldChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
  },
  measurementConfirmFieldText: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.semibold },
  styleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  styleChip: {
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  styleChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  referenceLinkList: { gap: 6 },
  referenceLinkRow: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    padding: Spacing.sm,
    gap: 2,
  },
  referenceLinkHost: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.ink },
  referenceLinkText: { fontSize: FontSize.xs, color: Colors.needleGreen },
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
    color: Colors.needleGreen,
  },
  supportWarningCard: {
    backgroundColor: Colors.kanteRustLight,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  supportWarningTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.kanteRust },
  supportWarningText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  fitNote: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: Colors.needleGreen + '35',
  },
  fitNoteLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  fitNoteText: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic' },

  refPhoto: { width: 152, height: 152, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  measureItem: { width: '47%', backgroundColor: Colors.white, borderRadius: Radius.sm, padding: Spacing.md, gap: 2 },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  additionalMeasureBlock: { gap: Spacing.sm, marginTop: Spacing.md },
  additionalMeasureTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },

  messageCta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    ...Shadow.lg,
  },

  backLink: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  retryBtn: { backgroundColor: Colors.needleGreen, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl },
  retryBtnText: { color: Colors.textInverse, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  secondaryBtnText: { color: Colors.ink, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },

  // Modal shared
  modalSafe: { flex: 1, backgroundColor: Colors.bone },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  modalClose: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium, width: 60 },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  modalFooter: {
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  modalSectionLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  modalHelpText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  measurementFieldPicker: { gap: Spacing.sm },
  choiceList: { gap: Spacing.sm },
  selectableSettingRow: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  selectableSettingRowActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  selectableSettingRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectableSettingRadioActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  selectableSettingBody: { flex: 1 },
  selectableSettingLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  selectableSettingLabelActive: { color: Colors.needleGreen },
  selectableSettingDetail: { marginTop: 3, fontSize: FontSize.xs, lineHeight: 17, color: Colors.midGrey },
  policySummaryRow: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  policySummaryLabel: { fontSize: FontSize.xs, color: Colors.midGrey, marginBottom: 3 },
  policySummaryValue: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  shippingFields: { gap: Spacing.sm },
  shippingWarning: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.error,
  },

  nextStageRow: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  nextStageLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  nextStageValue: { fontSize: 20, fontWeight: FontWeight.bold, color: Colors.needleGreen, fontFamily: Fonts.display },

  photoLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: 4 },
  photoHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginBottom: Spacing.md, lineHeight: 18 },
  photoPickBtn: {
    minHeight: 142,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.needleGreen + '55',
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    padding: Spacing.lg,
    gap: 6,
  },
  photoPickIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  photoPickText: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  photoPickSubtext: { fontSize: FontSize.xs, color: Colors.inkLight, textAlign: 'center' },
  photoPreviewWrap: { gap: Spacing.sm },
  photoPreview: { width: '100%', height: 200, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },
  photoRemove: { alignSelf: 'flex-start' },
  photoRemoveText: { color: Colors.error, fontSize: FontSize.sm },
  mediaSourceOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  mediaSourceBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  mediaSourceSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  mediaSourceHandle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: Colors.lightGrey,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  mediaSourceTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  mediaSourceText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  mediaSourceAction: {
    minHeight: 64,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  mediaSourceActionCopy: { flex: 1, gap: 2 },
  mediaSourceActionTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  mediaSourceActionText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 17 },
  mediaSourceCancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  mediaSourceCancelText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },

  // Collection code modal
  codeModalContent: { flex: 1, padding: Spacing.xl, gap: Spacing.xl, alignItems: 'center' },
  codeInstruction: { fontSize: FontSize.md, color: Colors.inkLight, textAlign: 'center', lineHeight: 22 },
  codeInputRow: { flexDirection: 'row', gap: Spacing.lg },
  codeInput: {
    width: 64, height: 80, borderRadius: Radius.md,
    backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.lightGrey,
    fontSize: 32, fontWeight: FontWeight.bold, color: Colors.ink,
    textAlign: 'center', ...Shadow.sm,
  },
  codeInputFilled: { borderColor: Colors.needleGreen },
  codeError: { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center' },
  amountNote: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' },

  // Quote and consultation modal chips
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  required: { color: Colors.error },
  reasonList: { gap: Spacing.sm },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  reasonRowActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  reasonRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  reasonRadioActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  reasonText: { flex: 1, fontSize: FontSize.sm, color: Colors.ink },
  reasonTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
})
