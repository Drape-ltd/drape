import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Alert, Linking, Modal, KeyboardAvoidingView, Platform, TextInput, RefreshControl,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { openConsultationCallUrl } from '@/lib/consultation'
import { Sentry } from '@/lib/sentry'
import { openTrackingPage } from '@/lib/shipping'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import {
  COVERAGE_PREFERENCE_LABELS,
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
  hasOpenMaterialIssue,
  isShippingFabricHandoff,
  parseOrderSupportMeta,
  type MaterialIssueResponse,
  type MeasurementSnapshotMeta,
  type OrderSupportMeta,
} from '@/lib/order-support'
import { Button, Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, PRODUCTION_STAGES, type OrderStage } from '@drape/shared/order-machine'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { useCurrency, formatAmount, STATIC_FALLBACK_RATES, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/currency'
import { useOrderPaymentFlow } from '@/lib/payments'

type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
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
  itemTitle: string | null
  itemSize: string | null
  itemQuantity: number
  itemSubtotal: number | null
  fulfillmentFee: number
  stage: OrderStage
  tailorId: string
  tailorName: string
  quotedAmount: number | null
  quotedCurrency: CurrencyCode
  consultationFee: number | null
  quotedCompletionDate: string | null
  fabricSource: string
  deliveryMethod: string
  fabricTracking: string | null
  trackingNumber: string | null
  carrier: string | null
  collectionCode: string | null
  videoCallUrl: string | null
  measurementSnapshot: MeasurementSnapshot | null
  supportMeta: OrderSupportMeta
  stageUpdates: StageUpdate[]
  createdAt: string
}

const SUPPORT_EMAIL = 'support@drapeon.co'

// The 5 production stages shown in the progress bar
const PROGRESS_STAGES: OrderStage[] = ['CONFIRMED', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED']

// Stages that are before production starts — show a "Waiting" pre-step
const PRE_PRODUCTION_STAGES: OrderStage[] = ['CONSULTATION', 'PAYMENT_PENDING']
const PROGRESS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed', CUTTING: 'Cutting', SEWING: 'Sewing',
  FINISHING: 'Finishing', SHIPPED: 'Shipped',
}

function stageIndex(stage: OrderStage): number {
  // Map READY_FOR_COLLECTION -> same level as SHIPPED.
  // Map DESIGNING / SOURCING -> CONFIRMED (tailor pre-production stages that customers see as "Confirmed")
  // Map delivered / collected / complete -> final shipped-ready milestone in the progress bar.
  const normalised =
    stage === 'READY_FOR_COLLECTION' ? 'SHIPPED'
    : (stage === 'DESIGNING' || stage === 'SOURCING') ? 'CONFIRMED'
    : (stage === 'DELIVERED' || stage === 'COLLECTED' || stage === 'COMPLETE') ? 'SHIPPED'
    : stage
  return PROGRESS_STAGES.indexOf(normalised as OrderStage)
}

function stageGuidance(stage: OrderStage, deliveryMethod: string, orderKind: 'CUSTOM' | 'READY_MADE'): string | null {
  if (stage === 'CONSULTATION') {
    return 'Consultation comes before the quote.'
  }
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE'
      ? 'Checkout is still pending. Finish payment to place this order.'
      : 'Your quote is accepted, but production cannot start until payment is completed.'
  }
  if (stage === 'CONFIRMED') {
    return 'Your order is confirmed.'
  }
  if (stage === 'DESIGNING') {
    return 'Design details are being worked through.'
  }
  if (stage === 'SOURCING') {
    return 'Fabric or materials are being sourced.'
  }
  if (stage === 'CUTTING') {
    return 'Fabric is being cut.'
  }
  if (stage === 'SEWING') {
    return 'Your garment is being sewn.'
  }
  if (stage === 'FINISHING') {
    return 'Final checks and finishing are underway.'
  }
  if (stage === 'SHIPPED') {
    return 'Track delivery, then confirm receipt once it arrives.'
  }
  if (stage === 'DELIVERED') {
    return 'Check everything, then finish the order. Review is optional.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. Finish the order when you are happy. Review is optional.'
  }
  if (stage === 'COMPLETE') {
    return 'This order is complete.'
  }
  if (stage === 'IN_DISPUTE') {
    return 'Your concern is under review.'
  }
  if (stage === 'READY_FOR_COLLECTION' && deliveryMethod === 'LOCAL_COLLECTION') {
    return 'Bring your collection code to pickup.'
  }
  return null
}

