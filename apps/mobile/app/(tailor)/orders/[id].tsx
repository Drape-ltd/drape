import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image as ExpoImage } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
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
  MATERIAL_ISSUE_REASON_LABELS,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  MEASUREMENT_SOURCE_LABELS,
  MEASUREMENT_SCAN_STATUS_LABELS,
  WEAR_DAY_SUPPORT_LABELS,
  fitProfileNeedsTailorReview,
  hasOpenCancellationReview,
  hasOpenDeliveryReview,
  hasOpenMaterialIssue,
  parseOrderSupportMeta,
  type CancellationReviewReason,
  type DeliveryReviewReason,
  type MaterialIssueReason,
  type MeasurementSnapshotMeta,
  type OrderSupportMeta,
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
import { Button, HandoffSupportModal, Input } from '@/components/ui'
import { currencySymbol } from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import {
  CANCELLATION_REFUND_COMPONENT_LABELS,
  deriveCancellationPolicy,
} from '@drape/shared/cancellation-policy'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { stageColor } from '@/lib/stageColors'
import { isTerminalOrderStage, purgeTerminalOrderClientState } from '@/lib/order-client-state'

// ─── Types ────────────────────────────────────────────────────────────────────

type Measurement = {
  chest: number | null; waist: number | null; hips: number | null
  shoulderWidth: number | null; inseam: number | null; sleeveLength: number | null
  neckCircumference: number | null; height: number | null; unit: string
  fitStyle: string | null; garmentContext: string | null; bodyShape: string | string[] | null
  fitFlags: string[]; bodyNote: string | null
} & MeasurementSnapshotMeta

type OrderDetail = {
  id: string; reference: string; garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'; fulfillmentOption: string | null
  itemTitle: string | null; itemSize: string | null; itemQuantity: number; itemSubtotal: number | null
  fulfillmentFee: number
  garmentDescription: string | null; stage: OrderStage
  customerId: string; customerName: string
  quotedAmount: number | null; quotedCurrency: string; quotedCompletionDate: string | null
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
  collectionCode: string | null
  videoCallUrl: string | null
  occasion: string | null; deadline: string | null
  createdAt: string
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
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
      ? 'Checkout is still open. The customer is next to finish payment before fulfilment can start.'
      : 'The customer has started payment. They are next to finish payment before production can start.'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE'
      ? 'Checkout failed. The customer is next to retry within 30 minutes before this order is cancelled automatically.'
      : 'Payment failed. The customer is next to retry within 30 minutes before this order is cancelled automatically.'
  }
  if (stage === 'CONFIRMED') {
    return orderKind === 'READY_MADE'
      ? 'Payment is confirmed. You are next to start preparing this order for dispatch or pickup.'
      : 'The customer has accepted your quote. You are next to move this order into the first real production stage when work begins.'
  }
  if (orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)) {
    return 'You are still next. Keep packing and checking this order until it is truly ready for Drape dispatch or pickup.'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'This order is packed and waiting for Drape ops. Drape is next to arrange dispatch from here.'
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
      ? 'Final packing and quality checks are underway. When the order is truly handoff-ready, mark it for Drape dispatch or collection.'
      : 'Final touches and quality checks are underway. When the order is truly handoff-ready, mark it for Drape dispatch or collection.'
  }
  if (stage === 'OUT_FOR_DELIVERY') {
    return 'This order is with a local delivery partner. Drape and the customer are next until the handoff is confirmed.'
  }
  if (stage === 'SHIPPED') {
    return 'This order is on its way to the customer. The customer is next once it arrives, unless a delivery issue opens first.'
  }
  if (stage === 'READY_FOR_COLLECTION') {
    return 'The order is ready to hand over. The customer is next at pickup, and you should confirm the collection code when they arrive.'
  }
  if (stage === 'DELIVERED') {
    return 'Delivery is confirmed. The customer is next to finish the order or raise a concern. You can leave an internal review now.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. The customer is next to finish the order or raise a concern. You can leave an internal review now.'
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
    if (fulfillmentPaymentPending) return 'item paid'
    if (stage === 'COMPLETE') return 'closed out'
    return 'paid'
  }
  if (fulfillmentPaymentPending) return 'base quote paid'
  if (stage === 'QUOTE_SENT') return 'quoted'
  if (stage === 'PAYMENT_FAILED') return 'payment failed'
  if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'awaiting finish'
  if (stage === 'COMPLETE') return 'closed out'
  return 'held'
}

function displayStageChoiceLabel(targetStage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE') {
  if (orderKind === 'READY_MADE' && targetStage === 'FINISHING') return 'Preparing order'
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return 'Ready for Drape dispatch'
  return STAGE_LABELS[targetStage]
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
      return 'e.g. "Your order is packed and ready for Drape dispatch. We will hand it to Drape ops next."'
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
    return 'e.g. "Your order is finished, packed, and ready for Drape dispatch."'
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
  if (order.orderKind === 'READY_MADE' && targetStage === 'READY_FOR_COLLECTION') {
    return 'Show the packed order so the customer knows pickup is truly ready.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Show the packed order so Drape ops and the customer can trust that dispatch can begin.'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'Show the packed order or rider handoff so the customer can trust this delivery update.'
  }
  if (targetStage === 'SHIPPED') {
    return 'Show the packed handoff or dispatch proof so the customer can trust the shipment update.'
  }
  return 'A photo at this stage builds trust with your customer.'
}

