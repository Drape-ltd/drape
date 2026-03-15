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
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

// ── Types ────────────────────────────────────────────────────────────────────

type Measurements = {
  chest?: number; waist?: number; hips?: number; inseam?: number
  shoulder?: number; sleeveLength?: number; neck?: number; height?: number
  unit?: 'in' | 'cm'
  fitStyle?: string
  garmentContext?: string
  bodyShape?: string
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
  stage: OrderStage
  createdAt: string
  quotedAmount: number | null
}

const STAGE_COLOR: Partial<Record<OrderStage, string>> = {
  PENDING_QUOTE: Colors.warning,
  QUOTE_SENT: Colors.warning,
  CONFIRMED: Colors.needleGreen,
  CUTTING: Colors.needleGreen,
  SEWING: Colors.needleGreen,
  FINISHING: Colors.needleGreen,
  SHIPPED: Colors.needleGreen,
  READY_FOR_COLLECTION: Colors.needleGreen,
  IN_DISPUTE: Colors.kanteRust,
  COMPLETE: Colors.midGrey,
  DELIVERED: Colors.midGrey,
  COLLECTED: Colors.midGrey,
  DECLINED: Colors.midGrey,
  CANCELLED: Colors.midGrey,
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
  const { user } = useAuth()

  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [orders, setOrders] = useState<OrderHistoryRow[]>([])
  const [notes, setNotes] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [contactWarning, setContactWarning] = useState(false)

  const notesRef = useRef<TextInput>(null)

  async function fetchData() {
    const [profileRes, ordersRes, notesRes] = await Promise.all([
      supabase
        .from('customer_profiles')
        .select('display_name, measurements')
        .eq('user_id', clientId)
        .single(),
      supabase
        .from('orders')
        .select('id, reference, garment_type, stage, created_at, quoted_amount')
        .eq('tailor_id', user?.id)
        .eq('customer_id', clientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('tailor_client_notes')
        .select('notes')
        .eq('tailor_id', user?.id)
        .eq('customer_id', clientId)
        .maybeSingle(),
    ])

    const p = profileRes.data as any
    setProfile({
      displayName: p?.display_name ?? 'Customer',
      email: '',
      measurements: p?.measurements ?? null,
    })

    setOrders(
      ((ordersRes.data ?? []) as any[]).map((o) => ({
        id: o.id,
        reference: o.reference,
        garmentType: o.garment_type,
        stage: o.stage,
        createdAt: o.created_at,
        quotedAmount: o.quoted_amount,
      }))
    )

    const savedNotes = (notesRes.data as any)?.notes ?? ''
    setNotes(savedNotes)
    setNotesInput(savedNotes)
  }

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
  }, [clientId])

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  function onNotesChange(text: string) {
    const filtered = filterContactInfo(text)
    setContactWarning(filtered !== text)
    setNotesInput(filtered)
    setNotesDirty(filtered !== notes)
  }

  async function saveNotes() {
    if (!notesDirty) return
    setSaving(true)
    const { error } = await supabase
      .from('tailor_client_notes')
      .upsert(
        {
          tailor_id: user?.id,
          customer_id: clientId,
          notes: notesInput,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tailor_id,customer_id' }
      )
    setSaving(false)
    if (error) {
      Alert.alert('Error', 'Could not save notes. Please try again.')
    } else {
      setNotes(notesInput)
      setNotesDirty(false)
    }
  }

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  const m = profile?.measurements
  const unit = m?.unit ?? 'cm'
  const hasMeasurements = MEAS_LABELS.some(({ key }) => m && (m[key] as number | undefined))

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
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
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
              <TouchableOpacity
                style={styles.messageBtn}
                onPress={() => router.push(`/(tailor)/messages/${orders[0].id}`)}
              >
                <Text style={styles.messageBtnText}>Message</Text>
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
                {(m.garmentContext || m.bodyShape) && (
                  <View style={styles.chipRow}>
                    {m.garmentContext && (
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{m.garmentContext}</Text>
                      </View>
                    )}
                    {m.bodyShape && (
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{m.bodyShape.replace(/_/g, ' ')}</Text>
                      </View>
                    )}
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
                        <Text style={styles.measValue}>{val ? `${val}${unit}` : '—'}</Text>
                        <Text style={styles.measLabel}>{label}</Text>
                      </View>
                    )
                  })}
                </View>

                {/* Fit flags */}
                {m.fitFlags && m.fitFlags.length > 0 && (
                  <View style={styles.fitFlagWrap}>
                    <Text style={styles.fitFlagsHeader}>Fit flags</Text>
                    <View style={styles.chipRow}>
                      {m.fitFlags.map((flag) => (
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
                  Contact details removed — keep notes within the platform.
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
                <Text style={styles.emptyCardText}>No orders yet.</Text>
              </View>
            ) : (
              <View style={styles.orderList}>
                {orders.map((order) => (
                  <TouchableOpacity
                    key={order.id}
                    style={styles.orderRow}
                    onPress={() => router.push(`/(tailor)/orders/${order.id}`)}
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
                          { backgroundColor: (STAGE_COLOR[order.stage] ?? Colors.midGrey) + '20' },
                        ]}
                      >
                        <Text
                          style={[styles.stageText, { color: STAGE_COLOR[order.stage] ?? Colors.midGrey }]}
                        >
                          {STAGE_LABELS[order.stage]}
                        </Text>
                      </View>
                      {order.quotedAmount ? (
                        <Text style={styles.orderAmount}>
                          £{(order.quotedAmount / 100).toFixed(0)}
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
  content: { paddingBottom: Spacing.xxxl },

  header: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  back: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },

  identityCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.xl, marginBottom: Spacing.xl,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.sm,
  },
  avatarLg: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarLgText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  clientName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  clientSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  messageBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.needleGreen,
  },
  messageBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreen },

  section: { paddingHorizontal: Spacing.xl, gap: Spacing.md, marginBottom: Spacing.xl },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20, marginTop: -Spacing.xs },

  emptyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.xl, alignItems: 'center', gap: Spacing.xs, ...Shadow.sm,
  },
  emptyCardText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptyCardHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' },

  // Measurements
  measCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.lg, ...Shadow.sm,
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
    padding: Spacing.md, gap: 4,
    borderLeftWidth: 3, borderLeftColor: Colors.kanteRust,
  },
  bodyNoteLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.kanteRust },
  bodyNoteText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },

  // Notes
  contactWarning: {
    backgroundColor: Colors.kanteRust + '15', borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.kanteRust + '40',
  },
  contactWarningText: { fontSize: FontSize.sm, color: Colors.kanteRust },
  notesCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.sm, gap: Spacing.sm,
  },
  notesInput: {
    fontSize: FontSize.sm, color: Colors.ink, lineHeight: 22,
    minHeight: 120,
  },
  notesFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notesCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },

  // Order history
  orderList: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    overflow: 'hidden', ...Shadow.sm,
  },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, gap: Spacing.md,
  },
  orderGarment: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderRef: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  stagePill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  orderAmount: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
})
