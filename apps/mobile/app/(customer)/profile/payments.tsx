import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRouter } from 'expo-router'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { goBackOrFallback } from '@/lib/navigation'
import { useAuth } from '@/lib/auth'
import {
  fetchCustomerPaymentHistory,
  type CustomerPaymentHistoryData,
  type CustomerPaymentStatus,
  type CustomerRefundRecord,
} from '@/lib/money-history'
import { formatAmount, useCurrency, type CurrencyCode } from '@/lib/currency'
import { useRefreshOnFocus } from '@/lib/queries'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'

type StatusFilter = 'ALL' | CustomerPaymentStatus
type RangeFilter = 'ALL' | '30D' | '90D' | '365D'

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'IN_ESCROW', label: 'Protected' },
  { key: 'RELEASED', label: 'Closed out' },
  { key: 'PARTIALLY_REFUNDED', label: 'Partial refund' },
  { key: 'REFUNDED', label: 'Refunded' },
]

const RANGE_FILTERS: Array<{ key: RangeFilter; label: string }> = [
  { key: '30D', label: '30 days' },
  { key: '90D', label: '90 days' },
  { key: '365D', label: '1 year' },
  { key: 'ALL', label: 'All time' },
]

function money(amount: number, currency: string) {
  return formatAmount(amount, currency as CurrencyCode, currency as CurrencyCode, {})
}

function convertMinorUnits(amountMinor: number, fromCurrency: string, toCurrency: CurrencyCode, rates: Record<string, number>) {
  const fromRate = rates[fromCurrency] ?? 1
  const toRate = rates[toCurrency] ?? 1
  const amount = amountMinor / 100
  return Math.round(((amount / fromRate) * toRate) * 100)
}

function withinRange(date: string, range: RangeFilter) {
  if (range === 'ALL') return true
  const ms =
    range === '30D'
      ? 30 * 24 * 60 * 60 * 1000
      : range === '90D'
        ? 90 * 24 * 60 * 60 * 1000
        : 365 * 24 * 60 * 60 * 1000
  return Date.parse(date) >= Date.now() - ms
}

function statusLabel(status: CustomerPaymentStatus) {
  switch (status) {
    case 'IN_ESCROW':
      return 'Protected'
    case 'RELEASED':
      return 'Closed out'
    case 'PARTIALLY_REFUNDED':
      return 'Partially refunded'
    case 'REFUNDED':
      return 'Refunded'
  }
}

function statusTone(status: CustomerPaymentStatus) {
  switch (status) {
    case 'IN_ESCROW':
      return { bg: Colors.boneDeep, fg: Colors.needleGreen }
    case 'RELEASED':
      return { bg: Colors.needleGreenLight, fg: Colors.needleGreenDark }
    case 'PARTIALLY_REFUNDED':
      return { bg: Colors.kanteRustLight, fg: Colors.kanteRust }
    case 'REFUNDED':
      return { bg: Colors.kanteRustLight, fg: Colors.kanteRust }
  }
}

function refundStatusTone(status: CustomerRefundRecord['status']) {
  return status === 'COMPLETED'
    ? { bg: Colors.needleGreenLight, fg: Colors.needleGreenDark }
    : { bg: Colors.boneDeep, fg: Colors.needleGreen }
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statHint}>{hint}</Text>
    </View>
  )
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.filterChip, active ? styles.filterChipActive : null]} onPress={onPress} activeOpacity={0.72}>
      <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  )
}

export default function CustomerPaymentHistoryScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const { currency, rates, loading: currencyLoading } = useCurrency()
  const [data, setData] = useState<CustomerPaymentHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('90D')

  async function load() {
    if (!user?.id) {
      setData(null)
      setLoading(false)
      return
    }

    try {
      const result = await fetchCustomerPaymentHistory(user.id, currency)
      setData(result)
      setError(null)
    } catch (fetchError) {
      setError(
        isLikelyConnectivityIssue(fetchError)
          ? 'Connection looks weak. We could not refresh your payment history yet.'
          : 'We could not load your payment history right now. Your orders are still protected, so try again in a moment.',
      )
    }
  }

  useEffect(() => {
    if (currencyLoading) return
    setLoading(true)
    void load().finally(() => setLoading(false))
  }, [user?.id, currency, currencyLoading])

  useRefreshOnFocus(() => {
    if (!currencyLoading) void load()
  }, 0)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile')
  }

  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.transactions ?? []).filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false
      if (!withinRange(row.date, rangeFilter)) return false
      if (!needle) return true
      return [
        row.reference,
        row.orderId,
        row.tailorName,
        row.title,
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [data?.transactions, rangeFilter, search, statusFilter])

  const filteredRefunds = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.refunds ?? []).filter((row) => {
      const date = row.completedAt ?? row.requestedAt ?? ''
      if (!withinRange(date, rangeFilter)) return false
      if (!needle) return true
      return [row.reference, row.orderId, row.providerReference ?? ''].some((value) => value.toLowerCase().includes(needle))
    })
  }, [data?.refunds, rangeFilter, search])

  const summary = useMemo(() => {
    const settled = (data?.transactions ?? []).filter((row) => row.status !== 'REFUNDED')
    const totalSpentMinor = settled.reduce((sum, row) => {
      const netAmount = Math.max(row.amount - row.refundedAmount, 0)
      return sum + convertMinorUnits(netAmount, row.currency, currency, rates)
    }, 0)
    return {
      totalSpentDisplay: money(totalSpentMinor, currency),
    }
  }, [currency, data?.transactions, rates])

  if (loading || currencyLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payment history</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your payment timeline…</Text>
            <Text style={styles.stateHint}>
              We’re gathering payments, order status, and refunds so your money history stays clear.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Payment history</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Summary</Text>
          <Text style={styles.summaryValue}>{summary.totalSpentDisplay}</Text>
          <Text style={styles.summaryHint}>
            Totals are shown in your current account currency. Each order below keeps the exact currency you paid with.
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Protected orders" value={String(data?.activeEscrowOrders ?? 0)} hint="Paid orders still in progress" />
          <StatCard label="Closed orders" value={String(data?.completedOrders ?? 0)} hint="Delivered or fully wrapped up" />
        </View>

        <View style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Transactions</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by order ID, reference, tailor, or garment"
            placeholderTextColor={Colors.midGrey}
            style={styles.searchInput}
          />
          <View style={styles.filterWrap}>
            {STATUS_FILTERS.map((filter) => (
              <FilterChip
                key={filter.key}
                label={filter.label}
                active={statusFilter === filter.key}
                onPress={() => setStatusFilter(filter.key)}
              />
            ))}
          </View>
          <View style={styles.filterWrap}>
            {RANGE_FILTERS.map((filter) => (
              <FilterChip
                key={filter.key}
                label={filter.label}
                active={rangeFilter === filter.key}
                onPress={() => setRangeFilter(filter.key)}
              />
            ))}
          </View>
        </View>

        {error ? (
          <View style={styles.inlineErrorCard}>
            <Text style={styles.inlineErrorTitle}>Something needs attention</Text>
            <Text style={styles.inlineErrorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          {filteredTransactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No matching payments yet.</Text>
              <Text style={styles.emptyText}>
                When you pay for an order, the amount, status, and any later refund will show here.
              </Text>
            </View>
          ) : (
            filteredTransactions.map((row) => {
              const tone = statusTone(row.status)
              return (
                <TouchableOpacity
                  key={row.paymentId}
                  style={styles.transactionCard}
                  onPress={() => router.navigate(`/(customer)/orders/${row.orderId}`)}
                  activeOpacity={0.78}
                >
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{row.title}</Text>
                      <Text style={styles.rowMeta}>
                        #{row.reference} · {row.tailorName} · {new Date(row.date).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.statusPillText, { color: tone.fg }]}>{statusLabel(row.status)}</Text>
                    </View>
                  </View>

                  <View style={styles.moneyBreakdown}>
                    <MoneyLine label={row.phase === 'CONSULTATION' ? 'Consultation payment' : row.phase === 'FULFILLMENT' ? 'Fulfillment payment' : 'Amount paid'} value={money(row.amount, row.currency)} strong />
                    <MoneyLine label="Tax" value={money(row.taxAmount, row.currency)} />
                    {row.refundedAmount > 0 ? (
                      <MoneyLine label="Refunded so far" value={money(row.refundedAmount, row.currency)} />
                    ) : null}
                  </View>

                  {row.currency !== currency ? (
                    <Text style={styles.reasonText}>
                      Locked in {row.currency} when placed. Current account currency is {currency}.
                    </Text>
                  ) : null}
                </TouchableOpacity>
              )
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Refund history</Text>
          {filteredRefunds.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No refunds recorded yet.</Text>
              <Text style={styles.emptyText}>
                If Drape returns money to you, the provider reference and timeline will appear here.
              </Text>
            </View>
          ) : (
            filteredRefunds.map((row) => {
              const tone = refundStatusTone(row.status)
              return (
                <View key={row.paymentId} style={styles.refundCard}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{money(row.amount, row.currency)}</Text>
                      <Text style={styles.rowMeta}>
                        #{row.reference} · {row.providerReference ?? 'Provider reference pending'}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.statusPillText, { color: tone.fg }]}>{row.status === 'COMPLETED' ? 'Completed' : 'Processing'}</Text>
                    </View>
                  </View>
                  <Text style={styles.rowMeta}>{row.partial ? 'Partial refund' : 'Full refund'}</Text>
                  {row.requestedAt ? (
                    <Text style={styles.rowMeta}>
                      Requested {new Date(row.requestedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                  {row.completedAt ? (
                    <Text style={styles.rowMeta}>
                      Completed {new Date(row.completedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                </View>
              )
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function MoneyLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.moneyLine}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <Text style={strong ? styles.moneyValueStrong : styles.moneyValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.xxxl },
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
    letterSpacing: 0.7,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  back: { width: 60, color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  summaryCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  summaryEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.72)',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontWeight: FontWeight.semibold,
  },
  summaryValue: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.textInverse, letterSpacing: -0.8 },
  summaryHint: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.84)', lineHeight: 20 },
  statsGrid: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 6,
    ...Shadow.sm,
  },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  statHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 16 },
  controlsCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  section: { marginHorizontal: Spacing.lg, marginTop: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  searchInput: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.ink,
  },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  filterChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    backgroundColor: Colors.bone,
  },
  filterChipActive: {
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
  },
  filterChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  filterChipTextActive: { color: Colors.needleGreenDark },
  inlineErrorCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: 4,
  },
  inlineErrorTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.error },
  inlineErrorText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  transactionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  refundCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 6,
    ...Shadow.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  rowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  rowMeta: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: 2 },
  statusPill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  statusPillText: { fontSize: 11, fontWeight: FontWeight.semibold },
  moneyBreakdown: {
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.sm,
    gap: 8,
  },
  moneyLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  moneyLabel: { fontSize: FontSize.sm, color: Colors.inkLight, flex: 1 },
  moneyValue: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  moneyValueStrong: { fontSize: FontSize.md, color: Colors.needleGreenDark, fontWeight: FontWeight.bold },
  reasonText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
})