function stageUpdatePhotoLabel(order: Pick<OrderDetail, 'orderKind'>, targetStage: OrderStage) {
  if (order.orderKind === 'READY_MADE') {
    if (targetStage === 'FINISHING') return 'Packing photo'
    if (targetStage === 'READY_FOR_COLLECTION') return 'Pickup-ready photo'
    if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return 'Packed-order photo'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') return 'Delivery handoff photo'
  if (targetStage === 'SHIPPED') return 'Dispatch photo'
  return 'Progress photo'
}

function stageUpdatePhotoRequiredMessage(order: Pick<OrderDetail, 'orderKind'>, targetStage: OrderStage) {
  if (order.orderKind === 'READY_MADE' && targetStage === 'READY_FOR_COLLECTION') {
    return 'Add a pickup-ready photo so the customer can see the packed order before collection.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Add a packed-order photo so Drape can take over dispatch cleanly.'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'Add a delivery handoff photo so the customer can trust that the order is really on the way.'
  }
  if (targetStage === 'SHIPPED') {
    return 'Add a dispatch photo so the customer can trust this shipment update.'
  }
  return 'A photo at this stage builds trust. Please add at least one image before updating.'
}

function baseAmount(order: Pick<OrderDetail, 'orderKind' | 'itemSubtotal' | 'quotedAmount' | 'fulfillmentFee'>) {
  if (order.orderKind === 'READY_MADE') {
    return order.itemSubtotal ?? (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee, 0)
}

// Linear next stages (one option only)
const PRODUCTION_NEXT: Partial<Record<OrderStage, OrderStage>> = {
  CUTTING: 'SEWING',
  SEWING: 'FINISHING',
}

// Flexible next stages — tailor chooses which pre-production phase to start
const FLEXIBLE_NEXT_STAGES: Partial<Record<OrderStage, OrderStage[]>> = {
  CONFIRMED: ['DESIGNING', 'SOURCING', 'CUTTING'],
  DESIGNING: ['SOURCING', 'CUTTING'],
  SOURCING: ['CUTTING'],
}

const PRE_CUTTING_STAGES: OrderStage[] = ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING']

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
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'tailor')
  }

  function goBack() {
    if (returnTo) {
      router.replace(returnTo as any)
      return
    }
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/orders')
  }

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [showStageModal, setShowStageModal] = useState(false)
  const [stageModalTarget, setStageModalTarget] = useState<OrderStage | null>(null)
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [showMeasurementRequestModal, setShowMeasurementRequestModal] = useState(false)
  const [showFitReadinessModal, setShowFitReadinessModal] = useState(false)
  const [showMaterialIssueModal, setShowMaterialIssueModal] = useState(false)
  const [showCancellationReviewModal, setShowCancellationReviewModal] = useState(false)
  const [showDeliveryReviewModal, setShowDeliveryReviewModal] = useState(false)
  const [showHandoffSupport, setShowHandoffSupport] = useState(false)
  const [startingCall, setStartingCall] = useState<'audio' | 'video' | null>(null)
  const [startingOrderCall, setStartingOrderCall] = useState<'audio' | 'video' | null>(null)
  const [confirmingFabricReceived, setConfirmingFabricReceived] = useState(false)
  const [failedReferencePhotos, setFailedReferencePhotos] = useState<string[]>([])
  const [hasCustomerReview, setHasCustomerReview] = useState(false)
  const [handoffIssue, setHandoffIssue] = useState<HandoffIssue | null>(null)
  const [resolvingHandoffIssue, setResolvingHandoffIssue] = useState(false)
  const purgedTerminalOrderRef = useRef<string | null>(null)

  async function fetchOrder() {
    if (!id || !user?.id) {
      setLoading(false)
      setFetchErrorMessage('')
      setOrder(null)
      setHasCustomerReview(false)
      setFailedReferencePhotos([])
      setHandoffIssue(null)
      return
    }
    setLoading(true)
    setFetchErrorMessage('')
    setOrder(null)
    setHasCustomerReview(false)
    setFailedReferencePhotos([])
    try {
      const { data, error } = await supabase
      .from('orders')
      .select(`
        id, reference, order_kind, fulfillment_option, garment_type, garment_description, item_title, item_size, item_quantity, item_subtotal, stage,
        customer_id, quoted_amount, quoted_currency, fulfillment_fee, quoted_completion_date,
        fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
        fabric_source, delivery_method, delivery_address, recipient_name, recipient_phone, tracking_number, carrier,
        fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos, fit_note,
        customer_measurements_snapshot, special_note, collection_code, video_call_url,
        occasion, deadline, created_at,
        customer_profiles!customer_id(display_name)
      `)
      .eq('id', id)
      .eq('tailor_id', user.id)
      .maybeSingle()

      if (error) throw error

      if (data) {
        const d = data as any
        const openHandoffIssue = await fetchOpenHandoffIssue(d.id)
        setOrder({
          id: d.id, reference: d.reference, garmentType: d.garment_type,
          orderKind: d.order_kind ?? 'CUSTOM', fulfillmentOption: d.fulfillment_option ?? null,
          itemTitle: d.item_title ?? null, itemSize: d.item_size ?? null, itemQuantity: d.item_quantity ?? 1, itemSubtotal: d.item_subtotal ?? null, fulfillmentFee: d.fulfillment_fee ?? 0,
          garmentDescription: d.garment_description, stage: d.stage,
          customerId: d.customer_id,
          customerName: d.customer_profiles?.display_name ?? 'Customer',
          quotedAmount: d.quoted_amount, quotedCurrency: d.currency ?? d.quoted_currency ?? 'USD', quotedCompletionDate: d.quoted_completion_date,
          fulfillmentPaymentRequestedAt: d.fulfillment_payment_requested_at ?? null,
          fulfillmentPaymentPaidAt: d.fulfillment_payment_paid_at ?? null,
          fulfillmentPaymentProvider: d.fulfillment_payment_provider ?? null,
          fulfillmentPaymentIntentId: d.fulfillment_payment_intent_id ?? null,
          fulfillmentPaymentCheckoutUrl: d.fulfillment_payment_checkout_url ?? null,
          fabricSource: d.fabric_source, deliveryMethod: d.delivery_method, deliveryAddress: d.delivery_address ?? null,
          recipientName: d.recipient_name ?? null, recipientPhone: d.recipient_phone ?? null,
          trackingNumber: d.tracking_number ?? null, carrier: d.carrier ?? null,
          fulfillmentProvider: d.fulfillment_provider ?? null,
          fulfillmentReference: d.fulfillment_reference ?? null,
          fulfillmentContactName: d.fulfillment_contact_name ?? null,
          fulfillmentContactPhone: d.fulfillment_contact_phone ?? null,
          referencePhotos: asStringList(d.reference_photos),
          fitNote: d.fit_note, measurements: enrichMeasurementSnapshot(d.customer_measurements_snapshot ?? null) as Measurement | null,
          supportMeta: parseOrderSupportMeta(d.special_note),
          collectionCode: d.collection_code, videoCallUrl: d.video_call_url ?? null,
          occasion: d.occasion, deadline: d.deadline, createdAt: d.created_at,
        })
        setHandoffIssue(openHandoffIssue)

        const { count: customerReviewCount } = await supabase
          .from('customer_reviews')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', d.id)

        setHasCustomerReview((customerReviewCount ?? 0) > 0)
      } else {
        setHandoffIssue(null)
        setOrder(null)
        setHasCustomerReview(false)
      }
    } catch (error) {
      setFetchErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Connection is weak. We could not load this order yet. Retry when the signal improves, or reopen it from Orders later.'
          : 'We could not load this order right now. Retry, or reopen it from your Orders list.'
      )
      setHandoffIssue(null)
      setOrder(null)
      setHasCustomerReview(false)
    }
    setLoading(false)
  }

  useEffect(() => { void fetchOrder() }, [id, user?.id])

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
  const statusGuidance = orderStatusGuidance(order.stage, order.orderKind)
  const measurementSource = order.measurements?.measurementSource
  const fitConfidence = order.measurements?.fitConfidence
  const measurementConfirmationNeeded = order.measurements?.needsConfirmation === true
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
  const fitProfileReviewNeeded = fitProfileNeedsTailorReview(order.supportMeta)
  const fabricHandoffMode = order.supportMeta.fabricHandoffMode ?? null
  const fabricHandoffLabel =
    order.supportMeta.fabricHandoffLabel ??
    (fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null)
  const materialIssue = order.supportMeta.materialIssue ?? null
  const materialIssueOpen = hasOpenMaterialIssue(order.supportMeta)
  const materialIssueNeedsCustomerDecision = materialIssue?.status === 'OPEN'
  const materialIssueCancellationRequested = materialIssue?.status === 'CUSTOMER_REQUESTED_CANCEL'
  const handoffHelpAvailable = ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED', 'IN_DISPUTE'].includes(order.stage)
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
  const canRequestDeliveryReview =
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED'].includes(order.stage)
  const waitingOnTailorSourcing = materialIssue?.status === 'CUSTOMER_RESPONDED' && materialIssue?.response === 'ASK_TAILOR_TO_SOURCE'
  const canConfirmFabricReceived =
    order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.includes(order.stage) &&
    (!order.supportMeta.fabricReceivedAt || materialIssue?.response === 'REPLACE_FABRIC')
  const cuttingBlockedLocally =
    measurementConfirmationNeeded ||
    fitProfileReviewNeeded ||
    materialIssueOpen ||
    (
      order.fabricSource === 'CUSTOMER_SUPPLIES' &&
      !order.supportMeta.fabricReceivedAt &&
      !waitingOnTailorSourcing
    )

  const quotedHeadlineAmount = baseAmount(order)

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
            const { error } = await invokeFunction('tailor-order-action', {
              body: { orderId: currentOrderId, action: 'confirm-fabric-received' },
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
    setStageModalTarget(target)
    setShowStageModal(true)
  }

  async function startCall(callType: 'audio' | 'video') {
    if (!order) return
    if (startingCall) return
    setStartingCall(callType)
    try {
      const room = await createConsultationRoom(order.id, callType)
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
      const room = await createOrderCallRoom(order.id, callType)
      if (!room?.url) return
      await fetchOrder()
      await openDrapeCallUrl(room.url)
    } finally {
      setStartingOrderCall(null)
    }
  }

  function openOrderCallOptions() {
    if (!order || startingOrderCall) return
    if (order.videoCallUrl) {
      Alert.alert(
        'Join Drape call',
        `Open the current Drape call with ${order.customerName}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Video', onPress: () => { void openDrapeCallUrl(order.videoCallUrl!) } },
          { text: 'Audio only', onPress: () => { void openDrapeCallUrl(order.videoCallUrl!) } },
        ]
      )
      return
    }

    Alert.alert(
      'Start Drape call',
      `Start a Drape call with ${order.customerName} without exposing personal phone numbers.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Video', onPress: () => { void startOrderCall('video') } },
        { text: 'Audio only', onPress: () => { void startOrderCall('audio') } },
      ]
    )
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

  function openCustomerReview() {
    if (!order) return
    router.push({
      pathname: '/(tailor)/clients/review/[orderId]',
      params: {
        orderId: order.id,
        returnTo: '/(tailor)/orders',
      },
    })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
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
              <View
                style={[styles.stagePill, { backgroundColor: stageColor(order.stage).bg }]}
                testID="tailor-order-stage"
              >
                <Text style={[styles.stageText, { color: stageColor(order.stage).text }]}>
                  {tailorOrderStageLabel(order.stage, order.orderKind)}
                </Text>
              </View>
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
                        params: { orderId: order.id, returnTo: `/(tailor)/orders/${order.id}` },
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
                  <Button label="Send quote" onPress={() => setShowQuoteModal(true)} testID="tailor-send-quote-btn" />
                  <Button label="Request consultation" variant="secondary" onPress={() => setShowConsultationModal(true)} />
                  <Button
                    label="Decline this order"
                    variant="ghost"
                    onPress={() => {
                      Alert.alert('Decline order', 'Are you sure you want to decline this order?', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Decline', style: 'destructive',
                          onPress: async () => {
                            const { error } = await invokeFunction('tailor-order-action', {
                              body: { orderId: order.id, action: 'decline-order' },
                            })
                            if (error) {
                              const message = isLikelyConnectivityIssue(error)
                                ? 'Connection looks weak. We could not decline this order yet. Retry when the signal improves.'
                                : await readFunctionErrorMessage(error, 'Could not decline this order right now. Please try again in a moment.')
                              Alert.alert('Error', message)
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
                    }}
                  />
                </>
              )}
            </View>
          )}

          {/* CONSULTATION — tailor awaiting consultation, then sends quote */}
          {order.stage === 'CONSULTATION' && (
            <View style={[styles.alertCard, styles.consultationCard]}>
              <Text style={styles.alertTitle}>Consultation requested</Text>
              <Text style={styles.alertSub}>
                {consultationPaymentRequired && !consultationPaymentPaid
                  ? "You've requested a paid consultation. Wait for the customer to pay before you start the call."
                  : "You've requested a consultation with this customer. Once done, send your quote or decline."}
              </Text>
              {consultationPaymentRequired ? (
                <Text style={styles.supportHint}>
                  {consultationPaymentPaid
                    ? 'Consultation fee paid. You can start the consultation call when ready.'
                    : 'The customer still needs to pay the consultation fee before the consultation can begin.'}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={order.videoCallUrl ? 'Rejoin call' : '📹 Video call'}
                    onPress={() => startCall('video')}
                    loading={startingCall === 'video'}
                    disabled={!!startingCall || (consultationPaymentRequired && !consultationPaymentPaid)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="🎙 Audio call"
                    variant="secondary"
                    onPress={() => startCall('audio')}
                    loading={startingCall === 'audio'}
                    disabled={!!startingCall || (consultationPaymentRequired && !consultationPaymentPaid)}
                  />
                </View>
              </View>
              <Button label="Send quote" variant="secondary" onPress={() => setShowQuoteModal(true)} />
              <Button
                label="Decline"
                variant="ghost"
                onPress={() => {
                  Alert.alert('Decline', 'Are you sure you want to decline this order after consultation?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Decline', style: 'destructive',
                      onPress: async () => {
                        const { error } = await invokeFunction('tailor-order-action', {
                          body: { orderId: order.id, action: 'decline-order' },
                        })
                        if (error) {
                          const message = isLikelyConnectivityIssue(error)
                            ? 'Connection looks weak. We could not decline this order yet. Retry when the signal improves.'
                            : await readFunctionErrorMessage(error, 'Could not decline this order right now. Please try again in a moment.')
                          Alert.alert('Error', message)
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
                }}
              />
            </View>
          )}

          {order.orderKind === 'CUSTOM' && (consultationMeta || quoteBreakdown || bulkOrder) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Commercial setup</Text>
              {consultationMeta ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Consultation policy</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Status" value={consultationMeta.status === 'COMPLETED' ? 'Consultation completed' : 'Consultation requested'} />
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
                    <BriefRow
                      label="Measurement privacy"
                      value={bulkOrder.measurementPrivacy === 'TAILOR_ONLY' ? 'Tailor only' : 'Tailor-private by default'}
                    />
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
                    Keep recipient-level measurements and any consistency notes inside Drape so ops can help manage the group cleanly.
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
              {flexibleNextStages.map((target) => (
                <Button
                  key={target}
                  label={displayStageChoiceLabel(target, order.orderKind)}
                  variant={flexibleNextStages.indexOf(target) === 0 ? 'primary' : 'secondary'}
                  onPress={() => openStageModal(target)}
                />
              ))}
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
                      ? `Keep packing and checking this order. When it is ready, hand it to Drape for dispatch.`
                      : `Mark this order ready for Drape dispatch once it is packed and checked.`)}
              </Text>
              {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Drape-managed dispatch</Text>
                  <Text style={styles.supportHint}>
                    Drape will manage the actual dispatch from ops once you mark this packed order ready. You only need to finish packing, quality-check the order, and hand it over cleanly.
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
                  label="Mark ready for Drape dispatch"
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
                Ask the customer to show their 4-digit code, then enter it below to confirm collection and close the handoff in Drape.
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

          {showCancellationPolicyCard && (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Cancellation and refund review</Text>
              {cancellationReviewOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>Review open</Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drape is reviewing whether this order should be cancelled before handoff. Keep all updates inside the order timeline.
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
                    Drape is reviewing a dispatch or delivery issue on this order. Keep ops and customer updates inside this timeline while the handoff is paused.
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

          {(measurementSource || fitConfidence || order.fabricSource === 'CUSTOMER_SUPPLIES' || materialIssue) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pre-cutting checks</Text>
          {cuttingBlockedLocally && order.orderKind === 'CUSTOM' && ['CONFIRMED', 'DESIGNING', 'SOURCING'].includes(order.stage) ? (
                <View style={styles.supportWarningCard}>
                  <Text style={styles.supportWarningTitle}>Cutting still has a blocker</Text>
                  <Text style={styles.supportWarningText}>
                    {measurementConfirmationNeeded
                      ? 'The customer still needs to confirm measurements before cutting can start.'
                      : fitProfileReviewNeeded
                        ? 'The guided fit intake still needs your review before cutting can start.'
                      : materialIssueOpen
                        ? 'There is an open material issue that needs a customer decision first.'
                        : 'Customer fabric still needs to be received before cutting can start.'}
                  </Text>
                </View>
              ) : null}

              {(measurementSource || fitConfidence || measurementConfirmationNeeded) && (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Measurement readiness</Text>
                  <View style={styles.supportMetaList}>
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
                  </View>
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
                  <Text style={styles.supportCardTitle}>Guided fit intake</Text>
                  <View style={styles.supportMetaList}>
                    {fitProfile.status ? (
                      <BriefRow label="Status" value={MEASUREMENT_SCAN_STATUS_LABELS[fitProfile.status]} />
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
                        Guided fit intake reviewed
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {(order.fabricSource === 'CUSTOMER_SUPPLIES' || fabricHandoffLabel || fabricPolicy || materialIssue) && (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Fabric handoff</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow
                      label="Fabric source"
                      value={order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer supplies' : 'Tailor sources'}
                    />
                    {fabricHandoffLabel ? <BriefRow label="Handoff plan" value={fabricHandoffLabel} /> : null}
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
            </View>
          )}

          {/* Body profile card — visible as soon as measurements are attached to the order */}
          {hasMeasurementContent(order.measurements) && (
            <BodyProfileCard measurements={order.measurements} />
          )}

          {/* Brief details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{order.orderKind === 'READY_MADE' ? 'Purchase' : 'Brief'}</Text>
            {order.garmentDescription && (
              <Text style={styles.briefText}>{order.garmentDescription}</Text>
            )}
            <View style={styles.briefMeta}>
              {order.orderKind === 'READY_MADE' && order.itemTitle ? <BriefRow label="Item" value={order.itemTitle} /> : null}
              {order.orderKind === 'READY_MADE' && order.itemSize ? <BriefRow label="Size" value={order.itemSize} /> : null}
              {order.orderKind === 'READY_MADE' ? <BriefRow label="Quantity" value={`${order.itemQuantity}`} /> : null}
              {baseAmount(order) != null && order.orderKind === 'READY_MADE' ? (
                <BriefRow
                  label="Item price"
                  value={formatAmount(baseAmount(order) ?? 0, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                />
              ) : null}
              {baseAmount(order) != null && order.orderKind !== 'READY_MADE' ? (
                <BriefRow
                  label="Quote amount"
                  value={formatAmount(baseAmount(order) ?? 0, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                />
              ) : null}
              {order.orderKind === 'READY_MADE' && order.fulfillmentOption ? (
                <BriefRow
                  label="Fulfillment"
                  value={order.fulfillmentOption === 'PICKUP' ? 'Pickup' : order.fulfillmentOption === 'DELIVERY' ? 'Delivery' : order.fulfillmentOption === 'SHIPPING' ? 'Shipping' : order.fulfillmentOption}
                />
              ) : null}
              {order.occasion && <BriefRow label="Occasion" value={order.occasion} />}
              {order.deadline && (
                <BriefRow
                  label="Deadline"
                  value={new Date(order.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                />
              )}
              <BriefRow label="Fabric" value={order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer supplies' : 'You source'} />
              <BriefRow
                label="Delivery"
                value={
                  order.deliveryMethod === 'LOCAL_COLLECTION'
                    ? 'Local collection'
                    : order.deliveryMethod === 'LOCAL_DELIVERY'
                      ? 'Local delivery'
                      : 'Shipping'
                }
              />
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.recipientName ? (
                <BriefRow label="Recipient" value={order.recipientName} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.recipientPhone ? (
                <BriefRow label="Recipient phone" value={order.recipientPhone} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.deliveryAddress ? (
                <BriefRow label={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Deliver to' : 'Ship to'} value={order.deliveryAddress} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && (order.fulfillmentProvider || order.carrier) ? (
                <BriefRow label="Partner" value={order.fulfillmentProvider ?? order.carrier ?? ''} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && dispatchRecord?.serviceLevel ? (
                <BriefRow label="Service level" value={DISPATCH_SERVICE_LEVEL_LABELS[dispatchRecord.serviceLevel]} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.fulfillmentReference ? (
                <BriefRow label="Reference" value={order.fulfillmentReference} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.fulfillmentContactName ? (
                <BriefRow label={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery contact' : 'Shipping contact'} value={order.fulfillmentContactName} />
              ) : null}
              {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.fulfillmentContactPhone ? (
                <BriefRow label={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery phone' : 'Shipping phone'} value={order.fulfillmentContactPhone} />
              ) : null}
              {order.deliveryMethod === 'SHIPPING' && order.trackingNumber && (
                <>
                  <BriefRow
                    label="Tracking"
                    value={order.fulfillmentProvider ? `${order.trackingNumber} · ${order.fulfillmentProvider}` : order.carrier ? `${order.trackingNumber} · ${order.carrier}` : order.trackingNumber}
                  />
                  <Button
                    label="Open tracking page"
                    variant="secondary"
                    onPress={() => {
                      void openTrackingPage({
                        trackingNumber: order.trackingNumber!,
                        carrier: order.fulfillmentProvider ?? order.carrier,
                        audience: 'tailor',
                      })
                    }}
                  />
                </>
              )}
            </View>
            {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>
                  {order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery proof' : 'Shipping proof'}
                </Text>
                <Text style={styles.supportHint}>
                  {order.deliveryMethod === 'LOCAL_DELIVERY'
                    ? 'Only mark this order out for delivery after a rider or local delivery partner has accepted it. Keep the delivery partner, contact, and dispatch proof inside Drape so support can follow the same timeline if the handoff stalls.'
                    : 'Only mark this order as shipped after the parcel has been accepted for dispatch. Keep the tracking or shipment reference, dispatch proof, and any customs or duties updates inside Drape so support can follow the same timeline if the shipment stalls.'}
                </Text>
              </View>
            ) : null}
            {order.fitNote && (
              <View style={styles.fitNote}>
                <Text style={styles.fitNoteLabel}>Fit note from customer</Text>
                <Text style={styles.fitNoteText}>"{order.fitNote}"</Text>
              </View>
            )}

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
                        ? 'Drape support has been flagged for follow-up. Keep all updates in this order thread.'
                        : 'This handoff help thread is open inside Drape. Keep all updates here so the timeline stays clear.'}
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
                    label={startingOrderCall ? 'Starting Drape call...' : order.videoCallUrl ? 'Join Drape call' : 'Start Drape call'}
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
                  {visibleReferencePhotos.map((url, i) => (
                    <ExpoImage
                      key={i}
                      source={url}
                      style={styles.refPhoto}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={120}
                      onError={() => {
                        setFailedReferencePhotos((prev) => prev.includes(url) ? prev : [...prev, url])
                      }}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Measurements */}
          {hasMeasurementContent(order.measurements) && (
            <MeasurementsSection measurements={order.measurements} />
          )}

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Aftercare</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Post-handoff expectations</Text>
                <Text style={styles.supportHint}>
                  Keep any fit, finish, alteration, remake, or workmanship follow-up inside Drape. Obvious issues should be
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
                    : 'Leave an internal customer review so future work has better context. This stays inside Drape and is not public.'}
                </Text>
                {!hasCustomerReview ? (
                  <Button
                    label="Review customer"
                    onPress={openCustomerReview}
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

      {/* Message CTA */}
      <View style={styles.messageCta}>
        <Button
          label={`Message ${order.customerName.split(' ')[0]}`}
          variant="secondary"
          onPress={() =>
            router.navigate({
              pathname: '/(tailor)/messages/[orderId]',
              params: { orderId: order.id, returnTo: `/(tailor)/orders/${order.id}` },
            })
          }
        />
      </View>

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

      {/* Quote modal */}
      <QuoteModal
        visible={showQuoteModal}
        orderId={order.id}
        defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
        deliveryMethod={order.deliveryMethod}
        customerDeadline={order.deadline}
        onClose={() => setShowQuoteModal(false)}
        onSent={() => { setShowQuoteModal(false); fetchOrder() }}
      />

      {/* Stage update modal */}
      {stageModalTarget && (
        <StageUpdateModal
          visible={showStageModal}
          order={order}
          targetStage={stageModalTarget}
          onClose={() => setShowStageModal(false)}
          onUpdated={async (updatedStage) => {
            setShowStageModal(false)
            await fetchOrder()
            if (updatedStage === 'FINISHING' && order.deliveryMethod !== 'LOCAL_COLLECTION') {
              Alert.alert(
                'Preparing order',
                'Keep packing and checking this order. When it is truly ready, come back here and mark it ready for Drape dispatch.',
              )
            }
          }}
          userId={user?.id ?? ''}
        />
      )}

      {/* Consultation modal */}
      <ConsultationModal
        visible={showConsultationModal}
        orderId={order.id}
        defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
        onClose={() => setShowConsultationModal(false)}
        onSent={() => { setShowConsultationModal(false); fetchOrder() }}
      />

      <MeasurementConfirmationRequestModal
        visible={showMeasurementRequestModal}
        orderId={order.id}
        onClose={() => setShowMeasurementRequestModal(false)}
        onSent={() => {
          setShowMeasurementRequestModal(false)
          void fetchOrder()
        }}
      />

      <FitReadinessModal
        visible={showFitReadinessModal}
        orderId={order.id}
        onClose={() => setShowFitReadinessModal(false)}
        onSent={() => {
          setShowFitReadinessModal(false)
          void fetchOrder()
        }}
      />

      <MaterialIssueModal
        visible={showMaterialIssueModal}
        orderId={order.id}
        onClose={() => setShowMaterialIssueModal(false)}
        onSent={() => {
          setShowMaterialIssueModal(false)
          void fetchOrder()
        }}
      />

      <CancellationReviewRequestModal
        visible={showCancellationReviewModal}
        orderId={order.id}
        onClose={() => setShowCancellationReviewModal(false)}
        onSent={() => {
          setShowCancellationReviewModal(false)
          void fetchOrder()
        }}
      />

      <DeliveryReviewRequestModal
        visible={showDeliveryReviewModal}
        orderId={order.id}
        onClose={() => setShowDeliveryReviewModal(false)}
        onSent={() => {
          setShowDeliveryReviewModal(false)
          void fetchOrder()
        }}
      />

      {/* Collection code modal */}
      <CollectionCodeModal
        visible={showCodeModal}
        orderId={order.id}
        expectedCode={order.collectionCode ?? ''}
        onClose={() => setShowCodeModal(false)}
        onConfirmed={async () => {
          setShowCodeModal(false)
          await fetchOrder()
          Alert.alert(
            'Collection confirmed',
            hasCustomerReview
              ? 'Pickup is complete. The customer can finish the order in Drape now.'
              : 'Pickup is complete. You can review this customer next or head back to Orders.',
            hasCustomerReview
              ? [
                  { text: 'Stay here', style: 'cancel' },
                  { text: 'Back to orders', onPress: () => router.replace('/(tailor)/orders') },
                ]
              : [
                  { text: 'Back to orders', style: 'cancel', onPress: () => router.replace('/(tailor)/orders') },
                  { text: 'Review customer', onPress: openCustomerReview },
                ],
          )
        }}
      />
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
              <Text style={styles.fitFlagText}>{f.replace(/_/g, ' ').toLowerCase()}</Text>
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
      <Text style={{ fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.ink }}>{value}</Text>
    </View>
  )
}

// ─── Measurements Section ─────────────────────────────────────────────────────

function MeasurementsSection({ measurements: m }: { measurements: Measurement }) {
  const rows = [
    { label: 'Chest', value: m.chest }, { label: 'Waist', value: m.waist },
    { label: 'Hips', value: m.hips }, { label: 'Shoulders', value: m.shoulderWidth },
    { label: 'Inseam', value: m.inseam }, { label: 'Sleeve', value: m.sleeveLength },
    { label: 'Neck', value: m.neckCircumference }, { label: 'Height', value: m.height },
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
  ]

  if (numericFields.some((value) => typeof value === 'number' && Number.isFinite(value))) return true
  if (typeof measurements.fitStyle === 'string' && measurements.fitStyle.trim().length > 0) return true
  if (typeof measurements.garmentContext === 'string' && measurements.garmentContext.trim().length > 0) return true
  if (asStringList(measurements.bodyShape).length > 0) return true
  if (asStringList(measurements.fitFlags).length > 0) return true
  if (typeof measurements.bodyNote === 'string' && measurements.bodyNote.trim().length > 0) return true

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

function MeasurementConfirmationRequestModal({ visible, orderId, onClose, onSent }: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!visible) return
    setNote('')
    setNoteError('')
    setSending(false)
  }, [visible, orderId])

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
      body: { orderId, action: 'request-measurement-confirmation', note: note.trim() },
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
                Ask one clear question so the customer can confirm the measurements without confusion.
              </Text>
            </View>

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

  useEffect(() => {
    if (!visible) return
    setNote('')
    setNoteError('')
    setSending(false)
  }, [visible, orderId])

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
                Use this once you have reviewed the guided fit intake and are comfortable moving the order toward cutting.
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

  useEffect(() => {
    if (!visible) return
    setReason(null)
    setNote('')
    setNoteError('')
    setSending(false)
  }, [visible, orderId])

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

  useEffect(() => {
    if (!visible) return
    setReason(null)
    setNote('')
    setNoteError('')
    setSubmitError('')
    setSending(false)
  }, [visible, orderId])

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
      Alert.alert('Choose a reason', 'Tell Drape why this order needs cancellation review before handoff.')
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
                Use this when the order cannot move forward cleanly before pickup or dispatch starts. Drape will review the remedy with you and the customer.
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
              placeholder="Add context for Drape. e.g. The item was damaged during final checks before dispatch."
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

  useEffect(() => {
    if (!visible) return
    setReason(null)
    setNote('')
    setNoteError('')
    setSubmitError('')
    setSending(false)
  }, [visible, orderId])

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
      Alert.alert('Choose a reason', 'Tell Drape what went wrong with dispatch or delivery.')
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
                Use this when Drape dispatch is slipping, the recipient could not be reached, or the parcel is not reaching the customer cleanly.
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
              placeholder="Add context for Drape. e.g. The rider could not reach the recipient after multiple attempts."
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

function QuoteModal({ visible, orderId, defaultCurrency, deliveryMethod, customerDeadline, onClose, onSent }: {
  visible: boolean
  orderId: string
  defaultCurrency: CurrencyCode
  deliveryMethod: string
  customerDeadline: string | null
  onClose: () => void
  onSent: () => void
}) {
  const currencyLabel = `${currencySymbol(defaultCurrency)} ${defaultCurrency}`
  const [amount, setAmount] = useState('')
  const [completionDate, setCompletionDate] = useState('')
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

  useEffect(() => {
    if (!visible) return
    setAmount('')
    setCompletionDate('')
    setCompletionDateValue(null)
    setShowDatePicker(false)
    setLaborAmount('')
    setSourcingAmount('')
    setRushAmount('')
    setIncludedText('')
    setExcludedText('')
    setBreakdownSummary('')
    setNote('')
    setNoteError('')
    setSending(false)
  }, [visible, orderId, defaultCurrency, deliveryMethod])

  function openCompletionDatePicker() {
    const next = completionDateValue ? new Date(completionDateValue) : new Date()
    if (!completionDateValue) {
      next.setDate(next.getDate() + 14)
      setCompletionDateValue(next)
      setCompletionDate(next.toISOString().slice(0, 10))
    }
    setShowDatePicker(true)
  }

  function validateNote(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) { setNoteError("Contact details can't be included."); return false }
    setNoteError(''); return true
  }

  async function send() {
    if (sending) return
    if (!amount || !completionDate) return
    if (!validateNote(note)) return

    // Validate date — Hermes (iOS) rejects non-padded formats like "2026/04/1"
    const parsedDate = new Date(completionDate)
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
          action: 'send-quote',
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

      capture('quote_sent', { amount_pence: amountPence, has_note: !!note.trim() })
      onSent()
    } catch (e) {
      console.error('Send quote error:', e)
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
            <Text style={styles.modalTitle}>Send quote</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Quote currency</Text>
              <Text style={styles.supportHint}>
                This order is locked to {currencyLabel}. To quote in a different currency, update your pricing setup in account settings before starting a new order.
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
                  : 'Enter your base quote. Drape adds the standard dispatch fee automatically based on the customer address and your location.'
              }
              testID="quote-amount-input"
            />
            {deliveryMethod !== 'LOCAL_COLLECTION' ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Drape-managed dispatch</Text>
                <Text style={styles.supportHint}>
                  Standard {deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} is collected at checkout as a flat Drape fee. You do not need to enter a separate dispatch amount here.
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
              value={completionDate}
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
                value={completionDateValue ?? (() => {
                  const next = new Date()
                  next.setDate(next.getDate() + 14)
                  return next
                })()}
                mode="date"
                minimumDate={new Date()}
                maximumDate={customerDeadline ? new Date(customerDeadline) : undefined}
                onChange={(_, date) => {
                  setShowDatePicker(false)
                  if (!date) return
                  setCompletionDateValue(date)
                  setCompletionDate(date.toISOString().slice(0, 10))
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
            <Button
              label="Send quote"
              onPress={send}
              loading={sending}
              disabled={sending || !amount || !completionDate || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Stage Update Modal ───────────────────────────────────────────────────────

function StageUpdateModal({ visible, order, targetStage, onClose, onUpdated, userId }: {
  visible: boolean; order: OrderDetail; targetStage: OrderStage; onClose: () => void; onUpdated: (updatedStage: OrderStage) => void; userId: string
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [provider, setProvider] = useState('')
  const [reference, setReference] = useState('')
  const [deliveryContactName, setDeliveryContactName] = useState('')
  const [deliveryContactPhone, setDeliveryContactPhone] = useState('')

  const nextStage: OrderStage = targetStage

  useEffect(() => {
    if (!visible) return
    setNote('')
    setNoteError('')
    setPhotoUri(null)
    setUpdating(false)
    setTrackingNumber('')
    setProvider('')
    setReference('')
    setDeliveryContactName('')
    setDeliveryContactPhone('')
  }, [visible, order.id, targetStage])

  function validateNote(t: string) {
    if (t.trim().length < 10) { setNoteError('Tell your customer what you are working on. Use at least 10 characters.'); return false }
    const placeholder = rejectPlaceholder(t, 'Note')
    if (placeholder) { setNoteError(placeholder); return false }
    const res = filterContactInfo(t)
    if (res.blocked) { setNoteError("Contact details can't be included."); return false }
    setNoteError(''); return true
  }

  async function pickPhoto() {
    if (updating) return
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri)
  }

  async function update() {
    if (updating) return
    if (!nextStage) return
    if (note.trim().length < 10) {
      Alert.alert('Note required', 'Tell your customer what you are working on. Use at least 10 characters.')
      return
    }
    if (!validateNote(note)) return
    if (!photoUri) {
      Alert.alert('Photo required', stageUpdatePhotoRequiredMessage(order, nextStage))
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
      let photoUrl: string | null = null
      if (photoUri) {
        const cleanUri = await stripExif(photoUri)
        const ext = 'jpg'
        const filename = `progress/${order.id}/${Date.now()}.${ext}`
        try {
          const response = await fetch(cleanUri)
          const blob = await response.blob()
          if (blob.size > 10 * 1024 * 1024) throw new Error('Photo exceeds 10 MB limit.')
          await supabase.storage.from('order-photos').upload(filename, blob, { contentType: `image/${ext}` })
          const { data } = supabase.storage.from('order-photos').getPublicUrl(filename)
          photoUrl = data.publicUrl
        } catch (uploadErr: any) {
          if (uploadErr?.message?.includes('10 MB')) throw uploadErr
        }
      }

      const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
        body: {
          orderId: order.id,
          action: 'advance-stage',
          targetStage: nextStage,
          note: note.trim() || undefined,
          photoUrl: photoUrl ?? undefined,
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
        has_photo: !!photoUrl,
        has_note: !!note.trim(),
      })

      onUpdated(nextStage)
    } catch (e) {
      console.error('Stage update error:', e)
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

            {/* Progress photo */}
            <View>
              <Text style={styles.photoLabel}>{stageUpdatePhotoLabel(order, nextStage)} <Text style={{ color: Colors.error }}>*</Text></Text>
              <Text style={styles.photoHint}>{stageUpdatePhotoHint(order, nextStage)}</Text>
              {photoUri ? (
                <View style={styles.photoPreviewWrap}>
                  <ExpoImage
                    source={photoUri}
                    style={styles.photoPreview}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={120}
                  />
                  <TouchableOpacity style={styles.photoRemove} onPress={() => setPhotoUri(null)} disabled={updating}>
                    <Text style={styles.photoRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoPickBtn} onPress={pickPhoto} disabled={updating}>
                  <Text style={styles.photoPickText}>+ Add photo</Text>
                </TouchableOpacity>
              )}
            </View>

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
                    ? 'Only mark this as out for delivery after the rider or local delivery partner has actually accepted the order. Keep rider, contact, and dispatch updates in Drape so support can recover the timeline if anything goes wrong.'
                    : 'Only mark this as shipped after the courier has actually accepted the parcel. Keep provider, tracking, shipment reference, and customs updates in Drape so support can recover the timeline if anything goes wrong.'}
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
                !photoUri ||
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
  )
}

// ─── Consultation Modal ───────────────────────────────────────────────────────

function ConsultationModal({ visible, orderId, defaultCurrency, onClose, onSent }: {
  visible: boolean; orderId: string; defaultCurrency: CurrencyCode; onClose: () => void; onSent: () => void
}) {
  const currencyLabel = `${currencySymbol(defaultCurrency)} ${defaultCurrency}`
  const [fee, setFee] = useState('')
  const [creditFeeTowardOrder, setCreditFeeTowardOrder] = useState(true)
  const [paymentTiming, setPaymentTiming] = useState<'BEFORE_CALL_STARTS' | 'WAIVED_OR_FREE'>('BEFORE_CALL_STARTS')
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

  useEffect(() => {
    if (!visible) return
    setFee('')
    setCreditFeeTowardOrder(true)
    setPaymentTiming('BEFORE_CALL_STARTS')
    setReschedulePolicy('ONE_FREE_RESCHEDULE')
    setNoShowPolicy('FEE_FORFEITED')
    setExpiryPolicy('EXPIRES_IN_14_DAYS')
    setReminderEnabled(true)
    setNote('')
    setNoteError('')
    setSending(false)
  }, [visible, orderId])

  function validateNote(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) { setNoteError("Contact details can't be included."); return false }
    setNoteError(''); return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)

    const feePence = fee ? Math.round(parseFloat(fee) * 100) : null

    const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-consultation',
        consultationFee: feePence,
        currency: defaultCurrency,
        creditFeeTowardOrder: feePence ? creditFeeTowardOrder : false,
        paymentTiming: feePence ? paymentTiming : 'WAIVED_OR_FREE',
        reschedulePolicy,
        noShowPolicy: feePence ? noShowPolicy : 'CASE_BY_CASE',
        expiryPolicy,
        reminderEnabled,
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

    capture('consultation_requested', { has_fee: !!feePence })
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
            <Text style={styles.modalTitle}>Request consultation</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.consultationInfo}>
              <Text style={styles.consultationInfoText}>
                A consultation lets you assess the order details before committing to a quote. The customer will be notified and can discuss further via messages.
              </Text>
            </View>
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
                  <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[styles.currencyChip, creditFeeTowardOrder && styles.currencyChipActive]}
                      onPress={() => setCreditFeeTowardOrder(true)}
                    >
                      <Text style={[styles.currencyChipText, creditFeeTowardOrder && styles.currencyChipTextActive]}>Credit it later</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.currencyChip, !creditFeeTowardOrder && styles.currencyChipActive]}
                      onPress={() => setCreditFeeTowardOrder(false)}
                    >
                      <Text style={[styles.currencyChipText, !creditFeeTowardOrder && styles.currencyChipTextActive]}>Separate fee</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.fieldLabel}>When is payment due?</Text>
                  <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
                    {(['BEFORE_CALL_STARTS'] as const).map((value) => (
                      <TouchableOpacity
                        key={value}
                        style={[styles.currencyChip, paymentTiming === value && styles.currencyChipActive]}
                        onPress={() => setPaymentTiming(value)}
                      >
                        <Text style={[styles.currencyChipText, paymentTiming === value && styles.currencyChipTextActive]}>
                          {CONSULTATION_PAYMENT_TIMING_LABELS[value]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.fieldLabel}>Reschedule policy</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
                {(['ONE_FREE_RESCHEDULE', 'FLEXIBLE_WITH_NOTICE', 'CASE_BY_CASE'] as const).map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.currencyChip, reschedulePolicy === value && styles.currencyChipActive]}
                    onPress={() => setReschedulePolicy(value)}
                  >
                    <Text style={[styles.currencyChipText, reschedulePolicy === value && styles.currencyChipTextActive]}>
                      {CONSULTATION_RESCHEDULE_POLICY_LABELS[value]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>No-show policy</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
                {noShowOptions.map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.currencyChip, noShowPolicy === value && styles.currencyChipActive]}
                    onPress={() => setNoShowPolicy(value)}
                  >
                    <Text style={[styles.currencyChipText, noShowPolicy === value && styles.currencyChipTextActive]}>
                      {CONSULTATION_NO_SHOW_POLICY_LABELS[value]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>How long should this consultation hold?</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
                {(['EXPIRES_IN_7_DAYS', 'EXPIRES_IN_14_DAYS', 'NO_EXPIRY'] as const).map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.currencyChip, expiryPolicy === value && styles.currencyChipActive]}
                    onPress={() => setExpiryPolicy(value)}
                  >
                    <Text style={[styles.currencyChipText, expiryPolicy === value && styles.currencyChipTextActive]}>
                      {CONSULTATION_EXPIRY_POLICY_LABELS[value]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Reminder support</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  style={[styles.currencyChip, reminderEnabled && styles.currencyChipActive]}
                  onPress={() => setReminderEnabled(true)}
                >
                  <Text style={[styles.currencyChipText, reminderEnabled && styles.currencyChipTextActive]}>Send reminder</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.currencyChip, !reminderEnabled && styles.currencyChipActive]}
                  onPress={() => setReminderEnabled(false)}
                >
                  <Text style={[styles.currencyChipText, !reminderEnabled && styles.currencyChipTextActive]}>No reminder</Text>
                </TouchableOpacity>
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
              label="Request consultation"
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

function CollectionCodeModal({ visible, orderId, expectedCode, onClose, onConfirmed }: {
  visible: boolean; orderId: string; expectedCode: string; onClose: () => void; onConfirmed: () => void
}) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const inputs = useRef<TextInput[]>([])

  useEffect(() => {
    if (!visible) return
    setDigits(['', '', '', ''])
    setError('')
    setConfirming(false)
  }, [visible, orderId, expectedCode])

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

          <Text style={styles.amountNote}>Collection confirmation closes the pickup handoff. Drape handles any payout follow-up after that.</Text>

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
      <Text style={styles.briefRowValue}>{value}</Text>
    </View>
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
  stateGuideCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  stateGuideTitle: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  stateGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.md },

  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  subheading: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 4 },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  stagePill: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
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
  alertTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  alertSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  stageCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: 10, gap: 5, ...Shadow.sm,
  },
  stageCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  stageCardSub: { fontSize: 11, color: Colors.inkLight, lineHeight: 17 },
  stageCardHint: { fontSize: 10, color: Colors.midGrey, lineHeight: 15, marginTop: -3 },

  consultationCard: { borderColor: Colors.kanteRust + '60', borderWidth: 1.5 },
  consultationInfo: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md, padding: Spacing.md,
  },
  consultationInfoText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Body profile
  bodyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
    borderLeftWidth: 4, borderLeftColor: Colors.kanteRust,
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
    padding: Spacing.sm, borderLeftWidth: 2, borderLeftColor: Colors.kanteRust,
  },
  bodyNoteText: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic' },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  fitStyleTag: { color: Colors.midGrey, fontWeight: FontWeight.regular },

  briefText: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  briefMeta: { gap: Spacing.sm },
  briefRow: { flexDirection: 'row', justifyContent: 'space-between' },
  briefRowLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  briefRowValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
  supportCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 10,
    gap: 5,
    ...Shadow.sm,
  },
  supportCardWarning: {
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
  },
  supportCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  supportMetaList: { gap: 6 },
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
  supportBodyText: { fontSize: 11, color: Colors.inkLight, lineHeight: 17 },
  supportHint: { fontSize: 10, color: Colors.midGrey, lineHeight: 16 },
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
    backgroundColor: '#FFF2DC',
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
    padding: Spacing.md, gap: 4, borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  fitNoteLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  fitNoteText: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic' },

  refPhoto: { width: 152, height: 152, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  measureItem: { width: '47%', backgroundColor: Colors.white, borderRadius: Radius.sm, padding: Spacing.md, gap: 2 },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },

  messageCta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, padding: Spacing.xl,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey, paddingBottom: Spacing.xxxl,
  },

  backLink: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  retryBtn: { backgroundColor: Colors.needleGreen, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl },
  retryBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
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
  modalContent: { padding: Spacing.xl, gap: Spacing.xl },
  shippingFields: { gap: Spacing.sm },
  shippingWarning: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.error,
  },

  nextStageRow: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between',
  },
  nextStageLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  nextStageValue: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.needleGreen },

  photoLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: 4 },
  photoHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginBottom: Spacing.md, lineHeight: 18 },
  photoPickBtn: {
    height: 100, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.lightGrey,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  photoPickText: { fontSize: FontSize.md, color: Colors.midGrey },
  photoPreviewWrap: { gap: Spacing.sm },
  photoPreview: { width: '100%', height: 200, borderRadius: Radius.md },
  photoRemove: { alignSelf: 'flex-start' },
  photoRemoveText: { color: Colors.error, fontSize: FontSize.sm },

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
  currencyChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  currencyChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  currencyChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  currencyChipTextActive: { color: Colors.needleGreen },
})