function baseAmount(order: Pick<OrderDetail, 'orderKind' | 'itemSubtotal' | 'quotedAmount' | 'fulfillmentFee'>) {
  if (order.orderKind === 'READY_MADE') {
    return order.itemSubtotal ?? (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee, 0)
}

function fulfillmentFeeLabel(order: Pick<OrderDetail, 'orderKind' | 'deliveryMethod' | 'fulfillmentOption'>) {
  if (order.orderKind === 'READY_MADE' && order.fulfillmentOption === 'DELIVERY') return 'Delivery fee'
  if (order.deliveryMethod === 'LOCAL_COLLECTION' || order.fulfillmentOption === 'PICKUP') return 'Fulfillment fee'
  return 'Shipping fee'
}

export default function OrderTrackingScreen() {
  const { id, sent, tab, returnTo } = useLocalSearchParams<{ id: string; sent?: string; tab?: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  function fallbackTab(stage?: OrderStage | null): 'active' | 'completed' {
    if (tab === 'active' || tab === 'completed') return tab
    if (stage && ['COMPLETE', 'DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED'].includes(stage)) {
      return 'completed'
    }
    return 'active'
  }

  function goBack() {
    if (sent === '1') {
      router.replace({ pathname: '/(customer)/orders', params: { tab: 'active' } })
      return
    }
    if (returnTo) {
      router.replace(returnTo as any)
      return
    }
    if (navigation.canGoBack()) router.back()
    else router.replace({ pathname: '/(customer)/orders', params: { tab: fallbackTab(order?.stage) } })
  }
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [showDispute, setShowDispute] = useState(false)
  const [showMaterialIssueResponse, setShowMaterialIssueResponse] = useState(false)
  const [fabricTracking, setFabricTracking] = useState('')
  const [savingFabric, setSavingFabric] = useState(false)
  const [confirmingMeasurements, setConfirmingMeasurements] = useState(false)
  const [hasReview, setHasReview] = useState(false)
  const { startOrderPayment } = useOrderPaymentFlow()

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'customer')
  }

  async function contactSupport(kind: 'general' | 'aftercare' = 'general') {
    const fallbackSubject = `${kind === 'aftercare' ? 'Aftercare help' : 'Order help'}: #${order?.reference ?? id}`
    const subject = encodeURIComponent(fallbackSubject)
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}`
    const supported = await Linking.canOpenURL(mailto)
    if (!supported) {
      Alert.alert('Unable to open email', `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}", and keep the live order updated here so support can follow the full timeline.`)
      return
    }

    try {
      await Linking.openURL(mailto)
    } catch {
      Alert.alert('Unable to open email', `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}", and keep the live order updated here so support can follow the full timeline.`)
    }
  }

  const fetchOrder = useCallback(async () => {
    setLoading(true)
    setFetchErrorMessage('')
    setOrder(null)
    try {
      const [orderRes, reviewRes] = await Promise.allSettled([
        supabase
          .from('orders')
          .select(`
            id, reference, order_kind, seller_item_id, fulfillment_option, garment_type, garment_description, item_title, item_size, item_quantity, item_subtotal, stage,
            tailor_id, tailor_profile_id, quoted_amount, quoted_currency, consultation_fee, fulfillment_fee, quoted_completion_date,
            fabric_source, delivery_method, fabric_tracking, tracking_number, carrier,
            collection_code, video_call_url, special_note, customer_measurements_snapshot, created_at,
            tailor_profiles!tailor_profile_id(display_name),
            order_stage_updates(id, stage, note, photo_url, created_at)
          `)
          .eq('id', id)
          .eq('customer_id', user?.id)
          .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
          .maybeSingle(),
        supabase
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', id),
      ])

      const orderError =
        orderRes.status === 'fulfilled'
          ? orderRes.value.error
          : orderRes.reason

      if (orderError) {
        throw orderError
      }

      const data =
        orderRes.status === 'fulfilled'
          ? orderRes.value.data
          : null
      const reviewCount =
        reviewRes.status === 'fulfilled' && !reviewRes.value.error
          ? (reviewRes.value.count ?? 0)
          : 0

      setHasReview(reviewCount > 0)

      if (data) {
        const d = data as any
        setFabricTracking(d.fabric_tracking ?? '')
        setOrder({
          id: d.id,
          reference: d.reference,
          orderKind: d.order_kind ?? 'CUSTOM',
          sellerItemId: d.seller_item_id ?? null,
          fulfillmentOption: d.fulfillment_option ?? null,
          garmentType: d.garment_type,
          garmentDescription: d.garment_description,
          itemTitle: d.item_title ?? null,
          itemSize: d.item_size ?? null,
          itemQuantity: d.item_quantity ?? 1,
          itemSubtotal: d.item_subtotal ?? null,
          fulfillmentFee: d.fulfillment_fee ?? 0,
          stage: d.stage,
          tailorId: d.tailor_id,
          tailorName: d.tailor_profiles?.display_name ?? '',
          quotedAmount: d.quoted_amount,
          quotedCurrency: (d.quoted_currency ?? 'USD') as CurrencyCode,
          consultationFee: d.consultation_fee ?? null,
          quotedCompletionDate: d.quoted_completion_date,
          fabricSource: d.fabric_source,
          deliveryMethod: d.delivery_method,
          fabricTracking: d.fabric_tracking,
          trackingNumber: d.tracking_number ?? null,
          carrier: d.carrier ?? null,
          collectionCode: d.collection_code,
          videoCallUrl: d.video_call_url ?? null,
          measurementSnapshot: enrichMeasurementSnapshot(d.customer_measurements_snapshot ?? null) as MeasurementSnapshot | null,
          supportMeta: parseOrderSupportMeta(d.special_note),
          stageUpdates: (d.order_stage_updates ?? []).map((u: any) => ({
              id: u.id,
              stage: u.stage,
              note: u.note,
              photoUrl: u.photo_url,
              createdAt: u.created_at,
            })),
          createdAt: d.created_at,
        })
      } else {
        setOrder(null)
      }
      setLoading(false)
    } catch (error) {
      setFetchErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Connection is weak. We could not load this order yet. Retry when the signal improves, or reopen it from Orders later.'
          : 'We could not load this order right now. Retry, or reopen it from your Orders list.'
      )
      setOrder(null)
      setLoading(false)
    }
  }, [id, user?.id])

  async function handleRefresh() {
    setRefreshing(true)
    await fetchOrder()
    setRefreshing(false)
  }

  useEffect(() => { void fetchOrder() }, [fetchOrder])

  useFocusEffect(
    useCallback(() => {
      void fetchOrder()
    }, [fetchOrder])
  )

  async function confirmReceipt() {
    if (confirming) return
    Alert.alert(
      'Confirm receipt',
      'Confirming tells Drape the order is in your hands. Only confirm once you have actually received it. If something is wrong, raise a concern first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm receipt',
          style: 'default',
          onPress: async () => {
            if (confirming) return
            setConfirming(true)
            const { error } = await invokeFunction('customer-order-action', {
              body: { orderId: id, action: 'confirm-receipt' },
            })
            setConfirming(false)
            if (error) {
              Sentry.captureException(error, { extra: { context: 'confirm_receipt', orderId: id } })
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not confirm receipt yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'Could not confirm receipt. Please try again.')
              Alert.alert('Error', message)
            } else {
              router.replace(`/(customer)/review/${id}`)
            }
          },
        },
      ]
    )
  }

  async function saveFabricTracking() {
    if (savingFabric) return
    if (!fabricTracking.trim()) return
    if (filterContactInfo(fabricTracking).blocked) {
      Alert.alert('Invalid input', "Contact details can't be included in tracking numbers.")
      return
    }
    setSavingFabric(true)
    const { error, data } = await invokeFunction<{ ok: boolean; fabricTracking?: string }>('customer-order-action', {
      body: { orderId: id, action: 'save-fabric-tracking', fabricTracking: fabricTracking.trim() },
    })
    setSavingFabric(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'save_fabric_tracking', orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save this tracking detail yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save tracking number. Please try again.')
      Alert.alert('Error', message)
    } else {
      const nextValue = data?.fabricTracking ?? fabricTracking.trim()
      setFabricTracking(nextValue)
      setOrder((prev) => prev ? { ...prev, fabricTracking: nextValue } : prev)
    }
  }

  async function continuePayment() {
    if (!order || paying) return

    setPaying(true)
    const result = await startOrderPayment({
      orderId: order.id,
      customerEmail: user?.email,
    })
    setPaying(false)

    await fetchOrder()

    if (!result.ok) {
      if (result.reason === 'cancelled') {
        Alert.alert(
          'Payment not finished',
          order.orderKind === 'READY_MADE'
            ? 'Your checkout is still saved. You can finish payment from this order any time.'
            : 'Your quote is still saved. You can finish payment from this order any time.',
        )
        return
      }

      Alert.alert('Payment unavailable', result.message)
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
              Sentry.captureException(error, { extra: { context: 'confirm_measurements', orderId: order.id } })
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not confirm your measurements yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'Could not confirm your measurements right now. Please try again.')
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
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your order…</Text>
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
            <TouchableOpacity onPress={fetchOrder} style={styles.retryBtn}>
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

  const progressStage = order.stage === 'IN_DISPUTE'
    ? (([...order.stageUpdates].reverse().find((u) => u.stage !== 'IN_DISPUTE')?.stage as OrderStage | undefined) ?? 'CONFIRMED')
    : order.stage
  const currentStageIdx = stageIndex(progressStage)
  const latestUpdate = [...order.stageUpdates].reverse()[0]
  const isCollection = order.deliveryMethod === 'LOCAL_COLLECTION'
  const stageHelp = stageGuidance(order.stage, order.deliveryMethod, order.orderKind)
  const measurementSource = order.measurementSnapshot?.measurementSource
  const fitConfidence = order.measurementSnapshot?.fitConfidence
  const measurementConfirmationNeeded = order.measurementSnapshot?.needsConfirmation === true
  const fitProfile = order.supportMeta.fitProfile ?? null
  const fabricHandoffMode = order.supportMeta.fabricHandoffMode ?? null
  const fabricHandoffLabel =
    order.supportMeta.fabricHandoffLabel ??
    (fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null)
  const showFabricTrackingSection =
    order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    (fabricHandoffMode == null || isShippingFabricHandoff(fabricHandoffMode))
  const materialIssue = order.supportMeta.materialIssue ?? null
  const materialIssueOpen = hasOpenMaterialIssue(order.supportMeta)
  const materialIssueNeedsResponse = materialIssue?.status === 'OPEN'
  const materialIssueCancellationRequested = materialIssue?.status === 'CUSTOMER_REQUESTED_CANCEL'
  const materialIssueReasonLabel =
    materialIssue?.reasonLabel ??
    (materialIssue?.reason ? MATERIAL_ISSUE_REASON_LABELS[materialIssue.reason] : null)
  const materialIssueResponseLabel =
    materialIssue?.responseLabel ??
    (materialIssue?.response ? MATERIAL_ISSUE_RESPONSE_LABELS[materialIssue.response] : null)

  // ── QUOTE_SENT state — dedicated accept / decline view ──────────────────
  if (order.stage === 'QUOTE_SENT') {
    return (
      <QuoteReviewScreen
        order={order}
        onAction={fetchOrder}
        router={router}
        customerEmail={user?.email ?? ''}
        preferredTab={tab}
      />
    )
  }

  // ── PENDING_QUOTE — waiting on tailor ───────────────────────────────────
  if (order.stage === 'PENDING_QUOTE') {
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
                ✓  Brief sent to {order.tailorName.split(' ')[0]} · #{order.reference}
              </Text>
            </View>
          )}
          <Text style={styles.heading}>{order.garmentType}</Text>
          <Text style={styles.subheading}>{order.tailorName}  ·  #{order.reference}</Text>
          <View style={styles.statusCard} testID="order-pending-quote">
            <Text style={styles.statusStage}>{isReadyMadeInquiry ? 'Inquiry open' : 'Awaiting quote'}</Text>
            <Text style={styles.statusNote}>
              {isReadyMadeInquiry
                ? `Your chat with ${order.tailorName.split(' ')[0]} is open. Ask about size, fit, colour, pickup, or delivery before you buy.`
                : `Your brief is with ${order.tailorName.split(' ')[0]}. Message them if needed.`}
            </Text>
          </View>
          <View style={styles.nextStepsCard}>
            <Text style={styles.nextStepsTitle}>What happens next</Text>
            {isReadyMadeInquiry ? (
              <>
                <Text style={styles.nextStepsItem}>1. Message the seller about this item</Text>
                <Text style={styles.nextStepsItem}>2. Once you are ready, continue to checkout</Text>
                <Text style={styles.nextStepsItem}>3. Your purchase order starts after checkout</Text>
              </>
            ) : (
              <>
                <Text style={styles.nextStepsItem}>1. {order.tailorName.split(' ')[0]} reviews your order and sends a quote</Text>
                <Text style={styles.nextStepsItem}>2. You review the quote and accept or decline</Text>
                <Text style={styles.nextStepsItem}>3. Production starts once you accept</Text>
              </>
            )}
          </View>
          <Button
            label={`Message ${order.tailorName.split(' ')[0]}`}
            variant="secondary"
            onPress={() =>
              router.navigate({
                pathname: '/(customer)/messages/[orderId]',
                params: { orderId: order.id, returnTo: `/(customer)/orders/${order.id}` },
              })
            }
          />
          {isReadyMadeInquiry && order.sellerItemId ? (
            <Button
              label="Continue to checkout"
              onPress={() => router.navigate(`/(customer)/tailor/item/checkout/${order.sellerItemId}`)}
            />
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.needleGreen} />}
      >
        <View style={styles.content}>
          {/* Header */}
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>{order.tailorName}  ·  #{order.reference}</Text>
            {order.orderKind === 'READY_MADE' ? (
              <View style={styles.orderTypePill}>
                <Text style={styles.orderTypePillText}>Ready-made order</Text>
              </View>
            ) : null}
          </View>

          {/* Stage progress bar */}
          {PRE_PRODUCTION_STAGES.includes(order.stage) ? (
            <View style={styles.preProductionBar}>
              <View style={styles.preProductionDot} />
              <Text style={styles.preProductionLabel}>Awaiting confirmation</Text>
            </View>
          ) : (
          <View style={styles.progressBar}>
            {PROGRESS_STAGES.map((s, i) => {
              const done = i <= currentStageIdx
              const active = i === currentStageIdx
              return (
                <View key={s} style={styles.progressStep}>
                  <View style={[styles.progressDot, done && styles.progressDotDone, active && styles.progressDotActive]}>
                    {done && !active && <Text style={styles.progressCheck}>✓</Text>}
                  </View>
                  {i < PROGRESS_STAGES.length - 1 && (
                    <View style={[styles.progressLine, done && i < currentStageIdx && styles.progressLineDone]} />
                  )}
                  <Text style={[styles.progressLabel, done && styles.progressLabelDone]}>
                    {isCollection && s === 'SHIPPED' ? 'Ready' : PROGRESS_LABELS[s]}
                  </Text>
                </View>
              )
            })}
          </View>
          )}

          {/* Current stage status */}
          <View style={styles.statusCard} testID="order-tracking-status">
            <Text style={styles.statusStage}>{STAGE_LABELS[order.stage]}</Text>
            {stageHelp && <Text style={styles.statusHelp}>{stageHelp}</Text>}
            {latestUpdate?.note && (
              <Text style={styles.statusNote}>"{latestUpdate.note}"</Text>
            )}
            {latestUpdate?.photoUrl && (
              <Image source={{ uri: latestUpdate.photoUrl }} style={styles.progressPhoto} resizeMode="cover" />
            )}
            {order.quotedCompletionDate && order.stage !== 'COMPLETE' && order.stage !== 'DELIVERED' && order.stage !== 'COLLECTED' && order.stage !== 'IN_DISPUTE' && (
              <Text style={styles.statusEta}>
                Est. ready {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}
              </Text>
            )}
          </View>

          {order.stage === 'PAYMENT_PENDING' && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>
                {order.orderKind === 'READY_MADE' ? 'Finish checkout' : 'Finish payment'}
              </Text>
              <Text style={styles.videoCallHint}>
                {order.orderKind === 'READY_MADE'
                  ? 'Your order is reserved, but it will only move forward once payment succeeds.'
                  : 'Your tailor will only see this order as confirmed after payment succeeds.'}
              </Text>
              <Button
                label={order.orderKind === 'READY_MADE' ? 'Continue checkout' : 'Continue payment'}
                onPress={continuePayment}
                loading={paying}
                disabled={paying}
              />
            </View>
          )}

          {/* Consultation */}
          {order.stage === 'CONSULTATION' && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>
                {order.videoCallUrl ? 'Consultation call ready' : 'Consultation requested'}
              </Text>
              {order.consultationFee != null && (
                <Text style={styles.consultationFeeText}>
                  Consultation fee: {formatAmount(order.consultationFee, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)}
                </Text>
              )}
              <Text style={styles.videoCallHint}>
                {order.videoCallUrl
                  ? 'Your tailor has started a call. Join with video or audio only.'
                  : `Your tailor wants to speak before production starts. Keep chatting here and ${order.tailorName.split(' ')[0]} will share the call link when ready.`}
              </Text>
              {order.videoCallUrl ? (
                <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Button label="📹 Join video" onPress={() => { void openCallUrl(order.videoCallUrl!) }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="🎙 Audio only" variant="secondary" onPress={() => { void openCallUrl(order.videoCallUrl!) }} />
                  </View>
                </View>
              ) : (
                <Button
                  label={`Message ${order.tailorName.split(' ')[0]}`}
                  variant="secondary"
                  onPress={() =>
                    router.navigate({
                      pathname: '/(customer)/messages/[orderId]',
                      params: { orderId: order.id, returnTo: `/(customer)/orders/${order.id}` },
                    })
                  }
                />
              )}
            </View>
          )}

          {/* Collection code — show when ready for collection */}
          {order.stage === 'READY_FOR_COLLECTION' && order.collectionCode && (
            <View style={styles.collectionCard}>
              <Text style={styles.collectionTitle}>Your order is ready to collect</Text>
              <Text style={styles.collectionHint}>
                Inspect your order before sharing your code.{'\n'}Once entered, Drape records the collection handoff as complete.
              </Text>
              <View style={styles.codeBox}>
                {order.collectionCode.split('').map((digit, i) => (
                  <View key={i} style={styles.codeDigit}>
                    <Text style={styles.codeDigitText}>{digit}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.collectionInstruction}>Show this to {order.tailorName}</Text>
              <TouchableOpacity onPress={() => setShowDispute(true)}>
                <Text style={styles.disputeLink}>Something wrong? Report issue</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Confirm receipt button — shipping path */}
          {order.stage === 'SHIPPED' && order.deliveryMethod !== 'LOCAL_COLLECTION' && (
            <Button
              label="I've received my order"
              onPress={confirmReceipt}
              loading={confirming}
              disabled={confirming}
            />
          )}

          {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.trackingNumber && ['SHIPPED', 'DELIVERED', 'COMPLETE', 'IN_DISPUTE'].includes(order.stage) && (
            <View style={styles.trackingRow}>
              <View>
                <Text style={styles.trackingLabel}>Shipment tracking</Text>
                <Text style={styles.trackingNumber}>{order.trackingNumber}</Text>
                {order.carrier ? <Text style={styles.fabricSavedNote}>{order.carrier}</Text> : null}
              </View>
              <View style={styles.trackingAction}>
                <Button
                  label="Track shipment"
                  variant="secondary"
                  onPress={() => {
                    void openTrackingPage({
                      trackingNumber: order.trackingNumber!,
                      carrier: order.carrier,
                      audience: 'customer',
                    })
                  }}
                />
              </View>
            </View>
          )}

          {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Shipping protection</Text>
              <Text style={styles.supportHint}>
                Do not confirm receipt until the garment is actually in hand. If tracking stalls, duties or delivery charges
                were unclear, or the parcel looks lost, keep the conversation in this order and open a concern here instead
                of trying to settle it offline.
              </Text>
            </View>
          ) : null}

          {(measurementSource || fitConfidence || measurementConfirmationNeeded) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Measurement check</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  {measurementSource ? (
                    <SummaryLine
                      label="Source"
                      value={MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource)}
                    />
                  ) : null}
                  {fitConfidence ? (
                    <SummaryLine
                      label="Fit confidence"
                      value={FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence)}
                    />
                  ) : null}
                </View>
                {measurementConfirmationNeeded ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Confirmation needed before cutting
                      </Text>
                    </View>
                    {order.measurementSnapshot?.confirmationReason ? (
                      <Text style={styles.supportBodyText}>{order.measurementSnapshot.confirmationReason}</Text>
                    ) : null}
                    <Text style={styles.supportHint}>
                      Your tailor has paused cutting until you confirm these measurements are still correct.
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
              <Text style={styles.sectionTitle}>Guided fit intake</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  {fitProfile.status ? (
                    <SummaryLine label="Status" value={MEASUREMENT_SCAN_STATUS_LABELS[fitProfile.status]} />
                  ) : null}
                  {fitProfile.fitIntent ? (
                    <SummaryLine label="Fit direction" value={FIT_INTENT_LABELS[fitProfile.fitIntent]} />
                  ) : null}
                  {fitProfile.fabricStretch ? (
                    <SummaryLine label="Stretch" value={FABRIC_STRETCH_LABELS[fitProfile.fabricStretch]} />
                  ) : null}
                  {fitProfile.wearDaySupport ? (
                    <SummaryLine label="Support" value={WEAR_DAY_SUPPORT_LABELS[fitProfile.wearDaySupport]} />
                  ) : null}
                  {fitProfile.coveragePreference ? (
                    <SummaryLine label="Coverage" value={COVERAGE_PREFERENCE_LABELS[fitProfile.coveragePreference]} />
                  ) : null}
                  {typeof fitProfile.heelHeightCm === 'number' ? (
                    <SummaryLine label="Heel height" value={`${fitProfile.heelHeightCm} cm`} />
                  ) : null}
                </View>
                {fitProfile.styleEaseNotes ? <Text style={styles.supportBodyText}>{fitProfile.styleEaseNotes}</Text> : null}
                {fitProfile.postureNote ? <Text style={styles.supportHint}>Posture: {fitProfile.postureNote}</Text> : null}
                {fitProfile.asymmetryNote ? <Text style={styles.supportHint}>Asymmetry: {fitProfile.asymmetryNote}</Text> : null}
                {fitProfile.tailorMeasurementOverrideReason ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                        Tailor reviewed this fit intake
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>{fitProfile.tailorMeasurementOverrideReason}</Text>
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
                    This guided fit intake was attached to help your tailor quote and cut with more context.
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          {(order.fabricSource === 'CUSTOMER_SUPPLIES' || fabricHandoffLabel || materialIssue) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fabric handoff</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  <SummaryLine
                    label="Fabric source"
                    value={order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'You supply the fabric' : 'Tailor sources fabric'}
                  />
                  {fabricHandoffLabel ? (
                    <SummaryLine label="Handoff plan" value={fabricHandoffLabel} />
                  ) : order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                    <SummaryLine label="Handoff plan" value="To be confirmed in chat or consultation" />
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
                    {order.supportMeta.fabricReceivedNote ? ` · ${order.supportMeta.fabricReceivedNote}` : ''}.
                  </Text>
                ) : order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                  <Text style={styles.supportHint}>
                    Keep the order thread updated until the tailor confirms the fabric is in hand.
                  </Text>
                ) : (
                  <Text style={styles.supportHint}>
                    The tailor will source materials from the accepted quote instead of waiting on a customer handoff.
                  </Text>
                )}
              </View>
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
                      Choose how you want to handle the fabric issue so the order can move forward cleanly.
                    </Text>
                    <Button label="Respond to fabric issue" onPress={() => setShowMaterialIssueResponse(true)} />
                  </>
                ) : materialIssueCancellationRequested ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Cancellation request sent for review
                      </Text>
                    </View>
                    {materialIssueResponseLabel ? (
                      <Text style={styles.supportHint}>Your response: {materialIssueResponseLabel}.</Text>
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

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Aftercare</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Fit or finish issue?</Text>
                <Text style={styles.supportHint}>
                  Raise obvious fit or finish issues within 14 days. If you spot a credible workmanship issue later, tell
                  support as early as possible and ideally within 30 days. Keep photos, tailoring notes, and any local
                  alteration receipts in Drape.
                </Text>
                <Button
                  label="Contact support about aftercare"
                  variant="secondary"
                  onPress={() => { void contactSupport('aftercare') }}
                />
              </View>
            </View>
          )}

          {/* Review CTA — terminal stages without a review yet */}
          {['COMPLETE', 'DELIVERED', 'COLLECTED'].includes(order.stage) && !hasReview && (
            <TouchableOpacity
              style={styles.reviewCta}
              onPress={() => router.push(`/(customer)/review/${order.id}`)}
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

          {order.orderKind === 'READY_MADE' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Purchase details</Text>
              <View style={styles.timelineContent}>
                {order.itemTitle ? <SummaryLine label="Item" value={order.itemTitle} /> : null}
                {order.itemSize ? <SummaryLine label="Size" value={order.itemSize} /> : null}
                <SummaryLine label="Quantity" value={`${order.itemQuantity}`} />
                {order.fulfillmentOption ? (
                  <SummaryLine
                    label="Fulfillment"
                    value={order.fulfillmentOption === 'PICKUP' ? 'Pickup' : order.fulfillmentOption === 'DELIVERY' ? 'Delivery' : order.fulfillmentOption === 'SHIPPING' ? 'Shipping' : order.fulfillmentOption}
                  />
                ) : null}
                {order.itemSubtotal != null ? (
                  <SummaryLine label="Subtotal" value={formatAmount(order.itemSubtotal, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)} />
                ) : null}
                <SummaryLine
                  label={fulfillmentFeeLabel(order)}
                  value={order.fulfillmentFee > 0 ? formatAmount(order.fulfillmentFee, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES) : 'Free'}
                />
                {order.quotedAmount != null ? (
                  <SummaryLine label="Total" value={formatAmount(order.quotedAmount, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)} />
                ) : null}
              </View>
            </View>
          )}

          {/* Timeline */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timeline}>
              {order.stageUpdates.map((u) => (
                <View key={u.id} style={styles.timelineItem}>
                  <View style={styles.timelineDot} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>{STAGE_LABELS[u.stage as OrderStage] ?? u.stage}</Text>
                    {u.note && <Text style={styles.timelineNote}>{u.note}</Text>}
                    <Text style={styles.timelineDate}>
                      {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              ))}
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: Colors.lightGrey }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineStage}>Order submitted</Text>
                  <Text style={styles.timelineDate}>
                    {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            </View>
          </View>


          {/* Fabric tracking — editable when fabric is being shipped, or for older customer-supplied orders without a recorded handoff mode */}
          {showFabricTrackingSection && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fabric tracking</Text>
              <Text style={styles.trackingHint}>
                Save the shipping reference here so your tailor can follow the fabric's arrival.
              </Text>
              <View style={styles.fabricInputRow}>
                <TextInput
                  style={styles.fabricInput}
                  placeholder="e.g. JD123456789GB"
                  placeholderTextColor={Colors.midGrey}
                  value={fabricTracking}
                  onChangeText={setFabricTracking}
                  editable={!savingFabric}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.fabricSaveBtn, (!fabricTracking.trim() || fabricTracking === order.fabricTracking) && styles.fabricSaveBtnDisabled]}
                  onPress={saveFabricTracking}
                  disabled={!fabricTracking.trim() || fabricTracking === order.fabricTracking || savingFabric}
                >
                  {savingFabric
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <Text style={styles.fabricSaveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
              {order.fabricTracking && (
                <Text style={styles.fabricSavedNote}>
                  Saved: <Text style={{ color: Colors.needleGreen, fontWeight: FontWeight.semibold }}>{order.fabricTracking}</Text>
                </Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Message CTA */}
      <View style={styles.messageCta}>
        <Button
          label={`Message ${order.tailorName.split(' ')[0]}`}
          variant="secondary"
          onPress={() =>
            router.navigate({
              pathname: '/(customer)/messages/[orderId]',
              params: { orderId: order.id, returnTo: `/(customer)/orders/${order.id}` },
            })
          }
          testID="message-tailor-btn"
        />
        {/* Dispute entry — available from CONFIRMED onward, before auto-release */}
        {['CONFIRMED','DESIGNING','SOURCING','CUTTING','SEWING','FINISHING','SHIPPED','READY_FOR_COLLECTION'].includes(order.stage) && (
          <TouchableOpacity style={styles.disputeEntry} onPress={() => setShowDispute(true)}>
            <Text style={styles.disputeEntryText}>Something wrong? Raise a concern</Text>
          </TouchableOpacity>
        )}
        {['DELIVERED', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE'].includes(order.stage) && (
          <TouchableOpacity style={styles.disputeEntry} onPress={() => { void contactSupport() }}>
            <Text style={styles.disputeEntryText}>
              {order.stage === 'IN_DISPUTE'
                ? 'Need help with this concern? Contact support'
                : 'Need help with this order? Contact support'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <DisputeModal
        visible={showDispute}
        orderId={order.id}
        onClose={() => setShowDispute(false)}
        onSubmitted={() => { setShowDispute(false); fetchOrder() }}
        userId={user?.id ?? ''}
      />

      <MaterialIssueResponseModal
        visible={showMaterialIssueResponse}
        orderId={order.id}
        onClose={() => setShowMaterialIssueResponse(false)}
        onSubmitted={() => {
          setShowMaterialIssueResponse(false)
          void fetchOrder()
        }}
      />
    </SafeAreaView>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLineLabel}>{label}</Text>
      <Text style={styles.summaryLineValue}>{value}</Text>
    </View>
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

const DISPUTE_REASONS = [
  'Garment not as described',
  'Wrong measurements / poor fit',
  'Order not delivered',
  'Damaged item received',
  'Tailor unresponsive',
  'Other',
]

function MaterialIssueResponseModal({ visible, orderId, onClose, onSubmitted }: {
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

  useEffect(() => {
    if (!visible) return
    setResponse(null)
    setNote('')
    setNoteError('')
    setSubmitError('')
    setSubmitting(false)
  }, [visible, orderId])

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
      Alert.alert('Choose a response', 'Please tell your tailor how you want to handle this fabric issue.')
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
      Sentry.captureException(error, { extra: { context: 'respond_material_issue', orderId, response } })
      if (isLikelyConnectivityIssue(error)) {
        setSubmitError('Your connection looks weak. This response draft stayed here, so retry when the signal improves.')
        return
      }
      const payload = await readFunctionErrorPayload(error)
      const code = typeof payload?.code === 'string' ? payload.code : null
      const payloadMessage = typeof payload?.error === 'string' ? payload.error : null
      if (code === 'THREATENING_LANGUAGE') {
        const message = payloadMessage ?? "That note can't be submitted yet."
        setNoteError(message)
        setSubmitError(message)
        return
      }
      const message = await readFunctionErrorMessage(error, 'Could not save your response right now. Please try again.')
      setSubmitError(message)
      if (code === 'UNAUTHORIZED') {
        Alert.alert('Session expired', message)
      }
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
            <Text style={disputeStyles.title}>Handle fabric issue</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Keep this response inside Drape so the order timeline stays clear if support needs to step in later.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>Your choice <Text style={{ color: Colors.error }}>*</Text></Text>
              {MATERIAL_ISSUE_RESPONSE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[disputeStyles.reasonRow, response === option && disputeStyles.reasonRowActive]}
                  disabled={submitting}
                  onPress={() => setResponse(option)}
                >
                  <View style={[disputeStyles.radio, response === option && disputeStyles.radioActive]} />
                  <Text style={[disputeStyles.reasonText, response === option && disputeStyles.reasonTextActive]}>
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
                  Cancelling here sends a request for review. The order does not disappear instantly if work or fabric decisions already happened.
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

function DisputeModal({ visible, orderId, onClose, onSubmitted, userId }: {
  visible: boolean; orderId: string; onClose: () => void; onSubmitted: () => void; userId: string
}) {
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [descError, setDescError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function readPayloadString(payload: Record<string, unknown> | null, key: string) {
    const value = payload?.[key]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  async function resolveConcernFailure(error: Error | null) {
    const payload = error ? await readFunctionErrorPayload(error) : null
    const code = readPayloadString(payload, 'code')
    const payloadMessage = readPayloadString(payload, 'error')

    if (code === 'UNAUTHORIZED') {
      return { message: payloadMessage ?? 'Please sign in again before raising a concern.', descMessage: '', showAlert: true }
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
        message: payloadMessage ?? 'Too many concern attempts right now. Please wait a moment before trying again.',
        descMessage: '',
        showAlert: true,
      }
    }

    if (code === 'DISPUTE_REASON_REQUIRED' || code === 'DISPUTE_DESCRIPTION_REQUIRED') {
      return {
        message: payloadMessage ?? 'Please finish the concern details before submitting.',
        descMessage: code === 'DISPUTE_DESCRIPTION_REQUIRED' ? (payloadMessage ?? 'Please describe what happened before submitting this concern.') : '',
        showAlert: false,
      }
    }

    if (isLikelyConnectivityIssue(error)) {
      return {
        message: 'Your connection looks weak. Your concern draft is still here, so retry when the signal improves.',
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

  useEffect(() => {
    if (!visible) return
    setReason('')
    setDescription('')
    setDescError('')
    setSubmitError('')
    setSubmitting(false)
  }, [visible, orderId])

  function validateDesc(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) { setDescError(res.userMessage); return false }
    setDescError(''); return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) { Alert.alert('Select a reason', 'Please pick a reason for your concern.'); return }
    if (!description.trim()) { Alert.alert('Add details', 'Please describe the issue.'); return }
    if (!validateDesc(description)) return

    setSubmitError('')
    setSubmitting(true)

    const { error } = await invokeFunction('customer-order-action', {
      body: { orderId, action: 'open-dispute', reason, description: description.trim() },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'open_dispute', orderId } })
      const failure = await resolveConcernFailure(error)
      if (failure.descMessage) setDescError(failure.descMessage)
      setSubmitError(failure.message)
      if (failure.showAlert) {
        Alert.alert(failure.message.includes('sign in again') ? 'Session expired' : 'Concern unavailable', failure.message)
      }
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
            <Text style={disputeStyles.title}>Raise a concern</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Our team will review your concern within 72 hours. Keep messaging your tailor in the meantime, and include dates, delivery or fit details, and what outcome you need.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>Reason <Text style={{ color: Colors.error }}>*</Text></Text>
              {DISPUTE_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[disputeStyles.reasonRow, reason === r && disputeStyles.reasonRowActive]}
                  disabled={submitting}
                  onPress={() => setReason(r)}
                >
                  <View style={[disputeStyles.radio, reason === r && disputeStyles.radioActive]} />
                  <Text style={[disputeStyles.reasonText, reason === r && disputeStyles.reasonTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Describe the issue"
              placeholder="What happened? Be as specific as possible — include dates, what was promised, and what you received."
              value={description}
              onChangeText={(v) => { setDescription(v); if (descError) validateDesc(v) }}
              onBlur={() => validateDesc(description)}
              error={descError}
              multiline
              numberOfLines={5}
              maxLength={500}
              filterContact
              required
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Raising a concern pauses the order. Payment stays protected inside Drape until the concern is resolved, so keep all updates and evidence here.
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
              disabled={submitting || !reason || !description.trim()}
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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  cancel: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium, width: 60 },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  infoCard: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md, padding: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  infoText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.md },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey, marginBottom: Spacing.sm,
  },
  reasonRowActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRustLight },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
  },
  radioActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRust },
  reasonText: { fontSize: FontSize.sm, color: Colors.inkLight },
  reasonTextActive: { color: Colors.kanteRust, fontWeight: FontWeight.medium },
  warningCard: {
    backgroundColor: Colors.kanteRustLight, borderRadius: Radius.md, padding: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: Colors.kanteRust,
  },
  warningText: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  submitErrorCard: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  submitErrorText: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 18 },
})

// ─── Quote Review Screen ──────────────────────────────────────────────────────

function QuoteReviewScreen({
  order, onAction, router, customerEmail, preferredTab,
}: {
  order: OrderDetail
  onAction: () => Promise<void>
  router: ReturnType<typeof useRouter>
  customerEmail?: string
  preferredTab?: string
}) {
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const { currency, rates, setCurrency } = useCurrency()
  const navigation = useNavigation()
  const { startOrderPayment } = useOrderPaymentFlow()
  const totalLabel = order.quotedAmount ? formatAmount(order.quotedAmount, order.quotedCurrency, currency, rates) : '—'
  const feeLabel = order.fulfillmentFee > 0
    ? formatAmount(order.fulfillmentFee, order.quotedCurrency, currency, rates)
    : null
  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace({
      pathname: '/(customer)/orders',
      params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
    })
  }

  // Find the quote from stage updates or a separate quote field
  // The tailor's quote note is in the QUOTE_SENT stage update
  const quoteUpdate = order.stageUpdates.find((u) => u.stage === 'QUOTE_SENT')

  async function accept() {
    if (accepting || declining) return
    Alert.alert(
      'Accept and pay',
      feeLabel
        ? `Accept the total of ${totalLabel} from ${order.tailorName}? This includes ${fulfillmentFeeLabel(order).toLowerCase()} of ${feeLabel}.\n\nYou’ll be taken to secure payment now. Production starts after payment succeeds.`
        : `Accept the total of ${totalLabel} from ${order.tailorName}?\n\nYou’ll be taken to secure payment now. Production starts after payment succeeds.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            if (accepting || declining) return
            setAccepting(true)
            const result = await startOrderPayment({
              orderId: order.id,
              customerEmail,
            })
            setAccepting(false)
            await onAction()

            if (!result.ok) {
              if (result.reason === 'cancelled') {
                Alert.alert('Payment not finished', 'Your quote is still saved. Finish payment from the order screen any time.')
                router.replace({
                  pathname: `/(customer)/orders/${order.id}` as any,
                  params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
                })
                return
              }

              Sentry.captureException(new Error(result.message), {
                extra: { context: 'accept_quote_payment', orderId: order.id, reason: result.reason },
              })
              Alert.alert('Payment unavailable', result.message)
              return
            }

            router.replace({
              pathname: `/(customer)/orders/${order.id}` as any,
              params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
            })
          },
        },
      ]
    )
  }

  async function decline() {
    if (declining || accepting) return
    Alert.alert(
      'Decline quote',
      'Decline this quote? The order will be closed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            if (declining || accepting) return
            setDeclining(true)
            const { error } = await invokeFunction('customer-order-action', {
              body: { orderId: order.id, action: 'decline-quote' },
            })
            setDeclining(false)
            if (error) {
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not decline this quote yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'Could not decline this quote right now. Please try again in a moment.')
              Alert.alert('Error', message)
              return
            }
            router.replace({
              pathname: '/(customer)/orders',
              params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
            })
          },
        },
      ]
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.content}>
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>Quote from {order.tailorName}  ·  #{order.reference}</Text>
          </View>

          {/* Quote card */}
          <View style={[styles.statusCard, { borderWidth: 1.5, borderColor: Colors.needleGreen + '40' }]} testID="quote-received-card">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.sectionTitle}>Quote received</Text>
              {/* Currency picker */}
              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                {SUPPORTED_CURRENCIES.slice(0, 5).map((c) => (
                  <TouchableOpacity
                    key={c.code}
                    onPress={() => setCurrency(c.code as CurrencyCode)}
                    style={{
                      paddingHorizontal: 8, paddingVertical: 3,
                      borderRadius: 12, borderWidth: 1,
                      borderColor: currency === c.code ? Colors.needleGreen : Colors.lightGrey,
                      backgroundColor: currency === c.code ? Colors.needleGreenLight : Colors.white,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: currency === c.code ? Colors.needleGreen : Colors.midGrey, fontWeight: currency === c.code ? '600' : '400' }}>
                      {c.code}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {baseAmount(order) != null && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>{order.orderKind === 'READY_MADE' ? 'Subtotal' : 'Quote amount'}</Text>
                <Text style={quoteAmount}>{formatAmount(baseAmount(order) ?? 0, order.quotedCurrency, currency, rates)}</Text>
              </View>
            )}

            <View style={quoteDetailRow}>
              <Text style={quoteLabel}>{fulfillmentFeeLabel(order)}</Text>
              <Text style={quoteValue}>
                {order.fulfillmentFee > 0
                  ? formatAmount(order.fulfillmentFee, order.quotedCurrency, currency, rates)
                  : 'Free'}
              </Text>
            </View>

            {order.quotedAmount != null && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Total</Text>
                <Text style={quoteAmount}>{formatAmount(order.quotedAmount, order.quotedCurrency, currency, rates)}</Text>
              </View>
            )}

            {order.consultationFee != null && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Consultation fee</Text>
                <Text style={quoteValue}>{formatAmount(order.consultationFee, order.quotedCurrency, currency, rates)}</Text>
              </View>
            )}

            {order.quotedCompletionDate && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Est. completion</Text>
                <Text style={quoteValue}>
                  {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'long',
                  })}
                </Text>
              </View>
            )}

            {quoteUpdate?.note && (
              <View style={{ gap: 4 }}>
                <Text style={quoteLabel}>Note from {order.tailorName.split(' ')[0]}</Text>
                <Text style={styles.statusNote}>"{quoteUpdate.note}"</Text>
              </View>
            )}

            <View style={styles.escrowNote}>
              <Text style={styles.escrowNoteText}>
                Accepting locks in the price and delivery date. Raise a dispute any time if something goes wrong.
              </Text>
            </View>
          </View>

        </View>
      </ScrollView>

      {/* CTAs */}
      <View style={styles.messageCta}>
        <View style={{ flexDirection: 'row', gap: Spacing.md }}>
          <Button
            label="Decline"
            variant="secondary"
            onPress={decline}
            loading={declining}
            disabled={accepting || declining}
            style={{ flex: 1 }}
          />
          <Button
            label="Accept and pay"
            onPress={accept}
            loading={accepting}
            disabled={accepting || declining}
            style={{ flex: 1.6 }}
          />
        </View>
        <Button
          label={`Message ${order.tailorName.split(' ')[0]}`}
          variant="ghost"
          onPress={() =>
            router.navigate({
              pathname: '/(customer)/messages/[orderId]',
              params: { orderId: order.id, returnTo: `/(customer)/orders/${order.id}` },
            })
          }
        />
      </View>
    </SafeAreaView>
  )
}

// Inline StyleSheet objects for QuoteReviewScreen (avoids forward-ref issue)
const quoteDetailRow: import('react-native').ViewStyle = {
  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
}
const quoteLabel: import('react-native').TextStyle = {
  fontSize: 14, color: Colors.inkLight,
}
const quoteAmount: import('react-native').TextStyle = {
  fontSize: 22, fontWeight: '700', color: Colors.needleGreen,
}
const quoteValue: import('react-native').TextStyle = {
  fontSize: 14, fontWeight: '600', color: Colors.ink,
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },

  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  subheading: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 4 },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Progress bar
  progressBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 0 },
  progressStep: { flex: 1, alignItems: 'center', gap: Spacing.xs, position: 'relative' },
  progressDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.lightGrey, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.lightGrey,
  },
  progressDotDone: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  progressDotActive: { backgroundColor: Colors.white, borderColor: Colors.needleGreen, borderWidth: 3 },
  progressCheck: { fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold },
  progressLine: {
    position: 'absolute', top: 11, left: '50%', right: '-50%', height: 2,
    backgroundColor: Colors.lightGrey, zIndex: -1,
  },
  progressLineDone: { backgroundColor: Colors.needleGreen },
  progressLabel: { fontSize: 10, color: Colors.midGrey, textAlign: 'center' },
  progressLabelDone: { color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Status card
  statusCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  statusStage: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  statusNote: { fontSize: FontSize.md, color: Colors.inkLight, fontStyle: 'italic' },

  nextStepsCard: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.needleGreen + '30',
  },
  nextStepsTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreen, marginBottom: Spacing.xs },
  nextStepsItem: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  progressPhoto: { width: '100%', height: 200, borderRadius: Radius.md },
  statusHelp: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  statusEta: { fontSize: FontSize.sm, color: Colors.midGrey },

  // Video call card
  videoCallCard: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.needleGreen,
  },
  videoCallTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  consultationFeeText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  orderTypePill: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  orderTypePillText: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  videoCallHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Collection code
  collectionCard: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.lg, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.needleGreen + '40',
  },
  collectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  collectionHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 20 },
  codeBox: { flexDirection: 'row', gap: Spacing.md },
  codeDigit: {
    width: 56, height: 72, borderRadius: Radius.md,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.md, borderWidth: 1, borderColor: Colors.needleGreen + '30',
  },
  codeDigitText: { fontSize: 32, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  collectionInstruction: { fontSize: FontSize.sm, color: Colors.inkLight },
  disputeLink: { fontSize: FontSize.sm, color: Colors.kanteRust, fontWeight: FontWeight.medium },

  // Timeline
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  timeline: { gap: 0, paddingLeft: Spacing.sm },
  timelineItem: { flexDirection: 'row', gap: Spacing.md, paddingBottom: Spacing.lg },
  timelineDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.needleGreen, marginTop: 4, flexShrink: 0,
  },
  timelineContent: { flex: 1, gap: 2 },
  timelineStage: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  timelineNote: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic' },
  timelineDate: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Tracking
  trackingRow: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', ...Shadow.sm,
  },
  trackingAction: {
    minWidth: 148,
    marginLeft: Spacing.md,
  },
  trackingLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  trackingNumber: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryLineLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  summaryLineValue: { flex: 1, textAlign: 'right', fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  supportCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  supportCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  supportCardWarning: {
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
  },
  supportMetaList: { gap: Spacing.sm },
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
  supportStatusTextSuccess: { color: Colors.needleGreen },
  supportBodyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  supportHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },

  // Fabric tracking input
  trackingHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  fabricInputRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  fabricInput: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink, borderWidth: 1, borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  fabricSaveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, minWidth: 64, alignItems: 'center',
  },
  fabricSaveBtnDisabled: { backgroundColor: Colors.lightGrey },
  fabricSaveBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  fabricSavedNote: { fontSize: FontSize.xs, color: Colors.midGrey },

  reviewCta: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', ...Shadow.sm,
    borderWidth: 1, borderColor: '#F59E0B40',
  },
  reviewCtaInner: { gap: 3 },
  reviewCtaTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewCtaHint: { fontSize: FontSize.sm, color: Colors.inkLight },
  reviewCtaArrow: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: '#F59E0B' },

  messageCta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, padding: Spacing.xl,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    paddingBottom: Spacing.xxxl,
  },

  sentBanner: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  sentBannerText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

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

  // Pre-production waiting bar
  preProductionBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  preProductionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.warning },
  preProductionLabel: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },

  // Dispute entry
  disputeEntry: { alignItems: 'center', paddingTop: Spacing.sm },
  disputeEntryText: { fontSize: FontSize.sm, color: Colors.kanteRust, fontWeight: FontWeight.medium },

  // Quote review extras
  escrowNote: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  escrowNoteText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  expiryNote: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' as const },
})
