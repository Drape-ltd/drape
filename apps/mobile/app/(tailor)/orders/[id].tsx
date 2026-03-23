import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Image, TextInput, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Linking,
} from 'react-native'
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { Sentry } from '@/lib/sentry'
import { stripExif } from '@/lib/stripExif'
import { Button, Input } from '@/components/ui'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/currency'
import { stageColor } from '@/lib/stageColors'

// ─── Types ────────────────────────────────────────────────────────────────────

type Measurement = {
  chest: number | null; waist: number | null; hips: number | null
  shoulderWidth: number | null; inseam: number | null; sleeveLength: number | null
  neckCircumference: number | null; height: number | null; unit: string
  fitStyle: string | null; garmentContext: string | null; bodyShape: string | string[] | null
  fitFlags: string[]; bodyNote: string | null
}

type OrderDetail = {
  id: string; reference: string; garmentType: string
  garmentDescription: string | null; stage: OrderStage
  customerId: string; customerName: string
  quotedAmount: number | null; quotedCurrency: string; quotedCompletionDate: string | null
  fabricSource: string; deliveryMethod: string; deliveryAddress: string | null
  trackingNumber: string | null; carrier: string | null
  referencePhotos: string[]; fitNote: string | null
  measurements: Measurement | null
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

function orderStatusGuidance(stage: OrderStage): string | null {
  if (stage === 'CONSULTATION') {
    return 'Use the consultation to clarify fit, fabric, and expectations before you send a quote.'
  }
  if (stage === 'QUOTE_SENT') {
    return 'Your quote is with the customer. Production starts once they accept it.'
  }
  if (stage === 'CONFIRMED') {
    return 'The customer has accepted your quote. Move this order into the first production stage when work begins.'
  }
  if (stage === 'DESIGNING') {
    return 'Design details and pattern decisions are underway. Advance when you are ready to source or cut.'
  }
  if (stage === 'SOURCING') {
    return 'Fabric and materials are being sourced for this order. Advance when you are ready to cut.'
  }
  if (stage === 'CUTTING') {
    return 'Cutting is underway. Advance when you are ready to begin sewing.'
  }
  if (stage === 'SEWING') {
    return 'Sewing is underway. Advance when you are ready for finishing.'
  }
  if (stage === 'FINISHING') {
    return 'Final touches and quality checks are underway. Mark the order ready once everything is complete.'
  }
  if (stage === 'SHIPPED') {
    return 'This order is on its way to the customer. They can confirm receipt once it arrives.'
  }
  if (stage === 'READY_FOR_COLLECTION') {
    return 'The order is ready to hand over. Confirm the customer\'s collection code when they arrive.'
  }
  if (stage === 'DELIVERED') {
    return 'Delivery is confirmed. The customer can now review the finished order and close it out in the app.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. This order will move to complete once the customer finishes the order in the app.'
  }
  if (stage === 'COMPLETE') {
    return 'This order is complete. You can still revisit the full brief, measurements, and timeline here any time.'
  }
  if (stage === 'IN_DISPUTE') {
    return 'This order is paused while the customer concern is being reviewed.'
  }
  return null
}

function quotedAmountLabel(stage: OrderStage): string {
  if (stage === 'QUOTE_SENT') return 'quoted'
  if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'awaiting finish'
  if (stage === 'COMPLETE') return 'released'
  return 'held'
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

const GARMENT_CONTEXT_LABELS: Record<string, string> = {
  MENSWEAR: 'Menswear cuts', WOMENSWEAR: 'Womenswear cuts',
  BOTH: 'Both', PREFER_NOT: 'Prefer not to say',
}
const BODY_SHAPE_LABELS: Record<string, string> = {
  RECTANGLE: 'Rectangle', BROAD_SHOULDERS: 'Broad shoulders',
  FULL_HIPS: 'Full hips', DEFINED_WAIST: 'Defined waist',
  FULL_MIDSECTION: 'Full midsection', ATHLETIC: 'Athletic / muscular',
  PREFER_NOT: 'Prefer not to say',
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TailorOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  async function openCallUrl(url: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open call', 'This consultation link is unavailable right now. Reopen the order and create a fresh consultation room if needed.')
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open call', 'Please try again in a moment. If it still fails, create a fresh consultation room from this order.')
    }
  }

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/orders')
  }

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [showStageModal, setShowStageModal] = useState(false)
  const [stageModalTarget, setStageModalTarget] = useState<OrderStage | null>(null)
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [startingCall, setStartingCall] = useState<'audio' | 'video' | null>(null)
  const [failedReferencePhotos, setFailedReferencePhotos] = useState<string[]>([])

  async function fetchOrder() {
    setLoading(true)
    setFetchError(false)
    setOrder(null)
    setFailedReferencePhotos([])
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id, reference, garment_type, garment_description, stage,
        customer_id, quoted_amount, quoted_currency, quoted_completion_date,
        fabric_source, delivery_method, delivery_address, tracking_number, carrier, reference_photos, fit_note,
        customer_measurements_snapshot, collection_code, video_call_url,
        occasion, deadline, created_at,
        customer_profiles!customer_id(display_name)
      `)
      .eq('id', id)
      .eq('tailor_id', user?.id)
      .maybeSingle()

    if (error) {
      setFetchError(true)
      setLoading(false)
      return
    }

    if (data) {
      const d = data as any
      setOrder({
        id: d.id, reference: d.reference, garmentType: d.garment_type,
        garmentDescription: d.garment_description, stage: d.stage,
        customerId: d.customer_id,
        customerName: d.customer_profiles?.display_name ?? 'Customer',
        quotedAmount: d.quoted_amount, quotedCurrency: d.quoted_currency ?? 'USD', quotedCompletionDate: d.quoted_completion_date,
        fabricSource: d.fabric_source, deliveryMethod: d.delivery_method, deliveryAddress: d.delivery_address ?? null,
        trackingNumber: d.tracking_number ?? null, carrier: d.carrier ?? null,
        referencePhotos: asStringList(d.reference_photos),
        fitNote: d.fit_note, measurements: d.customer_measurements_snapshot,
        collectionCode: d.collection_code, videoCallUrl: d.video_call_url ?? null,
        occasion: d.occasion, deadline: d.deadline, createdAt: d.created_at,
      })
    } else {
      setOrder(null)
    }
    setLoading(false)
  }

  useEffect(() => { void fetchOrder() }, [id, user?.id])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this order…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the brief, measurements, quote context, and current production state.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <Text style={styles.stateTitle}>Couldn't load this order.</Text>
            <Text style={styles.stateHint}>
              This screen should give you the full brief, fit context, and next production action. Please try again.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, open Orders first, then Clients if needed, so you can keep quoting and managing live work while the full detail catches up.
              </Text>
            </View>
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
            <Text style={styles.stateHint}>
              This order may have moved, expired, or no longer belong to the current account.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Go back to Orders first. If you opened an older route, reopen the live order from your pipeline so you land on the current working brief.
              </Text>
            </View>
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

  const nextProductionStage = PRODUCTION_NEXT[order.stage]
  const flexibleNextStages = FLEXIBLE_NEXT_STAGES[order.stage]
  const isFlexibleStage = !!flexibleNextStages
  const visibleReferencePhotos = order.referencePhotos.filter((url) => !failedReferencePhotos.includes(url))
  const statusGuidance = orderStatusGuidance(order.stage)

  function openStageModal(target: OrderStage) {
    setStageModalTarget(target)
    setShowStageModal(true)
  }

  async function startCall(callType: 'audio' | 'video') {
    if (!order) return
    if (startingCall) return
    setStartingCall(callType)
    try {
      const { data, error } = await invokeFunction('create-consultation-room', {
        body: { orderId: order.id, callType },
      })
      if (error || !data?.url) {
        Alert.alert('Error', 'Could not create call room. Please try again.')
        return
      }
      fetchOrder()
      await openCallUrl(data.url)
    } catch {
      Alert.alert('Error', 'Could not start call.')
    } finally {
      setStartingCall(null)
    }
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
            <View style={styles.stageRow}>
              <View
                style={[styles.stagePill, { backgroundColor: stageColor(order.stage).bg }]}
                testID="tailor-order-stage"
              >
                <Text style={[styles.stageText, { color: stageColor(order.stage).text }]}>
                  {STAGE_LABELS[order.stage]}
                </Text>
              </View>
              {order.quotedAmount && (
                <Text style={styles.amount}>
                  {formatAmount(
                    order.quotedAmount,
                    order.quotedCurrency as CurrencyCode,
                    order.quotedCurrency as CurrencyCode,
                    STATIC_FALLBACK_RATES
                  )} {quotedAmountLabel(order.stage)}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>Best way to use this screen</Text>
            <Text style={styles.guideText}>
              Use this as your working brief for fit context, delivery details, customer expectations, and the next production action you need to take.
            </Text>
          </View>

          {/* PENDING_QUOTE — show brief + quote/consultation CTAs */}
          {order.stage === 'PENDING_QUOTE' && (
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>New order — your quote is needed</Text>
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
                          Alert.alert('Error', 'Could not decline the order. Please try again.')
                          return
                        }
                        router.replace('/(tailor)/orders')
                      },
                    },
                  ])
                }}
              />
            </View>
          )}

          {/* CONSULTATION — tailor awaiting consultation, then sends quote */}
          {order.stage === 'CONSULTATION' && (
            <View style={[styles.alertCard, styles.consultationCard]}>
              <Text style={styles.alertTitle}>Consultation requested</Text>
              <Text style={styles.alertSub}>
                You've requested a consultation with this customer. Once done, send your quote or decline.
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={order.videoCallUrl ? 'Rejoin call' : '📹 Video call'}
                    onPress={() => startCall('video')}
                    loading={startingCall === 'video'}
                    disabled={!!startingCall}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="🎙 Audio call"
                    variant="secondary"
                    onPress={() => startCall('audio')}
                    loading={startingCall === 'audio'}
                    disabled={!!startingCall}
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
                          Alert.alert('Error', 'Could not decline the order. Please try again.')
                          return
                        }
                        router.replace('/(tailor)/orders')
                      },
                    },
                  ])
                }}
              />
            </View>
          )}

          {/* Flexible stages: CONFIRMED / DESIGNING / SOURCING — tailor picks next stage */}
          {isFlexibleStage && flexibleNextStages && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>Update production stage</Text>
              <Text style={styles.stageCardSub}>
                Currently: <Text style={{ color: Colors.needleGreen, fontWeight: FontWeight.semibold }}>{STAGE_LABELS[order.stage]}</Text>
              </Text>
              <Text style={styles.stageCardHint}>Choose which stage to move to next — tailors often run design and sourcing in parallel.</Text>
              {flexibleNextStages.map((target) => (
                <Button
                  key={target}
                  label={STAGE_LABELS[target]}
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
                Currently: <Text style={{ color: Colors.needleGreen, fontWeight: FontWeight.semibold }}>{STAGE_LABELS[order.stage]}</Text>
              </Text>
              <Button
                label={`Advance to ${nextProductionStage ? STAGE_LABELS[nextProductionStage] : '…'}`}
                onPress={() => openStageModal(nextProductionStage!)}
              />
            </View>
          )}

          {order.stage === 'FINISHING' && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>Almost done</Text>
              <Text style={styles.stageCardSub}>Mark as finished and ready for {order.deliveryMethod === 'LOCAL_COLLECTION' ? 'collection' : 'shipping'}.</Text>
              <Button
                label={order.deliveryMethod === 'LOCAL_COLLECTION' ? 'Mark ready for collection' : 'Mark as shipped'}
                onPress={() => openStageModal(order.deliveryMethod === 'LOCAL_COLLECTION' ? 'READY_FOR_COLLECTION' : 'SHIPPED')}
              />
            </View>
          )}

          {/* READY_FOR_COLLECTION — code entry */}
          {order.stage === 'READY_FOR_COLLECTION' && (
            <View style={[styles.stageCard, { borderColor: Colors.needleGreen, borderWidth: 1.5 }]}>
              <Text style={styles.stageCardTitle}>Awaiting customer collection</Text>
              <Text style={styles.stageCardSub}>
                Ask the customer to show their 4-digit code, then enter it below to confirm collection and release payment.
              </Text>
              <Button label="Enter collection code" onPress={() => setShowCodeModal(true)} />
            </View>
          )}

          {statusGuidance && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>{STAGE_LABELS[order.stage]}</Text>
              <Text style={styles.stageCardSub}>{statusGuidance}</Text>
            </View>
          )}

          {/* Body profile card — visible as soon as measurements are attached to the order */}
          {hasMeasurementContent(order.measurements) && (
            <BodyProfileCard measurements={order.measurements} />
          )}

          {/* Brief details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Brief</Text>
            {order.garmentDescription && (
              <Text style={styles.briefText}>{order.garmentDescription}</Text>
            )}
            <View style={styles.briefMeta}>
              {order.occasion && <BriefRow label="Occasion" value={order.occasion} />}
              {order.deadline && (
                <BriefRow
                  label="Deadline"
                  value={new Date(order.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                />
              )}
              <BriefRow label="Fabric" value={order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer supplies' : 'You source'} />
              <BriefRow label="Delivery" value={order.deliveryMethod === 'LOCAL_COLLECTION' ? 'Local collection' : 'Shipping'} />
              {order.deliveryMethod === 'SHIPPING' && order.deliveryAddress && (
                <BriefRow label="Ship to" value={order.deliveryAddress} />
              )}
              {order.deliveryMethod === 'SHIPPING' && order.trackingNumber && (
                <BriefRow
                  label="Tracking"
                  value={order.carrier ? `${order.trackingNumber} · ${order.carrier}` : order.trackingNumber}
                />
              )}
            </View>
            {order.fitNote && (
              <View style={styles.fitNote}>
                <Text style={styles.fitNoteLabel}>Fit note from customer</Text>
                <Text style={styles.fitNoteText}>"{order.fitNote}"</Text>
              </View>
            )}
          </View>

          {/* Reference photos */}
          {visibleReferencePhotos.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reference photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                  {visibleReferencePhotos.map((url, i) => (
                    <Image
                      key={i}
                      source={{ uri: url }}
                      style={styles.refPhoto}
                      resizeMode="cover"
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

        </View>
      </ScrollView>

      {/* Message CTA */}
      <View style={styles.messageCta}>
        <Button
          label={`Message ${order.customerName.split(' ')[0]}`}
          variant="secondary"
          onPress={() => router.navigate(`/(tailor)/messages/${order.id}`)}
        />
      </View>

      {/* Quote modal */}
      <QuoteModal
        visible={showQuoteModal}
        orderId={order.id}
        defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
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
          onUpdated={() => { setShowStageModal(false); fetchOrder() }}
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

      {/* Collection code modal */}
      <CollectionCodeModal
        visible={showCodeModal}
        orderId={order.id}
        expectedCode={order.collectionCode ?? ''}
        onClose={() => setShowCodeModal(false)}
        onConfirmed={() => { setShowCodeModal(false); fetchOrder() }}
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
              {value ? `${value} ${m.unit}` : '—'}
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

// ─── Quote Modal ──────────────────────────────────────────────────────────────

function QuoteModal({ visible, orderId, defaultCurrency, onClose, onSent }: {
  visible: boolean; orderId: string; defaultCurrency: CurrencyCode; onClose: () => void; onSent: () => void
}) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency)
  const [completionDate, setCompletionDate] = useState('')
  const [completionDateValue, setCompletionDateValue] = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!visible) return
    setAmount('')
    setCurrency(defaultCurrency)
    setCompletionDate('')
    setCompletionDateValue(null)
    setShowDatePicker(false)
    setNote('')
    setNoteError('')
    setSending(false)
  }, [visible, orderId, defaultCurrency])

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

    setSending(true)
    try {
      const amountPence = Math.round(parseFloat(amount) * 100)

      const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
        body: {
          orderId,
          action: 'send-quote',
          amount: amountPence,
          currency,
          completionDate: parsedDate.toISOString(),
          note: note.trim() || undefined,
        },
      })

      if (efError || !efData?.ok) {
        const err = new Error(efData?.error ?? efError?.message ?? 'Edge Function error')
        Sentry.captureException(err, { extra: { context: 'send_quote', orderId } })
        throw err
      }

      capture('quote_sent', { amount_pence: amountPence, has_note: !!note.trim() })
      onSent()
    } catch (e) {
      console.error('Send quote error:', e)
      Alert.alert('Error', 'Could not send quote. Please try again.')
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
            <View>
              <Text style={styles.fieldLabel}>Currency <Text style={styles.required}>*</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: Spacing.sm, paddingBottom: 2 }}>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <TouchableOpacity
                      key={c.code}
                      style={[styles.currencyChip, currency === c.code && styles.currencyChipActive]}
                      onPress={() => setCurrency(c.code)}
                    >
                      <Text style={[styles.currencyChipText, currency === c.code && styles.currencyChipTextActive]}>
                        {c.symbol} {c.code}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            <Input
              label={`Your price (${SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency})`}
              placeholder="e.g. 180"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              required
              hint="Enter total price including fabric if you're sourcing it."
              testID="quote-amount-input"
            />
            <Input
              label="Estimated completion date"
              placeholder="Select a date"
              value={completionDate}
              onPressIn={openCompletionDatePicker}
              showSoftInputOnFocus={false}
              required
              hint="The date you expect to finish. Customer has 48h to accept."
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
  visible: boolean; order: OrderDetail; targetStage: OrderStage; onClose: () => void; onUpdated: () => void; userId: string
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [carrier, setCarrier] = useState('')

  const nextStage: OrderStage = targetStage

  useEffect(() => {
    if (!visible) return
    setNote('')
    setNoteError('')
    setPhotoUri(null)
    setUpdating(false)
    setTrackingNumber('')
    setCarrier('')
  }, [visible, order.id, targetStage])

  function validateNote(t: string) {
    if (t.trim().length < 10) { setNoteError('Tell your customer what you\'re working on — at least 10 characters.'); return false }
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
      Alert.alert('Note required', 'Tell your customer what you\'re working on — at least 10 characters.')
      return
    }
    if (!validateNote(note)) return
    if (!photoUri) {
      Alert.alert('Photo required', 'A photo at this stage builds trust. Please add at least one image before updating.')
      return
    }
    if (nextStage === 'SHIPPED' && !trackingNumber.trim()) {
      Alert.alert('Tracking number required', 'Add the shipment tracking number before marking this order as shipped.')
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
          trackingNumber: nextStage === 'SHIPPED' ? trackingNumber.trim() || undefined : undefined,
          carrier: nextStage === 'SHIPPED' ? carrier.trim() || undefined : undefined,
        },
      })

      if (efError || !efData?.ok) {
        const err = new Error(efData?.error ?? efError?.message ?? 'Edge Function error')
        Sentry.captureException(err, { extra: { context: 'advance_stage', orderId: order.id, targetStage: nextStage } })
        throw err
      }

      capture('stage_advanced', {
        from_stage: order.stage,
        to_stage: nextStage,
        has_photo: !!photoUrl,
        has_note: !!note.trim(),
      })

      onUpdated()
    } catch (e) {
      console.error('Stage update error:', e)
      Alert.alert('Error', 'Could not update stage. Please try again.')
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
              <Text style={styles.nextStageValue}>{STAGE_LABELS[nextStage]}</Text>
            </View>

            <Input
              label="Note to customer"
              placeholder='e.g. "Cutting the fabric — using the navy Ankara as planned."'
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
              <Text style={styles.photoLabel}>Progress photo <Text style={{ color: Colors.error }}>*</Text></Text>
              <Text style={styles.photoHint}>A photo at this stage builds trust with your customer.</Text>
              {photoUri ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
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

            {/* Tracking number — only for SHIPPED stage */}
            {nextStage === 'SHIPPED' && (
              <View style={styles.shippingFields}>
                <Input
                  label="Tracking number"
                  placeholder="e.g. JD000095006536993823"
                  value={trackingNumber}
                  onChangeText={setTrackingNumber}
                  autoCapitalize="characters"
                  hint="Customer will see this in their order tracking."
                />
                <Input
                  label="Carrier (optional)"
                  placeholder="e.g. DHL, UPS, FedEx"
                  value={carrier}
                  onChangeText={setCarrier}
                  autoCapitalize="words"
                  hint="Adds clearer delivery context for the customer."
                />
              </View>
            )}

            <Button
              label="Confirm update"
              onPress={update}
              loading={updating}
              disabled={updating || note.trim().length < 10 || !!noteError || !photoUri || (nextStage === 'SHIPPED' && !trackingNumber.trim())}
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
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!visible) return
    setFee('')
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
        note: note.trim() || undefined,
      },
    })

    if (efError || !efData?.ok) {
      const err = new Error(efData?.error ?? efError?.message ?? 'Edge Function error')
      Sentry.captureException(err, { extra: { context: 'request_consultation', orderId } })
      Alert.alert('Error', 'Could not request consultation. Please try again.')
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
              label={`Consultation fee (${SUPPORTED_CURRENCIES.find((c) => c.code === defaultCurrency)?.symbol ?? defaultCurrency}, optional)`}
              placeholder="e.g. 20"
              value={fee}
              onChangeText={setFee}
              keyboardType="decimal-pad"
              hint={`Leave blank if you don't charge for consultations. This fee will be shown in ${defaultCurrency}.`}
            />
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
      const msg = data?.error ?? 'Could not confirm collection. Please try again.'
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

          <Text style={styles.amountNote}>Payment releases immediately on confirmation.</Text>

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
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  stagePill: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },

  alertCard: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.md, borderWidth: 1, borderColor: Colors.needleGreen + '40',
  },
  alertTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  alertSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  stageCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.md, ...Shadow.sm,
  },
  stageCardTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  stageCardSub: { fontSize: FontSize.sm, color: Colors.inkLight },
  stageCardHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: -Spacing.sm },

  consultationCard: { borderColor: Colors.kanteRust + '60', borderWidth: 1.5 },
  consultationInfo: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md, padding: Spacing.lg,
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

  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  fitStyleTag: { color: Colors.midGrey, fontWeight: FontWeight.regular },

  briefText: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  briefMeta: { gap: Spacing.sm },
  briefRow: { flexDirection: 'row', justifyContent: 'space-between' },
  briefRowLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  briefRowValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  fitNote: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.md, gap: 4, borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  fitNoteLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  fitNoteText: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic' },

  refPhoto: { width: 160, height: 160, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },

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

  // Quote modal — currency picker
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  required: { color: Colors.error },
  currencyChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  currencyChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  currencyChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  currencyChipTextActive: { color: Colors.needleGreen },
})
