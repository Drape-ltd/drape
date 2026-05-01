/**
 * Tailor CRM — client detail
 * Full measurements view, order history, and private fit notes.
 * Design doc §9.6
 */
import { useEffect, useState, useRef } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { goBackOrFallback } from '@/lib/navigation'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { stageColor } from '@/lib/stageColors'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

// ── Types ────────────────────────────────────────────────────────────────────

type Measurements = {
  chest?: number; waist?: number; hips?: number; inseam?: number
  shoulder?: number; sleeveLength?: number; neck?: number; height?: number
  unit?: 'in' | 'cm'
  fitStyle?: string
  garmentContext?: string
  bodyShape?: string | string[]
  fitFlags?: string[]
  bodyNote?: string
}

type ClientProfile = {
  displayName: string
  email: string
  measurements: Measurements | null
}

type OrderHistoryRow = {
  id: string
  reference: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  sellerItemId: string | null
  stage: OrderStage
  createdAt: string
  quotedAmount: number | null
  quotedCurrency: CurrencyCode
}

type CustomerReviewRow = {
  id: string
  rating: number
  tags: string[]
  body: string | null
  reviewerName: string
  createdAt: string
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function generateUuid() {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function normalizeReadyMadeGarmentType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function clientStageLabel(order: Pick<OrderHistoryRow, 'orderKind' | 'stage'>) {
  if (order.orderKind === 'READY_MADE' && order.stage === 'PENDING_QUOTE') {
    return 'Inquiry open'
  }
  return STAGE_LABELS[order.stage]
}


const MEAS_LABELS: Array<{ key: keyof Measurements; label: string }> = [
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'inseam', label: 'Inseam' },
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'sleeveLength', label: 'Sleeve' },
  { key: 'neck', label: 'Neck' },
  { key: 'height', label: 'Height' },
]

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ClientDetailScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [orders, setOrders] = useState<OrderHistoryRow[]>([])
  const [notesRowId, setNotesRowId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [reviews, setReviews] = useState<CustomerReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [contactWarning, setContactWarning] = useState(false)

  const notesRef = useRef<TextInput>(null)

  async function fetchData() {
    if (!user?.id) {
      setFetchError(false)
      setProfile(null)
      setOrders([])
      setNotesRowId(null)
      setNotes('')
      setNotesInput('')
      setNotesDirty(false)
      setContactWarning(false)
      setReviews([])
      setLoading(false)
      return
    }
    setFetchError(false)
    setProfile(null)
    setOrders([])
    setNotesRowId(null)
    setNotes('')
    setNotesInput('')
    setNotesDirty(false)
    setContactWarning(false)
    setReviews([])
    try {
      const [profileRes, ordersRes, notesRes, reviewsRes] = await Promise.allSettled([
        supabase
          .from('customer_profiles')
          .select('display_name, measurements')
          .eq('user_id', clientId)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('id, reference, garment_type, order_kind, seller_item_id, stage, created_at, quoted_amount, currency, quoted_currency')
          .eq('tailor_id', user.id)
          .eq('customer_id', clientId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tailor_client_notes')
          .select('id, notes')
          .eq('tailor_id', user.id)
          .eq('customer_id', clientId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('customer_reviews')
          .select('id, rating, tags, body, reviewer_name, created_at, orders!order_id(customer_profiles!customer_id(display_name))')
          .eq('customer_id', clientId)
          .order('created_at', { ascending: false }),
      ])

      const profileData =
        profileRes.status === 'fulfilled' && !profileRes.value.error
          ? (profileRes.value.data as any)
          : null
      const orderRows =
        ordersRes.status === 'fulfilled' && !ordersRes.value.error
          ? ((ordersRes.value.data ?? []) as any[])
          : []
      const notesData =
        notesRes.status === 'fulfilled' && !notesRes.value.error
          ? (notesRes.value.data as any)
          : null
      const customerReviews =
        reviewsRes.status === 'fulfilled' && !reviewsRes.value.error
          ? ((reviewsRes.value.data ?? []) as any[])
          : []

      if (
        (profileRes.status === 'rejected' || (profileRes.status === 'fulfilled' && profileRes.value.error)) &&
        (ordersRes.status === 'rejected' || (ordersRes.status === 'fulfilled' && ordersRes.value.error)) &&
        (notesRes.status === 'rejected' || (notesRes.status === 'fulfilled' && notesRes.value.error))
      ) {
        throw new Error('Failed to load client detail')
      }

      setProfile({
        displayName: profileData?.display_name ?? 'Customer',
        email: '',
        measurements: profileData?.measurements ?? null,
      })

      const purchasedReadyMadeItemIds = new Set(
        orderRows
          .filter((row) => row.order_kind === 'READY_MADE' && row.stage !== 'PENDING_QUOTE' && typeof row.seller_item_id === 'string')
          .map((row) => row.seller_item_id as string),
      )
      const purchasedReadyMadeGarmentTypes = new Set(
        orderRows
          .filter((row) => row.order_kind === 'READY_MADE' && row.stage !== 'PENDING_QUOTE')
          .map((row) => normalizeReadyMadeGarmentType(row.garment_type))
          .filter((value) => value.length > 0),
      )

      setOrders(
        orderRows
          .filter((row) => {
            if (row.stage !== 'PENDING_QUOTE') return true
            const sellerItemMatch =
              typeof row.seller_item_id === 'string' && purchasedReadyMadeItemIds.has(row.seller_item_id)
            const garmentTypeKey = normalizeReadyMadeGarmentType(row.garment_type)
            const garmentTypeMatch = garmentTypeKey.length > 0 && purchasedReadyMadeGarmentTypes.has(garmentTypeKey)
            const looksLikeReadyMadeInquiry =
              row.order_kind === 'READY_MADE' ||
              typeof row.seller_item_id === 'string' ||
              garmentTypeMatch
            if (!looksLikeReadyMadeInquiry) return true
            if (sellerItemMatch || garmentTypeMatch) return false
            return true
          })
          .map((o) => ({
            id: o.id,
            reference: o.reference,
            garmentType: o.garment_type,
            orderKind: o.order_kind ?? 'CUSTOM',
            sellerItemId: o.seller_item_id ?? null,
            stage: o.stage,
            createdAt: o.created_at,
            quotedAmount: o.quoted_amount,
            quotedCurrency: (o.currency ?? o.quoted_currency ?? 'USD') as CurrencyCode,
          })),
      )

      const savedNotes = notesData?.notes ?? ''
      setNotesRowId(notesData?.id ?? null)
      setNotes(savedNotes)
      setNotesInput(savedNotes)
      const clientDisplayName = profileData?.display_name ?? 'Customer'
      setReviews(
        customerReviews.map((review) => ({
          id: review.id,
          rating: review.rating,
          tags: asStringList(review.tags),
          body: review.body ?? null,
          reviewerName: clientDisplayName,
          createdAt: review.created_at,
        }))
      )
    } catch {
      setFetchError(true)
      setProfile(null)
      setOrders([])
      setNotesRowId(null)
      setNotes('')
      setNotesInput('')
    }
  }

  useEffect(() => {
    setLoading(true)
    void fetchData().finally(() => setLoading(false))
  }, [clientId, user?.id])

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  function onNotesChange(text: string) {
    const result = filterContactInfo(text)
    setContactWarning(result.blocked)
    setNotesInput(text)
    setNotesDirty(text !== notes)
  }

  async function saveNotes() {
    if (!notesDirty) return
    if (!user?.id || !clientId) {
      Alert.alert('Error', 'We could not identify this client note right now. Please try again.')
      return
    }
    setSaving(true)
    const normalizedNotes = notesInput.trim()
    let nextRowId = notesRowId
    let error: { message?: string } | null = null
    const now = new Date().toISOString()

    if (notesRowId) {
      const updateResult = await supabase
        .from('tailor_client_notes')
        .update({
          notes: normalizedNotes,
          updated_at: now,
        })
        .eq('id', notesRowId)
        .select('id')
        .single()

      error = updateResult.error
      nextRowId = updateResult.data?.id ?? notesRowId
    } else {
      const insertResult = await supabase
        .from('tailor_client_notes')
        .insert({
          id: generateUuid(),
          tailor_id: user.id,
          customer_id: clientId,
          notes: normalizedNotes,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single()

      error = insertResult.error
      nextRowId = insertResult.data?.id ?? null

      if (error) {
        const existingResult = await supabase
          .from('tailor_client_notes')
          .select('id')
          .eq('tailor_id', user.id)
          .eq('customer_id', clientId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!existingResult.error && existingResult.data?.id) {
          const updateResult = await supabase
            .from('tailor_client_notes')
            .update({
              notes: normalizedNotes,
              updated_at: now,
            })
            .eq('id', existingResult.data.id)
            .select('id')
            .single()

          error = updateResult.error
          nextRowId = updateResult.data?.id ?? existingResult.data.id
        }
      }
    }

    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message ? `Could not save notes. ${error.message}` : 'Could not save notes. Please try again.')
    } else {
      setNotesRowId(nextRowId)
      setNotes(normalizedNotes)
      setNotesInput(normalizedNotes)
      setNotesDirty(false)
    }
  }

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Client detail</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this client…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together their measurements, notes, and order history so you can pick up the relationship cleanly.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Client detail</Text>
            <Text style={styles.stateTitle}>Couldn't load this client.</Text>
            <Text style={styles.stateHint}>
              This page should help you remember fit details, private notes, and order history without losing context.
            </Text>
            <TouchableOpacity
              style={styles.errorRetry}
              onPress={() => {
                setLoading(true)
                fetchData().finally(() => setLoading(false))
              }}
            >
              <Text style={styles.errorRetryText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.errorSecondary}
              onPress={() => router.replace('/(tailor)/clients')}
            >
              <Text style={styles.errorSecondaryText}>Open clients</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.errorLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const m = profile?.measurements
  const unit = m?.unit ?? 'cm'
  const hasMeasurements = MEAS_LABELS.some(({ key }) => m && (m[key] as number | undefined))
  const bodyShapeLabels = asStringList(m?.bodyShape)
  const fitFlags = asStringList(m?.fitFlags)
  const latestReviewableOrder = orders.find((row) => ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(row.stage))

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/clients')
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
          }
        >
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Client relationship</Text>
            </View>
            <Text style={styles.heroTitle}>Keep fit memory, order history, and notes in one dependable place.</Text>
            <Text style={styles.heroSub}>
              This client view is where repeat business becomes easier, because measurements,
              preferences, and past work stay connected.
            </Text>
          </View>

          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>Best CRM habit</Text>
            <Text style={styles.guideText}>
              Use this page to capture the fit details and reminders you will want before the next order, not just what matters today.
            </Text>
          </View>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.back}>← Clients</Text>
            </TouchableOpacity>
          </View>

          {/* Identity card */}
          <View style={styles.identityCard}>
            <View style={styles.avatarLg}>
              <Text style={styles.avatarLgText}>{initials(profile?.displayName ?? '')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clientName}>{profile?.displayName}</Text>
              <Text style={styles.clientSub}>
                {orders.length} order{orders.length !== 1 ? 's' : ''} with you
              </Text>
            </View>
            {orders.length > 0 && (
              <View style={styles.identityActions}>
                <TouchableOpacity
                  style={styles.messageBtn}
                  onPress={() => router.navigate(`/(tailor)/messages/${orders[0].id}`)}
                >
                  <Text style={styles.messageBtnText}>Message</Text>
                </TouchableOpacity>
                {latestReviewableOrder ? (
                  <TouchableOpacity
                    style={styles.secondaryActionBtn}
                    onPress={() => router.push({
                      pathname: '/(tailor)/clients/review/[orderId]',
                      params: { orderId: latestReviewableOrder.id, returnTo: `/(tailor)/clients/${clientId}` },
                    })}
                  >
                    <Text style={styles.secondaryActionText}>Review</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Customer reviews</Text>
            {reviews.length > 0 ? (
              <View style={styles.reviewList}>
                {reviews.map((review) => (
                  <View key={review.id} style={styles.reviewCard}>
                    <View style={styles.reviewHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewName}>{review.reviewerName}</Text>
                        <Text style={styles.reviewDate}>
                          {new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <Text style={styles.reviewStars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>
                    </View>
                    {review.tags.length > 0 ? (
                      <View style={styles.reviewTags}>
                        {review.tags.map((tag) => (
                          <View key={tag} style={styles.reviewTag}>
                            <Text style={styles.reviewTagText}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.emptyInfoCard}
                onPress={() => latestReviewableOrder ? router.push({
                  pathname: '/(tailor)/clients/review/[orderId]',
                  params: { orderId: latestReviewableOrder.id, returnTo: `/(tailor)/clients/${clientId}` },
                }) : undefined}
                disabled={!latestReviewableOrder}
                activeOpacity={0.75}
              >
                <Text style={styles.emptyInfoTitle}>No customer reviews yet.</Text>
                <Text style={styles.emptyInfoHint}>
                  {latestReviewableOrder
                    ? 'Leave a review after a finished order so future work has better context.'
                    : 'Reviews appear here after a finished order.'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Measurements */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Measurements</Text>
            {!m || !hasMeasurements ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>No measurements on file.</Text>
                <Text style={styles.emptyCardHint}>The customer hasn't added measurements yet.</Text>
              </View>
            ) : (
              <View style={styles.measCard}>
                {/* Context chips */}
                {(m.garmentContext || bodyShapeLabels.length > 0) && (
                  <View style={styles.chipRow}>
                    {m.garmentContext && (
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{m.garmentContext}</Text>
                      </View>
                    )}
                    {bodyShapeLabels.map((shape) => (
                      <View key={shape} style={styles.chip}>
                        <Text style={styles.chipText}>{shape.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                    {m.fitStyle && (
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{m.fitStyle} fit</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Grid of body measurements */}
                <View style={styles.measGrid}>
                  {MEAS_LABELS.map(({ key, label }) => {
                    const val = m[key] as number | undefined
                    return (
                      <View key={key} style={styles.measItem}>
                        <Text style={styles.measValue}>{val ? `${val}${unit}` : 'Not added'}</Text>
                        <Text style={styles.measLabel}>{label}</Text>
                      </View>
                    )
                  })}
                </View>

                {/* Fit flags */}
                {fitFlags.length > 0 && (
                  <View style={styles.fitFlagWrap}>
                    <Text style={styles.fitFlagsHeader}>Fit flags</Text>
                    <View style={styles.chipRow}>
                      {fitFlags.map((flag) => (
                        <View key={flag} style={styles.fitFlagChip}>
                          <Text style={styles.fitFlagText}>{flag.replace(/_/g, ' ')}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Body note */}
                {m.bodyNote ? (
                  <View style={styles.bodyNoteWrap}>
                    <Text style={styles.bodyNoteLabel}>Body note</Text>
                    <Text style={styles.bodyNoteText}>{m.bodyNote}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {/* Private fit notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Private fit notes</Text>
            <Text style={styles.sectionHint}>
              Only you can see these. Use them to track fitting preferences, alterations, or anything you want to remember for this client's next order.
            </Text>

            {contactWarning && (
              <View style={styles.contactWarning}>
                <Text style={styles.contactWarningText}>
                  Contact details removed. Keep notes within the platform.
                </Text>
              </View>
            )}

            <View style={styles.notesCard}>
              <TextInput
                ref={notesRef}
                style={styles.notesInput}
                value={notesInput}
                onChangeText={onNotesChange}
                placeholder="e.g. Prefers extra room at the shoulders. Right arm slightly longer than left…"
                placeholderTextColor={Colors.midGrey}
                multiline
                maxLength={1000}
                textAlignVertical="top"
              />
              <View style={styles.notesFooter}>
                <Text style={styles.notesCount}>{notesInput.length}/1000</Text>
                {notesDirty && (
                  <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                    onPress={saveNotes}
                    disabled={saving}
                  >
                    <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save notes'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {/* Order history */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Order history</Text>
            {orders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardEyebrow}>Order history</Text>
                <Text style={styles.emptyCardText}>No orders yet.</Text>
                <Text style={styles.emptyCardHint}>
                  Orders with this client will appear here once they book through Drape.
                </Text>
                <Text style={styles.emptyCardHint}>
                  Until then, private notes and diary entries help you keep the relationship warm without losing fit context.
                </Text>
              </View>
            ) : (
              <View style={styles.orderList}>
                {orders.map((order) => (
                  <TouchableOpacity
                    key={order.id}
                    style={styles.orderRow}
                    onPress={() => router.push({
                      pathname: '/(tailor)/orders/[id]',
                      params: { id: order.id, returnTo: `/(tailor)/clients/${clientId}` },
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderGarment}>{order.garmentType}</Text>
                      <Text style={styles.orderRef}>
                        #{order.reference}{'  ·  '}
                        {new Date(order.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View style={styles.orderRight}>
                      <View
                        style={[
                          styles.stagePill,
                          { backgroundColor: stageColor(order.stage).bg },
                        ]}
                      >
                        <Text
                          style={[styles.stageText, { color: stageColor(order.stage).text }]}
                        >
                          {clientStageLabel(order)}
                        </Text>
                      </View>
                      {order.quotedAmount ? (
                        <Text style={styles.orderAmount}>
                          {formatAmount(order.quotedAmount, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.xxl },
  heroCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 30,
  },
  heroSub: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 19,
  },
  guideCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  guideText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  header: { paddingHorizontal: Spacing.lg, paddingVertical: 8 },
  back: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
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
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },

  identityCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.lg,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 14, ...Shadow.sm,
  },
  avatarLg: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarLgText: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  clientName: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  clientSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  identityActions: { gap: 8 },
  messageBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.needleGreen, minHeight: 44, justifyContent: 'center',
  },
  messageBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  secondaryActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreen,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryActionText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },

  section: { paddingHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: -2 },
  reviewList: { gap: Spacing.sm },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 8,
    ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reviewName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.sm, color: Colors.warning },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  reviewTag: {
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  reviewTagText: { fontSize: FontSize.xs, color: Colors.inkLight },
  reviewBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  emptyInfoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
    ...Shadow.sm,
  },
  emptyInfoTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyInfoHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  emptyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 16, alignItems: 'center', gap: Spacing.xs, ...Shadow.sm,
  },
  emptyCardEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyCardText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptyCardHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },

  // Measurements
  measCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 14, gap: 14, ...Shadow.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    backgroundColor: Colors.bone, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 5,
  },
  chipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.inkLight },
  measGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.md, gap: 0,
  },
  measItem: {
    width: '25%', alignItems: 'center', paddingVertical: Spacing.sm,
    borderRightWidth: 1, borderRightColor: Colors.lightGrey,
  },
  measValue: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  measLabel: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  fitFlagWrap: { gap: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.lightGrey, paddingTop: Spacing.md },
  fitFlagsHeader: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.5 },
  fitFlagChip: {
    backgroundColor: Colors.kanteRust + '15', borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.kanteRust + '30',
  },
  fitFlagText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.kanteRust },
  bodyNoteWrap: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: 12, gap: 4,
    borderLeftWidth: 3, borderLeftColor: Colors.kanteRust,
  },
  bodyNoteLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.kanteRust },
  bodyNoteText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },

  // Notes
  contactWarning: {
    backgroundColor: Colors.kanteRust + '15', borderRadius: Radius.md,
    padding: 12, borderWidth: 1, borderColor: Colors.kanteRust + '40',
  },
  contactWarningText: { fontSize: FontSize.sm, color: Colors.kanteRust },
  notesCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 14, ...Shadow.sm, gap: 8,
  },
  notesInput: {
    fontSize: FontSize.sm, color: Colors.ink, lineHeight: 22,
    minHeight: 96,
  },
  notesFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notesCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10, minHeight: 44, justifyContent: 'center',
  },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },

  // Order history
  orderList: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    overflow: 'hidden', ...Shadow.sm,
  },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, gap: Spacing.md,
  },
  orderGarment: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderRef: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  stagePill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  orderAmount: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  errorRetry: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  errorRetryText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorSecondary: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  errorSecondaryText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorLink: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
})
