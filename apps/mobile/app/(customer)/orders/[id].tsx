import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Alert, Linking, Modal, KeyboardAvoidingView, Platform, TextInput, RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Sentry } from '@/lib/sentry'
import { Button, Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, PRODUCTION_STAGES, type OrderStage } from '@drape/shared/order-machine'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { useCurrency, formatAmount, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/currency'

type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
}

type OrderDetail = {
  id: string
  reference: string
  garmentType: string
  garmentDescription: string | null
  stage: OrderStage
  tailorId: string
  tailorName: string
  quotedAmount: number | null
  quotedCurrency: CurrencyCode
  quotedCompletionDate: string | null
  fabricSource: string
  deliveryMethod: string
  fabricTracking: string | null
  collectionCode: string | null
  videoCallUrl: string | null
  stageUpdates: StageUpdate[]
  createdAt: string
}

const DISPUTES_EMAIL = 'disputes@drape.com'

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
  const normalised =
    stage === 'READY_FOR_COLLECTION' ? 'SHIPPED'
    : (stage === 'DESIGNING' || stage === 'SOURCING') ? 'CONFIRMED'
    : stage
  return PROGRESS_STAGES.indexOf(normalised as OrderStage)
}

export default function OrderTrackingScreen() {
  const { id, sent } = useLocalSearchParams<{ id: string; sent?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(customer)/orders')
  }
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showDispute, setShowDispute] = useState(false)
  const [fabricTracking, setFabricTracking] = useState('')
  const [savingFabric, setSavingFabric] = useState(false)
  const [hasReview, setHasReview] = useState(false)

  async function fetchOrder() {
    setFetchError(false)
    try {
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from('orders')
        .select(`
          id, reference, garment_type, garment_description, stage,
          tailor_id, tailor_profile_id, quoted_amount, quoted_currency, quoted_completion_date,
          fabric_source, delivery_method, fabric_tracking,
          collection_code, video_call_url, created_at,
          tailor_profiles!tailor_profile_id(display_name),
          order_stage_updates(id, stage, note, photo_url, created_at)
        `)
        .eq('id', id)
        .eq('customer_id', user?.id)
        .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
        .single(),
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', id),
    ])
    setHasReview((count ?? 0) > 0)

    if (data) {
      const d = data as any
      setFabricTracking(d.fabric_tracking ?? '')
      setOrder({
        id: d.id,
        reference: d.reference,
        garmentType: d.garment_type,
        garmentDescription: d.garment_description,
        stage: d.stage,
        tailorId: d.tailor_id,
        tailorName: d.tailor_profiles?.display_name ?? '',
        quotedAmount: d.quoted_amount,
        quotedCurrency: (d.quoted_currency ?? 'USD') as CurrencyCode,
        quotedCompletionDate: d.quoted_completion_date,
        fabricSource: d.fabric_source,
        deliveryMethod: d.delivery_method,
        fabricTracking: d.fabric_tracking,
        collectionCode: d.collection_code,
        videoCallUrl: d.video_call_url ?? null,
        stageUpdates: (d.order_stage_updates ?? []).map((u: any) => ({
            id: u.id,
            stage: u.stage,
            note: u.note,
            photoUrl: u.photo_url,
            createdAt: u.created_at,
          })),
        createdAt: d.created_at,
      })
    }
    setLoading(false)
    } catch {
      setFetchError(true)
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    await fetchOrder()
    setRefreshing(false)
  }

  useEffect(() => { fetchOrder() }, [id])

  async function confirmReceipt() {
    Alert.alert(
      'Confirm receipt',
      'Confirming releases your payment to the tailor. Only confirm once you have received your order.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm receipt',
          style: 'default',
          onPress: async () => {
            setConfirming(true)
            const { error } = await supabase.functions.invoke('customer-order-action', {
              body: { orderId: id, action: 'confirm-receipt' },
            })
            setConfirming(false)
            if (error) {
              Sentry.captureException(error, { extra: { context: 'confirm_receipt', orderId: id } })
              Alert.alert('Error', 'Could not confirm receipt. Please try again.')
            } else {
              router.replace(`/(customer)/review/${id}`)
            }
          },
        },
      ]
    )
  }

  async function saveFabricTracking() {
    if (!fabricTracking.trim()) return
    if (filterContactInfo(fabricTracking).blocked) {
      Alert.alert('Invalid input', "Contact details can't be included in tracking numbers.")
      return
    }
    setSavingFabric(true)
    const { error } = await supabase
      .from('orders')
      .update({ fabric_tracking: fabricTracking.trim() })
      .eq('id', id)
      .eq('customer_id', user?.id)
    setSavingFabric(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'save_fabric_tracking', orderId: id } })
      Alert.alert('Error', 'Could not save tracking number. Please try again.')
    } else {
      setOrder((prev) => prev ? { ...prev, fabricTracking: fabricTracking.trim() } : prev)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Couldn't load this order.</Text>
          <TouchableOpacity onPress={fetchOrder} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Order not found.</Text>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const currentStageIdx = stageIndex(order.stage)
  const latestUpdate = [...order.stageUpdates].reverse()[0]
  const isCollection = order.deliveryMethod === 'LOCAL_COLLECTION'

  // ── QUOTE_SENT state — dedicated accept / decline view ──────────────────
  if (order.stage === 'QUOTE_SENT') {
    return <QuoteReviewScreen order={order} onAction={fetchOrder} router={router} userId={user?.id ?? ''} />
  }

  // ── PENDING_QUOTE — waiting on tailor ───────────────────────────────────
  if (order.stage === 'PENDING_QUOTE') {
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
            <Text style={styles.statusStage}>Awaiting quote</Text>
            <Text style={styles.statusNote}>
              Your order has been sent to {order.tailorName.split(' ')[0]}. While you wait for their quote, you can message them with any extra details.
            </Text>
          </View>
          <View style={styles.nextStepsCard}>
            <Text style={styles.nextStepsTitle}>What happens next</Text>
            <Text style={styles.nextStepsItem}>1. {order.tailorName.split(' ')[0]} reviews your order and sends a quote</Text>
            <Text style={styles.nextStepsItem}>2. You review the quote and accept or decline</Text>
            <Text style={styles.nextStepsItem}>3. Production starts once you accept</Text>
          </View>
          <Button
            label={`Message ${order.tailorName.split(' ')[0]}`}
            variant="secondary"
            onPress={() => router.navigate(`/(customer)/messages/${order.id}`)}
          />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
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
            {latestUpdate?.note && (
              <Text style={styles.statusNote}>"{latestUpdate.note}"</Text>
            )}
            {latestUpdate?.photoUrl && (
              <Image source={{ uri: latestUpdate.photoUrl }} style={styles.progressPhoto} resizeMode="cover" />
            )}
            {order.quotedCompletionDate && order.stage !== 'COMPLETE' && order.stage !== 'DELIVERED' && order.stage !== 'COLLECTED' && (
              <Text style={styles.statusEta}>
                Est. ready {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}
              </Text>
            )}
          </View>

          {/* Call — show when in CONSULTATION and tailor has created a room */}
          {order.stage === 'CONSULTATION' && order.videoCallUrl && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>Consultation call ready</Text>
              <Text style={styles.videoCallHint}>
                Your tailor has started a call. Join with video or audio only.
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button label="📹 Join video" onPress={() => Linking.openURL(order.videoCallUrl!)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="🎙 Audio only" variant="secondary" onPress={() => Linking.openURL(order.videoCallUrl!)} />
                </View>
              </View>
            </View>
          )}

          {/* Collection code — show when ready for collection */}
          {order.stage === 'READY_FOR_COLLECTION' && order.collectionCode && (
            <View style={styles.collectionCard}>
              <Text style={styles.collectionTitle}>Your order is ready to collect</Text>
              <Text style={styles.collectionHint}>
                Inspect your order before sharing your code.{'\n'}Once entered, payment is released to your tailor.
              </Text>
              <View style={styles.codeBox}>
                {order.collectionCode.split('').map((digit, i) => (
                  <View key={i} style={styles.codeDigit}>
                    <Text style={styles.codeDigitText}>{digit}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.collectionInstruction}>Show this to {order.tailorName}</Text>
              <TouchableOpacity onPress={() => Alert.alert('Report issue', `Email ${DISPUTES_EMAIL} with your order reference: #${order.reference}`)}>
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
            />
          )}

          {/* Review CTA — terminal stages without a review yet */}
          {['COMPLETE', 'DELIVERED', 'COLLECTED'].includes(order.stage) && !hasReview && (
            <TouchableOpacity
              style={styles.reviewCta}
              onPress={() => router.push(`/(customer)/review/${order.id}`)}
              activeOpacity={0.85}
            >
              <View style={styles.reviewCtaInner}>
                <Text style={styles.reviewCtaTitle}>How was your order?</Text>
                <Text style={styles.reviewCtaHint}>Leave a review for {order.tailorName.split(' ')[0]}</Text>
              </View>
              <Text style={styles.reviewCtaArrow}>★  Rate</Text>
            </TouchableOpacity>
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


          {/* Fabric tracking — editable when customer supplies own fabric */}
          {order.fabricSource === 'CUSTOMER_SUPPLIES' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fabric shipping</Text>
              <Text style={styles.trackingHint}>
                Enter your fabric's tracking number so your tailor can follow its arrival.
              </Text>
              <View style={styles.fabricInputRow}>
                <TextInput
                  style={styles.fabricInput}
                  placeholder="e.g. JD123456789GB"
                  placeholderTextColor={Colors.midGrey}
                  value={fabricTracking}
                  onChangeText={setFabricTracking}
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
          onPress={() => router.navigate(`/(customer)/messages/${order.id}`)}
          testID="message-tailor-btn"
        />
        {/* Dispute entry — available from CONFIRMED onward, before auto-release */}
        {['CONFIRMED','CUTTING','SEWING','FINISHING','SHIPPED','READY_FOR_COLLECTION'].includes(order.stage) && (
          <TouchableOpacity style={styles.disputeEntry} onPress={() => setShowDispute(true)}>
            <Text style={styles.disputeEntryText}>Something wrong? Raise a concern</Text>
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
    </SafeAreaView>
  )
}

// ─── Dispute Modal ────────────────────────────────────────────────────────────

// V1.1 TODO: extract to locale strings for i18n
const DISPUTE_REASONS = [
  'Garment not as described',
  'Wrong measurements / poor fit',
  'Order not delivered',
  'Damaged item received',
  'Tailor unresponsive',
  'Other',
]

function DisputeModal({ visible, orderId, onClose, onSubmitted, userId }: {
  visible: boolean; orderId: string; onClose: () => void; onSubmitted: () => void; userId: string
}) {
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [descError, setDescError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function validateDesc(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) { setDescError("Contact details can't be included."); return false }
    setDescError(''); return true
  }

  async function submit() {
    if (!reason) { Alert.alert('Select a reason', 'Please pick a reason for your concern.'); return }
    if (!description.trim()) { Alert.alert('Add details', 'Please describe the issue.'); return }
    if (!validateDesc(description)) return

    setSubmitting(true)

    const { error } = await supabase.functions.invoke('customer-order-action', {
      body: { orderId, action: 'open-dispute', reason, description: description.trim() },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'open_dispute', orderId } })
      Alert.alert('Error', 'Could not submit concern. Please try again.')
      return
    }
    onSubmitted()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Raise a concern</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Our team will review your concern within 72 hours. Keep messaging your tailor in the meantime — many issues are resolved directly.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>Reason <Text style={{ color: Colors.error }}>*</Text></Text>
              {DISPUTE_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[disputeStyles.reasonRow, reason === r && disputeStyles.reasonRowActive]}
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
                Raising a concern pauses the order. Payment remains in escrow until the concern is resolved.
              </Text>
            </View>

            <Button
              label="Submit concern"
              onPress={submit}
              loading={submitting}
              disabled={!reason || !description.trim()}
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
})

// ─── Quote Review Screen ──────────────────────────────────────────────────────

function QuoteReviewScreen({
  order, onAction, router, userId,
}: {
  order: OrderDetail
  onAction: () => void
  router: ReturnType<typeof useRouter>
  userId: string
}) {
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const { currency, rates, setCurrency } = useCurrency()
  const navigation = useNavigation()
  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(customer)/orders')
  }

  // Find the quote from stage updates or a separate quote field
  // The tailor's quote note is in the QUOTE_SENT stage update
  const quoteUpdate = order.stageUpdates.find((u) => u.stage === 'QUOTE_SENT')

  async function accept() {
    Alert.alert(
      'Accept quote',
      `Accept the quote of ${order.quotedAmount ? formatAmount(order.quotedAmount, order.quotedCurrency, currency, rates) : '—'} from ${order.tailorName}?\n\nOnce accepted, the tailor will begin production.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setAccepting(true)
            // TODO: plug real payment screen in here before Stripe goes live.
            // accept-quote transitions QUOTE_SENT → CONFIRMED via service role.
            const { error } = await supabase.functions.invoke('customer-order-action', {
              body: { orderId: order.id, action: 'accept-quote' },
            })
            setAccepting(false)
            if (error) {
              Sentry.captureException(error, { extra: { context: 'accept_quote', orderId: order.id } })
              Alert.alert('Error', 'Could not accept the quote. Please try again.')
            } else {
              onAction()
            }
          },
        },
      ]
    )
  }

  async function decline() {
    Alert.alert(
      'Decline quote',
      'Decline this quote? The order will be closed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setDeclining(true)
            const { error } = await supabase.functions.invoke('customer-order-action', {
              body: { orderId: order.id, action: 'decline-quote' },
            })
            setDeclining(false)
            if (error) {
              Alert.alert('Error', 'Could not decline the quote. Please try again.')
              return
            }
            router.replace('/(customer)/orders')
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

            {order.quotedAmount && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Amount</Text>
                <Text style={quoteAmount}>{formatAmount(order.quotedAmount, order.quotedCurrency, currency, rates)}</Text>
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

          {/* Expiry note intentionally removed — server-side expiry not yet implemented */}
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
            style={{ flex: 1 }}
          />
          <Button
            label="Accept quote"
            onPress={accept}
            loading={accepting}
            style={{ flex: 1.6 }}
          />
        </View>
        <Button
          label={`Message ${order.tailorName.split(' ')[0]}`}
          variant="ghost"
          onPress={() => router.navigate(`/(customer)/messages/${order.id}`)}
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
  statusEta: { fontSize: FontSize.sm, color: Colors.midGrey },

  // Video call card
  videoCallCard: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.needleGreen,
  },
  videoCallTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
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
  trackingLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  trackingNumber: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreen },

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

  notFound: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg },
  notFoundText: { fontSize: FontSize.lg, color: Colors.inkLight },
  backLink: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  retryBtn: { backgroundColor: Colors.needleGreen, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl },
  retryBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },

  // Pre-production waiting bar
  preProductionBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  preProductionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.warning },
  preProductionLabel: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },

  // Dispute entry
  disputeEntry: { alignItems: 'center', paddingTop: Spacing.sm },
  disputeEntryText: { fontSize: FontSize.sm, color: Colors.kanteRust, fontWeight: FontWeight.medium },

  // Quote review extras
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  escrowNote: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  escrowNoteText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  expiryNote: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' as const },
})
