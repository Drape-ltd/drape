import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { inviteCustomerFromTailor, shareTailorProfile } from '@/lib/invite'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { stageColor } from '@/lib/stageColors'

type Availability = 'OPEN' | 'LIMITED' | 'FULLY_BOOKED'
const AVAIL_OPTIONS: { value: Availability; label: string; desc: string; color: string }[] = [
  { value: 'OPEN', label: 'Open for orders', desc: 'Customers can find and book you normally.', color: Colors.success },
  { value: 'LIMITED', label: 'Limited availability', desc: 'You appear in search but with a notice. Take on select orders only.', color: Colors.warning },
  { value: 'FULLY_BOOKED', label: 'Fully booked', desc: 'Hidden from new bookings. Existing orders are unaffected.', color: Colors.error },
]

type DashboardStats = {
  activeOrders: number
  pendingQuotes: number
  monthEarnings: number
  avgRating: number
  tier: string | null
  displayName: string
  availability: Availability
  currency: string
  isLive: boolean
  idVerificationStatus: string
  profileId: string | null
}

type ActiveOrderRow = {
  id: string
  reference: string
  garmentType: string
  stage: OrderStage
  customerName: string
  estimatedDate: string | null
  quotedAmount: number | null
}

function dashboardOrderHint(stage: OrderStage): string | null {
  switch (stage) {
    case 'PENDING_QUOTE':
      return 'Send your quote'
    case 'CONSULTATION':
      return 'Run consultation, then quote'
    case 'QUOTE_SENT':
      return 'Waiting for customer acceptance'
    case 'READY_FOR_COLLECTION':
      return 'Confirm collection code at pickup'
    case 'SHIPPED':
      return 'Waiting for delivery confirmation'
    case 'DELIVERED':
      return 'Customer needs to finish the order'
    case 'COLLECTED':
      return 'Customer needs to finish the order'
    case 'IN_DISPUTE':
      return 'Concern under review'
    default:
      return null
  }
}


