import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { TierBadgeChip } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

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
  tier: string
  displayName: string
  availability: Availability
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
}

export default function TailorDashboard() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [orders, setOrders] = useState<ActiveOrderRow[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [availModal, setAvailModal] = useState(false)
  const [availSaving, setAvailSaving] = useState(false)

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  async function fetchDashboard() {
    const [profileRes, ordersRes] = await Promise.all([
      supabase
        .from('tailor_profiles')
        .select('display_name, tier, avg_rating, availability')
        .eq('user_id', user?.id)
        .single(),
      supabase
        .from('orders')
        .select(`
          id, reference, garment_type, stage, quoted_completion_date, quoted_amount,
          customer_profiles!customer_id(display_name)
        `)
        .eq('tailor_id', user?.id)
        .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","CANCELLED","REFUNDED","DELIVERED","COLLECTED")')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const profile = profileRes.data as any

    const orderList = (ordersRes.data ?? []) as any[]

    const pendingQuotes = orderList.filter((o) => o.stage === 'PENDING_QUOTE').length
    const activeOrders = orderList.filter((o) => o.stage !== 'PENDING_QUOTE').length

    // Month earnings: sum completed orders this calendar month
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const { data: monthOrders } = await supabase
      .from('orders')
      .select('quoted_amount')
      .eq('tailor_id', user?.id)
      .in('stage', ['COMPLETE', 'DELIVERED', 'COLLECTED'])
      .gte('updated_at', monthStart.toISOString())

    const monthEarnings = (monthOrders ?? []).reduce((sum: number, o: any) => sum + (o.quoted_amount ?? 0), 0)

    setStats({
      activeOrders,
      pendingQuotes,
      monthEarnings,
      avgRating: profile?.avg_rating ?? 0,
      tier: profile?.tier ?? 'VERIFIED',
      displayName: profile?.display_name ?? user?.user_metadata?.display_name ?? '',
      availability: profile?.availability ?? 'OPEN',
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
  }

  useFocusEffect(useCallback(() => { fetchDashboard() }, [user?.id]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchDashboard()
    setRefreshing(false)
  }

  async function setAvailability(value: Availability) {
    setAvailSaving(true)
    await supabase
      .from('tailor_profiles')
      .update({ availability: value })
      .eq('user_id', user?.id)
    setStats((prev) => prev ? { ...prev, availability: value } : prev)
    setAvailSaving(false)
    setAvailModal(false)
  }

  const availColor = {
    OPEN: Colors.success, LIMITED: Colors.warning, FULLY_BOOKED: Colors.error,
  }[stats?.availability ?? 'OPEN']

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting}, {stats?.displayName?.split(' ')[0] ?? '…'}</Text>
            <Text style={styles.wordmark}>drape</Text>
          </View>
          <View style={styles.headerRight}>
            {stats && (
              <TouchableOpacity style={styles.availPill} onPress={() => setAvailModal(true)}>
                <View style={[styles.availDot, { backgroundColor: availColor }]} />
                <Text style={styles.availLabel}>
                  {stats.availability === 'OPEN' ? 'Open' : stats.availability === 'LIMITED' ? 'Limited' : 'Booked'}
                </Text>
              </TouchableOpacity>
            )}
            {stats && <TierBadgeChip tier={stats.tier as any} size="lg" />}
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
            onPress={() => router.push('/(tailor)/orders')}
          >
            <View style={styles.alertDot} />
            <Text style={styles.alertText}>
              {stats!.pendingQuotes} brief{stats!.pendingQuotes > 1 ? 's' : ''} waiting for your quote
            </Text>
            <Text style={styles.alertCta}>Review →</Text>
          </TouchableOpacity>
        )}

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <StatCard label="Active orders" value={String(stats?.activeOrders ?? '—')} />
          <StatCard label="Awaiting quote" value={String(stats?.pendingQuotes ?? '—')} accent={!!stats?.pendingQuotes} />
          <TouchableOpacity onPress={() => router.push('/(tailor)/earnings')} style={{ flex: 1 }}>
            <StatCard
              label="This month ↗"
              value={stats?.monthEarnings ? `£${(stats.monthEarnings / 100).toFixed(0)}` : '£0'}
            />
          </TouchableOpacity>
          <StatCard
            label="Rating"
            value={stats?.avgRating ? `${stats.avgRating.toFixed(1)} ★` : '—'}
          />
        </View>

        {/* Active orders list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active orders</Text>
            <TouchableOpacity onPress={() => router.push('/(tailor)/orders')}>
              <Text style={styles.sectionLink}>See all →</Text>
            </TouchableOpacity>
          </View>

          {orders.length === 0 ? (
            <View style={styles.emptyOrders}>
              <Text style={styles.emptyText}>No active orders yet.</Text>
              <Text style={styles.emptyHint}>Your order queue will appear here once customers book you.</Text>
            </View>
          ) : (
            orders.slice(0, 5).map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderRow}
                onPress={() => router.push(`/(tailor)/orders/${order.id}`)}
              >
                <View style={styles.orderRowLeft}>
                  <Text style={styles.orderGarment}>{order.garmentType}</Text>
                  <Text style={styles.orderCustomer}>{order.customerName}</Text>
                </View>
                <View style={styles.orderRowRight}>
                  <View style={[styles.stagePill, { backgroundColor: (STAGE_COLOR[order.stage] ?? Colors.midGrey) + '20' }]}>
                    <Text style={[styles.stageText, { color: STAGE_COLOR[order.stage] ?? Colors.midGrey }]}>
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
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end', gap: Spacing.sm },
  greeting: { fontSize: FontSize.sm, color: Colors.inkLight },
  wordmark: { fontSize: 32, fontWeight: FontWeight.bold, color: Colors.needleGreen, letterSpacing: -1 },

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

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: Colors.white,
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
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' },

  orderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, ...Shadow.sm,
  },
  orderRowLeft: { gap: 2 },
  orderGarment: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderCustomer: { fontSize: FontSize.sm, color: Colors.inkLight },
  orderRowRight: { alignItems: 'flex-end', gap: 4 },
  stagePill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  orderDue: { fontSize: FontSize.xs, color: Colors.midGrey },
})
