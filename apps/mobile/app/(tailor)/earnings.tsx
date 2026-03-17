/**
 * Tailor payout dashboard + basic analytics
 * Design doc §9.5 + §9.7
 * - Total earnings this month / week / all time
 * - Pending (in escrow) + available
 * - Payout history
 * - 6-month earnings bar chart
 * - 3 headline analytics numbers
 */
import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Dimensions, TouchableOpacity, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatAmount, fetchRates } from '@/lib/currency'
import type { CurrencyCode, Rates } from '@/lib/currency'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const CHART_WIDTH = SCREEN_WIDTH - Spacing.xl * 2
const CHART_HEIGHT = 140

type MonthBucket = { label: string; amount: number }
type PayoutRow = { id: string; reference: string; amount: number; garmentType: string; completedAt: string }

type EarningsData = {
  allTime: number
  thisMonth: number
  thisWeek: number
  pendingEscrow: number
  ordersThisMonth: number
  avgRating: number
  monthBuckets: MonthBucket[]
  history: PayoutRow[]
}

function getMonthBuckets(): MonthBucket[] {
  const buckets: MonthBucket[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      amount: 0,
    })
  }
  return buckets
}

export default function EarningsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currency, setCurrency] = useState<CurrencyCode>('GBP')
  const [rates, setRates] = useState<Rates>({})

  async function fetchEarnings() {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - 7)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const [completedRes, pendingRes, profileRes, liveRates] = await Promise.all([
      // All completed orders (COMPLETE, DELIVERED, COLLECTED)
      supabase
        .from('orders')
        .select('id, reference, garment_type, quoted_amount, quoted_currency, updated_at')
        .eq('tailor_id', user?.id)
        .in('stage', ['COMPLETE', 'DELIVERED', 'COLLECTED'])
        .order('updated_at', { ascending: false }),

      // Orders in escrow (CONFIRMED → SHIPPED)
      supabase
        .from('orders')
        .select('quoted_amount, quoted_currency')
        .eq('tailor_id', user?.id)
        .in('stage', ['CONFIRMED', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION']),

      supabase
        .from('tailor_profiles')
        .select('avg_rating, currency')
        .eq('user_id', user?.id)
        .single(),

      fetchRates(),
    ])

    const completed = (completedRes.data ?? []) as any[]
    const pending = (pendingRes.data ?? []) as any[]
    const profile = profileRes.data as any

    // Use the tailor's stored currency, fall back to GBP
    const tailorCurrency = (profile?.currency ?? 'GBP') as CurrencyCode
    setCurrency(tailorCurrency)
    setRates(liveRates)

    // Normalise each order's amount to minor units of tailorCurrency
    function toDisplay(amountMinor: number, fromCurrency: CurrencyCode = tailorCurrency): number {
      if (fromCurrency === tailorCurrency) return amountMinor
      const fromRate = liveRates[fromCurrency] ?? 1
      const toRate = liveRates[tailorCurrency] ?? 1
      return Math.round((amountMinor / fromRate) * toRate)
    }

    const allTime = completed.reduce((s, o) => s + toDisplay(o.quoted_amount ?? 0, (o.quoted_currency ?? tailorCurrency) as CurrencyCode), 0)
    const thisMonth = completed
      .filter((o) => new Date(o.updated_at) >= monthStart)
      .reduce((s, o) => s + toDisplay(o.quoted_amount ?? 0, (o.quoted_currency ?? tailorCurrency) as CurrencyCode), 0)
    const thisWeek = completed
      .filter((o) => new Date(o.updated_at) >= weekStart)
      .reduce((s, o) => s + toDisplay(o.quoted_amount ?? 0, (o.quoted_currency ?? tailorCurrency) as CurrencyCode), 0)
    const pendingEscrow = pending.reduce((s: number, o: any) => s + toDisplay(o.quoted_amount ?? 0, (o.quoted_currency ?? tailorCurrency) as CurrencyCode), 0)
    const ordersThisMonth = completed.filter((o) => new Date(o.updated_at) >= monthStart).length

    // Build 6-month chart buckets
    const buckets = getMonthBuckets()
    for (const order of completed) {
      const d = new Date(order.updated_at)
      if (d < sixMonthsAgo) continue
      const key = d.toLocaleDateString('en-GB', { month: 'short' })
      const bucket = buckets.find((b) => b.label === key)
      if (bucket) bucket.amount += toDisplay(order.quoted_amount ?? 0, (order.quoted_currency ?? tailorCurrency) as CurrencyCode)
    }

    const history: PayoutRow[] = completed.slice(0, 20).map((o) => ({
      id: o.id,
      reference: o.reference,
      amount: toDisplay(o.quoted_amount ?? 0, (o.quoted_currency ?? tailorCurrency) as CurrencyCode),
      garmentType: o.garment_type,
      completedAt: o.updated_at,
    }))

    setData({
      allTime, thisMonth, thisWeek, pendingEscrow,
      ordersThisMonth, avgRating: profile?.avg_rating ?? 0,
      monthBuckets: buckets, history,
    })
  }

  useEffect(() => {
    fetchEarnings().finally(() => setLoading(false))
  }, [])

  async function onRefresh() {
    setRefreshing(true)
    await fetchEarnings()
    setRefreshing(false)
  }

  const fmt = (minor: number) => formatAmount(minor, currency, currency, rates)

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  const maxBucket = Math.max(...(data?.monthBuckets.map((b) => b.amount) ?? [1]), 1)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Earnings</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Hero stat */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Total earnings</Text>
          <Text style={styles.heroValue}>{fmt(data?.allTime ?? 0)}</Text>
          <View style={styles.heroRow}>
            <HeroSub label="This month" value={fmt(data?.thisMonth ?? 0)} />
            <View style={styles.heroDivider} />
            <HeroSub label="This week" value={fmt(data?.thisWeek ?? 0)} />
          </View>
        </View>

        {/* Escrow */}
        {(data?.pendingEscrow ?? 0) > 0 && (
          <View style={styles.escrowCard}>
            <View style={styles.escrowDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.escrowLabel}>In escrow (pending delivery)</Text>
              <Text style={styles.escrowValue}>{fmt(data!.pendingEscrow)}</Text>
            </View>
          </View>
        )}

        {/* Analytics — 3 headline numbers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>This month</Text>
          <View style={styles.analyticsRow}>
            <AnalyticCard label="Orders completed" value={String(data?.ordersThisMonth ?? 0)} />
            <AnalyticCard label="Avg rating" value={data?.avgRating ? `${data.avgRating.toFixed(1)} ★` : '—'} />
            <AnalyticCard label="Earned" value={fmt(data?.thisMonth ?? 0)} highlight />
          </View>
        </View>

        {/* 6-month earnings chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last 6 months</Text>
          <View style={styles.chartCard}>
            <View style={styles.chartArea}>
              {(data?.monthBuckets ?? []).map((bucket, i) => {
                const barHeight = maxBucket > 0
                  ? Math.max(4, (bucket.amount / maxBucket) * CHART_HEIGHT)
                  : 4
                return (
                  <View key={i} style={styles.chartBarWrap}>
                    <Text style={styles.chartBarValue}>
                      {bucket.amount > 0 ? fmt(bucket.amount) : ''}
                    </Text>
                    <View style={[styles.chartBar, { height: barHeight }]} />
                    <Text style={styles.chartBarLabel}>{bucket.label}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        </View>

        {/* Payout history */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Completed orders</Text>
          {(data?.history ?? []).length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No completed orders yet.</Text>
            </View>
          ) : (
            <View style={styles.historyList}>
              {(data?.history ?? []).map((row) => (
                <TouchableOpacity
                  key={row.id}
                  style={styles.historyRow}
                  onPress={() => router.navigate(`/(tailor)/orders/${row.id}`)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyGarment}>{row.garmentType}</Text>
                    <Text style={styles.historyRef}>
                      #{row.reference}  ·  {new Date(row.completedAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </Text>
                  </View>
                  <Text style={styles.historyAmount}>{fmt(row.amount)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Payout info */}
        <View style={styles.payoutInfoCard}>
          <Text style={styles.payoutInfoTitle}>Payout schedule</Text>
          <Text style={styles.payoutInfoText}>
            Funds are transferred to your bank account 24–48 hours after escrow releases. Connect your payout account in Settings → Bank account.
          </Text>
          <Text style={styles.payoutInfoNote}>Drape takes 0% commission in V1. You keep 100% of every order.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function HeroSub({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroSub}>
      <Text style={styles.heroSubLabel}>{label}</Text>
      <Text style={styles.heroSubValue}>{value}</Text>
    </View>
  )
}

function AnalyticCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[styles.analyticCard, highlight && styles.analyticCardHighlight]}>
      <Text style={[styles.analyticValue, highlight && styles.analyticValueHighlight]}>{value}</Text>
      <Text style={styles.analyticLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.xxxl },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  back: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium, width: 60 },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },

  heroCard: {
    margin: Spacing.xl, backgroundColor: Colors.needleGreen,
    borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md,
  },
  heroLabel: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.7)' },
  heroValue: { fontSize: 44, fontWeight: FontWeight.bold, color: Colors.white, letterSpacing: -1 },
  heroRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  heroSub: { gap: 2 },
  heroSubLabel: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.6)' },
  heroSubValue: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.white },
  heroDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },

  escrowCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.xl, backgroundColor: Colors.warning + '15',
    borderRadius: Radius.md, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  escrowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning },
  escrowLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  escrowValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },

  section: { paddingHorizontal: Spacing.xl, gap: Spacing.md, marginTop: Spacing.xl },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },

  analyticsRow: { flexDirection: 'row', gap: Spacing.sm },
  analyticCard: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.md, alignItems: 'center', gap: 4, ...Shadow.sm,
  },
  analyticCardHighlight: { backgroundColor: Colors.needleGreen },
  analyticValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  analyticValueHighlight: { color: Colors.white },
  analyticLabel: { fontSize: 10, color: Colors.midGrey, textAlign: 'center' },

  chartCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.sm },
  chartArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: CHART_HEIGHT + 40, gap: 0,
  },
  chartBarWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.xs },
  chartBarValue: { fontSize: 9, color: Colors.midGrey, textAlign: 'center' },
  chartBar: { width: '60%', backgroundColor: Colors.needleGreen, borderRadius: 3, minHeight: 4 },
  chartBarLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  historyList: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  historyGarment: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  historyRef: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  historyAmount: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.needleGreen },

  payoutInfoCard: {
    margin: Spacing.xl, backgroundColor: Colors.boneDeep,
    borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm,
  },
  payoutInfoTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  payoutInfoText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  payoutInfoNote: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  empty: { paddingVertical: Spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
})