export default function TailorDashboard() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [orders, setOrders] = useState<ActiveOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [availModal, setAvailModal] = useState(false)
  const [availSaving, setAvailSaving] = useState(false)

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  async function fetchDashboard() {
    setFetchError(false)
    try {
      const [profileRes, ordersRes] = await Promise.allSettled([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, tier, avg_rating, availability, currency, is_live, id_verification_status')
          .eq('user_id', user?.id)
          .maybeSingle(),
        supabase
          .from('orders')
          .select(`
            id, reference, garment_type, stage, quoted_completion_date, quoted_amount,
            customer_profiles!customer_id(display_name)
          `)
          .eq('tailor_id', user?.id)
          .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","CANCELLED","REFUNDED")')
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      const profile =
        profileRes.status === 'fulfilled' && !profileRes.value.error
          ? (profileRes.value.data as any)
          : null

      const orderList =
        ordersRes.status === 'fulfilled' && !ordersRes.value.error
          ? ((ordersRes.value.data ?? []) as any[])
          : []

      if (
        (profileRes.status === 'rejected' || (profileRes.status === 'fulfilled' && profileRes.value.error)) &&
        (ordersRes.status === 'rejected' || (ordersRes.status === 'fulfilled' && ordersRes.value.error))
      ) {
        setFetchError(true)
        setStats(null)
        setOrders([])
        return
      }

      const pendingQuotes = orderList.filter((o) => o.stage === 'PENDING_QUOTE').length
      const activeOrders = orderList.filter((o) => o.stage !== 'PENDING_QUOTE').length

      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)

      let monthEarnings = 0
      const { data: monthOrders, error: monthOrdersError } = await supabase
        .from('orders')
        .select('quoted_amount')
        .eq('tailor_id', user?.id)
        .in('stage', ['COMPLETE', 'DELIVERED', 'COLLECTED'])
        .gte('updated_at', monthStart.toISOString())

      if (!monthOrdersError) {
        monthEarnings = (monthOrders ?? []).reduce((sum: number, o: any) => sum + (o.quoted_amount ?? 0), 0)
      }

      setStats({
        activeOrders,
        pendingQuotes,
        monthEarnings,
        avgRating: profile?.avg_rating ?? 0,
        tier: profile?.tier ?? null,
        displayName: profile?.display_name ?? user?.user_metadata?.display_name ?? '',
        availability: profile?.availability ?? 'OPEN',
        currency: profile?.currency ?? 'GBP',
        isLive: profile?.is_live ?? false,
        idVerificationStatus: profile?.id_verification_status ?? 'NOT_SUBMITTED',
        profileId: profile?.id ?? null,
      })

      setOrders(
        orderList.map((o) => ({
          id: o.id,
          reference: o.reference,
          garmentType: o.garment_type,
          stage: o.stage,
          customerName: o.customer_profiles?.display_name ?? 'Customer',
          estimatedDate: o.quoted_completion_date,
          quotedAmount: o.quoted_amount,
        }))
      )
    } catch {
      setFetchError(true)
      setStats(null)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchDashboard()
  }, [user?.id]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchDashboard()
    setRefreshing(false)
  }

  async function setAvailability(value: Availability) {
    setAvailSaving(true)
    const { error } = await supabase
      .from('tailor_profiles')
      .update({ availability: value })
      .eq('user_id', user?.id)
    if (error) {
      Alert.alert('Error', 'Could not update your availability. Please try again.')
      setAvailSaving(false)
      return
    }
    setStats((prev) => prev ? { ...prev, availability: value } : prev)
    setAvailSaving(false)
    setAvailModal(false)
  }

  const availColor = {
    OPEN: Colors.success, LIMITED: Colors.warning, FULLY_BOOKED: Colors.error,
  }[stats?.availability ?? 'OPEN']

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor dashboard</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your dashboard…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together orders, reviews, and business activity so you can start from one clear control surface.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor dashboard</Text>
            <Text style={styles.stateTitle}>Couldn't load your dashboard.</Text>
            <Text style={styles.stateHint}>
              This screen should give you a calm, reliable view of your order book, availability, and next actions.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If the dashboard still does not load, open Orders first, then Profile if needed, so you can keep working while the overview catches up.
              </Text>
            </View>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchDashboard() }}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryErrorBtn} onPress={() => router.push('/(tailor)/orders')}>
              <Text style={styles.secondaryErrorBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryErrorBtn} onPress={() => router.push('/(tailor)/profile')}>
              <Text style={styles.secondaryErrorBtnText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Tailor dashboard</Text>
          </View>
          <Text style={styles.heroTitle}>Run your order book, availability, and momentum from one place.</Text>
          <Text style={styles.heroSub}>
            This dashboard is your daily control surface for quotes, production progress, customer
            trust, and the health of your tailoring business on Drape.
          </Text>
        </View>

        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>Best daily habit</Text>
          <Text style={styles.guideText}>
            Check quotes first, keep availability honest, and use this screen to spot anything that needs a faster reply or stage update.
          </Text>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.greetingName}>{stats?.displayName?.split(' ')[0] ?? '…'}</Text>
          </View>
          <View style={styles.headerRight}>
            {stats && (
              <TouchableOpacity style={styles.availPill} onPress={() => setAvailModal(true)}>
                <View style={[styles.availDot, { backgroundColor: availColor }]} />
                <Text style={styles.availLabel}>
                  {stats.availability === 'OPEN' ? 'Open' : stats.availability === 'LIMITED' ? 'Limited' : 'Fully booked'}
                </Text>
              </TouchableOpacity>
            )}
            {stats && <LiveStatusBadge isLive={stats.isLive} idStatus={stats.idVerificationStatus} />}
          </View>
        </View>

        {/* Availability modal */}
        <Modal visible={availModal} transparent animationType="slide">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAvailModal(false)}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Your availability</Text>
              <Text style={styles.modalSub}>This controls whether customers can book new orders with you.</Text>
              {AVAIL_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.availOption,
                    stats?.availability === opt.value && styles.availOptionActive,
                  ]}
                  onPress={() => !availSaving && setAvailability(opt.value)}
                  disabled={availSaving}
                >
                  <View style={[styles.availOptionDot, { backgroundColor: opt.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.availOptionLabel}>{opt.label}</Text>
                    <Text style={styles.availOptionDesc}>{opt.desc}</Text>
                  </View>
                  {stats?.availability === opt.value && (
                    <Text style={styles.availCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Pending quote alert */}
        {(stats?.pendingQuotes ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.navigate('/(tailor)/orders')}
          >
            <View style={styles.alertDot} />
            <Text style={styles.alertText}>
              {stats!.pendingQuotes} order{stats!.pendingQuotes > 1 ? 's' : ''} waiting for your quote
            </Text>
            <Text style={styles.alertCta}>Review →</Text>
          </TouchableOpacity>
        )}

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard label="Active orders" value={String(stats?.activeOrders ?? '—')} />
            <StatCard label="Awaiting quote" value={String(stats?.pendingQuotes ?? '—')} accent={!!stats?.pendingQuotes} />
          </View>
          <View style={styles.statsRow}>
            <TouchableOpacity onPress={() => router.navigate('/(tailor)/earnings')} style={{ flex: 1 }}>
              <StatCard
                label="This month"
                value={formatAmount(
                  stats?.monthEarnings ?? 0,
                  (stats?.currency ?? 'GBP') as CurrencyCode,
                  (stats?.currency ?? 'GBP') as CurrencyCode,
                  STATIC_FALLBACK_RATES
                )}
              />
            </TouchableOpacity>
            <StatCard
              label="Rating"
              value={stats?.avgRating ? `${stats.avgRating.toFixed(1)} ★` : '—'}
            />
          </View>
        </View>

        {/* Active orders list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active orders</Text>
            <TouchableOpacity onPress={() => router.navigate('/(tailor)/orders')}>
              <Text style={styles.sectionLink}>See all →</Text>
            </TouchableOpacity>
          </View>

          {orders.length === 0 ? (
            <View style={styles.emptyOrders}>
              <View style={styles.emptyOrdersBadge}>
                <Text style={styles.emptyOrdersBadgeText}>Order book</Text>
              </View>
              <Text style={styles.emptyText}>No active orders yet</Text>
              {stats?.isLive ? (
                <>
                  <Text style={styles.emptyHint}>Share your profile to attract your first clients.</Text>
                  {stats.profileId && (
                    <View style={styles.emptyActions}>
                      <TouchableOpacity style={styles.shareBtn} onPress={() => shareTailorProfile(stats.profileId!, stats.displayName)}>
                        <Text style={styles.shareBtnText}>Share my profile</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.shareBtn, styles.shareBtnSecondary]}
                        onPress={() => inviteCustomerFromTailor(stats.profileId!, stats.displayName)}
                      >
                        <Text style={[styles.shareBtnText, styles.shareBtnTextSecondary]}>Invite a customer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              ) : stats?.idVerificationStatus === 'PENDING' ? (
                <Text style={styles.emptyHint}>Your profile is under review. You'll start receiving orders once verified.</Text>
              ) : stats?.idVerificationStatus === 'REJECTED' ? (
                <>
                  <Text style={styles.emptyHint}>Your verification was declined. Update your ID to go live.</Text>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => router.navigate('/(tailor)/profile/setup')}>
                    <Text style={styles.shareBtnText}>Resubmit verification</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyHint}>Complete your profile and go live to start receiving orders.</Text>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => router.navigate('/(tailor)/profile/setup')}>
                    <Text style={styles.shareBtnText}>Complete profile</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            orders.slice(0, 5).map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderRow}
                onPress={() => router.navigate(`/(tailor)/orders/${order.id}`)}
              >
                <View style={styles.orderRowLeft}>
                  <Text style={styles.orderGarment}>{order.garmentType}</Text>
                  <Text style={styles.orderCustomer}>{order.customerName}</Text>
                  {dashboardOrderHint(order.stage) && (
                    <Text style={styles.orderHint}>{dashboardOrderHint(order.stage)}</Text>
                  )}
                </View>
                <View style={styles.orderRowRight}>
                  <View style={[styles.stagePill, { backgroundColor: stageColor(order.stage).bg }]}>
                    <Text style={[styles.stageText, { color: stageColor(order.stage).text }]}>
                      {STAGE_LABELS[order.stage]}
                    </Text>
                  </View>
                  {order.estimatedDate && (
                    <Text style={styles.orderDue}>
                      Due {new Date(order.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; dot: boolean }> = {
  LIVE:          { label: 'Live',          color: Colors.success,    bg: Colors.success + '25',  dot: true },
  PENDING:       { label: 'In review',     color: Colors.warning,    bg: Colors.warning + '22',  dot: false },
  REJECTED:      { label: 'Action needed', color: Colors.error,      bg: Colors.error + '18',    dot: false },
  NOT_SUBMITTED: { label: 'Setup needed',  color: Colors.midGrey,    bg: Colors.lightGrey,       dot: false },
}

function LiveStatusBadge({ isLive, idStatus }: { isLive: boolean; idStatus: string }) {
  const key = isLive ? 'LIVE' : (idStatus in STATUS_BADGE ? idStatus : 'NOT_SUBMITTED')
  const cfg = STATUS_BADGE[key]
  return (
    <View style={[styles.availPill, { backgroundColor: cfg.bg }]}>
      {cfg.dot && <View style={[styles.availDot, { backgroundColor: cfg.color }]} />}
      <Text style={[styles.availLabel, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.statCard, accent && styles.statCardAccent]}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

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
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
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
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
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
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
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
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 38,
  },
  heroSub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
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

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end', gap: Spacing.sm },
  greeting: { fontSize: FontSize.sm, color: Colors.inkLight },
  greetingName: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink, letterSpacing: -0.5 },

  availPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.white, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 5, ...Shadow.sm,
  },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.inkLight },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.lightGrey,
    alignSelf: 'center', marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  modalSub: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: -Spacing.sm },
  availOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.lightGrey,
  },
  availOptionActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  availOptionDot: { width: 10, height: 10, borderRadius: 5 },
  availOptionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  availOptionDesc: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 16 },
  availCheck: { fontSize: FontSize.lg, color: Colors.needleGreen, fontWeight: FontWeight.bold },

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.warning + '15',
    borderRadius: Radius.md, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning },
  alertText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
  alertCta: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.warning },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  retryBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  secondaryErrorBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  secondaryErrorBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  statsGrid: { gap: Spacing.sm },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: {
    flex: 1, backgroundColor: Colors.white,
    borderRadius: Radius.lg, padding: Spacing.lg, gap: 4, ...Shadow.sm,
  },
  statCardAccent: { backgroundColor: Colors.warning + '15', borderWidth: 1, borderColor: Colors.warning + '40' },
  statValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  statValueAccent: { color: Colors.warning },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  emptyOrders: { gap: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.xl },
  emptyOrdersBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyOrdersBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' },
  emptyActions: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  shareBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  shareBtnSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.needleGreen,
  },
  shareBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  shareBtnTextSecondary: { color: Colors.needleGreen },

  orderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, ...Shadow.sm,
  },
  orderRowLeft: { gap: 2 },
  orderGarment: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderCustomer: { fontSize: FontSize.sm, color: Colors.inkLight },
  orderHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium, marginTop: 4 },
  orderRowRight: { alignItems: 'flex-end', gap: 4 },
  stagePill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  orderDue: { fontSize: FontSize.xs, color: Colors.midGrey },
})
